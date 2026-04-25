/**
 * FERMENT: ポップアップ・埋め込みフォーム
 *
 * 認証付き管理 API: /api/forms/*
 * 公開エンドポイント: /forms/embed/:formId.js, /forms/:formId/submit, /forms/:formId/view
 */

import { Hono } from 'hono';
import {
  generateFermentId,
  listFermentForms,
  getFermentForm,
  createFermentForm,
  updateFermentForm,
  deleteFermentForm,
  incrementFormView,
  recordFormSubmission,
  upsertCustomer,
  type FermentForm,
} from '@line-crm/db';
import type { FermentEnv } from '../types.js';

// ─── 管理 API（認証あり） ──────────────────────────────

export const formAdminRoutes = new Hono<FermentEnv>();

formAdminRoutes.get('/', async (c) => {
  const forms = await listFermentForms(c.env.DB);
  return c.json({ success: true, data: forms });
});

formAdminRoutes.get('/:id', async (c) => {
  const f = await getFermentForm(c.env.DB, c.req.param('id'));
  if (!f) return c.json({ success: false, error: 'Form not found' }, 404);
  return c.json({ success: true, data: f });
});

formAdminRoutes.post('/', async (c) => {
  const body = await c.req.json<Partial<FermentForm>>();
  if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
  const formId = generateFermentId('form');
  await createFermentForm(c.env.DB, {
    form_id: formId,
    name: body.name,
    description: body.description ?? null,
    form_type: body.form_type ?? 'popup',
    display_config: body.display_config ?? '{}',
    on_submit_tag: body.on_submit_tag ?? null,
    on_submit_flow_id: body.on_submit_flow_id ?? null,
    is_active: body.is_active ?? 1,
  });
  const created = await getFermentForm(c.env.DB, formId);
  return c.json({ success: true, data: created });
});

formAdminRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<FermentForm>>();
  await updateFermentForm(c.env.DB, id, body);
  const updated = await getFermentForm(c.env.DB, id);
  return c.json({ success: true, data: updated });
});

formAdminRoutes.delete('/:id', async (c) => {
  await deleteFermentForm(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// ─── 公開エンドポイント（認証なし） ──────────────────

export const formPublicRoutes = new Hono<FermentEnv>();

/** 埋め込み用 JS スニペット配信 */
formPublicRoutes.get('/embed/:formId.js', async (c) => {
  const formId = c.req.param('formId');
  const form = await getFermentForm(c.env.DB, formId);
  if (!form || form.is_active !== 1) {
    return c.text('// FERMENT form not found or inactive', 404, {
      'Content-Type': 'application/javascript; charset=utf-8',
    });
  }
  let config: { title?: string; description?: string; button?: string; placeholder?: string; success?: string; bg?: string; accent?: string } = {};
  try { config = JSON.parse(form.display_config); } catch { /* noop */ }

  const workerUrl = c.env.WORKER_URL ?? `https://${c.req.header('host')}`;
  const title = (config.title ?? 'ニュースレター登録').replace(/'/g, "\\'");
  const description = (config.description ?? 'お得な情報をお届けします').replace(/'/g, "\\'");
  const button = (config.button ?? '登録する').replace(/'/g, "\\'");
  const placeholder = (config.placeholder ?? 'メールアドレス').replace(/'/g, "\\'");
  const success = (config.success ?? 'ご登録ありがとうございます！').replace(/'/g, "\\'");
  const bg = config.bg ?? '#ffffff';
  const accent = config.accent ?? '#225533';

  const js = `
(function(){
  var FORM_ID = '${formId}';
  var WORKER = '${workerUrl}';
  var STYLE = 'position:fixed;bottom:20px;right:20px;z-index:99999;width:360px;background:${bg};border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.15);padding:20px;font-family:-apple-system,sans-serif;color:#333;';
  if (sessionStorage.getItem('ferment_form_' + FORM_ID + '_dismissed')) return;
  fetch(WORKER + '/forms/' + FORM_ID + '/view', {method:'POST',mode:'no-cors'}).catch(function(){});
  function show() {
    var el = document.createElement('div');
    el.id = 'ferment-form-' + FORM_ID;
    el.style.cssText = STYLE;
    el.innerHTML = ''
      + '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;"><h3 style="margin:0;font-size:16px;color:${accent};">${title}</h3>'
      + '<button id="fc" style="background:none;border:none;cursor:pointer;color:#999;font-size:18px;line-height:1;">×</button></div>'
      + '<p style="margin:8px 0 12px;font-size:13px;color:#666;">${description}</p>'
      + '<form id="ff"><input type="email" name="email" required placeholder="${placeholder}" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:14px;margin-bottom:8px;" />'
      + '<button type="submit" style="width:100%;padding:10px;background:${accent};color:white;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;">${button}</button></form>'
      + '<p id="fm" style="margin:8px 0 0;font-size:12px;color:#666;display:none;"></p>';
    document.body.appendChild(el);
    document.getElementById('fc').onclick = function(){
      sessionStorage.setItem('ferment_form_' + FORM_ID + '_dismissed', '1');
      el.remove();
    };
    document.getElementById('ff').onsubmit = function(ev){
      ev.preventDefault();
      var email = ev.target.email.value;
      fetch(WORKER + '/forms/' + FORM_ID + '/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: email, source_url: location.href})
      }).then(function(r){ return r.json(); }).then(function(j){
        var msg = document.getElementById('fm');
        if (j.success) {
          msg.textContent = '${success}';
          msg.style.color = '#225533';
          msg.style.display = 'block';
          setTimeout(function(){ el.remove(); }, 3000);
        } else {
          msg.textContent = j.error || '送信に失敗しました';
          msg.style.color = '#d33';
          msg.style.display = 'block';
        }
      });
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(show, 3000); });
  } else {
    setTimeout(show, 3000);
  }
})();
`.trim();

  return c.text(js, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
  });
});

/** ビューカウント */
formPublicRoutes.post('/:formId/view', async (c) => {
  await incrementFormView(c.env.DB, c.req.param('formId')).catch(() => {});
  return c.json({ ok: true });
});

/** フォーム送信 */
formPublicRoutes.post('/:formId/submit', async (c) => {
  const formId = c.req.param('formId');
  const body = await c.req.json<{ email: string; display_name?: string; source_url?: string }>().catch(() => ({} as { email?: string }));
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ success: false, error: 'メールアドレスが不正です' }, 400);
  }
  const form = await getFermentForm(c.env.DB, formId);
  if (!form || form.is_active !== 1) {
    return c.json({ success: false, error: 'フォームが見つかりません' }, 404);
  }

  // 既存 customer 検索 or 新規作成
  const existing = await c.env.DB
    .prepare('SELECT customer_id FROM customers WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ customer_id: string }>();
  const customerId = existing?.customer_id ?? generateFermentId('cu');

  // タグ付与
  const tags: string[] = [`form:${formId}`];
  if (form.on_submit_tag) tags.push(form.on_submit_tag);

  await upsertCustomer(c.env.DB, {
    customer_id: customerId,
    email,
    display_name: body.display_name ?? null,
    region: 'JP',
    language: 'ja',
    subscribed_email: 1,
    tags: tags.join(','),
  });

  await recordFormSubmission(c.env.DB, {
    submission_id: generateFermentId('sub'),
    form_id: formId,
    email,
    display_name: body.display_name ?? null,
    customer_id: customerId,
    source_url: body.source_url ?? null,
    user_agent: c.req.header('user-agent') ?? null,
    ip_hash: null,
  });

  return c.json({ success: true, data: { customer_id: customerId } }, 200, {
    'Access-Control-Allow-Origin': '*',
  });
});

// CORS preflight
formPublicRoutes.options('/:formId/submit', (c) =>
  c.text('', 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }),
);
formPublicRoutes.options('/:formId/view', (c) =>
  c.text('', 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }),
);
