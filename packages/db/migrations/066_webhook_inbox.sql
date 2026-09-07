-- 066_webhook_inbox.sql
-- LINE Webhook受信イベントの永続化（at-least-once処理の土台）。
--
-- 背景: これまで受信イベントは waitUntil 内で処理され、Worker中断・一時的D1失敗で
-- イベントが消失していた（再処理手段が無い）。監査でP1と判定。
--
-- 設計（最小構成・Ponytail）:
--   1. webhook.ts が受信直後に INSERT（署名検証後）→ 即200応答
--   2. 処理成功時は status を processed に更新
--   3. 未処理（received のまま）は既存の1分Cronが拾って再処理
--
-- キュー化（Queue / dead-letter）は滞留が実際に発生してから追加する。

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id TEXT PRIMARY KEY,
  line_account_id TEXT,
  event_type TEXT NOT NULL,
  webhook_event_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status_received
  ON webhook_inbox (status, received_at);

-- LINE再送対策: 同一webhookEventIdの二重取り込みを防ぐ（NULLは複数許容）
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_inbox_event_id
  ON webhook_inbox (webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;
