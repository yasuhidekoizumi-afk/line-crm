/** インフルエンサー本人がLINE内で登録する専用プロフィール画面。 */
declare const liff: {
  getAccessToken(): string | null;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const followerBands = ['〜1,000人', '1,001〜5,000人', '5,001〜10,000人', '10,001〜30,000人', '30,001〜100,000人', '100,001人〜'];
const categories = ['美容・コスメ', '健康・ウェルネス', '料理・レシピ', 'ママ・子育て', '暮らし', 'フィットネス', 'ファッション', 'その他'];

function esc(value: string | null | undefined): string { const d = document.createElement('div'); d.textContent = value || ''; return d.innerHTML; }
function app(): HTMLElement { return document.getElementById('app')!; }
function accountId(): string { return new URLSearchParams(location.search).get('account') || ''; }
function checked(values: string[], value: string): string { return values.includes(value) ? 'checked' : ''; }

async function request(method: 'POST' | 'PUT', body: Record<string, unknown>) {
  // access token からLINEプロフィールを取得して照合することで、Webhookで取得した友だちIDと同じIDで確認する。
  const res = await fetch('/api/liff/influencer-profile', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, accessToken: liff.getAccessToken(), idToken: liff.getIDToken(), lineAccountId: accountId() }) });
  const json = await res.json() as { success: boolean; data?: Record<string, unknown>; error?: string };
  if (!res.ok || !json.success) throw new Error(json.error || '保存に失敗しました');
  return json.data;
}

function render(data?: Record<string, unknown>) {
  const profile = data || {};
  const cats = (profile.categories as string[]) || [];
  const interests = (profile.giftingInterests as string[]) || [];
  const address = (profile.address as Record<string, string> | null) || {};
  app().innerHTML = `<main style="max-width:640px;margin:0 auto;padding:24px 18px 44px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;color:#222">
    <p style="font-size:12px;letter-spacing:.12em;color:#4d7c5a;font-weight:700">ORYZAE CREATOR</p>
    <h1 style="font-size:25px;margin:8px 0">プロフィール登録</h1>
    <p style="line-height:1.65;color:#555;margin-bottom:24px">ギフティングやご連絡を、あなたに合った内容でお届けするための登録です。</p>
    <form id="profile-form">
      <label>Instagramアカウント <b style="color:#c33">*</b><input required name="instagramHandle" value="${esc(profile.instagramHandle as string)}" placeholder="@oryzae_official"></label>
      <label>発信ジャンル <b style="color:#c33">*</b><div class="checks">${categories.map(v => `<label class="check"><input type="checkbox" name="categories" value="${v}" ${checked(cats, v)}>${v}</label>`).join('')}</div></label>
      <label>フォロワー数 <b style="color:#c33">*</b><select required name="followerBand"><option value="">選択してください</option>${followerBands.map(v => `<option ${profile.followerBand === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>メールアドレス <b style="color:#c33">*</b><input required type="email" name="contactEmail" value="${esc(profile.contactEmail as string)}"></label>
      <label>電話番号 <input type="tel" name="contactPhone" value="${esc(profile.contactPhone as string)}"></label>
      <div class="grid"><label>年代 <select name="ageGroup"><option value="">回答しない</option>${['10代','20代','30代','40代','50代','60代以上'].map(v => `<option ${profile.ageGroup === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>性別 <select name="gender"><option value="">回答しない</option>${['女性','男性','ノンバイナリー','回答しない'].map(v => `<option ${profile.gender === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <label>興味のあるギフティング <div class="checks">${['甘酒','グラノーラ','米麹調味料','新商品・限定品'].map(v => `<label class="check"><input type="checkbox" name="giftingInterests" value="${v}" ${checked(interests, v)}>${v}</label>`).join('')}</div></label>
      <label>アレルギー・避けたい食材など <textarea name="dietaryNotes" rows="3">${esc(profile.dietaryNotes as string)}</textarea></label>
      <details style="margin:22px 0"><summary>発送先を登録・更新する（案件決定後でOK）</summary><div class="address"><label>お名前<input name="recipientName" value="${esc(address.recipientName)}"></label><label>郵便番号<input name="postalCode" value="${esc(address.postalCode)}"></label><label>都道府県<input name="prefecture" value="${esc(address.prefecture)}"></label><label>住所<input name="addressLine1" value="${esc(address.addressLine1)}"></label><label>建物名・部屋番号<input name="addressLine2" value="${esc(address.addressLine2)}"></label><label>電話番号<input name="addressPhone" value="${esc(address.phone)}"></label></div></details>
      <label class="consent"><input required type="checkbox" name="privacyConsent" ${profile.privacyConsentAt ? 'checked' : ''}> 登録情報をギフティングの選考・発送・連絡に利用することに同意します。</label>
      <button>登録内容を保存する</button><p id="message" role="status"></p>
    </form></main><style>label{display:block;font-size:14px;font-weight:650;margin:18px 0 7px}input,select,textarea{display:block;width:100%;box-sizing:border-box;margin-top:7px;border:1px solid #d4d4d4;border-radius:9px;padding:12px;font:inherit;background:#fff}.checks{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.check{margin:0;border:1px solid #ddd;border-radius:99px;padding:8px 10px;font-size:13px;font-weight:500}.check input,.consent input{display:inline;width:auto;margin:0 5px 0 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.address{padding-top:6px}button{width:100%;margin-top:26px;background:#215732;color:#fff;border:0;border-radius:10px;padding:15px;font:inherit;font-weight:700}.consent{line-height:1.5;font-weight:500}#message{color:#126b35;font-weight:700}</style>`;
  const form = document.querySelector<HTMLFormElement>('#profile-form')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const fd = new FormData(form); const message = document.querySelector('#message')!;
    const profileInput = { instagramHandle: fd.get('instagramHandle'), categories: fd.getAll('categories'), followerBand: fd.get('followerBand'), contactEmail: fd.get('contactEmail'), contactPhone: fd.get('contactPhone'), ageGroup: fd.get('ageGroup'), gender: fd.get('gender'), giftingInterests: fd.getAll('giftingInterests'), dietaryNotes: fd.get('dietaryNotes'), privacyConsent: fd.get('privacyConsent') === 'on' };
    const address = { recipientName: fd.get('recipientName'), postalCode: fd.get('postalCode'), prefecture: fd.get('prefecture'), addressLine1: fd.get('addressLine1'), addressLine2: fd.get('addressLine2'), phone: fd.get('addressPhone') };
    try { await request('PUT', { profile: profileInput, address }); message.textContent = '保存しました。ありがとうございます。'; if (liff.isInClient()) setTimeout(() => liff.closeWindow(), 1200); } catch (error) { message.textContent = error instanceof Error ? error.message : '保存できませんでした'; }
  });
}

export async function initInfluencerProfile() {
  if (!accountId()) { app().textContent = 'リンクが正しくありません。'; return; }
  try { render(await request('POST', {})); } catch (error) { app().textContent = error instanceof Error ? error.message : 'プロフィールを開けませんでした'; }
}
