/**
 * eGift受贈者の初回購入アトリビューション（KGI B）
 *
 * Shopify注文の取り込み完了時に呼ばれる。受贈者と注文を突合し、
 * egift_recipient_purchases に1ギフト1件だけ記録する。
 *
 * 判定ルール（設計書 §5.4 / §3.1）:
 * - 引換済み（redeemed / fulfilled）のギフトだけを対象にする
 * - 引換日より前の注文は対象外
 * - 0円注文（ギフトそのもの・100%OFFクーポン利用）は購入とみなさない
 * - アフィリエイト成果がある注文は excluded_affiliate（KGIに計上しない）
 * - それ以前に注文歴がある受贈者は excluded_existing_customer（KGIに計上しない）
 * - 1つのギフトにつき最初に突合した注文だけを記録する（以後の注文は無視）
 *
 * 例外は握りつぶす。注文取り込みを止める方が損失が大きいため。
 */

import { recordEgiftEvent, recordRecipientPurchase } from '@line-crm/db';

export interface EgiftAttributionInput {
  shopifyOrderId: string;
  shopifyCustomerId: string | null;
  friendId: string | null;
  email: string | null;
  orderTotal: number;
  purchasedAt: string;
  cancelledAt?: string | null;
}

export interface EgiftAttributionResult {
  attributed: boolean;
  giftId?: string;
  status?: string;
  reason?: string;
}

interface CandidateGift {
  id: string;
  recipient_friend_id: string | null;
  recipient_email: string | null;
  redeemed_at: string;
}

/**
 * 注文1件をeGift受贈者の購入として評価する。戻り値はログ用途。
 */
export async function attributeEgiftPurchase(
  db: D1Database,
  input: EgiftAttributionInput,
): Promise<EgiftAttributionResult> {
  try {
    if (input.cancelledAt) return { attributed: false, reason: 'cancelled_order' };
    if (!(input.orderTotal > 0)) return { attributed: false, reason: 'zero_amount_order' };

    const gift = await db
      .prepare(
        `SELECT g.id, g.recipient_friend_id, g.recipient_email, g.redeemed_at
         FROM egift_gifts g
         WHERE g.status IN ('redeemed', 'fulfilled')
           AND g.attributed_order_id IS NULL
           AND g.redeemed_at IS NOT NULL
           AND g.redeemed_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM egift_recipient_purchases p WHERE p.gift_id = g.id
           )
           AND (
             (g.recipient_friend_id IS NOT NULL AND ? IS NOT NULL AND g.recipient_friend_id = ?)
             OR (g.recipient_email IS NOT NULL AND ? IS NOT NULL
                 AND lower(trim(g.recipient_email)) = lower(trim(?)))
           )
         ORDER BY g.redeemed_at DESC
         LIMIT 1`,
      )
      .bind(
        input.purchasedAt,
        input.friendId,
        input.friendId,
        input.email,
        input.email,
      )
      .first<CandidateGift>();

    if (!gift) return { attributed: false, reason: 'no_matching_gift' };

    // アフィリエイト成果が付いている注文はeGiftのKGIに計上しない（二重成果の防止）
    const affiliate = await db
      .prepare(`SELECT 1 FROM affiliate_program_orders WHERE shopify_order_id = ? LIMIT 1`)
      .bind(input.shopifyOrderId)
      .first();

    // この注文より前に購入歴があれば「初回購入」ではない
    const priorOrder = input.shopifyCustomerId || input.email
      ? await db
          .prepare(
            `SELECT 1 FROM shopify_orders
             WHERE shopify_order_id <> ?
               AND cancelled_at IS NULL
               AND processed_at < ?
               AND (
                 (shopify_customer_id IS NOT NULL AND ? IS NOT NULL AND shopify_customer_id = ?)
                 OR (email IS NOT NULL AND ? IS NOT NULL AND lower(email) = lower(?))
               )
             LIMIT 1`,
          )
          .bind(
            input.shopifyOrderId,
            input.purchasedAt,
            input.shopifyCustomerId,
            input.shopifyCustomerId,
            input.email,
            input.email,
          )
          .first()
      : null;

    const attributionStatus = affiliate
      ? 'excluded_affiliate'
      : priorOrder
        ? 'excluded_existing_customer'
        : 'eligible';

    await recordRecipientPurchase(db, {
      giftId: gift.id,
      recipientFriendId: gift.recipient_friend_id,
      shopifyOrderId: input.shopifyOrderId,
      shopifyCustomerId: input.shopifyCustomerId,
      isFirstOrder: !priorOrder,
      orderTotal: input.orderTotal,
      attributionStatus,
      purchasedAt: input.purchasedAt,
    });

    if (attributionStatus === 'eligible') {
      await db
        .prepare(`UPDATE egift_gifts SET attributed_order_id = ?, updated_at = ? WHERE id = ?`)
        .bind(input.shopifyOrderId, new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString(), gift.id)
        .run();
      await recordEgiftEvent(db, gift.id, 'first_purchase', gift.recipient_friend_id, JSON.stringify({
        shopifyOrderId: input.shopifyOrderId,
        orderTotal: input.orderTotal,
      }));
    }

    return { attributed: true, giftId: gift.id, status: attributionStatus };
  } catch (error) {
    console.error('[egift] attribution failed:', error);
    return { attributed: false, reason: 'error' };
  }
}
