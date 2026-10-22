/**
 * 顧客向けポイントAPIの防御（列挙・総当たり対策）。
 *
 * 背景: 顧客IDはShopifyの連番で推測できるため、署名が入るまでの間、
 * 短時間に多数の顧客IDへアクセスされたら遮断する。
 * 正常な顧客は自分のIDしか叩かない（1〜2ID）ので、誤検知しない。
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_DISTINCT_CUSTOMERS_PER_WINDOW = 5;

interface Bucket {
  windowStart: number;
  count: number;
  customerIds: Set<string>;
}

const buckets = new Map<string, Bucket>();

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
 * @param headers リクエストヘッダー
 * @param customerId アクセス対象のShopify顧客ID（不明なら 'unknown'）
 */
export function guardCustomerEnumeration(headers: Headers, customerId: string | null | undefined): GuardResult {
  const now = Date.now();
  const key = `ip:${clientIp(headers)}`;
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { windowStart: now, count: 0, customerIds: new Set() };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  // メモリ肥大の防止（isolate単位の簡易GC）
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.windowStart > WINDOW_MS) buckets.delete(k);
    }
  }

  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    return { blocked: true, retryAfterSec: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000) };
  }

  const id = String(customerId ?? 'unknown');
  if (id !== 'unknown') {
    bucket.customerIds.add(id);
    if (bucket.customerIds.size > MAX_DISTINCT_CUSTOMERS_PER_WINDOW) {
      return { blocked: true, retryAfterSec: Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000) };
    }
  }

  return { blocked: false };
}
