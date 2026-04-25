/**
 * FERMENT: Resend API ラッパー
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/send-engine.ts
 *
 * 依存:
 *   - Resend REST API (https://api.resend.com)
 */

import type { SendEmailParams, SendResult, ResendWebhookEvent } from './types.js';

const RESEND_API_BASE = 'https://api.resend.com';

/**
 * Resend API 経由でメールを1通送信する
 * @param apiKey Resend API キー
 * @param params 送信パラメータ
 */
export async function sendEmail(apiKey: string, params: SendEmailParams): Promise<SendResult> {
  try {
    const body: Record<string, unknown> = {
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };

    if (params.text) body.text = params.text;
    if (params.replyTo) body.reply_to = params.replyTo;
    if (params.tags) body.tags = params.tags;
    if (params.headers) body.headers = params.headers;

    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[email-sdk] Resend API error', res.status, errorText);
      return { ok: false, error: `HTTP ${res.status}: ${errorText}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, resendId: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email-sdk] sendEmail exception:', message);
    return { ok: false, error: message };
  }
}

/**
 * Resend Webhook の署名を検証する
 *
 * Resend は `Svix-Id`, `Svix-Timestamp`, `Svix-Signature` ヘッダーを使用する。
 * 簡易実装: HMAC-SHA256 で署名を検証する。
 *
 * @param headers リクエストヘッダー
 * @param rawBody リクエスト本文（生テキスト）
 * @param secret RESEND_WEBHOOK_SECRET
 */
export async function verifyResendWebhook(
  headers: Headers,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  try {
    const svixId = headers.get('svix-id');
    const svixTimestamp = headers.get('svix-timestamp');
    const svixSignature = headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      return false;
    }

    // タイムスタンプの有効期限チェック（5分以内）
    const ts = parseInt(svixTimestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) {
      return false;
    }

    // 署名対象の文字列: `{svix-id}.{svix-timestamp}.{body}`
    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;

    // HMAC-SHA256 計算
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.replace('whsec_', ''));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(toSign));
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

    // 複数の署名が `v1,xxx v1,yyy` 形式で来る場合に備えて分割して比較
    const signatures = svixSignature.split(' ');
    for (const sig of signatures) {
      const sigValue = sig.startsWith('v1,') ? sig.slice(3) : sig;
      if (sigValue === computedSignature) return true;
    }

    return false;
  } catch (err) {
    console.error('[email-sdk] verifyResendWebhook error:', err);
    return false;
  }
}

/**
 * Resend Webhook のペイロードをパースする
 * @param body リクエスト本文
 */
export function parseResendWebhookEvent(body: string): ResendWebhookEvent | null {
  try {
    return JSON.parse(body) as ResendWebhookEvent;
  } catch {
    return null;
  }
}
