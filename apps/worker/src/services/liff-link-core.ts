import type { Env } from '../index.js';

/**
 * LIFFからのLINE↔Shopify連携の「中核ロジック」共有部品。
 *
 * これは /api/liff/link-shopify（Shopifyログイン=cid起点）と、今後追加する
 * 「メール起点の連携」の両方から呼ばれる “1つの正解”。
 * お金（特典付与）に直結するため、二重付与防止のガード（自社履歴＋SocialPLUS）を
 * 必ずここ1か所に集約する。コピペで2つに増やさない（片方だけ直して二重付与=事故の温床）。
 *
 * 前提: 呼び出し側で LINE本人確認（accessToken/idToken検証）と friend 解決を済ませること。
 * また shopifyCustomerId が「その本人のもの」であることも呼び出し側が担保する
 * （cid起点=Shopifyログイン済み / メール起点=メール確認コードで本人確認）。
 *
 * 戻り値:
 *   - 別のLINEに既に紐付いている場合 → { ok:false, status:409, error }
 *   - それ以外 → { ok:true, data }（旧エンドポイントの data と完全に同じ形）
 */
export interface LinkAndRewardData {
  bonusAwarded: number;
  promoPointsAwarded: number;
  backfilledOrders: number;
  backfilledPoints: number;
  /** 送料無料クーポン（link_reward_type='free_shipping' のときのみ値が入る） */
  couponCode: string | null;
  couponExpiresAt: string | null;
  /** クライアントUIで「すでに連携済みです」を出すための判定材料 */
  alreadyLinked: boolean;
  alreadyLinkedSource: 'crm_plus' | 'self' | null;
}

export type LinkAndRewardResult =
  | { ok: true; data: LinkAndRewardData }
  | { ok: false; status: 409; error: string };

export async function linkShopifyAndReward(
  env: Env['Bindings'],
  friend: { id: string },
  shopifyCustomerId: string,
  opts: { lineUserId: string | null; promoCode?: string },
): Promise<LinkAndRewardResult> {
  const lineUserId = opts.lineUserId;
  const {
    getLoyaltyPoint,
    getLoyaltyPointByShopifyCustomerId,
    getLoyaltySetting,
    upsertLoyaltyPoint,
    addLoyaltyTransaction,
  } = await import('@line-crm/db');
  const { backfillPendingOrders } = await import('./loyalty-backfill.js');

  // 他の友だちが既にこのShopify顧客と紐付いていないかチェック
  const existing = await getLoyaltyPointByShopifyCustomerId(env.DB, shopifyCustomerId);
  if (existing && existing.friend_id !== friend.id) {
    // sp_ プレフィックスは Shopify webhook が先行で作成したプレースホルダー友だち。
    // 実 LINE 連携時は当該データを本 friend に合流させる。
    if (existing.friend_id.startsWith('sp_')) {
      const spFriendId = existing.friend_id;
      const realLoyalty = await getLoyaltyPoint(env.DB, friend.id);

      // トランザクションをすべて本 friend に付け替え
      await env.DB
        .prepare(`UPDATE loyalty_transactions SET friend_id = ? WHERE friend_id = ?`)
        .bind(friend.id, spFriendId)
        .run();

      if (realLoyalty) {
        // 両方に loyalty_points 行あり → 本 friend 側にマージして sp_ 側は削除
        const mergedBalance = (realLoyalty.balance ?? 0) + (existing.balance ?? 0);
        const mergedLimitedBalance = (realLoyalty.limited_balance ?? 0) + (existing.limited_balance ?? 0);
        const mergedTotalSpent = (realLoyalty.total_spent ?? 0) + (existing.total_spent ?? 0);
        const rankOrder = ['レギュラー', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド'];
        const higherRank =
          rankOrder.indexOf(existing.rank ?? 'レギュラー') > rankOrder.indexOf(realLoyalty.rank ?? 'レギュラー')
            ? (existing.rank ?? 'レギュラー')
            : (realLoyalty.rank ?? 'レギュラー');
        // 期限はより早い方を採用（安全側）。片方 null の場合は他方を採用
        let mergedLimitedExpiresAt: string | null = null;
        if (mergedLimitedBalance > 0) {
          const realExp = realLoyalty.limited_expires_at;
          const spExp = existing.limited_expires_at;
          if (realExp && spExp) {
            mergedLimitedExpiresAt = new Date(realExp) < new Date(spExp) ? realExp : spExp;
          } else {
            mergedLimitedExpiresAt = realExp ?? spExp ?? null;
          }
        }
        await upsertLoyaltyPoint(env.DB, friend.id, {
          balance: mergedBalance,
          limitedBalance: mergedLimitedBalance,
          limitedExpiresAt: mergedLimitedExpiresAt,
          totalSpent: mergedTotalSpent,
          rank: higherRank,
          shopifyCustomerId,
        });
        await env.DB
          .prepare(`DELETE FROM loyalty_points WHERE friend_id = ?`)
          .bind(spFriendId)
          .run();
      } else {
        // 本 friend 側に loyalty_points が無い → sp_ 行の friend_id を付け替え
        await env.DB
          .prepare(`UPDATE loyalty_points SET friend_id = ? WHERE friend_id = ?`)
          .bind(friend.id, spFriendId)
          .run();
      }

      // sp_ プレースホルダー friend を削除（残るCASCADE対象は webhook 由来で発生し得ないため安全）
      await env.DB
        .prepare(`DELETE FROM friends WHERE id = ?`)
        .bind(spFriendId)
        .run();

      console.log(`[link-shopify] Merged placeholder ${spFriendId} into ${friend.id}`);
    } else {
      return {
        ok: false,
        status: 409,
        error: 'この Shopify 顧客は既に別のLINEアカウントに紐付いています',
      };
    }
  }

  // 紐付け
  const current = await getLoyaltyPoint(env.DB, friend.id);
  await upsertLoyaltyPoint(env.DB, friend.id, {
    balance: current?.balance ?? 0,
    totalSpent: current?.total_spent ?? 0,
    rank: current?.rank ?? 'レギュラー',
    shopifyCustomerId,
  });

  // LINE連携特典（friend_id単位で1回のみ）
  // link_reward_type 設定で出し分け:
  //   'points'（既定）   → ポイント付与（従来どおり300pt）
  //   'free_shipping'    → 送料無料クーポン発行（2026-06-19 切替予定・6/22新LP対応）
  // 切替方法: PUT /api/loyalty/settings/link_reward_type  value='free_shipping'
  const bonusEnabledSetting = await getLoyaltySetting(env.DB, 'link_bonus_enabled').catch(() => null);
  const bonusPointsSetting = await getLoyaltySetting(env.DB, 'link_bonus_points').catch(() => null);
  const rewardTypeSetting = await getLoyaltySetting(env.DB, 'link_reward_type').catch(() => null);
  const couponExpirySetting = await getLoyaltySetting(env.DB, 'link_coupon_expiry_days').catch(() => null);
  const bonusEnabled = (bonusEnabledSetting ?? '1') === '1';
  const bonusPoints = parseInt(bonusPointsSetting ?? '300', 10) || 300;
  const rewardType = rewardTypeSetting === 'free_shipping' ? 'free_shipping' : 'points';
  const couponExpiryDays = parseInt(couponExpirySetting ?? '30', 10) || 30;

  let bonusAwarded = 0;
  let couponCode: string | null = null;
  let couponExpiresAt: string | null = null;
  // UI で「すでに連携済みです」を出し分けるためのフラグ
  let alreadyLinkedSelf = false;
  let alreadyLinkedViaSocialPlus = false;
  if (bonusEnabled && (bonusPoints > 0 || rewardType === 'free_shipping')) {
    // ① 自社DB上で既に特典受領済みかチェック（300pt・クーポンどちらの履歴でも対象。
    //    同じLINEで再連携しても二重には貰えない）
    const existingBonus = await env.DB
      .prepare(`SELECT 1 FROM loyalty_transactions WHERE friend_id = ? AND (reason = 'LINE連携ボーナス' OR reason LIKE 'LINE連携特典クーポン%') LIMIT 1`)
      .bind(friend.id)
      .first();
    if (existingBonus) alreadyLinkedSelf = true;

    // ② CRM Plus(SocialPLUS)時代に既に連携済みの顧客かチェック
    //    Shopify Customer メタフィールド socialplus.line が入っていれば
    //    CRM Plus 経由で既に連携済み → 特典付与スキップ（自社版への移行二重取り防止）
    const { isAlreadyLinkedViaSocialPlus } = await import('../utils/socialplus-check.js');
    const socialPlusCheck = await isAlreadyLinkedViaSocialPlus(env, shopifyCustomerId);
    if (socialPlusCheck.linked) {
      alreadyLinkedViaSocialPlus = true;
      console.log(`[link-shopify] bonus skipped — SocialPLUS link present`, {
        shopifyCustomerId,
        friendId: friend.id,
        lineUserId: socialPlusCheck.lineUserId,
      });
    }

    if (!existingBonus && !socialPlusCheck.linked) {
      if (rewardType === 'free_shipping') {
        // 送料無料クーポンを発行（ポイント残高は変えない）
        const { issueFreeShippingCoupon } = await import('./link-reward-coupon.js');
        const issued = await issueFreeShippingCoupon(env, shopifyCustomerId, couponExpiryDays);
        if (issued.ok) {
          couponCode = issued.code;
          couponExpiresAt = issued.endsAt;
          // 受領記録（points=0）。再連携時の重複防止ガード（上の existingBonus 判定）に使う。
          const cur = await getLoyaltyPoint(env.DB, friend.id);
          await addLoyaltyTransaction(env.DB, {
            friendId: friend.id,
            type: 'adjust',
            points: 0,
            balanceAfter: (cur?.balance ?? 0) + (cur?.limited_balance ?? 0),
            reason: `LINE連携特典クーポン: ${couponCode}`,
          });
        } else {
          // クーポン発行失敗は連携自体を失敗にしない（連携体験優先）。ログで追跡。
          console.error('[link-shopify] 送料無料クーポン発行失敗:', issued.error);
        }
      } else {
        // LINE連携ボーナスは通常ポイント（balance、無期限）として付与
        // limited_balance / limited_expires_at は触らない（PR #112 で未指定なら既存値保持）
        const beforeBonus = await getLoyaltyPoint(env.DB, friend.id);
        const newBalance = (beforeBonus?.balance ?? 0) + bonusPoints;
        await upsertLoyaltyPoint(env.DB, friend.id, {
          balance: newBalance,
          totalSpent: beforeBonus?.total_spent ?? 0,
          rank: beforeBonus?.rank ?? 'レギュラー',
          shopifyCustomerId,
        });
        const totalAfter = newBalance + (beforeBonus?.limited_balance ?? 0);
        await addLoyaltyTransaction(env.DB, {
          friendId: friend.id,
          type: 'adjust',
          points: bonusPoints,
          balanceAfter: totalAfter,
          reason: 'LINE連携ボーナス',
        });
        bonusAwarded = bonusPoints;
      }
    }
  }

  // プロモコードボーナス（link-shopify完了時に同時付与）
  let promoPointsAwarded = 0;
  if (opts.promoCode) {
    const promoCodes: Record<string, { points: number; reason: string }> = {
      CARD88: { points: 88, reason: '同梱カードボーナス CARD88' },
    };
    const promo = promoCodes[opts.promoCode.trim().toUpperCase()];
    if (promo) {
      const alreadyPromo = await env.DB
        .prepare(`SELECT id FROM loyalty_transactions WHERE friend_id = ? AND reason = ? LIMIT 1`)
        .bind(friend.id, promo.reason)
        .first();
      if (!alreadyPromo) {
        const afterBonus = await getLoyaltyPoint(env.DB, friend.id);
        const promoBalance = (afterBonus?.balance ?? 0) + promo.points;
        await upsertLoyaltyPoint(env.DB, friend.id, {
          balance: promoBalance,
          totalSpent: afterBonus?.total_spent ?? 0,
          rank: afterBonus?.rank ?? 'レギュラー',
          shopifyCustomerId,
        });
        await addLoyaltyTransaction(env.DB, {
          friendId: friend.id,
          type: 'adjust',
          points: promo.points,
          balanceAfter: promoBalance + (afterBonus?.limited_balance ?? 0),
          reason: promo.reason,
        });
        promoPointsAwarded = promo.points;
      }
    }
  }

  // 保留注文バックフィル
  const backfill = await backfillPendingOrders(env.DB, friend.id, shopifyCustomerId);

  // LINEプッシュ通知（連携完了＋ポイント付与orクーポン、ノンブロッキング）
  try {
    const totalAwarded = bonusAwarded + promoPointsAwarded + backfill.totalPointsAwarded;
    if (totalAwarded > 0 || couponCode) {
      const { LineClient } = await import('@line-crm/line-sdk');
      const accountRow = await env.DB
        .prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<{ channel_access_token: string }>();
      const accessToken = accountRow?.channel_access_token ?? env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accessToken && lineUserId) {
        const lineClient = new LineClient(accessToken);
        const lines: string[] = [];

        // ── 送料無料クーポン（link_reward_type='free_shipping' のとき）──
        if (couponCode) {
          const expDisp = couponExpiresAt
            ? new Date(couponExpiresAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' })
            : null;
          lines.push('🎁 LINE連携ありがとうございます！', '');
          lines.push(`送料無料クーポン：${couponCode}`);
          if (expDisp) lines.push(`有効期限：${expDisp}`);
          lines.push('', 'お会計画面のクーポンコード欄に入力すると送料が無料になります（1回限り）。');
        }

        // ── ポイント付与があった場合（従来どおりの内訳表示）──
        if (totalAwarded > 0) {
          const after = await getLoyaltyPoint(env.DB, friend.id);
          // 過去にクーポンへ変換済みの累計ポイント（type='redeem' の絶対値合計）
          // 「現在の残高」だけ見せると変換後の残高が表示されて減ったように見えるため
          // 併記して誤解を防止する。
          const redeemedRow = await env.DB
            .prepare(`SELECT COALESCE(ABS(SUM(points)), 0) AS used FROM loyalty_transactions WHERE friend_id = ? AND type = 'redeem'`)
            .bind(friend.id)
            .first<{ used: number }>();
          const couponConverted = redeemedRow?.used ?? 0;

          if (lines.length > 0) lines.push('');
          lines.push('🎉 ポイントを受け取りました！', '');
          if (bonusAwarded > 0) lines.push(`連携ボーナス：+${bonusAwarded}pt`);
          if (promoPointsAwarded > 0) lines.push(`カードボーナス：+${promoPointsAwarded}pt`);
          if (backfill.totalPointsAwarded > 0) lines.push(`過去購入ボーナス：+${backfill.totalPointsAwarded}pt`);
          lines.push('', `現在の残高：${after?.balance ?? 0}pt`);
          if (couponConverted > 0) lines.push(`クーポン変換済み：${couponConverted}pt`);
          lines.push('', 'ポイントは次回のお買い物でご利用いただけます。');
        }

        await lineClient.pushMessage(lineUserId, [{ type: 'text', text: lines.join('\n') }]);
      }
    }
  } catch (err) {
    console.error('link-shopify LINE notification error (non-blocking):', err);
  }

  return {
    ok: true,
    data: {
      bonusAwarded,
      promoPointsAwarded,
      backfilledOrders: backfill.processed,
      backfilledPoints: backfill.totalPointsAwarded,
      couponCode,
      couponExpiresAt,
      // alreadyLinked が true で特典なし（bonusAwarded===0 かつ couponCode なし）のとき
      // クライアント側で「既に連携済み」表示にする。
      alreadyLinked: alreadyLinkedSelf || alreadyLinkedViaSocialPlus,
      alreadyLinkedSource: alreadyLinkedViaSocialPlus ? 'crm_plus' : (alreadyLinkedSelf ? 'self' : null),
    },
  };
}
