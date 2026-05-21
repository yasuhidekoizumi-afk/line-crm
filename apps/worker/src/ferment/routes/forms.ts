/**
 * FERMENT: ポップアップ・埋め込みフォーム
 *
 * 認証付き管理 API: /api/forms/*
 * 公開エンドポイント: /forms/embed/:formId.js, /forms/:formId/submit, /forms/:formId/view
 *
 * 統合版: LINE CRM forms の機能（フィールド定義・LIFF投稿・サイドエフェクト）を吸収
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
  getFermentFormSubmissions,
  upsertCustomer,
  getFriendByLineUserId,
  getFriendById,
  addTagToFriend,
  enrollFriendInScenario,
  jstNow,
  type FermentForm,
} from '@line-crm/db';
import type { FermentEnv } from '../types.js';
import type { Env } from '../../index.js';

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
    fields: body.fields ?? '[]',
    on_submit_scenario_id: body.on_submit_scenario_id ?? null,
    save_to_metadata: body.save_to_metadata ?? 0,
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

/**
 * GET /:id/submissions — フォーム回答一覧
 * LINE CRM forms の同機能を統合
 */
formAdminRoutes.get('/:id/submissions', async (c) => {
  const formId = c.req.param('id');
  const form = await getFermentForm(c.env.DB, formId);
  if (!form) return c.json({ success: false, error: 'Form not found' }, 404);
  const submissions = await getFermentFormSubmissions(c.env.DB, formId);
  return c.json({ success: true, data: submissions });
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
  var TRIGGER_TYPE = '${form.trigger_type ?? 'time_delay'}';
  var TRIGGER_VALUE = ${form.trigger_value ?? 3000};
  function setupTrigger() {
    if (TRIGGER_TYPE === 'exit_intent') {
      var fired = false;
      document.addEventListener('mouseleave', function(e){
        if (fired) return;
        if (e.clientY < 0) { fired = true; show(); }
      });
    } else if (TRIGGER_TYPE === 'scroll_depth') {
      var fired = false;
      window.addEventListener('scroll', function(){
        if (fired) return;
        var pct = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100;
        if (pct >= TRIGGER_VALUE) { fired = true; show(); }
      });
    } else if (TRIGGER_TYPE === 'manual') {
      window.fermentShowForm_${formId.replace(/[^a-z0-9]/gi, '_')} = show;
    } else {
      setTimeout(show, TRIGGER_VALUE);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTrigger);
  } else {
    setupTrigger();
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

/**
 * フォーム送信（統合版）
 *
 * 2つのモード:
 * 1. Web埋め込み（email capture）: { email, display_name?, source_url? }
 * 2. LIFF投稿（LINE CRM forms互換）: { lineUserId?, friendId?, data?, email? }
 */
formPublicRoutes.post('/:formId/submit', async (c) => {
  const formId = c.req.param('formId');
  const body = await c.req.json<{
    email?: string;
    display_name?: string;
    source_url?: string;
    lineUserId?: string;
    friendId?: string;
    data?: Record<string, unknown>;
  }>().catch(() => ({}));

  const form = await getFermentForm(c.env.DB, formId);
  if (!form || form.is_active !== 1) {
    return c.json({ success: false, error: 'フォームが見つかりません' }, 404);
  }

  // ── モード判定: LIFF投稿（lineUserId or friendId あり） or Web投稿（email capture） ──
  const isLiffMode = !!(body.lineUserId || body.friendId);

  if (isLiffMode) {
    // === LIFF/CRMフォームモード ===
    const submissionData = body.data ?? {};

    // 必須フィールドバリデーション
    let fields: Array<{ name: string; label: string; type: string; required?: boolean }> = [];
    try { fields = JSON.parse(form.fields || '[]'); } catch { /* noop */ }
    for (const field of fields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (val === undefined || val === null || val === '') {
          return c.json({ success: false, error: `${field.label} は必須項目です` }, 400);
        }
      }
    }

    // 友だち解決
    let friendId: string | null = body.friendId ?? null;
    if (!friendId && body.lineUserId) {
      const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
      if (friend) friendId = friend.id;
    }

    const submissionId = generateFermentId('sub');
    await recordFormSubmission(c.env.DB, {
      submission_id: submissionId,
      form_id: formId,
      email: body.email ?? '',
      display_name: null,
      customer_id: null,
      data: JSON.stringify(submissionData),
      friend_id: friendId,
      source_url: body.source_url ?? null,
      user_agent: c.req.header('user-agent') ?? null,
      ip_hash: null,
    });

    // サイドエフェクト（LINE CRM forms 互換）
    if (friendId) {
      const db = c.env.DB;
      const now = jstNow();
      const sideEffects: Promise<unknown>[] = [];

      // メタデータ保存
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          })(),
        );
      }

      // タグ付与
      if (form.on_submit_tag) {
        sideEffects.push(addTagToFriend(db, friendId, form.on_submit_tag));
      }

      // シナリオ登録
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }

      // 388ptキャンペーン: タグ検出時→ポイント付与API呼び出し
      if (form.on_submit_tag === 'e8e9f6d1-f35c-418f-b39f-7a8765c082ec') {
        const campaignEmail = body.email || (submissionData.email as string) || null;
        if (campaignEmail) {
          fetch('https://point-charge.oryzae.workers.dev/api/loyalty/campaign-award', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaign_key: '8th_anniversary_88pt', email: campaignEmail }),
          }).catch(e => console.error('campaign award webhook failed:', e));
        }
      }
    }

    return c.json({
      success: true,
      data: { submission_id: submissionId },
    }, 201, { 'Access-Control-Allow-Origin': '*' });
  } else {
    // === Web埋め込み/メールアドレス収集モード ===
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ success: false, error: 'メールアドレスが不正です' }, 400);
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
      data: '{}',
      friend_id: null,
      source_url: body.source_url ?? null,
      user_agent: c.req.header('user-agent') ?? null,
      ip_hash: null,
    });

    return c.json({ success: true, data: { customer_id: customerId } }, 200, {
      'Access-Control-Allow-Origin': '*',
    });
  }
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
