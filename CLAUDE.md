# LINE Harness — Claude Code 引き継ぎガイド

株式会社オリゼが運用するLINE CRM。Cloudflare Workers + D1 (SQLite) + Next.js 15。

## システム概要

| 層 | 場所 | 技術 | URL |
|---|---|---|---|
| 管理画面 (フロント) | `apps/web/` | Next.js 15 (App Router) | https://yasuhidekoizumi-afk.github.io/line-crm/ |
| API (バックエンド) | `apps/worker/` | Cloudflare Workers + Hono | https://oryzae-line-crm.oryzae.workers.dev |
| データベース | `packages/db/` | Cloudflare D1 (SQLite) | — |

---

## よくある修正パターン

### UI・画面を変えたい

```
apps/web/src/app/(dashboard)/  ← 各ページのディレクトリ
apps/web/src/components/       ← 共通コンポーネント
```

例：友だち一覧ページを変えたい → `apps/web/src/app/(dashboard)/friends/`

### APIの動作を変えたい（バックエンド）

```
apps/worker/src/routes/  ← 機能ごとのAPIファイル
```

主なファイル：

| ファイル | 機能 |
|---|---|
| `friends.ts` | 友だち管理 |
| `broadcasts.ts` | ブロードキャスト配信 |
| `scenarios.ts` | ステップ配信 |
| `chats.ts` | チャット・CS |
| `loyalty.ts` | ロイヤルティポイント |
| `tags.ts` | タグ管理 |
| `automations.ts` | IF-THEN自動化 |

### テーブル・DBを変えたい

```
packages/db/migrations/  ← SQLファイルを追加する
```

新しいカラムやテーブルを追加する場合は、番号を続けて新しいSQLファイルを作る。
例：`036_xxx.sql`

---

## デプロイ手順

### バックエンド（API）を変更した場合

```bash
cd apps/worker
pnpm deploy
```

### 管理画面（フロント）を変更した場合

```bash
# ルートディレクトリから
pnpm deploy:web
git add apps/web/out
git commit -m "deploy: 管理画面を更新"
git push
```

GitHub Pagesが自動で `apps/web/out/` を公開する。

### DBマイグレーション（テーブル変更）

```bash
# 本番に適用
wrangler d1 execute LINE_CRM_DB --file=packages/db/migrations/XXX_xxx.sql
```

**注意：一度実行したマイグレーションは取り消せない。必ず内容を確認してから実行する。**

---

## 開発環境のセットアップ

```bash
# 依存関係インストール
pnpm install

# バックエンド開発サーバー起動
pnpm dev:worker

# 管理画面開発サーバー起動
pnpm dev:web
```

---

## 環境変数・シークレット

秘匿情報（APIキー等）はコードに書かず、Cloudflare Workers の Secret として管理している。
値の確認・変更は Cloudflare ダッシュボード または以下コマンドで行う：

```bash
wrangler secret put シークレット名
```

主なシークレット一覧：

| 名前 | 用途 |
|---|---|
| `LINE_CHANNEL_SECRET` | LINE Webhook署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE APIアクセス |
| `API_KEY` | 管理画面ログイン認証 |
| `SHOPIFY_ADMIN_TOKEN` | Shopify API |
| `ANTHROPIC_API_KEY` | Claude AI（下書き生成等） |
| `RESEND_API_KEY` | メール送信 |

---

## やってはいけないこと

- `wrangler.toml` に API キーやトークンを直接書かない（`[vars]` は公開情報のみ）
- マイグレーションSQLで既存カラムを `DROP` しない（データが消える）
- `main` ブランチに直接 push してデプロイする場合は動作確認後に行う

---

## 困ったときの確認先

- **Workerのログをリアルタイムで見る**: `wrangler tail --format=pretty`
- **Cloudflareダッシュボード**: https://dash.cloudflare.com （Workers & Pages → oryzae-line-crm）
- **コードの場所がわからない場合**: Claude Codeに「〇〇の機能はどのファイルにありますか？」と聞く
