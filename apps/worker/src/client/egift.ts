/**
 * eGift LIFF handler — LINE friend-add gate for gift claims
 *
 * Called from gift LP: LIFF_URL?page=egift&egift_token=XXX
 * Checks LINE login → friendship → calls claim API → redirects back
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getFriendship(): Promise<{ friendFlag: boolean }>;
  closeWindow(): void;
};

const BOT_BASIC_ID = (import.meta as ImportMeta & { env?: { VITE_BOT_BASIC_ID?: string } }).env?.VITE_BOT_BASIC_ID || '@oryzae_foodcosme';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function initEgift(): Promise<void> {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('egift_token');

  if (!token) {
    app.innerHTML = `<div class="card"><h2>エラー</h2><p>ギフトリンクが無効です。</p></div>`;
    return;
  }

  // Show loading
  app.innerHTML = `<div class="card"><div class="spinner"></div><p>ギフトを確認中...</p></div>`;

  try {
    const profile = await liff.getProfile();

    // Check friendship first
    let friendFlag = false;
    try {
      friendFlag = (await liff.getFriendship()).friendFlag;
    } catch {
      friendFlag = false;
    }

    if (!friendFlag) {
      showFriendAddGate(app, profile, token);
      return;
    }

    await claimGift(app, profile.userId, token);
  } catch {
    app.innerHTML = `
      <div class="card">
        <h2>エラー</h2>
        <p>通信エラーが発生しました</p>
        <p class="sub-message"><a href="/g/${encodeURIComponent(token)}">ギフト画面に戻る</a></p>
      </div>
    `;
  }
}

/**
 * 友だち追加ゲート画面。
 * PC・スマホどちらでも、追加後にこの画面へ戻ってきたら自動で友だち判定し直し、
 * 成功したら claim へ進む。手動の「追加した・確認する」ボタンでも再チェックできる。
 */
function showFriendAddGate(
  app: HTMLElement,
  profile: { userId: string; displayName: string; pictureUrl?: string },
  token: string,
): void {
  const friendAddUrl = `https://line.me/R/ti/p/${BOT_BASIC_ID}`;
  app.innerHTML = `
    <div class="card">
      <div class="profile">
        ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
        <p class="name">${escapeHtml(profile.displayName)} さん</p>
      </div>
      <p class="message">ギフトを受け取るには<br>ORYZAE公式LINEの友だち追加が必要です</p>
      <a href="${friendAddUrl}" target="_blank" rel="noopener" class="add-friend-btn" id="egiftAddFriendBtn">友だち追加する</a>
      <button id="egiftFriendDoneBtn" class="add-friend-btn" style="background:#fff;color:#06C755;border:1px solid #06C755;margin-top:10px;">追加した・確認する</button>
      <p class="sub-message">追加したら、この画面に戻って<br>上のボタンを押してください</p>
    </div>
  `;

  let checking = false;
  const recheck = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const { friendFlag } = await liff.getFriendship();
      if (friendFlag) {
        app.innerHTML = `<div class="card"><div class="spinner"></div><p>ギフトを確認中...</p></div>`;
        await claimGift(app, profile.userId, token);
      }
    } catch {
      // ignore, ユーザーは手動ボタンで再試行できる
    } finally {
      checking = false;
    }
  };

  // 友だち追加タブから戻ってきたら自動で再チェック
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void recheck();
  });
  window.addEventListener('focus', () => { void recheck(); });
  document.getElementById('egiftFriendDoneBtn')!.addEventListener('click', () => { void recheck(); });
}

async function claimGift(app: HTMLElement, lineUserId: string, token: string): Promise<void> {
  const res = await fetch('/api/egift/gifts/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, lineUserId }),
  });

  const data = await res.json() as { success: boolean; error?: string };

  if (data.success) {
    window.location.href = `/g/${encodeURIComponent(token)}?status=line_added`;
    return;
  }

  if (data.error?.includes('既に受け取り済み')) {
    window.location.href = `/g/${encodeURIComponent(token)}`;
    return;
  }

  app.innerHTML = `
    <div class="card">
      <h2>エラー</h2>
      <p>${escapeHtml(data.error || '受け取りに失敗しました')}</p>
      <p class="sub-message"><a href="/g/${encodeURIComponent(token)}">ギフト画面に戻る</a></p>
    </div>
  `;
}
