/**
 * CS Phase 1: AIトリアージエンジン
 *
 * 受信メッセージを Gemini 3 Flash Preview で分類し、L1/L2/L3 を判定。
 * - L1: FAQ完全一致 → 即返信テキスト生成
 * - L2: 文脈付き下書き生成 → 承認キュー
 * - L3: 人間にエスカレーション
 *
 * 金銭関連キーワードが含まれる場合は L1 を強制的に L2 へ降格（自動送信禁止）。
 *
 * 設計書: docs/CS_PHASE1_DESIGN.md
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-3-flash-preview';

// Gemini 3 Flash Preview 想定単価（USD per 1M tokens）。実際は最新価格を確認のこと。
const PRICE_INPUT_USD_PER_1M = 0.075;
const PRICE_OUTPUT_USD_PER_1M = 0.3;
const USD_TO_JPY = 150;

export const MONEY_KEYWORDS = [
  '返金', '返品', '交換', 'キャンセル', '解約', '取り消し', '取消',
  '請求', '料金', '価格', '値段', '支払', '決済', '引き落とし', '引落',
  '破損', '不良', '異物', '腐', 'カビ', 'おかし', '変な味', '体調',
  '弁護士', '消費者センター', '訴', '法的', 'クレーム',
];

export type TriageLevel = 'L1' | 'L2' | 'L3';
export type TriageCategory =
  | 'faq'
  | 'order_status'
  | 'refund'
  | 'complaint'
  | 'product_question'
  | 'other';

export interface FaqLite {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string | null;
  l1_eligible: number;
}

export interface CsCustomerContext {
  name?: string | null;
  email?: string | null;
  ltv?: number | null;
  recent_orders?: Array<{ name: string; ordered_at: string; status?: string }>;
  past_chats_summary?: string | null;
}

export interface TriageInput {
  messageText: string;
  subject?: string | null;
  customer?: CsCustomerContext;
  faqs: FaqLite[];
}

export interface TriageResult {
  level: TriageLevel;
  category: TriageCategory;
  confidence: number;
  matched_faq_id: string | null;
  money_flag: boolean;
  reasoning: string;
  draft_text: string | null; // L1/L2の場合のみ
  prompt_tokens: number;
  completion_tokens: number;
  cost_jpy: number;
}

// ===== 金銭キーワード検出（決定論的） =====

export function detectMoneyKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return MONEY_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

// ===== Geminiトリアージ =====

export async function triageMessage(
  apiKey: string,
  input: TriageInput,
): Promise<TriageResult> {
  const moneyFlag = detectMoneyKeywords(`${input.subject ?? ''}\n${input.messageText}`);

  const faqList = input.faqs
    .map((f, i) => `[${i + 1}] id=${f.id} cat=${f.category} | Q: ${f.question} | A: ${f.answer.slice(0, 150)}`)
    .join('\n');

  const customerBlock = input.customer
    ? `【顧客情報】
- お名前: ${input.customer.name ?? '不明'}
- メール: ${input.customer.email ?? '不明'}
- LTV: ${input.customer.ltv != null ? `¥${input.customer.ltv.toLocaleString()}` : '不明'}
- 最近の購入: ${input.customer.recent_orders?.slice(0, 3).map((o) => o.name).join(', ') ?? '無し'}
- 過去対応: ${input.customer.past_chats_summary ?? '無し'}`
    : '【顧客情報】不明（新規 or 未紐付け）';

  const prompt = `あなたは株式会社オリゼ（米麹発酵フードテック）のCS担当AIです。
以下の問い合わせを分類し、対応レベル（L1/L2/L3）と返信文を生成してください。

${customerBlock}

【利用可能なFAQ知識ベース】
${faqList || '（FAQ未登録）'}

【今回の問い合わせ】
件名: ${input.subject ?? '（件名なし）'}
本文:
${input.messageText.slice(0, 3000)}

【分類ルール】
- L1（自動返信可）: FAQに完全一致する内容で、金銭・配送個別事情・苦情を含まない
- L2（下書き → 人間承認）: 顧客個別の文脈が必要、または下書きで人間判断が望ましい
- L3（人間エスカレ）: 苦情・異物混入・法的脅威・複雑な返金交渉など、AIが対応すべきでない

【カテゴリ】
- faq: 一般的なよくある質問
- order_status: 注文・配送状況の問い合わせ
- refund: 返金・交換・キャンセル
- complaint: 苦情・クレーム
- product_question: 商品仕様・使い方の質問
- other: その他

【返信文ルール】
- 丁寧な日本語、敬体
- 「オリゼ カスタマーサポート」を名乗る
- L3の場合は draft_text を null にする
- L1/L2は完全な返信文を生成（顧客名がわかれば「○○様」で始める）

JSON形式で返答（説明文不要、JSON以外何も書かない）:
{
  "level": "L1" | "L2" | "L3",
  "category": "faq" | "order_status" | "refund" | "complaint" | "product_question" | "other",
  "confidence": 0.0-1.0,
  "matched_faq_id": "string or null",
  "reasoning": "判定理由を1文で",
  "draft_text": "返信文 or null"
}`;

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('[cs-triage] Gemini API error', res.status, text);
      return fallbackResult(moneyFlag, 'Gemini API error');
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      console.error('[cs-triage] Gemini empty response', JSON.stringify(data).slice(0, 300));
      return fallbackResult(moneyFlag, 'Gemini empty response');
    }

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsed: {
      level?: string;
      category?: string;
      confidence?: number;
      matched_faq_id?: string | null;
      reasoning?: string;
      draft_text?: string | null;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[cs-triage] JSON parse failed:', cleaned.slice(0, 300), e);
      return fallbackResult(moneyFlag, 'JSON parse failed');
    }

    let level = (parsed.level as TriageLevel) || 'L2';
    if (!['L1', 'L2', 'L3'].includes(level)) level = 'L2';

    // 金銭キーワード検出時はL1を禁止
    if (moneyFlag && level === 'L1') level = 'L2';

    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    const costUsd =
      (promptTokens * PRICE_INPUT_USD_PER_1M + completionTokens * PRICE_OUTPUT_USD_PER_1M) / 1_000_000;
    const costJpy = Math.round(costUsd * USD_TO_JPY * 100) / 100;

    return {
      level,
      category: (['faq', 'order_status', 'refund', 'complaint', 'product_question', 'other'].includes(parsed.category ?? '')
        ? parsed.category
        : 'other') as TriageCategory,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      matched_faq_id: parsed.matched_faq_id ?? null,
      money_flag: moneyFlag,
      reasoning: parsed.reasoning ?? '',
      draft_text: level === 'L3' ? null : (parsed.draft_text ?? null),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost_jpy: costJpy,
    };
  } catch (err) {
    console.error('[cs-triage] exception:', err);
    return fallbackResult(moneyFlag, String(err));
  }
}

function fallbackResult(moneyFlag: boolean, reason: string): TriageResult {
  return {
    level: 'L2', // 失敗時は安全側でL2
    category: 'other',
    confidence: 0,
    matched_faq_id: null,
    money_flag: moneyFlag,
    reasoning: `AI判定失敗: ${reason}`,
    draft_text: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_jpy: 0,
  };
}
