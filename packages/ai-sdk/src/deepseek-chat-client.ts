/**
 * LINE AI Chatbot: Gemini 3.6 Flash クライアント
 *
 * LINEの顧客メッセージに対してAIが一次対応する。
 * - FAQ・定型質問は自動応答（プレーンテキスト）
 * - 返金・クレーム等はエスカレーション（detectMoneyKeywordsで事前判定済み）
 *
 * モデル: gemini-3.6-flash（OpenAI互換API経由）
 * 料金: $1.50/1M 入力, $7.50/1M 出力
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  /** AIが生成した応答テキスト */
  reply: string;
  /** AIが対応したか（false = エスカレーション必要） */
  handled: boolean;
  /** エスカレーション理由（handled=falseの場合） */
  escalateReason?: string;
}

/**
 * Gemini 3.6 Flash に問い合わせ、プレーンテキスト応答を得る
 *
 * @param apiKey Gemini API キー
 * @param systemPrompt システムプロンプト
 * @param messages 会話履歴（現在は直近1件のみ）
 * @param options オプション（temperature, maxTokens）
 * @returns 応答（reply, handled）
 */
export async function chatWithDeepSeek(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<ChatResponse> {
  const temperature = options?.temperature ?? 0.3;
  const maxTokens = options?.maxTokens ?? 500;

  const requestBody = {
    model: 'gemini-3.6-flash',
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  };

  try {
    const res = await fetch(`${GEMINI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[line-cs-gemini] API error', res.status, errText.slice(0, 300));
      return fallbackResponse(`API error: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.error('[line-cs-gemini] empty response', JSON.stringify(data).slice(0, 200));
      return fallbackResponse('Empty response');
    }

    // プレーンテキスト応答 — JSONパース不要
    // エスカレーション判定はシステムプロンプトで指示し、
    // "[ESCALATE]" プレフィックスで判定
    if (content.startsWith('[ESCALATE]')) {
      return {
        reply: content.replace(/^\[ESCALATE\]\s*/, ''),
        handled: false,
        escalateReason: content.replace(/^\[ESCALATE\]\s*/, '').slice(0, 100),
      };
    }

    return {
      reply: content,
      handled: true,
    };
  } catch (err) {
    console.error('[line-cs-gemini] exception:', err);
    return fallbackResponse(`Exception: ${String(err)}`);
  }
}

function fallbackResponse(reason: string): ChatResponse {
  return {
    reply: '',
    handled: false,
    escalateReason: reason,
  };
}
