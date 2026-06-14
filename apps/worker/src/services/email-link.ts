import type { Env } from '../index.js';
import { getShopifyAdminToken } from '../utils/shopify-token.js';
import { linkShopifyAndReward } from './liff-link-core.js';

/**
 * メール起点のLINE↔Shopify連携（LIFF一気通貫 Phase 1）。
 *
 * 設計の肝:
 *  - Shopifyログイン不要。LINE(LIFF)で本人確認済みのユーザーが「メール1つ」入力するだけ。
 *  - ただしメールは他人のものを打ててしまうため、そのメール宛に6桁コードを送り、
 *    入力できた人だけ連携を許可する（=メール所有=本人確認=なりすまし防止）。
 *  - 連携・特典付与の中核は既存の共有部品 linkShopifyAndReward() を再利用（二重付与防止を一元化）。
 *  - 既定OFFの安全スイッチ＋テストモード（指定LINEだけ）。本番ONは小泉さんOK後。
 */

const CODE_TTL_SEC = 600;        // コード有効期限 10分
const THROTTLE_SEC = 60;         // 同一(メール)への再送は60秒あけてもらう
const MAX_ATTEMPTS = 5;          // 誤入力の上限（総当たり防止）
const SHOPIFY_API_VERSION = '2024-10';

/** ルート側で `c.json(body, status)` にそのまま渡せるよう、使う範囲のHTTPステータスに限定 */
export type HttpStatus = 200 | 400 | 401 | 403 | 404 | 409 | 429 | 503;
export interface ServiceResponse {
  status: HttpStatus;
  body: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// LINE本人確認（accessToken または idToken → lineUserId）
//   link-shopify と同じ検証方針。許可チャネルID = 既定 + DB保存分。
// ─────────────────────────────────────────────────────────────
export type LineAuthResult =
  | { ok: true; lineUserId: string }
  | { ok: false; status: HttpStatus; error: string };

export async function verifyLineUserFromToken(
  env: Env['Bindings'],
  body: { accessToken?: string; idToken?: string },
): Promise<LineAuthResult> {
  if (!body.accessToken && !body.idToken) {
    return { ok: false, status: 400, error: 'accessToken または idToken は必須です' };
  }

  const { getLineAccounts } = await import('@line-crm/db');
  const loginChannelIds = [env.LINE_LOGIN_CHANNEL_ID];
  const dbAccounts = await getLineAccounts(env.DB);
  for (const acct of dbAccounts) {
    if (acct.login_channel_id && !loginChannelIds.includes(acct.login_channel_id)) {
      loginChannelIds.push(acct.login_channel_id);
    }
  }

  let lineUserId: string | null = null;

  if (body.accessToken) {
    // 1) トークン発行元チャネルを検証
    const tokenInfoRes = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(body.accessToken)}`,
    );
    if (!tokenInfoRes.ok) return { ok: false, status: 401, error: 'Invalid access token' };
    const tokenInfo = await tokenInfoRes.json<{ client_id: string; expires_in: number }>();
    if (!loginChannelIds.includes(tokenInfo.client_id)) {
      return { ok: false, status: 401, error: 'Access token was issued for a different channel' };
    }
    if (tokenInfo.expires_in <= 0) return { ok: false, status: 401, error: 'Access token expired' };
    // 2) userId 取得
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    });
    if (!profileRes.ok) return { ok: false, status: 401, error: 'Failed to fetch LINE profile' };
    const profile = await profileRes.json<{ userId: string }>();
    lineUserId = profile.userId;
  } else if (body.idToken) {
    let verifyRes: Response | null = null;
    for (const channelId of loginChannelIds) {
      verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: body.idToken, client_id: channelId }),
      });
      if (verifyRes.ok) break;
    }
    if (!verifyRes?.ok) return { ok: false, status: 401, error: 'Invalid ID token' };
    const verified = await verifyRes.json<{ sub: string }>();
    lineUserId = verified.sub;
  }

  if (!lineUserId) return { ok: false, status: 401, error: 'Unable to verify LINE user' };
  return { ok: true, lineUserId };
}

// ─────────────────────────────────────────────────────────────
// 安全ゲート（緊急停止＋テストモード）
// ─────────────────────────────────────────────────────────────
async function checkGate(env: Env['Bindings'], lineUserId: string): Promise<{ allowed: boolean }> {
  const { getLoyaltySetting } = await import('@line-crm/db');
  const enabled = await getLoyaltySetting(env.DB, 'email_link_enabled').catch(() => null);
  if (enabled !== '1') return { allowed: false };            // 既定OFF=準備中

  const mode = (await getLoyaltySetting(env.DB, 'email_link_mode').catch(() => null)) ?? 'test';
  if (mode === 'live') return { allowed: true };

  // test モード: 指定のLINE userId のみ許可（予行演習）
  const testUser = await getLoyaltySetting(env.DB, 'email_link_test_line_user').catch(() => null);
  return { allowed: !!testUser && testUser === lineUserId };
}

// ─────────────────────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────────────────────
function normalizeEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}
function isValidEmail(email: string): boolean {
  // 厳密検証はしない（送信先妥当性の最低限チェック）
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function generateSixDigitCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return n.toString().padStart(6, '0');
}
async function hashLinkCode(code: string, lineUserId: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${lineUserId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shopify顧客をメールで特定（完全一致のみ）。
 * Shopify検索はあいまい一致のことがあるため、取得後に email を厳密照合する。
 * @returns 顧客ID / null（見つからない） / 'ambiguous'（同一メールが複数=要サポート）
 */
export async function findShopifyCustomerByEmail(
  env: Env['Bindings'],
  email: string,
): Promise<string | null | 'ambiguous'> {
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  const adminToken = await getShopifyAdminToken(env);
  if (!shopDomain || !adminToken) throw new Error('Shopify credentials not configured');

  const QUERY = `query($q:String!){ customers(first:5, query:$q){ nodes{ legacyResourceId email } } }`;
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { q: `email:"${email}"` } }),
  });
  if (!res.ok) throw new Error(`Shopify customer search failed: ${res.status}`);
  const j = (await res.json()) as {
    data?: { customers?: { nodes?: Array<{ legacyResourceId?: string; email?: string | null }> } };
  };
  const nodes = j.data?.customers?.nodes ?? [];
  const exact = nodes.filter((n) => (n.email ?? '').trim().toLowerCase() === email && n.legacyResourceId);
  if (exact.length === 0) return null;
  if (exact.length > 1) {
    console.warn('[email-link] ambiguous email (multiple customers):', email, exact.map((n) => n.legacyResourceId));
    return 'ambiguous';
  }
  return String(exact[0].legacyResourceId);
}

// ─────────────────────────────────────────────────────────────
// 確認コードのメール送信（Resend）
// ─────────────────────────────────────────────────────────────
async function sendCodeEmail(env: Env['Bindings'], email: string, code: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.FERMENT_FROM_EMAIL_JP) {
    console.error('[email-link] RESEND未設定のためコードメールを送信できません');
    return false;
  }
  const html = `
    <div style="font-family:'Zen Kaku Gothic New','Hiragino Sans',sans-serif;max-width:480px;margin:0 auto;background:#faf8f4;">
      <div style="background:#b8860b;padding:20px;text-align:center;">
        <h1 style="color:#fff;font-size:18px;margin:0;font-weight:700;">LINE連携の確認コード</h1>
      </div>
      <div style="padding:24px 20px;background:#fff;margin:0 12px;border-radius:0 0 12px 12px;">
        <p style="margin:0 0 16px;font-size:14px;color:#333;line-height:1.7;">
          LINEとの連携を進めるための確認コードです。LINEの画面に下のコードを入力してください。
        </p>
        <div style="text-align:center;margin:20px 0;">
          <div style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#b8860b;background:#fbf6ed;padding:14px 24px;border-radius:10px;">${code}</div>
        </div>
        <p style="margin:0 0 8px;font-size:12px;color:#888;line-height:1.7;">
          このコードは10分間有効です。<br/>
          お心当たりがない場合は、このメールは破棄してください（連携は行われません）。
        </p>
      </div>
      <p style="text-align:center;font-size:11px;color:#bbb;margin:16px 0;">株式会社オリゼ</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FERMENT_FROM_EMAIL_JP,
      to: [email],
      subject: '【オリゼ】LINE連携の確認コード',
      html,
    }),
  });
  if (!res.ok) {
    console.error('[email-link] Resend送信失敗:', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// ① コード発行（request-code）
//    LINE本人確認済み lineUserId と、入力 email を受け取り、
//    友だち確認 → Shopify顧客特定 → コード生成・保存 → メール送信。
// ─────────────────────────────────────────────────────────────
export async function requestEmailLinkCode(
  env: Env['Bindings'],
  lineUserId: string,
  emailRaw: string,
): Promise<ServiceResponse> {
  const { getFriendByLineUserId } = await import('@line-crm/db');

  if (!(await checkGate(env, lineUserId)).allowed) {
    return { status: 403, body: { success: false, code: 'disabled', message: 'メール連携は現在準備中です。' } };
  }

  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) {
    return { status: 400, body: { success: false, code: 'bad_email', message: 'メールアドレスの形式をご確認ください。' } };
  }

  // 友だち（LINE公式アカウント追加済み）であること
  const friend = await getFriendByLineUserId(env.DB, lineUserId);
  if (!friend) {
    return { status: 404, body: { success: false, code: 'not_friend', message: '先にLINE公式アカウントの友だち追加をお願いします。' } };
  }

  // Shopify顧客をメールで特定
  const customerId = await findShopifyCustomerByEmail(env, email);
  if (customerId === 'ambiguous') {
    return { status: 409, body: { success: false, code: 'ambiguous', message: 'このメールに複数のアカウントが見つかりました。お手数ですがサポートへご連絡ください。' } };
  }
  if (!customerId) {
    // 存在しないメール。多重メール対策として「別のメールで再試行」を促す（found:false）
    return {
      status: 200,
      body: {
        success: true,
        found: false,
        message: 'このメールアドレスでのご購入が見つかりませんでした。ご注文時にお使いのメールでお試しください。',
      },
    };
  }

  // 再送スロットル（直近60秒に発行済みなら待ってもらう）。expires_at から逆算。
  const recent = await env.DB
    .prepare(`SELECT expires_at FROM email_link_codes WHERE line_user_id = ? AND email = ? ORDER BY expires_at DESC LIMIT 1`)
    .bind(lineUserId, email)
    .first<{ expires_at: string }>();
  if (recent && new Date(recent.expires_at).getTime() > Date.now() + (CODE_TTL_SEC - THROTTLE_SEC) * 1000) {
    return { status: 429, body: { success: false, code: 'throttled', message: 'コードを送信したばかりです。1分ほど待って再度お試しください。' } };
  }

  // コード生成・保存（古い行は消して最新1件運用）
  const code = generateSixDigitCode();
  const codeHash = await hashLinkCode(code, lineUserId);
  const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
  await env.DB.prepare(`DELETE FROM email_link_codes WHERE line_user_id = ? AND email = ?`).bind(lineUserId, email).run();
  await env.DB
    .prepare(`INSERT INTO email_link_codes (id, line_user_id, email, shopify_customer_id, code_hash, attempts, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    .bind(crypto.randomUUID(), lineUserId, email, customerId, codeHash, expiresAt)
    .run();

  const sent = await sendCodeEmail(env, email, code);
  if (!sent) {
    return { status: 503, body: { success: false, code: 'send_failed', message: 'メールの送信に失敗しました。少し時間をおいてお試しください。' } };
  }
  return { status: 200, body: { success: true, found: true, sent: true, message: '確認コードをメールにお送りしました。メールをご確認ください。' } };
}

// ─────────────────────────────────────────────────────────────
// ② コード検証＋連携（verify-code）
//    コード照合に成功したら、共有部品 linkShopifyAndReward() で連携＋特典。
// ─────────────────────────────────────────────────────────────
export async function verifyEmailLinkCode(
  env: Env['Bindings'],
  lineUserId: string,
  emailRaw: string,
  codeRaw: string,
): Promise<ServiceResponse> {
  const { getFriendByLineUserId } = await import('@line-crm/db');

  if (!(await checkGate(env, lineUserId)).allowed) {
    return { status: 403, body: { success: false, code: 'disabled', message: 'メール連携は現在準備中です。' } };
  }

  const email = normalizeEmail(emailRaw);
  const code = (codeRaw ?? '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return { status: 400, body: { success: false, code: 'bad_input', message: '入力内容をご確認ください。' } };
  }

  const row = await env.DB
    .prepare(`SELECT id, shopify_customer_id, code_hash, attempts, expires_at FROM email_link_codes WHERE line_user_id = ? AND email = ? ORDER BY expires_at DESC LIMIT 1`)
    .bind(lineUserId, email)
    .first<{ id: string; shopify_customer_id: string; code_hash: string; attempts: number; expires_at: string }>();

  if (!row) {
    return { status: 400, body: { success: false, code: 'no_code', message: '確認コードが見つかりません。もう一度コードを送ってください。' } };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare(`DELETE FROM email_link_codes WHERE id = ?`).bind(row.id).run();
    return { status: 400, body: { success: false, code: 'expired', message: '確認コードの有効期限が切れました。もう一度送ってください。' } };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare(`DELETE FROM email_link_codes WHERE id = ?`).bind(row.id).run();
    return { status: 429, body: { success: false, code: 'too_many', message: '入力回数が上限に達しました。最初からやり直してください。' } };
  }

  const inputHash = await hashLinkCode(code, lineUserId);
  if (inputHash !== row.code_hash) {
    await env.DB.prepare(`UPDATE email_link_codes SET attempts = attempts + 1 WHERE id = ?`).bind(row.id).run();
    const remaining = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
    return { status: 400, body: { success: false, code: 'invalid', remaining, message: `確認コードが正しくありません。（あと${remaining}回）` } };
  }

  // コード一致 → 連携実行（友だち再確認 → 共有部品）
  const friend = await getFriendByLineUserId(env.DB, lineUserId);
  if (!friend) {
    return { status: 404, body: { success: false, code: 'not_friend', message: '先にLINE公式アカウントの友だち追加をお願いします。' } };
  }

  const result = await linkShopifyAndReward(env, friend, row.shopify_customer_id, { lineUserId });

  // 成否に関わらずコードは消費（再利用させない）
  await env.DB.prepare(`DELETE FROM email_link_codes WHERE id = ?`).bind(row.id).run();

  if (!result.ok) {
    return { status: result.status, body: { success: false, code: 'link_conflict', message: result.error } };
  }
  return { status: 200, body: { success: true, data: result.data, shopifyCustomerId: row.shopify_customer_id } };
}
