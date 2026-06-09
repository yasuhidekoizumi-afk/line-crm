import {
  getLoyaltyPointByShopifyCustomerId,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
} from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

// ────────────────────────────────────────────────────────────────────
// ポイント割引コードの「未使用返還」共通ロジック
//
// 背景:
//   ポイント利用(redeem)は「割引コードを発行した時点」でポイントを減算する設計。
//   コードを使わずに別クーポンで購入したり、放置で期限切れになると、
//   ポイントだけが消えて戻らない（= 宙に浮く）バグがあった。
//
// この関数は「未使用のコードを取り消してポイントを返す」処理を1か所に集約する。
//   - 手動取消（cancel-code エンドポイント）
//   - 注文確定時の自動返還（B1: orders-paid webhook）
//   - 期限内未使用の自動返還（B2: cron）
//   の3経路から同じロジックを呼ぶことで、返金処理の食い違い事故を防ぐ。
//
// 安全装置:
//   - Shopify 上で「使用済み(usage_count > 0)」のコードは返金しない（正常利用）
//   - [取り消し済み] 済みの redeem は対象外（二重返還防止）
// ────────────────────────────────────────────────────────────────────

/** 返金処理の結果。refunded=false の場合 reason に理由が入る。 */
export interface RefundCodeResult {
  refunded: boolean;
  /** 返還したポイント数（refunded=true のとき） */
  refundPoints?: number;
  /** 返還後の通常残高（refunded=true のとき） */
  balance?: number;
  /** 返還後ランク（refunded=true のとき） */
  rank?: string;
  /**
   * 結果コード:
   *  ok                  返金実行
   *  used                Shopify で使用済み → 返金しない（正常）
   *  no_redeem           対象の利用記録なし or 既に取り消し済み
   *  not_owned           コードがこの顧客のものでない
   *  no_point            ポイント情報なし
   *  shopify_unconfigured / shopify_error  Shopify 設定/通信エラー
   *  amount_unknown      返還ポイント数を特定できない
   */
  reason:
    | 'ok'
    | 'used'
    | 'no_redeem'
    | 'not_owned'
    | 'no_point'
    | 'shopify_unconfigured'
    | 'shopify_error'
    | 'amount_unknown';
}

/** この関数が必要とする環境変数（DB と Shopify 認証情報） */
export interface RefundCodeEnv {
  DB: D1Database;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

/** 返還の発生経路（履歴の文言に使う） */
export type RefundSource = 'manual' | 'order_paid' | 'cron';

/**
 * 指定コードが「未使用」なら、Shopify 側のコードを削除しつつポイントを返還する。
 * 使用済み・対象なしの場合は何もせず理由を返す（throw しない）。
 */
export async function refundUnusedPointCode(
  env: RefundCodeEnv,
  shopifyCustomerId: string,
  code: string,
  source: RefundSource,
): Promise<RefundCodeResult> {
  const db = env.DB;
  const normalizedCode = code.trim().toUpperCase();

  // このコードがこの顧客のものか確認（コード = ORYZAE-<顧客ID末尾6桁>-xxxx）
  const expectedSuffix = shopifyCustomerId.slice(-6);
  if (!normalizedCode.startsWith(`ORYZAE-${expectedSuffix}-`)) {
    return { refunded: false, reason: 'not_owned' };
  }

  const point = await getLoyaltyPointByShopifyCustomerId(db, shopifyCustomerId);
  if (!point) return { refunded: false, reason: 'no_point' };

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) return { refunded: false, reason: 'shopify_unconfigured' };

  // Shopify 上のコード状態を「確実に」判定する。
  //   旧実装は price_rules を 250 件だけ取得して title 検索していたため、割引が 250 件を
  //   超えると目的のコードを取りこぼし「見つからない=削除済み」と誤判定 → 使用済み確認を
  //   スキップしてしまい、まだ使える/使用済みのコードを未使用とみなして誤返金する危険が
  //   あった（会社側の損）。GraphQL codeDiscountNodeByCode で件数に依存せず1発で判定する。
  //     - node が null        : Shopify 上に存在しない（=使えない）→ そのまま返金（削除不要）
  //     - asyncUsageCount > 0 : 使用済み（正常利用）→ 返金しない
  //     - asyncUsageCount = 0 : 未使用で存在 → コード削除（再利用防止）してから返金
  const lookupRes = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($c:String!){ codeDiscountNodeByCode(code:$c){ id codeDiscount{ __typename ... on DiscountCodeBasic { asyncUsageCount } } } }`,
      variables: { c: normalizedCode },
    }),
  });
  if (!lookupRes.ok) return { refunded: false, reason: 'shopify_error' };
  const lookupJson = (await lookupRes.json()) as {
    data?: { codeDiscountNodeByCode?: { id?: string; codeDiscount?: { asyncUsageCount?: number } | null } | null };
    errors?: unknown;
  };
  if (lookupJson.errors) return { refunded: false, reason: 'shopify_error' };
  const node = lookupJson.data?.codeDiscountNodeByCode ?? null;

  if (node) {
    if ((node.codeDiscount?.asyncUsageCount ?? 0) > 0) {
      // 使用済み（正常利用）→ 返金しない
      return { refunded: false, reason: 'used' };
    }
    // 未使用で存在 → コードを削除して再利用を防ぐ
    if (node.id) {
      const delRes = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation($id:ID!){ discountCodeDelete(id:$id){ deletedCodeDiscountId userErrors{ field message } } }`,
          variables: { id: node.id },
        }),
      });
      if (!delRes.ok) return { refunded: false, reason: 'shopify_error' };
      const delJson = (await delRes.json()) as {
        data?: { discountCodeDelete?: { userErrors?: { message: string }[] } };
        errors?: unknown;
      };
      const userErrors = delJson.data?.discountCodeDelete?.userErrors ?? [];
      if (delJson.errors || userErrors.length > 0) {
        // 削除失敗 → 「使えるコードのまま返金」事故を避けるため返金しない（次回再試行）
        return { refunded: false, reason: 'shopify_error' };
      }
    }
  }
  // node が null（=Shopify 上に存在しない=使えない）場合も DB 側の返還は続行する（安全）

  // 返還対象の redeem を特定（[取り消し済み] は除外 = 二重返還防止）
  const latestRedeem = await db
    .prepare(
      `SELECT reason FROM loyalty_transactions
       WHERE friend_id = ? AND type = 'redeem' AND reason LIKE ? AND reason NOT LIKE '[取り消し済み]%'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(point.friend_id, `%コード: ${normalizedCode}%`)
    .first<{ reason: string }>();
  if (!latestRedeem) return { refunded: false, reason: 'no_redeem' };

  // 返還ポイント数を reason から逆算
  const m = latestRedeem.reason?.match(/¥(\d+)割引/);
  const refundPoints = m ? parseInt(m[1], 10) : 0;
  if (refundPoints <= 0) return { refunded: false, reason: 'amount_unknown' };

  // 内訳タグ [内訳:limited=N,balance=N,exp=...] から消費内訳を復元
  // （タグの無い旧データは「全額 balance に返還」で後方互換）
  const breakdownMatch = latestRedeem.reason?.match(/\[内訳:limited=(\d+),balance=(\d+),exp=([^\]]+)\]/);
  let refundLimited = 0;
  let refundBalance = refundPoints;
  let restoreExpiresAt: string | null = null;
  if (breakdownMatch) {
    refundLimited = parseInt(breakdownMatch[1], 10);
    refundBalance = parseInt(breakdownMatch[2], 10);
    restoreExpiresAt = breakdownMatch[3] === 'none' ? null : breakdownMatch[3];
  }

  // 残高を返還（redeem の逆順: 元 limited 分は limited に / 元 balance 分は balance に）
  const newBalance = point.balance + refundBalance;
  const newLimitedBalance = (point.limited_balance ?? 0) + refundLimited;
  let limitedExpiresAt: string | null = point.limited_expires_at ?? null;
  if (refundLimited > 0) {
    if (!limitedExpiresAt && restoreExpiresAt) {
      limitedExpiresAt = restoreExpiresAt;
    } else if (limitedExpiresAt && restoreExpiresAt) {
      // 両方ある場合はより早い期限を優先（安全側）
      limitedExpiresAt = new Date(limitedExpiresAt) < new Date(restoreExpiresAt) ? limitedExpiresAt : restoreExpiresAt;
    }
  }
  const newRank = determineRank(point.total_spent);
  await upsertLoyaltyPoint(db, point.friend_id, {
    balance: newBalance,
    limitedBalance: newLimitedBalance,
    limitedExpiresAt: newLimitedBalance > 0 ? limitedExpiresAt : null,
    totalSpent: point.total_spent,
    rank: newRank,
    shopifyCustomerId,
  });

  // 返還の経緯を履歴に残す。
  // この reason はそのまま顧客のマイページ「ポイント履歴」に表示されるため、
  // 「なぜポイントが戻ったのか」が顧客に伝わる平易な文言にする。
  //  - manual            : 顧客自身がマイページでコードを取り消した
  //  - order_paid / cron : システム側が自動で返還した（＝発行時減算の不具合補填）
  // ※ 元の利用(redeem)行は下で [取り消し済み] になり、マイページでは打ち消し線表示になる。
  const customerReason =
    source === 'manual'
      ? `割引コードの取り消しにより、未使用のポイントを返還しました（コード: ${normalizedCode}）`
      : `未使用の割引コード分のポイントをお戻ししました（コード: ${normalizedCode}）`;
  await addLoyaltyTransaction(db, {
    friendId: point.friend_id,
    type: 'adjust',
    points: refundPoints,
    balanceAfter: newBalance + newLimitedBalance,
    reason: customerReason,
  });

  // 元の redeem を「取り消し済み」にマーク（二重返還防止・pending_code もこれで解消）
  await db
    .prepare(
      `UPDATE loyalty_transactions SET reason = '[取り消し済み] ' || reason
       WHERE friend_id = ? AND type = 'redeem' AND reason LIKE ? AND reason NOT LIKE '[取り消し済み]%'`,
    )
    .bind(point.friend_id, `%コード: ${normalizedCode}%`)
    .run();

  return { refunded: true, refundPoints, balance: newBalance, rank: newRank, reason: 'ok' };
}

/**
 * 顧客の「未使用の保留コード」を1件返す（無ければ null）。
 * = 最新の、取り消されていない redeem の reason からコードを抽出。
 * （注: 使用済みでも redeem は残るため、実際の未使用判定は refundUnusedPointCode の
 *   Shopify usage_count チェックに委ねる）
 */
export async function findPendingCodeByFriendId(
  db: D1Database,
  friendId: string,
): Promise<string | null> {
  const latest = await db
    .prepare(
      `SELECT reason FROM loyalty_transactions
       WHERE friend_id = ? AND type = 'redeem'
         AND reason NOT LIKE '[取り消し済み]%' AND reason NOT LIKE '[利用済み]%'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(friendId)
    .first<{ reason: string }>();
  const match = latest?.reason?.match(/コード: ([A-Z0-9-]+)/);
  return match ? match[1] : null;
}
