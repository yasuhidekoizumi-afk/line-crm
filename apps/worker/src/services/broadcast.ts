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
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;
  let failedCount = 0;
  const errorMessages: string[] = [];

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      await lineClient.broadcast([message]);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id);
      const followingFriends = friends.filter((f) => f.is_following);
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

        // Stealth: add slight variation to text messages
        let batchMessage = message;
        if (message.type === 'text' && totalBatches > 1) {
          batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
        }

        try {
          await lineClient.multicast(lineUserIds, [batchMessage]);
          successCount += batch.length;

          // Log only successfully sent messages
          for (const friend of batch) {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          }
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // 失敗バッチの件数と理由を記録（握りつぶさず可視化する）
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
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
          `SELECT id, line_user_id FROM friends WHERE id IN (${friendIds.map(() => '?').join(',')}) AND is_following = 1`,
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
          await lineClient.multicast(batchUserIds, [message]);
          successCount += batch.length;
          for (const friend of batch) {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          }
        } catch (err) {
          console.error(`Individual multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
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

        let batchMessage = message;
        if (message.type === 'text' && totalBatches > 1) {
          batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
        }

        try {
          await lineClient.multicast(batch, [batchMessage]);
          successCount += batch.length;

          // Log messages (friend_id unknown for segment sends, use placeholder)
          for (const lineUserId of batch) {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, '', 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          }
        } catch (err) {
          console.error(`Segment multicast batch ${batchIndex} failed:`, err);
          failedCount += batch.length;
          errorMessages.push(err instanceof Error ? err.message : String(err));
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
  const now = jstNow();
  const allBroadcasts = await getBroadcasts(db);

  const nowMs = Date.now();
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
      };
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

  return { type: 'text', text: messageContent };
}
