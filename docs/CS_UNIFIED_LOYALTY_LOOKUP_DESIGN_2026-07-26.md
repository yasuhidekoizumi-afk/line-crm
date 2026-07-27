# CS統合ポイント照会 設計書

**作成日**: 2026-07-26  
**対象**: LINE Harness / ロイヤルティ画面  
**目的**: LINE連携の有無にかかわらず、CS担当者が本人確認後にポイント・期限・割引コード・購入状況を一つの画面で正しく確認できるようにする。

---

## 1. 背景と解決する課題

現行の「ポイント管理」は `friend_id`（LINE友だち）を起点に検索・表示する。そのため、Shopify購入者であってもLINE未連携の場合は、ポイントを持つ Shopify 起点の仮口座（`sp_<shopify_customer_id>`）を検索できない。

2026-07-26 の小栗様事例では、次の二つの口座が存在した。

| 区分 | 識別子 | 状態 |
|---|---|---|
| 実LINE口座 | `U545...` | Shopify未連携、0pt、履歴なし |
| Shopify起点の仮口座 | `sp_22795157897375` | Shopify顧客IDに紐付き、ポイント・期限付きポイント・未使用コードあり |

この状態でLINE口座だけを見て手動付与すると、二重口座と二重ポイントを作る危険がある。CSがCodexやD1を参照せず、安全に事実確認できる仕組みを提供する。

---

## 2. ゴール・非ゴール

### ゴール

1. 名前、メールアドレス、電話番号、Shopify顧客ID、LINE IDのいずれからでも顧客候補を検索できる。
2. LINE未連携者でも、Shopify顧客IDを主キーとして正しいポイント口座を表示できる。
3. 通常ポイント、期間限定ポイント、期限、未使用割引コード、利用・失効履歴、最新注文の割引状況を一画面で確認できる。
4. 口座が分離している場合、CSが誤って手動調整を行わないよう明確に警告する。
5. CS担当は照会まで、金額・口座状態を変える操作は承認済み権限だけに限定し、全操作を記録する。

### 非ゴール（本フェーズでは行わない）

- 検索結果だけでの自動口座統合
- CS担当者による無制限のポイント手動調整・コード取消
- Shopify管理画面への別アプリ埋め込み
- 氏名だけの曖昧一致を根拠とした本人確定

Shopify管理画面拡張は将来選択肢とする。既存の認証、スタッフ権限、ポイント管理、CS画面を再利用できるため、初期実装先はLINE Harnessとする。

---

## 3. 利用者と権限

| ロール | 検索・照会 | 口座統合の申請 | 手動調整・コード取消 | 承認 |
|---|---:|---:|---:|---:|
| `staff`（CS担当） | 可 | 可 | 不可 | 不可 |
| `admin` | 可 | 可 | 不可 | 不可 |
| `owner` | 可 | 可 | 可 | 可 |

`admin` には将来、二名承認済みの操作実行権限を追加できるが、初期は `owner` のみ実行可能とする。既存の `owner` / `admin` / `staff` ロールと `requireRole` を使用する。

---

## 4. 画面設計

### 4-1. 導線

既存の **ポイント管理** に「統合照会」タブを追加する。既存の会員一覧・手動調整画面は、統合照会の移行完了まで残す。

### 4-2. 検索

検索欄のプレースホルダーを次に変更する。

> 名前・メール・電話・Shopify顧客ID・LINE IDで検索

検索結果には、同一候補に関連するLINE口座とShopify口座をまとめて表示する。

| 表示項目 | 例 |
|---|---|
| 氏名 / メール | OGURI NORIKO / `m***@yahoo.co.jp` |
| Shopify | 顧客ID、最終注文日、累計購入額 |
| LINE | 連携済み / 未連携 / 候補あり |
| ポイント | 通常、期間限定、合計、最短期限 |
| 注意 | `口座未統合`、`未使用コードあり`、`期限切れ処理要確認` |

名前だけの検索結果が複数ある場合は、メールアドレス・電話番号下4桁・Shopify顧客IDを併記し、CS担当者に追加情報で絞り込ませる。

### 4-3. 顧客詳細（統合ポイントカルテ）

#### 常時表示

- 顧客識別: Shopify顧客ID、氏名、メール、電話、LINE ID
- 連携状態: `LINE連携済み` / `LINE未連携` / `口座未統合` / `確認待ち`
- ポイント: 通常、期間限定、合計、最短有効期限
- 割引コード: コード、金額、発行日、Shopify上の使用状況（未使用 / 使用済み / 確認失敗）
- 購入: 直近5件、各注文の注文番号・注文日・支払額・割引額・キャンセル状態
- ポイント履歴: 付与・利用・失効・調整、理由、残高、期限

#### 危険操作の保護

次のいずれかなら、調整・取消ボタンを非表示にし、赤色の警告を表示する。

- LINE実口座と `sp_` 仮口座が共存する
- Shopify顧客IDが未確定
- 同姓同名候補が複数ある
- 期限付きポイントに期限切れ日があるが残高が残る
- 未使用コードのShopify照会が失敗している

表示文言例:

> **口座未統合のため、ポイント調整はできません。** Shopify口座とLINE口座の同一性を確認し、統合申請を作成してください。

### 4-4. 口座統合申請

CS担当が押せるのは「統合を申請」のみとする。申請には以下を必須にする。

- 対象LINE ID
- 対象Shopify顧客ID
- 照合根拠（本人確認済みのメール、電話、注文番号のいずれか）
- 問い合わせチケット / SlackスレッドURL
- 申請理由

実行前には、ownerがポイント残高・未使用コード・期限付きポイント・取引件数を確認できる差分プレビューを表示する。

---

## 5. データの正本と照合ルール

### 5-1. 正本

| データ | 正本 | 補足 |
|---|---|---|
| Shopify顧客の本人情報・注文 | Shopify / `shopify_orders` | CS照会時はShopify顧客IDを主キーにする |
| ポイント残高・期限・履歴 | `loyalty_points` / `loyalty_transactions` | `shopify_customer_id` から取得する |
| LINE連携状態 | `friends`、`loyalty_points.shopify_customer_id`、`customer_links` | `customer_links` は名寄せ補助であり、単独の正本にしない |
| 割引コード使用状況 | Shopify Admin API | `codeDiscountNodeByCode` の存在・使用回数を基準にする |

### 5-2. 検索の優先順位

1. 完全一致: Shopify顧客ID、LINE ID、メールアドレス、電話番号
2. 関連付け: `loyalty_points.shopify_customer_id`、`customer_links`、`shopify_orders`
3. 補助候補: 氏名の部分一致

氏名一致だけでは自動統合しない。電話・メール・注文番号など、本人確認済みの強い根拠が必要である。

### 5-3. 口座状態の判定

| 状態 | 判定 | CS表示 |
|---|---|---|
| 正常連携 | 実LINE口座にShopify顧客IDが一意に紐付く | 緑: 連携済み |
| Shopifyのみ | `sp_` 口座にのみShopify顧客IDがある | 青: LINE未連携 |
| 分離 | 実LINE口座と同一Shopify顧客の `sp_` 口座が共存 | 赤: 口座未統合 |
| 競合 | 一つのShopify顧客IDに複数の実LINE口座候補 | 赤: 本人確認が必要 |
| 不明 | ポイント口座・Shopify情報を結び付けられない | 灰: 照会不能 |

---

## 6. API設計

### 6-1. 統合検索（新設）

`GET /api/loyalty/customer-lookup?q=<query>&limit=20`

**認可**: `staff` 以上  
**用途**: 連携の有無にかかわらず、CS画面の検索候補を返す。

レスポンスには、PIIを必要最小限にマスクして返す。

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "shopifyCustomerId": "22795157897375",
        "name": "OGURI NORIKO",
        "emailMasked": "m***@yahoo.co.jp",
        "line": { "status": "unlinked", "friendId": null },
        "loyalty": {
          "friendId": "sp_22795157897375",
          "balance": 695,
          "limitedBalance": 300,
          "limitedExpiresAt": "2026-07-15T23:59:59+09:00"
        },
        "riskFlags": ["unlinked_line", "pending_discount_code"]
      }
    ]
  }
}
```

### 6-2. 統合詳細（新設）

`GET /api/loyalty/customer-lookup/shopify/:shopifyCustomerId`

**認可**: `staff` 以上  
**用途**: CSが事実確認するための読み取り専用カルテ。ポイント・履歴・注文・コード利用状況を一括返却する。

- Shopify APIのコード照会が失敗した場合、`code.status = "unknown"` を返し、未使用と推測しない。
- 直近注文に割引がないことは「コード未使用」の補助証拠にとどめ、コード状態はShopify照会を正とする。

### 6-3. 統合申請（新設）

`POST /api/loyalty/merge-requests`

**認可**: `staff` 以上（申請のみ）  
**必須入力**: `lineFriendId`、`shopifyCustomerId`、`verificationMethod`、`evidenceReference`、`reason`

`POST /api/loyalty/merge-requests/:id/approve`

**認可**: `owner` のみ。差分プレビューと再確認を必須にする。

### 6-4. 既存APIの扱い

| 既存API | 扱い |
|---|---|
| `GET /api/loyalty/:friendId` | 既存一覧・LINE口座向けとして維持 |
| `GET /api/loyalty/shopify/:shopifyCustomerId` | マイページ向けとして維持。統合詳細からは直接利用せず、CS向けの集約APIを新設 |
| `POST /api/loyalty/:friendId/adjust` | 統合カルテから直接呼ばない。owner承認済みの対象口座にのみ実行 |
| `POST /api/loyalty/shopify/:shopifyCustomerId/cancel-code` | owner承認済みかつShopifyで未使用確認済みの場合のみ実行 |

---

## 7. データベース設計

### 7-1. `loyalty_merge_requests`（新規）

```sql
CREATE TABLE loyalty_merge_requests (
  id TEXT PRIMARY KEY,
  line_friend_id TEXT NOT NULL,
  shopify_customer_id TEXT NOT NULL,
  source_loyalty_friend_id TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  executed_at TEXT,
  UNIQUE(line_friend_id, shopify_customer_id, status)
);
```

`status` は `pending` / `approved` / `rejected` / `executed` / `cancelled` とする。

### 7-2. `loyalty_audit_logs`（新規）

```sql
CREATE TABLE loyalty_audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_staff_id TEXT,
  shopify_customer_id TEXT,
  line_friend_id TEXT,
  target_friend_id TEXT,
  request_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

照会は、個人情報を含む詳細画面を開いたイベントのみ記録する。検索文字列そのものはログに保存しない。

---

## 8. 口座統合の実行仕様

既存のLINE連携処理には、`sp_` 仮口座を実LINE口座へ合流させる処理がある。本機能では、その同じ会計的な安全ルールを、承認済みの管理操作として再利用する。

### 実行順序

1. 対象のLINE口座・Shopify口座・未使用コードを再読込する。
2. 申請時から状態が変わっていれば実行せず、申請を `pending` に戻して再確認を求める。
3. Shopify顧客IDが別の実LINE口座へ紐付いていないことを確認する。
4. `loyalty_transactions` を実LINEの `friend_id` へ付け替える。
5. 残高、限定残高、累計購入額を合算する。
6. 限定ポイントの期限は**より早い期限**を採用する。
7. Shopify顧客IDを実LINE口座へ紐付け、仮口座を削除する。
8. 実行前後のスナップショットを `loyalty_audit_logs` に記録する。
9. 実行結果を画面に表示し、再読込で一口座になったことを検証する。

### 禁止事項

- 未使用割引コードの取消と口座統合を同じボタンで実行しない。
- 期限切れの期間限定ポイントを自動復元しない。
- 氏名一致だけで統合しない。
- エラー時に部分的な状態で終了しない。D1のバッチ/トランザクション境界で原子性を確保する。

---

## 9. 例外対応フロー

| 事象 | CS担当の操作 | ownerの対応 |
|---|---|---|
| 未連携・Shopify口座のみ | カルテを確認、必要なら連携案内 | 操作不要 |
| LINE 0pt / Shopifyに残高あり | 統合申請、顧客スクリーンショットを添付 | 本人確認後に統合 |
| 未使用コードあり | コードと注文画面のスクリーンショットを回収 | Shopify利用状況を確認し、取消・返還を別承認で実行 |
| 期限切れ表示と残高が矛盾 | 調整せず「期限処理要確認」として申請 | 履歴と有効期限ロジックを確認 |
| 同一Shopify顧客に複数LINE候補 | 顧客に連携LINEを確認 | 自動統合せず個別判断 |

---

## 10. 実装計画

### Phase A: 読み取り専用の統合照会

1. `customer-lookup` API（検索・詳細）を追加
2. ポイント管理に「統合照会」タブを追加
3. Shopify起点・LINE起点・未統合の各状態を表示
4. 未使用コードの状態と注文割引を表示
5. `staff` 権限での閲覧、閲覧監査ログを追加

**完了条件**: 小栗様と同様に「LINE側0pt、Shopify側にポイントあり」をCS担当が画面だけで発見できる。

### Phase B: 統合申請・承認

1. `loyalty_merge_requests` と申請画面を追加
2. ownerの差分プレビュー・承認・監査ログを追加
3. 既存の `sp_` 合流ロジックをサービス化し、承認フローから呼び出す
4. エラー・競合・再確認の状態を実装

**完了条件**: CS担当が直接残高を変更せず、証跡付きで統合申請できる。

### Phase C: 既存画面の安全化

1. 既存「ポイント手動調整」をowner専用にする
2. 実LINE口座でShopify未連携の場合、「Shopifyを検索」導線を表示
3. 期限処理の不整合検知を追加
4. CS用の確認手順をヘルプに掲載

**完了条件**: 0pt表示だけを根拠に手動付与する操作を防止できる。

---

## 11. 受入テスト

| ケース | 期待結果 |
|---|---|
| LINE連携済み顧客をLINE IDで検索 | 一口座・ポイント・履歴・注文を表示 |
| LINE未連携顧客をメールで検索 | Shopify起点のポイント口座を表示し「LINE未連携」と表示 |
| 分離口座の顧客を検索 | `口座未統合` 警告、調整不可、統合申請のみ可能 |
| 未使用コードがある顧客 | コード・金額・使用状況を表示。取消はowner承認なしでは不可 |
| 同姓同名2名を検索 | 候補を分けて表示し、自動統合しない |
| `staff` が統合を試行 | 申請作成のみ。実行APIは403 |
| ownerが統合を実行 | 履歴・残高・Shopify顧客IDが一口座へ移り、監査ログが残る |
| 統合直前に残高が変化 | 実行を停止し、再確認を要求 |

---

## 12. 運用ルール（CS向け）

1. 問い合わせを受けたら、まず統合照会でメールアドレスまたはShopify顧客IDを検索する。
2. LINE側の0ptだけで「ポイントがない」と回答しない。
3. `口座未統合`、`未使用コードあり`、`期限処理要確認` が出た場合は、ポイントを操作しない。
4. お客様には操作時の画面と注文確認メール/購入完了画面のスクリーンショットを依頼する。
5. 金額を伴う取消・返還・調整はowner承認後にのみ実行する。

---

## 13. 実装判断

本設計は、Shopify上に新しい管理アプリを作る前に、既存のLINE Harnessに実装する。理由は以下のとおり。

- CS担当の既存ログインとスタッフ権限をそのまま利用できる。
- `loyalty_points`、`loyalty_transactions`、Shopify照会、既存の仮口座合流ロジックを再利用できる。
- LINE連携済み・未連携の両方を同じ画面で扱える。
- 金額操作の承認・監査を一か所に集約できる。

Shopify管理画面への拡張は、Phase C完了後にCSがShopifyだけで業務を完結する必要が残る場合に検討する。
