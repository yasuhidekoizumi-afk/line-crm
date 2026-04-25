-- ============================================
-- FERMENT: ポップアップ・埋め込みフォーム機能
-- Migration: 022
-- 作成日: 2026-04-25
-- 説明: サイト訪問者をメールリストに取り込むための公開フォーム
-- ============================================

-- フォーム定義
CREATE TABLE IF NOT EXISTS ferment_forms (
  form_id          TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  -- フォームタイプ: popup（ポップアップ）, embed（埋め込み）, inline（フッター等）
  form_type        TEXT NOT NULL DEFAULT 'popup',
  -- 表示設定（JSON）: タイトル、説明、ボタン文言、色、画像URL、トリガー条件
  display_config   TEXT NOT NULL DEFAULT '{}',
  -- 受信時アクション: タグ付与、ウェルカムメール送信フロー
  on_submit_tag    TEXT,
  on_submit_flow_id TEXT,
  -- 集計
  view_count       INTEGER NOT NULL DEFAULT 0,
  submit_count     INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ferment_forms_active ON ferment_forms(is_active);

-- フォーム送信ログ
CREATE TABLE IF NOT EXISTS ferment_form_submissions (
  submission_id    TEXT PRIMARY KEY,
  form_id          TEXT NOT NULL REFERENCES ferment_forms(form_id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  display_name     TEXT,
  customer_id      TEXT REFERENCES customers(customer_id) ON DELETE SET NULL,
  -- 訪問元 URL
  source_url       TEXT,
  user_agent       TEXT,
  ip_hash          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ferment_form_submissions_form ON ferment_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_ferment_form_submissions_email ON ferment_form_submissions(email);
CREATE INDEX IF NOT EXISTS idx_ferment_form_submissions_created ON ferment_form_submissions(created_at);
