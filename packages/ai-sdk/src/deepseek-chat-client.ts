/**
 * LINE AI Chatbot: Gemini 3.6 Flash クライアント
 *
 * LINEの顧客メッセージに対してAIが一次対応する。
 * - FAQ・定型質問は自動応答
 * - 返金・クレーム・複雑な問い合わせはエスカレーション
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
  /** 意図分類 */
  intent: 'faq' | 'recommend' | 'refund' | 'greeting' | 'escalate' | 'other';
  /** AIが対応したか（false = エスカレーション必要） */
  handled: boolean;
  /** エスカレーション理由（handled=falseの場合） */
  escalateReason?: string;
}

/**
 * Gemini 3.6 Flash に問い合わせ、構造化応答を得る
 *
 * @param apiKey Gemini API キー
 * @param systemPrompt システムプロンプト
 * @param messages 会話履歴（現在は直近1件のみ）
 * @param options オプション（temperature, maxTokens）
 * @returns 構造化応答（reply, intent, handled）
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
    response_format: { type: 'json_object' },
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
      return fallbackResponse('escalate', `API error: ${res.status}`);
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
      return fallbackResponse('escalate', 'Empty response');
    }

    // JSONパース
    let parsed: {
      reply?: string;
      intent?: string;
      handled?: boolean;
      escalate_reason?: string;
    };
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('[line-cs-gemini] JSON parse failed:', content.slice(0, 200));
      return {
        reply: content,
        intent: 'other',
        handled: true,
      };
    }

    // バリデーション
    const intent = validateIntent(parsed.intent);
    const handled = parsed.handled === true;

    if (!handled) {
      return {
        reply: parsed.reply ?? '担当者におつなぎします。少々お待ちください。',
        intent,
        handled: false,
        escalateReason: parsed.escalate_reason ?? 'AIが対応不可と判定',
      };
    }

    return {
      reply: parsed.reply ?? '',
      intent,
      handled: true,
    };
  } catch (err) {
    console.error('[line-cs-gemini] exception:', err);
    return fallbackResponse('escalate', `Exception: ${String(err)}`);
  }
}

function validateIntent(intent?: string): ChatResponse['intent'] {
  const validIntents = ['faq', 'recommend', 'refund', 'greeting', 'escalate', 'other'] as const;
  if (intent && validIntents.includes(intent as ChatResponse['intent'])) {
    return intent as ChatResponse['intent'];
  }
  return 'other';
}

function fallbackResponse(intent: ChatResponse['intent'], reason: string): ChatResponse {
  return {
    reply: '',
    intent,
    handled: false,
    escalateReason: reason,
  };
}
