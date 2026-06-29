import {
  getBroadcastById,
  updateBroadcastStatus,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { buildSegmentQuery } from './segment-query.js';
// multi タイプを含む全タイプを正しく Message[] に展開するため、broadcast.ts の buildMessages を使う
import { buildMessages, isSendableLineUserId } from './broadcast.js';
import type { SegmentCondition } from './segment-query.js';

const MULTICAST_BATCH_SIZE = 500;

interface FriendRow {
  id: string;
  line_user_id: string;
}

export async function processSegmentSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  condition: SegmentCondition,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  // multi タイプも正しく処理するため buildMessages(配列)を使う
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const messages = buildMessages(broadcast.message_type, broadcast.message_content, altText || undefined);

  let totalCount = 0;
  let successCount = 0;

  try {
    // Build and execute segment query to get matching friends
    const { sql, bindings } = buildSegmentQuery(condition);
    const queryResult = await db
      .prepare(sql)
      .bind(...bindings)
      .all<FriendRow>();

    const friends = queryResult.results ?? [];
    totalCount = friends.length;

    const now = jstNow();
    const totalBatches = Math.ceil(friends.length / MULTICAST_BATCH_SIZE);

    for (let i = 0; i < friends.length; i += MULTICAST_BATCH_SIZE) {
      const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
      const batch = friends.slice(i, i + MULTICAST_BATCH_SIZE);
      // 宛先が無効(line_user_id が null/空/合成ID)の友だちを除外する。
      // 1件でも無効なIDが混ざると LINE の multicast がバッチ全体(最大500件)を弾くため、事前に取り除く。
      const validFriends = batch.filter((f) => isSendableLineUserId(f.line_user_id));
      const lineUserIds = validFriends.map((f) => f.line_user_id.trim());
      if (lineUserIds.length === 0) continue;

      // Stealth: stagger delays between batches
      if (batchIndex > 0) {
        const delay = calculateStaggerDelay(friends.length, batchIndex);
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
        successCount += validFriends.length;

        // Log successfully sent messages
        for (const friend of validFriends) {
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
        console.error(`Segment multicast batch ${batchIndex} failed:`, err);
        // Continue with next batch; failed batch is not logged
      }
    }

    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}
