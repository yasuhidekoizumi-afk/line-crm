/**
 * Gmail API client for Cloudflare Workers
 *
 * サービスアカウント + ドメイン全体の委任で `support@oryzae.site` 等を読み書きする。
 * googleapis npmパッケージはWorkersで重すぎるため、JWT署名 → REST直叩きで実装。
 *
 * 使い方:
 *   const client = new GmailClient(serviceAccountJson, 'support@oryzae.site');
 *   const messages = await client.listMessages({ q: 'in:inbox' });
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
}

export interface GmailMessageMetadata {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size: number; data?: string };
  parts?: GmailPayload[];
}

export interface GmailHistoryItem {
  id: string;
  messages?: Array<{ id: string; threadId: string }>;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>;
}

// ===== JWT署名（RS256, Web Crypto API） =====

function base64UrlEncode(input: ArrayBuffer | string): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwtRs256(claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyData = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ===== GmailClient =====

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class GmailClient {
  private subject: string;
  private serviceAccount: ServiceAccountKey;
  private scopes: string[];
  private cachedToken: CachedToken | null = null;

  constructor(serviceAccountJsonOrObject: string | ServiceAccountKey, subject: string, scopes?: string[]) {
    this.serviceAccount =
      typeof serviceAccountJsonOrObject === 'string'
        ? JSON.parse(serviceAccountJsonOrObject)
        : serviceAccountJsonOrObject;
    this.subject = subject;
    this.scopes = scopes ?? DEFAULT_SCOPES;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 60_000) {
      return this.cachedToken.token;
    }

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.serviceAccount.client_email,
      sub: this.subject, // ドメイン全体の委任で対象ユーザーになりすます
      scope: this.scopes.join(' '),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };

    const jwt = await signJwtRs256(claims, this.serviceAccount.private_key);
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail token exchange failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number; threadsTotal: number; historyId: string }> {
    return this.apiGet(`/users/me/profile`);
  }

  async listMessages(opts: { q?: string; maxResults?: number; pageToken?: string } = {}): Promise<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }> {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.maxResults) params.set('maxResults', String(opts.maxResults));
    if (opts.pageToken) params.set('pageToken', opts.pageToken);
    return this.apiGet(`/users/me/messages?${params.toString()}`);
  }

  async getMessage(id: string, format: 'full' | 'metadata' | 'raw' = 'full'): Promise<GmailMessageMetadata> {
    return this.apiGet(`/users/me/messages/${id}?format=${format}`);
  }

  async listHistory(startHistoryId: string): Promise<{
    history?: GmailHistoryItem[];
    historyId?: string;
    nextPageToken?: string;
  }> {
    return this.apiGet(`/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded`);
  }

  async watch(topicName: string, labelIds: string[] = ['INBOX']): Promise<{ historyId: string; expiration: string }> {
    return this.apiPost(`/users/me/watch`, { topicName, labelIds, labelFilterAction: 'include' });
  }

  async stopWatch(): Promise<void> {
    await this.apiPost(`/users/me/stop`, {});
  }

  async listLabels(): Promise<{ labels?: Array<{ id: string; name: string; type?: string }> }> {
    return this.apiGet(`/users/me/labels`);
  }

  async sendMessage(rawRfc822Base64Url: string, threadId?: string): Promise<{ id: string; threadId: string }> {
    const body: Record<string, unknown> = { raw: rawRfc822Base64Url };
    if (threadId) body.threadId = threadId;
    return this.apiPost(`/users/me/messages/send`, body);
  }

  // ===== HTTP helpers =====

  private async apiGet<T>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GMAIL_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail API GET ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GMAIL_API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail API POST ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }
}

// ===== ヘルパー: メッセージペイロードからテキスト本文抽出 =====

export function extractMessageBody(message: GmailMessageMetadata): {
  text: string;
  html: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
} {
  const headers = Object.fromEntries(
    (message.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  let text = '';
  let html: string | null = null;

  function walk(part: GmailPayload | undefined): void {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += decodeBase64Url(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html = decodeBase64Url(part.body.data);
    }
    if (part.parts) for (const child of part.parts) walk(child);
  }
  walk(message.payload);

  if (!text && html) {
    // HTMLしか無ければ簡易にタグ除去
    text = String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }
  if (!text && message.snippet) {
    text = message.snippet;
  }

  return {
    text,
    html,
    subject: headers['subject'] ?? null,
    from: headers['from'] ?? null,
    to: headers['to'] ?? null,
    date: headers['date'] ?? null,
  };
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function extractEmailAddress(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  const trimmed = fromHeader.trim();
  if (/@/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

// ===== RFC 822 メール送信用ヘルパー =====

export function buildRfc822(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: =?utf-8?B?${b64Utf8(input.subject)}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  lines.push('');
  lines.push(b64Utf8(input.text));
  const rfc822 = lines.join('\r\n');
  return base64UrlEncode(rfc822);
}

function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
