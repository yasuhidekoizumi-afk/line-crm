/**
 * LINE AI Chatbot: Gemini 3.6 Flash クライアント
 *
 * LINEの顧客メッセージに対してAIが一次対応する。
 * - FAQ・定型質問は自動応答（プレーンテキスト）
 * - 返金・クレーム等は[ESCALATE]プレフィックスで判定
 *
 * モデル: gemini-3.6-flash（ネイティブGemini API、thinking抑制）
 * 料金: $0.50/1M 入力, $3.00/1M 出力
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  /** AIが生成した応答テキスト */
  reply: string;
  /** AIが対応したか（false = [ESCALATE]検出） */
  handled: boolean;
  /** エスカレーション理由（handled=falseの場合） */
  escalateReason?: string;
}

/**
 * Gemini 3.6 Flash に問い合わせ、プレーンテキスト応答を得る
 */
export async function chatWithDeepSeek(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<ChatResponse> {
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens ?? 500;
  const userMessage = messages[messages.length - 1]?.content ?? '';

  try {
    const res = await fetch(`${GEMINI_API_BASE}/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[line-cs-gemini] API error', res.status, errText.slice(0, 300));
      return fallbackResponse(`API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) {
      console.error('[line-cs-gemini] empty response', JSON.stringify(data).slice(0, 200));
      return fallbackResponse('Empty response');
    }

    // [ESCALATE] プレフィックス判定
    if (content.startsWith('[ESCALATE]')) {
      return {
        reply: content.replace(/^\[ESCALATE\]\s*/, ''),
        handled: false,
        escalateReason: content.replace(/^\[ESCALATE\]\s*/, '').slice(0, 100),
      };
    }

    return { reply: content, handled: true };
  } catch (err) {
    console.error('[line-cs-gemini] exception:', err);
    return fallbackResponse(`Exception: ${String(err)}`);
  }
}

function fallbackResponse(reason: string): ChatResponse {
  return { reply: '申し訳ございません。ただいま確認しております。少々お待ちください。', handled: false, escalateReason: reason };
}
