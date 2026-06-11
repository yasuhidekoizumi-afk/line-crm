import {
  getLoyaltyPoint,
  getLoyaltyPointByShopifyCustomerId,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  determineRank,
  upsertFriend,
  getLoyaltySetting,
  type LoyaltyRank,
} from '@line-crm/db';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

// ────────────────────────────────────────────────────────────────────
// SocialPLUS(旧CRM PLUS)連携 × 自社ポイント未登録 の救済
//
// 背景:
//   id-connect-line ページが旧CRM PLUS(SocialPLUS)のままのため、そこでLINE連携した
//   顧客は Shopify に socialplus.line メタフィールドが書かれるだけで、自社ポイントに
//   登録されない（=連携300pt・誕生日100pt・購入ポイントが付かない。小川様型の被害）。
//   ページを自社版に切り替えるまでの間（CRM PLUS解約日まで・配信セグメントの都合で
//   旧ページを維持する判断・2026-06-11河原さん決定）、この救済を日次cronで自動実行する。
//
// 方針（2026-06-11 確定）:
//   - 全員: 自社ポイントへ紐付け（今後の購入ポイントが貯まるように）
//   - ボーナス(連携300+誕生日100): 顧客作成日が bonusSince(既定2026-04-15=移管日)以降の人だけ
//     （それ以前の人は旧システム時代に受け取っている可能性があり二重付与を避ける）
//   - 誕生日100は facts.birth_date メタフィールドがある人だけ（=登録を試みてエラーになった人）
//   - 冪等: 既に口座がある人には何もしない/紐付けのみ。LINE通知なし。
// ────────────────────────────────────────────────────────────────────

export interface SpRescueEnv {
  DB: D1Database;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
}

export interface SpRescueResult {
  scid: string;
  action:
    | 'already_linked'           // 既に自社連携済み → 何もしない
    | 'no_socialplus_line'       // SocialPLUS連携の痕跡なし → 対象外
    | 'linked_only_existing_row' // LINE側に既存口座あり → 紐付けのみ(ボーナスなし)
    | 'linked_no_bonus'          // 新規紐付け・ボーナス対象外(bonusSinceより古い顧客)
    | 'rescued'                  // 新規紐付け＋ボーナス付与
    | 'error';
  friendId?: string;
  lineUid?: string;
  lineBonus?: number;
  birthdayBonus?: number;
  awarded?: number;
  birthDate?: string | null;
  createdAt?: string | null;
  balance?: number;
  step?: string;   // error時: どの書き込みで失敗したか
  error?: string;
}

/** 1顧客を救済する（冪等・通知なし）。route と cron の両方からこれを呼ぶ。 */
export async function rescueSocialplusCustomer(
  env: SpRescueEnv,
  scid: string,
  opts: { bonusSince?: string } = {},
): Promise<SpRescueResult> {
  let step = 'init';
  try {
    const bonusSince = (opts.bonusSince ?? '').trim();

    // 冪等①: 既に自社連携済みなら何もしない（二重付与防止）
    const existing = await getLoyaltyPointByShopifyCustomerId(env.DB, scid);
    if (existing) {
      return { scid, action: 'already_linked', friendId: existing.friend_id, balance: existing.balance };
    }

    const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = await getShopifyAdminToken(env);
    if (!shopDomain || !adminToken) return { scid, action: 'error', error: 'Shopify 設定が未構成です' };

    // Shopify顧客の socialplus.line(LINE UID)・誕生日・表示名・作成日を取得
    step = 'shopify-fetch';
    const gqlRes = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($id:ID!){ customer(id:$id){ displayName createdAt line: metafield(namespace:"socialplus", key:"line"){ value } bday: metafield(namespace:"facts", key:"birth_date"){ value } } }`,
        variables: { id: `gid://shopify/Customer/${scid}` },
      }),
    });
    if (!gqlRes.ok) return { scid, action: 'error', step, error: `Shopify ${gqlRes.status}` };
    const gj = (await gqlRes.json()) as {
      data?: { customer?: { displayName?: string | null; createdAt?: string | null; line?: { value?: string } | null; bday?: { value?: string } | null } | null };
      errors?: unknown;
    };
    if (gj.errors) return { scid, action: 'error', step, error: 'Shopify GraphQL error' };
    const lineUid = (gj.data?.customer?.line?.value ?? '').trim();
    const birthDate = (gj.data?.customer?.bday?.value ?? '').trim();
    const displayName = (gj.data?.customer?.displayName ?? '').trim() || null;
    const createdAt = (gj.data?.customer?.createdAt ?? '').trim();
    if (!lineUid) {
      return { scid, action: 'no_socialplus_line' };
    }

    // friends 行を取得/作成（loyalty_points.friend_id は friends.id(UUID) を参照するため必須）
    step = 'upsertFriend';
    const friend = await upsertFriend(env.DB, { lineUserId: lineUid, displayName });
    const friendId = friend.id;

    // 冪等②: この friend に既に口座がある場合は「紐付けのみ」（ボーナスなし=二重防止）
    const byFriend = await getLoyaltyPoint(env.DB, friendId);
    if (byFriend) {
      step = 'upsertLoyaltyPoint(relink)';
      await upsertLoyaltyPoint(env.DB, friendId, {
        balance: byFriend.balance,
        totalSpent: byFriend.total_spent ?? 0,
        rank: (byFriend.rank as LoyaltyRank) ?? determineRank(byFriend.total_spent ?? 0),
        shopifyCustomerId: scid,
      });
      return { scid, friendId, lineUid, action: 'linked_only_existing_row' };
    }

    // bonusSince 指定時: 顧客作成日がそれ以降の人だけボーナス（ISO文字列比較）
    const bonusEligible = !bonusSince || (!!createdAt && createdAt >= `${bonusSince}T00:00:00Z`);
    const lineBonus = bonusEligible ? 300 : 0;
    const birthdayBonus = bonusEligible && birthDate ? 100 : 0;

    if (lineBonus === 0) {
      // 紐付けのみ（移管前から連携していたと推定。今後の購入ポイントはこれで貯まる）
      step = 'upsertLoyaltyPoint(linkOnly)';
      await upsertLoyaltyPoint(env.DB, friendId, {
        balance: 0, totalSpent: 0, rank: determineRank(0), shopifyCustomerId: scid,
      });
      return { scid, friendId, lineUid, action: 'linked_no_bonus', createdAt: createdAt || null };
    }

    // ① LINE連携ボーナス
    step = 'upsertLoyaltyPoint(line)';
    await upsertLoyaltyPoint(env.DB, friendId, {
      balance: lineBonus, totalSpent: 0, rank: determineRank(0), shopifyCustomerId: scid,
    });
    step = 'addLoyaltyTransaction(line)';
    await addLoyaltyTransaction(env.DB, {
      friendId, type: 'award', points: lineBonus, balanceAfter: lineBonus,
      reason: 'LINE連携ボーナス: +300pt', expiryDays: 0,
    });

    // ② 誕生日登録ボーナス（誕生日メタフィールドがある=登録を試みた人だけ）
    if (birthdayBonus > 0) {
      const newBalance = lineBonus + birthdayBonus;
      step = 'upsertLoyaltyPoint(bday)';
      await upsertLoyaltyPoint(env.DB, friendId, {
        balance: newBalance, totalSpent: 0, rank: determineRank(0), shopifyCustomerId: scid,
      });
      step = 'addLoyaltyTransaction(bday)';
      await addLoyaltyTransaction(env.DB, {
        friendId, type: 'award', points: birthdayBonus, balanceAfter: newBalance,
        reason: '誕生日登録ボーナス: +100pt', expiryDays: 0,
      });
    }

    return {
      scid, friendId, lineUid, action: 'rescued',
      lineBonus, birthdayBonus, awarded: lineBonus + birthdayBonus,
      birthDate: birthDate || null, createdAt: createdAt || null,
    };
  } catch (e) {
    return { scid, action: 'error', step, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SpSweepResult {
  enabled: boolean;
  scanned: number;        // 走査した「最近更新された顧客」数
  withSocialplus: number; // うち SocialPLUS 連携あり
  affected: number;       // うち自社未登録（=救済対象）
  rescued: number;        // 紐付け＋ボーナス付与
  linkedOnly: number;     // 紐付けのみ
  awardedPoints: number;
  errors: number;
  errorSamples: string[];
  hitPageCap: boolean;    // 走査上限に達した（次回の実行で続きを拾う）
}

const SWEEP_PAGE_SIZE = 250;
const SWEEP_MAX_PAGES = 4; // 1回あたり最大1000人走査（サブリクエスト節約）

/**
 * 「最近更新された顧客」を走査して小川様型の被害を自動救済する（日次cron用）。
 *   連携すると socialplus.line メタフィールドが書かれ顧客の updated_at が進むため、
 *   直近 sinceHours の更新分だけ見れば新規被害を確実に拾える（全件走査不要）。
 *   設定 loyalty_settings.socialplus_auto_rescue_enabled='1' のときだけ動作（既定OFF）。
 */
export async function sweepSocialplusUnlinked(
  env: SpRescueEnv,
  opts: { force?: boolean; sinceHours?: number; limit?: number; bonusSince?: string } = {},
): Promise<SpSweepResult> {
  const result: SpSweepResult = {
    enabled: false, scanned: 0, withSocialplus: 0, affected: 0,
    rescued: 0, linkedOnly: 0, awardedPoints: 0, errors: 0, errorSamples: [], hitPageCap: false,
  };

  const enabled = await getLoyaltySetting(env.DB, 'socialplus_auto_rescue_enabled').catch(() => null);
  if (!opts.force && enabled !== '1') return result;
  result.enabled = true;

  const sinceHours = Math.min(Math.max(opts.sinceHours ?? 48, 1), 24 * 14);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100); // 救済実行の上限/回
  const bonusSince = opts.bonusSince ?? '2026-04-15';
  // 検索は日付粒度で十分（日次実行×48時間窓で重複カバー・冪等なので二重処理は無害）
  const sinceDate = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString().slice(0, 10);

  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) throw new Error('Shopify credentials not configured');

  const QUERY = `query($cursor:String, $q:String!){ customers(first:${SWEEP_PAGE_SIZE}, after:$cursor, query:$q){ nodes{ legacyResourceId line: metafield(namespace:"socialplus", key:"line"){ value } } pageInfo{ hasNextPage endCursor } } }`;

  let cursor: string | null = null;
  let pages = 0;
  let hasMore = true;

  while (hasMore) {
    if (pages >= SWEEP_MAX_PAGES) { result.hitPageCap = true; break; }
    const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { cursor, q: `updated_at:>=${sinceDate}` } }),
    });
    if (!res.ok) {
      result.errors++;
      if (result.errorSamples.length < 5) result.errorSamples.push(`scan: Shopify ${res.status}`);
      break;
    }
    pages++;
    const j = (await res.json()) as {
      data?: { customers?: { nodes?: Array<{ legacyResourceId?: string; line?: { value?: string } | null }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
      errors?: unknown;
    };
    if (j.errors) {
      result.errors++;
      if (result.errorSamples.length < 5) result.errorSamples.push(`scan: GraphQL errors`);
      break;
    }
    const conn = j.data?.customers;
    for (const n of conn?.nodes ?? []) {
      result.scanned++;
      const sp = (n.line?.value ?? '').trim();
      if (!sp) continue;
      result.withSocialplus++;
      const scid = String(n.legacyResourceId ?? '');
      if (!scid) continue;
      const lp = await getLoyaltyPointByShopifyCustomerId(env.DB, scid).catch(() => null);
      if (lp) continue; // 連携済み
      result.affected++;
      if (result.rescued + result.linkedOnly + result.errors >= limit) continue; // 上限到達後は数えるだけ

      const r = await rescueSocialplusCustomer(env, scid, { bonusSince });
      if (r.action === 'rescued') {
        result.rescued++;
        result.awardedPoints += r.awarded ?? 0;
      } else if (r.action === 'linked_no_bonus' || r.action === 'linked_only_existing_row') {
        result.linkedOnly++;
      } else if (r.action === 'error') {
        result.errors++;
        if (result.errorSamples.length < 5) result.errorSamples.push(`${scid}: [${r.step}] ${r.error}`);
      }
      // already_linked / no_socialplus_line はカウント外（冪等スキップ）
    }
    hasMore = !!conn?.pageInfo?.hasNextPage;
    cursor = conn?.pageInfo?.endCursor ?? null;
  }

  if (result.affected > 0 || result.errors > 0) {
    console.log(
      `[socialplus-rescue] scanned=${result.scanned} sp=${result.withSocialplus} affected=${result.affected} rescued=${result.rescued}(+${result.awardedPoints}pt) linkedOnly=${result.linkedOnly} errors=${result.errors}`,
    );
  }
  return result;
}
