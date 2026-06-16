# 誕生日トリガー配信 — 実装引き継ぎ書

> 作成: 2026-06-08 / 引き継ぎ元: 小泉＋Claude / 引き継ぎ先: あいさん
> 関連設計書: `BIRTHDAY_TRIGGER_DESIGN.md`（詳細設計）/ `BIRTHDAY_TRIGGER_MESSAGES_2026-06.md`（配信文面・Flex JSON）

---

## 0. これは何か（30秒）

**既存顧客の誕生日"当日"に、LINE（連携済みのみ）で自動配信＋クーポン発行する機能**を新規実装する。
※ Phase 1 は LINE 連携済み（約7,130名）のみが対象。未連携者へのメール配信は Phase 2 で再検討（2026-06-16 河原さん判断）。
- 仕様・文面・画像はすべて確定済み。**残りは実装のみ**。
- 既存の `welcome`（送料無料）・`redeem`（割引コード発行）・日次cron基盤を**流用**でき、ゼロから作る箇所は少ない。

---

## 1. 確定仕様（議論済み・変更不要）

| 項目 | 内容 |
|---|---|
| トリガー | 誕生日**当日**。毎日 `0 0 * * *`（JST 9:00）の日次cronで「今日が誕生日」の顧客を抽出 |
| 対象 | Shopify顧客メタフィールド `facts.birth_date`（YYYY-MM-DD）を持つ既存顧客（1万人以上）|
| **出し分け** | **直近の注文額**で判定：5,000円未満 → 送料無料クーポン / 5,000円以上 → 500円OFFクーポン |
| 有効期限 | 誕生日当日から **14日間**（`starts_at`=誕生日, `ends_at`=+14日）|
| 配信チャネル | **LINE連携済みのみ（Flex push）**。未連携者は Phase 1 では対象外（2026-06-16 河原さん判断） |
| クーポン | **顧客限定（prerequisite_customer_ids）・1回限り（once_per_customer, usage_limit:1）** |
| 冪等性 | **年1回**。同一顧客・同一年に二重発行しないガード必須（最重要） |
| うるう年 | 2/29生まれは平年 **2/28** に配信 |
| 配信文面 | 名前入りパーソナル。Flex（画像カード）。お祝い文は画像が担い、テキストはクーポン情報に特化 |

### なぜこの出し分けか（背景・蒸し返さないために）
- 送料無料クーポンは「1回5,000円未満で買う人」にしか価値がない（**5,000円以上は元々送料無料=無価値**）。
- だから5,000円以上層には500円OFFを渡す。判定軸は**AOV的な「1回あたり購入額」**＝直近注文額で代用（CRMに注文回数列が無く厳密AOVは重いため）。
- ランク（=累計購入額 `total_spent`）で分けるのはNG（毎回少額のヘビーリピーターを誤判定する）。

### ⚠️ 500円OFFの送料復活は「許容」と決定済み
- 5,000円以上層が条件なし500円OFFを使い割引後5,000円を切ると送料480円が復活する（Shopify仕様、`TOTAL_PRICE`=割引後判定、変更不可）。
- 「誕生日は条件なしで気持ちよく」を優先し**利用条件は付けない**。事故帯（5,000〜5,500円購入）は狭いので許容。
- **配信文面で送料無料ラインに触れない**こと（「5,000円以上で送料無料」と書くと事故帯ど真ん中に誘導するため）。

---

## 2. 実装タスク

### 新規ファイル（🟢 自由領域）
**`apps/worker/src/services/birthday-cron.ts`**（新規）。処理の流れ:
1. 今日の月日(MM-DD)を JST で算出（うるう年は2/28に2/29を寄せる）
2. `facts.birth_date` が今日に一致する顧客を抽出（Shopify Admin API or CRM側に保持していればそちら）
3. 各顧客の**直近注文額**を取得 → 5,000円で分岐
4. クーポン発行:
   - 5,000円未満 → **送料無料クーポン**（既存 `welcome` と同型 `DiscountCodeFreeShipping`。顧客限定・1回限り・`ends_at`=+14日）
   - 5,000円以上 → **500円OFFクーポン**（既存 `redeem` の price_rule発行を流用。`value_type:'fixed_amount'`, `value:'-500'`, 顧客限定・1回限り・`ends_at`=+14日）
5. 冪等チェック: この顧客にこの年の誕生日クーポンを発行済みか記録・照合（新規テーブル or メタフィールド or KV）。**未発行のみ発行**
6. 配信: LINE連携済みのみ Flex push（文面は §3）。未連携者はスキップしてログのみ（Phase 1スコープ）

### 既存ファイルへの変更（🟡 確認必須ゾーン = 小泉さんに事前確認）
**`apps/worker/src/index.ts`** の `scheduled()` 内、`0 0 * * *` ブランチに1行追加:
```ts
jobs.push(processBirthdayCoupons(env));  // ← import も追加
```
※ index.ts は🟡確認必須ゾーン。この1行追加は着手前に小泉さんOKを取ること。

### 流用元（コピー元として読むべき既存コード）
- 送料無料クーポンの設定: Shopify `welcome`（`DiscountCodeFreeShipping`・最低条件null・appliesOncePerCustomer=true・累計5,949回稼働中）
- 割引コード発行ロジック: `apps/worker/src/routes/loyalty.ts` の `redeem`（POST `/api/loyalty/shopify/:id/redeem`）。price_rules + discount_codes API で顧客限定コードを動的発行する実装。**`ends_at` は未指定なので+14日を追加する点だけ要対応**
- 誕生日通知の配信経路: `loyalty.ts` の `profile-birthday`（957〜1112行付近）の LINE push / メール送信を流用
- 日次cron: `index.ts` の `scheduled()`（243〜300行付近）

---

## 2.5. 日次cronの仕組み（誕生日処理が乗る土台）

**cronは Cloudflare Workers の Cron Triggers で管理**されている。外部cronサーバーやGASではなく、Cloudflare自身がスケジュール実行する。

### 設定場所: `apps/worker/wrangler.toml`
```toml
[triggers]
crons = ["*/5 * * * *", "0 * * * *", "0 0 * * *"]
```

### 仕組み（4ステップ）
1. `wrangler.toml` に cron式を記載
2. `wrangler deploy` で設定がCloudflareに登録される
3. 指定時刻にCloudflareが Worker の `scheduled()` 関数（`index.ts` 243行目）を自動実行
4. `scheduled()` 内で `event.cron` を見て、どのcronが発火したかで処理を振り分け

### 現在稼働中の3本
| cron式 | 頻度 | 用途 |
|---|---|---|
| `*/5 * * * *` | 5分毎 | LINEステップ配信・ブロードキャスト・FERMENTキャンペーン・異常検知 |
| `0 * * * *` | 1時間毎 | セグメント再計算・Shopify注文マッチング・ポイント整合性チェック |
| **`0 0 * * *`** | **毎日0:00 UTC（＝9:00 JST）** | 日次サマリー・顧客インサイト再計算 |

### 誕生日処理の乗せ方（重要）
- **新しいcron式は追加しない。** 既存の `0 0 * * *`（毎日9:00 JST）ブランチに `processBirthdayCoupons(env)` を1行足すだけ。
- → 配信時刻は実質**毎朝9:00 JST**（誕生日の朝に届く＝良いタイミング）。
- → `wrangler.toml` の編集は**不要**（既存スケジュールに相乗り）。
- ⚠️ ただし**コードを変えたら `wrangler deploy` での本番デプロイが必須**（🟡確認必須ゾーンの操作。本番反映時は小泉さんに確認を取ること）。

---

## 3. 配信文面（確定・`BIRTHDAY_TRIGGER_MESSAGES_2026-06.md` に全文＋Flex JSON）

- **LINE = Flex（画像カード）**。hero画像（お祝い文焼き込み済み・水彩イラスト版）は CRM の R2 にアップロード済み:
  `https://oryzae-line-crm.oryzae.workers.dev/images/448496d1-1d2a-4c06-831f-2c0110b5f6ca.png`
- Flex JSON は送料無料版・500円OFF版の2種を MESSAGES ドキュメントに完成形で記載。変数 `{{name}}` `{{code}}` `{{expire}}` を埋めるだけ。
- ~~メール文面（件名・本文）も A/B 両方 MESSAGES ドキュメントに記載。~~ Phase 1 では**メール配信は実装しない**（MESSAGES ドキュメントのメール文面は Phase 2 想定の参考保管）。
- 締めは全パターン共通「発酵のようにゆっくり豊かに育ちますように🌾」。

---

## 4. テスト手順

1. **冪等性を最優先でテスト**（二重発行は金銭事故）。同じ顧客でcronを2回流して2枚目が発行されないこと。
2. **小泉さんの誕生日を一時的に today に設定**して、抽出→クーポン発行→LINE/メール配信まで一気通貫で動作確認。
3. Flexの見た目を実機（LINE）で確認。
4. うるう年（2/29生まれ）が2/28に寄ることを確認。
5. 送料無料クーポンが既存「5,000円以上送料無料」と**コンフリクトしない**ことを実注文で確認（Shopifyは最安レート自動採用＝二重マイナス/エラーは出ない想定）。

---

## 5. 環境・API・認証メモ

- API ベースURL: `https://oryzae-line-crm.oryzae.workers.dev`
- 認証: `Authorization: Bearer <LINE_HARNESS_API_KEY>`。キーは `~/oryzae/.mcp.json`（git追跡外・ローカル専用）に格納。**コマンドライン直書き禁止**（セキュリティ分類器にブロックされる。ファイルから読む）。
- Worker のデプロイ: `wrangler deploy`（🟡確認必須）。シークレットは `wrangler secret list` で確認可（API_KEY, GEMINI_API_KEY, SHOPIFY系 等は登録済み）。
- 画像生成が必要なら `POST /api/ferment/cockpit/generate-image`（Gemini Nano Banana、$0.15/枚）も使える。
- 画像アップロード: `POST /api/images`（バイナリ or base64、最大5MB）。

### ⛔ 保護ゾーン厳守
- `apps/worker/` は🔴/🟡ゾーン。**新規ファイル追加は🟢だが、index.ts等の既存ファイル編集は🟡（要確認）**。
- `point-charge/src/charge.ts`・`line-crm/apps/worker/` 本番ロジックは無関係な箇所を触らない。
- docsコミット時は対象ファイルを明示`git add`（`git add -A`厳禁＝複数エージェントが同ツリーで動くため）。

---

## 6. 未確定であいさん判断に委ねてよい点

- 直近注文額の取得方法（Shopify Admin API都度取得 / CRM保持データ流用）— 実装しやすい方で。
- 冪等性の記録先（新規テーブル / Shopifyメタフィールド / Workers KV）— 既存設計に合わせて。
- ~~メール送信基盤（既存のResend等の経路を流用）。~~ Phase 1 ではメール配信は実装しない。

困ったら小泉さん経由で Claude セッションのメモリ（`project_birthday_trigger.md`）を参照可能。
