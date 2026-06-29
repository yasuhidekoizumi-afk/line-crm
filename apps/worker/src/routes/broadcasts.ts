import { Hono } from 'hono';
import {
  getBroadcasts,
  getBroadcastById,
  createBroadcast,
  updateBroadcast,
  updateBroadcastStatus,
  deleteBroadcast,
} from '@line-crm/db';
import type { Broadcast as DbBroadcast, BroadcastMessageType, BroadcastTargetType } from '@line-crm/db';
import { processBroadcastSend, resolveBroadcastLineClient } from '../services/broadcast.js';
import { processSegmentSend } from '../services/segment-send.js';
import { getSegmentLineUserIds } from '@line-crm/db';
import type { SegmentCondition } from '../services/segment-query.js';
import type { Env } from '../index.js';

const broadcasts = new Hono<Env>();

async function countBroadcastTargets(
  db: D1Database,
  targetType: BroadcastTargetType,
  targetTagId?: string | null,
  targetSegmentId?: string | null,
  lineAccountId?: string | null,
): Promise<number> {
  if (targetType === 'all') {
    const sql = lineAccountId
      ? 'SELECT COUNT(*) AS count FROM friends WHERE is_following = 1 AND line_account_id = ?'
      : 'SELECT COUNT(*) AS count FROM friends WHERE is_following = 1';
    const row = await (lineAccountId ? db.prepare(sql).bind(lineAccountId) : db.prepare(sql))
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  if (targetType === 'tag') {
    if (!targetTagId) return 0;
    const sql = lineAccountId
      ? `SELECT COUNT(DISTINCT f.id) AS count
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ? AND f.is_following = 1 AND f.line_account_id = ?`
      : `SELECT COUNT(DISTINCT f.id) AS count
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ? AND f.is_following = 1`;
    const stmt = db.prepare(sql);
    const row = await (lineAccountId ? stmt.bind(targetTagId, lineAccountId) : stmt.bind(targetTagId))
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  if (targetType === 'segment') {
    if (!targetSegmentId) return 0;
    return (await getSegmentLineUserIds(db, targetSegmentId)).length;
  }

  return 0;
}

function serializeBroadcast(row: DbBroadcast) {
  let targetFriendIds: string[] | null = null;
  if (row.target_friend_ids) {
    try { targetFriendIds = JSON.parse(row.target_friend_ids); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    title: row.title,
    messageType: row.message_type,
    messageContent: row.message_content,
    targetType: row.target_type,
    targetTagId: row.target_tag_id,
    targetSegmentId: row.target_segment_id,
    targetFriendIds,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    totalCount: row.total_count,
    successCount: row.success_count,
    failedCount: row.failed_count ?? 0,
    errorSummary: row.error_summary ?? null,
    altText: (row as unknown as { alt_text?: string | null }).alt_text ?? null,
    createdAt: row.created_at,
  };
}

const TRACKING_LINK_ID_RE = /\/t\/([0-9a-fA-F-]{36})/g;

function extractTrackingLinkIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(Array.from(value.matchAll(TRACKING_LINK_ID_RE), (m) => m[1])));
}

async function getTrackedLinksForBroadcast(db: D1Database, broadcastId: string, content: string) {
  type LinkRow = {
    id: string;
    name: string;
    original_url: string;
    click_count: number;
  };

  let directLinks: LinkRow[] = [];
  try {
    const result = await db
      .prepare(
        `SELECT id, name, original_url, click_count
         FROM tracked_links
         WHERE broadcast_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(broadcastId)
      .all<LinkRow>();
    directLinks = result.results;
  } catch (e) {
    if (!String(e).includes('broadcast_id')) throw e;
  }

  const ids = extractTrackingLinkIds(content);
  if (ids.length === 0) return directLinks;

  const placeholders = ids.map(() => '?').join(',');
  const embedded = await db
    .prepare(
      `SELECT id, name, original_url, click_count
       FROM tracked_links
       WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<LinkRow>();

  const map = new Map<string, LinkRow>();
  for (const link of [...directLinks, ...embedded.results]) map.set(link.id, link);
  return Array.from(map.values());
}

async function getBroadcastDetail(db: D1Database, row: DbBroadcast) {
  const links = await getTrackedLinksForBroadcast(db, row.id, row.message_content);
  const linkIds = links.map((link) => link.id);

  const sentLog = await db
    .prepare(`SELECT COUNT(*) as count FROM messages_log WHERE broadcast_id = ?`)
    .bind(row.id)
    .first<{ count: number }>();

  let clickEvents = 0;
  let uniqueClickCount = 0;
  let linkStats: Array<{
    id: string;
    name: string;
    originalUrl: string;
    clickCount: number;
    uniqueClickCount: number;
  }> = [];

  if (linkIds.length > 0) {
    const placeholders = linkIds.map(() => '?').join(',');
    const total = await db
      .prepare(
        `SELECT
           COUNT(*) as clickEvents,
           COUNT(DISTINCT COALESCE(friend_id, link_clicks.id)) as uniqueClickCount
         FROM link_clicks
         WHERE tracked_link_id IN (${placeholders})`,
      )
      .bind(...linkIds)
      .first<{ clickEvents: number; uniqueClickCount: number }>();
    clickEvents = total?.clickEvents ?? 0;
    uniqueClickCount = total?.uniqueClickCount ?? 0;

    const perLink = await db
      .prepare(
        `SELECT
           tracked_link_id as id,
           COUNT(*) as clickCount,
           COUNT(DISTINCT COALESCE(friend_id, link_clicks.id)) as uniqueClickCount
         FROM link_clicks
         WHERE tracked_link_id IN (${placeholders})
         GROUP BY tracked_link_id`,
      )
      .bind(...linkIds)
      .all<{ id: string; clickCount: number; uniqueClickCount: number }>();
    const perLinkMap = new Map(perLink.results.map((item) => [item.id, item]));
    linkStats = links.map((link) => {
      const stat = perLinkMap.get(link.id);
      return {
        id: link.id,
        name: link.name,
        originalUrl: link.original_url,
        clickCount: stat?.clickCount ?? link.click_count ?? 0,
        uniqueClickCount: stat?.uniqueClickCount ?? 0,
      };
    });
  }

  type ManualMetrics = {
    open_count: number | null;
    open_rate: number | null;
    click_count: number | null;
    click_rate: number | null;
  };
  let manualMetrics: ManualMetrics | null = null;
  try {
    manualMetrics = await db
      .prepare(
        `SELECT open_count, open_rate, click_count, click_rate
         FROM crm_manual_broadcasts
         WHERE title = ?
         ORDER BY ABS(strftime('%s', sent_at) - strftime('%s', ?)) ASC
         LIMIT 1`,
      )
      .bind(row.title, row.sent_at ?? row.created_at)
      .first<ManualMetrics>();
  } catch (e) {
    if (!String(e).includes('crm_manual_broadcasts')) throw e;
  }

  const deliveredCount = row.success_count || (sentLog?.count ?? 0);
  const effectiveUniqueClickCount = uniqueClickCount || manualMetrics?.click_count || 0;
  const clickRate = manualMetrics?.click_rate ?? (
    deliveredCount > 0 ? (effectiveUniqueClickCount / deliveredCount) * 100 : null
  );

  return {
    ...serializeBroadcast(row),
    metrics: {
      deliveredCount,
      sentLogCount: sentLog?.count ?? 0,
      failedCount: row.failed_count ?? 0,
      openCount: manualMetrics?.open_count ?? null,
      openRate: manualMetrics?.open_rate ?? null,
      clickEvents,
      uniqueClickCount: effectiveUniqueClickCount,
      clickRate,
      trackedLinkCount: links.length,
    },
    trackedLinks: linkStats,
  };
}

// GET /api/broadcasts - list all
broadcasts.get('/api/broadcasts', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: DbBroadcast[];
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(`SELECT * FROM broadcasts WHERE line_account_id = ? ORDER BY created_at DESC`)
        .bind(lineAccountId)
        .all<DbBroadcast>();
      items = result.results;
    } else {
      items = await getBroadcasts(c.env.DB);
    }
    return c.json({ success: true, data: items.map(serializeBroadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/target-count - 配信前に対象人数を確認する
broadcasts.get('/api/broadcasts/target-count', async (c) => {
  try {
    const targetType = c.req.query('targetType') as BroadcastTargetType | undefined;
    const targetTagId = c.req.query('targetTagId') ?? null;
    const targetSegmentId = c.req.query('targetSegmentId') ?? null;
    const lineAccountId = c.req.query('lineAccountId') ?? null;

    if (!targetType || !['all', 'tag', 'segment', 'individual'].includes(targetType)) {
      return c.json({ success: false, error: 'targetType is required' }, 400);
    }

    const count = await countBroadcastTargets(
      c.env.DB,
      targetType,
      targetTagId,
      targetSegmentId,
      lineAccountId,
    );
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('GET /api/broadcasts/target-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id - get single
broadcasts.get('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);

    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/detail - content + delivery/click metrics
broadcasts.get('/api/broadcasts/:id/detail', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);

    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    return c.json({ success: true, data: await getBroadcastDetail(c.env.DB, broadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/detail error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts - create
broadcasts.post('/api/broadcasts', async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      messageType: BroadcastMessageType;
      messageContent: string;
      targetType: BroadcastTargetType;
      targetTagId?: string | null;
      targetSegmentId?: string | null;
      targetFriendIds?: string[] | null;
      scheduledAt?: string | null;
      lineAccountId?: string | null;
      altText?: string | null;
    }>();

    if (!body.title || !body.messageType || !body.messageContent || !body.targetType) {
      return c.json(
        { success: false, error: 'title, messageType, messageContent, and targetType are required' },
        400,
      );
    }

    if (body.targetType === 'tag' && !body.targetTagId) {
      return c.json(
        { success: false, error: 'targetTagId is required when targetType is "tag"' },
        400,
      );
    }

    if (body.targetType === 'segment' && !body.targetSegmentId) {
      return c.json(
        { success: false, error: 'targetSegmentId is required when targetType is "segment"' },
        400,
      );
    }

    if (body.targetType === 'individual' && (!body.targetFriendIds || body.targetFriendIds.length === 0)) {
      return c.json(
        { success: false, error: 'targetFriendIds is required when targetType is "individual"' },
        400,
      );
    }

    const broadcast = await createBroadcast(c.env.DB, {
      title: body.title,
      messageType: body.messageType,
      messageContent: body.messageContent,
      targetType: body.targetType,
      targetTagId: body.targetTagId ?? null,
      targetSegmentId: body.targetSegmentId ?? null,
      targetFriendIds: body.targetFriendIds ?? null,
      scheduledAt: body.scheduledAt ?? null,
    });

    // Save line_account_id and alt_text if provided
    const updates: string[] = [];
    const binds: unknown[] = [];
    if (body.lineAccountId) { updates.push('line_account_id = ?'); binds.push(body.lineAccountId); }
    if (body.altText) { updates.push('alt_text = ?'); binds.push(body.altText); }
    if (updates.length > 0) {
      binds.push(broadcast.id);
      await c.env.DB.prepare(`UPDATE broadcasts SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...binds).run();
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) }, 201);
  } catch (err) {
    console.error('POST /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/broadcasts/:id - update draft
broadcasts.put('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return c.json({ success: false, error: 'Only draft or scheduled broadcasts can be updated' }, 400);
    }

    const body = await c.req.json<{
      title?: string;
      messageType?: BroadcastMessageType;
      messageContent?: string;
      targetType?: BroadcastTargetType;
      targetTagId?: string | null;
      targetSegmentId?: string | null;
      targetFriendIds?: string[] | null;
      scheduledAt?: string | null;
      altText?: string | null;
    }>();

    // Keep status in sync with scheduledAt changes
    let statusUpdate: 'draft' | 'scheduled' | undefined;
    if (body.scheduledAt !== undefined) {
      statusUpdate = body.scheduledAt ? 'scheduled' : 'draft';
    }

    const updated = await updateBroadcast(c.env.DB, id, {
      title: body.title,
      message_type: body.messageType,
      message_content: body.messageContent,
      target_type: body.targetType,
      target_tag_id: body.targetTagId,
      target_segment_id: body.targetSegmentId,
      target_friend_ids: body.targetFriendIds !== undefined
        ? (body.targetFriendIds ? JSON.stringify(body.targetFriendIds) : null)
        : undefined,
      scheduled_at: body.scheduledAt,
      ...((body as { altText?: string | null }).altText !== undefined
        ? { alt_text: (body as { altText?: string | null }).altText }
        : {}),
      ...(statusUpdate !== undefined ? { status: statusUpdate } : {}),
    });

    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('PUT /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/_debug/schema - messages_log テーブルのスキーマ定義（外部キー調査用）
broadcasts.get('/api/broadcasts/_debug/schema', async (c) => {
  try {
    const tables = await c.env.DB
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%broadcasts_old%'`)
      .all<{ name: string; sql: string }>();
    const fkList = await c.env.DB
      .prepare(`SELECT * FROM pragma_foreign_key_list('messages_log')`)
      .all();
    return c.json({
      success: true,
      data: {
        tablesReferencingBroadcastsOld: tables.results,
        messagesLogForeignKeys: fkList.results,
      },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/_debug/schema error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/broadcasts/_debug/fix-broadcasts-old-fk - broadcasts_old を参照する全テーブルを修復
broadcasts.post('/api/broadcasts/_debug/fix-broadcasts-old-fk', async (c) => {
  try {
    // 1. broadcasts_old を参照しているテーブルを全部探す
    const targets = await c.env.DB
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%broadcasts_old%'`)
      .all<{ name: string; sql: string }>();
    if (targets.results.length === 0) {
      return c.json({ success: true, data: { changed: false, reason: 'broadcasts_old 参照テーブルなし' } });
    }

    // 2. 各テーブルを「リネーム → 新スキーマ作成 → データコピー → 旧削除」で修復
    await c.env.DB.prepare(`PRAGMA foreign_keys=OFF`).run();
    const fixed: { name: string; originalSql: string; fixedSql: string }[] = [];
    try {
      for (const t of targets.results) {
        if (!/^[A-Za-z0-9_]+$/.test(t.name)) continue;
        const fixedSql = t.sql.replace(/broadcasts_old/g, 'broadcasts');
        if (fixedSql === t.sql) continue;

        const tmpName = `${t.name}_fkfix_tmp`;
        await c.env.DB.prepare(`ALTER TABLE ${t.name} RENAME TO ${tmpName}`).run();
        await c.env.DB.prepare(fixedSql).run();
        await c.env.DB.prepare(`INSERT INTO ${t.name} SELECT * FROM ${tmpName}`).run();
        await c.env.DB.prepare(`DROP TABLE ${tmpName}`).run();
        fixed.push({ name: t.name, originalSql: t.sql, fixedSql });
      }
    } finally {
      await c.env.DB.prepare(`PRAGMA foreign_keys=ON`).run();
    }

    return c.json({ success: true, data: { changed: fixed.length > 0, fixed } });
  } catch (err) {
    console.error('POST /api/broadcasts/_debug/fix-broadcasts-old-fk error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/broadcasts/_debug/messages-log-schema - messages_log の CREATE TABLE 文を返す
broadcasts.get('/api/broadcasts/_debug/messages-log-schema', async (c) => {
  try {
    const row = await c.env.DB
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_log'`)
      .first<{ sql: string }>();
    return c.json({ success: true, data: row });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/broadcasts/_debug/triggers - DB内のトリガー一覧（broadcasts_old バグ調査用）
broadcasts.get('/api/broadcasts/_debug/triggers', async (c) => {
  try {
    const result = await c.env.DB
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='trigger'`)
      .all<{ name: string; sql: string }>();
    const stale = result.results.filter((t) => t.sql && t.sql.includes('broadcasts_old'));
    return c.json({ success: true, data: { all: result.results, staleReferencingBroadcastsOld: stale } });
  } catch (err) {
    console.error('GET /api/broadcasts/_debug/triggers error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/broadcasts/_debug/drop-stale-triggers - broadcasts_old を参照する古いトリガーを全削除
broadcasts.post('/api/broadcasts/_debug/drop-stale-triggers', async (c) => {
  try {
    const result = await c.env.DB
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%broadcasts_old%'`)
      .all<{ name: string }>();
    const dropped: string[] = [];
    for (const row of result.results) {
      // DROP TRIGGER はパラメータバインドできないので名前を直接埋め込む（識別子検証）
      if (!/^[A-Za-z0-9_]+$/.test(row.name)) continue;
      await c.env.DB.prepare(`DROP TRIGGER IF EXISTS ${row.name}`).run();
      dropped.push(row.name);
    }
    return c.json({ success: true, data: { dropped } });
  } catch (err) {
    console.error('POST /api/broadcasts/_debug/drop-stale-triggers error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/broadcasts/:id/reset - 「送信中」で固まった配信をドラフトに強制リセット
broadcasts.post('/api/broadcasts/:id/reset', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    if (existing.status === 'sent') {
      return c.json({ success: false, error: '送信完了済みの配信はリセットできません' }, 400);
    }
    await updateBroadcastStatus(c.env.DB, id, 'draft');
    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/reset error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/broadcasts/:id - delete
broadcasts.delete('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteBroadcast(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send - send now
broadcasts.post('/api/broadcasts/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status === 'sending' || existing.status === 'sent') {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 400);
    }

    const lineClient = await resolveBroadcastLineClient(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN, existing);

    if (existing.target_type === 'segment' && existing.target_segment_id) {
      // セグメントターゲット: 事前に空でないことを確認
      const count = (await getSegmentLineUserIds(c.env.DB, existing.target_segment_id)).length;
      if (count === 0) {
        return c.json({ success: false, error: 'セグメントに一致するLINE友だちがいません' }, 400);
      }
    }

    await processBroadcastSend(c.env.DB, lineClient, id, c.env.WORKER_URL);

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send-segment - send to a filtered segment
broadcasts.post('/api/broadcasts/:id/send-segment', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status === 'sending' || existing.status === 'sent') {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 400);
    }

    const body = await c.req.json<{ conditions: SegmentCondition }>();

    if (!body.conditions || !body.conditions.operator || !Array.isArray(body.conditions.rules)) {
      return c.json(
        { success: false, error: 'conditions with operator and rules array is required' },
        400,
      );
    }

    const lineClient = await resolveBroadcastLineClient(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN, existing);
    await processSegmentSend(c.env.DB, lineClient, id, body.conditions);

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send-segment error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { broadcasts };
