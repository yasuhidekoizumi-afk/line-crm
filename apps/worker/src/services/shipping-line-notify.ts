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
  // 購入商品。orders/fulfilled webhookの生ペイロードに含まれる（title/name/quantity）。
  // テスト経路は GraphQL の lineItems から同形に詰め直す。
  line_items?: Array<{ title?: string | null; name?: string | null; quantity?: number | null }> | null;
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
    | 'test_skip'       // テストモード中で対象外（指定LINE以外）
    | 'already_sent'    // この注文は通知済み
    | 'push_error';     // LINE送信エラー
  friendId?: string;
  error?: string;
}

/**
 * LINEのaction URIは非ASCII（生の日本語等）を含むと弾く（"Invalid action URI"）。
 * 日本郵便等の追跡URLは `search=追跡スタート` のように日本語が生で入ることがあるため、
 * 非ASCII文字だけをパーセントエンコードする（既に%エンコード済みのASCII部分は触らない）。
 * http(s) でなければ null（ボタンを出さない）。
 */
function safeTrackingUri(url: string): string | null {
  const u = (url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    return u.replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch));
  } catch {
    return null;
  }
}

/** 発送Flexメッセージ（感謝＋購入商品＋追跡。追跡URLがあればボタン付き） */
function buildShipFlex(
  orderName: string,
  trackingNumber: string,
  trackingUrl: string,
  trackingCompany: string,
  lineItems: { title: string; quantity: number }[] = [],
  isFirstTime = false,
) {
  const bodyContents: Record<string, unknown>[] = [];
  // 初回だけ「LINEで受け取れるようになりました」の案内を添える（2回目以降は出さない）
  if (isFirstTime) {
    bodyContents.push({ type: 'text', text: '📣 LINEで発送のお知らせを受け取れるようになりました！', size: 'sm', color: '#a68b5b', weight: 'bold', wrap: true });
  }
  bodyContents.push(
    { type: 'text', text: 'この度はフードコスメ ORYZAE 公式オンラインショップをご利用いただき、誠にありがとうございます🌾', size: 'sm', color: '#3c2f1e', wrap: true, margin: isFirstTime ? 'md' : 'none' },
    { type: 'text', text: 'ご注文の商品を発送しました。', size: 'sm', color: '#3c2f1e', wrap: true, margin: 'md' },
  );
  if (orderName) {
    bodyContents.push({
      type: 'box', layout: 'baseline', margin: 'lg',
      contents: [
        { type: 'text', text: '注文番号', size: 'xs', color: '#a68b5b', flex: 2 },
        { type: 'text', text: orderName, size: 'sm', color: '#3c2f1e', weight: 'bold', flex: 5 },
      ],
    });
  }
  // 購入商品（最大6点。超過分は「ほかN点」とまとめる）
  if (lineItems.length > 0) {
    bodyContents.push({ type: 'text', text: 'ご注文商品', size: 'xs', color: '#a68b5b', margin: 'lg' });
    const shown = lineItems.slice(0, 6);
    for (const li of shown) {
      const q = li.quantity > 1 ? ` ×${li.quantity}` : '';
      bodyContents.push({ type: 'text', text: `・${li.title}${q}`, size: 'sm', color: '#3c2f1e', wrap: true, margin: 'sm' });
    }
    if (lineItems.length > shown.length) {
      bodyContents.push({ type: 'text', text: `ほか ${lineItems.length - shown.length} 点`, size: 'xs', color: '#a68b5b', margin: 'sm' });
    }
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

  const safeUrl = safeTrackingUri(trackingUrl);
  const footer = safeUrl
    ? {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        contents: [
          { type: 'button', style: 'primary', color: '#a68b5b', height: 'sm',
            action: { type: 'uri', label: '配送状況を見る', uri: safeUrl } },
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
  opts: { force?: boolean; forceFirstTime?: boolean; overrideLineUserId?: string } = {},
): Promise<ShipNotifyResult> {
  const db = env.DB;

  // テスト用: 宛先LINE UIDを明示指定した場合は、連携・ゲート・重複判定を飛ばし、
  // 注文の表示データから組んだカードを指定LINEへ直接送る（チーム内レビュー用）。
  if (opts.overrideLineUserId) {
    const fls0 = (order.fulfillments ?? []).filter((x) => (x.status ?? 'success') !== 'cancelled');
    const f0 = fls0.find((x) => x.tracking_number || x.tracking_url) ?? fls0[fls0.length - 1];
    const items0 = (order.line_items ?? [])
      .map((li) => ({ title: (li.title ?? li.name ?? '').trim(), quantity: typeof li.quantity === 'number' && li.quantity > 0 ? li.quantity : 1 }))
      .filter((li) => li.title);
    const flex0 = buildShipFlex(order.name ?? '', (f0?.tracking_number ?? '').trim(), (f0?.tracking_url ?? '').trim(), (f0?.tracking_company ?? '').trim(), items0, opts.forceFirstTime === true);
    try {
      await new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN).pushMessage(opts.overrideLineUserId, [buildMessage('flex', JSON.stringify(flex0), '商品を発送しました')]);
      return { sent: true, reason: 'ok' };
    } catch (e) {
      return { sent: false, reason: 'push_error', error: e instanceof Error ? e.message : String(e) };
    }
  }

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

  // テストモード: shipping_line_notify_mode='live' になるまでは、指定したLINE
  //（河原さん）にだけ送る。本番webhook登録後も、ここで全顧客への自動配信を止められる。
  // ※ test-shipping-notify（force:true）からの手動テストはこのゲートを通さない。
  if (!opts.force) {
    const mode = (await getLoyaltySetting(db, 'shipping_line_notify_mode').catch(() => null)) ?? 'test';
    if (mode !== 'live') {
      const testUser = await getLoyaltySetting(db, 'shipping_line_notify_test_line_user').catch(() => null);
      if (!testUser || lineUserId !== testUser) {
        return { sent: false, reason: 'test_skip', friendId: lp.friend_id };
      }
    }
  }

  // 追跡情報（キャンセル以外で、追跡番号/URLを持つ履行を優先。なければ最後の履行）
  const fls = (order.fulfillments ?? []).filter((f) => (f.status ?? 'success') !== 'cancelled');
  const f = fls.find((x) => x.tracking_number || x.tracking_url) ?? fls[fls.length - 1];
  const trackingNumber = (f?.tracking_number ?? '').trim();
  const trackingUrl = (f?.tracking_url ?? '').trim();
  const trackingCompany = (f?.tracking_company ?? '').trim();

  // 初回判定: このfriendへ過去に発送通知を送ったことがあるか（このorderの枠確保より前に判定）。
  // 初回だけ「LINEで受け取れるようになりました」の一言を添える。
  let isFirstTime = opts.forceFirstTime === true;
  if (!isFirstTime) {
    const prior = await db
      .prepare(`SELECT 1 FROM shipping_notify_log WHERE friend_id = ? LIMIT 1`)
      .bind(lp.friend_id)
      .first();
    isFirstTime = !prior;
  }

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

  const lineItems = (order.line_items ?? [])
    .map((li) => ({
      title: (li.title ?? li.name ?? '').trim(),
      quantity: typeof li.quantity === 'number' && li.quantity > 0 ? li.quantity : 1,
    }))
    .filter((li) => li.title);
  const flex = buildShipFlex(order.name ?? '', trackingNumber, trackingUrl, trackingCompany, lineItems, isFirstTime);
  try {
    await client.pushMessage(lineUserId, [buildMessage('flex', JSON.stringify(flex), '商品を発送しました')]);
  } catch (e) {
    return { sent: false, reason: 'push_error', friendId: lp.friend_id, error: e instanceof Error ? e.message : String(e) };
  }

  return { sent: true, reason: 'ok', friendId: lp.friend_id };
}
