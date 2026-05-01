-- ============================================
-- FERMENT フォーム統合: LINE CRM forms 機能の吸収
-- Migration: 030
-- 作成日: 2026-05-01
-- 説明: ferment_forms に LINE CRM forms の機能を追加
--   - fields: フォームフィールド定義（JSON）
--   - on_submit_scenario_id: 回答時にシナリオ登録
--   - save_to_metadata: 友だちメタデータに保存
--   - ferment_form_submissions に data と friend_id を追加
-- ============================================

-- ferment_forms に LINE CRM forms 相当のカラムを追加
ALTER TABLE ferment_forms ADD COLUMN fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ferment_forms ADD COLUMN on_submit_scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL;
ALTER TABLE ferment_forms ADD COLUMN save_to_metadata INTEGER NOT NULL DEFAULT 0;

-- ferment_form_submissions にフォームデータと友だちリンクを追加
ALTER TABLE ferment_form_submissions ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ferment_form_submissions ADD COLUMN friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_ferment_form_submissions_friend ON ferment_form_submissions(friend_id);
