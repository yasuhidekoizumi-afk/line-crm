/**
 * CS Phase 1: FAQ Google Sheets同期サービス
 *
 * Sheets構造:
 *   A: カテゴリ / B: 質問パターン / C: 回答テンプレート
 *   D: キーワード(カンマ区切り) / E: L1自動返信可(TRUE/FALSE) / F: 有効(TRUE/FALSE)
 *
 * 1行目はヘッダー想定。2行目以降を読み込む。
 *
 * cron: 5分間隔で同期
 */
import { GmailClient, type ServiceAccountKey } from '@line-crm/email-sdk';
import { upsertFaqFromSheetRow } from '@line-crm/db';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface FaqSyncEnv {
  DB: D1Database;
  GCP_SERVICE_ACCOUNT_JSON?: string;
  CS_FAQ_SHEET_ID?: string;
  CS_FAQ_SHEET_RANGE?: string;
}

/**
 * Sheetsから読み込み → DB upsert。
 * GmailClient と同じJWT/access_tokenロジックを再利用するため、
 * subject無し（サービスアカウント自体）でアクセス可能なSheetsとする
 * （= 対象スプレッドシートをサービスアカウントに共有しておく）。
 */
export async function syncFaqFromSheets(env: FaqSyncEnv): Promise<{ synced: number; errors: number }> {
  if (!env.GCP_SERVICE_ACCOUNT_JSON) {
    console.warn('[cs-faq-sync] GCP_SERVICE_ACCOUNT_JSON not set');
    return { synced: 0, errors: 0 };
  }
  if (!env.CS_FAQ_SHEET_ID) {
    console.warn('[cs-faq-sync] CS_FAQ_SHEET_ID not set');
    return { synced: 0, errors: 0 };
  }

  let sa: ServiceAccountKey;
  try {
    sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON) as ServiceAccountKey;
  } catch (e) {
    console.error('[cs-faq-sync] SA JSON parse failed', e);
    return { synced: 0, errors: 1 };
  }

  // Sheets用のaccess token取得（subject無しでサービスアカウント自身として）
  const token = await getSheetsAccessToken(sa);
  if (!token) return { synced: 0, errors: 1 };

  const range = env.CS_FAQ_SHEET_RANGE ?? 'A2:F1000';
  const url = `${SHEETS_API_BASE}/${env.CS_FAQ_SHEET_ID}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[cs-faq-sync] Sheets API failed (${res.status}):`, text);
    return { synced: 0, errors: 1 };
  }

  const json = (await res.json()) as { values?: string[][] };
  const rows = json.values ?? [];

  let synced = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sheetRow = i + 2; // ヘッダー+1
    const [category, question, answer, keywords, l1Eligible, active] = row;
    if (!category || !question || !answer) continue;
    try {
      await upsertFaqFromSheetRow(env.DB, {
        source_row: sheetRow,
        category: String(category).trim(),
        question: String(question).trim(),
        answer: String(answer).trim(),
        keywords: keywords ? String(keywords).trim() : undefined,
        l1_eligible: parseSheetBool(l1Eligible),
        active: active == null ? true : parseSheetBool(active),
      });
      synced++;
    } catch (e) {
      console.error(`[cs-faq-sync] row ${sheetRow} failed:`, e);
      errors++;
    }
  }

  return { synced, errors };
}

function parseSheetBool(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y';
}

// JWT for Sheets (no subject — service account self)
async function getSheetsAccessToken(sa: ServiceAccountKey): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };
    const jwt = await signJwt(claims, sa.private_key);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    if (!res.ok) {
      console.error('[cs-faq-sync] token exchange failed:', await res.text());
      return null;
    }
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  } catch (e) {
    console.error('[cs-faq-sync] getSheetsAccessToken failed:', e);
    return null;
  }
}

function b64url(input: ArrayBuffer | string): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else bytes = new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(claims: Record<string, unknown>, pem: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const keyData = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) keyData[i] = binary.charCodeAt(i);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}
