/**
 * LIFF メール連携ページ（一気通貫 Phase 1）
 *
 * 遷移元: LINEのリッチメニュー等
 *   https://liff.line.me/<LIFF_ID>?page=email-link
 *
 * 流れ（Shopifyログイン不要）:
 *   1. メールアドレスを入力 → POST /api/liff/email-link/request-code
 *      （サーバ: LINE本人確認 → メールでShopify顧客特定 → 6桁コードをメール送信）
 *   2. メールに届いた6桁コードを入力 → POST /api/liff/email-link/verify-code
 *      （サーバ: コード照合 → 共有部品 linkShopifyAndReward() で連携＋特典）
 *   3. 結果を表示
 *
 * なりすまし防止: 入力メール宛に届くコードを知っている人だけ連携できる。
 */

declare const liff: {
  getAccessToken(): string | null;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getFriendship(): Promise<{ friendFlag: boolean }>;
  closeWindow(): void;
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function render(html: string): void {
  const container = document.getElementById('app');
  if (container) container.innerHTML = html;
}

const INPUT_STYLE =
  'width:100%;padding:14px;font-size:16px;border:1px solid #ddd;border-radius:8px;margin:4px 0 8px;-webkit-appearance:none;';
const PRIMARY_BTN_STYLE =
  'width:100%;padding:14px;background:#06C755;color:#fff;font-size:16px;font-weight:700;border:none;border-radius:8px;cursor:pointer;margin-top:8px;';
const LINK_BTN_STYLE =
  'background:none;border:none;color:#06C755;font-size:13px;text-decoration:underline;cursor:pointer;margin-top:12px;';

// ブランド表示（フードコスメ ORYZAE）— メール入力という不安が出やすい画面で
// 「誰が運営しているか」を明示して安心して使ってもらうため。
// ストアのヘッダーロゴ（oryzae.shop）。差し替えはこのURLのみ変更すればOK。
const BRAND_LOGO_URL =
  'https://oryzae.shop/cdn/shop/files/1_1_19d61d3d-1236-457c-9c63-0c1dd4afa187.png?v=1748963505&width=420';
function brandHeader(): string {
  return `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="${BRAND_LOGO_URL}" alt="フードコスメ ORYZAE"
        style="height:34px;width:auto;max-width:200px;object-fit:contain;" />
    </div>`;
}
function trustFooter(): string {
  return `
    <p style="font-size:11px;color:#aaa;margin-top:18px;line-height:1.7;">
      運営：株式会社オリゼ（フードコスメ ORYZAE）<br>
      ご入力のメールは連携の確認のみに使用します。<br>
      <a href="https://oryzae.shop/policies/privacy-policy" target="_blank" rel="noopener" style="color:#06C755;">プライバシーポリシー</a>
    </p>`;
}

/** アクセストークン取得（未ログインなら login にフォールバック） */
function getAccessTokenOrLogin(): string | null {
  const token = liff.getAccessToken();
  if (!token) {
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return null;
    }
  }
  return token;
}

// ─── 画面: ① メール入力 ───────────────────────────────────
function renderEmailStep(prefillEmail = '', errorMsg = ''): void {
  render(`
    <div class="card">
      ${brandHeader()}
      <h2 style="color:#333;">LINEと連携する</h2>
      <p class="message">ご注文時にお使いのメールアドレスを入力してください。<br>確認コードをメールでお送りします。</p>
      ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ''}
      <input id="emailInput" type="email" inputmode="email" autocomplete="email"
        placeholder="example@email.com" value="${escapeHtml(prefillEmail)}" style="${INPUT_STYLE}" />
      <button id="sendBtn" style="${PRIMARY_BTN_STYLE}">確認コードを送る</button>
      ${trustFooter()}
    </div>
  `);
  const input = document.getElementById('emailInput') as HTMLInputElement | null;
  const btn = document.getElementById('sendBtn');
  btn?.addEventListener('click', () => {
    const email = (input?.value ?? '').trim();
    if (!email) {
      renderEmailStep(email, 'メールアドレスを入力してください。');
      return;
    }
    void requestCode(email);
  });
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') btn?.dispatchEvent(new Event('click'));
  });
}

// ─── 画面: ② コード入力 ───────────────────────────────────
function renderCodeStep(email: string, errorMsg = ''): void {
  render(`
    <div class="card">
      ${brandHeader()}
      <h2 style="color:#333;">確認コードを入力</h2>
      <p class="message"><strong>${escapeHtml(email)}</strong> に送った<br>6桁のコードを入力してください。</p>
      ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ''}
      <input id="codeInput" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
        placeholder="------" style="${INPUT_STYLE}text-align:center;letter-spacing:10px;font-size:24px;font-weight:700;" />
      <button id="verifyBtn" style="${PRIMARY_BTN_STYLE}">連携する</button>
      <div style="margin-top:12px;">
        <button id="resendBtn" style="${LINK_BTN_STYLE}">コードを再送する</button>
        <span style="color:#ccc;margin:0 6px;">/</span>
        <button id="changeEmailBtn" style="${LINK_BTN_STYLE}">メールを変更</button>
      </div>
    </div>
  `);
  const input = document.getElementById('codeInput') as HTMLInputElement | null;
  const btn = document.getElementById('verifyBtn');
  btn?.addEventListener('click', () => {
    const code = (input?.value ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      renderCodeStep(email, '6桁の数字を入力してください。');
      return;
    }
    void verifyCode(email, code);
  });
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') btn?.dispatchEvent(new Event('click'));
  });
  document.getElementById('resendBtn')?.addEventListener('click', () => { void requestCode(email); });
  document.getElementById('changeEmailBtn')?.addEventListener('click', () => renderEmailStep(email));
}

// ─── 画面: 成功 ───────────────────────────────────────────
interface LinkData {
  bonusAwarded: number;
  backfilledOrders: number;
  backfilledPoints: number;
  couponCode?: string | null;
  couponExpiresAt?: string | null;
  alreadyLinked?: boolean;
  alreadyLinkedSource?: 'crm_plus' | 'self' | null;
}
function showSuccess(data: LinkData): void {
  const { bonusAwarded, backfilledOrders, backfilledPoints, couponCode, couponExpiresAt, alreadyLinked, alreadyLinkedSource } = data;
  const totalPoints = bonusAwarded + backfilledPoints;
  const gotReward = bonusAwarded > 0 || !!couponCode;
  const lines: string[] = [];

  if (alreadyLinked && !gotReward) {
    const source = alreadyLinkedSource === 'crm_plus' ? '以前ご利用いただいたLINE連携サービス' : '当店のポイントシステム';
    lines.push('<strong>すでに連携済みのアカウントです</strong>', `${source}で<br>LINE連携特典は過去に受け取り済みです。`);
  } else if (couponCode) {
    const expDisp = couponExpiresAt
      ? new Date(couponExpiresAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;
    lines.push('🚚 送料無料クーポンをプレゼント！', `<strong style="font-size:18px;letter-spacing:1px;">${escapeHtml(couponCode)}</strong>`);
    if (expDisp) lines.push(`<span style="font-size:12px;color:#888;">有効期限：${expDisp}（1回限り）</span>`);
    lines.push('<span style="font-size:12px;color:#888;">クーポンはLINEのメッセージでもお送りしました</span>');
  } else if (bonusAwarded > 0) {
    lines.push(`🎁 LINE連携ボーナス <strong>+${bonusAwarded}pt</strong>`);
  } else {
    lines.push('連携が完了しました！');
  }
  if (backfilledOrders > 0) {
    lines.push(`🛍 過去のご購入 ${backfilledOrders}件 <strong>+${backfilledPoints}pt</strong>`);
  }
  const totalLine = totalPoints > 0
    ? `<p class="message" style="margin-top:16px;font-size:15px;color:#06C755;font-weight:700;">合計 +${totalPoints}pt を付与しました</p>`
    : '';
  const heading = (alreadyLinked && !gotReward) ? '連携済みです' : 'LINE連携完了！';

  render(`
    <div class="card">
      <div class="check-icon">✓</div>
      <h2>${heading}</h2>
      <p class="message">${lines.join('<br>')}</p>
      ${totalLine}
      <button id="closeBtn" class="close-btn" style="margin-top:24px;">閉じる</button>
    </div>
  `);
  document.getElementById('closeBtn')?.addEventListener('click', () => {
    if (liff.isInClient()) liff.closeWindow();
    else window.close();
  });
}

function showError(message: string): void {
  render(`
    <div class="card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
      <p class="sub-message" style="margin-top:16px;">お手数ですが時間をおいて再度お試しいただくか、ORYZAEサポートまでご連絡ください。</p>
      <button id="retryBtn" style="${PRIMARY_BTN_STYLE}">最初からやり直す</button>
    </div>
  `);
  document.getElementById('retryBtn')?.addEventListener('click', () => renderEmailStep());
}

function showLoading(message: string): void {
  render(`<div class="card"><div class="loading-spinner"></div><p class="message">${escapeHtml(message)}</p></div>`);
}

// ─── 通信: ① コード送信 ───────────────────────────────────
async function requestCode(email: string): Promise<void> {
  showLoading('確認コードをお送りしています...');
  const accessToken = getAccessTokenOrLogin();
  if (!accessToken) return; // login にリダイレクト中

  let json: { success?: boolean; found?: boolean; sent?: boolean; code?: string; message?: string; error?: string } | null = null;
  try {
    const res = await fetch('/api/liff/email-link/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, email }),
    });
    json = await res.json();
  } catch {
    renderEmailStep(email, 'サーバーに接続できませんでした。電波の良い場所で再度お試しください。');
    return;
  }

  if (json?.success && json.found && json.sent) {
    renderCodeStep(email);
    return;
  }
  if (json?.success && json.found === false) {
    // 多重メール対策: 別のメールで再試行を促す（入力は残す）
    renderEmailStep(email, json.message ?? 'このメールアドレスでのご購入が見つかりませんでした。ご注文時のメールでお試しください。');
    return;
  }
  // 未友だち → 友だち追加ステップへ誘導（一気通貫）。追加後に「次へ」でこのメールで再試行。
  if (json?.code === 'not_friend') {
    renderFriendAddStep(email, '友だち追加が完了したら「追加した・次へ進む」を押してください。');
    return;
  }
  // disabled / throttled / bad_email / ambiguous / send_failed
  renderEmailStep(email, json?.message ?? json?.error ?? 'コードを送信できませんでした。');
}

// ─── 通信: ② コード検証＋連携 ─────────────────────────────
async function verifyCode(email: string, code: string): Promise<void> {
  showLoading('連携を確認しています...');
  const accessToken = getAccessTokenOrLogin();
  if (!accessToken) return;

  let res: Response;
  let json: { success?: boolean; data?: LinkData; code?: string; message?: string; error?: string } | null = null;
  try {
    res = await fetch('/api/liff/email-link/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken, email, code }),
    });
    json = await res.json();
  } catch {
    renderCodeStep(email, 'サーバーに接続できませんでした。再度お試しください。');
    return;
  }

  if (res!.ok && json?.success && json.data) {
    showSuccess(json.data);
    return;
  }
  // invalid（残回数あり）/ expired / no_code は同じコード画面で再入力
  if (json?.code === 'invalid' || json?.code === 'expired' || json?.code === 'no_code' || json?.code === 'bad_input') {
    renderCodeStep(email, json.message ?? '確認コードが正しくありません。');
    return;
  }
  // too_many / link_conflict / disabled / not_friend など
  showError(json?.message ?? json?.error ?? '連携に失敗しました。');
}

// ─── 画面: ⓪ 友だち追加（未友だちのとき・一気通貫）───────────────
// LINE友だちでない人は、まず公式アカウントの友だち追加へ誘導。
// 追加して戻ってくると、自動で友だち判定し直してメール入力へ進む。
const FRIEND_ADD_URL = 'https://line.me/R/ti/p/@oryzae_foodcosme';
function renderFriendAddStep(email = '', notice = ''): void {
  render(`
    <div class="card">
      ${brandHeader()}
      <h2 style="color:#333;">まず友だち追加</h2>
      <p class="message">送料無料クーポンを受け取るには、<br>先にLINEで友だち追加をお願いします🌾</p>
      ${notice ? `<p class="error" style="font-size:12px;">${escapeHtml(notice)}</p>` : ''}
      <a href="${FRIEND_ADD_URL}" style="${PRIMARY_BTN_STYLE}display:block;text-align:center;text-decoration:none;box-sizing:border-box;">友だち追加する</a>
      <p style="font-size:12px;color:#999;margin-top:14px;line-height:1.7;">追加したら、この画面に戻って<br>下のボタンを押してください。</p>
      <button id="friendDoneBtn" style="${PRIMARY_BTN_STYLE}background:#fff;color:#06C755;border:1px solid #06C755;">追加した・次へ進む</button>
      ${trustFooter()}
    </div>
  `);
  // 「次へ」: emailがあればサーバ側で友だち判定し直す（友だちになっていればコードが飛ぶ。
  //           まだ未友だちなら not_friend が返り、本ステップに戻る）。emailが無ければメール入力へ。
  const proceed = (): void => {
    if (email) { void requestCode(email); return; }
    renderEmailStep();
  };
  // bot連携済みの環境では、画面に戻ってきたとき友だち判定で自動で進む（未連携環境はthrow→手動ボタンで進む）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    liff.getFriendship().then(({ friendFlag }) => { if (friendFlag) proceed(); }).catch(() => { /* 手動ボタンで進む */ });
  });
  document.getElementById('friendDoneBtn')?.addEventListener('click', proceed);
}

export async function initEmailLink(): Promise<void> {
  try {
    // 一気通貫の友だち判定は「サーバ側（friendレコードの有無）」で行う。
    // ここで先に getFriendship を試し、bot連携済みなら未友だちを早期に検知して友だち追加へ。
    // bot未連携の環境では getFriendship が例外になるため、まずメール入力へ進み、
    // request-code が not_friend を返した時点で友だち追加ステップを出す（= 確実に動く本線）。
    let isFriend = true;
    try {
      isFriend = (await liff.getFriendship()).friendFlag;
    } catch {
      isFriend = true; // 判定不可ならメール入力へ（サーバの not_friend で友だち追加に誘導）
    }
    if (isFriend) renderEmailStep();
    else renderFriendAddStep();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'エラーが発生しました。');
  }
}
