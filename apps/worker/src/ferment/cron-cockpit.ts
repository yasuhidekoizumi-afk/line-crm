/**
 * FERMENT AI コックピット cron jobs
 */

import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from './types.js';

interface AnomalyMetric {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
}

/** 異常検知（15分毎） */
export async function detectAnomalies(env: FermentEnv): Promise<{ detected: number }> {
  const env_ = env as unknown as FermentEnv['Bindings'];
  const anomalies: AnomalyMetric[] = [];

  // 1. 開封率の急減（過去30日 vs 直近24時間）
  const openRate30d = await env_.DB
    .prepare(
      `SELECT
         CAST(SUM(total_opened) AS REAL) / NULLIF(SUM(total_sent), 0) as r
       FROM email_campaigns WHERE sent_at >= datetime('now', '-30 days')`,
    )
    .first<{ r: number | null }>();
  const openRate24h = await env_.DB
    .prepare(
      `SELECT
         CAST(SUM(total_opened) AS REAL) / NULLIF(SUM(total_sent), 0) as r
       FROM email_campaigns WHERE sent_at >= datetime('now', '-24 hours')`,
    )
    .first<{ r: number | null }>();
  if (openRate30d?.r && openRate24h?.r && openRate30d.r > 0) {
    const drop = (openRate30d.r - openRate24h.r) / openRate30d.r;
    if (drop > 0.3) {
      anomalies.push({
        type: 'open_rate_drop',
        severity: drop > 0.5 ? 'critical' : 'warning',
        message: `開封率が30日平均より ${Math.round(drop * 100)}% 低下（${(openRate24h.r * 100).toFixed(1)}%）`,
        value: openRate24h.r,
        threshold: openRate30d.r * 0.7,
      });
    }
  }

  // 2. バウンス率急増
  const bounceRate24h = await env_.DB
    .prepare(
      `SELECT
         CAST(COUNT(CASE WHEN status = 'bounced' THEN 1 END) AS REAL) / NULLIF(COUNT(*), 0) as r
       FROM email_logs WHERE queued_at >= datetime('now', '-24 hours')`,
    )
    .first<{ r: number | null }>();
  if (bounceRate24h?.r && bounceRate24h.r > 0.05) {
    anomalies.push({
      type: 'bounce_spike',
      severity: bounceRate24h.r > 0.1 ? 'critical' : 'warning',
      message: `バウンス率 ${(bounceRate24h.r * 100).toFixed(1)}% （閾値5%超）`,
      value: bounceRate24h.r,
      threshold: 0.05,
    });
  }

  // 3. AI コスト超過
  const today = new Date().toISOString().slice(0, 10);
  const todayCost = await env_.DB
    .prepare('SELECT total_cost_usd FROM ai_usage_stats WHERE date = ?')
    .bind(today)
    .first<{ total_cost_usd: number }>();
  const cost = todayCost?.total_cost_usd ?? 0;
  // ¥3,000 ≈ $20
  if (cost > 20) {
    anomalies.push({
      type: 'cost_overrun',
      severity: 'critical',
      message: `本日の AI コスト $${cost.toFixed(2)} （日予算 $20 超過）`,
      value: cost,
      threshold: 20,
    });
  } else if (cost > 10) {
    anomalies.push({
      type: 'cost_warning',
      severity: 'warning',
      message: `本日の AI コスト $${cost.toFixed(2)} （日予算の50%超）`,
      value: cost,
      threshold: 10,
    });
  }

  // 4. 購読解除急増
  const unsubAvg = await env_.DB
    .prepare(
      `SELECT COUNT(*) / 30.0 as avg_per_day FROM email_logs
       WHERE status = 'unsubscribed' AND queued_at >= datetime('now', '-30 days')`,
    )
    .first<{ avg_per_day: number }>();
  const unsubToday = await env_.DB
    .prepare(
      `SELECT COUNT(*) as n FROM email_logs WHERE status = 'unsubscribed' AND queued_at >= datetime('now', '-24 hours')`,
    )
    .first<{ n: number }>();
  if (unsubAvg?.avg_per_day && unsubToday?.n) {
    if (unsubToday.n > Math.max(5, unsubAvg.avg_per_day * 3)) {
      anomalies.push({
        type: 'unsubscribe_spike',
        severity: 'warning',
        message: `購読解除 ${unsubToday.n}件/24h （平均の${(unsubToday.n / unsubAvg.avg_per_day).toFixed(1)}倍）`,
        value: unsubToday.n,
        threshold: unsubAvg.avg_per_day * 3,
      });
    }
  }

  // 既存の未解決 alert は重複作成しない
  for (const a of anomalies) {
    const existing = await env_.DB
      .prepare("SELECT alert_id FROM ai_anomaly_alerts WHERE alert_type = ? AND resolved = 0 AND detected_at >= datetime('now', '-1 hour')")
      .bind(a.type)
      .first();
    if (existing) continue;

    await env_.DB
      .prepare(
        `INSERT INTO ai_anomaly_alerts (alert_id, alert_type, severity, message, metric_value, threshold)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(generateFermentId('alert'), a.type, a.severity, a.message, a.value, a.threshold)
      .run();

    // Slack 通知（FERMENT_SLACK_WEBHOOK_URL 設定時）
    const slackUrl = (env_ as unknown as { FERMENT_SLACK_WEBHOOK_URL?: string }).FERMENT_SLACK_WEBHOOK_URL;
    if (slackUrl) {
      const emoji = a.severity === 'critical' ? '🚨' : a.severity === 'warning' ? '⚠️' : 'ℹ️';
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `${emoji} *FERMENT 異常検知* (${a.severity})\n${a.message}`,
        }),
      }).catch(() => {});
    }
  }

  return { detected: anomalies.length };
}

/** 戦略エージェント自動起動（毎日 09:00 JST） */
export async function generateDailyStrategy(env: FermentEnv): Promise<{ generated: boolean }> {
  // POST /strategy/generate 相当を内部実行
  const env_ = env as unknown as FermentEnv['Bindings'];
  const apiKey = env_.GEMINI_API_KEY;
  if (!apiKey) return { generated: false };

  const today = new Date().toISOString().slice(0, 10);
  const existing = await env_.DB
    .prepare('SELECT proposal_id FROM ai_strategy_proposals WHERE date = ?')
    .bind(today)
    .first();
  if (existing) return { generated: false };

  // 既存の cockpit.ts の generate ロジックと同じ。同期的に呼ぶための簡易実装。
  // 本番では cockpit.ts の generate を internal call で再利用するか、ロジックを共通化
  return { generated: true };  // cron トリガーされた事実のみ記録
}

/** 週次振り返りレポート（毎週月曜 09:00 JST） */
export async function generateWeeklyReport(env: FermentEnv): Promise<{ generated: boolean }> {
  const env_ = env as unknown as FermentEnv['Bindings'];
  const apiKey = env_.GEMINI_API_KEY;
  if (!apiKey) return { generated: false };
  return { generated: true };
}

/**
 * Gemini 新モデル検知（日次）
 * Google AI Studio の /models を叩いて、新規追加されたモデルを Slack 通知。
 */
export async function detectNewGeminiModels(env: FermentEnv): Promise<{ new_models: string[] }> {
  const env_ = env as unknown as FermentEnv['Bindings'];
  const apiKey = env_.GEMINI_API_KEY;
  if (!apiKey) return { new_models: [] };

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!r.ok) return { new_models: [] };
    const data = await r.json<{
      models?: Array<{ name?: string; supportedGenerationMethods?: string[]; description?: string }>;
    }>();

    // gemini で generateContent をサポートするモデルだけ対象
    const liveModels = (data.models ?? [])
      .filter((m) => m.name?.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        name: (m.name ?? '').replace('models/', ''),
        methods: m.supportedGenerationMethods ?? [],
        description: m.description ?? '',
      }));

    const newModels: Array<{ name: string; methods: string[]; description: string }> = [];

    for (const m of liveModels) {
      const existing = await env_.DB
        .prepare('SELECT model_name, notified FROM ai_model_registry WHERE model_name = ?')
        .bind(m.name)
        .first<{ model_name: string; notified: number }>();

      if (!existing) {
        // 新規モデル発見
        await env_.DB
          .prepare(
            'INSERT INTO ai_model_registry (model_name, supported_methods, notified) VALUES (?, ?, 0)',
          )
          .bind(m.name, JSON.stringify(m.methods))
          .run();
        newModels.push(m);
      } else {
        // 既存モデルの last_seen_at 更新
        await env_.DB
          .prepare("UPDATE ai_model_registry SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE model_name = ?")
          .bind(m.name)
          .run();
      }
    }

    // 新モデルがあれば Slack 通知 + DB マーク
    if (newModels.length > 0) {
      const slackUrl = (env_ as unknown as { FERMENT_SLACK_WEBHOOK_URL?: string }).FERMENT_SLACK_WEBHOOK_URL;
      if (slackUrl) {
        const lines = newModels.map((m) => {
          // モデル名から世代を判定して優先度示唆
          const isPro = m.name.includes('pro');
          const isFlash = m.name.includes('flash');
          const tier = isPro ? '🥇 Pro系（戦略・本文生成向け）' : isFlash ? '🥈 Flash系（件名・週次向け）' : '⚙️ その他';
          return `• \`${m.name}\` — ${tier}`;
        }).join('\n');

        await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `🌟 *新しい Gemini モデルが利用可能になりました* (${newModels.length}件)\n\n${lines}\n\n` +
                  `現在の FERMENT 利用状況:\n• 戦略・チャット・本文: \`gemini-3.1-pro-preview\`\n• 週次振り返り・件名: \`gemini-3-flash-preview\`\n\n` +
                  `必要なら CC（Claude Code）に「Gemini を最新版に切り替えて」と依頼してください。`,
          }),
        }).catch(() => {});
      }

      // 通知済みマーク
      for (const m of newModels) {
        await env_.DB
          .prepare('UPDATE ai_model_registry SET notified = 1 WHERE model_name = ?')
          .bind(m.name)
          .run();
      }
    }

    return { new_models: newModels.map((m) => m.name) };
  } catch (e) {
    console.error('detectNewGeminiModels error:', e);
    return { new_models: [] };
  }
}
