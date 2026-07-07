import { getLineAccounts, jstNow } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

export interface LineOfficialFriendInsight {
  id: string;
  line_account_id: string;
  account_name: string | null;
  date: string;
  followers: number | null;
  targeted_reaches: number | null;
  blocks: number | null;
  status: 'ready' | 'unready' | 'out_of_service' | string;
  fetched_at: string;
}

export interface LineOfficialFriendInsightSummary {
  date: string | null;
  followers: number | null;
  targetedReaches: number | null;
  blocks: number | null;
  status: string | null;
  fetchedAt: string | null;
  items: LineOfficialFriendInsight[];
}

function toLineInsightDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, 10).replaceAll('-', '');
}

function defaultLineInsightDates(): string[] {
  return [
    toLineInsightDate(new Date()),
    toLineInsightDate(new Date(Date.now() - 24 * 60 * 60_000)),
  ];
}

export function normalizeLineInsightDate(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{8}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[1]}${match[2]}${match[3]}`;
  return null;
}

async function ensureTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS line_official_friend_insights (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        followers INTEGER,
        targeted_reaches INTEGER,
        blocks INTEGER,
        status TEXT NOT NULL,
        fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
        UNIQUE (line_account_id, date)
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_line_official_friend_insights_account_date
       ON line_official_friend_insights (line_account_id, date DESC)`,
    )
    .run();
}

export async function fetchAndStoreLineOfficialFriendInsights(
  db: D1Database,
  date?: string,
  lineAccountId?: string,
): Promise<LineOfficialFriendInsight[]> {
  await ensureTable(db);
  const accounts = await getLineAccounts(db);
  const targets = accounts.filter((account) => account.is_active && (!lineAccountId || account.id === lineAccountId));
  const saved: LineOfficialFriendInsight[] = [];

  for (const account of targets) {
    const client = new LineClient(account.channel_access_token);
    const candidateDates = date ? [date] : defaultLineInsightDates();
    let selectedDate = candidateDates[0];
    let insight = await client.getFollowersInsight(selectedDate);
    for (const candidateDate of candidateDates.slice(1)) {
      if (insight.status === 'ready') break;
      const candidateInsight = await client.getFollowersInsight(candidateDate);
      if (candidateInsight.status === 'ready') {
        selectedDate = candidateDate;
        insight = candidateInsight;
        break;
      }
    }
    const now = jstNow();
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO line_official_friend_insights
           (id, line_account_id, date, followers, targeted_reaches, blocks, status, fetched_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(line_account_id, date) DO UPDATE SET
           followers = excluded.followers,
           targeted_reaches = excluded.targeted_reaches,
           blocks = excluded.blocks,
           status = excluded.status,
           fetched_at = excluded.fetched_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        account.id,
        selectedDate,
        insight.followers ?? null,
        insight.targetedReaches ?? null,
        insight.blocks ?? null,
        insight.status,
        now,
        now,
        now,
      )
      .run();

    saved.push({
      id,
      line_account_id: account.id,
      account_name: account.name,
      date: selectedDate,
      followers: insight.followers ?? null,
      targeted_reaches: insight.targetedReaches ?? null,
      blocks: insight.blocks ?? null,
      status: insight.status,
      fetched_at: now,
    });
  }

  return saved;
}

export async function getLatestLineOfficialFriendInsightSummary(
  db: D1Database,
  lineAccountId?: string,
): Promise<LineOfficialFriendInsightSummary> {
  await ensureTable(db);
  const where = lineAccountId ? 'WHERE i.line_account_id = ?' : '';
  const stmt = db.prepare(
    `SELECT i.*, a.name AS account_name
     FROM line_official_friend_insights i
     LEFT JOIN line_accounts a ON a.id = i.line_account_id
     ${where}
     ORDER BY i.date DESC, i.fetched_at DESC`,
  );
  const rows = (lineAccountId ? await stmt.bind(lineAccountId).all<LineOfficialFriendInsight>() : await stmt.all<LineOfficialFriendInsight>()).results;
  if (rows.length === 0) {
    return { date: null, followers: null, targetedReaches: null, blocks: null, status: null, fetchedAt: null, items: [] };
  }

  const readyRows = rows.filter((row) => row.status === 'ready');
  const latestDate = (readyRows[0] ?? rows[0]).date;
  const items = rows.filter((row) => row.date === latestDate);
  const sum = (key: 'followers' | 'targeted_reaches' | 'blocks') => {
    const values = items.map((item) => item[key]).filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return null;
    return values.reduce((total, value) => total + value, 0);
  };

  return {
    date: latestDate,
    followers: sum('followers'),
    targetedReaches: sum('targeted_reaches'),
    blocks: sum('blocks'),
    status: items.every((item) => item.status === 'ready') ? 'ready' : items.map((item) => item.status).join(','),
    fetchedAt: items.map((item) => item.fetched_at).sort().at(-1) ?? null,
    items,
  };
}
