# FERMENT 初期テンプレート案

**方針**：Shopify 内蔵メール / Shopify Flow で担保される領域（注文確認・カゴ落ち・ウェルカム等）は**対象外**。  
FERMENT は **LINE × Email 横断配信**・**ニュースレター**・**休眠復帰**・**LINE友だち限定オファー** を担う。

---

## ① 月次ニュースレター

| 項目 | 値 |
|------|----|
| カテゴリ | `newsletter` |
| 言語 | `ja` |
| AI パーソナライズ | OFF（全員同一内容） |
| 対象セグメント | 全メール購読顧客 |
| 件名 | `【{{month}}月のオリゼ便り】{{topic}} 🌾` |
| 配信頻度 | 月1回（月初） |

**HTML 本文（骨子）**：
```html
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #333;">
  <h1 style="color: #225533; font-size: 22px;">{{name}}さん、{{month}}月のオリゼ便りです 🌾</h1>

  <p>いつもオリゼ商品をご愛顧いただき、ありがとうございます。</p>

  <h2 style="color: #225533; font-size: 18px; border-bottom: 2px solid #C8DCC8; padding-bottom: 6px;">今月のお知らせ</h2>
  <p>[ここに今月の主な話題を記載]</p>

  <h2 style="color: #225533; font-size: 18px; border-bottom: 2px solid #C8DCC8; padding-bottom: 6px;">新商品・再入荷</h2>
  <p>[商品紹介]</p>

  <h2 style="color: #225533; font-size: 18px; border-bottom: 2px solid #C8DCC8; padding-bottom: 6px;">発酵のはなし</h2>
  <p>[発酵コラム / レシピ紹介]</p>

  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0 16px;">
  <p style="font-size: 11px; color: #999;">
    配信停止は <a href="{{unsubscribe_url}}" style="color: #999;">こちら</a>
  </p>
</body>
</html>
```

---

## ② 新商品ローンチ告知

| 項目 | 値 |
|------|----|
| カテゴリ | `launch` |
| AI パーソナライズ | ON（過去購入履歴に応じて冒頭文を変化） |
| 対象セグメント | 「メール購読中 かつ 累計購入¥3,000以上」 |
| 件名 | `{{name}}さん、新商品のお知らせです 🎉` |
| 配信頻度 | 随時 |

**AI システムプロンプト**：
```
あなたはオリゼ（米麹発酵フードテック企業）のマーケティング担当です。
以下の顧客情報をもとに、新商品告知メールの冒頭2〜3文を自然に書いてください。
- 丁寧だが親しみのある文体
- 絵文字は最大1つ
- 過去購入があれば「〇〇を気に入ってくださった方に、ぜひ」のように繋げる
- 購入履歴がなければ「初めての方にもおすすめ」のように

出力は冒頭2〜3文のみ（本文の商品詳細はシステム側で追加）。
```

**ベース HTML**：
```html
<h1 style="color: #225533;">{{ai_intro}}</h1>
<!-- ai_intro は personalize.ts が埋め込む -->

<div style="border: 2px solid #C8DCC8; padding: 16px; border-radius: 8px;">
  <h2>[新商品名]</h2>
  <p>[商品説明]</p>
  <a href="[商品URL]?utm_source=ferment&utm_medium=email&utm_campaign=launch"
     style="display: inline-block; background: #225533; color: white; padding: 10px 24px; text-decoration: none; border-radius: 4px;">
    詳しく見る
  </a>
</div>
```

---

## ③ 休眠復帰キャンペーン

| 項目 | 値 |
|------|----|
| カテゴリ | `winback` |
| AI パーソナライズ | ON（最終購入商品をもとに再購入を促す） |
| 対象セグメント | 「最終注文 90日超 かつ メール購読中 かつ 累計購入あり」 |
| 件名 | `{{name}}さん、お久しぶりです 🌾 特別クーポンのお知らせ` |
| 配信頻度 | 月1回 自動フロー |

**セグメントルール（JSON）**：
```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 },
    { "field": "order_count", "operator": ">=", "value": 1 },
    { "field": "last_order_at", "operator": "older_than_days", "value": 90 }
  ]
}
```

**AI システムプロンプト**：
```
90日以上購入のないお客様への復帰促進メールです。
- タグ情報に最終購入商品があれば言及する（「最後にご購入いただいた〇〇はいかがでしたか？」）
- 押し付けがましくない文体
- 15%オフクーポン（コード: WINBACK15）を案内
- 本文は200文字以内
```

---

## ④ LINE友だち限定オファー

| 項目 | 値 |
|------|----|
| カテゴリ | `line_exclusive` |
| AI パーソナライズ | OFF |
| 対象セグメント | 「LINE 友だち かつ メール購読中」 |
| 件名 | `【LINE友だち限定】{{name}}さんへ特別のご案内 🎁` |
| 配信頻度 | 月1〜2回 |

**特徴**：
- LINE で既に繋がっている顧客に「メール限定では無く LINE×メール 両方で特別扱い」のメッセージ
- ロイヤルティ会員ランクに応じた特典変化

**HTML 骨子**：
```html
<h1>{{name}}さん、いつもLINEでお繋がりいただきありがとうございます 🌾</h1>

<p>この特別オファーは、LINEとメール両方でオリゼと繋がってくださっている方だけにお届けしています。</p>

<!-- ランク別特典（customers.tags に rank:プラチナ 等が入っている場合のみ） -->
<div style="background: #FFF9E5; padding: 16px; border-left: 4px solid #FFD700;">
  <h3>[ランク名]会員様への特別特典</h3>
  <p>[特典内容]</p>
</div>
```

---

## 作成手順

1. 管理画面 `/email/templates` → 「+ 新規作成」
2. 上記の内容をコピー&ペースト
3. プレビューで表示確認
4. 本番配信前に自分宛て（小泉さんのメール）にテスト配信

---

## セグメント事前作成

テンプレート作成後、以下4つのセグメントを `/segments` で作成：

### セグメント1：全メール購読顧客
```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 }
  ]
}
```

### セグメント2：購入実績あり（¥3,000以上）
```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 },
    { "field": "ltv", "operator": ">=", "value": 3000 }
  ]
}
```

### セグメント3：休眠顧客（90日超）
```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 },
    { "field": "order_count", "operator": ">=", "value": 1 },
    { "field": "last_order_at", "operator": "older_than_days", "value": 90 }
  ]
}
```

### セグメント4：LINE × Email 両方で繋がっている顧客
```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 },
    { "field": "line_user_id", "operator": "is_not_null" }
  ]
}
```

---

## Resend プラン見積もり

| 配信 | 月間通数 |
|------|---------|
| ①ニュースレター（月1回 × 全購読者約10,000） | 10,000 |
| ②新商品告知（月0〜1回 × 約5,000人） | 5,000 |
| ③休眠復帰（月1回 × 約2,000人） | 2,000 |
| ④LINE限定（月2回 × 約3,000人） | 6,000 |
| **合計** | **約23,000通/月** |

→ **Resend Pro $20/月（50,000通）で余裕あり** ✅

---

*最終更新: 2026-04-24 / 方針: Shopify 内蔵 + Shopify Flow との併用*
