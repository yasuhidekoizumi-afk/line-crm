-- ============================================
-- Rakuten メルマガ Harness — キャンペーン・効果測定
-- Migration: 064
-- ============================================

-- メルマガキャンペーン（配信記録）
CREATE TABLE IF NOT EXISTS rakuten_mailmag_campaigns (
  id              TEXT PRIMARY KEY,
  send_date       TEXT NOT NULL,                         -- 配信日 (YYYY-MM-DD)
  subject         TEXT NOT NULL,                         -- 件名（実際に配信したもの）
  preheader       TEXT,                                  -- プレテキスト
  body_html       TEXT,                                  -- HTML本文
  body_text       TEXT,                                  -- テキスト本文
  pattern         TEXT NOT NULL DEFAULT 'normal',        -- 'event_day' | 'event_eve' | 'normal' | 'stock_clear'
  products_json   TEXT,                                  -- JSON: 訴求商品リスト [{itemNumber, name, price}]
  tone            TEXT,                                  -- 'daily' | 'gift' | 'health' | 'ferment'
  notes           TEXT,                                  -- 自由メモ（追加要件など）
  -- 効果測定（配信後に計算して更新）
  orders_on_day   INTEGER,                               -- 配信当日の受注数
  revenue_on_day  INTEGER,                               -- 配信当日の売上
  baseline_avg    INTEGER,                               -- 直近平常日平均売上（比較基準）
  lift_pct        REAL,                                  --平常日比 (%) = (revenue_on_day / baseline_avg - 1) * 100
  top_product     TEXT,                                  -- 配信日に最も売れた商品名
  effect_score    TEXT,                                  -- '★★★★★' 等（lift_pctから自動算出）
  measured_at     TEXT,                                  -- 効果測定の最終計算日時
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_mailmag_send_date ON rakuten_mailmag_campaigns(send_date DESC);
CREATE INDEX IF NOT EXISTS idx_mailmag_pattern ON rakuten_mailmag_campaigns(pattern);

-- AI生成ドラフト（承認前）
CREATE TABLE IF NOT EXISTS rakuten_mailmag_drafts (
  id              TEXT PRIMARY KEY,
  pattern         TEXT NOT NULL,                         -- 'event_day' | 'event_eve' | 'normal' | 'stock_clear'
  products_json   TEXT NOT NULL,                         -- JSON: 選定商品
  subject_candidates_json TEXT NOT NULL,                 -- JSON: 件名候補3パターン
  body_html       TEXT NOT NULL,
  body_text       TEXT NOT NULL,
  preheader       TEXT,
  tone            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
  data_context_json TEXT,                                -- JSON: 生成時に使ったデータスナップショット
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_mailmag_draft_status ON rakuten_mailmag_drafts(status, created_at DESC);
