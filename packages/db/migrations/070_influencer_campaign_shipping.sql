-- 過去案件の送付状況が不明な記録を、未送付と断定しない。
ALTER TABLE influencer_gifting_logs ADD COLUMN campaign_name TEXT;
ALTER TABLE influencer_gifting_logs ADD COLUMN shipment_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (shipment_status IN ('unknown', 'pending', 'shipped'));
UPDATE influencer_gifting_logs SET shipment_status='shipped'
  WHERE status='shipped' OR NULLIF(TRIM(shipped_at), '') IS NOT NULL;
