/**
 * FERMENT: メールテンプレート API
 *
 * GET    /api/email/templates
 * GET    /api/email/templates/:id
 * POST   /api/email/templates
 * PUT    /api/email/templates/:id
 * DELETE /api/email/templates/:id
 * POST   /api/email/templates/:id/preview
 * POST   /api/email/templates/:id/ai-edit  — 自然言語指示で件名・本文を AI 書き換え
 */

import { Hono } from 'hono';
import {
  getEmailTemplates,
  getEmailTemplateById,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  getCustomerById,
  generateFermentId,
} from '@line-crm/db';
import { personalizeEmail } from '../personalize.js';
import type { FermentEnv } from '../types.js';

export const emailTemplateRoutes = new Hono<FermentEnv>();

// 一覧
emailTemplateRoutes.get('/templates', async (c) => {
  try {
    const items = await getEmailTemplates(c.env.DB);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('[FERMENT] GET /templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 単一取得
emailTemplateRoutes.get('/templates/:id', async (c) => {
  try {
    const item = await getEmailTemplateById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: item });
  } catch (err) {
    console.error('[FERMENT] GET /templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 作成
emailTemplateRoutes.post('/templates', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      category?: string;
      language?: string;
      subject_base?: string;
      preheader_base?: string;
      body_html?: string;
      body_text?: string;
      ai_system_prompt?: string;
      ai_enabled?: boolean;
      from_name?: string;
      from_email?: string;
      reply_to?: string;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name は必須です' }, 400);
    }

    const templateId = generateFermentId('tpl');
    await createEmailTemplate(c.env.DB, {
      template_id: templateId,
      name: body.name,
      category: body.category ?? null,
      language: body.language ?? 'ja',
      subject_base: body.subject_base ?? null,
      preheader_base: body.preheader_base ?? null,
      body_html: body.body_html ?? null,
      body_text: body.body_text ?? null,
      ai_system_prompt: body.ai_system_prompt ?? null,
      ai_enabled: body.ai_enabled ? 1 : 0,
      from_name: body.from_name ?? 'オリゼ',
      from_email: body.from_email ?? null,
      reply_to: body.reply_to ?? null,
    });

    const created = await getEmailTemplateById(c.env.DB, templateId);
    return c.json({ success: true, data: created }, 201);
  } catch (err) {
    console.error('[FERMENT] POST /templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 更新
emailTemplateRoutes.put('/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailTemplateById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    // ai_enabled を boolean → number に変換
    if (typeof body.ai_enabled === 'boolean') {
      body.ai_enabled = body.ai_enabled ? 1 : 0;
    }

    await updateEmailTemplate(c.env.DB, id, body);
    const updated = await getEmailTemplateById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('[FERMENT] PUT /templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除
emailTemplateRoutes.delete('/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getEmailTemplateById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    await deleteEmailTemplate(c.env.DB, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[FERMENT] DELETE /templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// プレビュー（任意の customer_id でテスト生成）
// AI 自然言語編集: ユーザーの指示でテンプレートの件名・本文 HTML・テキストを書き換える
// 「保存」ではなく書き換え結果を返すだけ（フロントが確認後に PUT で保存する設計）
emailTemplateRoutes.post('/templates/:id/ai-edit', async (c) => {
  try {
    const id = c.req.param('id');
    const template = await getEmailTemplateById(c.env.DB, id);
    if (!template) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ instruction?: string }>();
    const instruction = (body.instruction ?? '').trim();
    if (!instruction) {
      return c.json({ success: false, error: '指示文を入力してください' }, 400);
    }

    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);

    const prompt = `あなたはオリゼ（米麹発酵食品EC）のメールマーケ担当です。
既存のメールテンプレートをユーザーの指示に従って書き換えてください。

# 現在の件名
${template.subject_base ?? ''}

# 現在の本文 HTML
${template.body_html ?? ''}

# 現在の本文テキスト
${template.body_text ?? ''}

# ユーザーの指示
${instruction}

# ルール
- 指示の意図を汲んで、必要な箇所のみ書き換える（不要な改変はしない）
- ブランドトーン: 誠実・温かみ・専門性（米麹）・健康志向
- HTML はインライン CSS で見出し色 #225533 を維持
- 「{{name}}」「{{first_name}}」「{{ltv_yen}}」「{{unsubscribe_url}}」等のプレースホルダーは保持
- text 版は HTML のプレーンテキスト相当にする

# 出力フォーマット (JSON のみ、説明不要)
{
  "subject": "...",
  "body_html": "...",
  "body_text": "...",
  "diff_summary": "1〜2 文で何を変えたかの要約"
}`;

    const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
    const model = 'gemini-3-flash-preview';
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return c.json({ success: false, error: `Gemini ${res.status}: ${text.slice(0, 200)}` }, 500);
    }
    const data = await res.json<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    let parsed: { subject?: string; body_html?: string; body_text?: string; diff_summary?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return c.json({ success: false, error: 'AI が JSON を返しませんでした。もう一度お試しください。' }, 500);
    }

    return c.json({
      success: true,
      data: {
        subject: parsed.subject ?? template.subject_base ?? '',
        body_html: parsed.body_html ?? template.body_html ?? '',
        body_text: parsed.body_text ?? template.body_text ?? '',
        diff_summary: parsed.diff_summary ?? '',
      },
    });
  } catch (err) {
    console.error('[FERMENT] POST /templates/:id/ai-edit error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

emailTemplateRoutes.post('/templates/:id/preview', async (c) => {
  try {
    const id = c.req.param('id');
    const template = await getEmailTemplateById(c.env.DB, id);
    if (!template) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ customer_id?: string }>();

    // ダミー顧客またはリクエストで指定した顧客
    const customer = body.customer_id
      ? await getCustomerById(c.env.DB, body.customer_id)
      : null;

    const dummyCustomer = customer ?? {
      customer_id: 'preview',
      email: 'preview@example.com',
      display_name: 'テスト 太郎',
      region: 'JP',
      language: 'ja',
      ltv: 50000,
      ltv_currency: 'JPY',
      order_count: 3,
      first_order_at: null,
      last_order_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      avg_order_value: 16000,
      preferred_products: JSON.stringify(['KOJIPOP', '麹甘味料']),
      tags: JSON.stringify(['repeat_buyer']),
      subscribed_email: 1,
      subscribed_line: 1,
      email_bounced: 0,
      email_verified_at: null,
      shopify_customer_id_jp: null,
      shopify_customer_id_us: null,
      line_user_id: null,
      source: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // AI は無効化してプレビュー
    const previewTemplate = { ...template, ai_enabled: 0 };
    const result = await personalizeEmail(previewTemplate, dummyCustomer, {
      FERMENT_UNSUBSCRIBE_BASE_URL: c.env.FERMENT_UNSUBSCRIBE_BASE_URL,
      FERMENT_HMAC_SECRET: c.env.FERMENT_HMAC_SECRET,
    });

    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('[FERMENT] POST /templates/:id/preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
