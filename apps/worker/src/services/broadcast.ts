import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  updateBroadcastStatus,
  getFriendsByTag,
  getSegmentLineUserIds,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { LineClient as LineClientImpl } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { assertLineBroadcastAllowed } from './delivery-safety.js';

const MULTICAST_BATCH_SIZE = 500;
const DEFAULT_IMAGE_MAP_SIZE = { width: 1040, height: 1040 };

interface BroadcastDedupeContext {
  date: string;
  sentLineUserIds: Set<string>;
}

export function isSendableLineUserId(lineUserId: string | null | undefined): lineUserId is string {
  return /^U[0-9a-f]{32}$/i.test(lineUserId?.trim() ?? '');
}

function normalizeSendableLineUserId(lineUserId: string): string {
  return lineUserId.trim();
}

function toImageMapBaseUrl(imageUrl: string): string | null {
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/^\/images\/([^/]+)$/);
    if (!match) return null;
    const imageId = decodeURIComponent(match[1]).replace(/\.(jpe?g|png|webp|gif)$/i, '');
    if (!imageId) return null;
    parsed.pathname = `/images/imagemap/${encodeURIComponent(imageId)}`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function uniqueBySendableLineUserId<T extends { line_user_id: string }>(
  items: T[],
  dedupeContext?: BroadcastDedupeContext,
): T[] {
  const seen = new Set<string>();
  const uniqueItems: T[] = [];

  for (const item of items) {
    const lineUserId = normalizeSendableLineUserId(item.line_user_id);
    if (dedupeContext?.sentLineUserIds.has(lineUserId)) continue;
    if (seen.has(lineUserId)) continue;
    seen.add(lineUserId);
    uniqueItems.push({ ...item, line_user_id: lineUserId });
  }

  return uniqueItems;
}

function uniqueSendableLineUserIds(lineUserIds: string[], dedupeContext?: BroadcastDedupeContext): string[] {
  const seen = new Set<string>();
  const uniqueIds: string[] = [];

  for (const rawLineUserId of lineUserIds) {
    const lineUserId = normalizeSendableLineUserId(rawLineUserId);
    if (dedupeContext?.sentLineUserIds.has(lineUserId)) continue;
    if (seen.has(lineUserId)) continue;
    seen.add(lineUserId);
    uniqueIds.push(lineUserId);
  }

  return uniqueIds;
}

function getBroadcastDedupeDate(broadcast: Pick<Broadcast, 'scheduled_at'>): string {
  return (broadcast.scheduled_at ?? jstNow()).slice(0, 10);
}

async function ensureBroadcastRecipientSendsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS broadcast_recipient_sends (
        id TEXT PRIMARY KEY,
        broadcast_id TEXT NOT NULL,
        line_user_id TEXT NOT NULL,
        line_account_id TEXT,
        sent_date TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
        UNIQUE (broadcast_id, line_user_id)
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_broadcast_recipient_sends_date_account_user
       ON broadcast_recipient_sends (sent_date, line_account_id, line_user_id)`,
    )
    .run();
}

async function getSentLineUserIdsForDate(
  db: D1Database,
  date: string,
  lineAccountId: string | null,
): Promise<Set<string>> {
  await ensureBroadcastRecipientSendsTable(db);

  const result = await db
    .prepare(
      `SELECT DISTINCT line_user_id
       FROM broadcast_recipient_sends
       WHERE sent_date = ?
         AND COALESCE(line_account_id, '') = COALESCE(?, '')`,
    )
    .bind(date, lineAccountId)
    .all<{ line_user_id: string }>();

  return new Set(result.results.map((r) => r.line_user_id));
}

async function recordBroadcastRecipientSends(
  db: D1Database,
  broadcast: Pick<Broadcast, 'id' | 'line_account_id'>,
  date: string,
  lineUserIds: string[],
  sentAt: string,
): Promise<void> {
  if (lineUserIds.length === 0) return;

  await ensureBroadcastRecipientSendsTable(db);
  await db.batch(
    lineUserIds.map((lineUserId) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO broadcast_recipient_sends
             (id, broadcast_id, line_user_id, line_account_id, sent_date, sent_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(`${broadcast.id}:${lineUserId}`, broadcast.id, lineUserId, broadcast.line_account_id, date, sentAt),
    ),
  );
}

async function recordFriendMessageLogs(
  db: D1Database,
  broadcast: Pick<Broadcast, 'id' | 'message_type' | 'message_content'>,
  friends: Array<{ id: string }>,
  createdAt: string,
): Promise<void> {
  if (friends.length === 0) return;

  try {
    await db.batch(
      friends.map((friend) =>
        db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
          )
          .bind(crypto.randomUUID(), friend.id, broadcast.message_type, broadcast.message_content, broadcast.id, createdAt),
      ),
    );
  } catch (logErr) {
    console.warn(`messages_log batch INSERT failed (LINE送信は成功済み):`, logErr);
  }
}

async function recordSegmentMessageLogs(
  db: D1Database,
  broadcast: Pick<Broadcast, 'id' | 'message_type' | 'message_content'>,
  lineUserIds: string[],
  createdAt: string,
): Promise<void> {
  if (lineUserIds.length === 0) return;

  try {
    await db.batch(
      lineUserIds.map(() =>
        db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
             VALUES (?, '', 'outgoing', ?, ?, ?, NULL, ?)`,
          )
          .bind(crypto.randomUUID(), broadcast.message_type, broadcast.message_content, broadcast.id, createdAt),
      ),
    );
  } catch (logErr) {
    console.warn(`messages_log batch INSERT failed (LINE送信は成功済み):`, logErr);
  }
}

async function claimBroadcastForSending(db: D1Database, broadcastId: string): Promise<Broadcast> {
  const existing = await getBroadcastById(db, broadcastId);
  if (!existing) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }
  if (existing.status === 'sending') {
    throw new Error(`Broadcast ${broadcastId} is already sending`);
  }
  if (existing.status === 'sent') {
    throw new Error(`Broadcast ${broadcastId} has already been sent`);
  }

  // 複数のcron/手動実行が同じ予約配信を同時に拾っても、1つだけが送信権を取れるようにする。
  const result = await db
    .prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status IN ('draft', 'scheduled')`)
    .bind(broadcastId)
    .run();
  const changes = result.meta?.changes ?? 0;
  if (changes !== 1) {
    throw new Error(`Broadcast ${broadcastId} was claimed by another process`);
  }

  const claimed = await getBroadcastById(db, broadcastId);
  if (!claimed) {
    throw new Error(`Broadcast ${broadcastId} not found after claim`);
  }
  return claimed;
}

export async function resolveBroadcastLineClient(
  db: D1Database,
  defaultAccessToken: string,
  broadcast: Pick<Broadcast, 'id' | 'line_account_id'>,
): Promise<LineClient> {
  if (!broadcast.line_account_id) return new LineClientImpl(defaultAccessToken);

  const account = await getLineAccountById(db, broadcast.line_account_id).catch(() => null);
  if (!account?.channel_access_token) {
    console.warn(`Broadcast ${broadcast.id} has missing line_account_id token; falling back to default token`);
    return new LineClientImpl(defaultAccessToken);
  }

  return new LineClientImpl(account.channel_access_token);
}

export async function processBroadcastSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  workerUrl?: string,
  dedupeContext?: BroadcastDedupeContext,
): Promise<Broadcast> {
  const current = await getBroadcastById(db, broadcastId);
  if (!current) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }
  await assertLineBroadcastAllowed(db, current.line_account_id);
  const broadcast = await claimBroadcastForSending(db, broadcastId);
  const dedupeDate = getBroadcastDedupeDate(broadcast);
  const activeDedupeContext =
    dedupeContext ?? {
      date: dedupeDate,
      sentLineUserIds: await getSentLineUserIdsForDate(db, dedupeDate, broadcast.line_account_id),
    };

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (finalType !== 'multi' && parseMultiMessageContent(finalContent)) {
    finalType = 'multi';
  }
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, finalType, finalContent, workerUrl, broadcastId);
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  // messages: 配列。'multi' なら複数、それ以外は1要素（後方互換）。
  const messages = buildMessages(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;
  let failedCount = 0;
  const errorMessages: string[] = [];

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      await lineClient.broadcast(messages);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id);
      // line_user_id が NULL/空の行が1件でも混じると LINE API がバッチ全体(最大500人)を
      // 400 で弾いて全滅するため、フォロー中かつ有効なIDのみに絞る。
      const rawFollowingFriends = friends.filter(
        (f) =>
          f.is_following &&
          isSendableLineUserId(f.line_user_id) &&
          (!broadcast.line_account_id ||
            (f as unknown as { line_account_id?: string | null }).line_account_id === broadcast.line_account_id),
      );
      const followingFriends = uniqueBySendableLineUserId(
        rawFollowingFriends,
        activeDedupeContext,
      );
      if (followingFriends.length !== rawFollowingFriends.length) {
        console.warn(
          `Broadcast ${broadcastId} skipped ${rawFollowingFriends.length - followingFriends.length} duplicate line_user_id recipients`,
        );
      }
      totalCount = followingFriends.length;

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
      for (let i = 0; i < followingFriends.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = followingFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const lineUserIds = batch.map((f) => normalizeSendableLineUserId(f.line_user_id));

        // Stealth: add staggered delay between batches
        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(followingFriends.length, batchIndex);
          await sleep(delay);
        }

        // Stealth: 先頭がテキストメッセージなら variation を追加（複数メッセージでも先頭だけ揺らす）
        let batchMessages = messages;
        if (totalBatches > 1 && messages[0]?.type === 'text') {
          const head = messages[0] as { type: 'text'; text: string };
          batchMessages = [
            { ...head, text: addMessageVariation(head.text, batchIndex) },
            ...messages.slice(1),
          ];
        }

        try {
          await lineClient.multicast(lineUserIds, batchMessages);
          try {
            await recordBroadcastRecipientSends(db, broadcast, activeDedupeContext.date, lineUserIds, now);
          } catch (dedupeLogErr) {
            console.warn(`broadcast_recipient_sends INSERT failed (LINE送信は成功済み):`, dedupeLogErr);
          }
          for (const lineUserId of lineUserIds) {
            activeDedupeContext.sentLineUserIds.add(lineUserId);
          }
          successCount += batch.length;
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // 失敗バッチの件数と理由を記録（握りつぶさず可視化する）
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue; // LINE送信が失敗したらログも書かずに次のバッチへ
        }

        // ログ書き込みエラーは LINE 配信失敗とは別扱い（ログ失敗で「配信失敗」と誤表示しない）
        await recordFriendMessageLogs(db, broadcast, batch, now);
      }
    } else if (broadcast.target_type === 'individual') {
      const raw = (broadcast as unknown as Record<string, unknown>).target_friend_ids as string | null;
      if (!raw) {
        throw new Error('target_friend_ids is required for individual-targeted broadcasts');
      }
      const friendIds: string[] = JSON.parse(raw);

      // Fetch line_user_id for each friend
      const result = await db
        .prepare(
          `SELECT id, line_user_id FROM friends
           WHERE id IN (${friendIds.map(() => '?').join(',')})
             AND is_following = 1
             AND line_user_id IS NOT NULL
             AND line_user_id != ''
             ${broadcast.line_account_id ? 'AND line_account_id = ?' : ''}`,
        )
        .bind(...friendIds, ...(broadcast.line_account_id ? [broadcast.line_account_id] : []))
        .all<{ id: string; line_user_id: string }>();
      const friends = result.results;
      const rawValidFriends = friends.filter((f): f is { id: string; line_user_id: string } =>
        isSendableLineUserId(f.line_user_id),
      );
      const validFriends = uniqueBySendableLineUserId(rawValidFriends, activeDedupeContext);
      if (validFriends.length !== rawValidFriends.length) {
        console.warn(
          `Broadcast ${broadcastId} skipped ${rawValidFriends.length - validFriends.length} duplicate line_user_id recipients`,
        );
      }
      totalCount = validFriends.length;

      const now = jstNow();
      const lineUserIds = validFriends.map((f) => normalizeSendableLineUserId(f.line_user_id));
      for (let i = 0; i < lineUserIds.length; i += MULTICAST_BATCH_SIZE) {
        const batch = validFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const batchUserIds = batch.map((f) => normalizeSendableLineUserId(f.line_user_id));
        try {
          await lineClient.multicast(batchUserIds, messages);
          try {
            await recordBroadcastRecipientSends(db, broadcast, activeDedupeContext.date, batchUserIds, now);
          } catch (dedupeLogErr) {
            console.warn(`broadcast_recipient_sends INSERT failed (LINE送信は成功済み):`, dedupeLogErr);
          }
          for (const lineUserId of batchUserIds) {
            activeDedupeContext.sentLineUserIds.add(lineUserId);
          }
          successCount += batch.length;
        } catch (err) {
          console.error(`Individual multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue;
        }
        await recordFriendMessageLogs(db, broadcast, batch, now);
      }
    } else if (broadcast.target_type === 'segment') {
      if (!broadcast.target_segment_id) {
        throw new Error('target_segment_id is required for segment-targeted broadcasts');
      }

      const lineUserIds = (await getSegmentLineUserIds(
        db,
        broadcast.target_segment_id,
        broadcast.line_account_id,
      ))
        .filter(isSendableLineUserId)
        .map(normalizeSendableLineUserId);
      const uniqueLineUserIds = uniqueSendableLineUserIds(lineUserIds, activeDedupeContext);
      if (uniqueLineUserIds.length !== lineUserIds.length) {
        console.warn(
          `Broadcast ${broadcastId} skipped ${lineUserIds.length - uniqueLineUserIds.length} duplicate line_user_id recipients`,
        );
      }
      lineUserIds.splice(0, lineUserIds.length, ...uniqueLineUserIds);
      totalCount = lineUserIds.length;

      // Send in batches with stealth delays
      const now = jstNow();
      const totalBatches = Math.ceil(lineUserIds.length / MULTICAST_BATCH_SIZE);
      for (let i = 0; i < lineUserIds.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = lineUserIds.slice(i, i + MULTICAST_BATCH_SIZE);

        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(lineUserIds.length, batchIndex);
          await sleep(delay);
        }

        // segment配信: 先頭がテキストなら variation を加える（複数メッセージでも先頭だけ）
        let batchMessages = messages;
        if (totalBatches > 1 && messages[0]?.type === 'text') {
          const head = messages[0] as { type: 'text'; text: string };
          batchMessages = [
            { ...head, text: addMessageVariation(head.text, batchIndex) },
            ...messages.slice(1),
          ];
        }

        try {
          await lineClient.multicast(batch, batchMessages);
          try {
            await recordBroadcastRecipientSends(db, broadcast, activeDedupeContext.date, batch, now);
          } catch (dedupeLogErr) {
            console.warn(`broadcast_recipient_sends INSERT failed (LINE送信は成功済み):`, dedupeLogErr);
          }
          for (const lineUserId of batch) {
            activeDedupeContext.sentLineUserIds.add(lineUserId);
          }
          successCount += batch.length;
        } catch (err) {
          console.error(`Segment multicast batch ${batchIndex} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue;
        }
        // ログ書き込みエラーは LINE 配信失敗とは別扱い
        await recordSegmentMessageLogs(db, broadcast, batch, now);
      }
    }

    // 失敗理由は重複を除いて先頭3件までを要約として保存（成功時は null）
    const errorSummary =
      errorMessages.length > 0
        ? Array.from(new Set(errorMessages)).slice(0, 3).join(' | ').slice(0, 500)
        : null;
    await updateBroadcastStatus(db, broadcastId, 'sent', {
      totalCount,
      successCount,
      failedCount,
      errorSummary,
    });
  } catch (err) {
    // LINE送信後にWorkerが落ちると再送が最も危険なため、自動でdraftへ戻さない。
    await updateBroadcastStatus(db, broadcastId, 'sent', {
      totalCount,
      successCount,
      failedCount: failedCount || Math.max(totalCount - successCount, 0),
      errorSummary: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    });
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  defaultAccessToken: string,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);
  const nowMs = Date.now();

  // sending を自動で draft に戻すと、LINE送信済みなのに再送される危険がある。
  // 復旧が必要な場合は、DB上の送信証跡を確認してから手動で判断する。
  const stuck = allBroadcasts.filter((b) => b.status === 'sending');
  for (const b of stuck) {
    console.warn(`Broadcast ${b.id} is still sending; skipping automatic retry`);
  }

  const scheduled = allBroadcasts
    .filter(
      (b) =>
        b.status === 'scheduled' &&
        b.scheduled_at !== null &&
        new Date(b.scheduled_at).getTime() <= nowMs,
    )
    .sort((a, b) => {
      const scheduledDiff =
        new Date(a.scheduled_at ?? 0).getTime() - new Date(b.scheduled_at ?? 0).getTime();
      if (scheduledDiff !== 0) return scheduledDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const dedupeContextsByDateAndAccount = new Map<string, BroadcastDedupeContext>();

  for (const broadcast of scheduled) {
    try {
      const lineClient = await resolveBroadcastLineClient(db, defaultAccessToken, broadcast);
      const dedupeDate = getBroadcastDedupeDate(broadcast);
      const dedupeKey = `${dedupeDate}:${broadcast.line_account_id ?? ''}`;
      let dedupeContext = dedupeContextsByDateAndAccount.get(dedupeKey);
      if (!dedupeContext) {
        dedupeContext = {
          date: dedupeDate,
          sentLineUserIds: await getSentLineUserIdsForDate(db, dedupeDate, broadcast.line_account_id),
        };
        dedupeContextsByDateAndAccount.set(dedupeKey, dedupeContext);
      }
      await processBroadcastSend(db, lineClient, broadcast.id, workerUrl, dedupeContext);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Continue with next broadcast
    }
  }
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
        linkUrl?: string;
      };
      // リンクURLがある場合は LINE Messaging API の仕様上、単純な image メッセージでは
      // 遷移を実現できないため、Flex メッセージ（imageコンポーネント + action.uri）に変換する。
      const linkUrl = parsed.linkUrl?.trim();
      if (linkUrl) {
        const imageMapBaseUrl = toImageMapBaseUrl(parsed.originalContentUrl);
        if (imageMapBaseUrl) {
          return {
            type: 'imagemap',
            baseUrl: imageMapBaseUrl,
            altText: altText || '画像メッセージ',
            baseSize: DEFAULT_IMAGE_MAP_SIZE,
            actions: [
              {
                type: 'uri',
                linkUri: linkUrl,
                area: { x: 0, y: 0, width: DEFAULT_IMAGE_MAP_SIZE.width, height: DEFAULT_IMAGE_MAP_SIZE.height },
              },
            ],
          };
        }
        return {
          type: 'flex',
          altText: altText || '画像メッセージ',
          contents: {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '0px',
              contents: [
                {
                  type: 'image',
                  url: parsed.originalContentUrl,
                  size: 'full',
                  aspectMode: 'cover',
                  aspectRatio: '1:1',
                  action: { type: 'uri', uri: linkUrl },
                },
              ],
            },
          },
        };
      }
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'imagemap') {
    // LINE の imagemap message。公式LINEでいう「リッチメッセージ」。
    // messageContent: { baseUrl, altText?, baseSize:{width,height}, actions:[...] }
    try {
      const parsed = JSON.parse(messageContent) as {
        baseUrl: string;
        altText?: string;
        baseSize: { width: number; height: number };
        actions: Record<string, unknown>[];
      };
      return {
        type: 'imagemap',
        baseUrl: parsed.baseUrl,
        altText: altText || parsed.altText || 'リッチメッセージ',
        baseSize: parsed.baseSize,
        actions: parsed.actions,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  return { type: 'text', text: messageContent };
}

/**
 * messageType='multi' のとき message_content は [{type,content,altText?}, ...] の JSON 配列。
 * それ以外の単一メッセージタイプは1要素配列として返す（後方互換）。
 * LINE Messaging API は1リクエスト最大5メッセージ。
 */
export function buildMessages(messageType: string, messageContent: string, altText?: string): Message[] {
  const inferredMulti = parseMultiMessageContent(messageContent);
  if (messageType !== 'multi' && !inferredMulti) {
    return [buildMessage(messageType, messageContent, altText)];
  }
  try {
    const arr = inferredMulti ?? JSON.parse(messageContent) as Array<{ type: string; content: string; altText?: string }>;
    if (!Array.isArray(arr) || arr.length === 0) return [{ type: 'text', text: messageContent }];
    // LINE仕様: 最大5件
    const safe = arr.slice(0, 5);
    return safe.map((m) => buildMessage(m.type, m.content, m.altText ?? altText));
  } catch {
    return [{ type: 'text', text: messageContent }];
  }
}

function parseMultiMessageContent(
  messageContent: string,
): Array<{ type: string; content: string; altText?: string }> | null {
  const trimmed = messageContent.trim();
  if (!trimmed.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const allowed = new Set(['text', 'image', 'flex', 'imagemap']);
    const isValid = parsed.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.type === 'string' &&
        allowed.has(record.type) &&
        typeof record.content === 'string' &&
        (record.altText === undefined || typeof record.altText === 'string')
      );
    });
    if (!isValid) return null;

    return parsed as Array<{ type: string; content: string; altText?: string }>;
  } catch {
    return null;
  }
}
