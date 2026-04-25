/**
 * FERMENT Phase 4: 高度機能完成
 *
 * - AI 件名提案 / 本文生成
 * - 収益貢献分析
 * - スパムスコア事前チェック
 * - SMS キャンペーン作成 API
 * - コホート / ファネル分析
 */

import { Hono } from 'hono';
import { generateSubjectVariants, generatePersonalizedBody } from '@line-crm/ai-sdk';
import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

// ─── AI ヘルパー API ──────────────────────────────

export const aiRoutes = new Hono<FermentEnv>();

aiRoutes.post('/subject-suggestions', async (c) => {
  const body = await c.req.json<{ base_subject: string; body_preview?: string; count?: number }>();
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);
  try {
    const variants = await generateSubjectVariants(apiKey, body.base_subject, body.body_preview ?? '', body.count ?? 5);
    return c.json({ success: true, data: { variants } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: msg }, 500);
  }
});

aiRoutes.post('/body-suggestion', async (c) => {
  const body = await c.req.json<{
    purpose: string;
    tone?: string;
    length?: 'short' | 'medium' | 'long';
  }>();
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const systemPrompt = `あなたはオリゼ（ORYZAE Inc.、米麹発酵フードテック）のマーケティング担当です。
以下の目的のメール本文を HTML で書いてください。
- トーン: ${body.tone ?? '丁寧で親しみやすい'}
- 長さ: ${body.length ?? 'medium'} (short=200字, medium=400字, long=800字)
- {{name}} で顧客名を差し込む
- 配信停止リンクは {{unsubscribe_url}} で
- インラインスタイル使用（gmail対応）
- ブランドカラー: #225533

出力は HTML のみ（説明不要）。`;

  try {
    const result = await generatePersonalizedBody(apiKey, {
      template: { subject_base: body.purpose, body_html: '', ai_system_prompt: systemPrompt } as Parameters<typeof generatePersonalizedBody>[1]['template'],
      customer: { display_name: '{{name}}', region: 'JP', language: 'ja' } as Parameters<typeof generatePersonalizedBody>[1]['customer'],
    });
    return c.json({ success: true, data: { body_html: result.body_html } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── スパムスコア事前チェック ──────────────────────

interface SpamCheckResult {
  score: number; // 0(良) - 100(悪)
  warnings: string[];
  suggestions: string[];
}

function checkSpamScore(subject: string, html: string): SpamCheckResult {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const charCount = text.length;
  const linkCount = (html.match(/<a[^>]*href=/gi) ?? []).length;
  const imgCount = (html.match(/<img[^>]*>/gi) ?? []).length;
  const upperCount = (subject.match(/[A-Z]/g) ?? []).length;
  const upperRatio = subject.length > 0 ? upperCount / subject.length : 0;
  const exclaim = (subject.match(/[!！]/g) ?? []).length;

  // NG ワード（日本語スパム頻出）
  const ngWords = [
    '無料', '激安', '当選', '保証', '簡単', 'クリック', '今すぐ',
    'free', 'guarantee', 'win', 'cash', 'prize', 'urgent',
    '%off', '半額', '限定', '緊急', 'ラスト',
  ];
  const subjectLower = subject.toLowerCase();
  const matchedNg = ngWords.filter((w) => subject.includes(w) || subjectLower.includes(w.toLowerCase()));
  if (matchedNg.length > 0) {
    score += matchedNg.length * 5;
    warnings.push(`件名に注意ワード: ${matchedNg.join(', ')}`);
  }

  // 件名大文字過多
  if (upperRatio > 0.5 && subject.length > 5) {
    score += 15;
    warnings.push('件名が大文字過多（スパム判定されやすい）');
  }

  // 件名感嘆符過多
  if (exclaim > 2) {
    score += 10;
    warnings.push('件名に感嘆符が多すぎる');
  }

  // 画像とテキストのバランス
  if (charCount < 50 && imgCount > 1) {
    score += 20;
    warnings.push('画像が多くテキストが少ない（image-only mail はスパム判定されやすい）');
    suggestions.push('テキストを増やすか alt 属性を充実させてください');
  }

  // リンク数過多
  if (linkCount > 10) {
    score += 15;
    warnings.push(`リンク数が多い (${linkCount}個)`);
    suggestions.push('リンクを 5-7 個程度に絞ると到達率が上がります');
  }

  // 配信停止リンク無し
  if (!html.includes('unsubscribe') && !html.includes('配信停止')) {
    score += 25;
    warnings.push('配信停止リンクが見当たりません（CAN-SPAM法違反）');
    suggestions.push('{{unsubscribe_url}} を必ず入れてください');
  }

  // テキストバージョン推奨（簡易判定）
  if (charCount < 30) {
    score += 10;
    warnings.push('テキスト本文が極端に少ない');
  }

  if (score >= 50) suggestions.push('スパム判定リスクが高めです。文面を見直してください');
  else if (score >= 30) suggestions.push('注意レベル：一部の受信サーバでスパム判定される可能性があります');

  return { score: Math.min(100, score), warnings, suggestions };
}

aiRoutes.post('/spam-check', async (c) => {
  const body = await c.req.json<{ subject: string; html: string }>();
  if (!body.subject || !body.html) {
    return c.json({ success: false, error: 'subject and html required' }, 400);
  }
  const result = checkSpamScore(body.subject, body.html);
  return c.json({ success: true, data: result });
});

// ─── 収益貢献：Shopify 注文 webhook で attribution ─

export const attributionRoutes = new Hono<FermentEnv>();

/**
 * Shopify 注文完了 webhook を受けて、
 * 「注文者が直近24時間以内に開封したメール」に収益を紐付ける
 */
attributionRoutes.post('/order-created', async (c) => {
  const body = await c.req.json<{
    email?: string;
    total_price?: string;
    id?: number | string;
  }>().catch(() => ({}));
  const email = body.email?.toLowerCase();
  if (!email) return c.json({ success: true, data: { skipped: 'no email' } });

  const revenue = Math.floor(parseFloat(body.total_price ?? '0'));
  if (revenue <= 0) return c.json({ success: true, data: { skipped: 'zero revenue' } });

  // 直近24時間に開封されたログを探す（同じメールアドレス、未attribution）
  const log = await c.env.DB
    .prepare(
      `SELECT log_id, campaign_id FROM email_logs
       WHERE to_email = ?
         AND opened_at IS NOT NULL
         AND attributed_revenue = 0
         AND opened_at > datetime('now', '-24 hours')
       ORDER BY opened_at DESC LIMIT 1`,
    )
    .bind(email)
    .first<{ log_id: string; campaign_id: string | null }>();

  if (!log) return c.json({ success: true, data: { attributed: false } });

  await c.env.DB
    .prepare(
      `UPDATE email_logs SET attributed_revenue = ?, attributed_order_id = ?,
         attributed_at = strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')
       WHERE log_id = ?`,
    )
    .bind(revenue, String(body.id ?? ''), log.log_id)
    .run();

  if (log.campaign_id) {
    await c.env.DB
      .prepare(
        `UPDATE email_campaigns SET total_attributed_revenue = total_attributed_revenue + ?,
           total_attributed_orders = total_attributed_orders + 1
         WHERE campaign_id = ?`,
      )
      .bind(revenue, log.campaign_id)
      .run();
  }

  return c.json({ success: true, data: { attributed: true, revenue, campaign_id: log.campaign_id } });
});

// ─── 分析 API（コホート・ファネル） ───────────────

export const analyticsRoutes = new Hono<FermentEnv>();

analyticsRoutes.get('/cohorts', async (c) => {
  // 月別 customer 登録数 と 購入数
  const r = await c.env.DB
    .prepare(
      `SELECT
         strftime('%Y-%m', created_at) as cohort_month,
         COUNT(*) as new_customers,
         COUNT(CASE WHEN order_count >= 1 THEN 1 END) as converted,
         AVG(ltv) as avg_ltv,
         SUM(ltv) as total_ltv
       FROM customers
       WHERE created_at IS NOT NULL
       GROUP BY cohort_month
       ORDER BY cohort_month DESC
       LIMIT 24`,
    )
    .all();
  return c.json({ success: true, data: r.results });
});

analyticsRoutes.get('/funnel/:campaignId', async (c) => {
  const cid = c.req.param('campaignId');
  const r = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) as sent,
         COUNT(opened_at) as opened,
         COUNT(first_clicked_at) as clicked,
         COUNT(CASE WHEN attributed_revenue > 0 THEN 1 END) as converted,
         SUM(attributed_revenue) as total_revenue
       FROM email_logs
       WHERE campaign_id = ?`,
    )
    .bind(cid)
    .first();
  return c.json({ success: true, data: r });
});

analyticsRoutes.get('/funnel-overall', async (c) => {
  const r = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) as sent,
         COUNT(opened_at) as opened,
         COUNT(first_clicked_at) as clicked,
         COUNT(CASE WHEN attributed_revenue > 0 THEN 1 END) as converted,
         SUM(attributed_revenue) as total_revenue
       FROM email_logs
       WHERE queued_at > datetime('now', '-30 days')`,
    )
    .first();
  return c.json({ success: true, data: r });
});

// ─── SMS キャンペーン ───────────────────────────

export const smsCampaignRoutes = new Hono<FermentEnv>();

smsCampaignRoutes.post('/send-to-segment', async (c) => {
  const body = await c.req.json<{ segment_id: string; message: string }>();
  if (!body.segment_id || !body.message) {
    return c.json({ success: false, error: 'segment_id and message required' }, 400);
  }
  // セグメントメンバーで phone を持っている人を抽出
  const members = await c.env.DB
    .prepare(
      `SELECT c.customer_id, c.phone FROM customers c
       INNER JOIN segment_members sm ON sm.customer_id = c.customer_id
       WHERE sm.segment_id = ? AND c.phone IS NOT NULL AND c.subscribed_sms = 1
       LIMIT 1000`,
    )
    .bind(body.segment_id)
    .all<{ customer_id: string; phone: string }>();

  let queued = 0;
  for (const m of members.results) {
    await c.env.DB
      .prepare(
        `INSERT INTO sms_logs (log_id, to_phone, customer_id, body, status) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(generateFermentId('sms'), m.phone, m.customer_id, body.message, 'queued')
      .run();
    queued++;
  }
  return c.json({ success: true, data: { queued } });
});

smsCampaignRoutes.get('/logs', async (c) => {
  const r = await c.env.DB
    .prepare(`SELECT * FROM sms_logs ORDER BY queued_at DESC LIMIT 100`)
    .all();
  return c.json({ success: true, data: r.results });
});
