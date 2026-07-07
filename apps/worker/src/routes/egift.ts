import { Hono } from 'hono';
import {
  createEgiftCampaign,
  getEgiftCampaignById,
  listEgiftCampaigns,
  activateEgiftCampaign,
  deleteEgiftCampaign,
  pauseEgiftCampaign,
  completeEgiftCampaign,
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
import { getShopifyAdminToken } from '../utils/shopify-token.js';
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

egift.post('/api/egift/campaigns/:id/pause', async (c) => {
  try {
    await pauseEgiftCampaign(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

egift.post('/api/egift/campaigns/:id/complete', async (c) => {
  try {
    await completeEgiftCampaign(c.env.DB, c.req.param('id'));
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
    let giverFriendId = body.giverFriendId as string | undefined;

    // Resolve lineUserId → friendId if needed
    if (!giverFriendId && body.lineUserId) {
      const friend = await c.env.DB.prepare(
        'SELECT id FROM friends WHERE line_user_id = ?',
      ).bind(body.lineUserId).first<{ id: string }>();
      if (!friend) {
        // Create friend record if not exists
        const newId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO friends (id, line_user_id, is_following, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
        ).bind(newId, body.lineUserId, new Date().toISOString(), new Date().toISOString()).run();
        giverFriendId = newId;
      } else {
        giverFriendId = friend.id;
      }
    }

    if (!giverFriendId) {
      return c.json({ success: false, error: 'giverFriendId or lineUserId is required' }, 400);
    }

    const application = await createEgiftApplication(c.env.DB, {
      campaignId: body.campaignId,
      giverFriendId,
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
    const body = await c.req.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().slice(0, 10);
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
    const body = await c.req.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().slice(0, 10);
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
      `UPDATE egift_applications SET status = 'lost', decided_at = ? WHERE campaign_id = ? AND status = 'applied'`,
    ).bind(new Date().toISOString(), campaignId).run();

    // Send LINE push to winners (fire-and-forget) with gift URLs
    if (c.env.LINE_CHANNEL_ACCESS_TOKEN) {
      for (const w of created) {
        const friend = await c.env.DB.prepare(
          'SELECT line_user_id FROM friends WHERE id = ?',
        ).bind(w.applicationId).first<{ line_user_id: string | null }>();
        if (friend?.line_user_id?.startsWith('U')) {
          const giftUrl = `https://oryzae-line-crm.oryzae.workers.dev/g/${w.giftToken}`;
          fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${c.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
              to: friend.line_user_id,
              messages: [{
                type: 'text',
                text: `🎁 eGift当選おめでとうございます！\n\nこちらのリンクを贈りたい方にシェアしてください。\n\n${giftUrl}\n\n※有効期限7日間・1回限り`,
              }],
            }),
          }).catch(() => {});
        }
      }
    }

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
    const token = await getShopifyAdminToken({
      SHOPIFY_SHOP_DOMAIN: c.env.SHOPIFY_SHOP_DOMAIN,
      SHOPIFY_CLIENT_ID: c.env.SHOPIFY_CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: c.env.SHOPIFY_CLIENT_SECRET,
      SHOPIFY_ADMIN_TOKEN: c.env.SHOPIFY_ADMIN_TOKEN,
    });

    if (token) {
      try {
        const domain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
        const url = `https://${domain}/admin/api/2024-01/products.json?status=active&limit=250`;
        const res = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
          },
        });

        if (res.ok) {
          const data = await res.json() as { products: any[] };
          const options: ShopifyProductOption[] = [];

          for (const p of data.products) {
            for (const v of p.variants) {
              if (!v.sku) continue;
              if (v.inventory_quantity < 5) continue;
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
        }
      } catch {
        // fall through to static list
      }
    }

    // Static fallback: curated gift-relevant products (from Shopify, 2026-07)
    const staticProducts: ShopifyProductOption[] = [
      { sku: 'set3-pla-cho-ban-40-box-select', productTitle: '【ギフト】米麹ミニグラノーラ 選べる3種セット', variantTitle: '人気3種ギフトボックス', price: '1000', stock: 257 },
      { sku: 'set3-pla-cho-ban-200', productTitle: '人気3種セット（プレーン/チョコ/バナナココナッツ）', variantTitle: 'Default Title', price: '3240', stock: 573 },
      { sku: 'set3-dri-ear-see-200', productTitle: 'おすすめ3種セット（ドライフルーツ/アールグレイ/シード）', variantTitle: 'Default Title', price: '3240', stock: 1328 },
      { sku: 'S-W941YV6Z', productTitle: '選べるギフトBOX -S-', variantTitle: 'SALT | 塩麹 / PLAIN | プレーン', price: '3730', stock: 182 },
      { sku: 'S-4UHVQH43', productTitle: '選べるギフトBOX -S-', variantTitle: 'SALT | 塩麹 / CHOCO | チョコ', price: '3730', stock: 184 },
      { sku: 'S-CMN4UMIY', productTitle: 'プロテイン入り3種セット', variantTitle: 'Default Title', price: '3280', stock: 1422 },
    ];
    return c.json({ success: true, data: staticProducts });
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

    // Get LIFF URL for LINE friend-add redirect
    const liffUrlBase = c.env.LIFF_URL || 'https://liff.line.me/';
    const claimUrl = `${liffUrlBase}?page=egift&egift_token=${encodeURIComponent(token)}`;

    // Get giver info
    const giver = await c.env.DB.prepare(
      'SELECT display_name FROM friends WHERE id = ?',
    ).bind(gift.giver_friend_id).first<{ display_name: string | null }>();
    const giverName = giver?.display_name ?? 'お友達';

    // Get giver message from application
    const app = await c.env.DB.prepare(
      'SELECT message, occasion FROM egift_applications WHERE id = ?',
    ).bind(gift.application_id).first<{ message: string | null; occasion: string | null }>();
    const giverMessage = app?.message || null;

    // Get campaign product info
    let productImage = '';
    let productName = '米麹ミニグラノーラ 選べる3種セット';
    if (gift.campaign_id) {
      const camp = await getEgiftCampaignById(c.env.DB, gift.campaign_id);
      if (camp?.target_product_id) {
        // Try Shopify for product image
        const pid = camp.target_product_id.replace('gid://shopify/Product/', '');
        try {
          const token = await getShopifyAdminToken({
            SHOPIFY_SHOP_DOMAIN: c.env.SHOPIFY_SHOP_DOMAIN,
            SHOPIFY_CLIENT_ID: c.env.SHOPIFY_CLIENT_ID,
            SHOPIFY_CLIENT_SECRET: c.env.SHOPIFY_CLIENT_SECRET,
            SHOPIFY_ADMIN_TOKEN: c.env.SHOPIFY_ADMIN_TOKEN,
          });
          if (token) {
            const domain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
            const pRes = await fetch(`https://${domain}/admin/api/2024-01/products/${pid}.json`, {
              headers: { 'X-Shopify-Access-Token': token },
            });
            if (pRes.ok) {
              const pData = await pRes.json() as { product: { title: string; image?: { src: string } } };
              productName = pData.product.title;
              productImage = pData.product.image?.src || '';
            }
          }
        } catch {}
      }
    }

    const escapedGiverName = giverName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const escapedProductName = productName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const escapedMessage = giverMessage ? giverMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$') : '';
    const imageUrl = productImage || 'https://cdn.shopify.com/s/files/1/0504/3280/2975/files/L2A7391_1_6c516997-b0a2-4ef9-9abd-9cdfb12f0478.jpg';

    // Return HTML gift LP
    return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#5c4a2e">
<title>${escapedGiverName}さんからの贈り物 | ORYZAE</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans","Helvetica Neue",sans-serif; background: #faf7f2; color: #3d3226; line-height: 1.7; -webkit-font-smoothing: antialiased; }
  .container { max-width: 440px; margin: 0 auto; padding: 0 0 60px; }
  .hero { background: linear-gradient(135deg, #5c4a2e 0%, #8a6d3b 100%); color: #fff; padding: 32px 20px 24px; text-align: center; }
  .hero-icon { font-size: 32px; margin-bottom: 8px; }
  .hero h1 { font-size: 18px; font-weight: 700; line-height: 1.5; }
  .hero .giver { font-size: 13px; opacity: 0.85; margin-top: 4px; }
  .steps { display: flex; justify-content: center; padding: 16px; gap: 8px; background: #fff; border-bottom: 1px solid #eee; }
  .step { flex: 0 0 auto; text-align: center; font-size: 11px; color: #ccc; }
  .step.active { color: #5c4a2e; font-weight: 700; }
  .step.done { color: #5c4a2e; }
  .step .dot { width: 28px; height: 28px; border-radius: 50%; background: #eee; margin: 0 auto 4px; display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .step.active .dot { background: #5c4a2e; color: #fff; }
  .step.done .dot { background: #4caf50; color: #fff; }
  .card { background: #fff; margin: 16px; border-radius: 12px; padding: 28px 24px; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
  .product-img { width: 100%; max-width: 280px; aspect-ratio: 1; object-fit: cover; border-radius: 8px; margin: 0 auto 16px; display: block; background: #f0ebe0; }
  .product-name { font-size: 15px; font-weight: 700; text-align: center; margin-bottom: 8px; }
  .product-desc { font-size: 13px; color: #8a7a5c; text-align: center; margin-bottom: 20px; }
  .message-box { background: #fdf8f0; border: 1px solid #e8dcc8; border-radius: 8px; padding: 16px; margin-bottom: 20px; font-size: 14px; color: #5c4a2e; text-align: center; position: relative; }
  .message-box::before { content: "💌"; font-size: 20px; display: block; margin-bottom: 8px; }
  .message-box .msg-text { font-style: italic; }
  .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; text-align: center; transition: opacity .2s; }
  .btn:active { opacity: .8; }
  .btn-primary { background: #5c4a2e; color: #fff; }
  .btn-line { background: #06C755; color: #fff; }
  .btn-white { background: #fff; color: #5c4a2e; border: 2px solid #5c4a2e; }
  .note { font-size: 11px; color: #999; margin-top: 16px; text-align: center; }
  .form-group { margin-bottom: 14px; text-align: left; }
  .form-group label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: #5c4a2e; }
  .form-group input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 15px; background: #fafaf7; }
  .form-group input:focus { outline: none; border-color: #5c4a2e; box-shadow: 0 0 0 2px rgba(92,74,46,.1); }
  #redeem-section, #done-section { display: none; }
  .hidden { display: none !important; }
  .footer { text-align: center; padding: 24px 16px; font-size: 11px; color: #bbb; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%; border-top-color: transparent; animation: spin .6s linear infinite; margin-right: 8px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="container">

<div class="hero">
  <div class="hero-icon">🎁</div>
  <h1>${escapedGiverName}さんから<br>発酵習慣の贈り物が届いています</h1>
</div>

<div class="steps">
  <div class="step active" id="step1"><div class="dot">1</div>受け取る</div>
  <div style="color:#ddd;padding-top:12px;">→</div>
  <div class="step" id="step2"><div class="dot">2</div>お届け先入力</div>
  <div style="color:#ddd;padding-top:12px;">→</div>
  <div class="step" id="step3"><div class="dot">3</div>完了</div>
</div>

<!-- STEP 1: Claim -->
<div id="claim-section" class="card">
  <img class="product-img" src="${imageUrl}" alt="${escapedProductName}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" loading="lazy">
  <div style="display:none;width:100%;max-width:280px;aspect-ratio:1;margin:0 auto 16px;background:#f0ebe0;border-radius:8px;display:none;align-items:center;justify-content:center;font-size:48px">🎁</div>
  <div class="product-name">${escapedProductName}</div>
  <div class="product-desc">人気の3フレーバーをちょっとずつ試せるギフトです。<br>無料・送料込みでお届けします。</div>
  ${escapedMessage ? '<div class="message-box"><div class="msg-text">' + escapedMessage + '</div></div>' : ''}
  <a class="btn btn-line" href="${claimUrl}" id="line-add-btn">
    🎁 LINEでギフトを受け取る
  </a>
  <p class="note">※ LINE公式アカウントの友だち追加が必要です<br>※ 1リンクにつき1回限り・7日間有効</p>
</div>

<!-- STEP 2: Redeem -->
<div id="redeem-section" class="card">
  <h2 style="font-size:18px;margin-bottom:6px;">📦 お届け先のご登録</h2>
  <p style="font-size:13px;color:#8a7a5c;margin-bottom:20px;">ギフトのお届け先をご入力ください</p>
  <div class="form-group">
    <label>お名前 <span style="color:#e74c3c">*</span></label>
    <input type="text" id="name" placeholder="山田 花子" autocomplete="name">
  </div>
  <div class="form-group">
    <label>郵便番号</label>
    <input type="text" id="zip" placeholder="150-0001" autocomplete="postal-code">
  </div>
  <div class="form-group">
    <label>ご住所 <span style="color:#e74c3c">*</span></label>
    <input type="text" id="address" placeholder="東京都渋谷区..." autocomplete="street-address">
  </div>
  <div class="form-group">
    <label>電話番号</label>
    <input type="tel" id="phone" placeholder="090-1234-5678" autocomplete="tel">
  </div>
  <div class="form-group">
    <label>メールアドレス</label>
    <input type="email" id="email" placeholder="example@mail.com" autocomplete="email">
  </div>
  <button class="btn btn-primary" id="redeem-btn">
    <span id="redeem-btn-text">📦 受け取りを完了する</span>
  </button>
  <p class="note">ご入力いただいた情報は商品発送のみに使用します</p>
</div>

<!-- STEP 3: Done -->
<div id="done-section" class="card">
  <div style="font-size:56px;margin-bottom:12px;">✅</div>
  <h2 style="font-size:20px;margin-bottom:8px;">受け取り完了しました</h2>
  <p style="font-size:14px;color:#8a7a5c;margin-bottom:24px;">${escapedGiverName}さんからの贈り物、<br>まもなくお手元に届きます。</p>
  <div style="background:#fdf8f0;border-radius:8px;padding:16px;margin-bottom:20px;text-align:left;font-size:13px;">
    <p style="font-weight:700;color:#5c4a2e;margin-bottom:8px;">🎯 次はあなたも贈り主に</p>
    <p style="color:#8a7a5c;line-height:1.6;">気に入ったら、今度はあなたが誰かに贈ってみませんか？<br>ORYZAE公式LINEでお得な情報をお届けしています。</p>
  </div>
  <a class="btn btn-white" href="https://oryzae.shop" style="margin-bottom:8px;">ORYZAEの商品を見てみる</a>
  <a class="btn btn-line" href="https://lin.ee/ORYZAE" style="font-size:14px;padding:12px;">🧑‍🍳 ORYZAE公式LINEを友だち追加</a>
</div>

<div class="footer">ORYZAE Inc. — 地球を発酵させる</div>

</div>

<script>
const TOKEN = ${JSON.stringify(token)};
const STATUS = ${JSON.stringify(gift.status)};
const BASE = location.origin;
const urlParams = new URLSearchParams(location.search);
const returnStatus = urlParams.get('status');

const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const claimSection = document.getElementById('claim-section');
const redeemSection = document.getElementById('redeem-section');
const doneSection = document.getElementById('done-section');

function setStep(n) {
  [step1, step2, step3].forEach((s, i) => {
    s.className = 'step' + (i + 1 === n ? ' active' : i + 1 < n ? ' done' : '');
  });
}

function show(el) {
  claimSection.style.display = 'none';
  redeemSection.style.display = 'none';
  doneSection.style.display = 'none';
  el.style.display = '';
}

if (STATUS === 'line_added' || returnStatus === 'line_added') {
  setStep(2);
  show(redeemSection);
} else {
  setStep(1);
  show(claimSection);
}

document.getElementById('line-add-btn').addEventListener('click', function() {
  // LIFF handles the actual LINE verification and calls claim API
  // The LIFF app will redirect back with ?status=line_added on success
});

document.getElementById('redeem-btn').addEventListener('click', async function() {
  const btn = this;
  const btnText = document.getElementById('redeem-btn-text');
  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span>処理中...';

  const name = document.getElementById('name').value.trim();
  const address = document.getElementById('address').value.trim();

  if (!name || !address) {
    alert('お名前とご住所は必須です');
    btn.disabled = false;
    btnText.textContent = '📦 受け取りを完了する';
    return;
  }

  try {
    const res = await fetch(BASE + '/api/egift/gifts/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: TOKEN, name,
        zip: document.getElementById('zip').value.trim(),
        address,
        phone: document.getElementById('phone').value.trim(),
        email: document.getElementById('email').value.trim(),
        prefecture: '', city: '', address1: address, address2: '',
      }),
    });
    const data = await res.json();
    if (data.success) {
      setStep(3);
      show(doneSection);
    } else {
      alert('エラー: ' + (data.error || '不明なエラー'));
      btn.disabled = false;
      btnText.textContent = '📦 受け取りを完了する';
    }
  } catch (err) {
    alert('通信エラーが発生しました。時間をおいてお試しください。');
    btn.disabled = false;
    btnText.textContent = '📦 受け取りを完了する';
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

    // Create Shopify 100% OFF discount code
    const domain = c.env.SHOPIFY_SHOP_DOMAIN || 'yasuhide-koizumi.myshopify.com';
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    let couponCode = `EGIFT-${gift.id.slice(0, 8).toUpperCase()}`;

    if (adminToken) {
      try {
        // Get campaign to find target product
        const campaign = gift.campaign_id
          ? await getEgiftCampaignById(c.env.DB, gift.campaign_id)
          : null;

        // Create price rule: 100% OFF, single use, valid for 14 days
        const priceRuleBody: any = {
          price_rule: {
            title: `eGift 100%OFF ${couponCode}`,
            target_type: 'line_item',
            target_selection: 'all',
            allocation_method: 'across',
            value_type: 'percentage',
            value: '-100.0',
            customer_selection: 'all',
            once_per_customer: false,
            usage_limit: 1,
            starts_at: new Date().toISOString(),
            ends_at: gift.redeem_expires_at,
          },
        };

        // If campaign has target product, restrict to that product
        if (campaign?.target_product_id) {
          priceRuleBody.price_rule.target_selection = 'entitled';
          priceRuleBody.price_rule.entitled_product_ids = [campaign.target_product_id];
          priceRuleBody.price_rule.entitled_variant_ids = campaign.target_variant_id ? [campaign.target_variant_id] : undefined;
        }

        const ruleRes = await fetch(`https://${domain}/admin/api/2024-10/price_rules.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
          body: JSON.stringify(priceRuleBody),
        });

        if (ruleRes.ok) {
          const ruleData = await ruleRes.json() as { price_rule: { id: number } };
          const priceRuleId = ruleData.price_rule.id;

          // Create discount code under the price rule
          const codeRes = await fetch(
            `https://${domain}/admin/api/2024-10/price_rules/${priceRuleId}/discount_codes.json`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': adminToken },
              body: JSON.stringify({ discount_code: { code: couponCode } }),
            },
          );

          if (codeRes.ok) {
            console.log(`[egift] Shopify coupon created: ${couponCode} (price_rule ${priceRuleId})`);
          } else {
            console.error(`[egift] Shopify discount_code create failed: ${await codeRes.text()}`);
            couponCode = `EGIFT-${gift.id.slice(0, 8).toUpperCase()}`; // fallback
          }
        } else {
          console.error(`[egift] Shopify price_rule create failed: ${await ruleRes.text()}`);
        }
      } catch (err) {
        console.error(`[egift] Shopify coupon creation error:`, err);
      }
    }

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
