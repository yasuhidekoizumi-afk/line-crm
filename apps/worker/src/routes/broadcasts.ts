import { Hono } from 'hono';
import {
  getBroadcasts,
  getBroadcastById,
  createBroadcast,
  updateBroadcast,
  updateBroadcastStatus,
  deleteBroadcast,
  getSegmentById,
} from '@line-crm/db';
import type { Broadcast as DbBroadcast, BroadcastMessageType, BroadcastTargetType } from '@line-crm/db';
import { processBroadcastSend, resolveBroadcastLineClient, buildMessages, isSendableLineUserId } from '../services/broadcast.js';
import { getBroadcastBlockStats } from '../services/broadcast-block-metrics.js';
import { getBroadcastAttribution } from '../services/broadcast-attribution.js';
import { detectClaimWarnings, extractTextForValidation, extractUrls, findTooLongText } from '../utils/broadcast-preflight.js';
import { getSegmentLineUserIds, getSegmentAudienceBreakdown } from '@line-crm/db';
import type { Env } from '../index.js';
import { accessibleLineAccountIds, requireLineAccountAccess } from '../middleware/account-access.js';

const broadcasts = new Hono<Env>();

// 配信設定・手動送信では既定の通知文言を許可しない。下書き保存は許可する。
export function hasUneditedNotificationText(messageType: string, content: string, altText?: string | null): boolean {
  const unedited = (value: unknown) => typeof value !== 'string' || !value.trim()
    || ['画像メッセージ', 'カードタイプメッセージ', 'Flexメッセージ', 'リッチメッセージ'].includes(value.trim());
  if (messageType === 'text') return false;
  try {
    const parsed = JSON.parse(content);
    if (messageType === 'multi' || Array.isArray(parsed)) {
      return !Array.isArray(parsed) || parsed.some((block: { type: string; content: string; altText?: string }) =>
        hasUneditedNotificationText(block.type, block.content, block.altText ?? altText));
    }
    if (messageType === 'image') return unedited(parsed?.altText ?? altText);
    if (messageType === 'imagemap') return unedited(altText ?? parsed?.altText);
    if (messageType === 'flex') return unedited(altText);
    return false;
  } catch {
    return true;
  }
}
const NOTIFICATION_TEXT_ERROR = '通知・トーク一覧に表示される文言を編集してください。未入力・初期値のままでは送信・予約できません。';


async function countBroadcastTargets(
  db: D1Database,
  targetType: BroadcastTargetType,
  targetTagId?: string | null,
  targetSegmentId?: string | null,
  lineAccountId?: string | null,
  targetFriendIds?: string[] | null,
): Promise<{ count: number; audienceBreakdown?: Awaited<ReturnType<typeof getSegmentAudienceBreakdown>> }> {
  if (targetType === 'all') {
    const sql = lineAccountId
      ? `SELECT COUNT(*) AS count FROM friends
         WHERE is_following = 1
           AND line_user_id LIKE 'U%'
           AND length(line_user_id) = 33
           AND line_account_id = ?`
      : `SELECT COUNT(*) AS count FROM friends
         WHERE is_following = 1
           AND line_user_id LIKE 'U%'
           AND length(line_user_id) = 33`;
    const row = await (lineAccountId ? db.prepare(sql).bind(lineAccountId) : db.prepare(sql))
      .first<{ count: number }>();
    return { count: row?.count ?? 0 };
  }

  if (targetType === 'tag') {
    if (!targetTagId) return { count: 0 };
    const sql = lineAccountId
      ? `SELECT COUNT(DISTINCT f.id) AS count
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ?
           AND f.is_following = 1
           AND f.line_user_id LIKE 'U%'
           AND length(f.line_user_id) = 33
           AND f.line_account_id = ?`
      : `SELECT COUNT(DISTINCT f.id) AS count
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ?
           AND f.is_following = 1
           AND f.line_user_id LIKE 'U%'
           AND length(f.line_user_id) = 33`;
    const stmt = db.prepare(sql);
    const row = await (lineAccountId ? stmt.bind(targetTagId, lineAccountId) : stmt.bind(targetTagId))
      .first<{ count: number }>();
    return { count: row?.count ?? 0 };
  }

  if (targetType === 'segment') {
    if (!targetSegmentId) return { count: 0 };
    const audienceBreakdown = await getSegmentAudienceBreakdown(db, targetSegmentId, lineAccountId);
    return { count: audienceBreakdown.sendableLineUsers ?? 0, audienceBreakdown };
  }

  if (targetType === 'individual') {
    // 個別指定: 送信側と同じ条件（フォロー中・本物のLINE UID・アカウント一致）で数える。
    // ID はチャンク分割して IN 句にバインドする（1,680人規模で上限に当たるため）。
    const ids = Array.isArray(targetFriendIds) ? targetFriendIds.filter((id) => typeof id === 'string' && id) : [];
    if (ids.length === 0) return { count: 0 };
    const CHUNK = 90; // D1のバインド変数上限（約100件）対策
    let count = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const sql = lineAccountId
        ? `SELECT COUNT(DISTINCT id) AS count FROM friends
           WHERE id IN (${chunk.map(() => '?').join(',')})
             AND is_following = 1
             AND line_user_id LIKE 'U%'
             AND length(line_user_id) = 33
             AND line_account_id = ?`
        : `SELECT COUNT(DISTINCT id) AS count FROM friends
           WHERE id IN (${chunk.map(() => '?').join(',')})
             AND is_following = 1
             AND line_user_id LIKE 'U%'
             AND length(line_user_id) = 33`;
      const stmt = db.prepare(sql);
      const row = await (lineAccountId ? stmt.bind(...chunk, lineAccountId) : stmt.bind(...chunk))
        .first<{ count: number }>();
      count += row?.count ?? 0;
    }
    return { count };
  }

  return { count: 0 };
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
    isTest: (row as unknown as { is_test?: number | null }).is_test === 1,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    totalCount: row.total_count,
    successCount: row.success_count,
    failedCount: row.failed_count ?? 0,
    errorSummary: row.error_summary ?? null,
    altText: (row as unknown as { alt_text?: string | null }).alt_text ?? null,
    archivedAt: (row as unknown as { archived_at?: string | null }).archived_at ?? null,
    createdAt: row.created_at,
  };
}

const TRACKING_LINK_ID_RE = /\/t\/([0-9a-fA-F-]{36})/g;
const CONTENT_URL_RE = /https?:\/\/[^\s"'<>\])}]+/g;

function extractTrackingLinkIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(Array.from(value.matchAll(TRACKING_LINK_ID_RE), (m) => m[1])));
}

function extractActionableUrls(messageType: string, content: string): Set<string> {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//.test(value.trim())) urls.add(value.trim());
  };

  if (messageType === 'text') {
    for (const match of content.matchAll(CONTENT_URL_RE)) add(match[0].replace(/[.,;:!?)]+$/, ''));
    return urls;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (messageType === 'multi' && Array.isArray(parsed)) {
      for (const block of parsed) {
        if (!block || typeof block !== 'object') continue;
        const item = block as { type?: string; content?: string };
        if (item.type && typeof item.content === 'string') {
          extractActionableUrls(item.type, item.content).forEach((url) => urls.add(url));
        }
      }
      return urls;
    }

    if (messageType === 'image' && parsed && typeof parsed === 'object') {
      add((parsed as Record<string, unknown>).linkUrl);
      return urls;
    }

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.type === 'uri') {
        add(record.uri);
        add(record.linkUri);
        if (record.altUri && typeof record.altUri === 'object') {
          add((record.altUri as Record<string, unknown>).desktop);
        }
      }
      Object.values(record).forEach(visit);
    };
    visit(parsed);
  } catch {
    // 壊れたJSONはクリック対象を推測せず、誤集計を避ける。
  }
  return urls;
}

type ActionableLinkDescriptor = {
  url: string;
  label: string;
};

export function extractActionableLinkDescriptors(
  messageType: string,
  content: string,
  messageIndex?: number,
): ActionableLinkDescriptor[] {
  const descriptors: ActionableLinkDescriptor[] = [];
  const messagePrefix = messageIndex ? `${messageIndex}件目 / ` : '';
  const add = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value.trim())) return;
    descriptors.push({ url: value.trim(), label });
  };

  if (messageType === 'text') {
    Array.from(content.matchAll(CONTENT_URL_RE)).forEach((match, index) => {
      add(match[0].replace(/[.,;:!?)]+$/, ''), `${messagePrefix}CTA${index + 1}`);
    });
    return descriptors;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (messageType === 'multi' && Array.isArray(parsed)) {
      parsed.forEach((block, index) => {
        if (!block || typeof block !== 'object') return;
        const item = block as { type?: string; content?: string };
        if (item.type && typeof item.content === 'string') {
          descriptors.push(...extractActionableLinkDescriptors(item.type, item.content, index + 1));
        }
      });
      return descriptors;
    }

    if (messageType === 'image' && parsed && typeof parsed === 'object') {
      add((parsed as Record<string, unknown>).linkUrl, `${messagePrefix}画像リンク`);
      return descriptors;
    }

    type Location = { cardIndex?: number; actionIndex: number };
    const visit = (node: unknown, location: Location): void => {
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, location));
        return;
      }
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;

      if (record.type === 'carousel' && Array.isArray(record.contents)) {
        record.contents.forEach((card, index) => visit(card, { cardIndex: index + 1, actionIndex: 0 }));
        return;
      }

      if (record.type === 'uri') {
        location.actionIndex += 1;
        const card = location.cardIndex ? `カード${location.cardIndex}` : 'Flex';
        const actionLabel = typeof record.label === 'string' && record.label.trim()
          ? `「${record.label.trim()}」`
          : '';
        const label = `${messagePrefix}${card} / CTA${location.actionIndex}${actionLabel}`;
        add(record.uri, label);
        add(record.linkUri, label);
        if (record.altUri && typeof record.altUri === 'object') {
          const desktop = (record.altUri as Record<string, unknown>).desktop;
          if (desktop !== record.uri) add(desktop, `${label}（PC）`);
        }
        return;
      }

      Object.values(record).forEach((value) => visit(value, location));
    };
    visit(parsed, { actionIndex: 0 });
  } catch {
    // 壊れたJSONでは場所を推測しない。
  }
  return descriptors;
}

export function legacyTrackedLinkName(
  link: { id: string; original_url: string },
  descriptors: ActionableLinkDescriptor[],
): string {
  const labels = descriptors
    .filter((descriptor) =>
      descriptor.url === link.original_url || extractTrackingLinkIds(descriptor.url).includes(link.id),
    )
    .map((descriptor) => descriptor.label);
  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return 'CTA（旧配信）';
  if (uniqueLabels.length === 1) return `${uniqueLabels[0]}（旧配信）`;
  const messagePrefix = uniqueLabels[0].match(/^(\d+件目 \/ )/)?.[1];
  const joinedLabels = messagePrefix && uniqueLabels.every((label) => label.startsWith(messagePrefix))
    ? `${messagePrefix}${uniqueLabels.map((label) => label.slice(messagePrefix.length)).join(' ＋ ')}`
    : uniqueLabels.join(' ＋ ');
  return `${joinedLabels}（旧配信・合算）`;
}

type TrackedLinkRow = {
  id: string;
  name: string;
  original_url: string;
  click_count: number;
};

type TrackedLinkGroup = {
  ids: string[];
  name: string;
  original_url: string;
  fallbackClickCount: number;
  isLegacyAggregate: boolean;
};

/**
 * 旧版は同じURLをCTA位置ではなくURL単位で処理していた。
 * また予約配信が重複実行された場合、同じCTAに複数の計測リンクが発行された。
 * そのため `auto:` リンクは「CTA番号」ではなく、遷移先ごとの論理CTAとして束ねる。
 */
export function groupTrackedLinksByLogicalCta(
  links: TrackedLinkRow[],
  descriptors: ActionableLinkDescriptor[],
): TrackedLinkGroup[] {
  const groups: TrackedLinkGroup[] = [];
  const legacyByUrl = new Map<string, TrackedLinkRow[]>();

  for (const link of links) {
    if (!link.name.startsWith('auto: ')) {
      groups.push({
        ids: [link.id],
        name: link.name,
        original_url: link.original_url,
        fallbackClickCount: link.click_count ?? 0,
        isLegacyAggregate: false,
      });
      continue;
    }
    const matches = legacyByUrl.get(link.original_url) ?? [];
    matches.push(link);
    legacyByUrl.set(link.original_url, matches);
  }

  for (const sameDestinationLinks of legacyByUrl.values()) {
    const representative = sameDestinationLinks[0];
    const matchingDescriptors = descriptors.filter((descriptor) =>
      descriptor.url === representative.original_url
      || extractTrackingLinkIds(descriptor.url).some((id) => sameDestinationLinks.some((link) => link.id === id)),
    );
    let name = legacyTrackedLinkName(representative, matchingDescriptors);
    if (sameDestinationLinks.length > 1) {
      name = name.replace(/（旧配信(?:・合算)?）$/, matchingDescriptors.length > 1
        ? '（旧配信・CTA位置合算／重複発行分を統合）'
        : '（旧配信・重複発行分を統合）');
    }
    groups.push({
      ids: sameDestinationLinks.map((link) => link.id),
      name,
      original_url: representative.original_url,
      fallbackClickCount: sameDestinationLinks.reduce((sum, link) => sum + (link.click_count ?? 0), 0),
      isLegacyAggregate: sameDestinationLinks.length > 1 || matchingDescriptors.length > 1,
    });
  }

  return groups;
}

async function getTrackedLinksForBroadcast(
  db: D1Database,
  broadcastId: string,
  messageType: string,
  content: string,
) {
  let directLinks: TrackedLinkRow[] = [];
  try {
    const result = await db
      .prepare(
        `SELECT id, name, original_url, click_count
         FROM tracked_links
         WHERE broadcast_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(broadcastId)
      .all<TrackedLinkRow>();
    directLinks = result.results;
  } catch (e) {
    if (!String(e).includes('broadcast_id')) throw e;
  }

  const actionableUrls = extractActionableUrls(messageType, content);
  // 旧版ではFlex画像URLまで計測リンクへ変換していた。
  // メッセージ全体からIDを拾うと、その画像用リンクもCTAとして復活してしまうため、
  // URIアクション内にある計測リンクIDだけを採用する。
  const actionableIds = extractTrackingLinkIds(Array.from(actionableUrls).join('\n'));
  const isActionable = (link: TrackedLinkRow) =>
    actionableUrls.has(link.original_url) || actionableIds.includes(link.id);
  if (actionableIds.length === 0) return directLinks.filter(isActionable);

  const placeholders = actionableIds.map(() => '?').join(',');
  const embedded = await db
    .prepare(
      `SELECT id, name, original_url, click_count
       FROM tracked_links
       WHERE id IN (${placeholders})`,
    )
    .bind(...actionableIds)
    .all<TrackedLinkRow>();

  const map = new Map<string, TrackedLinkRow>();
  for (const link of [...directLinks, ...embedded.results]) map.set(link.id, link);
  return Array.from(map.values()).filter(isActionable);
}

async function getBroadcastDetail(db: D1Database, row: DbBroadcast) {
  const links = await getTrackedLinksForBroadcast(db, row.id, row.message_type, row.message_content);
  const actionableDescriptors = extractActionableLinkDescriptors(
    row.message_type,
    row.message_content,
  );
  const linkGroups = groupTrackedLinksByLogicalCta(links, actionableDescriptors);
  const linkIds = links.map((link) => link.id);

  const sentLog = await db
    .prepare(`SELECT COUNT(*) as count FROM messages_log WHERE broadcast_id = ?`)
    .bind(row.id)
    .first<{ count: number }>();

  let clickEvents = 0;
  let uniqueClickCount = 0;
  let unidentifiedClickEvents = 0;
  let linkStats: Array<{
    id: string;
    name: string;
    originalUrl: string;
    clickCount: number;
    uniqueClickCount: number;
    unidentifiedClickEvents: number;
    isLegacyAggregate: boolean;
  }> = [];

  if (linkIds.length > 0) {
    const placeholders = linkIds.map(() => '?').join(',');
    const total = await db
      .prepare(
        `SELECT
           COUNT(*) as clickEvents,
           COUNT(DISTINCT friend_id) as uniqueClickCount,
           SUM(CASE WHEN friend_id IS NULL THEN 1 ELSE 0 END) as unidentifiedClickEvents
         FROM link_clicks
         WHERE tracked_link_id IN (${placeholders})`,
      )
      .bind(...linkIds)
      .first<{ clickEvents: number; uniqueClickCount: number; unidentifiedClickEvents: number }>();
    clickEvents = total?.clickEvents ?? 0;
    uniqueClickCount = total?.uniqueClickCount ?? 0;
    unidentifiedClickEvents = total?.unidentifiedClickEvents ?? 0;

    const perLink = await db
      .prepare(
        `SELECT
           tracked_link_id as id,
           COUNT(*) as clickCount,
           COUNT(DISTINCT friend_id) as uniqueClickCount,
           SUM(CASE WHEN friend_id IS NULL THEN 1 ELSE 0 END) as unidentifiedClickEvents
         FROM link_clicks
         WHERE tracked_link_id IN (${placeholders})
         GROUP BY tracked_link_id`,
      )
      .bind(...linkIds)
      .all<{ id: string; clickCount: number; uniqueClickCount: number; unidentifiedClickEvents: number }>();
    const perLinkMap = new Map(perLink.results.map((item) => [item.id, item]));
    linkStats = await Promise.all(linkGroups.map(async (group) => {
      let stat = group.ids.length === 1 ? perLinkMap.get(group.ids[0]) : undefined;
      if (group.ids.length > 1) {
        const groupPlaceholders = group.ids.map(() => '?').join(',');
        stat = await db
          .prepare(
            `SELECT
               COUNT(*) as clickCount,
               COUNT(DISTINCT friend_id) as uniqueClickCount,
               SUM(CASE WHEN friend_id IS NULL THEN 1 ELSE 0 END) as unidentifiedClickEvents
             FROM link_clicks
             WHERE tracked_link_id IN (${groupPlaceholders})`,
          )
          .bind(...group.ids)
          .first<{ id: string; clickCount: number; uniqueClickCount: number; unidentifiedClickEvents: number }>()
          ?? undefined;
      }
      return {
        id: group.ids[0],
        name: group.name,
        originalUrl: group.original_url,
        clickCount: stat?.clickCount ?? group.fallbackClickCount,
        uniqueClickCount: stat?.uniqueClickCount ?? 0,
        unidentifiedClickEvents: stat?.unidentifiedClickEvents ?? 0,
        isLegacyAggregate: group.isLegacyAggregate,
      };
    }));
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

  // 全員配信は success_count を持たない（LINE全員配信APIが宛先数を返さない）ため、
  // 送信時に記録した total_count を分母に使う。tag/segment の失敗配信は0のままにする。
  const deliveredCount = row.success_count
    || (sentLog?.count ?? 0)
    || (row.target_type === 'all' ? (row.total_count ?? 0) : 0);
  const effectiveUniqueClickCount = uniqueClickCount || manualMetrics?.click_count || 0;
  const clickRate = manualMetrics?.click_rate ?? (
    deliveredCount > 0 ? (effectiveUniqueClickCount / deliveredCount) * 100 : null
  );
  // ブロック率は保存値ではなく読み取り時に計算する（旧式の破綻値を表示しない）。
  // テスト配信・個別指定は運用判断に使わないため率を出さない。
  const blockStats = (row.is_test || row.target_type === 'individual')
    ? { unfollowCount: null, rate: null }
    : await getBroadcastBlockStats(db, row);
  // 配信→売上（クリック経由の下限と、配信対象者の購入による上限）
  const attribution = await getBroadcastAttribution(db, row);

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
      unidentifiedClickEvents,
      clickRate,
      trackedLinkCount: linkGroups.length,
      blockUnfollowCount: blockStats.unfollowCount,
      blockRate24h: blockStats.rate,
      officialClickCount: null as number | null,
      officialClickRate: null as number | null,
      officialStatsStatus: manualMetrics?.open_count != null || manualMetrics?.open_rate != null
        ? 'available' as const
        : (row.line_aggregation_unit || row.line_request_id)
          ? 'pending' as const
          : 'not_configured' as const,
    },
    attribution,
    trackedLinks: linkStats,
  };
}

function toLineInsightDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

async function applyOfficialInteractionStats(
  db: D1Database,
  defaultAccessToken: string,
  broadcast: DbBroadcast,
  detail: Awaited<ReturnType<typeof getBroadcastDetail>>,
): Promise<typeof detail> {
  if (!broadcast.sent_at || (!broadcast.line_request_id && !broadcast.line_aggregation_unit)) {
    return detail;
  }

  try {
    const client = await resolveBroadcastLineClient(db, defaultAccessToken, broadcast);
    const stats = broadcast.line_request_id
      ? await client.getMessageInteractionStats(broadcast.line_request_id)
      : await client.getAggregationStats(
          broadcast.line_aggregation_unit!,
          toLineInsightDate(broadcast.sent_at),
          toLineInsightDate(broadcast.sent_at),
        );

    const delivered = stats.overview.delivered;
    if (typeof delivered === 'number' && delivered > 0) detail.metrics.deliveredCount = delivered;
    const denominator = detail.metrics.deliveredCount;
    const openCount = stats.overview.uniqueImpression;
    const officialClickCount = stats.overview.uniqueClick;

    detail.metrics.openCount = openCount;
    detail.metrics.openRate = typeof openCount === 'number' && denominator > 0
      ? (openCount / denominator) * 100
      : null;
    detail.metrics.officialClickCount = officialClickCount;
    detail.metrics.officialClickRate = typeof officialClickCount === 'number' && denominator > 0
      ? (officialClickCount / denominator) * 100
      : null;
    if (typeof officialClickCount === 'number') {
      detail.metrics.uniqueClickCount = officialClickCount;
      detail.metrics.clickRate = detail.metrics.officialClickRate;
    }
    detail.metrics.officialStatsStatus = 'available';
  } catch (error) {
    console.warn(`LINE interaction stats unavailable for broadcast ${broadcast.id}:`, error);
    detail.metrics.officialStatsStatus = 'pending';
  }

  return detail;
}

// GET /api/broadcasts - list all
broadcasts.get('/api/broadcasts', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const archived = c.req.query('archived');
    const q = (c.req.query('q') ?? '').trim();
    const from = c.req.query('from');
    const to = c.req.query('to');
    const targetType = c.req.query('targetType');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 500) || 500, 1), 500);
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);

    const conditions: string[] = [
      archived === 'true'
        ? 'archived_at IS NOT NULL'
        : archived === 'all'
          ? '1 = 1'
          : 'archived_at IS NULL',
    ];
    const binds: unknown[] = [];

    if (q) {
      // LIKEのワイルドカードを打ち消す（検索語をそのまま部分一致に使う）
      conditions.push("title LIKE ? ESCAPE '\\'");
      binds.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    }
    if (targetType && ['all', 'tag', 'segment', 'individual'].includes(targetType)) {
      conditions.push('target_type = ?');
      binds.push(targetType);
    }
    if (from) {
      conditions.push('created_at >= ?');
      binds.push(from.slice(0, 10));
    }
    if (to) {
      conditions.push('created_at <= ?');
      binds.push(`${to.slice(0, 10)}T23:59:59.999+09:00`);
    }

    if (lineAccountId) {
      const denied = await requireLineAccountAccess(c, lineAccountId);
      if (denied) return denied;
      conditions.push('line_account_id = ?');
      binds.push(lineAccountId);
    } else {
      const ids = await accessibleLineAccountIds(c);
      if (!ids.length) {
        return c.json({ success: true, data: [], meta: { total: 0, limit, offset, hasMore: false } });
      }
      conditions.push(`line_account_id IN (${ids.map(() => '?').join(',')})`);
      binds.push(...ids);
    }

    const where = conditions.join(' AND ');
    const totalRow = await c.env.DB
      .prepare(`SELECT COUNT(*) AS total FROM broadcasts WHERE ${where}`)
      .bind(...binds)
      .first<{ total: number }>();
    const result = await c.env.DB
      .prepare(`SELECT * FROM broadcasts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<DbBroadcast>();
    const total = totalRow?.total ?? 0;

    return c.json({
      success: true,
      data: result.results.map(serializeBroadcast),
      meta: { total, limit, offset, hasMore: offset + result.results.length < total },
    });
  } catch (err) {
    console.error('GET /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/archive - 一覧から片付ける（履歴は保持）
broadcasts.post('/api/broadcasts/:id/archive', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    const updated = await updateBroadcast(c.env.DB, id, { archived_at: new Date().toISOString() });
    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/archive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/unarchive - アーカイブから戻す
broadcasts.post('/api/broadcasts/:id/unarchive', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    const updated = await updateBroadcast(c.env.DB, id, { archived_at: null });
    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/unarchive error:', err);
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
    const denied = await requireLineAccountAccess(c, lineAccountId);
    if (denied) return denied;

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
    return c.json({ success: true, data: count });
  } catch (err) {
    console.error('GET /api/broadcasts/target-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/target-count - 個別指定（friendIds配列）の対象人数
// GETでは ID を1,680件並べられないため、配列はボディで受ける。
broadcasts.post('/api/broadcasts/target-count', async (c) => {
  try {
    const body = await c.req
      .json<{
        targetType?: BroadcastTargetType;
        targetTagId?: string | null;
        targetSegmentId?: string | null;
        lineAccountId?: string | null;
        targetFriendIds?: string[] | null;
      }>()
      .catch(() => ({} as Record<string, never>));
    const targetType = body?.targetType;
    const lineAccountId = body?.lineAccountId ?? null;
    const denied = await requireLineAccountAccess(c, lineAccountId);
    if (denied) return denied;

    if (!targetType || !['all', 'tag', 'segment', 'individual'].includes(targetType)) {
      return c.json({ success: false, error: 'targetType is required' }, 400);
    }

    const count = await countBroadcastTargets(
      c.env.DB,
      targetType,
      body?.targetTagId ?? null,
      body?.targetSegmentId ?? null,
      lineAccountId,
      Array.isArray(body?.targetFriendIds) ? body.targetFriendIds : null,
    );
    return c.json({ success: true, data: count });
  } catch (err) {
    console.error('POST /api/broadcasts/target-count error:', err);
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
    const denied = await requireLineAccountAccess(c, broadcast.line_account_id);
    if (denied) return denied;

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
    const denied = await requireLineAccountAccess(c, broadcast.line_account_id);
    if (denied) return denied;

    const detail = await getBroadcastDetail(c.env.DB, broadcast);
    const withOfficialStats = await applyOfficialInteractionStats(
      c.env.DB,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
      broadcast,
      detail,
    );
    return c.json({ success: true, data: withOfficialStats });
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
      isTest?: boolean;
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

    if (body.scheduledAt && hasUneditedNotificationText(body.messageType, body.messageContent, body.altText)) {
      return c.json({ success: false, error: NOTIFICATION_TEXT_ERROR }, 400);
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
      isTest: body.isTest ?? false,
    });

    // Save line_account_id, alt_text, is_test if provided
    const updates: string[] = [];
    const binds: unknown[] = [];
    if (body.lineAccountId) { updates.push('line_account_id = ?'); binds.push(body.lineAccountId); }
    if (body.altText) { updates.push('alt_text = ?'); binds.push(body.altText); }
    if (body.isTest !== undefined) { updates.push('is_test = ?'); binds.push(body.isTest ? 1 : 0); }
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

// POST /api/broadcasts/validate - 送信前チェック（宛先0名・文字数・リンク切れ・薬機/景表の表現）
// blocks=送信を止める / warnings=確認すれば送信できる、の2種類を返す。
async function checkUrlReachable(url: string): Promise<{ status: 'ok' | 'missing' | 'unknown' }> {
  // 内部アドレスへのfetch（SSRF）を避ける。http/https以外とプライベートホストは疎通確認しない。
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'missing' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { status: 'unknown' };
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '::1'
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host.startsWith('169.254.')
  ) {
    return { status: 'unknown' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    if (res.status === 404 || res.status === 410) return { status: 'missing' };
    return { status: 'ok' };
  } catch {
    return { status: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

broadcasts.post('/api/broadcasts/validate', async (c) => {
  try {
    const body = await c.req.json<{
      messageType?: string;
      messageContent?: string;
      altText?: string | null;
      targetType?: BroadcastTargetType;
      targetTagId?: string | null;
      targetSegmentId?: string | null;
      targetFriendIds?: string[] | null;
      lineAccountId?: string | null;
    }>();

    const blocks: Array<{ code: string; message: string }> = [];
    const warnings: Array<{ code: string; message: string }> = [];

    // 1. 宛先0名は送信させない
    if (body.targetType === 'individual') {
      if (!body.targetFriendIds || body.targetFriendIds.length === 0) {
        blocks.push({ code: 'no_target', message: '送信先の友だちが0人です' });
      }
    } else if (body.targetType) {
      const count = await countBroadcastTargets(
        c.env.DB,
        body.targetType,
        body.targetTagId ?? null,
        body.targetSegmentId ?? null,
        body.lineAccountId ?? null,
      );
      if (count.count === 0) {
        blocks.push({ code: 'no_target', message: '配信対象が0人です。タグ・セグメントを確認してください' });
      }
    }

    if (!body.messageType || !body.messageContent?.trim()) {
      blocks.push({ code: 'empty_message', message: '本文が空です' });
    } else {
      // 2. 文字数（LINEのテキスト上限5,000字・altText上限400字）
      let texts: string[] = [];
      if (body.messageType === 'multi') {
        try {
          const arr = JSON.parse(body.messageContent) as Array<{ type?: string; content?: string }>;
          texts = Array.isArray(arr) ? arr.filter((m) => m?.type === 'text').map((m) => m?.content ?? '') : [];
        } catch {
          blocks.push({ code: 'invalid_multi', message: '複数メッセージの形式が壊れています' });
        }
      } else if (body.messageType === 'text') {
        texts = [body.messageContent];
      }
      findTooLongText(texts).forEach(({ index, length }) => {
        blocks.push({ code: 'text_too_long', message: `#${index + 1} が${length}字です（LINEの上限は5,000字）` });
      });
      if ((body.altText ?? '').length > 400) {
        blocks.push({ code: 'alt_too_long', message: '通知文言（altText）が400字を超えています' });
      }

      // 3. リンク切れ（404/410は止める・疎通不明は警告）
      const urls = extractUrls(extractTextForValidation(body.messageType, body.messageContent));
      const results = await Promise.all(urls.map(async (url) => ({ url, ...(await checkUrlReachable(url)) })));
      for (const r of results) {
        if (r.status === 'missing') {
          blocks.push({ code: 'url_missing', message: `リンク先が見つかりません（404）: ${r.url}` });
        } else if (r.status === 'unknown') {
          warnings.push({ code: 'url_unknown', message: `リンク先の疎通を確認できませんでした: ${r.url}` });
        }
      }

      // 4. 薬機法・景表法の表現（止めずに確認を促す）
      const target = extractTextForValidation(body.messageType, body.messageContent);
      const drugHits = detectClaimWarnings(target, 'drug');
      if (drugHits.length > 0) {
        warnings.push({
          code: 'drug_claim',
          message: `医薬品的な効能表現にあたる可能性: ${drugHits.join('、')}`,
        });
      }
      const adHits = detectClaimWarnings(target, 'ad');
      if (adHits.length > 0) {
        warnings.push({
          code: 'ad_claim',
          message: `景表法上の優良誤認になりうる表現: ${adHits.join('、')}`,
        });
      }
    }

    return c.json({ success: true, data: { blocks, warnings } });
  } catch (err) {
    console.error('POST /api/broadcasts/validate error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/test-send - 保存前の本文を1名だけに送って確認する
// 本番の宛先設定・計測リンク・配信実績には一切触らない（DB書き込みなし）。
broadcasts.post('/api/broadcasts/test-send', async (c) => {
  try {
    const body = await c.req.json<{
      friendId?: string;
      messageType?: string;
      messageContent?: string;
      altText?: string | null;
      lineAccountId?: string | null;
    }>();

    if (!body.friendId) {
      return c.json({ success: false, error: '送信先の友だちを指定してください' }, 400);
    }
    if (!body.messageType || !body.messageContent?.trim()) {
      return c.json({ success: false, error: '送信する本文がありません' }, 400);
    }

    const friend = await c.env.DB
      .prepare('SELECT id, display_name, line_user_id, is_following, line_account_id FROM friends WHERE id = ?')
      .bind(body.friendId)
      .first<{ id: string; display_name: string | null; line_user_id: string | null; is_following: number | null; line_account_id: string | null }>();

    if (!friend) {
      return c.json({ success: false, error: '友だちが見つかりません' }, 400);
    }
    if (!isSendableLineUserId(friend.line_user_id)) {
      return c.json({ success: false, error: 'この友だちはLINEのIDを持っていないため送信できません（メールのみの連携）' }, 400);
    }
    if (friend.is_following !== 1) {
      return c.json({ success: false, error: 'この友だちはブロック中・未フォローのため送信できません' }, 400);
    }

    const messages = buildMessages(body.messageType, body.messageContent, body.altText ?? undefined);
    if (messages.length === 0) {
      return c.json({ success: false, error: '送信する本文がありません' }, 400);
    }
    if (messages.length > 5) {
      return c.json({ success: false, error: 'LINEで一度に送れるのは5通までです' }, 400);
    }

    const lineAccountId = body.lineAccountId ?? friend.line_account_id ?? null;
    if (lineAccountId) {
      const denied = await requireLineAccountAccess(c, lineAccountId);
      if (denied) return denied;
    }

    const client = await resolveBroadcastLineClient(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN, {
      id: 'test-send',
      line_account_id: lineAccountId,
    });

    try {
      await client.pushMessage(friend.line_user_id, messages);
    } catch (err) {
      console.error('POST /api/broadcasts/test-send LINE error:', err);
      return c.json({ success: false, error: 'LINE側で送信できませんでした。本文の形式と友だちの状態を確認してください。' }, 502);
    }

    return c.json({
      success: true,
      data: { friendId: friend.id, displayName: friend.display_name ?? '', messageCount: messages.length },
    });
  } catch (err) {
    console.error('POST /api/broadcasts/test-send error:', err);
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
      isTest?: boolean;
    }>();

    // Keep status in sync with scheduledAt changes
    let statusUpdate: 'draft' | 'scheduled' | undefined;
    if (body.scheduledAt !== undefined) {
      statusUpdate = body.scheduledAt ? 'scheduled' : 'draft';
    }

    const scheduledAt = body.scheduledAt !== undefined ? body.scheduledAt : existing.scheduled_at;
    if (scheduledAt && hasUneditedNotificationText(
      body.messageType ?? existing.message_type,
      body.messageContent ?? existing.message_content,
      body.altText !== undefined ? body.altText : (existing as unknown as { alt_text?: string | null }).alt_text,
    )) {
      return c.json({ success: false, error: NOTIFICATION_TEXT_ERROR }, 400);
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
      is_test: body.isTest !== undefined ? (body.isTest ? 1 : 0) : undefined,
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

// POST /api/broadcasts/:id/reset - 「送信中」で固まった配信・全滅した配信をドラフトに戻す
broadcasts.post('/api/broadcasts/:id/reset', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    // 送信完了済みは原則リセット不可（二重送信の危険）。
    // ただし「1件も届かず、失敗が記録されている」配信は復旧させる（429等の全滅ケース）。
    // 同日重複除外で0件だった配信（failed_count=0）は意図的な未送信なので対象外。
    const allFailed = existing.status === 'sent'
      && (existing.success_count ?? 0) === 0
      && (existing.failed_count ?? 0) > 0;
    if (existing.status === 'sent' && !allFailed) {
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

    if (hasUneditedNotificationText(existing.message_type, existing.message_content, (existing as unknown as { alt_text?: string | null }).alt_text)) {
      return c.json({ success: false, error: NOTIFICATION_TEXT_ERROR }, 400);
    }

    const lineClient = await resolveBroadcastLineClient(c.env.DB, c.env.LINE_CHANNEL_ACCESS_TOKEN, existing);

    if (existing.target_type === 'segment' && existing.target_segment_id) {
      const segment = await getSegmentById(c.env.DB, existing.target_segment_id);
      if (segment?.source === 'shopify' && (segment.sync_status === 'syncing' || segment.sync_status === 'error')) {
        return c.json({
          success: false,
          error: 'このShopifyセグメントは同期未確定です。同期完了後に対象人数を再確認してから配信してください。',
        }, 409);
      }
      // セグメントターゲット: 事前に空でないことを確認
      const count = (await getSegmentLineUserIds(
        c.env.DB,
        existing.target_segment_id,
        existing.line_account_id,
      )).length;
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

export { broadcasts };
