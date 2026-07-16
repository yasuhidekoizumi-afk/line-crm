/**
 * Rakuten メルマガ Harness API
 *
 * エンドポイント:
 *   GET  /api/rakuten-mailmag/dashboard          - 売上ダッシュボード（KPI・日別・ランキング）
 *   POST /api/rakuten-mailmag/generate            - AI メルマガドラフト生成
 *   GET  /api/rakuten-mailmag/campaigns           - 配信履歴一覧
 *   GET  /api/rakuten-mailmag/campaigns/:id       - 個別キャンペーン
 *   POST /api/rakuten-mailmag/campaigns            - 配信記録を保存（配信後）
 *   POST /api/rakuten-mailmag/measure/:id          - 効果測定（配信日の売上を計算）
 *   GET  /api/rakuten-mailmag/events              - 楽天イベントカレンダー
 *
 * SDK: @line-crm/rakuten-sdk (RmsRestClient)
 * Migration: 064_rakuten_mailmag.sql
 */
import { Hono } from 'hono';
import { RmsRestClient } from '@line-crm/rakuten-sdk';
import type { Env } from '../index.js';

export const rakutenMailmag = new Hono<Env>();

// ─── Helper: RMS REST クライアント生成 ─────────

function getRestClient(env: Env['Bindings']): RmsRestClient {
  if (!env.RAKUTEN_SERVICE_SECRET || !env.RAKUTEN_LICENSE_KEY) {
    throw new Error('RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY が設定されていません');
  }
  return new RmsRestClient({
    serviceSecret: env.RAKUTEN_SERVICE_SECRET,
    licenseKey: env.RAKUTEN_LICENSE_KEY,
  });
}

// ─── ダッシュボード ─────────────────────────────

rakutenMailmag.get('/api/rakuten-mailmag/dashboard', async (c) => {
  try {
    const days = parseInt(c.req.query('days') ?? '30', 10);
    const client = getRestClient(c.env);
    const data = await client.getDashboardData(days);

    // 直近14日分の日別データ + ランキングTOP15
    const recentDaily = data.dailySales.slice(-14);
    const topRanking = data.productRanking.slice(0, 15);

    return c.json({
      success: true,
      data: {
        kpi: data.kpi,
        baseline: data.baseline,
        dailySales: recentDaily,
        productRanking: topRanking,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('GET /api/rakuten-mailmag/dashboard error:', e);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── AI メルマガ生成 ────────────────────────────

rakutenMailmag.post('/api/rakuten-mailmag/generate', async (c) => {
  try {
    const body = await c.req.json<{
      pattern: 'event_day' | 'event_eve' | 'normal' | 'stock_clear';
      products: { itemNumber: string; name: string; reason?: string }[];
      tone: 'daily' | 'gift' | 'health' | 'ferment';
      extraNotes?: string;
    }>();

    // 売上データを取得してコンテキストに含める
    const client = getRestClient(c.env);
    const dashboard = await client.getDashboardData(30);

    const topProductsStr = dashboard.productRanking
      .slice(0, 10)
      .map((p, i) => `${i + 1}. ${p.itemName} (${p.qty}個 / ¥${p.revenue.toLocaleString()} / 平均¥${p.avgPrice.toLocaleString()})`)
      .join('\n');

    const dailyTrendStr = dashboard.dailySales
      .slice(-14)
      .map((d) => `${d.date}: ${d.orders}件 ¥${d.revenue.toLocaleString()}`)
      .join('\n');

    const baselineRev = dashboard.baseline.avgDailyRevenue;
    const productsStr = body.products
      .map((p) => `- ${p.name}${p.reason ? `（${p.reason}）` : ''}`)
      .join('\n');

    const patternLabels: Record<string, string> = {
      event_day: '楽天お買い物マラソン等のイベント当日',
      event_eve: 'イベント前日予告',
      normal: '通常配信（平日）',
      stock_clear: '在庫整理（賞味期限間近）',
    };

    const toneLabels: Record<string, string> = {
      daily: '日常使い（朝食シーン中心）',
      gift: 'ギフト・帰省土産',
      health: '健康志向（腸活・糖質オフ）',
      ferment: '麹のチカラ（発酵食）',
    };

    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'GEMINI_API_KEYが設定されていません' });
    }

    const prompt = `あなたは楽天市場の出店運営者です。「ORYZAE（オリゼ）」の米麹発酵食品を販売しています。

以下の売上データと訴求商品をもとに、楽天市場のメルマガ（HTML形式）を作成してください。

【配信パターン】${patternLabels[body.pattern] ?? body.pattern}
【切り口・トーン】${toneLabels[body.tone] ?? body.tone}
${body.extraNotes ? `【追加要望】${body.extraNotes}` : ''}

【訴求商品】
${productsStr}

【過去30日の売上位（参考）】
${topProductsStr}

【直近14日の日別売上（参考）】
${dailyTrendStr}
平常日平均売上: ¥${baselineRev.toLocaleString()}

【絶対守るルール】
- 件名を3パターン提案する（異なる切り口で）
- 本文は500〜800文字（長すぎない）
- ORYZAEのブランドトーン: 素直で誠実。売り込みすぎない。商品への想いは残す。
- 「次に〜をご紹介します」「ここまでで〜はお伝えしました」等、本文自身の進行や構成を実況する文は絶対禁止
- 「簡単に」「お気軽に」「ぜひ」「おすすめ」「人気」「大好評」は使わない
- 「ORYZAEの小泉です」で始める
- メルマガ読者は楽天で購入したことがあるリピーター層
- HTMLタグを使う（h2, p, strong, a）ただし過度な装飾はしない
- 最後に商品ページへのリンクCTAを入れる
- 景表法に注意：効果・効能を医薬品的に表現しない（「腸活」「健康」は食材としての文脈のみOK）

以下のJSONフォーマットで返してください:
{
  "subjects": ["件名A", "件名B", "件名C"],
  "preheader": "プレテキスト（件名の後に表示される短い文）",
  "bodyHtml": "<h2>...</h2><p>...</p>...",
  "bodyText": "プレーンテキスト版"
}`;

    const MODEL = 'gemini-2.5-flash';
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 4000,
          },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return c.json({ success: false, error: `Gemini API error (${res.status}): ${errText.slice(0, 300)}` });
    }

    const geminiData = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    if (!rawText) {
      return c.json({ success: false, error: 'Geminiからの返答が空でした' });
    }

    // JSONを抽出（Geminiは```json ... ```で囲むことがある）
    let parsed: { subjects: string[]; preheader: string; bodyHtml: string; bodyText: string };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      // JSONパース失敗時は生テキストを返す
      return c.json({
        success: true,
        data: {
          subjects: ['（件名の自動生成に失敗しました。手動で入力してください）'],
          preheader: '',
          bodyHtml: `<p>${rawText.replace(/\n/g, '<br>')}</p>`,
          bodyText: rawText,
          raw: rawText,
        },
      });
    }

    // ドラフトをDBに保存
    const draftId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO rakuten_mailmag_drafts (id, pattern, products_json, subject_candidates_json, body_html, body_text, preheader, tone, data_context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        draftId,
        body.pattern,
        JSON.stringify(body.products),
        JSON.stringify(parsed.subjects),
        parsed.bodyHtml,
        parsed.bodyText,
        parsed.preheader ?? '',
        body.tone,
        JSON.stringify({ topProducts: topProductsStr, baselineRev }),
      )
      .run();

    return c.json({
      success: true,
      data: {
        draftId,
        subjects: parsed.subjects,
        preheader: parsed.preheader ?? '',
        bodyHtml: parsed.bodyHtml,
        bodyText: parsed.bodyText,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('POST /api/rakuten-mailmag/generate error:', e);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── キャンペーン履歴 ──────────────────────────

rakutenMailmag.get('/api/rakuten-mailmag/campaigns', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM rakuten_mailmag_campaigns ORDER BY send_date DESC LIMIT ?`,
    )
      .bind(limit)
      .all();

    return c.json({ success: true, data: rows.results });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── キャンペーン保存（配信記録） ──────────────

rakutenMailmag.post('/api/rakuten-mailmag/campaigns', async (c) => {
  try {
    const body = await c.req.json<{
      sendDate: string;
      subject: string;
      preheader?: string;
      bodyHtml?: string;
      bodyText?: string;
      pattern: string;
      products?: { itemNumber: string; name: string }[];
      tone?: string;
      notes?: string;
    }>();

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO rakuten_mailmag_campaigns (id, send_date, subject, preheader, body_html, body_text, pattern, products_json, tone, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        body.sendDate,
        body.subject,
        body.preheader ?? '',
        body.bodyHtml ?? '',
        body.bodyText ?? '',
        body.pattern,
        JSON.stringify(body.products ?? []),
        body.tone ?? '',
        body.notes ?? '',
      )
      .run();

    return c.json({ success: true, data: { id } });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─── 効果測定（配信日の売上を自動計算） ─────────

rakutenMailmag.post('/api/rakuten-mailmag/measure/:id', async (c) => {
  try {
    const campaignId = c.req.param('id');
    const campaign = await c.env.DB.prepare(
      `SELECT * FROM rakuten_mailmag_campaigns WHERE id = ?`,
    )
      .bind(campaignId)
      .first<{ send_date: string }>();

    if (!campaign) {
      return c.json({ success: false, error: 'キャンペーンが見つかりません' }, 404);
    }

    const client = getRestClient(c.env);

    // 配信日の売上を取得
    const dayResult = await client.getDailySales(campaign.send_date);

    // 平常日ベースライン（直近30日の中央値）
    const dashboard = await client.getDashboardData(30);
    const baseline = dashboard.baseline.avgDailyRevenue;

    // リフト率
    const liftPct = baseline > 0 ? ((dayResult.revenue / baseline) - 1) * 100 : 0;

    // 効果スコア
    let score: string;
    if (liftPct >= 500) score = '★★★★★';
    else if (liftPct >= 200) score = '★★★★☆';
    else if (liftPct >= 50) score = '★★★☆☆';
    else if (liftPct >= 10) score = '★★☆☆☆';
    else score = '★☆☆☆☆';

    const topProduct = dayResult.topProducts[0]?.name ?? '';

    await c.env.DB.prepare(
      `UPDATE rakuten_mailmag_campaigns
       SET orders_on_day = ?, revenue_on_day = ?, baseline_avg = ?, lift_pct = ?, top_product = ?, effect_score = ?, measured_at = ?
       WHERE id = ?`,
    )
      .bind(
        dayResult.orders,
        dayResult.revenue,
        baseline,
        Math.round(liftPct * 10) / 10,
        topProduct,
        score,
        new Date().toISOString(),
        campaignId,
      )
      .run();

    return c.json({
      success: true,
      data: {
        ordersOnDay: dayResult.orders,
        revenueOnDay: dayResult.revenue,
        baselineAvg: baseline,
        liftPct: Math.round(liftPct * 10) / 10,
        topProduct,
        effectScore: score,
        topProducts: dayResult.topProducts,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('POST /api/rakuten-mailmag/measure error:', e);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ─── 楽天イベントカレンダー ────────────────────

rakutenMailmag.get('/api/rakuten-mailmag/events', async (c) => {
  // 5と0のつく日 + 月次SALEを計算（現在から60日先まで）
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJst = new Date(now.getTime() + jstOffset);
  const events: { date: string; name: string; type: string }[] = [];

  for (let i = 0; i < 60; i++) {
    const d = new Date(nowJst.getTime() + i * 24 * 60 * 60 * 1000);
    const day = d.getUTCDate();
    const lastDigit = day % 10;
    if (lastDigit === 5 || lastDigit === 0) {
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      events.push({ date: dateStr, name: 'お買い物マラソン（5と0のつく日）', type: 'marathon' });
    }
  }

  // 次の楽天スーパーSALE（概ね月1回、月初〜中旬。正確な日程はRMS公告待ちだが目安として8日頃）
  const yyyy = nowJst.getUTCFullYear();
  const mm = nowJst.getUTCMonth();
  for (let offset = 0; offset < 2; offset++) {
    const targetMonth = mm + offset;
    const targetYear = yyyy + Math.floor(targetMonth / 12);
    const realMonth = targetMonth % 12;
    const saleDate = new Date(Date.UTC(targetYear, realMonth, 8));
    if (saleDate.getTime() >= now.getTime()) {
      const dateStr = `${targetYear}-${String(realMonth + 1).padStart(2, '0')}-08`;
      events.push({ date: dateStr, name: '楽天スーパーSALE（予定日）', type: 'super_sale' });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  return c.json({ success: true, data: events });
});
