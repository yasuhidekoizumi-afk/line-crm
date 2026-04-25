/**
 * FERMENT 既製テンプレートライブラリ
 * すぐに使える HTML メールテンプレ集
 */

export interface TemplateLibraryItem {
  id: string
  name: string
  category: string
  thumbnail: string  // 絵文字
  description: string
  subject: string
  body_html: string
}

const ORYZAE_GREEN = '#225533'
const ORYZAE_LIGHT = '#C8DCC8'

const wrap = (inner: string) => `<!DOCTYPE html>
<html><body style="font-family:-apple-system,'Hiragino Sans',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333;background:#fafaf7;">
${inner}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;">
<p style="font-size:11px;color:#999;">配信停止は <a href="{{unsubscribe_url}}" style="color:#999;">こちら</a></p>
<p style="font-size:11px;color:#999;">株式会社オリゼ / ORYZAE Inc.</p>
</body></html>`

export const TEMPLATE_LIBRARY: TemplateLibraryItem[] = [
  {
    id: 'lib_welcome_1',
    name: 'ウェルカムメール（シンプル）',
    category: 'welcome',
    thumbnail: '👋',
    description: '新規購読者への第一印象メール。シンプルで温かい挨拶',
    subject: '{{name}}さん、ようこそ 🌾',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};font-size:24px;">{{name}}さん、ようこそ 🌾</h1>
<p>はじめまして、株式会社オリゼです。</p>
<p>米麹発酵の力を、毎日の食卓に。<br>これから、選び抜いた商品情報や、発酵のレシピをお届けしてまいります。</p>
<p style="text-align:center;margin:32px 0;">
  <a href="https://oryzae.shop?utm_source=ferment&utm_campaign=welcome" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;">商品を見る</a>
</p>`),
  },
  {
    id: 'lib_winback_1',
    name: '休眠復帰（クーポン付き）',
    category: 'winback',
    thumbnail: '💌',
    description: '90日以上未購入の方への再アプローチ。割引クーポン特典',
    subject: '{{name}}さん、お久しぶりです 🌾',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、お久しぶりです 🌾</h1>
<p>しばらくぶりですね。お元気でいらっしゃいますか？</p>
<p>{{name}}さんのために、特別なクーポンをご用意しました。</p>
<div style="background:#FFF9E5;padding:24px;border-radius:8px;margin:24px 0;text-align:center;">
  <p style="margin:0;color:${ORYZAE_GREEN};font-weight:bold;font-size:18px;">特別 15%オフクーポン</p>
  <p style="margin:12px 0;font-family:monospace;font-size:24px;letter-spacing:3px;background:white;padding:12px;border-radius:6px;">WINBACK15</p>
  <p style="margin:0;font-size:12px;color:#777;">有効期限: 2週間</p>
</div>
<p style="text-align:center;margin:32px 0;">
  <a href="https://oryzae.shop?utm_source=ferment&utm_campaign=winback" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;">商品を見る</a>
</p>`),
  },
  {
    id: 'lib_launch_1',
    name: '新商品ローンチ告知',
    category: 'launch',
    thumbnail: '🎉',
    description: '新商品のお披露目。商品画像＋特長＋CTAボタン',
    subject: '【新発売】{{name}}さんへ、新商品のお知らせです 🎉',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">新商品のご案内です 🎉</h1>
<p>{{name}}さん、こんにちは。</p>
<p>このたび、オリゼより新商品を発売いたしました。</p>
<div style="border:2px solid ${ORYZAE_LIGHT};border-radius:8px;overflow:hidden;margin:24px 0;">
  <img src="https://placehold.co/600x300/C8DCC8/225533?text=Product+Image" style="width:100%;display:block;" alt="商品画像">
  <div style="padding:24px;">
    <h2 style="margin:0 0 12px;color:${ORYZAE_GREEN};">[新商品名]</h2>
    <p style="margin:0 0 16px;color:#555;">[商品の魅力を1〜2文で]</p>
    <p style="text-align:center;margin:0;">
      <a href="https://oryzae.shop?utm_source=ferment&utm_campaign=launch" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:10px 32px;text-decoration:none;border-radius:6px;">詳しく見る</a>
    </p>
  </div>
</div>`),
  },
  {
    id: 'lib_newsletter_1',
    name: '月次ニュースレター（標準）',
    category: 'newsletter',
    thumbnail: '📰',
    description: '今月のお知らせ＋人気商品＋発酵コラムの3セクション構成',
    subject: '{{name}}さん、今月のオリゼ便り 🌾',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、今月のオリゼ便りです 🌾</h1>
<p>いつもオリゼ商品をご愛顧いただき、ありがとうございます。</p>
<h2 style="color:${ORYZAE_GREEN};border-bottom:2px solid ${ORYZAE_LIGHT};padding-bottom:6px;margin-top:32px;">今月のお知らせ</h2>
<p>[ここに今月の主な話題を記載]</p>
<h2 style="color:${ORYZAE_GREEN};border-bottom:2px solid ${ORYZAE_LIGHT};padding-bottom:6px;margin-top:32px;">人気商品</h2>
<p>[商品紹介]</p>
<h2 style="color:${ORYZAE_GREEN};border-bottom:2px solid ${ORYZAE_LIGHT};padding-bottom:6px;margin-top:32px;">発酵のはなし</h2>
<p>[発酵コラム / レシピ紹介]</p>`),
  },
  {
    id: 'lib_vip_1',
    name: 'VIP会員限定オファー',
    category: 'vip',
    thumbnail: '💎',
    description: 'プラチナ・ダイヤモンド会員向けの特別オファー',
    subject: '【VIP限定】{{name}}様へ、プレミアム特典のご案内 💎',
    body_html: wrap(`
<div style="background:linear-gradient(135deg,#FFD700 0%,#FFA500 100%);padding:2px;border-radius:12px;margin-bottom:24px;">
  <div style="background:white;border-radius:10px;padding:24px;">
    <h1 style="margin:0;color:${ORYZAE_GREEN};">VIP会員限定 💎</h1>
    <p style="margin:8px 0 0;color:#888;font-size:13px;">{{name}}様だけにお届けする特別オファー</p>
  </div>
</div>
<p>いつも格別のご愛顧を賜り、誠にありがとうございます。</p>
<p>{{name}}様のような特別なお客様だけに、限定オファーをご用意いたしました。</p>
<div style="background:#FFFAF0;padding:20px;border-left:4px solid #FFD700;margin:24px 0;border-radius:4px;">
  <p style="margin:0 0 8px;font-weight:bold;color:${ORYZAE_GREEN};">VIP特典</p>
  <p style="margin:0;color:#555;">[特典内容を記載]</p>
</div>`),
  },
  {
    id: 'lib_review_1',
    name: 'レビュー依頼',
    category: 'review',
    thumbnail: '⭐',
    description: '商品到着後のお客様にレビュー投稿をお願い',
    subject: '{{name}}さん、ご購入ありがとうございました ⭐ ぜひレビューをお聞かせください',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、ご購入ありがとうございました</h1>
<p>商品はお手元に届きましたでしょうか。</p>
<p>{{name}}さんの「使ってみた感想」を、ぜひお聞かせください。<br>同じく米麹に興味のある方々の参考になります。</p>
<p style="text-align:center;margin:32px 0;">
  <a href="https://oryzae.shop/reviews?utm_source=ferment" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;">⭐ レビューを書く</a>
</p>
<p style="font-size:13px;color:#777;text-align:center;">※レビュー投稿で次回使える 5%オフクーポンプレゼント</p>`),
  },
  {
    id: 'lib_event_1',
    name: 'イベント・ポップアップ告知',
    category: 'event',
    thumbnail: '🎪',
    description: '実店舗イベント・ポップアップ・展示会の告知',
    subject: '【イベント】{{name}}さんに会えるのを楽しみにしています 🎪',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、イベントのお知らせです 🎪</h1>
<p>このたび、オリゼがイベントに出店いたします。</p>
<div style="background:white;border:2px solid ${ORYZAE_LIGHT};padding:24px;border-radius:8px;margin:24px 0;">
  <p style="margin:0 0 8px;color:${ORYZAE_GREEN};font-weight:bold;font-size:18px;">[イベント名]</p>
  <p style="margin:8px 0;font-size:14px;"><strong>日時:</strong> [日付・時間]</p>
  <p style="margin:8px 0;font-size:14px;"><strong>場所:</strong> [会場]</p>
  <p style="margin:8px 0 0;color:#555;">[イベント内容]</p>
</div>
<p>{{name}}さんにお会いできるのを、スタッフ一同楽しみにしております。</p>`),
  },
  {
    id: 'lib_thanks_1',
    name: '感謝のメッセージ',
    category: 'thanks',
    thumbnail: '🙏',
    description: '記念日・誕生日・節目に送る感謝のお便り',
    subject: '{{name}}さん、ありがとうございます 🙏',
    body_html: wrap(`
<div style="text-align:center;padding:40px 0;">
  <p style="font-size:48px;margin:0;">🌾</p>
  <h1 style="margin:16px 0;color:${ORYZAE_GREEN};">ありがとうございます</h1>
  <p style="color:#555;">{{name}}さんへ、心より感謝を込めて</p>
</div>
<p>いつもオリゼをご愛顧いただき、ありがとうございます。</p>
<p>{{name}}さんのおかげで、私たちは「米麹発酵で日本の食卓を豊かに」というミッションを今日も追いかけ続けることができています。</p>
<p>これからもどうぞよろしくお願いいたします。</p>
<p style="text-align:right;margin-top:32px;color:#777;">株式会社オリゼ 一同</p>`),
  },
  {
    id: 'lib_segment_1',
    name: 'セグメント別動的コンテンツ例',
    category: 'advanced',
    thumbnail: '🎯',
    description: '購入実績・VIP・初回など顧客属性で内容を出し分け',
    subject: '{{name}}さん、あなたへのご案内 🎯',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、こんにちは 🎯</h1>

{{#if is_vip}}
<div style="background:#FFFAF0;padding:20px;border-left:4px solid #FFD700;margin:24px 0;">
  <p style="margin:0;font-weight:bold;color:${ORYZAE_GREEN};">💎 VIP会員様限定特典</p>
  <p style="margin:8px 0 0;">通常より20%お得な VIP プライス</p>
</div>
{{/if}}

{{#if has_purchased}}
<p>いつもご購入ありがとうございます。</p>
{{#if ltv >= 30000}}
<p>累計ご購入額 {{ltv_yen}} 達成、誠にありがとうございます！</p>
{{/if}}
{{#else}}
<p>はじめまして、オリゼです。<br>初回ご購入の方には、5%オフクーポンをご用意しています。</p>
{{/if}}

{{#if has_line}}
<p>📱 LINE 公式アカウントでも、最新情報を発信しています。</p>
{{/if}}

<p style="text-align:center;margin:32px 0;">
  <a href="https://oryzae.shop?utm_source=ferment" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:12px 32px;text-decoration:none;border-radius:6px;">商品を見る</a>
</p>`),
  },
  {
    id: 'lib_cart_1',
    name: 'カゴ落ちリマインド',
    category: 'cart',
    thumbnail: '🛒',
    description: 'カートに商品を残したまま離脱したお客様へ',
    subject: '{{name}}さん、カートに残っていますよ 🛒',
    body_html: wrap(`
<h1 style="color:${ORYZAE_GREEN};">{{name}}さん、カートをご確認ください 🛒</h1>
<p>先ほどはオリゼをご覧いただきありがとうございます。</p>
<p>カートに商品が残っているようです。<br>在庫があるうちに、ぜひお求めください。</p>
<p style="text-align:center;margin:32px 0;">
  <a href="https://oryzae.shop/cart?utm_source=ferment&utm_campaign=cart_recovery" style="display:inline-block;background:${ORYZAE_GREEN};color:white;padding:12px 32px;text-decoration:none;border-radius:6px;font-weight:bold;">カートに戻る</a>
</p>
<p style="font-size:13px;color:#777;text-align:center;">※ 24時間以内の購入で送料無料</p>`),
  },
]

export function getTemplateLibraryByCategory(category?: string): TemplateLibraryItem[] {
  if (!category) return TEMPLATE_LIBRARY
  return TEMPLATE_LIBRARY.filter((t) => t.category === category)
}

export function getTemplateLibraryItem(id: string): TemplateLibraryItem | null {
  return TEMPLATE_LIBRARY.find((t) => t.id === id) ?? null
}
