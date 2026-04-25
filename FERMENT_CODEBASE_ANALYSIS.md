# FERMENT コードベース調査結果

調査日: 2026-04-24

---

## 1. リポジトリ構成

```
line-crm/
├── apps/
│   ├── web/              # Next.js 15 管理画面 (src/app/ に App Router)
│   └── worker/           # Cloudflare Workers + Hono API
├── packages/
│   ├── db/               # D1 スキーマ & クエリヘルパー (@line-crm/db)
│   ├── line-sdk/         # LINE Messaging API ラッパー (@line-crm/line-sdk)
│   ├── shared/           # 共有型定義 (@line-crm/shared)
│   ├── sdk/              # 外部向け SDK
│   ├── mcp-server/       # MCP サーバー
│   └── create-line-harness/ # セットアップスクリプト
├── scripts/              # バックフィル・移行スクリプト
├── wrangler.toml         # apps/worker/wrangler.toml
└── pnpm-workspace.yaml
```

---

## 2. 既存 `friends` テーブル カラム一覧

```sql
id               TEXT PRIMARY KEY          -- crypto.randomUUID() で生成
line_user_id     TEXT UNIQUE NOT NULL
display_name     TEXT
picture_url      TEXT
status_message   TEXT
is_following     INTEGER NOT NULL DEFAULT 1
user_id          TEXT                       -- users テーブルとの紐付け
score            INTEGER NOT NULL DEFAULT 0
created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
```

補足: Round 2 以降で追加されたカラム（metadata, ref_code 等）は
`packages/db/migrations/004_friend_metadata.sql` 等で追加されている可能性あり。
FERMENT の `customers` テーブルは `line_user_id` で `friends` と JOIN できる。

---

## 3. broadcast 送信ロジックの中核ファイル

- **API エンドポイント**: `apps/worker/src/routes/broadcasts.ts`
- **送信サービス**: `apps/worker/src/services/broadcast.ts`
- **セグメント送信**: `apps/worker/src/services/segment-send.ts`
- **セグメントクエリ**: `apps/worker/src/services/segment-query.ts`

`/api/broadcasts/:id/send` の実装は `broadcast.ts` サービスの
`processBroadcastSend()` を呼び出している。

---

## 4. Cron Trigger の既存フック

**ファイル**: `apps/worker/src/index.ts` - `scheduled()` 関数

実行される処理:
- `processStepDeliveries()` — シナリオステップ配信
- `processScheduledBroadcasts()` — 予約ブロードキャスト
- `processReminderDeliveries()` — リマインダー配信
- `checkAccountHealth()` — アカウント健全性チェック
- `refreshLineAccessTokens()` — トークン更新
- `processLoyaltyExpirations()` — ロイヤルティポイント期限切れ処理

**現在の cron 設定**: `"*/5 * * * *"` (5分毎)

FERMENT の cron は `event.cron` で分岐して追加する。

---

## 5. 環境変数・シークレットの命名規則

### wrangler.toml [vars]（秘匿不要）
```toml
SHOPIFY_SHOP_DOMAIN = "yasuhide-koizumi.myshopify.com"
```

### wrangler secret（シークレット）
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `API_KEY`
- `LIFF_URL`
- `LINE_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `WORKER_URL`
- `SHOPIFY_ADMIN_TOKEN`（任意）

### FERMENT で追加が必要なシークレット
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `SLACK_WEBHOOK_URL`
- `FERMENT_SHOPIFY_WEBHOOK_SECRET`

---

## 6. 既存 API ルーティング（変更禁止）

| エンドポイント | ファイル |
|---|---|
| `POST /webhook` | routes/webhook.ts |
| `/api/friends/*` | routes/friends.ts |
| `/api/tags/*` | routes/tags.ts |
| `/api/scenarios/*` | routes/scenarios.ts |
| `/api/broadcasts/*` | routes/broadcasts.ts |
| `/api/users/*` | routes/users.ts |
| `/api/line-accounts/*` | routes/line-accounts.ts |
| `/api/conversions/*` | routes/conversions.ts |
| `/api/affiliates/*` | routes/affiliates.ts |
| `/api/webhooks/*` | routes/webhooks.ts |
| `/api/calendar/*` | routes/calendar.ts |
| `/api/reminders/*` | routes/reminders.ts |
| `/api/scoring/*` | routes/scoring.ts |
| `/api/templates/*` | routes/templates.ts ← LINE テンプレート |
| `/api/chats/*` | routes/chats.ts |
| `/api/notifications/*` | routes/notifications.ts |
| `/api/staff/*` | routes/staff.ts |
| `/api/loyalty/*` | routes/loyalty.ts |
| `/api/rewards/*` | routes/rewards.ts |

**注意**: `/api/templates/*` は LINE メッセージテンプレート用。
FERMENT のメールテンプレートは `/api/email/templates/*` に配置。

---

## 7. 認証方式

```typescript
// apps/worker/src/middleware/auth.ts
// Authorization: Bearer <API_KEY> ヘッダー
// staff_members テーブルの API キーも使用可
```

スキップパスは auth.ts で管理。FERMENT の追加スキップパス:
- `/webhook/resend` (署名検証を使用)
- `/webhook/shopify/*` (共有シークレット検証)
- `/email/unsubscribe` (署名付きトークン)
- `/email/view/*` (トラッキングピクセル)

---

## 8. ID 生成方式

既存コード: `crypto.randomUUID()` を使用。
FERMENT では指示書の命名規則に従い、プレフィックス付きで生成:

```typescript
function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
// 例: cu_4a3b2c1d0e9f, tpl_8f7e6d5c4b3a
```

---

## 9. 既存マイグレーション一覧

最新: `020_loyalty_settings_v2.sql`
次番号: `021_ferment.sql`

---

## 10. DB パッケージ利用パターン

```typescript
// packages/db/src/index.ts にクエリヘルパーをエクスポート
// Worker から import { getXxx, createXxx } from '@line-crm/db' で利用
```

FERMENT の DB クエリヘルパーは:
`packages/db/src/ferment.ts` に実装し
`packages/db/src/index.ts` から re-export する。

---

## 11. Next.js 管理画面

- **フレームワーク**: Next.js 15 App Router
- **スタイル**: Tailwind CSS v4
- **配置**: `apps/web/src/app/`
- **既存ページ**: friends, broadcasts, scenarios, tags, chats, loyalty, staff 等

FERMENT 追加ページ:
- `src/app/email/` (templates, campaigns, flows, logs)
- `src/app/segments/`
- `src/app/customers/`
- `src/app/dashboard/`

---

## 12. 未調査・要確認事項

- `friends` テーブルの追加カラム（Round 2〜4 で追加分）は migrations を要確認
- Shopify 連携の既存実装 (`services/shopify.ts`) の詳細
- Google Sheets 連携の有無

---

## 調査結論

FERMENT は以下の方針で実装:
1. 既存コードへの変更は最小限（index.ts へのルート追加 + auth.ts のスキップパス追加のみ）
2. 全新機能は `apps/worker/src/ferment/` ディレクトリに集約
3. DB クエリヘルパーは `packages/db/src/ferment.ts` に追加
4. 新規パッケージ: `packages/email-sdk`, `packages/ai-sdk`
