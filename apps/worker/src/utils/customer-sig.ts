/**
 * 顧客向けAPI（マイページ系: ポイント残高/履歴/利用/特典交換）の本人確認。
 *
 * 背景: これらのAPIは Shopify のマイページ(Liquid)から呼ばれるため管理画面の
 * Bearer 認証を掛けられず、これまで「Shopify顧客IDを知っていれば誰でも呼べる」
 * 状態だった（解約ブロッカー#11: 本人確認欠如）。
 *
 * 対策: ID連携(link-shopify)と同じ仕組みを使う。
 * Shopifyテーマ(Liquid)が LINK_SHOPIFY_SIGNING_SECRET で
 * HMAC-SHA256("{shopifyCustomerId}:{expires}") を生成し、
 * クエリパラメータ ?expires=<UNIX秒>&sig=<hex> として付与。
 * Liquid 内では {{ customer.id }} はログイン本人のIDしか取れないため、
 * 有効な署名を持っている＝本人がマイページを開いている、と確認できる。
 *
 * 段階導入: REQUIRE_CUSTOMER_SIG=1 のときだけ必須化する。
 * テーマ側(Liquid)が sig を付ける改修を終えるまではオフにしておくことで、
 * 既存のマイページ表示を壊さずにコード側の受け皿を先に本番投入できる。
 *
 * 署名仕様は apps/worker/src/routes/liff.ts の verifyShopifyLinkSignature と
 * 完全に同一（メッセージ形式・有効期限5分・時計ずれ30分・hex・定数時間比較）。
 */

import type { Context } from 'hono';

export async function verifyCustomerSignature(
  secret: string,
  shopifyCustomerId: string,
  expires: string,
  sigHex: string,
): Promise<boolean> {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum)) return false;
  // 期限切れ・30分以上未来（時計ずれの範囲外）は拒否
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresNum < nowSec) return false;
  if (expiresNum > nowSec + 60 * 30) return false;

  const message = `${shopifyCustomerId}:${expires}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (expected.length !== sigHex.length) return false;
  // タイミング攻撃対策の定数時間比較
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 顧客向けエンドポイントの先頭で呼ぶガード。
 * - REQUIRE_CUSTOMER_SIG が '1' 以外: 何もしない（null を返す＝通過）
 * - '1' のとき: クエリの expires / sig を検証し、不正ならエラーResponseを返す
 *
 * 署名はクエリパラメータで受ける（GET/POST共通で扱え、bodyの二重読みを避けるため）。
 */
export async function checkCustomerSig(
  // 各ルートの Env 型差を吸収するため最小限の形で受ける
  c: Context<{ Bindings: { REQUIRE_CUSTOMER_SIG?: string; LINK_SHOPIFY_SIGNING_SECRET?: string } }>,
  shopifyCustomerId: string,
): Promise<Response | null> {
  if (c.env.REQUIRE_CUSTOMER_SIG !== '1') return null;

  const secret = c.env.LINK_SHOPIFY_SIGNING_SECRET;
  if (!secret) {
    return c.json(
      { success: false, error: 'サーバ設定エラー（署名シークレット未設定）。管理者にお問い合わせください。' },
      503,
    );
  }
  const expires = c.req.query('expires');
  const sig = c.req.query('sig');
  if (!expires || !sig) {
    return c.json(
      { success: false, error: '本人確認情報がありません。マイページを開き直してください。' },
      401,
    );
  }
  const ok = await verifyCustomerSignature(secret, shopifyCustomerId, expires, sig);
  if (!ok) {
    return c.json(
      { success: false, error: '本人確認の有効期限が切れました。マイページを開き直してください。' },
      401,
    );
  }
  return null;
}
