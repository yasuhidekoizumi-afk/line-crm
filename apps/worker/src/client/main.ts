/**
 * LINE Harness LIFF — The single entry point
 *
 * This URL IS the friend-add URL. Every user enters through here.
 *
 * Flow:
 *   LIFF URL → LINE Login (auto in LINE app) → UUID issued
 *   → friendship check → not friend? show add button → friend added → Webhook → scenario enroll
 *   → already friend? → show completion
 *
 * Query params:
 *   ?ref=xxx     — attribution tracking (which LP/campaign)
 *   ?redirect=x  — redirect after linking (for wrapped URLs)
 *   ?page=book   — booking page (calendar slot picker)
 */

import { initBooking } from './booking.js';
import { initForm } from './form.js';
import { initLinkShopify } from './link-shopify.js';
import { initEmailLink } from './email-link.js';

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string; statusMessage?: string }>;
  getIDToken(): string | null;
  getDecodedIDToken(): { sub: string; name?: string; email?: string; picture?: string } | null;
  getFriendship(): Promise<{ friendFlag: boolean }>;
  isInClient(): boolean;
  closeWindow(): void;
};

// LIFFは外部リンクをエンドポイントURLに転送するとき、元のクエリ全体を
// `?liff.state=?page=...&liffId=...&xxx=...` のように **1パラメータにまとめて** 渡す。
// このままだと `URLSearchParams.get('liffId')` 等が空になり、後続のロジックが全部壊れる。
// 起動直後に liff.state を展開して URL を正規化する。
function unwrapLiffState(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const state = params.get('liff.state');
  if (!state) return;
  const inner = state.startsWith('?') ? state.slice(1) : state;
  if (!inner) return;
  const stateParams = new URLSearchParams(inner);
  params.delete('liff.state');
  // 既存のクエリは温存しつつ、liff.state 内のキーで上書き（重複時は state を優先）
  stateParams.forEach((v, k) => params.set(k, v));
  const qs = params.toString();
  const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
  try {
    window.history.replaceState(null, '', newUrl);
  } catch {
    // history API が使えない環境は諦める（後続の detectLiffId が状態経由で取得する）
  }
}
unwrapLiffState();

// Resolve LIFF ID: check query param first, then fallback to env var.
// 上の unwrapLiffState() でクエリは正規化済みのため、ここはシンプル。
function detectLiffId(): string {
  const params = new URLSearchParams(window.location.search);
  const fromParam = params.get('liffId');
  if (fromParam) return fromParam;
  return import.meta.env?.VITE_LIFF_ID || '';
}
/**
 * 「読み込み中...」のままユーザーが詰まらないよう、画面にエラーとデバッグ情報を表示する。
 * throw だけだと index.html の初期表示（スピナー+「読み込み中...」）のまま固まる。
 */
function mountFatalError(title: string, detail: string): void {
  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  if (!app) return;
  const params = new URLSearchParams(window.location.search);
  const debug = [
    `URL: ${window.location.href}`,
    `path: ${window.location.pathname}`,
    `search: ${window.location.search || '(none)'}`,
    `liff.state: ${params.get('liff.state') ?? '(none)'}`,
    `liffId (query): ${params.get('liffId') ?? '(none)'}`,
    `VITE_LIFF_ID (build): ${import.meta.env?.VITE_LIFF_ID ?? '(none)'}`,
    `UA: ${navigator.userAgent}`,
  ].join('\n');
  app.innerHTML = `
    <div class="card">
      <h2 style="color:#e53e3e">${title}</h2>
      <p class="message">${detail}</p>
      <pre style="text-align:left;font-size:10px;white-space:pre-wrap;word-break:break-all;background:#f0f0f0;padding:8px;border-radius:4px;margin-top:12px;color:#333">${debug.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</pre>
    </div>
  `;
}

const LIFF_ID = detectLiffId();
if (!LIFF_ID) {
  mountFatalError('LIFF初期化失敗', 'LIFF IDが見つかりません。GitHub Variables の VITE_LIFF_ID が未設定の可能性があります。');
  throw new Error('LIFF ID not found');
}
const UUID_STORAGE_KEY = 'lh_uuid';
// LINE公式アカウントの友だち追加URL（LINE Developers Console → Messaging API → Bot basic ID）
const BOT_BASIC_ID = import.meta.env?.VITE_BOT_BASIC_ID || '';

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

function getPage(): string | null {
  const path = window.location.pathname.replace(/^\/+/, '');
  if (path === 'book') return 'book';
  const params = new URLSearchParams(window.location.search);
  return params.get('page');
}

function getRedirectUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect');
}

function getRef(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('ref');
}

function getSavedUuid(): string | null {
  try {
    return localStorage.getItem(UUID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveUuid(uuid: string): void {
  try {
    localStorage.setItem(UUID_STORAGE_KEY, uuid);
  } catch {
    // silent fail
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── UI States ──────────────────────────────────────────

function showFriendAdd(profile: { displayName: string; pictureUrl?: string }) {
  const container = document.getElementById('app')!;
  const friendAddUrl = BOT_BASIC_ID
    ? `https://line.me/R/ti/p/${BOT_BASIC_ID}`
    : '#';

  container.innerHTML = `
    <div class="card">
      <div class="profile">
        ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
        <p class="name">${escapeHtml(profile.displayName)} さん</p>
      </div>
      <p class="message">まずは友だち追加をお願いします</p>
      <a href="${friendAddUrl}" class="add-friend-btn" id="addFriendBtn">
        友だち追加して始める
      </a>
      <p class="sub-message">追加後、この画面に戻ってきてください</p>
    </div>
  `;

  // 友だち追加後に戻ってきたら自動で再チェック
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        const { friendFlag } = await liff.getFriendship();
        if (friendFlag) {
          showCompletion(profile, false);
        }
      } catch {
        // ignore
      }
    }
  });
}

function showCompletion(profile: { displayName: string; pictureUrl?: string }, isRecovery: boolean) {
  const container = document.getElementById('app')!;
  const ref = getRef();
  container.innerHTML = `
    <div class="card">
      <div class="check-icon">${isRecovery ? '🔄' : '✓'}</div>
      <h2>${isRecovery ? 'おかえりなさい！' : '登録完了！'}</h2>
      <div class="profile">
        ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
        <p class="name">${escapeHtml(profile.displayName)} さん</p>
      </div>
      <p class="message">
        ${isRecovery
          ? '以前のアカウント情報を引き継ぎました。'
          : 'ありがとうございます！これからお役立ち情報をお届けします。'
        }
        <br>このページは閉じて大丈夫です。
      </p>
      ${ref ? `<p class="ref-badge">${escapeHtml(ref)}</p>` : ''}
    </div>
  `;

  // 2秒後にトーク画面に遷移（BOT_BASIC_ID が設定されている場合のみ）
  if (BOT_BASIC_ID) {
    setTimeout(() => {
      window.location.href = `https://line.me/R/oaMessage/${BOT_BASIC_ID}/`;
    }, 2000);
  }
}

function showError(message: string) {
  const container = document.getElementById('app')!;
  container.innerHTML = `
    <div class="card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
    </div>
  `;
}

// ─── Core Flow ──────────────────────────────────────────

async function linkAndAddFlow() {
  const redirectUrl = getRedirectUrl();
  const ref = getRef();

  try {
    const existingUuid = getSavedUuid();

    // Get profile, ID token, and friendship status in parallel
    const [profile, rawIdToken, friendship] = await Promise.all([
      liff.getProfile(),
      Promise.resolve(liff.getIDToken()),
      liff.getFriendship(),
    ]);

    // 1. UUID linking (always, regardless of friendship)
    const linkPromise = apiCall('/api/liff/link', {
      method: 'POST',
      body: JSON.stringify({
        idToken: rawIdToken,
        displayName: profile.displayName,
        existingUuid: existingUuid,
        ref: ref,
      }),
    }).then(async (res) => {
      if (res.ok) {
        const data = await res.json() as { success: boolean; data?: { userId?: string } };
        if (data?.data?.userId) {
          saveUuid(data.data.userId);
        }
      }
      return res;
    }).catch(() => {
      // Silent fail — UUID linking is best-effort
    });

    // 2. Attribution tracking
    if (ref) {
      apiCall('/api/affiliates/click', {
        method: 'POST',
        body: JSON.stringify({ code: ref, url: window.location.href }),
      }).catch(() => {});
    }

    // 3. Redirect flow (for wrapped URLs)
    if (redirectUrl) {
      await Promise.race([
        linkPromise,
        new Promise((r) => setTimeout(r, 500)),
      ]);
      // Append LINE userId to tracking links so clicks are attributed
      if (redirectUrl.includes('/t/')) {
        const sep = redirectUrl.includes('?') ? '&' : '?';
        window.location.href = `${redirectUrl}${sep}lu=${encodeURIComponent(profile.userId)}`;
      } else {
        window.location.href = redirectUrl;
      }
      return;
    }

    // 4. Wait for UUID linking to complete
    await linkPromise;

    // 5. Friendship check — the key decision point
    if (!friendship.friendFlag) {
      // Not a friend yet → show friend-add button
      showFriendAdd(profile);
    } else {
      // Already a friend → all done
      showCompletion(profile, !!existingUuid);
    }

  } catch (err) {
    if (redirectUrl) {
      // ループ防止: redirectUrl が /t/ で lu= が無いと /t/ で再度LIFFにリダイレクトされて
      // 無限ループ→レート制限 429 になる。失敗時は _skip_liff=1 を付けてLIFF経由を回避させる。
      if (redirectUrl.includes('/t/') && !redirectUrl.includes('lu=')) {
        const sep = redirectUrl.includes('?') ? '&' : '?';
        window.location.href = `${redirectUrl}${sep}_skip_liff=1`;
      } else {
        window.location.href = redirectUrl;
      }
    } else {
      showError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  }
}

// ─── Entry Point ────────────────────────────────────────

async function main() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return;
    }

    const page = getPage();
    if (page === 'book') {
      await initBooking();
    } else if (page === 'form') {
      const params = new URLSearchParams(window.location.search);
      const formId = params.get('id');
      await initForm(formId);
    } else if (page === 'link-shopify') {
      await initLinkShopify();
    } else if (page === 'email-link') {
      await initEmailLink();
    } else {
      await linkAndAddFlow();
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : 'LIFF初期化エラー');
  }
}

main();
