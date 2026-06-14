-- ============================================================
-- メール起点のLINE↔Shopify連携（LIFF一気通貫 Phase 1）
--   目的: Shopifyログイン不要で、LINEの中(LIFF)からメール1つで連携できるようにする。
--   流れ:
--     1) request-code … LINE本人確認 → 入力メールからShopify顧客を特定 → 6桁コードをメール送信
--     2) verify-code  … コード照合 → 既存の共有部品 linkShopifyAndReward() で連携＋特典
--   安全:
--     - コードは「ハッシュ化」して保存（DBが漏れても元コードは分からない）
--     - 有効期限10分・試行回数上限・成功時に消費（削除）
--     - なりすまし防止: 入力メールに届くコードを知らないと連携できない（=本人確認）
--   ※本番有効化(email_link_enabled=1 / mode=live)は小泉さんOK後（メール送信を伴うため）。
-- ============================================================

-- 本人確認コード（6桁）。同一(line_user_id,email)は最新1件のみ運用（request時に古い行を削除）。
CREATE TABLE IF NOT EXISTS email_link_codes (
  id                  TEXT PRIMARY KEY,
  line_user_id        TEXT NOT NULL,
  email               TEXT NOT NULL,        -- 小文字正規化して保存
  shopify_customer_id TEXT NOT NULL,        -- request時に解決した連携先を固定（verify時に差し替え不可）
  code_hash           TEXT NOT NULL,        -- SHA-256(code + ':' + line_user_id)
  attempts            INTEGER NOT NULL DEFAULT 0,
  expires_at          TEXT NOT NULL,        -- UTC ISO（サービス側で算出）
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_email_link_codes_lookup  ON email_link_codes (line_user_id, email);
CREATE INDEX IF NOT EXISTS idx_email_link_codes_expires ON email_link_codes (expires_at);

-- 設定（既定 = 安全側 OFF）
--   email_link_enabled        : 緊急停止スイッチ。0=停止(既定) / 1=稼働
--   email_link_mode           : test=指定LINE userIdのみ許可(予行) / live=全員
--   email_link_test_line_user : テストモードで許可するLINE userId（河原さん）
INSERT OR IGNORE INTO loyalty_settings (key, value, label, updated_at) VALUES
  ('email_link_enabled',        '0',                                  'メール起点LINE連携の有効化（1=ON / 0=停止）',        datetime('now')),
  ('email_link_mode',           'test',                               'メール連携の動作モード（test=指定LINEのみ / live=全員）', datetime('now')),
  ('email_link_test_line_user', 'Ua65cd46c3c455cfe4931ea46efdfd83e', 'テストモードで許可するLINE userId（河原さん）',          datetime('now'));
