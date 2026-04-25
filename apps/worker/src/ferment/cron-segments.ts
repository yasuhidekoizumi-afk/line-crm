/**
 * FERMENT: セグメント定期再計算 cron
 *
 * 1時間毎に実行 (wrangler.toml: "0 * * * *")
 * アクティブな全セグメントの顧客集合を再計算する。
 *
 * 呼び出し元:
 *   - apps/worker/src/index.ts (scheduled handler)
 */

import { getSegments } from '@line-crm/db';
import { computeSegment } from './segment-engine.js';

interface FermentEnv {
  DB: D1Database;
}

/**
 * 全セグメントを再計算する
 */
export async function recomputeAllSegments(env: FermentEnv): Promise<void> {
  const segments = await getSegments(env.DB);

  for (const segment of segments) {
    try {
      const count = await computeSegment(segment.segment_id, env.DB);
      console.log(`[FERMENT] セグメント再計算完了: ${segment.name} (${count}件)`);
    } catch (err) {
      console.error(`[FERMENT] セグメント再計算エラー: ${segment.segment_id}`, err);
    }
  }
}
