/**
 * チャットの最終メッセージが「返信を要する問い合わせ」か「お礼・クロージング」かを判定する。
 *
 * 背景: LINE公式アカウント管理画面（PC）で返信している運用では、Messaging API から
 * 「自分が送った返信」を取得できない。そのため未読数・経過日数は返信状況を表さない
 * （実測で236会話中226会話にハーネス側の返信記録が無かった）。
 * そこで顧客の最終メッセージの意味だけを判定し、人が見るべき候補を絞る。
 *
 * 注意: 文面の語だけでは「お礼」と「依頼」を区別できない（依頼文も『よろしくお願いします』で
 * 終わる）。実データで「締め表現かつ要対応語なし」の11件に「一時停止の依頼」「住所変更」
 * 「注文金額修正」が混ざったため、意味判定をここで行う。
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-3.6-flash';

export type ChatIntent = 'needs_reply' | 'closing' | 'unclear';

export interface ChatIntentInput {
  /** 顧客の最終メッセージ本文 */
  lastMessage: string;
  /** 直前のやりとり（古い→新しい順、各120文字まで） */
  previousContext?: string[];
  customerName?: string | null;
}

export interface ChatIntentResult {
  intent: ChatIntent;
  reason: string;
  confidence: number;
}

const PROMPT_RULES = `あなたは顧客対応の仕分け担当です。顧客の「最後のメッセージ」を見て、
こちらがこれから何か返す必要があるかだけを判定してください。

# 判定
- needs_reply: 顧客がまだ何かを求めている（質問・依頼・手続き・苦情・確認）
  例: 解約したい / 退会希望 / 返金してほしい / 住所を変更したい / 在庫はありますか /
      届きません / 決済エラーになった / 注文番号123をキャンセルしたい / これで合っていますか
- closing: 顧客側はもう求めていない（お礼・承知・完了報告・締めの挨拶）
  例: ありがとうございました / 承知しました / 返信不要です / 助かりました / 対応いただき感謝します
- unclear: 文脈不足で判断できない（1語だけ、記号だけ、引用のみ等）

# 重要な注意
- 文末が「よろしくお願いします」「よろしくお願いいたします」でも、本文が依頼なら needs_reply。
- 「ありがとうございます」の後に新しい依頼が続く場合は needs_reply。
- こちらが既に返信したかは判定しない（判定できない）。顧客が次に何を求めているかだけを見る。

# 出力
JSONのみ: {"intent":"needs_reply|closing|unclear","reason":"40文字以内の根拠","confidence":0.0-1.0}`;

function buildPrompt(input: ChatIntentInput): string {
  const ctx = (input.previousContext ?? [])
    .slice(-3)
    .map((line, i) => `${i + 1}. ${line.slice(0, 120)}`)
    .join('\n');
  return `${PROMPT_RULES}

【顧客名】${input.customerName ?? '不明'}
【直前のやりとり（古い順）】
${ctx || '（なし）'}
【顧客の最後のメッセージ】
${input.lastMessage.slice(0, 600)}`;
}

/**
 * 最終メッセージの意図を判定する。API失敗時は unclear を返す（誤って closing にしない）。
 */
export async function classifyChatIntent(
  apiKey: string,
  input: ChatIntentInput,
): Promise<ChatIntentResult> {
  const fallback: ChatIntentResult = {
    intent: 'unclear',
    reason: 'AI判定に失敗',
    confidence: 0,
  };
  if (!input.lastMessage.trim()) return { intent: 'closing', reason: 'メッセージなし', confidence: 0.5 };

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(input) }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: 'application/json',
          },
        }),
      },
    );

    if (!res.ok) {
      console.error('[ai-sdk] classifyChatIntent API error', res.status, (await res.text()).slice(0, 300));
      return fallback;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return fallback;

    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback;

    const parsed = JSON.parse(match[0]) as { intent?: string; reason?: string; confidence?: number };
    const intent: ChatIntent =
      parsed.intent === 'needs_reply' || parsed.intent === 'closing' || parsed.intent === 'unclear'
        ? parsed.intent
        : 'unclear';
    return {
      intent,
      reason: (parsed.reason ?? '').slice(0, 120),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
  } catch (err) {
    console.error('[ai-sdk] classifyChatIntent exception', err);
    return fallback;
  }
}
