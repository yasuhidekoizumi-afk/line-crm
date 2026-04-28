/**
 * FERMENT AI コックピット (Phase B-1)
 *
 * - 戦略エージェント（日次提案 TOP 3）
 * - AI チャット相談
 * - 異常検知ステータス
 * - 週次振り返りレポート
 * - Kill Switch 管理
 */

import { Hono } from 'hono';
import { generateFermentId } from '@line-crm/db';
import type { FermentEnv } from '../types.js';

export const cockpitRoutes = new Hono<FermentEnv>();

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 用途別モデル使い分け
const MODEL_PRO = 'gemini-3.1-pro-preview';      // 深い推論：戦略・チャット・本文生成
const MODEL_FLASH = 'gemini-3-flash-preview';    // 高速・低コスト：振り返り・件名生成

// ─── Kill Switch チェック ───────────────────

async function isKilled(env: FermentEnv['Bindings'], scope: string): Promise<boolean> {
  const r = await env.DB
    .prepare("SELECT enabled FROM ai_kill_switch WHERE scope IN ('all', ?) AND enabled = 1 LIMIT 1")
    .bind(scope)
    .first<{ enabled: number }>();
  return !!r;
}

// ─── Gemini API ヘルパー ───────────────────

async function callGemini(apiKey: string, prompt: string, jsonOutput = false, model: string = MODEL_PRO): Promise<{
  text: string;
  cost: number;
  model: string;
}> {
  const res = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          // Pro モデルは thinking 必須、Flash モデルは無効化でレスポンス短縮
          ...(model.includes('pro') ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
          ...(jsonOutput ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  }>();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  const tokens = data.usageMetadata?.totalTokenCount ?? 0;
  // モデル別料金概算（Preview 段階のため仮）
  // Pro: $1.25/1M input + $5.00/1M output → 平均 $0.00000175/token
  // Flash: $0.15/1M input + $0.60/1M output → 平均 $0.0000003/token
  const perToken = model.includes('pro') ? 0.00000175 : 0.0000003;
  const cost = tokens * perToken;
  return { text, cost, model };
}

// ─── 1. 戦略エージェント ─────────────────────

cockpitRoutes.get('/strategy/today', async (c) => {
  if (await isKilled(c.env, 'strategy')) {
    return c.json({ success: false, error: 'Strategy agent is paused' }, 503);
  }
  const today = new Date().toISOString().slice(0, 10);
  const cached = await c.env.DB
    .prepare('SELECT * FROM ai_strategy_proposals WHERE date = ?')
    .bind(today)
    .first<{ proposals: string; warnings: string | null; created_at: string }>();
  if (cached) {
    return c.json({
      success: true,
      data: {
        date: today,
        cached: true,
        proposals: JSON.parse(cached.proposals),
        warnings: cached.warnings ? JSON.parse(cached.warnings) : [],
        generated_at: cached.created_at,
      },
    });
  }
  return c.json({ success: false, error: 'Not generated yet. Run cron or POST /strategy/generate' });
});

cockpitRoutes.post('/strategy/generate', async (c) => {
  if (await isKilled(c.env, 'strategy')) {
    return c.json({ success: false, error: 'Strategy agent is paused' }, 503);
  }
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);

  // データ収集
  const today = new Date().toISOString().slice(0, 10);
  const stats = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM customers) as total_customers,
         (SELECT COUNT(*) FROM customers WHERE subscribed_email = 1) as subscribers,
         (SELECT COUNT(*) FROM customers WHERE purchase_probability_30d >= 0.5) as high_intent,
         (SELECT COUNT(*) FROM customers WHERE churn_risk_score >= 0.6) as churn_risk,
         (SELECT COUNT(*) FROM email_campaigns WHERE sent_at >= datetime('now', '-7 days')) as campaigns_7d,
         (SELECT COALESCE(SUM(total_sent), 0) FROM email_campaigns WHERE sent_at >= datetime('now', '-7 days')) as sent_7d,
         (SELECT COALESCE(SUM(total_opened), 0) FROM email_campaigns WHERE sent_at >= datetime('now', '-7 days')) as opened_7d,
         (SELECT COALESCE(SUM(total_attributed_revenue), 0) FROM email_campaigns WHERE sent_at >= datetime('now', '-7 days')) as revenue_7d,
         (SELECT COUNT(*) FROM customer_cart_states WHERE abandoned_at >= datetime('now', '-3 days') AND recovered_at IS NULL) as cart_abandoned_3d`,
    )
    .first<Record<string, number>>();

  const recentCampaigns = await c.env.DB
    .prepare(
      `SELECT name, total_sent, total_opened, total_attributed_revenue
       FROM email_campaigns WHERE sent_at >= datetime('now', '-30 days')
       ORDER BY total_attributed_revenue DESC LIMIT 5`,
    )
    .all();

  const segments = await c.env.DB
    .prepare('SELECT name, customer_count FROM segments WHERE customer_count > 0 ORDER BY customer_count DESC LIMIT 10')
    .all();

  const prompt = `あなたはオリゼ（米麹発酵食品EC・社員35人）のマーケ戦略責任者です。
本日 ${today} の状況を分析し、今日やるべきマーケアクション TOP 3 を JSON で返してください。

# 現状データ
${JSON.stringify({ stats, recent_campaigns: recentCampaigns.results, segments: segments.results }, null, 2)}

# ルール
- 売上インパクトと実行容易性で優先順位
- 各アクションは「対象セグメント・配信内容・想定効果（数値）・実行URL」を明記
- 既存セグメント・既存テンプレで実行可能なもの優先
- ブランドトーン: 誠実・温かみ・専門性（米麹）・健康志向

# execute_url は以下の実在ルートのいずれかを必ず使うこと（他のパスは禁止）
- /broadcasts (LINE 一斉配信)
- /scenarios (LINE シナリオ配信)
- /email/campaigns (メールキャンペーン)
- /email/templates (メールテンプレ)
- /email/flows (メールフロー)
- /segments (セグメント管理)
- /loyalty (ロイヤルティ)
- /chats (個別チャット)

# 出力フォーマット (JSON配列のみ、説明不要)
{
  "actions": [
    {
      "rank": 1,
      "title": "アクション名",
      "segment_name": "対象セグメント名",
      "template_hint": "推奨テンプレ or 内容",
      "expected_impact": "売上 +¥XX,000 / 開封 +XX件",
      "execute_url": "/email/campaigns",
      "reasoning": "なぜこれが今日やるべきか（2-3文）"
    }
  ],
  "warnings": ["警告メッセージ（任意）"]
}`;

  try {
    const { text, cost } = await callGemini(apiKey, prompt, true);
    const parsed = JSON.parse(text) as { actions: unknown[]; warnings?: string[] };

    const proposalId = generateFermentId('prop');
    await c.env.DB
      .prepare(
        `INSERT INTO ai_strategy_proposals (proposal_id, date, proposals, warnings, data_snapshot, ai_model, ai_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           proposals = excluded.proposals,
           warnings = excluded.warnings,
           data_snapshot = excluded.data_snapshot,
           ai_cost_usd = excluded.ai_cost_usd,
           created_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
      )
      .bind(
        proposalId,
        today,
        JSON.stringify(parsed.actions),
        JSON.stringify(parsed.warnings ?? []),
        JSON.stringify({ stats, recent_campaigns: recentCampaigns.results }),
        MODEL_PRO,
        cost,
      )
      .run();

    // 各アクションの追跡レコードを作成
    const actions = parsed.actions as Array<{ rank: number }>;
    for (const a of actions) {
      await c.env.DB
        .prepare(
          'INSERT INTO ai_proposal_actions (action_id, proposal_id, rank, status) VALUES (?, ?, ?, ?)',
        )
        .bind(generateFermentId('act'), proposalId, a.rank, 'proposed')
        .run();
    }

    // 利用統計
    await c.env.DB
      .prepare(
        `INSERT INTO ai_usage_stats (date, strategy_calls, total_cost_usd) VALUES (?, 1, ?)
         ON CONFLICT(date) DO UPDATE SET
           strategy_calls = strategy_calls + 1,
           total_cost_usd = total_cost_usd + ?`,
      )
      .bind(today, cost, cost)
      .run();

    return c.json({ success: true, data: { date: today, proposals: parsed.actions, warnings: parsed.warnings ?? [], cost_usd: cost } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── 1.5. AI ドラフト生成（実行ボタン用） ──────
//
// 戦略提案のアクション内容から、配信ドラフトを Gemini に生成させ、
// セグメント・テンプレ ID も DB から解決して返す。
// フロントは結果を base64 化してクエリパラメータで遷移先のフォームをプレフィルする。

cockpitRoutes.post('/draft-from-action', async (c) => {
  try {
    if (await isKilled(c.env, 'strategy')) {
      return c.json({ success: false, error: 'Strategy agent is paused' }, 503);
    }
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);

    const body = await c.req.json<{
      action: {
        title: string;
        segment_name?: string;
        template_hint?: string;
        expected_impact?: string;
        reasoning?: string;
        execute_url?: string;
      };
    }>();
    const action = body.action;
    if (!action || !action.title) {
      return c.json({ success: false, error: 'action.title is required' }, 400);
    }

    const url = action.execute_url ?? '';
    const isLine = url.startsWith('/broadcasts') || url.startsWith('/scenarios');
    const isEmail = url.startsWith('/email/');
    if (!isLine && !isEmail) {
      return c.json({ success: false, error: `Unsupported execute_url: ${url}` }, 400);
    }

    // セグメント解決（部分一致 → 顧客数最多優先）
    let segment_id: string | null = null;
    let segment_name_resolved: string | null = null;
    if (action.segment_name) {
      const seg = await c.env.DB
        .prepare(
          "SELECT segment_id, name FROM segments WHERE name LIKE ? ORDER BY customer_count DESC LIMIT 1",
        )
        .bind(`%${action.segment_name}%`)
        .first<{ segment_id: string; name: string }>()
        .catch(() => null);
      if (seg) {
        segment_id = seg.segment_id;
        segment_name_resolved = seg.name;
      }
    }

    // テンプレ解決（メールのみ）— キーワードを抽出して柔軟マッチ
    let template_id: string | null = null;
    let template_name_resolved: string | null = null;
    let template_auto_created = false;
    if (isEmail && action.template_hint) {
      // 推奨内容からキーワードを抽出（括弧内・記号は除去、2文字以上のトークン）
      const cleaned = action.template_hint.replace(/[（）()【】\[\]、，,。.「」"]/g, ' ');
      const keywords = cleaned.split(/\s+/).filter((k) => k.length >= 2).slice(0, 5);
      // category 推定（名前の中に含まれていれば）
      const knownCats = ['welcome', 'cart', 'winback', 'newsletter', 'transactional'];
      const lowerHint = action.template_hint.toLowerCase();
      const guessedCat = knownCats.find((c) => lowerHint.includes(c))
        ?? (action.template_hint.includes('ニュースレター') ? 'newsletter'
          : action.template_hint.includes('カゴ') ? 'cart'
          : action.template_hint.includes('休眠') ? 'winback'
          : null);
      // まず category 一致を試す
      if (guessedCat) {
        const tmpl = await c.env.DB
          .prepare("SELECT template_id, name FROM email_templates WHERE category = ? ORDER BY created_at DESC LIMIT 1")
          .bind(guessedCat)
          .first<{ template_id: string; name: string }>()
          .catch(() => null);
        if (tmpl) {
          template_id = tmpl.template_id;
          template_name_resolved = tmpl.name;
        }
      }
      // 見つからなければキーワードで OR マッチ
      if (!template_id && keywords.length > 0) {
        const conds = keywords.map(() => 'name LIKE ?').join(' OR ');
        const params = keywords.map((k) => `%${k}%`);
        const tmpl = await c.env.DB
          .prepare(`SELECT template_id, name FROM email_templates WHERE ${conds} ORDER BY created_at DESC LIMIT 1`)
          .bind(...params)
          .first<{ template_id: string; name: string }>()
          .catch(() => null);
        if (tmpl) {
          template_id = tmpl.template_id;
          template_name_resolved = tmpl.name;
        }
      }
    }

    let draft: Record<string, unknown> = {};
    let cost = 0;

    if (isLine) {
      // LINE 一斉配信用テキスト本文を生成（Flash で高速＆低コスト）
      const prompt = `あなたはオリゼ（米麹発酵食品EC）の LINE 配信担当です。
以下の AI 提案アクションを基に、LINE 一斉配信のテキストメッセージ本文を作成してください。

# AI 提案
- タイトル: ${action.title}
- 対象セグメント: ${action.segment_name ?? '（指定なし）'}
- 推奨内容: ${action.template_hint ?? '（指定なし）'}
- 期待効果: ${action.expected_impact ?? '（指定なし）'}
- 提案理由: ${action.reasoning ?? '（指定なし）'}

# ルール
- LINE 一斉配信用のテキストメッセージ（プレーンテキスト、マークダウン禁止）
- 全角 250〜450 文字
- ブランドトーン: 誠実・温かみ・専門性（米麹）・健康志向
- 絵文字は適度に（1〜3 個）
- 末尾に明確な行動喚起（CTA）
- 「{{name}}」のようなパーソナライズタグは使わない（一斉配信のため）

# 出力フォーマット (JSON のみ、説明不要)
{ "messageContent": "..." }`;
      const result = await callGemini(apiKey, prompt, true, MODEL_FLASH);
      cost = result.cost;
      let messageContent = '';
      try {
        const parsed = JSON.parse(result.text) as { messageContent?: string };
        messageContent = parsed.messageContent ?? '';
      } catch {
        // JSON でない場合は生テキストをそのまま使う（まれに Gemini が崩れる）
        messageContent = result.text;
      }
      if (!messageContent.trim()) {
        // 完全に失敗した場合のフォールバック
        messageContent = `${action.title}\n\n${action.template_hint ?? ''}\n\n${action.reasoning ?? ''}`.trim();
      }
      draft = {
        title: action.title,
        messageType: 'text',
        messageContent,
        targetType: 'all',
        ai_generated: true,
      };
    } else if (isEmail) {
      // テンプレが既存マッチしなかった場合、AI が新規テンプレを自動生成して登録
      if (!template_id) {
        const prompt = `あなたはオリゼ（米麹発酵食品EC）のメールマーケ担当です。
以下の AI 提案アクションを基に、メールテンプレートのドラフトを作成してください。

# AI 提案
- タイトル: ${action.title}
- 対象セグメント: ${action.segment_name ?? '（指定なし）'}
- 推奨内容: ${action.template_hint ?? '（指定なし）'}
- 期待効果: ${action.expected_impact ?? '（指定なし）'}
- 提案理由: ${action.reasoning ?? '（指定なし）'}

# ルール
- 件名: 開封率を意識した魅力的な日本語件名（30〜50 文字、絵文字 0〜1 個）
- 本文 HTML: <h1>, <p>, <a> 等の最低限のタグでブランディング、インライン CSS で見出し色 #225533
  - 段落 3〜5 個程度、商品紹介や CTA を含める
  - <a> の href は "#" で良い（後で編集前提）
  - 「{{name}}」「{{first_name}}」のようなパーソナライズタグは使ってよい
- 本文 text: HTML の代替プレーンテキスト版
- ブランドトーン: 誠実・温かみ・専門性（米麹）・健康志向

# 出力フォーマット (JSON のみ、説明不要)
{ "subject": "...", "body_html": "...", "body_text": "..." }`;
        try {
          const result = await callGemini(apiKey, prompt, true, MODEL_FLASH);
          cost += result.cost;
          const parsed = JSON.parse(result.text) as {
            subject?: string;
            body_html?: string;
            body_text?: string;
          };
          if (parsed.subject || parsed.body_html) {
            const newId = generateFermentId('tpl');
            const tmplName = `AI 提案: ${action.title}`.slice(0, 80);
            const guessedCat = action.template_hint?.includes('ニュースレター') ? 'newsletter'
              : action.template_hint?.includes('カゴ') ? 'cart'
              : action.template_hint?.includes('休眠') ? 'winback'
              : 'newsletter';
            await c.env.DB
              .prepare(
                `INSERT INTO email_templates (template_id, name, category, language, subject_base, body_html, body_text, from_name, ai_enabled)
                 VALUES (?, ?, ?, 'ja', ?, ?, ?, 'オリゼ', 0)`,
              )
              .bind(
                newId,
                tmplName,
                guessedCat,
                parsed.subject ?? action.title,
                parsed.body_html ?? `<p>${action.template_hint ?? action.title}</p>`,
                parsed.body_text ?? action.template_hint ?? action.title,
              )
              .run();
            template_id = newId;
            template_name_resolved = tmplName;
            template_auto_created = true;
          }
        } catch (genErr) {
          console.error('email template auto-gen failed:', genErr);
        }
      }
      draft = {
        name: action.title,
        template_id,
        segment_id,
        ai_generated: true,
        template_auto_created,
      };
    }

    // 利用統計（スキーマ古いと失敗するので catch で握りつぶす）
    const today = new Date().toISOString().slice(0, 10);
    await c.env.DB
      .prepare(
        `INSERT INTO ai_usage_stats (date, draft_calls, total_cost_usd) VALUES (?, 1, ?)
         ON CONFLICT(date) DO UPDATE SET
           draft_calls = COALESCE(draft_calls, 0) + 1,
           total_cost_usd = total_cost_usd + ?`,
      )
      .bind(today, cost, cost)
      .run()
      .catch(() => {/* draft_calls カラムが無い旧スキーマでも握りつぶす */});

    return c.json({
      success: true,
      data: {
        channel: isLine ? 'line' : 'email',
        draft,
        resolved: {
          segment_id,
          segment_name: segment_name_resolved,
          template_id,
          template_name: template_name_resolved,
        },
        execute_url: url,
        cost_usd: cost,
      },
    });
  } catch (e) {
    console.error('draft-from-action error:', e);
    return c.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});

// ─── 1.6. AI 画像生成（Gemini Nano Banana 2 = gemini-3-flash-image） ──────
//
// 自然言語プロンプトから画像を生成し R2 に保存して URL を返す。
// テンプレ編集時に <img> タグとして本文に挿入する用途。
// 入力に reference_image_urls / product_ids を渡せば I2I（商品画像をベースにシーン展開）も可能。

cockpitRoutes.post('/generate-image', async (c) => {
  try {
    if (await isKilled(c.env, 'image')) {
      return c.json({ success: false, error: 'Image generation is paused' }, 503);
    }
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);
    if (!c.env.IMAGES) return c.json({ success: false, error: 'IMAGES R2 bucket not bound' }, 503);

    const body = await c.req.json<{
      prompt: string;
      size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
      quality?: 'low' | 'medium' | 'high' | 'auto';
      model?: 'flash' | 'pro';            // flash = Nano Banana 2 / pro = Nano Banana Pro
      reference_image_urls?: string[];
      product_ids?: string[];
      auto_detect_product?: boolean;
    }>();
    const prompt = (body.prompt ?? '').trim();
    if (!prompt) return c.json({ success: false, error: 'prompt is required' }, 400);
    const size = body.size ?? '1024x1024';
    const quality = body.quality ?? 'medium';
    const modelTier = body.model ?? 'flash';

    // 参照画像 URL を構築: 明示的 URL + 商品 ID 解決 + AI 自動検出
    const refUrls: string[] = [...(body.reference_image_urls ?? [])];

    // (B) 明示的に指定された商品 ID から画像 URL を取得
    const shopDomain = c.env.SHOPIFY_SHOP_DOMAIN;
    const adminToken = c.env.SHOPIFY_ADMIN_TOKEN;
    if (body.product_ids && body.product_ids.length > 0 && shopDomain && adminToken) {
      try {
        const url = `https://${shopDomain}/admin/api/2024-10/products.json?ids=${body.product_ids.join(',')}&fields=id,image`;
        const res = await fetch(url, {
          headers: { 'X-Shopify-Access-Token': adminToken, 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json<{ products: Array<{ image?: { src?: string } }> }>();
          for (const p of data.products) {
            if (p.image?.src) refUrls.push(p.image.src);
          }
        }
      } catch (e) {
        console.error('product_ids resolve failed:', e);
      }
    }

    // (C) プロンプトから商品名を AI 抽出して Shopify を検索
    if (body.auto_detect_product && shopDomain && adminToken) {
      try {
        // 既存商品を取得
        const listUrl = `https://${shopDomain}/admin/api/2024-10/products.json?status=active&limit=100&fields=id,title,handle,image`;
        const listRes = await fetch(listUrl, {
          headers: { 'X-Shopify-Access-Token': adminToken, 'Accept': 'application/json' },
        });
        if (listRes.ok) {
          const listData = await listRes.json<{
            products: Array<{ id: number; title: string; handle: string; image?: { src?: string } }>;
          }>();
          // Gemini に商品リストとプロンプトを渡して、最も合致する商品を選択させる
          const matchPrompt = `以下のメール画像生成プロンプトと商品リストから、プロンプト中で言及されている商品を最大 3 つまで選んでください。
言及されていない場合は空配列を返してください。

# プロンプト
${prompt}

# 商品リスト (id: タイトル)
${listData.products.map((p) => `${p.id}: ${p.title}`).join('\n')}

# 出力フォーマット (JSON のみ)
{ "product_ids": ["id1", "id2"] }`;
          const geminiKey = c.env.GEMINI_API_KEY;
          if (geminiKey) {
            const r = await callGemini(geminiKey, matchPrompt, true, MODEL_FLASH);
            try {
              const parsed = JSON.parse(r.text) as { product_ids?: string[] };
              const matchedIds = parsed.product_ids ?? [];
              for (const id of matchedIds.slice(0, 3)) {
                const matched = listData.products.find((p) => String(p.id) === String(id));
                if (matched?.image?.src) refUrls.push(matched.image.src);
              }
            } catch {
              /* JSON 崩れは無視 */
            }
          }
        }
      } catch (e) {
        console.error('auto_detect_product failed:', e);
      }
    }

    // 重複削除 + 上限 4 枚
    const finalRefUrls = Array.from(new Set(refUrls)).slice(0, 4);

    // ブランドトーン強化のため、プロンプトにオリゼ向け前置きを追加
    const fullPrompt = `${prompt}

# スタイル指定
- 自然光、温かみのある色調
- 米麹発酵食品ブランド「ORYZAE（オリゼ）」のメール画像
- 健康志向・誠実・上品な雰囲気
- 文字や日本語の挿入は最小限、清潔感のある構図`;

    // Gemini 3 Flash Image (= Nano Banana 2) で画像生成
    // - T2I: contents に text のみ
    // - I2I: contents に text + 参照画像（inline_data として base64 で渡す）
    let usedRefCount = 0;
    const parts: Array<
      | { text: string }
      | { inline_data: { mime_type: string; data: string } }
    > = [{ text: fullPrompt }];

    if (finalRefUrls.length > 0) {
      for (const url of finalRefUrls) {
        try {
          const imgRes = await fetch(url);
          if (!imgRes.ok) {
            console.warn(`[generate-image] reference fetch failed ${imgRes.status}: ${url}`);
            continue;
          }
          const ct = imgRes.headers.get('content-type') ?? 'image/jpeg';
          const buf = new Uint8Array(await imgRes.arrayBuffer());
          // base64 化
          let bin = '';
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          const b64 = btoa(bin);
          parts.push({ inline_data: { mime_type: ct, data: b64 } });
          usedRefCount++;
        } catch (e) {
          console.warn('[generate-image] reference fetch error:', url, e);
        }
      }
    }
    console.log(`[generate-image] Gemini ${finalRefUrls.length > 0 ? 'I2I' : 'T2I'} with ${usedRefCount} references, prompt len=${fullPrompt.length}`);

    // 品質はサイズと aspect で表現（Gemini Image はサイズ指定で品質スケール）
    const aspectRatio = size === '1024x1024' ? '1:1' : size === '1536x1024' ? '16:9' : '9:16';
    // モデル選択: flash=Nano Banana 2（速い/安い）, pro=Nano Banana Pro（高品質/4K対応/14枚参照可）
    const geminiModel = modelTier === 'pro'
      ? 'gemini-3-pro-image-preview'
      : 'gemini-3.1-flash-image-preview';
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            // TEXT も含めないと一部のレスポンスが返らないことがある
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio },
          },
        }),
      },
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[generate-image] Gemini ${resp.status}:`, text);
      return c.json({
        success: false,
        error: `Gemini ${resp.status}: ${text.slice(0, 500)}`,
        debug: {
          gemini_status: resp.status,
          model: geminiModel,
          reference_urls_attempted: finalRefUrls.length,
          reference_urls_succeeded: usedRefCount,
        },
      }, 500);
    }

    const data = await resp.json<{
      candidates?: Array<{
        content?: { parts?: Array<{ inline_data?: { mime_type?: string; data?: string }; inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    }>();
    // inline_data / inlineData どちらでも拾える
    const cParts = data.candidates?.[0]?.content?.parts ?? [];
    let imageB64: string | undefined;
    let imageMime = 'image/png';
    for (const p of cParts) {
      const inline = p.inline_data ?? p.inlineData;
      if (inline?.data) {
        imageB64 = inline.data;
        imageMime = inline.mime_type ?? inline.mimeType ?? 'image/png';
        break;
      }
    }
    if (!imageB64) {
      console.error('[generate-image] Gemini returned no image. Body:', JSON.stringify(data).slice(0, 500));
      return c.json({ success: false, error: 'Gemini response had no image data' }, 500);
    }
    const bin = atob(imageB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // R2 に保存
    const ext = imageMime.includes('jpeg') ? 'jpg' : imageMime.includes('webp') ? 'webp' : 'png';
    const id = crypto.randomUUID();
    // 注: '/' を含むキーは GET /images/:key ルートにマッチしないため、'-' で区切る
    const key = `ai-${id}.${ext}`;
    await c.env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType: imageMime },
      customMetadata: { source: 'gemini-3-flash-image', prompt: prompt.slice(0, 500) },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const imageUrl = `${workerUrl}/images/${key}`;

    // コスト概算: Flash ≈ $0.04, Pro ≈ $0.15
    const cost = modelTier === 'pro' ? 0.15 : 0.04;
    const today = new Date().toISOString().slice(0, 10);
    await c.env.DB
      .prepare(
        `INSERT INTO ai_usage_stats (date, image_calls, total_cost_usd) VALUES (?, 1, ?)
         ON CONFLICT(date) DO UPDATE SET
           image_calls = COALESCE(image_calls, 0) + 1,
           total_cost_usd = total_cost_usd + ?`,
      )
      .bind(today, cost, cost)
      .run()
      .catch(() => {/* image_calls カラム無くても続行 */});

    return c.json({
      success: true,
      data: {
        url: imageUrl,
        key,
        size,
        quality,
        cost_usd: cost,
        model: modelTier,
        model_id: geminiModel,
        used_reference: finalRefUrls.length > 0,
        reference_count: finalRefUrls.length,
      },
    });
  } catch (err) {
    console.error('[FERMENT] POST /generate-image error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

cockpitRoutes.post('/strategy/action/:actionId/decide', async (c) => {
  const actionId = c.req.param('actionId');
  const body = await c.req.json<{ status: 'approved' | 'rejected' | 'edited' | 'executed'; campaign_id?: string; user?: string }>();
  await c.env.DB
    .prepare(
      "UPDATE ai_proposal_actions SET status = ?, approved_by = ?, campaign_id = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE action_id = ?",
    )
    .bind(body.status, body.user ?? null, body.campaign_id ?? null, actionId)
    .run();
  return c.json({ success: true });
});

// ─── 2. AI チャット ─────────────────────────

cockpitRoutes.post('/chat', async (c) => {
  if (await isKilled(c.env, 'chat')) {
    return c.json({ success: false, error: 'AI chat is paused' }, 503);
  }
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);

  const body = await c.req.json<{ message: string; user?: string }>();
  if (!body.message) return c.json({ success: false, error: 'message required' }, 400);

  // 現状サマリーをコンテキストに含める
  const context = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM customers WHERE subscribed_email = 1) as subscribers,
         (SELECT COUNT(*) FROM customers WHERE purchase_probability_30d >= 0.5) as high_intent,
         (SELECT COUNT(*) FROM email_campaigns WHERE sent_at >= datetime('now', '-30 days')) as campaigns_30d,
         (SELECT COALESCE(SUM(total_sent), 0) FROM email_campaigns WHERE sent_at >= datetime('now', '-30 days')) as sent_30d,
         (SELECT COALESCE(SUM(total_attributed_revenue), 0) FROM email_campaigns WHERE sent_at >= datetime('now', '-30 days')) as revenue_30d`,
    )
    .first<Record<string, number>>();

  const prompt = `あなたはオリゼ（米麹発酵食品EC）のマーケアシスタントです。
以下の質問に、現状データを参照しながら回答してください。

# 現状（過去30日）
${JSON.stringify(context, null, 2)}

# 質問
${body.message}

# ルール
- 簡潔（300文字以内）
- 数値で根拠を示す
- 具体的なアクション提案を含める
- 親しみやすい日本語`;

  try {
    const { text, cost } = await callGemini(apiKey, prompt, false);
    const today = new Date().toISOString().slice(0, 10);
    await c.env.DB
      .prepare(
        `INSERT INTO ai_chat_history (chat_id, user_id, user_name, user_message, ai_response, ai_model, ai_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(generateFermentId('chat'), null, body.user ?? null, body.message, text, MODEL_PRO, cost)
      .run();
    await c.env.DB
      .prepare(
        `INSERT INTO ai_usage_stats (date, chat_calls, total_cost_usd) VALUES (?, 1, ?)
         ON CONFLICT(date) DO UPDATE SET
           chat_calls = chat_calls + 1,
           total_cost_usd = total_cost_usd + ?`,
      )
      .bind(today, cost, cost)
      .run();
    return c.json({ success: true, data: { response: text, cost_usd: cost } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

cockpitRoutes.get('/chat/history', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20');
  const r = await c.env.DB
    .prepare('SELECT * FROM ai_chat_history ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all();
  return c.json({ success: true, data: r.results });
});

// ─── 3. 異常検知 ───────────────────────────

cockpitRoutes.get('/anomalies/active', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT * FROM ai_anomaly_alerts WHERE resolved = 0 ORDER BY detected_at DESC LIMIT 50')
    .all();
  return c.json({ success: true, data: r.results });
});

cockpitRoutes.put('/anomalies/:id/resolve', async (c) => {
  await c.env.DB
    .prepare("UPDATE ai_anomaly_alerts SET resolved = 1, resolved_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE alert_id = ?")
    .bind(c.req.param('id'))
    .run();
  return c.json({ success: true });
});

// ─── 4. 週次振り返り ──────────────────────

cockpitRoutes.get('/weekly-report/latest', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT * FROM ai_weekly_reports ORDER BY week_start DESC LIMIT 1')
    .first();
  return c.json({ success: true, data: r });
});

cockpitRoutes.post('/weekly-report/generate', async (c) => {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setHours(0, 0, 0, 0);
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 7);

  const stats = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) as campaigns,
         COALESCE(SUM(total_sent), 0) as sent,
         COALESCE(SUM(total_opened), 0) as opened,
         COALESCE(SUM(total_clicked), 0) as clicked,
         COALESCE(SUM(total_attributed_revenue), 0) as revenue
       FROM email_campaigns WHERE sent_at >= ? AND sent_at < ?`,
    )
    .bind(weekStart.toISOString(), weekEnd.toISOString())
    .first<{ campaigns: number; sent: number; opened: number; clicked: number; revenue: number }>();

  const prevStats = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) as campaigns,
         COALESCE(SUM(total_sent), 0) as sent,
         COALESCE(SUM(total_opened), 0) as opened,
         COALESCE(SUM(total_attributed_revenue), 0) as revenue
       FROM email_campaigns WHERE sent_at >= datetime(?, '-7 days') AND sent_at < ?`,
    )
    .bind(weekStart.toISOString(), weekStart.toISOString())
    .first<{ campaigns: number; sent: number; opened: number; revenue: number }>();

  const prompt = `あなたはオリゼのマーケ責任者です。先週の振り返りレポートを書いてください。

# 先週 (${weekStart.toISOString().slice(0, 10)} 〜 ${weekEnd.toISOString().slice(0, 10)})
${JSON.stringify(stats, null, 2)}

# 前々週
${JSON.stringify(prevStats, null, 2)}

# 出力フォーマット（プレーンテキスト、HTMLなし、500文字以内）
- 良かった点（1-2項目）
- 改善が必要な点（1-2項目）
- 来週の推奨アクション（2-3項目）
- 数値で根拠を示す`;

  try {
    // 週次振り返りは事実集計が中心なので Flash で十分（コスト最適）
    const { text, cost, model } = await callGemini(apiKey, prompt, false, MODEL_FLASH);
    const reportId = generateFermentId('rep');
    await c.env.DB
      .prepare(
        `INSERT INTO ai_weekly_reports (report_id, week_start, week_end, summary, metrics_json, ai_model)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(week_start) DO UPDATE SET
           summary = excluded.summary,
           metrics_json = excluded.metrics_json,
           created_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
      )
      .bind(
        reportId,
        weekStart.toISOString().slice(0, 10),
        weekEnd.toISOString().slice(0, 10),
        text,
        JSON.stringify({ stats, prevStats }),
        MODEL_PRO,
      )
      .run();
    return c.json({ success: true, data: { summary: text, cost_usd: cost } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── 5. Kill Switch ───────────────────────

cockpitRoutes.get('/kill-switch', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM ai_kill_switch ORDER BY scope').all();
  return c.json({ success: true, data: r.results });
});

cockpitRoutes.post('/kill-switch/:scope', async (c) => {
  const scope = c.req.param('scope');
  const body = await c.req.json<{ enabled: boolean; reason?: string; user?: string }>();
  await c.env.DB
    .prepare(
      `UPDATE ai_kill_switch SET enabled = ?, reason = ?, enabled_by = ?,
         enabled_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') ELSE enabled_at END,
         disabled_at = CASE WHEN ? = 0 THEN strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') ELSE disabled_at END
       WHERE scope = ?`,
    )
    .bind(body.enabled ? 1 : 0, body.reason ?? null, body.user ?? null, body.enabled ? 1 : 0, body.enabled ? 1 : 0, scope)
    .run();
  return c.json({ success: true });
});

// ─── 7. Gemini 新モデル登録一覧 ──────────────

cockpitRoutes.get('/models/registry', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT * FROM ai_model_registry ORDER BY first_discovered_at DESC')
    .all();
  return c.json({ success: true, data: r.results });
});

cockpitRoutes.post('/models/check-now', async (c) => {
  // 手動で新モデル検知トリガー
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 503);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!r.ok) return c.json({ success: false, error: `Gemini ${r.status}` }, 500);
  const data = await r.json<{ models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> }>();
  const liveModels = (data.models ?? [])
    .filter((m) => m.name?.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace('models/', ''));

  const newOnes: string[] = [];
  for (const name of liveModels) {
    const existing = await c.env.DB
      .prepare('SELECT model_name FROM ai_model_registry WHERE model_name = ?')
      .bind(name)
      .first();
    if (!existing) {
      await c.env.DB
        .prepare('INSERT INTO ai_model_registry (model_name, supported_methods) VALUES (?, ?)')
        .bind(name, JSON.stringify([]))
        .run();
      newOnes.push(name);
    }
  }
  return c.json({ success: true, data: { total_live: liveModels.length, new_discovered: newOnes } });
});

// ─── 6. AI 利用統計 ────────────────────────

cockpitRoutes.get('/usage', async (c) => {
  const days = parseInt(c.req.query('days') ?? '30');
  const r = await c.env.DB
    .prepare("SELECT * FROM ai_usage_stats WHERE date >= date('now', ? || ' days') ORDER BY date DESC")
    .bind(`-${days}`)
    .all();
  const totals = await c.env.DB
    .prepare("SELECT SUM(total_cost_usd) as total_cost, SUM(strategy_calls + chat_calls + subject_calls + body_calls) as total_calls FROM ai_usage_stats WHERE date >= date('now', ? || ' days')")
    .bind(`-${days}`)
    .first();
  return c.json({ success: true, data: { daily: r.results, totals } });
});
