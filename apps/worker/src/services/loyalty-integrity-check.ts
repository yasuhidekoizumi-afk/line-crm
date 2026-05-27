/**
 * loyalty-integrity-check.ts
 *
 * ロイヤルティポイントの整合性を定期的に検証し、異常があれば Slack 通知する。
 *
 * 検証項目:
 *  1. 残高乖離 (loyalty_points.balance + limited_balance) != SUM(loyalty_transactions.points)
 *  2. 1時間以内に balance_after が 10000pt 以上ジャンプ (異常付与/消費の兆候)
 *  3. 1ユーザーで 1時間以内に cancel-code が 5回以上 (テスト/不正の兆候)
 *
 * 1時間ごとの cron で実行される想定。
 */

type IntegrityEnv = {
  DB: D1Database;
  SLACK_WEBHOOK_URL?: string;
};

type IntegrityIssue = {
  category: 'balance_mismatch' | 'balance_jump' | 'cancel_spam';
  friend_id: string;
  display_name?: string | null;
  detail: string;
};

export async function runLoyaltyIntegrityCheck(env: IntegrityEnv): Promise<{ issues: IntegrityIssue[] }> {
  const issues: IntegrityIssue[] = [];

  // ─── 1. 残高乖離 ────────────────────────────────────────────────
  const mismatchRows = await env.DB
    .prepare(
      `WITH tx_sum AS (
         SELECT friend_id, COALESCE(SUM(points), 0) as tx_total
         FROM loyalty_transactions
         GROUP BY friend_id
       )
       SELECT lp.friend_id, f.display_name,
              lp.balance, COALESCE(lp.limited_balance, 0) as lim,
              COALESCE(t.tx_total, 0) as tx_total,
              (lp.balance + COALESCE(lp.limited_balance, 0)) - COALESCE(t.tx_total, 0) as gap
       FROM loyalty_points lp
       LEFT JOIN tx_sum t ON t.friend_id = lp.friend_id
       LEFT JOIN friends f ON f.id = lp.friend_id
       WHERE (lp.balance + COALESCE(lp.limited_balance, 0)) != COALESCE(t.tx_total, 0)
       LIMIT 50`,
    )
    .all<{
      friend_id: string;
      display_name: string | null;
      balance: number;
      lim: number;
      tx_total: number;
      gap: number;
    }>();

  for (const row of mismatchRows.results) {
    issues.push({
      category: 'balance_mismatch',
      friend_id: row.friend_id,
      display_name: row.display_name,
      detail: `balance=${row.balance} + limited=${row.lim} (=${row.balance + row.lim}pt) vs 履歴SUM=${row.tx_total}pt / gap=${row.gap > 0 ? '+' : ''}${row.gap}pt`,
    });
  }

  // ─── 2. 異常な残高ジャンプ ──────────────────────────────────────
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('Z', '+09:00').replace(/\.\d{3}/, '.000');
  const jumpRows = await env.DB
    .prepare(
      `SELECT friend_id, MAX(ABS(points)) as max_diff
       FROM loyalty_transactions
       WHERE created_at >= ?
       GROUP BY friend_id
       HAVING max_diff >= 10000`,
    )
    .bind(oneHourAgo)
    .all<{ friend_id: string; max_diff: number }>();

  for (const row of jumpRows.results) {
    issues.push({
      category: 'balance_jump',
      friend_id: row.friend_id,
      detail: `直近1時間で ${row.max_diff.toLocaleString('ja-JP')}pt のジャンプを検出 (異常付与/消費の兆候)`,
    });
  }

  // ─── 3. cancel-code の連発 (1ユーザー1時間で5回以上) ────────────
  const cancelSpamRows = await env.DB
    .prepare(
      `SELECT friend_id, COUNT(*) as cnt
       FROM loyalty_transactions
       WHERE created_at >= ?
         AND type = 'adjust'
         AND reason LIKE 'コード取り消しによるポイント返還%'
       GROUP BY friend_id
       HAVING cnt >= 5`,
    )
    .bind(oneHourAgo)
    .all<{ friend_id: string; cnt: number }>();

  for (const row of cancelSpamRows.results) {
    issues.push({
      category: 'cancel_spam',
      friend_id: row.friend_id,
      detail: `直近1時間で cancel-code が ${row.cnt} 回実行 (テスト/不正利用の兆候)`,
    });
  }

  // ─── Slack 通知 ─────────────────────────────────────────────────
  if (issues.length > 0 && env.SLACK_WEBHOOK_URL) {
    const summary = `🚨 ロイヤルティポイント異常検出 (${issues.length}件)`;
    const blocks: Array<Record<string, unknown>> = [
      { type: 'header', text: { type: 'plain_text', text: summary } },
    ];

    const grouped: Record<string, IntegrityIssue[]> = {};
    for (const issue of issues) {
      grouped[issue.category] = grouped[issue.category] ?? [];
      grouped[issue.category].push(issue);
    }
    const labels: Record<string, string> = {
      balance_mismatch: '💰 残高乖離',
      balance_jump: '⚡ 異常ジャンプ',
      cancel_spam: '🔁 cancel連発',
    };
    for (const [cat, items] of Object.entries(grouped)) {
      const lines = items.slice(0, 10).map((it) => {
        const nameLabel = it.display_name ? `${it.display_name} (${it.friend_id})` : it.friend_id;
        return `• ${nameLabel}: ${it.detail}`;
      });
      const moreNote = items.length > 10 ? `\n... 他 ${items.length - 10} 件` : '';
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${labels[cat] ?? cat}* (${items.length}件)\n${lines.join('\n')}${moreNote}` },
      });
    }

    try {
      await fetch(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: summary, blocks }),
      });
    } catch (err) {
      console.error('[loyalty-integrity] slack notification failed:', err);
    }
  }

  return { issues };
}
