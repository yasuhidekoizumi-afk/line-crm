-- ============================================
-- broadcasts_old を参照する古いトリガーを削除
-- Migration: 047
-- 作成日: 2026-06-24
-- 説明:
--   過去のマイグレーション (034/037/040) で broadcasts テーブルを
--   一度 broadcasts_old にリネームしてから新テーブルを作り直した。
--   その過程で SQLite が一部のトリガー定義を broadcasts_old 参照のまま
--   保持してしまい、配信時に
--     D1_ERROR: no such table: main.broadcasts_old: SQLITE_ERROR
--   が発生していた（LINE送信自体は成功するがログ INSERT で失敗）。
--   該当トリガーを sqlite_master から探して全削除する。
-- ============================================

-- 動的にトリガーを探して落とすため、リテラル SQL では書けない。
-- ここでは既知の名前パターンを DROP（存在しなくてもエラーにしない）。
-- 本番には次のいずれかが残っている可能性がある:
DROP TRIGGER IF EXISTS broadcasts_old_after_update;
DROP TRIGGER IF EXISTS broadcasts_old_after_insert;
DROP TRIGGER IF EXISTS broadcasts_old_after_delete;
DROP TRIGGER IF EXISTS broadcasts_updated_at;
DROP TRIGGER IF EXISTS update_broadcasts_old;
DROP TRIGGER IF EXISTS broadcasts_audit;
DROP TRIGGER IF EXISTS broadcasts_log_trigger;
