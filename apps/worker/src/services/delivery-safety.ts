import { getLatestRiskLevel, jstNow } from '@line-crm/db';

const PAUSE_FLAG_KEY = 'line_broadcasts_paused';
const DANGER_UNFOLLOW_THRESHOLD = 30;
const WARNING_UNFOLLOW_THRESHOLD = 10;

export async function ensureDeliverySafetyTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS line_follow_events (
        id TEXT PRIMARY KEY,
        line_user_id TEXT NOT NULL,
        line_account_id TEXT,
        friend_id TEXT,
        event_type TEXT NOT NULL CHECK (event_type IN ('follow', 'unfollow')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_line_follow_events_account_time
       ON line_follow_events (line_account_id, created_at)`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_line_follow_events_type_time
       ON line_follow_events (event_type, created_at)`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS system_flags (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
      )`,
    )
    .run();
}

export async function recordLineFollowEvent(
  db: D1Database,
  input: {
    lineUserId: string;
    lineAccountId: string | null;
    friendId?: string | null;
    eventType: 'follow' | 'unfollow';
  },
): Promise<void> {
  await ensureDeliverySafetyTables(db);
  await db
    .prepare(
      `INSERT INTO line_follow_events
         (id, line_user_id, line_account_id, friend_id, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.lineUserId,
      input.lineAccountId,
      input.friendId ?? null,
      input.eventType,
      jstNow(),
    )
    .run();
}

export async function setLineBroadcastsPaused(
  db: D1Database,
  paused: boolean,
): Promise<void> {
  await ensureDeliverySafetyTables(db);
  await db
    .prepare(
      `INSERT INTO system_flags (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(PAUSE_FLAG_KEY, paused ? '1' : '0', jstNow())
    .run();
}

export async function areLineBroadcastsPaused(db: D1Database): Promise<boolean> {
  await ensureDeliverySafetyTables(db);
  const row = await db
    .prepare(`SELECT value FROM system_flags WHERE key = ?`)
    .bind(PAUSE_FLAG_KEY)
    .first<{ value: string }>();
  return row?.value === '1';
}

export async function countRecentUnfollows(
  db: D1Database,
  lineAccountId: string | null,
  windowMinutes = 60,
): Promise<number> {
  await ensureDeliverySafetyTables(db);
  const cutoff = new Date(Date.now() + 9 * 60 * 60_000 - windowMinutes * 60_000)
    .toISOString()
    .slice(0, -1) + '+09:00';
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM line_follow_events
       WHERE event_type = 'unfollow'
         AND created_at >= ?
         AND (? IS NULL OR line_account_id = ?)`,
    )
    .bind(cutoff, lineAccountId, lineAccountId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getLineDeliverySafetyStatus(
  db: D1Database,
  lineAccountId: string | null,
): Promise<{
  paused: boolean;
  riskLevel: 'normal' | 'warning' | 'danger';
  recentUnfollows: number;
}> {
  const [paused, recentUnfollows, latestRisk] = await Promise.all([
    areLineBroadcastsPaused(db),
    countRecentUnfollows(db, lineAccountId),
    lineAccountId ? getLatestRiskLevel(db, lineAccountId).catch(() => 'normal') : Promise.resolve('normal'),
  ]);

  let riskLevel: 'normal' | 'warning' | 'danger' = 'normal';
  if (paused || latestRisk === 'danger' || recentUnfollows >= DANGER_UNFOLLOW_THRESHOLD) {
    riskLevel = 'danger';
  } else if (latestRisk === 'warning' || recentUnfollows >= WARNING_UNFOLLOW_THRESHOLD) {
    riskLevel = 'warning';
  }

  return { paused, riskLevel, recentUnfollows };
}

export async function assertLineBroadcastAllowed(
  db: D1Database,
  lineAccountId: string | null,
): Promise<void> {
  const status = await getLineDeliverySafetyStatus(db, lineAccountId);
  if (status.paused) {
    throw new Error('LINE配信は緊急停止中です');
  }
  if (status.riskLevel === 'danger') {
    throw new Error(`LINE配信を停止しました: 直近ブロック/解除 ${status.recentUnfollows} 件`);
  }
}
