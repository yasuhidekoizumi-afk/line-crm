import { extractFlexAltText } from '../utils/flex-alt-text.js';

/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * target_date + offset_minutes の時刻が現在時刻以前で
 * まだ配信されていないステップを配信する
 */

import {
  getDueReminderDeliveries,
  markReminderStepDelivered,
  completeReminderIfDone,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = jstNow();
  const dueReminders = await getDueReminderDeliveries(db, now);

  for (let i = 0; i < dueReminders.length; i++) {
    const fr = dueReminders[i];
    try {
      // ステルス: バースト回避のためランダム遅延
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }

      const friend = await getFriendById(db, fr.friend_id);
      if (!friend || !friend.is_following) {
        // フォロー解除済み — スキップ
        continue;
      }

      for (const step of fr.steps) {
        // {{metadata}} プレースホルダーをカートFlexメッセージで置換
        let resolvedContent = step.message_content;
        if (resolvedContent.includes('{{metadata}}') && fr.metadata) {
          try {
            const cartFlex = buildCartFlexMessage(fr.metadata);
            await lineClient.pushMessage(friend.line_user_id, [cartFlex]);
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?)`,
              )
              .bind(logId, friend.id, 'flex', resolvedContent, jstNow())
              .run();
            await markReminderStepDelivered(db, fr.id, step.id);
            continue;
          } catch (e) {
            console.error('buildCartFlexMessage エラー:', e);
          }
        }
        const message = buildMessage(step.message_type, resolvedContent);
        await lineClient.pushMessage(friend.line_user_id, [message]);

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?)`,
          )
          .bind(logId, friend.id, step.message_type, step.message_content, jstNow())
          .run();

        // 配信済みを記録
        await markReminderStepDelivered(db, fr.id, step.id);
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}

interface CartMetadata {
  checkout_url?: string;
  items?: Array<{ title: string; image_url?: string; price: string }>;
  type?: 'CHECKOUT' | 'CART';
}

export function buildCartFlexMessage(metadataJson: string): Message {
  const meta: CartMetadata = JSON.parse(metadataJson);
  const items = meta.items ?? [];
  const firstItem = items[0];
  const checkoutUrl = meta.checkout_url ?? '';
  const type = meta.type ?? 'CHECKOUT';

  const titleText = type === 'CART' ? 'カートに商品が残っています' : 'チェックアウトが未完了です';
  const buttonLabel = type === 'CART' ? 'カートを見る' : '購入を完了する';

  const bodyContents: object[] = [];

  if (firstItem) {
    const itemComponents: object[] = [];
    if (firstItem.image_url) {
      itemComponents.push({
        type: 'image',
        url: firstItem.image_url,
        size: 'md',
        aspectMode: 'cover',
        aspectRatio: '1:1',
        margin: 'none',
      });
    }
    itemComponents.push({
      type: 'text',
      text: firstItem.title,
      weight: 'bold',
      size: 'sm',
      wrap: true,
    });
    itemComponents.push({
      type: 'text',
      text: firstItem.price,
      size: 'sm',
      color: '#666666',
    });
    bodyContents.push({
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: itemComponents,
    });
  }

  if (items.length > 1) {
    bodyContents.push({
      type: 'text',
      text: `他 ${items.length - 1} 点`,
      size: 'xs',
      color: '#888888',
    });
  }

  bodyContents.push({
    type: 'text',
    text: 'ご購入はお済みですか？',
    size: 'sm',
    color: '#888888',
    wrap: true,
    margin: 'md',
  });

  const bubble: object = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `\uD83D\uDED2 ${titleText}`,
          weight: 'bold',
          size: 'sm',
          color: '#ffffff',
        },
      ],
      backgroundColor: '#06C755',
      paddingAll: '12px',
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: bodyContents,
    },
    ...(checkoutUrl
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#06C755',
                action: {
                  type: 'uri',
                  label: buttonLabel,
                  uri: checkoutUrl,
                },
              },
            ],
          },
        }
      : {}),
  };

  const altItemLabel = firstItem ? firstItem.title : '商品';
  return {
    type: 'flex',
    altText: `${altItemLabel}が${type === 'CART' ? 'カート' : 'チェックアウト'}に残っています`,
    contents: bubble,
  } as Message;
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }
  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as { originalContentUrl: string; previewImageUrl: string };
      return { type: 'image', originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl };
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
