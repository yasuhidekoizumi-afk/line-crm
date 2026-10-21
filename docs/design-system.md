# LINE Harness 管理画面 デザイン定義（v1）

最終更新: 2026-10-21 / 対象: `apps/web`（Next.js 静的書き出し）

このファイルが画面実装の唯一の基準です。新しい画面・改修はここに従います。

---

## 1. 原則

1. **1画面1目的** — 一覧・作成・詳細を同じ画面に詰め込まない（例: 配信は一覧と作成を分ける）
2. **状態は必ず見せる** — 読み込み中 / 空 / エラー / 成功 の4状態を全画面で用意する
3. **色は意味で使う** — ブランド色は「主要操作」と「選択中」だけ。装飾で使わない
4. **確認はダイアログで** — `confirm()` / `alert()` は使わない（`ConfirmDialog` / `Toast` を使う）
5. **スマホで読める** — 表は横スクロール許容、1行の情報量を減らす

---

## 2. 色（トークン）

| 用途 | トークン | 値 | 使いどころ |
|---|---|---|---|
| ブランド（LINE緑） | `brand-500` | `#06C755` | 主要ボタン、選択中のタブ、送信バブル |
| ブランド濃 | `brand-600` | `#05A648` | ホバー、押下 |
| ブランド淡 | `brand-50` | `#ECFDF3` | 選択行の背景、バッジ背景 |
| ワイン（ORYZAE） | `wine-500` | `#6D2E46` | 見出しの強調、限定表示 |
| ゴールド | `gold-500` | `#B5862E` | 実績・達成、プレミアム表示 |
| 文字（主） | `ink` | `#111827` | 本文・見出し |
| 文字（副） | `subtle` | `#6B7280` | 補足、日時 |
| 罫線 | `line` | `#E5E7EB` | カード・表の境界 |
| 面 | `surface` | `#FFFFFF` | カード、表 |
| 背景 | `canvas` | `#F9FAFB` | 画面全体 |
| 危険 | `danger-600` | `#DC2626` | 削除、失敗 |
| 注意 | `warn-500` | `#F59E0B` | 要対応、期限 |
| 情報 | `info-500` | `#3B82F6` | 補足リンク、情報バッジ |

**禁止**: 上記以外の hex 直書き（`style={{ color: '#...' }}`）。新しい色が必要ならこの表に追加してから使う。

---

## 3. 文字

| 用途 | クラス | サイズ |
|---|---|---|
| 画面タイトル | `text-xl sm:text-2xl font-bold text-ink` | 20→24px |
| セクション見出し | `text-base font-semibold text-ink` | 16px |
| 本文 | `text-sm text-ink` | 14px |
| 補足 | `text-xs text-subtle` | 12px |
| 数値（KPI） | `text-2xl sm:text-3xl font-bold tabular-nums` | 24→30px |

フォント: `'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui`（現状はOSフォント依存。Webフォント読み込みは別途判断）。

---

## 4. 余白・角丸・影

- 余白は **4の倍数**（`4 / 8 / 12 / 16 / 24 / 32`）。画面外周は `px-4 sm:px-6 lg:px-8`、カード内は `p-5`。
- 角丸: カード `rounded-card`（12px）、ボタン・入力 `rounded-lg`（8px）、バッジ `rounded-full`。
- 影: カードは `shadow-card` のみ。強すぎる影は使わない。

---

## 5. 部品

### Button（`components/ui/button.tsx`）
| variant | 用途 |
|---|---|
| `primary` | 画面の主操作（1画面に1つ） |
| `secondary` | 副次操作（エクスポート、絞り込み） |
| `ghost` | 取り消し、戻る |
| `danger` | 削除、停止 |

- サイズ: `sm`（表内・補助） / `md`（既定）
- `loading` 中は二重送信不可（自動で `disabled`）
- アイコンだけのボタンは `aria-label` 必須

### Badge（`components/ui/badge.tsx`）
| tone | 用途 |
|---|---|
| `success` | 送信済み、有効、対応済み |
| `warn` | 要対応、下書き、期限間近 |
| `danger` | 失敗、ブロック、未読 |
| `info` | 情報、計測中 |
| `neutral` | 停止中、対象外 |

### PageHeader（`components/ui/page-header.tsx`）
- タイトル・説明・右側の操作（1〜2個まで）
- 画面ごとに自前の `<h1>` を作らない

### Card（`components/ui/card.tsx`）
- 情報のまとまり。1カード1話題
- 見出し＋本文＋操作の3点セットまで

### TableShell（`components/ui/table.tsx`）
- 表は必ず `TableShell` で包む（横スクロール対応、ヘッダー固定色）
- 10行を超える表はページ送り（`Pagination`）を付ける
- 数値は右寄せ・`tabular-nums`

### Field（`components/ui/field.tsx`）
- ラベル必須。プレースホルダーだけで意味を伝えない
- エラーは入力の直下に `text-xs text-danger-600`

### ConfirmDialog / Toast
- 破壊的操作は `ConfirmDialog`（`variant="danger"`）
- 成功・失敗は `Toast`（画面右上、3秒）。`alert()` 禁止

---

## 6. 状態の扱い

| 状態 | 表現 |
|---|---|
| 読み込み中 | `LoadingSkeleton`（表・カードの形を保つ） |
| 空 | `EmptyState`（何が無いか＋次の一手を1つ） |
| エラー | 画面上部に赤帯＋再試行ボタン |
| 成功 | `Toast`（画面遷移を伴う場合は不要） |

---

## 7. 適用状況

| 画面 | 状態 |
|---|---|
| ダッシュボード | 適用済み（v1） |
| 個別チャット | 適用済み（v1） |
| LINE一斉配信 | 適用済み（v1） |
| その他50画面 | 未適用（順次） |

## 8. 変えないこと

- APIの形・画面遷移・権限（この刷新は見た目と操作感のみ）
- 既存の色分けの意味（緑=ブランド、赤=危険 など）
