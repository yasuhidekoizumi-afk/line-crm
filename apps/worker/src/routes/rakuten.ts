/**
 * 楽天 RMS WEB SERVICE 管理 API
 *
 * エンドポイント:
 *   GET  /api/cs/rakuten/status              - 認証状態（残日数・status）取得
 *   POST /api/cs/rakuten/verify               - 既存credentialsで疎通確認
 *   POST /api/cs/rakuten/check-expiry         - 期限チェックcron手動実行（管理用）
 *
 * 注: serviceSecret / licenseKey 自体は wrangler secret で管理。
 * issued_at / expires_at だけ DB に保存して残日数表示用に使う。
 *
 * 設計書: docs/CS_RAKUTEN_RMS_DESIGN.md
 */
import { Hono } from 'hono';
import { RmsClient, RmsLicenseExpiredError } from '@line-crm/rakuten-sdk';
import {
  getRakutenCredential,
  upsertRakutenCredential,
  markRakutenVerified,
  markRakutenExpired,
  logRakutenApiCall,
} from '@line-crm/db';
import {
  checkRakutenLicenseExpiry,
  notifyRakutenLicenseExpiredNow,
} from '../services/rakuten-license-monitor.js';
import type { Env } from '../index.js';

export const rakuten = new Hono<Env>();

/** 認証状態取得（UI用） */
rakuten.get('/api/cs/rakuten/status', async (c) => {
  try {
    const cred = await getRakutenCredential(c.env.DB);
    if (!cred) {
      return c.json({
        success: true,
        data: {
          configured: false,
          hasSecrets:
            !!c.env.RAKUTEN_SERVICE_SECRET && !!c.env.RAKUTEN_LICENSE_KEY,
        },
      });
    }

    const expiresMs = new Date(cred.expires_at).getTime();
    const daysLeft = Math.ceil((expiresMs - Date.now()) / 86_400_000);

    return c.json({
      success: true,
      data: {
        configured: true,
        hasSecrets:
          !!c.env.RAKUTEN_SERVICE_SECRET && !!c.env.RAKUTEN_LICENSE_KEY,
        issuedAt: cred.issued_at,
        expiresAt: cred.expires_at,
        daysLeft,
        status: cred.status,
        pausedPolling: !!cred.pause_polling,
        lastVerifiedAt: cred.last_verified_at,
        lastError: cred.last_error,
      },
    });
  } catch (e) {
    console.error('GET /api/cs/rakuten/status error:', e);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 疎通確認: counts.get を実行して 200 なら verified、401 なら expired にマーク。
 * 新キー登録後にUI から呼び出す想定。
 */
rakuten.post('/api/cs/rakuten/verify', async (c) => {
  try {
    if (!c.env.RAKUTEN_SERVICE_SECRET || !c.env.RAKUTEN_LICENSE_KEY) {
      return c.json(
        {
          success: false,
          error:
            'wrangler secret put RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY を実行してください',
        },
        400,
      );
    }

    // 任意で issued_at をリクエストボディから受け取り、未指定なら今日扱い
    const body = await c.req.json<{ issuedAt?: string }>().catch(() => ({} as { issuedAt?: string }));
    const issuedAt = body && 'issuedAt' in body && body.issuedAt
      ? new Date(body.issuedAt).toISOString()
      : new Date().toISOString();
    const expiresAt = new Date(
      new Date(issuedAt).getTime() + 90 * 86_400_000,
    ).toISOString();

    const client = new RmsClient({
      serviceSecret: c.env.RAKUTEN_SERVICE_SECRET,
      licenseKey: c.env.RAKUTEN_LICENSE_KEY,
      onCall: async (info) => {
        await logRakutenApiCall(c.env.DB, {
          endpoint: info.endpoint,
          status: info.status,
          duration_ms: info.durationMs,
          error_message: info.error,
        }).catch(() => {});
      },
    });

    try {
      const counts = await client.getCounts();
      // 認証OK → DB 更新
      await upsertRakutenCredential(c.env.DB, {
        issued_at: issuedAt,
        expires_at: expiresAt,
        status: 'active',
      });
      await markRakutenVerified(c.env.DB);

      return c.json({
        success: true,
        data: {
          verified: true,
          counts,
          issuedAt,
          expiresAt,
        },
      });
    } catch (e) {
      if (e instanceof RmsLicenseExpiredError) {
        await markRakutenExpired(c.env.DB, String(e));
        await notifyRakutenLicenseExpiredNow(c.env, String(e));
        return c.json(
          { success: false, error: 'licenseKey が失効・無効です。RMS で再発行してください。' },
          401,
        );
      }
      throw e;
    }
  } catch (e) {
    console.error('POST /api/cs/rakuten/verify error:', e);
    return c.json(
      { success: false, error: `疎通失敗: ${String(e).slice(0, 300)}` },
      500,
    );
  }
});

/** 期限チェック手動実行（運用デバッグ用） */
rakuten.post('/api/cs/rakuten/check-expiry', async (c) => {
  try {
    const result = await checkRakutenLicenseExpiry(c.env);
    return c.json({ success: true, data: result });
  } catch (e) {
    console.error('POST /api/cs/rakuten/check-expiry error:', e);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
