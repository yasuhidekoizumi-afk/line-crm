/**
 * FERMENT: 配信停止公開エンドポイント（認証不要）
 *
 * GET  /email/unsubscribe?email=xxx&token=xxx — 確認ページ
 * POST /email/unsubscribe                     — 配信停止実行
 * GET  /email/view/:logId                     — 開封トラッキングピクセル
 */

import { Hono } from 'hono';
import {
  addSuppression,
  updateCustomer,
  getCustomerByEmail,
  updateEmailLog,
  getEmailLogById,
} from '@line-crm/db';
import { verifyUnsubscribeToken } from '../personalize.js';
import type { FermentEnv } from '../types.js';

export const publicEmailRoutes = new Hono<FermentEnv>();

// 配信停止確認ページ（GET）
publicEmailRoutes.get('/unsubscribe', async (c) => {
  const email = c.req.query('email') ?? '';
  const token = c.req.query('token') ?? '';

  // 最低限のバリデーション
  if (!email || !token) {
    return c.html(errorPage('無効なリンクです。'));
  }

  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>メール配信停止 | オリゼ</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans',system-ui,sans-serif;background:#f5f5f5;color:#333;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:12px;padding:40px 32px;max-width:440px;width:90%;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h1{font-size:20px;font-weight:700;margin-bottom:12px}
p{font-size:14px;color:#666;line-height:1.7;margin-bottom:28px}
.email{font-weight:600;color:#333}
.btn{display:block;width:100%;padding:14px;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;background:#e74c3c;color:#fff}
.btn:hover{opacity:.85}
.cancel{display:block;margin-top:12px;font-size:13px;color:#999;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <h1>メール配信停止</h1>
  <p>以下のメールアドレスへのオリゼからのメール配信を停止します。</p>
  <p class="email">${escapeHtml(email)}</p>
  <form method="POST" action="/email/unsubscribe">
    <input type="hidden" name="email" value="${escapeHtml(email)}">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit" class="btn">配信を停止する</button>
  </form>
  <a href="https://oryzae.jp" class="cancel">停止しない（サイトに戻る）</a>
</div>
</body>
</html>`);
});

// 配信停止実行（POST）
publicEmailRoutes.post('/unsubscribe', async (c) => {
  try {
    const body = await c.req.parseBody();
    const email = String(body.email ?? '');
    const token = String(body.token ?? '');

    if (!email || !token) {
      return c.html(errorPage('無効なリクエストです。'));
    }

    // トークン検証
    const secret = c.env.FERMENT_HMAC_SECRET ?? 'dev-secret';
    const valid = await verifyUnsubscribeToken(email, token, secret);
    if (!valid) {
      return c.html(errorPage('リンクが無効または期限切れです。'));
    }

    // 配信停止処理
    await addSuppression(c.env.DB, email, 'unsubscribed');
    const customer = await getCustomerByEmail(c.env.DB, email);
    if (customer) {
      await updateCustomer(c.env.DB, customer.customer_id, {
        subscribed_email: 0,
      });
    }

    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>配信停止完了 | オリゼ</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans',system-ui,sans-serif;background:#f5f5f5;color:#333;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:12px;padding:40px 32px;max-width:440px;width:90%;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h1{font-size:20px;font-weight:700;margin-bottom:12px}
p{font-size:14px;color:#666;line-height:1.7}
</style>
</head>
<body>
<div class="card">
  <h1>✅ 配信停止が完了しました</h1>
  <p>今後、オリゼからのメールは送信されません。<br>ご利用ありがとうございました。</p>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('[FERMENT] unsubscribe error:', err);
    return c.html(errorPage('処理中にエラーが発生しました。'));
  }
});

// 開封トラッキングピクセル
publicEmailRoutes.get('/view/:logId', async (c) => {
  const logId = c.req.param('logId');

  try {
    const log = await getEmailLogById(c.env.DB, logId);
    if (log && !log.opened_at) {
      const now = new Date().toISOString();
      await updateEmailLog(c.env.DB, logId, {
        status: 'opened',
        opened_at: now,
      });
    }
  } catch {
    // トラッキングエラーは無視（UX を壊さない）
  }

  // 1x1 透明 GIF を返す
  const gif = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
  ]);

  return new Response(gif, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
});

// ============================================================
// ヘルパー
// ============================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><title>エラー | オリゼ</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center">
<h1>エラー</h1><p>${escapeHtml(message)}</p>
</body>
</html>`;
}
