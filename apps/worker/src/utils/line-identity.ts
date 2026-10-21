/**
 * LIFF の idToken を LINE の検証APIで確認し、改ざんできない userId を得る。
 *
 * 背景: LIFF系の公開APIが「本文の lineUserId」を信頼していたため、
 * 他人のLINEユーザーIDを知っていれば残高閲覧やクーポン発行ができた。
 * 認証が必要な公開APIは、この関数で idToken → userId を確定させてから処理する。
 */
import { getLineAccounts } from '@line-crm/db';

interface IdentityEnv {
  DB: D1Database;
  LINE_LOGIN_CHANNEL_ID?: string;
}

export type VerifiedLineUser =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 502; error: string };

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

export async function verifyLiffIdToken(env: IdentityEnv, idToken: string | null | undefined): Promise<VerifiedLineUser> {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, status: 401, error: '本人確認情報（idToken）がありません。LINEアプリから開き直してください。' };
  }

  const channelIds: string[] = [];
  if (env.LINE_LOGIN_CHANNEL_ID) channelIds.push(env.LINE_LOGIN_CHANNEL_ID);
  try {
    const accounts = await getLineAccounts(env.DB);
    for (const account of accounts) {
      const loginChannelId = (account as { login_channel_id?: string | null }).login_channel_id;
      if (loginChannelId && !channelIds.includes(loginChannelId)) channelIds.push(loginChannelId);
    }
  } catch {
    // DB参照に失敗しても既定チャネルで検証を試す
  }
  if (channelIds.length === 0) {
    return { ok: false, status: 502, error: 'LINEログインの設定がありません（管理者にお問い合わせください）' };
  }

  for (const channelId of channelIds) {
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      });
      if (!res.ok) continue;
      const verified = (await res.json()) as { sub?: string };
      if (verified?.sub) return { ok: true, userId: verified.sub };
    } catch (error) {
      console.error('[line-identity] verify failed:', error);
    }
  }

  return { ok: false, status: 401, error: '本人確認に失敗しました。LINEアプリから開き直してください。' };
}
