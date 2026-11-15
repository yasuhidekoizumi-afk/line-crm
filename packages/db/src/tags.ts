import { jstNow } from './utils.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  const result = await db
    .prepare(`SELECT * FROM tags ORDER BY name ASC`)
    .all<Tag>();
  return result.results;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const name = input.name.trim();
  const color = input.color ?? '#3B82F6';

  await db
    .prepare(
      `INSERT INTO tags (id, name, color, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, name, color, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

export async function getTagById(db: D1Database, id: string): Promise<Tag | null> {
  return (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null;
}

// タグの名前と色を変更。どちらか一方だけでもOK。
export interface UpdateTagInput {
  name?: string;
  color?: string;
}

export async function updateTag(
  db: D1Database,
  id: string,
  input: UpdateTagInput,
): Promise<Tag | null> {
  const sets: string[] = [];
  const binds: (string | null)[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name.trim()); }
  if (input.color !== undefined) { sets.push('color = ?'); binds.push(input.color); }
  if (sets.length === 0) {
    return (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null;
  }
  binds.push(id);
  await db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null;
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

// タグ一覧 + 各タグの付与人数（タグ管理画面用）。LEFT JOIN で 0 件のタグも含める。
export interface TagWithCount extends Tag {
  friend_count: number;
}

export async function getTagsWithCount(db: D1Database): Promise<TagWithCount[]> {
  const result = await db
    .prepare(
      `SELECT t.*, COUNT(ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name ASC`,
    )
    .all<TagWithCount>();
  return result.results;
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

/**
 * 友だちIDをまとめてタグ付けする（一括付与）。
 *
 * - friendIds はチャンク分割してから SELECT / INSERT する（D1 のバインド変数上限対策）
 * - 付与は INSERT OR IGNORE（既に付いている友だちは数えない）
 * - 1行ずつ addTagToFriend を叩くと 1,680 人で 1,680 リクエストになるため、
 *   サーバー側で D1 内完結（INSERT ... SELECT）にしている
 * - シナリオ・Webhook・自動化はここでは発火させない（大量付与で
 *   tag_added トリガーが意図せず動くのを防ぐ。呼び出し側の責任で明示的に扱う）
 */
/**
 * D1 は1ステートメントあたりのバインド変数が約100件で `too many SQL variables` になる。
 * INSERT ではタグID・日時の2件も使うため、IDは90件ずつに切る（実測: 200件で失敗）。
 */
export const BULK_TAG_CHUNK_SIZE = 90;
export const BULK_TAG_MAX_IDS = 5000;

export interface BulkTagResult {
  requested: number;
  unique: number;
  found: number;
  added: number;
  alreadyTagged: number;
  notFoundCount: number;
  notFound: string[];
  failedChunks: number;
  errors: string[];
  dryRun: boolean;
}

function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const v = String(id ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function addTagToFriendsBulk(
  db: D1Database,
  tagId: string,
  friendIds: string[],
  opts: { dryRun?: boolean; chunkSize?: number } = {},
): Promise<BulkTagResult> {
  const ids = dedupeIds(friendIds);
  const chunkSize = opts.chunkSize ?? BULK_TAG_CHUNK_SIZE;
  const dryRun = opts.dryRun === true;
  const now = jstNow();

  let found = 0;
  let added = 0;
  let failedChunks = 0;
  const notFound: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const existing = await db
        .prepare(`SELECT id FROM friends WHERE id IN (${placeholders})`)
        .bind(...chunk)
        .all<{ id: string }>();
      const foundIds = new Set(existing.results.map((r) => r.id));
      found += foundIds.size;
      for (const id of chunk) {
        if (!foundIds.has(id)) notFound.push(id);
      }

      if (!dryRun && foundIds.size > 0) {
        const foundList = [...foundIds];
        const foundPlaceholders = foundList.map(() => '?').join(',');
        const res = await db
          .prepare(
            `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
             SELECT id, ?, ? FROM friends WHERE id IN (${foundPlaceholders})`,
          )
          .bind(tagId, now, ...foundList)
          .run();
        added += res.meta?.changes ?? 0;
      }
    } catch (err) {
      failedChunks += 1;
      errors.push(
        `chunk ${i / chunkSize}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    requested: friendIds.length,
    unique: ids.length,
    found,
    added,
    alreadyTagged: dryRun ? 0 : Math.max(0, found - added),
    notFoundCount: notFound.length,
    notFound: notFound.slice(0, 200),
    failedChunks,
    errors: errors.slice(0, 10),
    dryRun,
  };
}

/** 一括付与の取り消し（間違えて付けたときの戻し用） */
export async function removeTagFromFriendsBulk(
  db: D1Database,
  tagId: string,
  friendIds: string[],
  opts: { chunkSize?: number } = {},
): Promise<{ unique: number; removed: number; failedChunks: number; errors: string[] }> {
  const ids = dedupeIds(friendIds);
  const chunkSize = opts.chunkSize ?? BULK_TAG_CHUNK_SIZE;
  let removed = 0;
  let failedChunks = 0;
  const errors: string[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const res = await db
        .prepare(
          `DELETE FROM friend_tags WHERE tag_id = ? AND friend_id IN (${placeholders})`,
        )
        .bind(tagId, ...chunk)
        .run();
      removed += res.meta?.changes ?? 0;
    } catch (err) {
      failedChunks += 1;
      errors.push(
        `chunk ${i / chunkSize}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { unique: ids.length, removed, failedChunks, errors: errors.slice(0, 10) };
}

export async function getFriendTags(
  db: D1Database,
  friendId: string,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*
       FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
       WHERE ft.friend_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
): Promise<Friend[]> {
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id = ?
       ORDER BY f.created_at DESC`,
    )
    .bind(tagId)
    .all<Friend>();
  return result.results;
}
