-- 045_crm_manual_broadcasts.sql
--
-- 目的:
--   LINE公式Manager・CRM PLUS on LINE 経由の配信を、自社LINEハーネスの
--   broadcasts テーブルに記録できないため、手動入力で記録するための専用テーブル。
--
-- 用途:
--   CRM週次レポート画面 (/crm-weekly) で「LINE配信実績」セクションに表示する。
--   ハーネス経由配信 (broadcasts) と合算して「合計配信数」を出すために使う。
--
-- 設計:
--   - JSTタイムゾーンで保存 (他テーブルと同じ運用)
--   - id は TEXT PRIMARY KEY (アプリ側で UUID 採番)
--   - source で配信元を識別 ('line_official' | 'crm_plus' | 'other')
--   - 開封・クリック・リッチ表示の3指標を任意で記録可能
--   - 旧データを削除せず、必要に応じて UPDATE で訂正

CREATE TABLE IF NOT EXISTS crm_manual_broadcasts (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'line_official',  -- 'line_official' | 'crm_plus' | 'other'
  title           TEXT NOT NULL,
  sent_at         TEXT NOT NULL,                          -- ISO 8601 (例: '2026-06-09T20:01:00+09:00')
  delivered_count INTEGER NOT NULL DEFAULT 0,             -- 配信成功数
  open_count      INTEGER,                                -- 開封ユーザー数 (任意)
  open_rate       REAL,                                   -- 開封率 % (任意・小数2位)
  click_count     INTEGER,                                -- クリックユーザー数 (任意)
  click_rate      REAL,                                   -- クリック率 % (任意・小数2位)
  rich_view_count INTEGER,                                -- リッチメッセージ表示回数 (任意)
  note            TEXT,                                   -- 自由メモ
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_crm_manual_broadcasts_sent_at
  ON crm_manual_broadcasts(sent_at);

CREATE INDEX IF NOT EXISTS idx_crm_manual_broadcasts_source
  ON crm_manual_broadcasts(source);
