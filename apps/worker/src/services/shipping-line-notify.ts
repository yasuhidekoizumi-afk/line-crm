import {
  getLoyaltyPointByShopifyCustomerId,
  getLoyaltySetting,
  getFriendById,
  getLineAccountById,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildMessage } from './step-delivery.js';

// ────────────────────────────────────────────────────────────────────
// 発送LINE通知（Phase 1）
//   注文が発送(orders/fulfilled webhook)されたら、LINE連携済みの顧客へ
//   追跡リンク付きで「発送しました🚚」をLINE送信する。
//
//   設計（2026-06-11 設計書）:
//     - 「LINE連携すると配送状況が見られる」という訴求と機能を一致させる。
//     - 連携済み(=自社ポイント口座があり、実LINEユーザーIDを持つ)友だちだけに送る。
//     - 1注文につき1回だけ（shipping_notify_log で重複防止）。
//     - 機能フラグ shipping_line_notify_enabled='1' のときだけ動作（既定OFF）。
//   通知のオン/オフはクーポン等の原資と無関係なので、特典(送料無料)の決定を待たずに導入できる。
// ────────────────────────────────────────────────────────────────────

export interface ShipNotifyEnv {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  WORKER_URL?: string;
}

interface FulfillmentLite {
  status?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  tracking_company?: string | null;
}

/** 通知に必要な最小限の注文形（orders/fulfilled webかテスト用GraphQLから組み立てる） */
export interface ShipOrderLite {
  id: number | string;
  name?: string | null;
  customer?: { id?: number | string } | null;
  fulfillments?: FulfillmentLite[] | null;
}

export interface ShipNotifyResult {
  sent: boolean;
  reason:
    | 'ok'
    | 'disabled'        // フラグOFF
    | 'no_customer'     // 注文に顧客IDなし（ゲスト等）
    | 'not_linked'      // 自社ポイント未連携（=LINE連携なし）
    | 'no_line_user'    // 実LINEユーザーIDがない（合成sp_友だち等）
    | 'not_following'   // ブロック中（pushできない）
    | 'already_sent'    // この注文は通知済み
    | 'push_error';     // LINE送信エラー
  friendId?: string;
  error?: string;
}

/** 発送Flexメッセージ（追跡URLがあればボタン付き、なければ番号のみ表示） */
function buildShipFlex(orderName: string, trackingNumber: string, trackingUrl: string, trackingCompany: string) {
  const bodyContents: Record<string, unknown>[] = [
    { type: 'text', text: 'ご注文の商品を発送しました。', size: 'sm', color: '#3c2f1e', wrap: true },
  ];
  if (orderName) {
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'lg',
      contents: [
        { type: 'text', text: '注文番号', size: 'xs', color: '#a68b5b', flex: 2 },
        { type: 'text', text: orderName, size: 'sm', color: '#3c2f1e', weight: 'bold', flex: 5 },
      ],
    });
  }
  if (trackingNumber) {
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'md',
      contents: [
        { type: 'text', text: '追跡番号', size: 'xs', color: '#a68b5b', flex: 2 },
        { type: 'text', text: trackingNumber, size: 'sm', color: '#3c2f1e', flex: 5, wrap: true },
      ],
    });
  }
  if (trackingCompany) {
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'md',
      contents: [
        { type: 'text', text: '配送会社', size: 'xs', color: '#a68b5b', flex: 2 },
        { type: 'text', text: trackingCompany, size: 'sm', color: '#3c2f1e', flex: 5 },
      ],
    });
  }

  const footer = trackingUrl
    ? {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [
          { type: 'button', style: 'primary', color: '#a68b5b', height: 'sm',
            action: { type: 'uri', label: '配送状況を見る', uri: trackingUrl } },
        ],
      }
    : undefined;

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#f3ecd8',
      contents: [
        { type: 'text', text: '📦 発送のお知らせ', size: 'lg', weight: 'bold', color: '#3c2f1e' },
      ],
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: bodyContents },
  };
  if (footer) bubble.footer = footer;
  return bubble;
}

/**
 * 注文が発送されたことをLINEで通知する。送らない場合は理由を返す（throwしない）。
 * opts.force=true でフラグ・重複チェックを無視（テスト用）。
 */
export async function notifyOrderShipped(
  env: ShipNotifyEnv,
  order: ShipOrderLite,
  opts: { force?: boolean } = {},
): Promise<ShipNotifyResult> {
  const db = env.DB;

  if (!opts.force) {
    const enabled = await getLoyaltySetting(db, 'shipping_line_notify_enabled').catch(() => null);
    if (enabled !== '1') return { sent: false, reason: 'disabled' };
  }

  const scid = order.customer?.id ? String(order.customer.id) : '';
  if (!scid) return { sent: false, reason: 'no_customer' };
  const orderId = String(order.id);

  // 連携確認（自社ポイント口座 → friend_id）
  const lp = await getLoyaltyPointByShopifyCustomerId(db, scid);
  if (!lp) return { sent: false, reason: 'not_linked' };
  const friend = await getFriendById(db, lp.friend_id);
  const lineUserId = friend?.line_user_id ?? '';
  // 実LINEユーザーIDは 'U' で始まる。合成sp_友だち等は対象外（pushできない）。
  if (!friend || !lineUserId.startsWith('U')) {
    return { sent: false, reason: 'no_line_user', friendId: lp.friend_id };
  }
  if (friend.is_following !== 1) {
    return { sent: false, reason: 'not_following', friendId: lp.friend_id };
  }

  // 追跡情報（キャンセル以外で、追跡番号/URLを持つ履行を優先。なければ最後の履行）
  const fls = (order.fulfillments ?? []).filter((f) => (f.status ?? 'success') !== 'cancelled');
  const f = fls.find((x) => x.tracking_number || x.tracking_url) ?? fls[fls.length - 1];
  const trackingNumber = (f?.tracking_number ?? '').trim();
  const trackingUrl = (f?.tracking_url ?? '').trim();
  const trackingCompany = (f?.tracking_company ?? '').trim();

  // 重複防止: 先に枠を確保（INSERT OR IGNORE）。既存=送信済み → スキップ。
  const claim = await db
    .prepare(
      `INSERT OR IGNORE INTO shipping_notify_log (order_id, friend_id, line_user_id, tracking_number)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(orderId, lp.friend_id, lineUserId, trackingNumber || null)
    .run();
  if (!opts.force && (claim.meta?.changes ?? 0) === 0) {
    return { sent: false, reason: 'already_sent', friendId: lp.friend_id };
  }

  // 送信トークン（友だちの所属LINEアカウント優先・なければ既定）
  let accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (friend.line_account_id) {
    const account = await getLineAccountById(db, friend.line_account_id).catch(() => null);
    if (account) accessToken = account.channel_access_token;
  }
  const client = new LineClient(accessToken);

  const flex = buildShipFlex(order.name ?? '', trackingNumber, trackingUrl, trackingCompany);
  try {
    await client.pushMessage(lineUserId, [buildMessage('flex', JSON.stringify(flex), '商品を発送しました')]);
  } catch (e) {
    return { sent: false, reason: 'push_error', friendId: lp.friend_id, error: e instanceof Error ? e.message : String(e) };
  }

  return { sent: true, reason: 'ok', friendId: lp.friend_id };
}
