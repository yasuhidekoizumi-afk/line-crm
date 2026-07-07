import { Hono } from 'hono';
import {
  createEgiftCampaign,
  getEgiftCampaignById,
  listEgiftCampaigns,
  activateEgiftCampaign,
  deleteEgiftCampaign,
  createEgiftApplication,
  getApplicationCountForCampaign,
  listApplicationsByCampaign,
  getLotteryCandidates,
  createEgiftGift,
  getEgiftGiftById,
  getEgiftGiftByTokenHash,
  listGiftsByCampaign,
  markGiftOpened,
  markGiftLineAdded,
  redeemGift,
  getEgiftCampaignKpi,
  type EgiftCampaign,
  type EgiftApplication,
  type EgiftGift,
  type EgiftKpi,
} from '@line-crm/db';
import type { Env } from '../index.js';

const egift = new Hono<Env>();

// =============================================================================
// Serializers
// =============================================================================

function serializeCampaign(row: EgiftCampaign) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dailyWinnerLimit: row.daily_winner_limit,
    totalGiftLimit: row.total_gift_limit,
    targetSku: row.target_sku,
    targetProductId: row.target_product_id,
    targetVariantId: row.target_variant_id,
    inventoryBudget: row.inventory_budget,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGift(row: EgiftGift) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    applicationId: row.application_id,
    giverFriendId: row.giver_friend_id,
    status: row.status,
    issuedAt: row.issued_at,
    firstOpenedAt: row.first_opened_at,
    lineAddedAt: row.line_added_at,
    redeemedAt: row.redeemed_at,
    fulfilledAt: row.fulfilled_at,
    expiresAt: row.expires_at,
    redeemExpiresAt: row.redeem_expires_at,
    recipientFriendId: row.recipient_friend_id,
  };
}

// =============================================================================
// Campaigns
// =============================================================================

egift.get('/api/egift/campaigns', async (c) => {
  try {
    const campaigns = await listEgiftCampaigns(c.env.DB);
    return c.json({ success: true, data: campaigns.map(serializeCampaign) });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.get('/api/egift/campaigns/:id', async (c) => {
  try {
    const campaign = await getEgiftCampaignById(c.env.DB, c.req.param('id'));
    if (!campaign) return c.json({ success: false, error: 'Campaign not found' }, 404);
    return c.json({ success: true, data: serializeCampaign(campaign) });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.post('/api/egift/campaigns', async (c) => {
  try {
    const body = await c.req.json();
    const campaign = await createEgiftCampaign(c.env.DB, {
      name: body.name,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      dailyWinnerLimit: body.dailyWinnerLimit,
      totalGiftLimit: body.totalGiftLimit,
      targetSku: body.targetSku,
      targetProductId: body.targetProductId,
      targetVariantId: body.targetVariantId,
      inventoryBudget: body.inventoryBudget,
      notes: body.notes,
    });
    return c.json({ success: true, data: serializeCampaign(campaign) }, 201);
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.post('/api/egift/campaigns/:id/activate', async (c) => {
  try {
    await activateEgiftCampaign(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.delete('/api/egift/campaigns/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const campaign = await getEgiftCampaignById(c.env.DB, id);
    if (!campaign) return c.json({ success: false, error: 'Campaign not found' }, 404);
    // active なキャンペーンは削除不可（安全弁）
    if (campaign.status === 'active') {
      return c.json({ success: false, error: '実行中のキャンペーンは削除できません。先に停止してください。' }, 400);
    }
    await deleteEgiftCampaign(c.env.DB, id);
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Applications (贈り主応募)
// =============================================================================

egift.post('/api/egift/applications', async (c) => {
  try {
    const body = await c.req.json();
    const application = await createEgiftApplication(c.env.DB, {
      campaignId: body.campaignId,
      giverFriendId: body.giverFriendId,
      occasion: body.occasion ?? 'other',
      message: body.message,
      lotteryWeight: body.lotteryWeight,
    });
    return c.json({ success: true, data: application }, 201);
  } catch (e) {
    const msg = String(e);
    if (msg.includes('UNIQUE constraint failed')) {
      return c.json({ success: false, error: '既に応募済みです' }, 409);
    }
    return c.json({ success: false, error: msg }, 500);
  }
});

// =============================================================================
// Lottery
// =============================================================================

egift.post('/api/egift/campaigns/:id/lottery/dry-run', async (c) => {
  try {
    const campaignId = c.req.param('id');
    const date = new Date().toISOString().slice(0, 10);
    const candidates = await getLotteryCandidates(c.env.DB, campaignId, date);

    // weighted lottery simulation (same logic as commit, but no DB writes)
    const weighted: Array<{ id: string; giverFriendId: string; giverDisplayName: string | null; rank: string | null; weight: number }> = [];
    for (const c of candidates) {
      for (let i = 0; i < Math.round(c.lotteryWeight * 100); i++) {
        weighted.push({ id: c.applicationId, giverFriendId: c.giverFriendId, giverDisplayName: c.giverDisplayName, rank: c.rank, weight: c.lotteryWeight });
      }
    }

    // shuffle and pick unique winners
    for (let i = weighted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
    }

    const seen = new Set<string>();
    const winners: typeof weighted = [];
    const campaign = await getEgiftCampaignById(c.env.DB, campaignId);
    const limit = campaign?.daily_winner_limit ?? 10;
    for (const w of weighted) {
      if (seen.has(w.giverFriendId)) continue;
      seen.add(w.giverFriendId);
      winners.push(w);
      if (winners.length >= limit) break;
    }

    return c.json({
      success: true,
      data: {
        date,
        eligibleApplications: candidates.length,
        dailyWinnerLimit: limit,
        previewWinners: winners.map(w => ({
          applicationId: w.id,
          giverFriendId: w.giverFriendId,
          giverDisplayName: w.giverDisplayName,
          rank: w.rank,
          lotteryWeight: w.weight,
        })),
      },
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.post('/api/egift/campaigns/:id/lottery/commit', async (c) => {
  try {
    const campaignId = c.req.param('id');
    const date = new Date().toISOString().slice(0, 10);
    const candidates = await getLotteryCandidates(c.env.DB, campaignId, date);
    const campaign = await getEgiftCampaignById(c.env.DB, campaignId);
    if (!campaign) return c.json({ success: false, error: 'Campaign not found' }, 404);

    if (candidates.length === 0) {
      return c.json({ success: false, error: '抽選対象の応募者がいません' }, 400);
    }

    const limit = campaign.daily_winner_limit;

    // weighted lottery
    const weighted: Array<{ applicationId: string; giverFriendId: string; weight: number }> = [];
    for (const c of candidates) {
      for (let i = 0; i < Math.round(c.lotteryWeight * 100); i++) {
        weighted.push({ applicationId: c.applicationId, giverFriendId: c.giverFriendId, weight: c.lotteryWeight });
      }
    }

    for (let i = weighted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
    }

    const seen = new Set<string>();
    const winners: typeof weighted = [];
    for (const w of weighted) {
      if (seen.has(w.giverFriendId)) continue;
      seen.add(w.giverFriendId);
      winners.push(w);
      if (winners.length >= limit) break;
    }

    // Update applications + create gifts
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const redeemExpiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const created: Array<{ applicationId: string; giftToken: string }> = [];

    for (const w of winners) {
      // mark as won
      await c.env.DB.prepare(
        `UPDATE egift_applications SET status = 'won', decided_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), w.applicationId).run();

      const giftToken = crypto.randomUUID();
      await createEgiftGift(c.env.DB, {
        campaignId,
        applicationId: w.applicationId,
        giverFriendId: w.giverFriendId,
        giftToken,
        expiresAt,
        redeemExpiresAt,
      });
      created.push({ applicationId: w.applicationId, giftToken });
    }

    // mark losers
    await c.env.DB.prepare(
      `UPDATE egift_applications SET status = 'lost', decided_at = ? WHERE campaign_id = ? AND status = 'applied' AND DATE(applied_at) <= DATE(?)`,
    ).bind(new Date().toISOString(), campaignId, date).run();

    return c.json({
      success: true,
      data: {
        date,
        winnersCount: winners.length,
        gifts: created,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Applications list (admin)
// =============================================================================

egift.get('/api/egift/campaigns/:id/applications', async (c) => {
  try {
    const applications = await listApplicationsByCampaign(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: applications });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Gifts list (admin)
// =============================================================================

egift.get('/api/egift/campaigns/:id/gifts', async (c) => {
  try {
    const gifts = await listGiftsByCampaign(c.env.DB, c.req.param('id'));
    const serialized = gifts.map(g => ({
      ...g,
      giftUrl: g.gift_token ? `https://oryzae-line-crm.oryzae.workers.dev/g/${g.gift_token}` : null,
    }));
    return c.json({ success: true, data: serialized });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Products lookup (from Shopify)
// =============================================================================

interface ShopifyProductOption {
  sku: string;
  productTitle: string;
  variantTitle: string;
  price: string;
  stock: number;
}

egift.get('/api/egift/products', async (c) => {
  try {
    const domain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
    const token = c.env.SHOPIFY_ADMIN_TOKEN;

    if (!token) {
      return c.json({ success: false, error: 'Shopify API token not configured' }, 500);
    }

    const q = c.req.query('q') || '';
    const url = q
      ? `https://${domain}/admin/api/2024-01/products.json?status=active&limit=100&title=${encodeURIComponent(q)}`
      : `https://${domain}/admin/api/2024-01/products.json?status=active&limit=100`;

    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return c.json({ success: false, error: `Shopify API error: ${res.status}` }, 502);
    }

    const data = await res.json() as { products: any[] };
    const options: ShopifyProductOption[] = [];

    for (const p of data.products) {
      for (const v of p.variants) {
        if (!v.sku) continue;
        if (v.inventory_quantity < 5) continue; // skip out-of-stock
        options.push({
          sku: v.sku,
          productTitle: p.title,
          variantTitle: v.title,
          price: v.price,
          stock: v.inventory_quantity,
        });
      }
    }

    return c.json({ success: true, data: options });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Gift LP (public)
// =============================================================================

egift.get('/g/:token', async (c) => {
  try {
    const token = c.req.param('token');
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const gift = await getEgiftGiftByTokenHash(c.env.DB, tokenHash);
    if (!gift) {
      return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ギフトが見つかりません</title></head><body style="font-family:sans-serif;text-align:center;padding:40px 16px"><h2>😔</h2><p>このギフトリンクは無効です。</p></body></html>`, 404);
    }

    // check expiry
    if (gift.status === 'expired' || new Date(gift.expires_at) < new Date()) {
      return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>期限切れ</title></head><body style="font-family:sans-serif;text-align:center;padding:40px 16px"><h2>⏰</h2><p>ギフトの受け取り期限が過ぎています。</p></body></html>`, 410);
    }
    if (gift.status === 'redeemed' || gift.status === 'fulfilled') {
      return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>受取済み</title></head><body style="font-family:sans-serif;text-align:center;padding:40px 16px"><h2>✅</h2><p>このギフトは既に受け取り済みです。</p></body></html>`, 410);
    }

    // mark opened on first access
    if (gift.status === 'issued') {
      await markGiftOpened(c.env.DB, gift.id);
    }

    // Get giver info
    const giver = await c.env.DB.prepare(
      'SELECT display_name FROM friends WHERE id = ?',
    ).bind(gift.giver_friend_id).first<{ display_name: string | null }>();
    const giverName = giver?.display_name ?? 'お友達';

    // Return HTML gift LP
    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ORYZAE ギフト</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; background: #faf7f2; color: #3d3226; line-height: 1.7; }
  .container { max-width: 420px; margin: 0 auto; padding: 40px 20px; }
  .card { background: #fff; border-radius: 12px; padding: 32px 24px; box-shadow: 0 2px 12px rgba(0,0,0,.06); text-align: center; }
  .gift-icon { font-size: 48px; margin-bottom: 12px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .giver { font-size: 14px; color: #8a7a5c; margin-bottom: 24px; }
  .product-img { width: 120px; height: 120px; background: #f0ebe0; border-radius: 8px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 40px; }
  .message-box { background: #fdf8f0; border: 1px solid #e8dcc8; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 14px; color: #5c4a2e; }
  .features { text-align: left; margin-bottom: 24px; font-size: 14px; }
  .features li { margin-bottom: 8px; padding-left: 4px; }
  .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; }
  .btn-primary { background: #5c4a2e; color: #fff; }
  .btn-primary:hover { background: #4a3b24; }
  .btn-line { background: #06C755; color: #fff; margin-top: 12px; }
  .btn-line:hover { background: #05a748; }
  .note { font-size: 11px; color: #aaa; margin-top: 20px; }
  .form-group { margin-bottom: 16px; text-align: left; }
  .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #5c4a2e; }
  .form-group input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 15px; }
  #claim-section, #redeem-section, #done-section { display: none; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<div class="container">

  <!-- STEP 0: Friend Add Gate -->
  <div id="claim-section" class="card">
    <div class="gift-icon">🎁</div>
    <h1>${giverName}さんから<br>発酵習慣の贈り物が届いています</h1>
    <div class="product-img">🎁</div>
    <div class="features">
      <p style="font-size:14px;margin-bottom:12px;">人気の3フレーバーを<br>ちょっとずつ試せるギフトです。</p>
      <p style="font-size:13px;color:#8a7a5c;">受け取りには、配送のご連絡のため<br>ORYZAE公式LINEの友だち追加をお願いします。</p>
    </div>
    <a class="btn btn-line" href="https://lin.ee/xxxxxxxx" target="_blank" rel="noopener" id="line-add-btn">
      🎁 LINEでギフトを受け取る
    </a>
    <p class="note">※ 1リンクにつき1回限り<br>※ 7日以内のお受け取りをお願いします<br>※ 無料・送料込みです</p>
  </div>

  <!-- STEP 1: Redeem Form (shown after LINE add) -->
  <div id="redeem-section" class="card">
    <div class="gift-icon">📦</div>
    <h1>ご登録ありがとうございます</h1>
    <p style="font-size:14px;color:#8a7a5c;margin-bottom:24px;">ギフトのお届け先をご入力ください</p>
    <div class="form-group">
      <label>お名前</label>
      <input type="text" id="name" placeholder="山田 花子">
    </div>
    <div class="form-group">
      <label>郵便番号</label>
      <input type="text" id="zip" placeholder="1500001">
    </div>
    <div class="form-group">
      <label>ご住所</label>
      <input type="text" id="address" placeholder="東京都渋谷区...">
    </div>
    <div class="form-group">
      <label>電話番号</label>
      <input type="text" id="phone" placeholder="09012345678">
    </div>
    <div class="form-group">
      <label>メールアドレス</label>
      <input type="email" id="email" placeholder="example@mail.com">
    </div>
    <button class="btn btn-primary" id="redeem-btn">📦 受け取りを完了する</button>
  </div>

  <!-- STEP 2: Done -->
  <div id="done-section" class="card">
    <div class="gift-icon">✅</div>
    <h1>受け取り完了しました</h1>
    <p style="font-size:14px;color:#8a7a5c;margin-top:12px;">${giverName}さんからの贈り物、<br>まもなくお手元に届きます。</p>
    <p style="font-size:14px;margin-top:16px;">はじめての発酵習慣、<br>どうぞお楽しみに。</p>
    <a class="btn btn-primary" href="https://oryzae.shop" style="margin-top:24px;">ORYZAEの商品を見てみる</a>
  </div>

</div>

<script>
const TOKEN = ${JSON.stringify(token)};
const GIFT_ID = ${JSON.stringify(gift.id)};
const STATUS = ${JSON.stringify(gift.status)};

const claimSection = document.getElementById('claim-section');
const redeemSection = document.getElementById('redeem-section');
const doneSection = document.getElementById('done-section');

function show(section) {
  claimSection.classList.add('hidden');
  redeemSection.classList.add('hidden');
  doneSection.classList.add('hidden');
  section.classList.remove('hidden');
}

// If already line_added, show redeem form directly
if (STATUS === 'line_added') {
  show(redeemSection);
} else {
  show(claimSection);
}

// Handle LINE add callback (simplified for pilot — in production, use LIFF)
// For now, we provide a manual "I've added LINE" button flow
document.getElementById('line-add-btn').addEventListener('click', async function(e) {
  e.preventDefault();
  // In production, this would use LIFF to get the LINE user ID
  // For pilot, we show the redeem form after a brief delay
  // The actual LINE add claim happens via the /api/egift/gifts/claim endpoint
  show(redeemSection);
});

document.getElementById('redeem-btn').addEventListener('click', async function() {
  const btn = this;
  btn.disabled = true;
  btn.textContent = '処理中...';

  const name = document.getElementById('name').value.trim();
  const zip = document.getElementById('zip').value.trim();
  const address = document.getElementById('address').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const email = document.getElementById('email').value.trim();

  if (!name || !address) {
    alert('お名前とご住所は必須です');
    btn.disabled = false;
    btn.textContent = '📦 受け取りを完了する';
    return;
  }

  try {
    const res = await fetch('/api/egift/gifts/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TOKEN,
        name, zip, address, phone, email,
        prefecture: '', city: '',
        address1: address, address2: '',
      }),
    });
    const data = await res.json();
    if (data.success) {
      show(doneSection);
    } else {
      alert('エラー: ' + (data.error || '不明なエラー'));
      btn.disabled = false;
      btn.textContent = '📦 受け取りを完了する';
    }
  } catch (err) {
    alert('通信エラーが発生しました');
    btn.disabled = false;
    btn.textContent = '📦 受け取りを完了する';
  }
});
</script>
</body>
</html>`);
  } catch (e) {
    return c.html(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>エラー</title></head><body><h2>エラーが発生しました</h2><p>${String(e)}</p></body></html>`, 500);
  }
});

// =============================================================================
// LINE friend add claim
// =============================================================================

egift.post('/api/egift/gifts/claim', async (c) => {
  try {
    const body = await c.req.json();
    const token = body.token as string;
    const lineUserId = body.lineUserId as string;

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const gift = await getEgiftGiftByTokenHash(c.env.DB, tokenHash);
    if (!gift) return c.json({ success: false, error: 'Gift not found' }, 404);

    if (gift.status === 'redeemed' || gift.status === 'fulfilled') {
      return c.json({ success: false, error: 'このギフトは既に受け取り済みです' }, 410);
    }
    if (gift.status === 'expired' || new Date(gift.expires_at) < new Date()) {
      return c.json({ success: false, error: 'ギフトの有効期限が切れています' }, 410);
    }

    // Find or create friend by line_user_id
    let friend = await c.env.DB.prepare(
      'SELECT id FROM friends WHERE line_user_id = ?',
    ).bind(lineUserId).first<{ id: string }>();

    if (!friend) {
      // create friend record
      const friendId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO friends (id, line_user_id, is_following, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`,
      ).bind(friendId, lineUserId, new Date().toISOString(), new Date().toISOString()).run();
      friend = { id: friendId };
    }

    await markGiftLineAdded(c.env.DB, gift.id, friend.id);

    return c.json({
      success: true,
      data: {
        giftId: gift.id,
        recipientFriendId: friend.id,
        canRedeem: true,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// Redeem
// =============================================================================

egift.post('/api/egift/gifts/redeem', async (c) => {
  try {
    const body = await c.req.json();
    const token = body.token as string;

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const gift = await getEgiftGiftByTokenHash(c.env.DB, tokenHash);
    if (!gift) return c.json({ success: false, error: 'Gift not found' }, 404);

    if (gift.status === 'redeemed' || gift.status === 'fulfilled') {
      return c.json({ success: false, error: 'このギフトは既に受け取り済みです' }, 410);
    }
    if (gift.status === 'expired' || new Date(gift.redeem_expires_at) < new Date()) {
      return c.json({ success: false, error: 'ギフトの引換期限が切れています' }, 410);
    }
    if (gift.status !== 'line_added') {
      return c.json({ success: false, error: '先にLINE友だち追加が必要です' }, 400);
    }

    // TODO: Shopify 100%OFF coupon issuance goes here
    // For now, generate a placeholder coupon code
    const couponCode = `EGIFT-${gift.id.slice(0, 8).toUpperCase()}`;

    await redeemGift(c.env.DB, gift.id, {
      recipientFriendId: gift.recipient_friend_id!,
      email: body.email ?? '',
      phone: body.phone ?? '',
      name: body.name ?? '',
      zip: body.zip ?? '',
      address: [body.prefecture, body.city, body.address1, body.address2].filter(Boolean).join(' '),
      shopifyCouponCode: couponCode,
    });

    return c.json({
      success: true,
      data: {
        giftId: gift.id,
        couponCode,
        message: 'ギフトの受け取りが完了しました',
      },
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// =============================================================================
// KPI
// =============================================================================

egift.get('/api/egift/campaigns/:id/kpi', async (c) => {
  try {
    const kpi = await getEgiftCampaignKpi(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: kpi });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

export { egift };
