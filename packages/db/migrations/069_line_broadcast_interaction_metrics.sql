-- LINE Messaging APIの配信単位統計を取得するための識別子。
-- multicastはaggregation unit、broadcastはx-line-request-idを使う。
ALTER TABLE broadcasts ADD COLUMN line_aggregation_unit TEXT;
ALTER TABLE broadcasts ADD COLUMN line_request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_broadcasts_line_aggregation_unit
  ON broadcasts(line_aggregation_unit)
  WHERE line_aggregation_unit IS NOT NULL;
