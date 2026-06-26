import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  updateBroadcastStatus,
  getFriendsByTag,
  getSegmentLineUserIds,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';

const MULTICAST_BATCH_SIZE = 500;

export async function processBroadcastSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  workerUrl?: string,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (finalType !== 'multi' && parseMultiMessageContent(finalContent)) {
    finalType = 'multi';
  }
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, finalType, finalContent, workerUrl);
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
      const followingFriends = friends.filter((f) => f.is_following && f.line_user_id);
      totalCount = followingFriends.length;

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
      for (let i = 0; i < followingFriends.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = followingFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const lineUserIds = batch.map((f) => f.line_user_id);

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
          successCount += batch.length;
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // 失敗バッチの件数と理由を記録（握りつぶさず可視化する）
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue; // LINE送信が失敗したらログも書かずに次のバッチへ
        }

        // ログ書き込みエラーは LINE 配信失敗とは別扱い（ログ失敗で「配信失敗」と誤表示しない）
        for (const friend of batch) {
          try {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          } catch (logErr) {
            console.warn(`messages_log INSERT failed (LINE送信は成功済み):`, logErr);
          }
        }
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
          `SELECT id, line_user_id FROM friends WHERE id IN (${friendIds.map(() => '?').join(',')}) AND is_following = 1 AND line_user_id IS NOT NULL AND line_user_id != ''`,
        )
        .bind(...friendIds)
        .all<{ id: string; line_user_id: string }>();
      const friends = result.results;
      totalCount = friends.length;

      const now = jstNow();
      const lineUserIds = friends.map((f) => f.line_user_id);
      for (let i = 0; i < lineUserIds.length; i += MULTICAST_BATCH_SIZE) {
        const batch = friends.slice(i, i + MULTICAST_BATCH_SIZE);
        const batchUserIds = batch.map((f) => f.line_user_id);
        try {
          await lineClient.multicast(batchUserIds, messages);
          successCount += batch.length;
        } catch (err) {
          console.error(`Individual multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue;
        }
        for (const friend of batch) {
          try {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          } catch (logErr) {
            console.warn(`messages_log INSERT failed (LINE送信は成功済み):`, logErr);
          }
        }
      }
    } else if (broadcast.target_type === 'segment') {
      if (!broadcast.target_segment_id) {
        throw new Error('target_segment_id is required for segment-targeted broadcasts');
      }

      const lineUserIds = await getSegmentLineUserIds(db, broadcast.target_segment_id);
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
          successCount += batch.length;
        } catch (err) {
          console.error(`Segment multicast batch ${batchIndex} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
          continue;
        }
        // ログ書き込みエラーは LINE 配信失敗とは別扱い
        for (const lineUserId of batch) {
          try {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, '', 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          } catch (logErr) {
            console.warn(`messages_log INSERT failed (LINE送信は成功済み):`, logErr);
          }
        }
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
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);
  const nowMs = Date.now();

  // cron が起動した時点で "sending" の配信 = 前回の cron が Cloudflare に強制終了された証拠。
  // ドラフトに戻して再送できる状態にする。
  const stuck = allBroadcasts.filter((b) => b.status === 'sending');
  for (const b of stuck) {
    console.warn(`Auto-recovering stuck broadcast ${b.id} (was sending)`);
    await updateBroadcastStatus(db, b.id, 'draft');
  }

  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    try {
      await processBroadcastSend(db, lineClient, broadcast.id, workerUrl);
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
