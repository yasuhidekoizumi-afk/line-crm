import {
  getLoyaltySetting,
  getFriendById,
  getLineAccountById,
  getLoyaltyPointByShopifyCustomerId,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildMessage } from './step-delivery.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

// ────────────────────────────────────────────────────────────────────
// 誕生日クーポン自動配信
//   設計: docs/BIRTHDAY_TRIGGER_DESIGN.md / 文面: docs/BIRTHDAY_TRIGGER_MESSAGES_2026-06.md
//
//   仕様（確定）:
//     - 誕生日「当日」配信。直近注文額 <5,000円 → 送料無料 / ≥5,000円 → 500円OFF を出し分け。
//     - 有効期限 = 誕生日 +14日。年1回（同一顧客×同一年に二重発行/配信しない）。
//     - LINE連携後に誕生日登録した人へ Flex（お祝い画像＋クーポン）を配信。メール代替配信はしない。
//     - 文面ルール: 送料無料ラインには触れない（500円OFF側で5,300円カートを誘発しないため）。
//
//   ★安全モード（このファイルの肝）:
//     1. 緊急停止スイッチ: 設定 birthday_coupon_enabled='1' のときだけ稼働（既定0=停止）。
//     2. 予行演習(dryrun): 対象を数えてログ出力のみ。クーポン発行も送信も一切しない。
//     3. テスト(test): 実際の誕生日に関係なく、テスト送り先(河原さん)だけにクーポン発行＋LINE送信。
//        本番(live): 当日誕生日の全対象へ発行＋送信。
//
//   ※本番有効化(enabled=1)＋日次cron結線は小泉さんOK後（設計書の保護ゾーン）。
// ────────────────────────────────────────────────────────────────────

export interface BdayEnv {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_TOKEN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
}

const HERO_IMAGE = 'https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png';
const SHOP_URL = 'https://oryzae.shop';
const AMOUNT_THRESHOLD = 5000; // 直近注文額の境目（未満=送料無料 / 以上=500円OFF）
const EXPIRY_DAYS = 14;

type CouponType = 'free_shipping' | 'fixed_500';
type Mode = 'dryrun' | 'test' | 'live';

/** JSTの「今日」の年とMM-DD */
function jstToday(): { year: number; mmdd: string } {
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const mm = String(j.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(j.getUTCDate()).padStart(2, '0');
  return { year: j.getUTCFullYear(), mmdd: `${mm}-${dd}` };
}

/** 有効期限の表示用（YYYY/MM/DD） */
function formatJaDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${j.getUTCFullYear()}/${String(j.getUTCMonth() + 1).padStart(2, '0')}/${String(j.getUTCDate()).padStart(2, '0')}`;
}

/** クーポン発行（link-reward-coupon と同型の price_rules + discount_codes REST） */
async function issueBirthdayCoupon(
  env: BdayEnv,
  scid: string,
  type: CouponType,
  startsAt: Date,
  endsAt: Date,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) return { ok: false, error: 'Shopify 設定が未構成です' };

  const code = `BDAY-${scid.slice(-6)}-${Date.now().toString(36).toUpperCase()}`;
  const priceRule =
    type === 'free_shipping'
      ? {
          title: `誕生日 送料無料 ${code}`,
          target_type: 'shipping_line', target_selection: 'all', allocation_method: 'each',
          value_type: 'percentage', value: '-100.0',
        }
      : {
          title: `誕生日 500円OFF ${code}`,
          target_type: 'line_item', target_selection: 'all', allocation_method: 'across',
          value_type: 'fixed_amount', value: '-500.0',
        };

  const ruleRes = await fetch(`https://${shopDomain}/admin/api/2024-10/price_rules.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
    body: JSON.stringify({
      price_rule: {
        ...priceRule,
        customer_selection: 'prerequisite',
        prerequisite_customer_ids: [scid],
        once_per_customer: true,
        usage_limit: 1,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      },
    }),
  });
  if (!ruleRes.ok) {
    const e = await ruleRes.text().catch(() => '');
    return { ok: false, error: `price_rule ${ruleRes.status} ${e.slice(0, 150)}` };
  }
  const ruleData = (await ruleRes.json()) as { price_rule: { id: number } };

  const codeRes = await fetch(
    `https://${shopDomain}/admin/api/2024-10/price_rules/${ruleData.price_rule.id}/discount_codes.json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
      body: JSON.stringify({ discount_code: { code } }),
    },
  );
  if (!codeRes.ok) {
    const e = await codeRes.text().catch(() => '');
    return { ok: false, error: `discount_code ${codeRes.status} ${e.slice(0, 150)}` };
  }
  return { ok: true, code };
}

/** 誕生日Flex（docs/BIRTHDAY_TRIGGER_MESSAGES の実JSON。送料無料/500円OFFで文言差分） */
function buildBirthdayFlex(type: CouponType, name: string, code: string, expire: string) {
  const couponLabel = type === 'free_shipping' ? '🚚 送料無料クーポン' : '💰 500円OFFクーポン';
  const lead = type === 'free_shipping' ? 'オリゼからの誕生日プレゼント🎁' : 'いつものご愛顧に感謝を込めて🎁';
  return {
    type: 'bubble',
    hero: { type: 'image', url: HERO_IMAGE, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
      contents: [
        { type: 'text', text: `${name}さんへ`, weight: 'bold', size: 'md', color: '#5c4a2e' },
        { type: 'text', text: lead, size: 'sm', color: '#8a7a5c', wrap: true },
        {
          type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
          paddingAll: '14px', backgroundColor: '#FBF6EC', cornerRadius: '10px',
          contents: [
            { type: 'text', text: couponLabel, weight: 'bold', size: 'md', color: '#5c4a2e' },
            { type: 'text', text: 'クーポンコード', size: 'xs', color: '#8a7a5c', margin: 'sm' },
            { type: 'text', text: code, size: 'sm', weight: 'bold', color: '#5c4a2e', wrap: true },
            { type: 'text', text: `有効期限：${expire}まで`, size: 'xs', color: '#8a7a5c', margin: 'sm' },
          ],
        },
        { type: 'text', text: '発酵のようにゆっくり豊かに育ちますように🌾', size: 'xs', color: '#8a7a5c', wrap: true, margin: 'md' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        // 飛び先を /discount/<code> にすることでクーポンが自動適用される（コピー不要・チェックアウトで反映）
        { type: 'button', style: 'primary', color: '#C9A86A',
          action: { type: 'uri', label: 'クーポンを使ってお買い物', uri: `${SHOP_URL}/discount/${code}` } },
        { type: 'text', text: 'ボタンを押すとクーポンが自動で適用されます🎁', size: 'xxs', color: '#8a7a5c', wrap: true, align: 'center' },
      ],
    },
  };
}

/** 直近注文額（D1の shopify_orders から最新1件） */
async function recentOrderAmount(db: D1Database, scid: string): Promise<number> {
  const row = await db
    .prepare(`SELECT total_price FROM shopify_orders WHERE shopify_customer_id = ? ORDER BY processed_at DESC LIMIT 1`)
    .bind(scid)
    .first<{ total_price: number }>();
  return row ? Math.floor(row.total_price) : 0;
}

/** LINE連携済みの friend へ Flex を送る（送れたら true） */
async function sendLineFlex(
  env: BdayEnv, friendId: string, type: CouponType, name: string, code: string, expire: string,
): Promise<{ sent: boolean; error?: string }> {
  const friend = await getFriendById(env.DB, friendId);
  const lineUserId = friend?.line_user_id ?? '';
  if (!friend || !lineUserId.startsWith('U') || friend.is_following !== 1) {
    return { sent: false, error: 'no_line_user_or_unfollowed' };
  }
  let accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (friend.line_account_id) {
    const account = await getLineAccountById(env.DB, friend.line_account_id).catch(() => null);
    if (account) accessToken = account.channel_access_token;
  }
  const client = new LineClient(accessToken);
  const bubble = buildBirthdayFlex(type, name, code, expire);
  const altText = `${name}さん、お誕生日おめでとうございます🎂`;
  try {
    await client.pushMessage(lineUserId, [buildMessage('flex', JSON.stringify(bubble), altText)]);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface BdayRunResult {
  enabled: boolean;
  mode: Mode;
  todayMMDD: string;
  targets: number;          // 対象（誕生日一致・LINE連携済み）
  alreadyDone: number;      // 今年すでに発行済み（スキップ）
  freeShipping: number;     // 送料無料を発行/予定
  fixed500: number;         // 500円OFFを発行/予定
  issued: number;           // 実際にクーポン発行した数（dryrunは0）
  sent: number;             // 実際にLINE送信した数（dryrunは0）
  lineSent: number;
  errors: number;
  errorSamples: string[];
  sample: Array<{ scid: string; type: CouponType; recentAmount: number; code?: string }>;
}

interface TargetRow {
  shopify_customer_id: string;
  friend_id: string;
  display_name?: string | null;
}

/**
 * 誕生日クーポンの処理本体。3モード対応・冪等。
 *   opts.mode/force で手動上書き可（管理エンドポイント用）。未指定なら設定値に従う。
 */
export async function processBirthdayCoupons(
  env: BdayEnv,
  opts: { mode?: Mode; force?: boolean; todayMMDD?: string } = {},
): Promise<BdayRunResult> {
  const db = env.DB;
  const { year, mmdd } = jstToday();
  const todayMMDD = opts.todayMMDD ?? mmdd;

  const enabledSetting = await getLoyaltySetting(db, 'birthday_coupon_enabled').catch(() => null);
  const enabled = enabledSetting === '1';
  const mode: Mode =
    opts.mode ?? ((await getLoyaltySetting(db, 'birthday_coupon_mode').catch(() => null)) as Mode) ?? 'dryrun';

  const result: BdayRunResult = {
    enabled, mode, todayMMDD,
    targets: 0, alreadyDone: 0, freeShipping: 0, fixed500: 0, issued: 0, sent: 0,
    lineSent: 0, errors: 0, errorSamples: [], sample: [],
  };

  // ① 緊急停止スイッチ: enabled=1 でなければ何もしない（force で上書き可＝手動テスト）
  if (!opts.force && !enabled) return result;

  // 対象の抽出
  let targets: TargetRow[] = [];
  if (mode === 'test') {
    // テストモード: 誕生日に関係なく、テスト送り先(河原さん)だけ
    const testScid = (await getLoyaltySetting(db, 'birthday_coupon_test_recipient').catch(() => null)) || '';
    if (!testScid) { result.errorSamples.push('test_recipient未設定'); result.errors++; return result; }
    const lp = await getLoyaltyPointByShopifyCustomerId(db, testScid);
    if (!lp) { result.errorSamples.push('test_recipientが自社ポイント未連携'); result.errors++; return result; }
    targets = [{ shopify_customer_id: testScid, friend_id: lp.friend_id }];
  } else {
    // dryrun / live: 当日誕生日（MM-DD一致）かつLINE連携済み・フォロー中。
    // うるう年: 今日が2/28なら2/29生まれも含める（平年は2/28配信）。
    const patterns = todayMMDD === '02-28' ? [`%-${todayMMDD}`, '%-02-29'] : [`%-${todayMMDD}`];
    const where = patterns.map(() => 'lp.birthday LIKE ?').join(' OR ');
    const rows = await db
      .prepare(
        `SELECT lp.shopify_customer_id AS shopify_customer_id, lp.friend_id AS friend_id
         FROM loyalty_points lp
         INNER JOIN friends f ON f.id = lp.friend_id
         WHERE lp.shopify_customer_id IS NOT NULL
           AND lp.birthday IS NOT NULL
           AND f.is_following = 1
           AND f.line_user_id LIKE 'U%'
           AND (${where})`,
      )
      .bind(...patterns)
      .all<TargetRow>();
    targets = rows.results ?? [];
  }
  result.targets = targets.length;

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const expireStr = formatJaDate(endsAt);

  for (const t of targets) {
    const scid = t.shopify_customer_id;
    try {
      // 直近注文額で出し分け
      const recentAmount = await recentOrderAmount(db, scid);
      const type: CouponType = recentAmount >= AMOUNT_THRESHOLD ? 'fixed_500' : 'free_shipping';
      if (type === 'free_shipping') result.freeShipping++; else result.fixed500++;

      // 表示名（LINE用）
      const friend = await getFriendById(db, t.friend_id);
      const name = (friend?.display_name || 'お客様').toString();

      if (result.sample.length < 10) result.sample.push({ scid, type, recentAmount });

      // ③ 予行演習: ここで終わり（発行も送信もしない）
      if (mode === 'dryrun') continue;

      let logClaimed = false;

      // ② 冪等: 年1回（testモードは繰り返しテストできるよう冪等チェックしない）
      if (mode === 'live') {
        const claim = await db
          .prepare(
            `INSERT OR IGNORE INTO birthday_coupon_log (id, shopify_customer_id, friend_id, year, coupon_type, status, channel, recent_amount)
             VALUES (?, ?, ?, ?, ?, 'pending', 'none', ?)`,
          )
          .bind(crypto.randomUUID(), scid, t.friend_id, year, type, recentAmount)
          .run();
        if ((claim.meta?.changes ?? 0) === 0) { result.alreadyDone++; continue; } // 今年発行済み
        logClaimed = true;
      }

      // クーポン発行
      const issued = await issueBirthdayCoupon(env, scid, type, startsAt, endsAt);
      if (!issued.ok) {
        result.errors++;
        if (result.errorSamples.length < 5) result.errorSamples.push(`${scid}: ${issued.error}`);
        if (logClaimed) {
          await db.prepare(`UPDATE birthday_coupon_log SET status = 'failed', error_message = ? WHERE shopify_customer_id = ? AND year = ?`)
            .bind(issued.error, scid, year).run();
        }
        continue;
      }
      result.issued++;
      if (result.sample.length > 0 && result.sample[result.sample.length - 1].scid === scid) {
        result.sample[result.sample.length - 1].code = issued.code;
      }
      if (mode === 'live') {
        await db.prepare(`UPDATE birthday_coupon_log SET code = ?, status = 'issued' WHERE shopify_customer_id = ? AND year = ?`)
          .bind(issued.code, scid, year).run();
      }

      // LINE送信のみ。送れない場合もメール代替配信はしない。
      const sendRes = await sendLineFlex(env, t.friend_id, type, name, issued.code, expireStr);
      const channel = sendRes.sent ? 'line' : 'none';
      const deliveryError = sendRes.sent ? '' : (sendRes.error ?? 'line_send_failed');
      if (sendRes.sent) {
        result.sent++;
        result.lineSent++;
      }

      if (mode === 'live') {
        await db
          .prepare(
            `UPDATE birthday_coupon_log
             SET channel = ?, status = ?, error_message = ?
             WHERE shopify_customer_id = ? AND year = ?`,
          )
          .bind(channel, channel === 'none' ? 'issued' : 'sent', deliveryError || null, scid, year)
          .run();
      }

      if (channel === 'none') {
        result.errors++;
        if (result.errorSamples.length < 5) result.errorSamples.push(`${scid} send: ${deliveryError || 'unknown'}`);
      }
    } catch (e) {
      result.errors++;
      if (result.errorSamples.length < 5) result.errorSamples.push(`${scid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (result.targets > 0 || result.errors > 0) {
    console.log(
      `[birthday-coupon] mode=${mode} today=${todayMMDD} targets=${result.targets} issued=${result.issued} sent=${result.sent} already=${result.alreadyDone} errors=${result.errors}`,
    );
  }
  return result;
}
