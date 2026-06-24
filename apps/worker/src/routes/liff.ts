import { Hono } from 'hono';
import {
  getFriendByLineUserId,
  createUser,
  getUserByEmail,
  linkFriendToUser,
  upsertFriend,
  getEntryRouteByRefCode,
  recordRefTracking,
  addTagToFriend,
  getLineAccountByChannelId,
  getLineAccounts,
  jstNow,
  getLoyaltyPoint,
  upsertLoyaltyPoint,
  addLoyaltyTransaction,
  getLoyaltySetting,
} from '@line-crm/db';
import type { Env } from '../index.js';

const liffRoutes = new Hono<Env>();

// ─── LINE Login OAuth (bot_prompt=aggressive) ───────────────────

/**
 * GET /auth/line — redirect to LINE Login with bot_prompt=aggressive
 *
 * This is THE friend-add URL. Put this on LPs, SNS, ads.
 * Query params:
 *   ?ref=xxx     — attribution tracking
 *   ?redirect=url — redirect after completion
 *   ?gclid=xxx   — Google Ads click ID
 *   ?fbclid=xxx  — Meta Ads click ID
 *   ?utm_source=xxx, utm_medium, utm_campaign, utm_content, utm_term — UTM params
 */
liffRoutes.get('/auth/line', async (c) => {
  const ref = c.req.query('ref') || '';
  const redirect = c.req.query('redirect') || '';
  const gclid = c.req.query('gclid') || '';
  const fbclid = c.req.query('fbclid') || '';
  const twclid = c.req.query('twclid') || '';
  const ttclid = c.req.query('ttclid') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  const cidParam = c.req.query('cid') || ''; // Shopify customer ID for link-and-bonus on callback
  const accountParam = c.req.query('account') || '';
  const uidParam = c.req.query('uid') || ''; // existing user UUID for cross-account linking
  const baseUrl = new URL(c.req.url).origin;

  // Multi-account: resolve LINE Login channel + LIFF from DB if account param provided
  let channelId = c.env.LINE_LOGIN_CHANNEL_ID;
  let liffUrl = c.env.LIFF_URL;
  if (accountParam) {
    const account = await getLineAccountByChannelId(c.env.DB, accountParam);
    if (account?.login_channel_id) {
      channelId = account.login_channel_id;
    }
    if (account?.liff_id) {
      liffUrl = `https://liff.line.me/${account.liff_id}`;
    }
  }
  const callbackUrl = `${baseUrl}/auth/callback`;

  // xh: refs are X Harness one-time tokens — never forward to third-party URLs (liff.line.me / QR)
  // The token must reach /auth/callback, so it IS included in the OAuth state (handled by this worker).
  // It must NOT appear in LIFF URLs or QR codes that escape to external domains.
  const externalRef = ref.startsWith('xh:') ? '' : ref;

  // Build LIFF URL with ref + ad params (for mobile → LINE app)
  // Extract LIFF ID from URL and pass as query param so the app can init correctly
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set('liffId', liffIdMatch[1]);
  if (externalRef) liffParams.set('ref', externalRef);
  if (redirect) liffParams.set('redirect', redirect);
  if (gclid) liffParams.set('gclid', gclid);
  if (fbclid) liffParams.set('fbclid', fbclid);
  if (twclid) liffParams.set('twclid', twclid);
  if (ttclid) liffParams.set('ttclid', ttclid);
  if (utmSource) liffParams.set('utm_source', utmSource);
  const liffTarget = liffParams.toString()
    ? `${liffUrl}?${liffParams.toString()}`
    : liffUrl;

  // Build OAuth URL (for desktop fallback)
  // Pack all tracking params into state so they survive the OAuth redirect.
  // The full ref (including xh: tokens) is stored in state — it is opaque to access.line.me
  // and only decoded by this worker's /auth/callback handler.
  const state = JSON.stringify({ ref, redirect, gclid, fbclid, twclid, ttclid, utmSource, utmMedium, utmCampaign, account: accountParam, uid: uidParam, cid: cidParam });
  const encodedState = btoa(state);
  const loginUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  loginUrl.searchParams.set('response_type', 'code');
  loginUrl.searchParams.set('client_id', channelId);
  loginUrl.searchParams.set('redirect_uri', callbackUrl);
  loginUrl.searchParams.set('scope', 'profile openid email');
  loginUrl.searchParams.set('bot_prompt', 'aggressive');
  loginUrl.searchParams.set('state', encodedState);

  // Build LIFF URL with params (opens LINE app directly on mobile + QR on PC)
  // externalRef used — xh: tokens must not appear in QR codes or LIFF URLs
  const qrParams = new URLSearchParams();
  if (externalRef) qrParams.set('ref', externalRef);
  if (uidParam) qrParams.set('uid', uidParam);
  if (accountParam) qrParams.set('account', accountParam);
  const qrUrl = qrParams.toString() ? `${liffUrl}?${qrParams.toString()}` : liffUrl;

  // Mobile: redirect to LIFF URL (opens LINE app directly)
  // Exception: cross-account links (account param) use OAuth directly
  // because Account A's LIFF can't open from Account B's LINE chat
  const ua = (c.req.header('user-agent') || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  if (isMobile) {
    if (accountParam) {
      // Cross-account: use OAuth (LIFF won't work across accounts)
      return c.redirect(loginUrl.toString());
    }
    return c.redirect(qrUrl);
  }

  // PC: show QR code page（ORYZAEブランド版）
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINEで友だち追加＆連携 — フードコスメ ORYZAE</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Zen Kaku Gothic New', 'Hiragino Sans', system-ui, sans-serif; background: #f7f1e3; color: #6b4f23; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border: 1px solid #e8dcc0; border-radius: 20px; padding: 40px 32px; text-align: center; max-width: 480px; width: 100%; box-shadow: 0 4px 20px rgba(107,79,35,0.06); }
    .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.18em; color: #c98a2e; margin-bottom: 4px; }
    .brand-sub { font-size: 11px; color: #9c8456; margin-bottom: 28px; letter-spacing: 0.05em; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 8px; color: #6b4f23; line-height: 1.5; }
    .sub { font-size: 13px; color: #9c8456; margin-bottom: 28px; line-height: 1.6; }
    .qr { background: #fff; border: 1px solid #e8dcc0; border-radius: 16px; padding: 20px; display: inline-block; margin-bottom: 24px; }
    .qr img { display: block; width: 220px; height: 220px; }
    .perk { background: #fbf8f1; border: 1px solid #e8dcc0; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; font-size: 13px; color: #6b4f23; line-height: 1.7; }
    .perk strong { color: #06C755; font-weight: 700; }
    .hint { font-size: 12px; color: #9c8456; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">ORYZAE</div>
    <div class="brand-sub">フードコスメ オリゼ</div>
    <h1>LINEで友だち追加＆<br>アカウント連携</h1>
    <p class="sub">スマートフォンでQRコードを<br>読み取ってください</p>
    <div class="qr">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}" alt="LINE 友だち追加 QRコード">
    </div>
    <div class="perk">
      🎁 友だち追加＋連携で<br>
      <strong>送料無料クーポン</strong>プレゼント
    </div>
    <p class="hint">LINEアプリのカメラ、または<br>スマートフォンのカメラで読み取れます</p>
  </div>
</body>
</html>`);
});

/**
 * GET /auth/callback — LINE Login callback
 *
 * Exchanges code for tokens, extracts sub (UUID), links friend.
 */
liffRoutes.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state') || '';
  const error = c.req.query('error');

  // Parse state (contains ref, redirect, and ad click IDs)
  let ref = '';
  let redirect = '';
  let gclid = '';
  let fbclid = '';
  let twclid = '';
  let ttclid = '';
  let utmSource = '';
  let utmMedium = '';
  let utmCampaign = '';
  let accountParam = '';
  let uidParam = '';
  let cidParam = '';
  try {
    const parsed = JSON.parse(atob(stateParam));
    ref = parsed.ref || '';
    redirect = parsed.redirect || '';
    gclid = parsed.gclid || '';
    fbclid = parsed.fbclid || '';
    twclid = parsed.twclid || '';
    ttclid = parsed.ttclid || '';
    utmSource = parsed.utmSource || '';
    utmMedium = parsed.utmMedium || '';
    utmCampaign = parsed.utmCampaign || '';
    accountParam = parsed.account || '';
    uidParam = parsed.uid || '';
    cidParam = parsed.cid || '';
  } catch {
    // ignore
  }

  if (error || !code) {
    return c.html(errorPage(error || 'Authorization failed'));
  }

  try {
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/auth/callback`;

    // Multi-account: resolve LINE Login credentials from DB
    let loginChannelId = c.env.LINE_LOGIN_CHANNEL_ID;
    let loginChannelSecret = c.env.LINE_LOGIN_CHANNEL_SECRET;
    if (accountParam) {
      const account = await getLineAccountByChannelId(c.env.DB, accountParam);
      if (account?.login_channel_id && account?.login_channel_secret) {
        loginChannelId = account.login_channel_id;
        loginChannelSecret = account.login_channel_secret;
      }
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: loginChannelId,
        client_secret: loginChannelSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', errText);
      return c.html(errorPage('Token exchange failed'));
    }

    const tokens = await tokenRes.json<{
      access_token: string;
      id_token: string;
      token_type: string;
    }>();

    // Verify ID token to get sub (use resolved login channel ID, not env default)
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokens.id_token,
        client_id: loginChannelId,
      }),
    });

    if (!verifyRes.ok) {
      return c.html(errorPage('ID token verification failed'));
    }

    const verified = await verifyRes.json<{
      sub: string;
      name?: string;
      email?: string;
      picture?: string;
    }>();

    // Get profile via access token
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let displayName = verified.name || 'Unknown';
    let pictureUrl: string | null = null;
    if (profileRes.ok) {
      const profile = await profileRes.json<{
        userId: string;
        displayName: string;
        pictureUrl?: string;
      }>();
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl || null;
    }

    const db = c.env.DB;
    const lineUserId = verified.sub;

    // Upsert friend (may not exist yet if webhook hasn't fired)
    const friend = await upsertFriend(db, {
      lineUserId,
      displayName,
      pictureUrl,
      statusMessage: null,
    });

    // Create or find user → link
    let userId: string | null = null;

    // Check if already linked
    const existingUserId = (friend as unknown as Record<string, unknown>).user_id as string | null;
    if (existingUserId) {
      userId = existingUserId;
    } else {
      // Cross-account linking: if uid is provided, use that existing UUID
      if (uidParam) {
        userId = uidParam;
      }

      // Try to find by email
      if (!userId && verified.email) {
        const existingUser = await getUserByEmail(db, verified.email);
        if (existingUser) userId = existingUser.id;
      }

      // Create new user only if no existing UUID found
      if (!userId) {
        const newUser = await createUser(db, {
          email: verified.email || null,
          displayName,
        });
        userId = newUser.id;
      }

      // Link friend to user
      await linkFriendToUser(db, friend.id, userId);
    }

    // Attribution tracking
    // xh: refs are X Harness one-time tokens (the token IS the secret) — never persist as ref_code
    if (ref && !ref.startsWith('xh:')) {
      // Save ref_code on the friend record (first touch wins — only set if not already set)
      await db
        .prepare(`UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL`)
        .bind(ref, friend.id)
        .run();

      // Look up entry route config
      const route = await getEntryRouteByRefCode(db, ref);

      // Persist tracking event with ad click IDs
      await recordRefTracking(db, {
        refCode: ref,
        friendId: friend.id,
        entryRouteId: route?.id ?? null,
        sourceUrl: null,
        fbclid: fbclid || null,
        gclid: gclid || null,
        twclid: twclid || null,
        ttclid: ttclid || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        userAgent: c.req.header('User-Agent') || null,
        ipAddress: c.req.header('CF-Connecting-IP') || null,
      });

      if (route) {
        // Auto-tag the friend
        if (route.tag_id) {
          await addTagToFriend(db, friend.id, route.tag_id);
        }
        // Auto-enroll in scenario (scenario_id stored; enrollment handled by scenario engine)
        // Future: call enrollFriendInScenario(db, friend.id, route.scenario_id) here
      }
    }

    // Save ad click IDs + UTM to friend metadata (for future ad API postback)
    const adMeta: Record<string, string> = {};
    if (gclid) adMeta.gclid = gclid;
    if (fbclid) adMeta.fbclid = fbclid;
    if (twclid) adMeta.twclid = twclid;
    if (ttclid) adMeta.ttclid = ttclid;
    if (utmSource) adMeta.utm_source = utmSource;
    if (utmMedium) adMeta.utm_medium = utmMedium;
    if (utmCampaign) adMeta.utm_campaign = utmCampaign;

    if (Object.keys(adMeta).length > 0) {
      const existingMeta = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friend.id)
        .first<{ metadata: string }>();
      const merged = { ...JSON.parse(existingMeta?.metadata || '{}'), ...adMeta };
      await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), jstNow(), friend.id)
        .run();
    }

    // Shopify customer link + LINE連携ボーナス（cid 経由・/auth/line?cid=<shopify_customer_id>）
    // セキュリティ: 紐付け済みShopify顧客IDは上書きしない（friend_id単位で1回のみのボーナス）
    // 既にLINE連携済みのお客様に「すでに連携済みです」を必ず案内するためのフラグ（安全網）
    let linkAlreadyLinked = false;
    if (cidParam) {
      try {
        const linkResult = await linkShopifyCustomerAndAwardBonus(c.env.DB, friend.id, cidParam);
        linkAlreadyLinked = linkResult.alreadyLinked;
      } catch (err) {
        console.error('LINE連携ボーナス処理エラー (non-blocking):', err);
      }
    }

    // X Harness token resolution: ref starting with "xh:" links X account to LINE friend
    if (ref && ref.startsWith('xh:')) {
      try {
        const xhToken = ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          const existingMeta = await db
            .prepare('SELECT metadata FROM friends WHERE id = ?')
            .bind(friend.id)
            .first<{ metadata: string }>();
          const meta = JSON.parse(existingMeta?.metadata || '{}');
          meta.x_username = xhResult.xUsername;
          await db
            .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
            .bind(JSON.stringify(meta), jstNow(), friend.id)
            .run();
          console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
        }
        // Apply gate actions (tag + scenario) from X Harness
        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        console.error('X Harness token resolution error (non-blocking):', err);
      }
    }

    // Auto-enroll in friend_add scenarios + immediate delivery (skip delivery window)
    try {
      const { getScenarios, enrollFriendInScenario: enroll, getScenarioSteps } = await import('@line-crm/db');
      const { LineClient } = await import('@line-crm/line-sdk');
      const { buildMessage, expandVariables } = await import('../services/step-delivery.js');

      // Resolve which account this friend belongs to
      const matchedAccountId = accountParam
        ? (await getLineAccountByChannelId(db, accountParam))?.id ?? null
        : null;

      // Get access token for this account
      let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accountParam) {
        const acct = await getLineAccountByChannelId(db, accountParam);
        if (acct) accessToken = acct.channel_access_token;
      }
      const lineClient = new LineClient(accessToken);

      const scenarios = await getScenarios(db);
      for (const scenario of scenarios) {
        const scenarioAccountMatch = !scenario.line_account_id || !matchedAccountId || scenario.line_account_id === matchedAccountId;
        if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
          const existing = await db
            .prepare('SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?')
            .bind(friend.id, scenario.id)
            .first<{ id: string }>();
          if (!existing) {
            await enroll(db, friend.id, scenario.id);

            // Immediate delivery of first step (skip delivery window)
            const steps = await getScenarioSteps(db, scenario.id);
            const firstStep = steps[0];
            if (firstStep && firstStep.delay_minutes === 0) {
              const expandedContent = expandVariables(
                firstStep.message_content,
                friend as { id: string; display_name: string | null; user_id: string | null },
                c.env.WORKER_URL,
              );
              await lineClient.pushMessage(lineUserId, [buildMessage(firstStep.message_type, expandedContent)]);
            }
          }
        }
      }
    } catch (err) {
      console.error('OAuth scenario enrollment error:', err);
    }

    // Redirect or show completion
    if (redirect) {
      // 既連携の人には黙ってリダイレクトせず「すでに連携済みです」を必ず案内する（安全網）。
      // これで、どのボタン由来でも「連携したのに無反応」を防ぐ。
      if (linkAlreadyLinked) {
        return c.html(alreadyLinkedPage(redirect));
      }
      return c.redirect(redirect);
    }

    // Redirect to the correct bot's chat after auth
    // Find the LINE account by: account param, friend's account, or login channel ID
    let redirectAccount: Record<string, string> | null = null;
    if (accountParam) {
      redirectAccount = await getLineAccountByChannelId(db, accountParam) as Record<string, string> | null;
    }
    if (!redirectAccount) {
      // Find account by login_channel_id used in this OAuth flow
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE login_channel_id = ?')
        .bind(loginChannelId)
        .first<Record<string, string>>();
    }
    if (!redirectAccount) {
      // Fallback: first active account
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<Record<string, string>>();
    }
    if (redirectAccount?.channel_access_token) {
      try {
        const botInfo = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${redirectAccount.channel_access_token}` },
        });
        if (botInfo.ok) {
          const bot = await botInfo.json() as { basicId?: string };
          if (bot.basicId) {
            return c.redirect(`https://line.me/R/ti/p/${bot.basicId}`);
          }
        }
      } catch {
        // Fall through to completion page
      }
    }

    return c.html(completionPage(displayName, pictureUrl, ref));

  } catch (err) {
    console.error('Auth callback error:', err);
    return c.html(errorPage('Internal error'));
  }
});

// ─── Existing LIFF endpoints ────────────────────────────────────

// POST /api/liff/profile - get friend by LINE userId (public, no auth)
liffRoutes.post('/api/liff/profile', async (c) => {
  try {
    const body = await c.req.json<{ lineUserId: string }>();
    if (!body.lineUserId) {
      return c.json({ success: false, error: 'lineUserId is required' }, 400);
    }

    const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: friend.id,
        displayName: friend.display_name,
        isFollowing: Boolean(friend.is_following),
        userId: (friend as unknown as Record<string, unknown>).user_id ?? null,
      },
    });
  } catch (err) {
    console.error('POST /api/liff/profile error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/liff/link - link friend to user UUID (public, verified via LINE ID token)
liffRoutes.post('/api/liff/link', async (c) => {
  try {
    const body = await c.req.json<{
      idToken: string;
      displayName?: string | null;
      ref?: string;
      existingUuid?: string;
    }>();

    if (!body.idToken) {
      return c.json({ success: false, error: 'idToken is required' }, 400);
    }

    // Try verifying with default Login channel, then DB accounts
    const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
    const dbAccounts = await getLineAccounts(c.env.DB);
    for (const acct of dbAccounts) {
      if (acct.login_channel_id && !loginChannelIds.includes(acct.login_channel_id)) {
        loginChannelIds.push(acct.login_channel_id);
      }
    }

    let verifyRes: Response | null = null;
    for (const channelId of loginChannelIds) {
      verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: body.idToken, client_id: channelId }),
      });
      if (verifyRes.ok) break;
    }

    if (!verifyRes?.ok) {
      return c.json({ success: false, error: 'Invalid ID token' }, 401);
    }

    const verified = await verifyRes.json<{ sub: string; email?: string; name?: string }>();
    const lineUserId = verified.sub;
    const email = verified.email || null;

    const db = c.env.DB;
    const friend = await getFriendByLineUserId(db, lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    if ((friend as unknown as Record<string, unknown>).user_id) {
      // Still save ref even if already linked (but never persist xh: tokens as ref_code)
      if (body.ref && !body.ref.startsWith('xh:')) {
        await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
          .bind(body.ref, friend.id).run();
      }
      // X Harness token resolution for already-linked friends
      if (body.ref && body.ref.startsWith('xh:')) {
        try {
          const xhToken = body.ref.slice(3);
          const xhResult = await resolveXHarnessToken(xhToken, c.env);
          if (xhResult?.xUsername) {
            const existingMeta = await db
              .prepare('SELECT metadata FROM friends WHERE id = ?')
              .bind(friend.id)
              .first<{ metadata: string }>();
            const meta = JSON.parse(existingMeta?.metadata || '{}');
            meta.x_username = xhResult.xUsername;
            await db
              .prepare('UPDATE friends SET metadata = ? WHERE id = ?')
              .bind(JSON.stringify(meta), friend.id)
              .run();
            console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
          }
          if (xhResult) {
            await applyXHarnessActions(db, friend.id, xhResult);
          }
        } catch (err) {
          console.error('X Harness token resolution error (non-blocking):', err);
        }
      }
      return c.json({
        success: true,
        data: { userId: (friend as unknown as Record<string, unknown>).user_id, alreadyLinked: true },
      });
    }

    let userId: string | null = null;
    if (email) {
      const existingUser = await getUserByEmail(db, email);
      if (existingUser) userId = existingUser.id;
    }

    if (!userId) {
      const newUser = await createUser(db, {
        email,
        displayName: body.displayName || verified.name,
      });
      userId = newUser.id;
    }

    await linkFriendToUser(db, friend.id, userId);

    // Save ref_code from LIFF (first touch wins)
    // xh: refs are X Harness one-time tokens — never persist as ref_code
    if (body.ref && !body.ref.startsWith('xh:')) {
      await db.prepare('UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL')
        .bind(body.ref, friend.id).run();

      // Record ref tracking
      try {
        const route = await getEntryRouteByRefCode(db, body.ref);
        await recordRefTracking(db, {
          refCode: body.ref,
          friendId: friend.id,
          entryRouteId: route?.id ?? null,
          sourceUrl: null,
        });
      } catch { /* silent */ }
    }

    // X Harness token resolution: ref starting with "xh:" links X account to LINE friend
    if (body.ref && body.ref.startsWith('xh:')) {
      try {
        const xhToken = body.ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          const existingMeta = await db
            .prepare('SELECT metadata FROM friends WHERE id = ?')
            .bind(friend.id)
            .first<{ metadata: string }>();
          const meta = JSON.parse(existingMeta?.metadata || '{}');
          meta.x_username = xhResult.xUsername;
          await db
            .prepare('UPDATE friends SET metadata = ? WHERE id = ?')
            .bind(JSON.stringify(meta), friend.id)
            .run();
          console.log(`X Harness: linked @${xhResult.xUsername} to friend ${friend.id}`);
        }
        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        console.error('X Harness token resolution error (non-blocking):', err);
      }
    }

    return c.json({
      success: true,
      data: { userId, alreadyLinked: false },
    });
  } catch (err) {
    console.error('POST /api/liff/link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * Shopify顧客IDをLINE friendに紐付け＋LINE連携ボーナス（300pt・通常ポイント無期限）を付与する。
 *
 * 仕様:
 * - LINE連携は会社にとって継続的な接触チャネルを獲得する重要行動のため、
 *   お礼として通常ポイント（balance、無期限）で付与する。
 *   購買促進は別途キャンペーン/誕生月クーポン（期間限定）で担う。
 *
 * セキュリティ方針:
 * - 既に他のLINE friendに紐付け済みのShopify顧客IDは上書きしない（なりすまし防止）
 * - sp_ プレースホルダー（Webhook先行で作られた仮 friend）は合流させる
 * - ボーナスは friend_id 単位で1回のみ（loyalty_transactions WHERE reason='LINE連携ボーナス' で重複チェック）
 *
 * /auth/callback から呼び出される。エラーは呼び出し元で握りつぶす想定（連携体験を阻害しない）。
 */
async function linkShopifyCustomerAndAwardBonus(
  db: D1Database,
  friendId: string,
  shopifyCustomerId: string,
): Promise<{ linked: boolean; bonusAwarded: number; alreadyLinked: boolean }> {
  const {
    getLoyaltyPoint,
    getLoyaltyPointByShopifyCustomerId,
    getLoyaltySetting,
    upsertLoyaltyPoint,
    addLoyaltyTransaction,
  } = await import('@line-crm/db');

  // 他の友だちが既にこのShopify顧客と紐付いていないかチェック
  const existing = await getLoyaltyPointByShopifyCustomerId(db, shopifyCustomerId);
  // この friend に既にこの Shopify 顧客が紐付いていたか（=再連携か）を処理前に記録。
  // 「すでに連携済みです」を案内するための判定材料。
  const wasAlreadyLinkedToSelf = !!existing && existing.friend_id === friendId;
  if (existing && existing.friend_id !== friendId) {
    // sp_ プレフィックスは Shopify webhook が先行で作成したプレースホルダー友だち → 本 friend に合流
    if (existing.friend_id.startsWith('sp_')) {
      const spFriendId = existing.friend_id;
      const realLoyalty = await getLoyaltyPoint(db, friendId);

      // トランザクションを本 friend に付け替え
      await db
        .prepare(`UPDATE loyalty_transactions SET friend_id = ? WHERE friend_id = ?`)
        .bind(friendId, spFriendId)
        .run();

      if (realLoyalty) {
        const mergedBalance = (realLoyalty.balance ?? 0) + (existing.balance ?? 0);
        const mergedLimitedBalance = (realLoyalty.limited_balance ?? 0) + (existing.limited_balance ?? 0);
        const mergedTotalSpent = (realLoyalty.total_spent ?? 0) + (existing.total_spent ?? 0);
        const rankOrder = ['レギュラー', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド'];
        const higherRank =
          rankOrder.indexOf(existing.rank ?? 'レギュラー') > rankOrder.indexOf(realLoyalty.rank ?? 'レギュラー')
            ? (existing.rank ?? 'レギュラー')
            : (realLoyalty.rank ?? 'レギュラー');
        // 期限はより早い方を採用（安全側・期限切れまでの猶予を短くしない）
        // 片方が null の場合は他方を採用（限定残高に紐付く期限が必ず1つに収束する）
        let mergedLimitedExpiresAt: string | null = null;
        if (mergedLimitedBalance > 0) {
          const realExp = realLoyalty.limited_expires_at;
          const spExp = existing.limited_expires_at;
          if (realExp && spExp) {
            mergedLimitedExpiresAt = new Date(realExp) < new Date(spExp) ? realExp : spExp;
          } else {
            mergedLimitedExpiresAt = realExp ?? spExp ?? null;
          }
        }
        await upsertLoyaltyPoint(db, friendId, {
          balance: mergedBalance,
          limitedBalance: mergedLimitedBalance,
          limitedExpiresAt: mergedLimitedExpiresAt,
          totalSpent: mergedTotalSpent,
          rank: higherRank,
          shopifyCustomerId,
        });
        await db.prepare(`DELETE FROM loyalty_points WHERE friend_id = ?`).bind(spFriendId).run();
      } else {
        await db
          .prepare(`UPDATE loyalty_points SET friend_id = ? WHERE friend_id = ?`)
          .bind(friendId, spFriendId)
          .run();
      }
      await db.prepare(`DELETE FROM friends WHERE id = ?`).bind(spFriendId).run();
      console.log(`[auth/callback] Merged placeholder ${spFriendId} into ${friendId}`);
    } else {
      // 既に別の実 friend に紐付け済み → 紐付けスキップ・ボーナスも付与しない（なりすまし防止）
      console.log(`[auth/callback] Shopify customer ${shopifyCustomerId} already linked to ${existing.friend_id}, skipping`);
      return { linked: false, bonusAwarded: 0, alreadyLinked: true };
    }
  }

  // 紐付け
  const current = await getLoyaltyPoint(db, friendId);
  await upsertLoyaltyPoint(db, friendId, {
    balance: current?.balance ?? 0,
    totalSpent: current?.total_spent ?? 0,
    rank: current?.rank ?? 'レギュラー',
    shopifyCustomerId,
  });

  // LINE連携ボーナス（friend_id単位で1回のみ）
  const bonusEnabledSetting = await getLoyaltySetting(db, 'link_bonus_enabled').catch(() => null);
  const bonusPointsSetting = await getLoyaltySetting(db, 'link_bonus_points').catch(() => null);
  const bonusEnabled = (bonusEnabledSetting ?? '1') === '1';
  const bonusPoints = parseInt(bonusPointsSetting ?? '300', 10) || 300;

  if (!bonusEnabled || bonusPoints <= 0) {
    return { linked: true, bonusAwarded: 0, alreadyLinked: wasAlreadyLinkedToSelf };
  }

  const existingBonus = await db
    .prepare(`SELECT 1 FROM loyalty_transactions WHERE friend_id = ? AND reason = 'LINE連携ボーナス' LIMIT 1`)
    .bind(friendId)
    .first();
  if (existingBonus) {
    return { linked: true, bonusAwarded: 0, alreadyLinked: true };
  }

  const beforeBonus = await getLoyaltyPoint(db, friendId);
  // LINE連携ボーナスは通常ポイント（balance、無期限）として付与
  // limited_balance / limited_expires_at は触らない（PR #112 で未指定なら既存値保持）
  const newBalance = (beforeBonus?.balance ?? 0) + bonusPoints;
  await upsertLoyaltyPoint(db, friendId, {
    balance: newBalance,
    totalSpent: beforeBonus?.total_spent ?? 0,
    rank: beforeBonus?.rank ?? 'レギュラー',
    shopifyCustomerId,
  });
  await addLoyaltyTransaction(db, {
    friendId,
    type: 'award',
    points: bonusPoints,
    balanceAfter: newBalance + (beforeBonus?.limited_balance ?? 0),
    reason: 'LINE連携ボーナス',
    expiryDays: 0, // 通常ポイント (balance) として無期限付与のため
  });

  return { linked: true, bonusAwarded: bonusPoints, alreadyLinked: false };
}

/**
 * Shopify Liquid 側で発行された HMAC 署名を検証する。
 *
 * Liquid 側（顧客アカウントページ）で生成する文字列:
 *   message  = "<shopifyCustomerId>:<expires>"
 *   sig      = HMAC-SHA256(LINK_SHOPIFY_SIGNING_SECRET, message) を hex で
 *   LIFF URL = .../?page=link-shopify&shopifyCustomerId=...&expires=<UNIX秒>&sig=<hex>
 *
 * 顧客アカウントページは Shopify ログイン必須で、{{customer.id}} はその
 * ログイン中のお客様自身に紐付くため、この HMAC が検証できれば本人確認完了。
 */
async function verifyShopifyLinkSignature(
  secret: string,
  shopifyCustomerId: string,
  expires: string,
  sigHex: string,
): Promise<boolean> {
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum)) return false;
  // 5 分以内かつ未来日時でないこと
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresNum < nowSec) return false;
  if (expiresNum > nowSec + 60 * 30) return false; // 30 分以上未来は弾く（時計ずれ吸収）

  const message = `${shopifyCustomerId}:${expires}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (expected.length !== sigHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }
  return diff === 0;
}

// POST /api/liff/link-shopify — LIFFからLINEとShopify顧客を紐付け＋300ptボーナス付与
liffRoutes.post('/api/liff/link-shopify', async (c) => {
  try {
    // 緊急停止: メンテナンスや事故時に LINK_SHOPIFY_DISABLED=1 で 503 にできる。
    if (c.env.LINK_SHOPIFY_DISABLED === '1') {
      return c.json({
        success: false,
        error: 'LINEとShopifyの紐付け機能は現在メンテナンス中です。再開までしばらくお待ちください。',
      }, 503);
    }

    const body = await c.req.json<{
      accessToken?: string;
      idToken?: string;
      shopifyCustomerId: string;
      expires?: string;
      sig?: string;
      promoCode?: string;
    }>();
    if (!body.shopifyCustomerId) {
      return c.json({ success: false, error: 'shopifyCustomerId は必須です' }, 400);
    }
    if (!body.accessToken && !body.idToken) {
      return c.json({ success: false, error: 'accessToken または idToken は必須です' }, 400);
    }

    // Shopify 顧客所有確認: Liquid 側で発行した HMAC を「あれば検証」する。
    // - LINK_SHOPIFY_SIGNING_SECRET が未設定 → 検証スキップ（CRM Plus時代と同等の本人確認レベル）
    // - 設定済み かつ body.sig 付き → 厳密検証
    // - 設定済み だが body.sig 欠如 → 401（テーマ側で署名生成が動いていない可能性）
    //   ※ LIFF/Cloudflare認証 (accessToken) による LINE側本人確認は引き続き必須
    const signingSecret = (c.env as { LINK_SHOPIFY_SIGNING_SECRET?: string }).LINK_SHOPIFY_SIGNING_SECRET;
    if (signingSecret) {
      if (body.expires && body.sig) {
        const sigOk = await verifyShopifyLinkSignature(signingSecret, body.shopifyCustomerId, body.expires, body.sig);
        if (!sigOk) {
          return c.json({
            success: false,
            error: '署名が無効または期限切れです。Shopify 顧客アカウントページから開き直してください。',
          }, 401);
        }
      }
      // sig 欠如時は警告ログのみ。リクエスト自体は通す（本人確認は accessToken で担保）。
      else {
        console.log('[link-shopify] sig absent — proceeding without HMAC verification', { shopifyCustomerId: body.shopifyCustomerId });
      }
    } else {
      console.log('[link-shopify] LINK_SHOPIFY_SIGNING_SECRET not set — HMAC verification skipped');
    }

    // 許可チャネルID一覧（デフォルト + DB保存分）
    const loginChannelIds = [c.env.LINE_LOGIN_CHANNEL_ID];
    const dbAccounts = await getLineAccounts(c.env.DB);
    for (const acct of dbAccounts) {
      if (acct.login_channel_id && !loginChannelIds.includes(acct.login_channel_id)) {
        loginChannelIds.push(acct.login_channel_id);
      }
    }

    let lineUserId: string | null = null;

    // アクセストークン検証（LIFFチャネルに openid スコープが無くても動く）
    if (body.accessToken) {
      // 1) /oauth2/v2.1/verify でトークン発行元チャネルを検証
      const tokenInfoRes = await fetch(
        `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(body.accessToken)}`,
      );
      if (!tokenInfoRes.ok) {
        return c.json({ success: false, error: 'Invalid access token' }, 401);
      }
      const tokenInfo = await tokenInfoRes.json<{ client_id: string; expires_in: number }>();
      if (!loginChannelIds.includes(tokenInfo.client_id)) {
        return c.json({ success: false, error: 'Access token was issued for a different channel' }, 401);
      }
      if (tokenInfo.expires_in <= 0) {
        return c.json({ success: false, error: 'Access token expired' }, 401);
      }
      // 2) /v2/profile で userId 取得
      const profileRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${body.accessToken}` },
      });
      if (!profileRes.ok) {
        return c.json({ success: false, error: 'Failed to fetch LINE profile' }, 401);
      }
      const profile = await profileRes.json<{ userId: string }>();
      lineUserId = profile.userId;
    } else if (body.idToken) {
      // IDトークン検証（後方互換・openidスコープ付きチャネル用）
      let verifyRes: Response | null = null;
      for (const channelId of loginChannelIds) {
        verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ id_token: body.idToken, client_id: channelId }),
        });
        if (verifyRes.ok) break;
      }
      if (!verifyRes?.ok) {
        return c.json({ success: false, error: 'Invalid ID token' }, 401);
      }
      const verified = await verifyRes.json<{ sub: string }>();
      lineUserId = verified.sub;
    }

    if (!lineUserId) {
      return c.json({ success: false, error: 'Unable to verify LINE user' }, 401);
    }

    // LINE userID → friend_id
    const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found（まずLINE公式アカウントを友だち追加してください）' }, 404);
    }

    // 中核ロジック（なりすまし防止・sp_合流・連携・特典付与の二重防止・通知）は
    // 共有部品 linkShopifyAndReward() に集約。メール起点の連携と “1つの正解” を共有する。
    const { linkShopifyAndReward } = await import('../services/liff-link-core.js');
    const result = await linkShopifyAndReward(c.env, friend, String(body.shopifyCustomerId), {
      lineUserId,
      promoCode: body.promoCode,
    });
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, result.status);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    console.error('POST /api/liff/link-shopify error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── メール起点のLINE↔Shopify連携（LIFF一気通貫 Phase 1）───────────────
//   Shopifyログイン不要。LINE本人確認済みユーザーがメール1つ＋6桁コードで連携。
//   実体は services/email-link.ts。連携の中核は共有部品 linkShopifyAndReward()。
//   既定OFF（loyalty_settings.email_link_enabled=0）・本番ONは小泉さんOK後。

// POST /api/liff/email-link/request-code — メール→Shopify顧客特定→6桁コードをメール送信
liffRoutes.post('/api/liff/email-link/request-code', async (c) => {
  try {
    const body = await c.req.json<{ accessToken?: string; idToken?: string; email?: string }>();
    const { verifyLineUserFromToken, requestEmailLinkCode } = await import('../services/email-link.js');
    const auth = await verifyLineUserFromToken(c.env, body);
    if (!auth.ok) return c.json({ success: false, error: auth.error }, auth.status);
    const r = await requestEmailLinkCode(c.env, auth.lineUserId, body.email ?? '');
    return c.json(r.body, r.status);
  } catch (err) {
    console.error('POST /api/liff/email-link/request-code error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/liff/email-link/verify-code — 6桁コード照合→共有部品で連携＋特典
liffRoutes.post('/api/liff/email-link/verify-code', async (c) => {
  try {
    const body = await c.req.json<{ accessToken?: string; idToken?: string; email?: string; code?: string }>();
    const { verifyLineUserFromToken, verifyEmailLinkCode } = await import('../services/email-link.js');
    const auth = await verifyLineUserFromToken(c.env, body);
    if (!auth.ok) return c.json({ success: false, error: auth.error }, auth.status);
    const r = await verifyEmailLinkCode(c.env, auth.lineUserId, body.email ?? '', body.code ?? '');
    return c.json(r.body, r.status);
  } catch (err) {
    console.error('POST /api/liff/email-link/verify-code error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/liff/promo-grant — プロモコードによるポイント付与（紐付け済みユーザー向け）
liffRoutes.post('/api/liff/promo-grant', async (c) => {
  try {
    const body = await c.req.json<{ lineUserId: string; promoCode: string }>();
    if (!body.lineUserId || !body.promoCode) {
      return c.json({ success: false, error: 'lineUserId と promoCode は必須です' }, 400);
    }

    const code = body.promoCode.trim().toUpperCase();
    const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
    if (!friend) {
      return c.json({ success: false, error: 'LINEアカウントが見つかりません' }, 404);
    }

    // Shopify紐付け確認
    const loyaltyPoint = await getLoyaltyPoint(c.env.DB, friend.id);
    if (!loyaltyPoint?.shopify_customer_id) {
      return c.json({ success: false, error: 'not_linked', message: 'Shopify連携が完了していません' }, 400);
    }

    // プロモコード設定を取得（コード・ポイント数）
    const promoCodes: Record<string, { points: number; reason: string }> = {
      CARD88: { points: 88, reason: '同梱カードボーナス CARD88' },
    };
    const promo = promoCodes[code];
    if (!promo) {
      return c.json({ success: false, error: 'invalid_code', message: '無効なプロモコードです' }, 400);
    }

    // 重複チェック（1人1回）
    const already = await c.env.DB
      .prepare(`SELECT id FROM loyalty_transactions WHERE friend_id = ? AND reason = ? LIMIT 1`)
      .bind(friend.id, promo.reason)
      .first();
    if (already) {
      return c.json({ success: false, error: 'already_used', message: 'このコードは既に使用済みです' }, 400);
    }

    // ポイント付与
    const expiryDaysSetting = await getLoyaltySetting(c.env.DB, 'expiry_days').catch(() => null);
    const expiryDays = parseInt(expiryDaysSetting ?? '365', 10) || 365;
    const expiresAt = new Date(Date.now() + expiryDays * 86400000).toISOString().slice(0, 10);

    const newBalance = (loyaltyPoint.balance ?? 0) + promo.points;
    await upsertLoyaltyPoint(c.env.DB, friend.id, {
      balance: newBalance,
      totalSpent: loyaltyPoint.total_spent ?? 0,
      rank: loyaltyPoint.rank ?? 'レギュラー',
      shopifyCustomerId: loyaltyPoint.shopify_customer_id,
    });
    await addLoyaltyTransaction(c.env.DB, {
      friendId: friend.id,
      type: 'adjust',
      points: promo.points,
      balanceAfter: newBalance + (loyaltyPoint.limited_balance ?? 0),
      reason: promo.reason,
      expiresAt,
    });

    // LINEプッシュ通知（ノンブロッキング）
    try {
      const { LineClient } = await import('@line-crm/line-sdk');
      const accountRow = await c.env.DB
        .prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<{ channel_access_token: string }>();
      const accessToken = accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accessToken) {
        const lineClient = new LineClient(accessToken);
        await lineClient.pushMessage(body.lineUserId, [{
          type: 'text',
          text: `🎁 ポイントを受け取りました！\n\n${promo.reason.includes('CARD') ? 'カードボーナス' : 'ボーナス'}：+${promo.points}pt\n現在の残高：${newBalance}pt\n\nポイントは次回のお買い物でご利用いただけます。`,
        }]);
      }
    } catch (err) {
      console.error('promo-grant LINE notification error (non-blocking):', err);
    }

    return c.json({ success: true, data: { pointsAwarded: promo.points, newBalance } });
  } catch (err) {
    console.error('POST /api/liff/promo-grant error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── Attribution Analytics ──────────────────────────────────────

/**
 * GET /api/analytics/ref-summary — ref code analytics summary
 */
liffRoutes.get('/api/analytics/ref-summary', async (c) => {
  try {
    const db = c.env.DB;
    const lineAccountId = c.req.query('lineAccountId');
    const accountFilter = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const accountBinds = lineAccountId ? [lineAccountId] : [];

    const rows = await db
      .prepare(
        `SELECT
          er.ref_code,
          er.name,
          COUNT(DISTINCT rt.friend_id) as friend_count,
          COUNT(rt.id) as click_count,
          MAX(rt.created_at) as latest_at
        FROM entry_routes er
        LEFT JOIN ref_tracking rt ON er.ref_code = rt.ref_code
        LEFT JOIN friends f ON f.id = rt.friend_id ${accountFilter ? `${accountFilter}` : ''}
        GROUP BY er.ref_code, er.name
        ORDER BY friend_count DESC`,
      )
      .bind(...accountBinds)
      .all<{
        ref_code: string;
        name: string;
        friend_count: number;
        click_count: number;
        latest_at: string | null;
      }>();

    const totalStmt = lineAccountId
      ? db.prepare(`SELECT COUNT(*) as count FROM friends WHERE line_account_id = ?`).bind(lineAccountId)
      : db.prepare(`SELECT COUNT(*) as count FROM friends`);
    const totalFriendsRes = await totalStmt.first<{ count: number }>();

    const refStmt = lineAccountId
      ? db.prepare(`SELECT COUNT(*) as count FROM friends WHERE ref_code IS NOT NULL AND ref_code != '' AND line_account_id = ?`).bind(lineAccountId)
      : db.prepare(`SELECT COUNT(*) as count FROM friends WHERE ref_code IS NOT NULL AND ref_code != ''`);
    const friendsWithRefRes = await refStmt.first<{ count: number }>();

    const totalFriends = totalFriendsRes?.count ?? 0;
    const friendsWithRef = friendsWithRefRes?.count ?? 0;

    return c.json({
      success: true,
      data: {
        routes: (rows.results ?? []).map((r) => ({
          refCode: r.ref_code,
          name: r.name,
          friendCount: r.friend_count,
          clickCount: r.click_count,
          latestAt: r.latest_at,
        })),
        totalFriends,
        friendsWithRef,
        friendsWithoutRef: totalFriends - friendsWithRef,
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/ref-summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/analytics/ref/:refCode — detailed friend list for a single ref code
 */
liffRoutes.get('/api/analytics/ref/:refCode', async (c) => {
  try {
    const db = c.env.DB;
    const refCode = c.req.param('refCode');

    const routeRow = await db
      .prepare(`SELECT ref_code, name FROM entry_routes WHERE ref_code = ?`)
      .bind(refCode)
      .first<{ ref_code: string; name: string }>();

    if (!routeRow) {
      return c.json({ success: false, error: 'Entry route not found' }, 404);
    }

    const lineAccountId = c.req.query('lineAccountId');
    const accountFilter = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const binds = lineAccountId ? [refCode, refCode, lineAccountId] : [refCode, refCode];

    const friends = await db
      .prepare(
        `SELECT
          f.id,
          f.display_name,
          f.ref_code,
          rt.created_at as tracked_at
        FROM friends f
        LEFT JOIN ref_tracking rt ON f.id = rt.friend_id AND rt.ref_code = ?
        WHERE f.ref_code = ? ${accountFilter}
        ORDER BY rt.created_at DESC`,
      )
      .bind(...binds)
      .all<{
        id: string;
        display_name: string;
        ref_code: string | null;
        tracked_at: string | null;
      }>();

    return c.json({
      success: true,
      data: {
        refCode: routeRow.ref_code,
        name: routeRow.name,
        friends: (friends.results ?? []).map((f) => ({
          id: f.id,
          displayName: f.display_name,
          trackedAt: f.tracked_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/analytics/ref/:refCode error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/links/wrap - wrap a URL with LIFF redirect proxy
liffRoutes.post('/api/links/wrap', async (c) => {
  try {
    const body = await c.req.json<{ url: string; ref?: string }>();
    if (!body.url) {
      return c.json({ success: false, error: 'url is required' }, 400);
    }

    const liffUrl = c.env.LIFF_URL;
    if (!liffUrl) {
      return c.json({ success: false, error: 'LIFF_URL not configured' }, 500);
    }

    const params = new URLSearchParams({ redirect: body.url });
    if (body.ref) {
      params.set('ref', body.ref);
    }

    const wrappedUrl = `${liffUrl}?${params.toString()}`;
    return c.json({ success: true, data: { url: wrappedUrl } });
  } catch (err) {
    console.error('POST /api/links/wrap error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ─── HTML Templates ─────────────────────────────────────────────

function authLandingPage(liffUrl: string, oauthUrl: string): string {
  // Extract LIFF ID from URL like https://liff.line.me/{LIFF_ID}?ref=test
  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([^?]+)/);
  const liffId = liffIdMatch ? liffIdMatch[1] : '';
  // Query string part (e.g., ?ref=test)
  const qsIndex = liffUrl.indexOf('?');
  const liffQs = qsIndex >= 0 ? liffUrl.slice(qsIndex) : '';

  // line:// scheme to force open LINE app with LIFF
  const lineSchemeUrl = `https://line.me/R/app/${liffId}${liffQs}`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE で開く</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #06C755; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); text-align: center; max-width: 400px; width: 90%; }
    .line-icon { font-size: 48px; margin-bottom: 16px; }
    h2 { font-size: 20px; color: #333; margin-bottom: 8px; }
    .sub { font-size: 14px; color: #999; margin-bottom: 24px; }
    .btn { display: block; width: 100%; padding: 16px; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; text-decoration: none; text-align: center; cursor: pointer; transition: opacity 0.15s; font-family: inherit; }
    .btn:active { opacity: 0.85; }
    .btn-line { background: #06C755; color: #fff; margin-bottom: 12px; }
    .btn-web { background: #f5f5f5; color: #666; font-size: 13px; padding: 12px; }
    .loading { margin-top: 16px; font-size: 13px; color: #999; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div class="line-icon">💬</div>
    <h2>LINEで開く</h2>
    <p class="sub">LINEアプリが起動します</p>
    <a href="${escapeHtml(lineSchemeUrl)}" class="btn btn-line" id="openBtn">LINEアプリで開く</a>
    <a href="${escapeHtml(oauthUrl)}" class="btn btn-web" id="pcBtn">PCの方・LINEが開かない方</a>
    <p class="loading hidden" id="loading">LINEアプリを起動中...</p>
  </div>
  <script>
    var lineUrl = '${escapeHtml(lineSchemeUrl)}';
    var ua = navigator.userAgent.toLowerCase();
    var isMobile = /iphone|ipad|android/.test(ua);
    var isLine = /line\\//.test(ua);
    var isIOS = /iphone|ipad/.test(ua);
    var isAndroid = /android/.test(ua);

    if (isLine) {
      // Already in LINE — go to LIFF directly
      window.location.href = '${escapeHtml(liffUrl)}';
    } else if (isMobile) {
      // Mobile browser — try to open LINE app
      document.getElementById('loading').classList.remove('hidden');
      document.getElementById('openBtn').classList.add('hidden');

      // Use line.me/R/app/ which is a Universal Link (iOS) / App Link (Android)
      // This opens LINE app directly without showing browser login
      setTimeout(function() {
        window.location.href = lineUrl;
      }, 100);

      // Fallback: if LINE app doesn't open within 2s, show the button
      setTimeout(function() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('openBtn').classList.remove('hidden');
        document.getElementById('openBtn').textContent = 'もう一度試す';
      }, 2500);
    }
  </script>
</body>
</html>`;
}

function completionPage(displayName: string, pictureUrl: string | null, ref: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登録完了</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    h2 { font-size: 20px; color: #06C755; margin-bottom: 16px; }
    .profile { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 16px 0; }
    .profile img { width: 48px; height: 48px; border-radius: 50%; }
    .profile .name { font-size: 16px; font-weight: 600; }
    .message { font-size: 14px; color: #666; line-height: 1.6; margin-top: 12px; }
    .ref { display: inline-block; margin-top: 12px; padding: 4px 12px; background: #f0f0f0; border-radius: 12px; font-size: 11px; color: #999; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h2>登録完了！</h2>
    <div class="profile">
      ${pictureUrl ? `<img src="${pictureUrl}" alt="">` : ''}
      <p class="name">${escapeHtml(displayName)} さん</p>
    </div>
    <p class="message">ありがとうございます！<br>これからお役立ち情報をお届けします。<br>このページは閉じて大丈夫です。</p>
    ${ref ? `<p class="ref">${escapeHtml(ref)}</p>` : ''}
  </div>
</body>
</html>`;
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>エラー</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    h2 { font-size: 18px; color: #e53e3e; margin-bottom: 12px; }
    p { font-size: 14px; color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <h2>エラー</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

// 既にLINE連携済みのお客様向けの案内ページ。
// /auth/line 経由でリダイレクトする際、黙って戻さず「すでに連携済みです」を必ず表示する安全網。
function alreadyLinkedPage(continueUrl: string): string {
  const safeUrl = escapeHtml(continueUrl);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>すでに連携済みです</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 90%; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #06C755; color: #fff; font-size: 32px; line-height: 64px; margin: 0 auto 16px; }
    h2 { font-size: 20px; color: #06C755; margin-bottom: 12px; }
    .message { font-size: 14px; color: #666; line-height: 1.7; margin-bottom: 24px; }
    .btn { display: inline-block; padding: 14px 32px; background: #06C755; color: #fff; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h2>すでにLINE連携済みです</h2>
    <p class="message">お客様のアカウントは、すでにLINE連携がお済みです。<br>連携特典は過去にお受け取り済みのため、特典の再付与はありません。</p>
    <a class="btn" href="${safeUrl}">ページに戻る</a>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── X Harness Token Resolution ─────────────────────────────────

/**
 * Apply X Harness gate actions (tag + scenario) to a LINE friend.
 * Non-blocking — failures are logged but don't interrupt the flow.
 */
async function applyXHarnessActions(
  db: D1Database,
  friendId: string,
  result: XHarnessTokenResult,
): Promise<void> {
  // Add tag if specified
  if (result.tag) {
    try {
      // Find or create the tag by name
      let tagRow = await db
        .prepare('SELECT id FROM tags WHERE name = ?')
        .bind(result.tag)
        .first<{ id: string }>();
      if (!tagRow) {
        const tagId = crypto.randomUUID();
        const { jstNow } = await import('@line-crm/db');
        tagRow = await db
          .prepare('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) RETURNING id')
          .bind(tagId, result.tag, jstNow())
          .first<{ id: string }>();
      }
      if (tagRow) {
        const { addTagToFriend } = await import('@line-crm/db');
        await addTagToFriend(db, friendId, tagRow.id);
        console.log(`X Harness: added tag "${result.tag}" to friend ${friendId}`);
      }
    } catch (err) {
      console.error(`X Harness: failed to add tag "${result.tag}":`, err);
    }
  }

  // Start scenario if specified
  if (result.scenarioId) {
    try {
      const { enrollFriendInScenario } = await import('@line-crm/db');
      await enrollFriendInScenario(db, friendId, result.scenarioId);
      console.log(`X Harness: enrolled friend ${friendId} in scenario ${result.scenarioId}`);
    } catch (err) {
      console.error(`X Harness: failed to enroll in scenario:`, err);
    }
  }
}

interface XHarnessTokenResult {
  xUsername: string | null;
  tag: string | null;
  scenarioId: string | null;
}

/**
 * Resolve an X Harness token to get the linked X username + gate config (tag, scenario).
 * The token IS the secret — no Bearer auth needed on the resolve endpoint.
 */
async function resolveXHarnessToken(
  token: string,
  env: { X_HARNESS_URL?: string },
): Promise<XHarnessTokenResult | null> {
  if (!env.X_HARNESS_URL) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout — must not block login flow
    try {
      const res = await fetch(`${env.X_HARNESS_URL}/api/tokens/${token}/resolve`, {
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const body = await res.json() as { success: boolean; data?: XHarnessTokenResult };
      if (!body.success || !body.data) return null;
      return { xUsername: body.data.xUsername, tag: body.data.tag ?? null, scenarioId: body.data.scenarioId ?? null };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return null;
  }
}

export { liffRoutes };
