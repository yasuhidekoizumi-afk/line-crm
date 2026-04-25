# FERMENT セットアップガイド

Fermented Email Relationship & Marketing Engine for Nurturing Trust  
**LINE × Email 統合マーケティング基盤**

---

## 目次

1. [前提条件](#前提条件)
2. [Resend 設定（メール送信）](#resend-設定)
3. [D1 マイグレーション実行](#d1-マイグレーション実行)
4. [Cloudflare Workers シークレット設定](#cloudflare-workers-シークレット設定)
5. [wrangler.toml 環境変数設定](#wranglertoml-環境変数設定)
6. [Shopify Flow 連携設定](#shopify-flow-連携設定)
7. [動作確認チェックリスト](#動作確認チェックリスト)
8. [初回テンプレート作成](#初回テンプレート作成)

---

## 前提条件

| 必要なもの | 用途 |
|-----------|------|
| [Resend](https://resend.com) アカウント | メール送信 API |
| Cloudflare Workers（既存） | バックエンド |
| Shopify（JP + US） | 注文・顧客イベント連携 |
| Anthropic API キー（既存） | AI パーソナライズ |
| Gemini API キー（既存） | 件名バリアント生成 |

---

## Resend 設定

### 1. アカウント作成・ドメイン認証

1. [resend.com](https://resend.com) にアクセスしてアカウント作成
2. **Domains** → **Add Domain** → `oryzae.site`（または送信に使うドメイン）を追加
3. 表示される DNS レコードを CloudFlare DNS に追加：

```
# Resend が提示するレコード例（実際の値は Resend ダッシュボードで確認）
TXT  send._domainkey.oryzae.site  →  Resend提示のDKIMキー
TXT  oryzae.site                  →  "v=spf1 include:amazonses.com ~all"
CNAME resend._domainkey.oryzae.site → Resend提示のCNAME
MX  feedback.oryzae.site          →  feedback-smtp.us-east-1.amazonses.com (priority: 10)
```

4. **Verify Domain** をクリックして認証完了を確認（最大10分）

### 2. API キー発行

1. Resend ダッシュボード → **API Keys** → **Create API Key**
2. 名前: `line-crm-production`
3. Permission: **Full Access**
4. キーをコピーして保管（後述のシークレット設定で使用）

### 3. Webhook 設定

1. Resend ダッシュボード → **Webhooks** → **Add Endpoint**
2. URL: `https://your-worker.workers.dev/webhook/resend`
3. Events を全て選択:
   - `email.sent`, `email.delivered`, `email.opened`, `email.clicked`
   - `email.bounced`, `email.complained`, `email.delivery_delayed`
4. **Signing Secret** をコピーして保管（後述のシークレット設定で使用）

---

## D1 マイグレーション実行

```bash
# プロジェクトルートから
cd /path/to/line-crm

# ステージング環境でテスト
wrangler d1 execute LINE_CRM_DB --file=packages/db/migrations/021_ferment.sql

# 本番環境
wrangler d1 execute LINE_CRM_DB --file=packages/db/migrations/021_ferment.sql --env=production

# マイグレーション確認
wrangler d1 execute LINE_CRM_DB --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'email_%' OR name IN ('customers','segments','events')"
```

期待される出力:
```
customers, events, email_templates, email_campaigns, email_flows,
email_flow_steps, email_flow_enrollments, segments, segment_members,
email_logs, email_suppressions
```

---

## Cloudflare Workers シークレット設定

以下のコマンドを1つずつ実行（各コマンド実行後にプロンプトで値を貼り付け）：

```bash
# Resend API キー
wrangler secret put RESEND_API_KEY

# Resend Webhook 署名シークレット
wrangler secret put RESEND_WEBHOOK_SECRET

# Anthropic API キー（Claude）
wrangler secret put ANTHROPIC_API_KEY

# Gemini API キー
wrangler secret put GEMINI_API_KEY

# 配信停止リンク署名シークレット（任意の32文字以上のランダム文字列）
# 例: openssl rand -hex 32
wrangler secret put FERMENT_UNSUBSCRIBE_SECRET

# Shopify Webhook 認証トークン（任意の文字列）
wrangler secret put FERMENT_SHOPIFY_TOKEN

# Slack Incoming Webhook URL（日次サマリー通知用）
wrangler secret put FERMENT_SLACK_WEBHOOK_URL
```

---

## wrangler.toml 環境変数設定

`apps/worker/wrangler.toml` の以下の変数を実際の値に更新：

```toml
[vars]
# JP ストア送信元
FERMENT_FROM_EMAIL_JP = "hello@oryzae.site"
FERMENT_FROM_NAME_JP = "オリゼ"

# US ストア送信元
FERMENT_FROM_EMAIL_US = "hello@oryzae.site"
FERMENT_FROM_NAME_US = "ORYZAE"

# 配信停止リンクのベース URL
FERMENT_UNSUBSCRIBE_BASE_URL = "https://your-worker.workers.dev"
```

---

## Shopify Flow 連携設定

**重要な方針**：注文確認・カゴ落ち・ウェルカム等の**トランザクショナル / 自動化メールは Shopify 内蔵機能 + Shopify Flow で担保**する。  
FERMENT が Shopify Flow と連携するのは **新規顧客の同期（customer_created）** のみ。

### JP ストア：customer_created のみ設定

1. Shopify 管理画面 → **Flow** → **新規ワークフロー作成**
2. **トリガー**: `Customer created`
3. **HTTP リクエスト** アクション追加:
   ```
   URL: https://your-worker.workers.dev/webhook/shopify/jp
   Method: POST
   Headers:
     Content-Type: application/json
     X-Ferment-Token: [FERMENT_SHOPIFY_TOKEN と同じ値]
   Body:
   {
     "event_type": "customer_created",
     "customer_email": "{{customer.email}}",
     "customer_name": "{{customer.displayName}}",
     "shopify_customer_id": "{{customer.id}}",
     "accepts_marketing": "{{customer.emailMarketingConsent.marketingState}}"
   }
   ```

### US ストア

同じトリガー設定（URL は `/webhook/shopify/us`）

### Shopify 側で引き続き使うもの（FERMENT は関与しない）

- **注文確認メール** → Shopify 内蔵
- **出荷通知** → Shopify 内蔵
- **カート放棄リマインド** → Shopify Flow or Abandoned Checkout Email
- **ウェルカムメール（購入直後）** → Shopify Flow

---

## 既存顧客バックフィル

13,073名の LINE 友だちを `customers` テーブルに一括移行：

```bash
# Worker URL と API トークンを環境変数に設定
export WORKER_URL=https://oryzae-line-crm.oryzae.workers.dev
export API_TOKEN=[管理画面ログイン時のBearerトークン]

# 実行（約2時間）
./scripts/ferment/backfill-customers.sh
```

### バックフィル中の処理内容

1. `friends` + `loyalty_points` を LEFT JOIN で取得（50件/バッチ）
2. `shopify_customer_id` があれば Shopify Admin API で以下を取得:
   - `email`
   - `orders_count`
   - `total_spent`（LTV として使用）
   - `tags`
3. `customers` テーブルに upsert（`line_user_id` で重複チェック）
4. Shopify 未紐付けは `email=NULL, subscribed_email=0` で登録（LINE 専用顧客）

### 進捗確認

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
  "$WORKER_URL/api/ferment/backfill/customers/status"
```

---

## 動作確認チェックリスト

デプロイ後、以下を順番に確認：

### メール送信テスト

```bash
# 管理画面から：メールテンプレート → 新規作成 → プレビューボタン
# または API 直接テスト：
curl -X POST https://your-worker.workers.dev/api/email/templates \
  -H "Authorization: Bearer [your-token]" \
  -H "Content-Type: application/json" \
  -d '{"name":"テスト","subject_base":"テストメール","body_html":"<p>テスト</p>","language":"ja","from_name":"テスト"}'
```

### セグメント計算テスト

管理画面 → **セグメント** → 新規作成 → 以下のルールで作成:

```json
{
  "operator": "AND",
  "conditions": [
    { "field": "subscribed_email", "operator": "=", "value": 1 }
  ]
}
```

→ **再計算** ボタンをクリックして件数が表示されれば OK

### キャンペーン配信テスト

1. テンプレート作成（小泉さんのメールアドレスを直接 `email_suppressions` から除外確認）
2. 1人セグメント作成（自分のメールのみ）
3. キャンペーン作成 → **今すぐ配信**
4. Resend ダッシュボードで送信ログ確認

---

## 初回テンプレート作成

詳細な内容は **[FERMENT_TEMPLATES.md](./FERMENT_TEMPLATES.md)** を参照。

作成する4つのテンプレート:

1. **月次ニュースレター** — 全購読者への定期配信
2. **新商品ローンチ告知** — 購入実績ありセグメント向け、AI パーソナライズ
3. **休眠復帰キャンペーン** — 90日超未購入者、AI パーソナライズ
4. **LINE友だち限定オファー** — LINE × Email 両接続顧客向け

**Shopify 内蔵で担保される領域（ウェルカム・カゴ落ち・注文確認）は FERMENT では作成しない**。

---

## Cron スケジュール

`wrangler.toml` で設定済みのスケジュール：

| Cron | 内容 |
|------|------|
| `*/5 * * * *` | 予約キャンペーン処理 + フロー配信（5分毎） |
| `0 * * * *` | セグメント再計算（毎時0分） |
| `0 0 * * *` | 日次サマリー Slack 通知（毎日0時） |

---

## トラブルシューティング

### メールが届かない

1. Resend ダッシュボードで送信ログを確認
2. バウンス・スパム報告がある場合は `email_suppressions` テーブルに追加されている可能性
3. `wrangler tail` でWorkerログをリアルタイム確認：
   ```bash
   wrangler tail --format=pretty
   ```

### セグメント件数が0

- `customers` テーブルにデータが存在するか確認
- Shopify Webhook が正しく届いているか確認（`/webhook/shopify/jp` のレスポンスコードが200か）
- セグメントルールの JSON が正しいか確認（`field` 名が `ALLOWED_FIELDS` に含まれているか）

### AI パーソナライズが機能しない

- `ANTHROPIC_API_KEY` が正しく設定されているか確認
- AI 生成失敗時は自動的にベーステンプレートにフォールバックするため、送信自体は継続される

---

*最終更新: 2026-04-24*
