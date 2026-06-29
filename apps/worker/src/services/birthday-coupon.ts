import {
  getLoyaltySetting,
  getFriendById,
  getLineAccountById,
  getLoyaltyPointByShopifyCustomerId,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { sendEmail } from '@line-crm/email-sdk';
import { buildMessage } from './step-delivery.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';

// ────────────────────────────────────────────────────────────────────
// 誕生日クーポン自動配信
//   設計: docs/BIRTHDAY_TRIGGER_DESIGN.md / 文面: docs/BIRTHDAY_TRIGGER_MESSAGES_2026-06.md
//
//   仕様（確定）:
//     - 誕生日「当日」配信。直近注文額 <5,000円 → 送料無料 / ≥5,000円 → 500円OFF を出し分け。
//     - 有効期限 = 誕生日 +14日。年1回（同一顧客×同一年に二重発行/配信しない）。
//     - LINE連携済みの人へ Flex（お祝い画像＋クーポン）を配信。送れない場合はメールへフォールバック。
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
  RESEND_API_KEY?: string;
  FERMENT_FROM_EMAIL_JP?: string;
  FERMENT_FROM_NAME_JP?: string;
}

const HERO_IMAGE = 'https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png';
const SHOP_URL = 'https://oryzae.shop';
const AMOUNT_THRESHOLD = 5000; // 直近注文額の境目（未満=送料無料 / 以上=500円OFF）
const EXPIRY_DAYS = 14;

type CouponType = 'free_shipping' | 'fixed_500';
type Mode = 'dryrun' | 'test' | 'live';
type DeliveryChannel = 'line' | 'email' | 'none';

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

async function fetchShopifyCustomer(
  env: BdayEnv,
  scid: string,
): Promise<{ email: string | null; name: string | null } | { error: string }> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) return { error: 'Shopify 設定が未構成です' };

  const res = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${scid}.json`, {
    headers: { 'X-Shopify-Access-Token': adminToken },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `customer ${res.status} ${text.slice(0, 150)}` };
  }

  const data = (await res.json()) as {
    customer?: { email?: string | null; first_name?: string | null; last_name?: string | null };
  };
  const customer = data.customer;
  const name = [customer?.last_name, customer?.first_name].filter(Boolean).join(' ').trim();
  return { email: customer?.email?.trim() || null, name: name || null };
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

function buildBirthdayEmail(type: CouponType, name: string, code: string, expire: string): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name);
  const safeCode = escapeHtml(code);
  const safeExpire = escapeHtml(expire);
  const title = type === 'free_shipping' ? '送料無料クーポン' : '500円OFFクーポン';
  const subject = `🎂 ${name}さん、お誕生日おめでとうございます（${title}）`;
  const lead =
    type === 'free_shipping'
      ? 'オリゼからの誕生日プレゼントとして、送料無料クーポンをお届けします。'
      : 'いつものご愛顧に感謝を込めて、500円OFFクーポンをお届けします。';
  const discountUrl = `${SHOP_URL}/discount/${encodeURIComponent(code)}`;
  const html = `
    <div style="font-family:'Zen Kaku Gothic New','Hiragino Sans',sans-serif;max-width:520px;margin:0 auto;background:#faf8f4;color:#333;">
      <img src="${HERO_IMAGE}" alt="${safeName}さん、お誕生日おめでとうございます" style="display:block;width:100%;height:auto;border:0;" />
      <div style="padding:24px 20px;background:#fff;margin:0 12px 12px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.8;">${safeName}さん<br>お誕生日おめでとうございます🎂</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.8;">${lead}</p>
        <div style="background:#fbf6ed;border:1px solid #ead6b0;border-radius:10px;padding:16px;margin:0 0 20px;">
          <div style="font-size:15px;font-weight:700;color:#5c4a2e;margin-bottom:8px;">${escapeHtml(title)}</div>
          <div style="font-size:12px;color:#8a7a5c;">クーポンコード</div>
          <div style="font-size:18px;font-weight:700;color:#5c4a2e;letter-spacing:0;margin:2px 0 8px;">${safeCode}</div>
          <div style="font-size:12px;color:#8a7a5c;">有効期限：${safeExpire}まで</div>
        </div>
        <a href="${discountUrl}" style="display:block;text-align:center;padding:14px;background:#C9A86A;color:#fff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;margin:0 0 10px;">クーポンを使ってお買い物</a>
        <p style="margin:0 0 18px;font-size:12px;color:#8a7a5c;text-align:center;">ボタンを押すとクーポンが自動で適用されます。</p>
        <p style="margin:0;font-size:13px;line-height:1.8;color:#8a7a5c;text-align:center;">発酵のようにゆっくり豊かに育ちますように🌾</p>
      </div>
      <div style="padding:12px 20px 20px;text-align:center;font-size:11px;color:#aaa;">株式会社オリゼ<br><a href="${SHOP_URL}" style="color:#b8860b;text-decoration:none;">${SHOP_URL}</a></div>
    </div>
  `;
  const text = `${name}さん\nお誕生日おめでとうございます。\n\n${lead}\n\n${title}\nクーポンコード: ${code}\n有効期限: ${expire}まで\n\n${discountUrl}\n\n発酵のようにゆっくり豊かに育ちますように`;
  return { subject, html, text };
}

async function sendBirthdayEmail(
  env: BdayEnv,
  to: string,
  type: CouponType,
  name: string,
  code: string,
  expire: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!env.RESEND_API_KEY || !env.FERMENT_FROM_EMAIL_JP) {
    return { sent: false, error: 'Resend 設定が未構成です' };
  }
  const content = buildBirthdayEmail(type, name, code, expire);
  const fromName = env.FERMENT_FROM_NAME_JP ?? 'オリゼ';
  const result = await sendEmail(env.RESEND_API_KEY, {
    from: `${fromName} <${env.FERMENT_FROM_EMAIL_JP}>`,
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [
      { name: 'kind', value: 'birthday_coupon' },
      { name: 'coupon_type', value: type },
    ],
  });
  return result.ok ? { sent: true } : { sent: false, error: result.error ?? 'send_failed' };
}

export interface BdayRunResult {
  enabled: boolean;
  mode: Mode;
  todayMMDD: string;
  targets: number;          // 対象（誕生日一致・連携済み）
  alreadyDone: number;      // 今年すでに発行済み（スキップ）
  freeShipping: number;     // 送料無料を発行/予定
  fixed500: number;         // 500円OFFを発行/予定
  issued: number;           // 実際にクーポン発行した数（dryrunは0）
  sent: number;             // 実際に送信した数（dryrunは0）
  lineSent: number;
  emailSent: number;
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
    lineSent: 0, emailSent: 0, errors: 0, errorSamples: [], sample: [],
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
    // dryrun / live: 当日誕生日（MM-DD一致）かつ連携済み(shopify_customer_id あり)。
    // うるう年: 今日が2/28なら2/29生まれも含める（平年は2/28配信）。
    const patterns = todayMMDD === '02-28' ? [`%-${todayMMDD}`, '%-02-29'] : [`%-${todayMMDD}`];
    const where = patterns.map(() => 'birthday LIKE ?').join(' OR ');
    const rows = await db
      .prepare(
        `SELECT lp.shopify_customer_id AS shopify_customer_id, lp.friend_id AS friend_id
         FROM loyalty_points lp
         WHERE lp.shopify_customer_id IS NOT NULL AND lp.birthday IS NOT NULL AND (${where})`,
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

      // 表示名（LINE/メール用）
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

      // LINE送信。送れない場合はShopify顧客メールへフォールバックする。
      let channel: DeliveryChannel = 'none';
      let deliveryError = '';
      const sendRes = await sendLineFlex(env, t.friend_id, type, name, issued.code, expireStr);
      if (sendRes.sent) {
        channel = 'line';
        result.sent++;
        result.lineSent++;
      } else if (sendRes.error) {
        deliveryError = sendRes.error;
      }

      if (channel === 'none') {
        const customer = await fetchShopifyCustomer(env, scid);
        if ('error' in customer) {
          deliveryError = `${deliveryError || 'line_failed'}; email_lookup: ${customer.error}`;
        } else if (!customer.email) {
          deliveryError = `${deliveryError || 'line_failed'}; no_customer_email`;
        } else {
          const emailName = name === 'お客様' && customer.name ? customer.name : name;
          const emailRes = await sendBirthdayEmail(env, customer.email, type, emailName, issued.code, expireStr);
          if (emailRes.sent) {
            channel = 'email';
            result.sent++;
            result.emailSent++;
          } else {
            deliveryError = `${deliveryError || 'line_failed'}; email_send: ${emailRes.error ?? 'send_failed'}`;
          }
        }
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
