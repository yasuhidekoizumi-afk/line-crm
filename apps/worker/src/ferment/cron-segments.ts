/**
 * FERMENT: セグメント定期再計算 cron
 *
 * 1時間毎に実行 (wrangler.toml: "0 * * * *")
 * アクティブな全セグメントの顧客集合を再計算し、
 * 新たにセグメントに入った顧客に対してオートメーションルールを実行する。
 */

import { getSegments, getAutomations } from '@line-crm/db';
import { computeSegment, querySegmentCustomerIds } from './segment-engine.js';
import { executeAutomationActions } from './segment-automation.js';

interface FermentEnv {
  DB: D1Database;
}

/**
 * 全セグメントを再計算し、セグメント参入オートメーションを発火する
 */
export async function recomputeAllSegments(env: FermentEnv): Promise<void> {
  const segments = await getSegments(env.DB);
  const automations = await getAutomations(env.DB, { eventType: 'segment_enter', isActive: true });

  for (const segment of segments) {
    try {
      // 再計算前のメンバーIDを取得
      const beforeResult = await env.DB
        .prepare('SELECT customer_id FROM segment_members WHERE segment_id = ?')
        .bind(segment.segment_id)
        .all<{ customer_id: string }>();
      const beforeIds = new Set(beforeResult.results.map((r) => r.customer_id));

      // セグメント再計算
      const count = await computeSegment(segment.segment_id, env.DB);
      console.log(`[FERMENT] セグメント再計算完了: ${segment.name} (${count}件)`);

      // 再計算後のメンバーIDを取得
      const afterResult = await env.DB
        .prepare('SELECT customer_id FROM segment_members WHERE segment_id = ?')
        .bind(segment.segment_id)
        .all<{ customer_id: string }>();
      const afterIds = afterResult.results.map((r) => r.customer_id);

      // 新規参入者を特定
      const newMemberIds = afterIds.filter((id) => !beforeIds.has(id));
      if (newMemberIds.length === 0) continue;

      // このセグメントに対するオートメーションルールを検索
      const matchingRules = automations.filter((a) => {
        try {
          const conds = JSON.parse(a.conditions);
          return conds.segment_id === segment.segment_id;
        } catch { return false; }
      });

      if (matchingRules.length === 0) continue;

      console.log(`[FERMENT] セグメント参入自動化: ${segment.name} → ${newMemberIds.length}人 × ${matchingRules.length}ルール`);

      // アクションを実行
      for (const rule of matchingRules) {
        try {
          const actions = JSON.parse(rule.actions);
          await executeAutomationActions(env.DB, rule, actions, newMemberIds);
        } catch (err) {
          console.error(`[FERMENT] 自動化実行エラー: ${rule.id}`, err);
        }
      }
    } catch (err) {
      console.error(`[FERMENT] セグメント再計算エラー: ${segment.segment_id}`, err);
    }
  }
}
