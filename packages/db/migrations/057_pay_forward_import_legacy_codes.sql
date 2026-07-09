-- 057: 旧 point-charge の紹介コードを line-crm 側Pay Forwardへ取り込み
--
-- point-charge は同じ D1 内の referral_codes を使っていたため、
-- 既存リンクを壊さないよう pay_forward_codes へコピーする。

INSERT OR IGNORE INTO pay_forward_codes
  (code, referrer_customer_id, is_active, created_at, updated_at)
SELECT
  code,
  customer_id,
  COALESCE(is_active, 1),
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
FROM referral_codes
WHERE code IS NOT NULL
  AND customer_id IS NOT NULL;
