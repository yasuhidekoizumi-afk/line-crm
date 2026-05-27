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

  // PC: show QR code page
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE で友だち追加</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Hiragino Sans', system-ui, sans-serif; background: #0d1117; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 48px; text-align: center; max-width: 480px; width: 90%; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; }
    .sub { font-size: 14px; color: rgba(255,255,255,0.5); margin-bottom: 32px; }
    .qr { background: #fff; border-radius: 16px; padding: 24px; display: inline-block; margin-bottom: 24px; }
    .qr img { display: block; width: 240px; height: 240px; }
    .hint { font-size: 13px; color: rgba(255,255,255,0.4); line-height: 1.6; }
    .badge { display: inline-block; margin-top: 24px; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 600; color: #06C755; background: rgba(6,199,85,0.1); border: 1px solid rgba(6,199,85,0.2); }
  </style>
</head>
<body>
  <div class="card">
    <h1>全機能を使う（0円）</h1>
    <p class="sub">スマートフォンで QR コードを読み取ってください</p>
    <div class="qr">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrUrl)}" alt="QR Code">
    </div>
    <p class="hint">LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます</p>
    <div class="badge">LINE Harness OSS</div>
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
    if (cidParam) {
      try {
        await linkShopifyCustomerAndAwardBonus(c.env.DB, friend.id, cidParam);
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
 * Shopify顧客IDをLINE friendに紐付け＋LINE連携ボーナス（300pt・60日期限）を付与する。
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
): Promise<{ linked: boolean; bonusAwarded: number }> {
  const {
    getLoyaltyPoint,
    getLoyaltyPointByShopifyCustomerId,
    getLoyaltySetting,
    upsertLoyaltyPoint,
    addLoyaltyTransaction,
  } = await import('@line-crm/db');

  // 他の友だちが既にこのShopify顧客と紐付いていないかチェック
  const existing = await getLoyaltyPointByShopifyCustomerId(db, shopifyCustomerId);
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
      return { linked: false, bonusAwarded: 0 };
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
    return { linked: true, bonusAwarded: 0 };
  }

  const existingBonus = await db
    .prepare(`SELECT 1 FROM loyalty_transactions WHERE friend_id = ? AND reason = 'LINE連携ボーナス' LIMIT 1`)
    .bind(friendId)
    .first();
  if (existingBonus) {
    return { linked: true, bonusAwarded: 0 };
  }

  const beforeBonus = await getLoyaltyPoint(db, friendId);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 60);
  const newLimitedBalance = (beforeBonus?.limited_balance ?? 0) + bonusPoints;
  await upsertLoyaltyPoint(db, friendId, {
    balance: beforeBonus?.balance ?? 0,
    limitedBalance: newLimitedBalance,
    limitedExpiresAt: expiry.toISOString(),
    totalSpent: beforeBonus?.total_spent ?? 0,
    rank: beforeBonus?.rank ?? 'レギュラー',
    shopifyCustomerId,
  });
  await addLoyaltyTransaction(db, {
    friendId,
    type: 'award',
    points: bonusPoints,
    balanceAfter: (beforeBonus?.balance ?? 0) + newLimitedBalance,
    reason: 'LINE連携ボーナス',
  });

  return { linked: true, bonusAwarded: bonusPoints };
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

    // Shopify 顧客所有確認: Liquid 側で発行した HMAC を検証する。
    // LINK_SHOPIFY_SIGNING_SECRET が未設定 (= Liquid 連携前) なら 503。
    const signingSecret = (c.env as { LINK_SHOPIFY_SIGNING_SECRET?: string }).LINK_SHOPIFY_SIGNING_SECRET;
    if (!signingSecret) {
      return c.json({
        success: false,
        error: 'LINK_SHOPIFY_SIGNING_SECRET が未設定です。サーバ管理者にお問い合わせください。',
      }, 503);
    }
    if (!body.expires || !body.sig) {
      return c.json({
        success: false,
        error: 'expires と sig は必須です。Shopify 顧客アカウントページから開き直してください。',
      }, 400);
    }
    const sigOk = await verifyShopifyLinkSignature(signingSecret, body.shopifyCustomerId, body.expires, body.sig);
    if (!sigOk) {
      return c.json({
        success: false,
        error: '署名が無効または期限切れです。Shopify 顧客アカウントページから開き直してください。',
      }, 401);
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

    // /api/loyalty/link-shopify を内部経由で呼ぶ（管理者ルーターを経由するのが手間なので、同ロジックをここで直接実行）
    const shopifyCustomerId = String(body.shopifyCustomerId);
    const {
      getLoyaltyPoint,
      getLoyaltyPointByShopifyCustomerId,
      getLoyaltySetting,
      upsertLoyaltyPoint,
      addLoyaltyTransaction,
    } = await import('@line-crm/db');
    const { backfillPendingOrders } = await import('../services/loyalty-backfill.js');

    // 他の友だちが既にこのShopify顧客と紐付いていないかチェック
    const existing = await getLoyaltyPointByShopifyCustomerId(c.env.DB, shopifyCustomerId);
    if (existing && existing.friend_id !== friend.id) {
      // sp_ プレフィックスは Shopify webhook が先行で作成したプレースホルダー友だち。
      // 実 LINE 連携時は当該データを本 friend に合流させる。
      if (existing.friend_id.startsWith('sp_')) {
        const spFriendId = existing.friend_id;
        const realLoyalty = await getLoyaltyPoint(c.env.DB, friend.id);

        // トランザクションをすべて本 friend に付け替え
        await c.env.DB
          .prepare(`UPDATE loyalty_transactions SET friend_id = ? WHERE friend_id = ?`)
          .bind(friend.id, spFriendId)
          .run();

        if (realLoyalty) {
          // 両方に loyalty_points 行あり → 本 friend 側にマージして sp_ 側は削除
          const mergedBalance = (realLoyalty.balance ?? 0) + (existing.balance ?? 0);
          const mergedLimitedBalance = (realLoyalty.limited_balance ?? 0) + (existing.limited_balance ?? 0);
          const mergedTotalSpent = (realLoyalty.total_spent ?? 0) + (existing.total_spent ?? 0);
          const rankOrder = ['レギュラー', 'シルバー', 'ゴールド', 'プラチナ', 'ダイヤモンド'];
          const higherRank =
            rankOrder.indexOf(existing.rank ?? 'レギュラー') > rankOrder.indexOf(realLoyalty.rank ?? 'レギュラー')
              ? (existing.rank ?? 'レギュラー')
              : (realLoyalty.rank ?? 'レギュラー');
          // 期限はより早い方を採用（安全側）。片方 null の場合は他方を採用
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
          await upsertLoyaltyPoint(c.env.DB, friend.id, {
            balance: mergedBalance,
            limitedBalance: mergedLimitedBalance,
            limitedExpiresAt: mergedLimitedExpiresAt,
            totalSpent: mergedTotalSpent,
            rank: higherRank,
            shopifyCustomerId,
          });
          await c.env.DB
            .prepare(`DELETE FROM loyalty_points WHERE friend_id = ?`)
            .bind(spFriendId)
            .run();
        } else {
          // 本 friend 側に loyalty_points が無い → sp_ 行の friend_id を付け替え
          await c.env.DB
            .prepare(`UPDATE loyalty_points SET friend_id = ? WHERE friend_id = ?`)
            .bind(friend.id, spFriendId)
            .run();
        }

        // sp_ プレースホルダー friend を削除（残るCASCADE対象は webhook 由来で発生し得ないため安全）
        await c.env.DB
          .prepare(`DELETE FROM friends WHERE id = ?`)
          .bind(spFriendId)
          .run();

        console.log(`[link-shopify] Merged placeholder ${spFriendId} into ${friend.id}`);
      } else {
        return c.json({
          success: false,
          error: 'この Shopify 顧客は既に別のLINEアカウントに紐付いています',
        }, 409);
      }
    }

    // 紐付け
    const current = await getLoyaltyPoint(c.env.DB, friend.id);
    await upsertLoyaltyPoint(c.env.DB, friend.id, {
      balance: current?.balance ?? 0,
      totalSpent: current?.total_spent ?? 0,
      rank: current?.rank ?? 'レギュラー',
      shopifyCustomerId,
    });

    // LINE連携ボーナス（friend_id単位で1回のみ）
    const bonusEnabledSetting = await getLoyaltySetting(c.env.DB, 'link_bonus_enabled').catch(() => null);
    const bonusPointsSetting = await getLoyaltySetting(c.env.DB, 'link_bonus_points').catch(() => null);
    const bonusEnabled = (bonusEnabledSetting ?? '1') === '1';
    const bonusPoints = parseInt(bonusPointsSetting ?? '300', 10) || 300;

    let bonusAwarded = 0;
    if (bonusEnabled && bonusPoints > 0) {
      const existingBonus = await c.env.DB
        .prepare(`SELECT 1 FROM loyalty_transactions WHERE friend_id = ? AND reason = 'LINE連携ボーナス' LIMIT 1`)
        .bind(friend.id)
        .first();
      if (!existingBonus) {
        const beforeBonus = await getLoyaltyPoint(c.env.DB, friend.id);
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 60);
        const newLimitedBalance = (beforeBonus?.limited_balance ?? 0) + bonusPoints;
        await upsertLoyaltyPoint(c.env.DB, friend.id, {
          balance: beforeBonus?.balance ?? 0,
          limitedBalance: newLimitedBalance,
          limitedExpiresAt: expiry.toISOString(),
          totalSpent: beforeBonus?.total_spent ?? 0,
          rank: beforeBonus?.rank ?? 'レギュラー',
          shopifyCustomerId,
        });
        const totalAfter = (beforeBonus?.balance ?? 0) + newLimitedBalance;
        await addLoyaltyTransaction(c.env.DB, {
          friendId: friend.id,
          type: 'adjust',
          points: bonusPoints,
          balanceAfter: totalAfter,
          reason: 'LINE連携ボーナス',
        });
        bonusAwarded = bonusPoints;
      }
    }

    // プロモコードボーナス（link-shopify完了時に同時付与）
    let promoPointsAwarded = 0;
    if (body.promoCode) {
      const promoCodes: Record<string, { points: number; reason: string }> = {
        CARD88: { points: 88, reason: '同梱カードボーナス CARD88' },
      };
      const promo = promoCodes[body.promoCode.trim().toUpperCase()];
      if (promo) {
        const alreadyPromo = await c.env.DB
          .prepare(`SELECT id FROM loyalty_transactions WHERE friend_id = ? AND reason = ? LIMIT 1`)
          .bind(friend.id, promo.reason)
          .first();
        if (!alreadyPromo) {
          const afterBonus = await getLoyaltyPoint(c.env.DB, friend.id);
          const promoBalance = (afterBonus?.balance ?? 0) + promo.points;
          await upsertLoyaltyPoint(c.env.DB, friend.id, {
            balance: promoBalance,
            totalSpent: afterBonus?.total_spent ?? 0,
            rank: afterBonus?.rank ?? 'レギュラー',
            shopifyCustomerId,
          });
          await addLoyaltyTransaction(c.env.DB, {
            friendId: friend.id,
            type: 'adjust',
            points: promo.points,
            balanceAfter: promoBalance + (afterBonus?.limited_balance ?? 0),
            reason: promo.reason,
          });
          promoPointsAwarded = promo.points;
        }
      }
    }

    // 保留注文バックフィル
    const backfill = await backfillPendingOrders(c.env.DB, friend.id, shopifyCustomerId);

    // point-charge キャッチアップ sync (LINE 連携前にキャンペーン付与された期間限定ポイントを取り込む)
    const catchup = await catchupCampaignPointsFromPointCharge(c.env.DB, friend.id, shopifyCustomerId);

    // LINEプッシュ通知（連携完了＋ポイント付与、ノンブロッキング）
    try {
      const totalAwarded = bonusAwarded + promoPointsAwarded + backfill.totalPointsAwarded + catchup.awarded;
      if (totalAwarded > 0) {
        const { LineClient } = await import('@line-crm/line-sdk');
        const accountRow = await c.env.DB
          .prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 LIMIT 1')
          .first<{ channel_access_token: string }>();
        const accessToken = accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (accessToken && lineUserId) {
          const after = await getLoyaltyPoint(c.env.DB, friend.id);
          const lineClient = new LineClient(accessToken);
          const lines: string[] = ['🎉 ポイントを受け取りました！', ''];
          if (bonusAwarded > 0) lines.push(`連携ボーナス：+${bonusAwarded}pt`);
          if (promoPointsAwarded > 0) lines.push(`カードボーナス：+${promoPointsAwarded}pt`);
          if (catchup.awarded > 0) lines.push(`キャンペーンポイント：+${catchup.awarded}pt（期間限定）`);
          if (backfill.totalPointsAwarded > 0) lines.push(`過去購入ボーナス：+${backfill.totalPointsAwarded}pt`);
          lines.push('', `現在の残高：${after?.balance ?? 0}pt`, '', 'ポイントは次回のお買い物でご利用いただけます。');
          await lineClient.pushMessage(lineUserId, [{ type: 'text', text: lines.join('\n') }]);
        }
      }
    } catch (err) {
      console.error('link-shopify LINE notification error (non-blocking):', err);
    }

    return c.json({
      success: true,
      data: {
        bonusAwarded,
        promoPointsAwarded,
        catchupAwarded: catchup.awarded,
        backfilledOrders: backfill.processed,
        backfilledPoints: backfill.totalPointsAwarded,
      },
    });
  } catch (err) {
    console.error('POST /api/liff/link-shopify error:', err);
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

    // point-charge キャッチアップ sync (LINE 連携前に積まれた期間限定ポイントを取り込む)
    const catchup = loyaltyPoint.shopify_customer_id
      ? await catchupCampaignPointsFromPointCharge(c.env.DB, friend.id, loyaltyPoint.shopify_customer_id)
      : { awarded: 0, expiresAt: null };

    // LINEプッシュ通知（ノンブロッキング）
    try {
      const { LineClient } = await import('@line-crm/line-sdk');
      const accountRow = await c.env.DB
        .prepare('SELECT channel_access_token FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<{ channel_access_token: string }>();
      const accessToken = accountRow?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (accessToken) {
        const lineClient = new LineClient(accessToken);
        const lines = [
          '🎁 ポイントを受け取りました！',
          '',
          `${promo.reason.includes('CARD') ? 'カードボーナス' : 'ボーナス'}：+${promo.points}pt`,
        ];
        if (catchup.awarded > 0) {
          lines.push(`キャンペーンポイント：+${catchup.awarded}pt（期間限定）`);
        }
        lines.push(`現在の残高：${newBalance + catchup.awarded}pt`, '', 'ポイントは次回のお買い物でご利用いただけます。');
        await lineClient.pushMessage(body.lineUserId, [{ type: 'text', text: lines.join('\n') }]);
      }
    } catch (err) {
      console.error('promo-grant LINE notification error (non-blocking):', err);
    }

    return c.json({ success: true, data: { pointsAwarded: promo.points, catchupAwarded: catchup.awarded, newBalance: newBalance + catchup.awarded } });
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

// ─── point-charge catchup sync ─────────────────────────────────────
// point-charge Worker は LINE 連携前にメアド等で 8周年キャンペーンを
// 付与する経路があり、その場合 point_balances 側だけに limited_balance が
// 積まれて loyalty_points には sync されない (該当行が存在しないため)。
// LINE 連携直後にこの差分を取り込み、マイページに正しい残高を表示できるようにする。
async function catchupCampaignPointsFromPointCharge(
  db: D1Database,
  friendId: string,
  shopifyCustomerId: string,
): Promise<{ awarded: number; expiresAt: string | null }> {
  try {
    const pb = await db
      .prepare(
        `SELECT limited_balance, limited_expires_at
         FROM point_balances
         WHERE customer_id = ?`,
      )
      .bind(shopifyCustomerId)
      .first<{ limited_balance: number; limited_expires_at: string | null }>();
    if (!pb || (pb.limited_balance ?? 0) <= 0) {
      return { awarded: 0, expiresAt: null };
    }

    const lp = await db
      .prepare(
        `SELECT balance, limited_balance, limited_expires_at, total_spent, rank
         FROM loyalty_points
         WHERE friend_id = ?`,
      )
      .bind(friendId)
      .first<{
        balance: number;
        limited_balance: number;
        limited_expires_at: string | null;
        total_spent: number;
        rank: string;
      }>();

    const currentLpLimited = lp?.limited_balance ?? 0;
    const diff = (pb.limited_balance ?? 0) - currentLpLimited;
    if (diff <= 0) {
      return { awarded: 0, expiresAt: null };
    }

    // point-charge の期限 (UTC ISO) を JST に整形して使う
    const expiryDate = pb.limited_expires_at ? new Date(pb.limited_expires_at) : null;
    const jstExpiry = expiryDate
      ? new Date(expiryDate.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
      : null;

    // 期限が既存より早ければそれを優先 (安全側)
    let mergedExpiry: string | null = lp?.limited_expires_at ?? null;
    if (!mergedExpiry) {
      mergedExpiry = jstExpiry;
    } else if (jstExpiry && new Date(jstExpiry) < new Date(mergedExpiry)) {
      mergedExpiry = jstExpiry;
    }

    const newLimited = currentLpLimited + diff;
    await upsertLoyaltyPoint(db, friendId, {
      balance: lp?.balance ?? 0,
      limitedBalance: newLimited,
      limitedExpiresAt: mergedExpiry,
      totalSpent: lp?.total_spent ?? 0,
      rank: (lp?.rank as 'レギュラー' | 'シルバー' | 'ゴールド' | 'プラチナ') ?? 'レギュラー',
      shopifyCustomerId,
    });

    const totalAfter = (lp?.balance ?? 0) + newLimited;
    await addLoyaltyTransaction(db, {
      friendId,
      type: 'adjust',
      points: diff,
      balanceAfter: totalAfter,
      reason: `point-charge 連携時キャッチアップ: +${diff}pt（期間限定、期限 ${mergedExpiry ?? '未設定'}）`,
      orderId: `pc-catchup-${shopifyCustomerId}-${Date.now()}`,
    });

    return { awarded: diff, expiresAt: mergedExpiry };
  } catch (err) {
    console.error('catchupCampaignPointsFromPointCharge error (non-blocking):', err);
    return { awarded: 0, expiresAt: null };
  }
}

export { liffRoutes };
