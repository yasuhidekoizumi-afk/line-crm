/**
 * セグメント参入オートメーション実行サービス
 *
 * cron-segments.ts から呼ばれ、新たにセグメントに入った顧客に対して
 * 定義されたアクション（タグ付与・シナリオ登録等）を実行する。
 */

import { jstNow } from '@line-crm/db';

interface AutomationRow {
  id: string;
  name: string;
  event_type: string;
  conditions: string;
  actions: string;
  is_active: number;
}

interface AutomationAction {
  type: string;
  params: Record<string, unknown>;
}

/**
 * オートメーションアクションを新規セグメントメンバーに対して実行する
 */
export async function executeAutomationActions(
  db: D1Database,
  rule: AutomationRow,
  actions: AutomationAction[],
  customerIds: string[],
): Promise<void> {
  // customer_id → friend_id のマッピングを取得
  const placeholders = customerIds.map(() => '?').join(',');
  const friendRows = await db
    .prepare(
      `SELECT c.customer_id, f.id as friend_id, f.line_user_id
       FROM customers c
       JOIN friends f ON f.line_user_id = c.line_user_id
       WHERE c.customer_id IN (${placeholders}) AND f.is_following = 1`,
    )
    .bind(...customerIds)
    .all<{ customer_id: string; friend_id: string; line_user_id: string }>();

  const now = jstNow();

  for (const action of actions) {
    const { type, params } = action;

    switch (type) {
      case 'add_tag': {
        const tagId = params.tagId as string;
        if (!tagId) break;
        for (const row of friendRows.results ?? []) {
          // 既存のタグ割当を確認
          const existing = await db
            .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
            .bind(row.friend_id, tagId)
            .first();
          if (existing) continue;
          await db
            .prepare('INSERT INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)')
            .bind(row.friend_id, tagId, now)
            .run();
        }
        console.log(`  → add_tag: ${tagId} (${friendRows.results?.length ?? 0}人)`);
        break;
      }

      case 'start_scenario': {
        const scenarioId = params.scenarioId as string;
        if (!scenarioId) break;
        for (const row of friendRows.results ?? []) {
          // 既に登録済みか確認
          const existing = await db
            .prepare('SELECT 1 FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ? AND status = ?')
            .bind(row.friend_id, scenarioId, 'active')
            .first();
          if (existing) continue;
          await db
            .prepare(
              `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
               VALUES (?, ?, ?, 1, 'active', ?, NULL, ?)`,
            )
            .bind(crypto.randomUUID(), row.friend_id, scenarioId, now, now)
            .run();
        }
        console.log(`  → start_scenario: ${scenarioId} (${friendRows.results?.length ?? 0}人)`);
        break;
      }

      case 'remove_tag': {
        const removeTagId = params.tagId as string;
        if (!removeTagId) break;
        for (const row of friendRows.results ?? []) {
          await db
            .prepare('DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
            .bind(row.friend_id, removeTagId)
            .run();
        }
        console.log(`  → remove_tag: ${removeTagId} (${friendRows.results?.length ?? 0}人)`);
        break;
      }

      default:
        console.log(`  → 未対応アクション: ${type}（スキップ）`);
        break;
    }
  }

  // オートメーションログを記録
  for (const row of friendRows.results ?? []) {
    await db
      .prepare(
        `INSERT INTO automation_logs (id, automation_id, friend_id, event_data, actions_result, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        rule.id,
        row.friend_id,
        JSON.stringify({ event_type: 'segment_enter', segment_id: rule.conditions }),
        JSON.stringify({ actions: actions.map((a) => a.type) }),
        now,
      )
      .run();
  }
}
