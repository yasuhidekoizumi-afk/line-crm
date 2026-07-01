# ORYZAEポイント制度 実装前データ確認

作成日: 2026-07-01

## 進捗

| ステップ | 状態 |
|---|---|
| 実装前データ確認 | 完了 |
| 7月先行検証ログテーブル追加 | 本番D1適用済み |
| 対象者スナップショット固定 | 本番D1適用済み |
| ポイント残高への付与 | 本番D1適用済み |
| 付与通知 / 失効リマインド作成 | 未実施 |

## 対象者定義

今回の制度設計で見るべき母数は、まず以下とする。

- `customers.line_user_id IS NOT NULL`
- `customers.shopify_customer_id_jp IS NOT NULL`

これは「LINE ID連携済みで、Shopify顧客IDがある人」を表す。
`friends.is_following` はLINE配信可否の確認には使うが、ポイント付与対象の母数からは外す。

## 確認結果

| 指標 | 値 |
|---|---:|
| LINE ID + Shopify顧客IDあり | 13,261 |
| distinct Shopify顧客ID | 13,261 |
| distinct LINE ID | 13,261 |
| 上記のうち `friends.is_following = 1` | 1,966 |
| 上記のうち `friends.is_following = 0` | 11,295 |
| 2026-06-01以降の購入者 | 372 |
| 2026-06-01以降の購入なし | 12,889 |
| 非アクティブ20%配布対象 | 2,578 |
| 7月先行配布の最大ポイント原資 | 369,400pt |
| Shopify注文履歴あり | 10,256 |
| `customers.order_count > 0` | 10,971 |
| 2026-06-01以降のShopify注文 | 575 |
| 2026-06-01以降のShopify購入ユニーク顧客 | 530 |

## 7月先行検証の配布設計

| セグメント | 人数 | 付与 | 原資 |
|---|---:|---:|---:|
| 直近30日購入者 | 372 | 300pt | 111,600pt |
| 非アクティブ20%配布群 | 2,578 | 100pt | 257,800pt |
| 非アクティブ80% holdout | 10,311 | 0pt | 0pt |
| 合計付与対象 | 2,950 | - | 369,400pt |

付与通知は最大2,950通、失効3日前リマインドも最大2,950通。
合計で最大5,900通を見込む。

## LINE配信状況

| 指標 | 値 |
|---|---:|
| 2026-07-01以降のHarness pushログ | 1 |
| 2026-06-01以降のHarness pushログ | 25 |

これはHarness側ログであり、LINE公式の月間quotaそのものではない。
本番配信前に `/api/line/quota` またはLINE公式管理画面で残枠を確認する。

## 既存実装の確認

- `email_link_enabled = 1`
- `email_link_mode = live`
- `link_reward_type = free_shipping`
- `point_rate = 0.01`
- `point_value = 1`
- `expiry_days = 365`
- 期限切れ未処理のawardは0件

7月ポイントは通常設定の365日ではなく、必ず7日期限で個別付与する。

## 実施済みと未実施

本番D1には `loyalty_campaign_grants` と `loyalty_campaign_notifications` を追加済み。
`loyalty_campaign_grants` には以下を固定済み。

- 付与対象者スナップショット
- `campaign_key`
- `idempotency_key`
- `source_event_id`
- holdout log

未実施の作業は以下。

- 付与通知 / 失効リマインド通知ログの作成
- LINE配信前のquota確認

## 本番付与後の確認

| 指標 | 値 |
|---|---:|
| `active_thanks_202507_pilot` 付与済み | 372件 / 74,400pt |
| `monthly_osusowake_202507_pilot` 付与済み | 2,950件 / 295,000pt |
| holdout | 10,311件 |
| 台帳作成済み | 3,322件 / 369,400pt |
| failed | 0件 |
| 付与可能なplanned残件 | 0件 |
