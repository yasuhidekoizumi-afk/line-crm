# 誕生日トリガー配信 — LINE配信文面集

> 作成: 2026-06-08 / 更新: 2026-06-29 / 対象: 誕生日当日トリガー配信
> 構成: 2特典（送料無料 / 500円OFF）× LINE Flex
> トーン: 既存の誕生日登録通知に合わせる（絵文字＋親しみやすい敬体・`さん`付け）
> ⚠️ 文面ルール: **送料無料ラインには触れない**（500円OFF側で5,300円カートを誘発しないため）

対象は **LINE連携後に誕生日登録した顧客**。メール代替配信はしない。

変数: `{{name}}`=表示名 / `{{code}}`=クーポンコード / `{{expire}}`=有効期限日（誕生日+14日）

## LINE配信形式：Flex（画像カード）

- **hero画像**（お祝いメッセージ焼き込み済み・水彩イラスト版 `_53`）:
  `https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png`
- お祝い文は画像が担うため、Flexテキストは「{{name}}さんへ＋クーポン情報」に特化
- ボタンは `https://oryzae.shop/discount/{{code}}` へ遷移し、クーポンを自動適用する
- altText は `{{name}}さん、お誕生日おめでとうございます🎂`

---

## パターンA：送料無料クーポン（直近注文額 5,000円未満の層）

### テキスト確認用

```text
{{name}}さんへ

オリゼからの誕生日プレゼント🎁

🚚 送料無料クーポン
クーポンコード：{{code}}
有効期限：{{expire}}まで

発酵のようにゆっくり豊かに育ちますように🌾

ボタンを押すとクーポンが自動で適用されます🎁
```

### Flex差分

- 冒頭コピー: `オリゼからの誕生日プレゼント🎁`
- クーポン名: `🚚 送料無料クーポン`
- ボタンラベル: `クーポンを使ってお買い物`

---

## パターンB：500円OFFクーポン（直近注文額 5,000円以上の層）

### テキスト確認用

```text
{{name}}さんへ

いつものご愛顧に感謝を込めて🎁

💰 500円OFFクーポン
クーポンコード：{{code}}
有効期限：{{expire}}まで

発酵のようにゆっくり豊かに育ちますように🌾

ボタンを押すとクーポンが自動で適用されます🎁
```

### Flex差分

- 冒頭コピー: `いつものご愛顧に感謝を込めて🎁`
- クーポン名: `💰 500円OFFクーポン`
- ボタンラベル: `クーポンを使ってお買い物`
- **送料無料ラインには一切触れない**

---

## 実配信JSONの形

`apps/worker/src/services/birthday-coupon.ts` の `buildBirthdayFlex()` が実配信の正です。共通構造は以下。

```json
{
  "type": "bubble",
  "hero": {
    "type": "image",
    "url": "https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png",
    "size": "full",
    "aspectRatio": "1:1",
    "aspectMode": "cover"
  },
  "body": {
    "type": "box",
    "layout": "vertical",
    "spacing": "md",
    "paddingAll": "18px",
    "contents": [
      { "type": "text", "text": "{{name}}さんへ", "weight": "bold", "size": "md", "color": "#5c4a2e" },
      { "type": "text", "text": "オリゼからの誕生日プレゼント🎁 / いつものご愛顧に感謝を込めて🎁", "size": "sm", "color": "#8a7a5c", "wrap": true },
      {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "margin": "md",
        "paddingAll": "14px",
        "backgroundColor": "#FBF6EC",
        "cornerRadius": "10px",
        "contents": [
          { "type": "text", "text": "🚚 送料無料クーポン / 💰 500円OFFクーポン", "weight": "bold", "size": "md", "color": "#5c4a2e" },
          { "type": "text", "text": "クーポンコード", "size": "xs", "color": "#8a7a5c", "margin": "sm" },
          { "type": "text", "text": "{{code}}", "size": "sm", "weight": "bold", "color": "#5c4a2e", "wrap": true },
          { "type": "text", "text": "有効期限：{{expire}}まで", "size": "xs", "color": "#8a7a5c", "margin": "sm" }
        ]
      },
      { "type": "text", "text": "発酵のようにゆっくり豊かに育ちますように🌾", "size": "xs", "color": "#8a7a5c", "wrap": true, "margin": "md" }
    ]
  },
  "footer": {
    "type": "box",
    "layout": "vertical",
    "spacing": "sm",
    "paddingAll": "14px",
    "contents": [
      {
        "type": "button",
        "style": "primary",
        "color": "#C9A86A",
        "action": {
          "type": "uri",
          "label": "クーポンを使ってお買い物",
          "uri": "https://oryzae.shop/discount/{{code}}"
        }
      },
      { "type": "text", "text": "ボタンを押すとクーポンが自動で適用されます🎁", "size": "xxs", "color": "#8a7a5c", "wrap": true, "align": "center" }
    ]
  }
}
```

## 文面メモ

- **送料無料ラインに触れない**ルールを徹底する
- 締めは **「発酵のようにゆっくり豊かに育ちますように🌾」** で統一
- A/B共通で「条件なし」なので利用条件の記載はしない
- メール代替配信はしない
