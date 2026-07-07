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

declare const BOT_BASIC_ID: string;

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
      const friendAddUrl = BOT_BASIC_ID
        ? `https://line.me/R/ti/p/${BOT_BASIC_ID}`
        : '#';
      app.innerHTML = `
        <div class="card">
          <div class="profile">
            ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
            <p class="name">${escapeHtml(profile.displayName)} さん</p>
          </div>
          <p class="message">ギフトを受け取るには<br>ORYZAE公式LINEの友だち追加が必要です</p>
          <a href="${friendAddUrl}" class="add-friend-btn">友だち追加する</a>
          <p class="sub-message">追加後、もう一度ギフトリンクを開いてください</p>
        </div>
      `;
      return;
    }

    // Call claim API
    const res = await fetch('/api/egift/gifts/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, lineUserId: profile.userId }),
    });

    const data = await res.json() as { success: boolean; error?: string };

    if (data.success) {
      // Redirect back to gift LP with line_added status
      window.location.href = `/g/${encodeURIComponent(token)}?status=line_added`;
    } else {
      // Check if already claimed
      if (data.error?.includes('既に受け取り済み')) {
        window.location.href = `/g/${encodeURIComponent(token)}`;
      } else {
        app.innerHTML = `
          <div class="card">
            <h2>エラー</h2>
            <p>${escapeHtml(data.error || '受け取りに失敗しました')}</p>
            <p class="sub-message"><a href="/g/${encodeURIComponent(token)}">ギフト画面に戻る</a></p>
          </div>
        `;
      }
    }
  } catch (err) {
    app.innerHTML = `
      <div class="card">
        <h2>エラー</h2>
        <p>通信エラーが発生しました</p>
        <p class="sub-message"><a href="/g/${encodeURIComponent(token)}">ギフト画面に戻る</a></p>
      </div>
    `;
  }
}
