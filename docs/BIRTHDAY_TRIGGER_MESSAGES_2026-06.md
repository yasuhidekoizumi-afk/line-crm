# 誕生日トリガー配信 — 配信文面集

> 作成: 2026-06-08 / 対象: 誕生日当日トリガー配信
> 構成: 2特典（送料無料 / 500円OFF）× 2チャネル（LINE / メール）
> トーン: 既存の誕生日登録通知に合わせる（絵文字＋親しみやすい敬体・`さん`付け）
> ⚠️ 文面ルール: **送料無料ラインには触れない**（500円OFF側で5,300円カートを誘発しないため）

変数: `{{name}}`=表示名 / `{{code}}`=クーポンコード / `{{expire}}`=有効期限日（誕生日+14日）

## LINE配信形式：Flex（画像カード）で確定
- **hero画像**（お祝いメッセージ焼き込み済み・水彩イラスト版 `_53`）:
  `https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png`
- お祝い文は画像が担うため、Flexテキストは「{{name}}さんへ＋クーポン情報」に特化
- 名前入りでパーソナルに。ボタンで `https://oryzae.shop` へ遷移
- 下記の「LINE」節はテキストフォールバック兼altText用。実配信はFlex JSONを使う

---

## パターンA：送料無料クーポン（直近注文額 5,000円未満の層）

### A-1. LINE

```
🎂 {{name}}さん、お誕生日おめでとうございます！

オリゼからの誕生日プレゼントとして
「送料無料クーポン」をお届けします🎁

🚚 送料無料クーポン
コード：{{code}}
有効期限：{{expire}}まで

いつも応援いただきありがとうございます。
{{name}}さんの新しい1年が、発酵のように
ゆっくり豊かに育ちますように🌾

▼お買い物はこちら
https://oryzae.shop
```

### A-2. メール

件名：`🎂 {{name}}さん、お誕生日おめでとうございます（送料無料クーポン）`

本文：
```
{{name}}さん

お誕生日おめでとうございます🎂

日頃の感謝を込めて、オリゼから
「送料無料クーポン」をお届けします。

─────────────
🚚 送料無料クーポン
コード：{{code}}
有効期限：{{expire}}まで
─────────────

ご注文時にクーポンコードをご入力ください。

{{name}}さんの新しい1年が、
発酵のようにゆっくり豊かに育ちますように🌾

これからもオリゼをよろしくお願いいたします。

オリゼ
https://oryzae.shop
```

---

## パターンB：500円OFFクーポン（直近注文額 5,000円以上の層）

### B-1. LINE

```
🎂 {{name}}さん、お誕生日おめでとうございます！

いつもたくさんのご愛顧をありがとうございます。
感謝を込めて「500円OFFクーポン」をお届けします🎁

💰 500円OFFクーポン
コード：{{code}}
有効期限：{{expire}}まで

{{name}}さんの新しい1年が、発酵のように
ゆっくり豊かに育ちますように🌾

▼お買い物はこちら
https://oryzae.shop
```

### B-2. メール

件名：`🎂 {{name}}さん、お誕生日おめでとうございます（500円OFFクーポン）`

本文：
```
{{name}}さん

お誕生日おめでとうございます🎂

いつもオリゼをご愛顧いただき、
本当にありがとうございます。

感謝を込めて、500円OFFクーポンをお届けします。

─────────────
💰 500円OFFクーポン
コード：{{code}}
有効期限：{{expire}}まで
─────────────

ご注文時にクーポンコードをご入力ください。

{{name}}さんの新しい1年が、
発酵のようにゆっくり豊かに育ちますように🌾

これからもオリゼをよろしくお願いいたします。

オリゼ
https://oryzae.shop
```

---

---

## Flex Message JSON（実配信用）

共通: hero画像は上記URL。altTextは「{{name}}さん、お誕生日おめでとうございます🎂」。

### パターンA：送料無料クーポン（Flex）

```json
{
  "type": "flex",
  "altText": "{{name}}さん、お誕生日おめでとうございます🎂 送料無料クーポンをお届けします",
  "contents": {
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
        { "type": "text", "text": "オリゼからの誕生日プレゼント🎁", "size": "sm", "color": "#8a7a5c", "wrap": true },
        {
          "type": "box", "layout": "vertical", "spacing": "sm", "margin": "md",
          "paddingAll": "14px", "backgroundColor": "#FBF6EC", "cornerRadius": "10px",
          "contents": [
            { "type": "text", "text": "🚚 送料無料クーポン", "weight": "bold", "size": "md", "color": "#5c4a2e" },
            { "type": "box", "layout": "baseline", "contents": [
              { "type": "text", "text": "コード", "size": "sm", "color": "#8a7a5c", "flex": 2 },
              { "type": "text", "text": "{{code}}", "size": "sm", "weight": "bold", "color": "#5c4a2e", "flex": 5, "align": "end" }
            ]},
            { "type": "box", "layout": "baseline", "contents": [
              { "type": "text", "text": "有効期限", "size": "sm", "color": "#8a7a5c", "flex": 2 },
              { "type": "text", "text": "{{expire}}まで", "size": "sm", "weight": "bold", "color": "#5c4a2e", "flex": 5, "align": "end" }
            ]}
          ]
        },
        { "type": "text", "text": "発酵のようにゆっくり豊かに育ちますように🌾", "size": "xs", "color": "#8a7a5c", "wrap": true, "margin": "md" }
      ]
    },
    "footer": {
      "type": "box", "layout": "vertical", "paddingAll": "14px",
      "contents": [
        { "type": "button", "style": "primary", "color": "#C9A86A",
          "action": { "type": "uri", "label": "お買い物はこちら", "uri": "https://oryzae.shop" } }
      ]
    }
  }
}
```

### パターンB：500円OFFクーポン（Flex）

A との差分は、クーポン名「💰 500円OFFクーポン」と冒頭コピーのみ。**送料無料には一切触れない**。

```json
{
  "type": "flex",
  "altText": "{{name}}さん、お誕生日おめでとうございます🎂 500円OFFクーポンをお届けします",
  "contents": {
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
        { "type": "text", "text": "いつものご愛顧に感謝を込めて🎁", "size": "sm", "color": "#8a7a5c", "wrap": true },
        {
          "type": "box", "layout": "vertical", "spacing": "sm", "margin": "md",
          "paddingAll": "14px", "backgroundColor": "#FBF6EC", "cornerRadius": "10px",
          "contents": [
            { "type": "text", "text": "💰 500円OFFクーポン", "weight": "bold", "size": "md", "color": "#5c4a2e" },
            { "type": "box", "layout": "baseline", "contents": [
              { "type": "text", "text": "コード", "size": "sm", "color": "#8a7a5c", "flex": 2 },
              { "type": "text", "text": "{{code}}", "size": "sm", "weight": "bold", "color": "#5c4a2e", "flex": 5, "align": "end" }
            ]},
            { "type": "box", "layout": "baseline", "contents": [
              { "type": "text", "text": "有効期限", "size": "sm", "color": "#8a7a5c", "flex": 2 },
              { "type": "text", "text": "{{expire}}まで", "size": "sm", "weight": "bold", "color": "#5c4a2e", "flex": 5, "align": "end" }
            ]}
          ]
        },
        { "type": "text", "text": "発酵のようにゆっくり豊かに育ちますように🌾", "size": "xs", "color": "#8a7a5c", "wrap": true, "margin": "md" }
      ]
    },
    "footer": {
      "type": "box", "layout": "vertical", "paddingAll": "14px",
      "contents": [
        { "type": "button", "style": "primary", "color": "#C9A86A",
          "action": { "type": "uri", "label": "お買い物はこちら", "uri": "https://oryzae.shop" } }
      ]
    }
  }
}
```

---

## 文面メモ
- **送料無料ラインに触れない**ルールを徹底（B側で「5,000円以上で送料無料」を書くと事故帯5,300円カートを誘発するため）
- 締めは **「発酵のようにゆっくり豊かに育ちますように🌾」で4箇所統一**（会社の軸＝発酵に揃えた。LINE/メール・A/B共通の決め台詞）
- LINEはFlexメッセージ（画像付きカード）にもできる。まずはテキストで確定し、デザインは後追いでも可
- 有効期限 `{{expire}}` は誕生日当日+14日を動的に埋め込む
- A/B共通で「条件なし」なので利用条件の記載はしない

## 確認したい点（小泉さん）
1. トーン（絵文字量・「麹のように」の比喩）はこれでよいか
2. 末尾の遷移先 `https://oryzae.shop` でよいか（特定LP誘導にするか）
3. LINEはテキストで始めるか、最初からFlex（画像カード）にするか
