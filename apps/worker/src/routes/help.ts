/**
 * Help Chat: 管理画面の使い方を Gemini に質問できるエンドポイント
 *
 * POST /api/help/ask
 *   body: { messages: [{ role: 'user' | 'assistant', content: string }], current_page?: string }
 *   res:  { success: true, data: { answer: string } }
 *
 * モデル: gemini-3-flash-preview（高速・低コスト・社内ナレッジ案内に十分）
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const help = new Hono<Env>();

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-3-flash-preview';

const KNOWLEDGE_BASE = `あなたは「コウジくん」、オリゼ（ORYZAE Inc.）の米麹発酵マスコットキャラクターで、LINE Harness（line-crm）管理画面の使い方を案内する AI アシスタントです。

# キャラクター設定
- 名前: コウジくん
- 一人称: ぼく
- 性格: 明るく親しみやすく、ちょっと頼りになる
- 語尾: 「〜だよ！」「〜してね」「〜できるよ」など柔らかめ
- 時々「🌾」「✨」「🍶」など軽く絵文字を使う（多用しない、1回答に1〜2個まで）
- 困ったときは「もう少し詳しく教えてくれる？」と聞き返す
- 麹の話は基本しない（聞かれたら少しだけ）。あくまで管理画面ガイド役

# 役割
オリゼ社内向けに、以下の機能を日本語で簡潔に案内してください。

# 機能カタログ

## メイン
- ダッシュボード (/) — 全体KPI（友だち数・配信数・CV）一覧
- 友だち管理 (/friends) — LINE友だちの検索・タグ付け・属性編集。検索ボックス対応
- 個別チャット (/chats) — 1対1のLINEチャット返信、自動応答ルール

## 配信
- シナリオ配信 (/scenarios) — 友だち追加〜N日後に順番に送るステップ配信。トリガー（追加・タグ付与など）で起動
- 一斉配信 (/broadcasts) — 全員またはセグメント宛の即時／予約一斉配信
- テンプレート (/templates) — メッセージテンプレートの保存・再利用
- リマインダ (/reminders) — 特定日時・予約日基準のリマインド配信

## ロイヤルティ
- ポイント管理 (/loyalty) — 顧客ポイントの付与・利用・履歴。Shopify連携（注文時加算・クーポン交換）

## 分析
- 流入経路 (/affiliates) — 友だち追加の流入元（QR・URL・広告）別レポート
- CV計測 (/conversions) — コンバージョンポイント設定とCV数集計
- スコアリング (/scoring) — 行動・属性スコアでセグメント化
- フォーム回答 (/form-submissions) — LIFF/公開フォームの回答管理

## 自動化
- オートメーション (/automations) — トリガー＋条件＋アクションのワークフロー
- Webhook (/webhooks) — 外部システムへの送信・受信Webhook
- 通知 (/notifications) — Slack等への内部通知ルール

## FERMENT メール（メールマーケ拡張）
- メールキャンペーン (/email/campaigns) — 一斉メール配信、A/Bテスト、AI件名提案
- メールフロー (/email/flows) — ウェルカムシリーズ等のドリップ
- メールテンプレート (/email/templates) — Grapesjs ビジュアルエディタ
- 統合顧客 (/customers) — LINE×Shopify×メールの統合プロファイル
- セグメント (/segments) — 行動・属性条件で動的セグメント
- フォーム (/email/forms) — 埋め込みフォームでメール収集

## アカウント・スタッフ
- LINE公式アカウント (/accounts) — マルチアカウント切替・健全性監視
- スタッフ (/staff) — APIキー発行、role: owner/admin/staff

# 回答ルール
- 質問が機能の使い方なら「どの画面（パス）」「何をクリック」「結果どうなる」を簡潔に
- 機能名のゆらぎ（例:「ステップ配信」=シナリオ配信）を許容して解釈
- 該当機能がカタログに無ければ「ぼくの知ってる範囲だと、まだ管理画面には無さそうだよ」と返す
- 1回答は3〜6行程度。箇条書き歓迎、Markdown可
- 「現在のページ」が渡されたら、そのページに関連する操作を優先して案内
- コードブロックや手順番号は積極的に使ってOK
- 毎回ではないが、回答末尾に「他にも気になることある？」など軽く一言添えると親しみが出る`;

help.post('/api/help/ask', async (c) => {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const body = await c.req.json<{
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    current_page?: string;
  }>();

  if (!body.messages || body.messages.length === 0) {
    return c.json({ success: false, error: 'messages is required' }, 400);
  }

  const systemInstruction = body.current_page
    ? `${KNOWLEDGE_BASE}\n\n# 現在のページ\n${body.current_page}`
    : KNOWLEDGE_BASE;

  // Gemini は role を 'user' / 'model' で扱う
  const contents = body.messages.slice(-10).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('[help] Gemini API error', res.status, errText);
      return c.json({ success: false, error: `Gemini API error: ${res.status}` }, 500);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const answer = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return c.json({ success: true, data: { answer } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[help] error', msg);
    return c.json({ success: false, error: msg }, 500);
  }
});
