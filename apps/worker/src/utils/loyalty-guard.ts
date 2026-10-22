/**
 * 顧客向けポイントAPIの防御（列挙・総当たり対策）。
 *
 * 背景: 顧客IDはShopifyの連番で推測できるため、署名必須化までの間、
 * 同一IPが短時間に多数の顧客IDへアクセスしたら遮断する。
 *
 * 注意: Workerのin-memoryカウンタはisolateごとに独立し、リクエストが別isolateへ
 * 分散すると機能しない（実測で素通り）。そのためD1の request_guards に永続化する。
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 200;
const MAX_DISTINCT_CUSTOMERS_PER_WINDOW = 20;

function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}

export interface GuardResult {
  blocked: boolean;
  retryAfterSec?: number;
}

/**
 * 同一IPが短時間に多数の顧客IDへアクセスしたら遮断する。
 * @param db D1（request_guards テーブルが必要）
 * @param headers リクエストヘッダー
 * @param customerId アクセス対象のShopify顧客ID（不明なら null）
 */
export async function guardCustomerEnumeration(
  db: D1Database,
  headers: Headers,
  customerId: string | null | undefined,
): Promise<GuardResult> {
  const key = `cust:${clientIp(headers)}`;
  const now = Date.now();
  const id = String(customerId ?? '').trim();
  const currentId = id && id !== 'unknown' ? id : '';

  try {
    const row = await db
      .prepare(`SELECT window_start, count, customer_ids FROM request_guards WHERE key = ?`)
      .bind(key)
      .first<{ window_start: number; count: number; customer_ids: string }>();

    const inWindow = row && now - row.window_start <= WINDOW_MS;
    const windowStart = inWindow ? row!.window_start : now;
    const count = (inWindow ? row!.count : 0) + 1;
    const ids = new Set((inWindow ? row!.customer_ids : '').split(',').filter(Boolean));
    if (currentId) ids.add(currentId);
    const customerIds = Array.from(ids).join(',');

    await db
      .prepare(
        `INSERT INTO request_guards (key, window_start, count, customer_ids) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           window_start = excluded.window_start,
           count = excluded.count,
           customer_ids = excluded.customer_ids`,
      )
      .bind(key, windowStart, count, customerIds)
      .run();

    if (count > MAX_REQUESTS_PER_WINDOW || ids.size > MAX_DISTINCT_CUSTOMERS_PER_WINDOW) {
      return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000)) };
    }
    return { blocked: false };
  } catch (error) {
    // ガードの障害で顧客の正規利用を止めない（ログに残す）
    console.error('[loyalty-guard] check failed:', error);
    return { blocked: false };
  }
}
