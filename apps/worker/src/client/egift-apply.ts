/**
 * eGift application LIFF handler — LINE friends apply for gift campaigns
 *
 * Called from LINE broadcast: LIFF_URL?page=egift-apply&campaign_id=XXX
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getFriendship(): Promise<{ friendFlag: boolean }>;
  getIDToken(): string | null;
  closeWindow(): void;
};

const BOT_BASIC_ID = (import.meta as ImportMeta & { env?: { VITE_BOT_BASIC_ID?: string } }).env?.VITE_BOT_BASIC_ID || '@oryzae_foodcosme';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function initEgiftApply(): Promise<void> {
  const app = document.getElementById('app')!;
  const params = new URLSearchParams(window.location.search);
  const campaignId = params.get('campaign_id');

  if (!campaignId) {
    app.innerHTML = `<div class="card"><h2>エラー</h2><p>キャンペーンが見つかりません。</p></div>`;
    return;
  }

  try {
    const profile = await liff.getProfile();

    // Check friendship
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
          <p class="message">応募するには<br>ORYZAE公式LINEの友だち追加が必要です</p>
          <a href="${friendAddUrl}" class="add-friend-btn">友だち追加する</a>
          <p class="sub-message">追加後、もう一度応募リンクを開いてください</p>
        </div>
      `;
      return;
    }

    // Show application form
    app.innerHTML = `
      <div class="card" style="max-width:400px;margin:0 auto;">
        <div class="profile" style="text-align:center;margin-bottom:16px;">
          ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" style="width:64px;height:64px;border-radius:50%;" />` : ''}
          <p class="name" style="font-size:15px;font-weight:600;margin-top:8px;">${escapeHtml(profile.displayName)} さん</p>
        </div>
        <h2 style="font-size:18px;text-align:center;margin-bottom:8px;">🎁 eGift 応募フォーム</h2>
        <p style="font-size:13px;color:#8a7a5c;text-align:center;margin-bottom:16px;">
          抽選で当選すると、ご友人に無料ギフトを贈れます
        </p>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#5c4a2e;margin-bottom:4px;">贈る相手へのメッセージ（任意）</label>
          <textarea id="apply-message" placeholder="「いつもありがとう！よかったら試してみて」" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;min-height:80px;font-family:inherit;"></textarea>
        </div>
        <button id="apply-btn" class="add-friend-btn" style="width:100%;margin-top:8px;">
          応募する
        </button>
        <p style="font-size:11px;color:#999;text-align:center;margin-top:8px;">
          ※ 当選は抽選です。1アカウント1回まで
        </p>
      </div>
    `;

    document.getElementById('apply-btn')!.addEventListener('click', async () => {
      const btn = document.getElementById('apply-btn')!;
      const message = (document.getElementById('apply-message') as HTMLTextAreaElement).value.trim();
      btn.textContent = '送信中...';
      (btn as HTMLButtonElement).disabled = true;

      try {
        // First, ensure friend is registered via LIFF link
        await fetch('/api/liff/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: liff.getIDToken?.() || null,
            displayName: profile.displayName,
          }),
        });

        const res = await fetch('/api/egift/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            lineUserId: profile.userId,
            occasion: 'other',
            message: message || undefined,
          }),
        });

        const data = await res.json() as { success: boolean; error?: string; data?: any };

        if (data.success) {
          app.innerHTML = `
            <div class="card" style="text-align:center;">
              <div style="font-size:56px;">✅</div>
              <h2>応募を受け付けました</h2>
              <p style="font-size:14px;color:#8a7a5c;margin-top:12px;">
                抽選結果はLINEでお知らせします。<br>当選をお楽しみに！
              </p>
              <p style="font-size:12px;color:#999;margin-top:16px;">この画面は閉じて大丈夫です</p>
            </div>
          `;
        } else {
          app.innerHTML = `
            <div class="card" style="text-align:center;">
              <h2>応募できませんでした</h2>
              <p style="color:#e53e3e;">${escapeHtml(data.error || '不明なエラー')}</p>
            </div>
          `;
        }
      } catch {
        app.innerHTML = `
          <div class="card" style="text-align:center;">
            <h2>エラー</h2>
            <p>通信エラーが発生しました</p>
          </div>
        `;
      }
    });

  } catch {
    app.innerHTML = `<div class="card"><h2>エラー</h2><p>読み込みに失敗しました。</p></div>`;
  }
}
