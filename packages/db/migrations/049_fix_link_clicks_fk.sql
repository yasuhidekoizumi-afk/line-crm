-- Fix broken link_clicks foreign key that points to the old temporary table
-- tracked_links_fkfix_tmp instead of tracked_links.
-- Safe for current production because link_clicks is empty, but preserves rows if any exist.

PRAGMA foreign_keys = OFF;

ALTER TABLE link_clicks RENAME TO link_clicks_old;

CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL REFERENCES tracked_links (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
SELECT id, tracked_link_id, friend_id, clicked_at
FROM link_clicks_old;

DROP TABLE link_clicks_old;

CREATE INDEX IF NOT EXISTS idx_link_clicks_link ON link_clicks (tracked_link_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_friend ON link_clicks (friend_id);

PRAGMA foreign_keys = ON;
