import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import type { Env } from '../index.js';

const aiDraft = new Hono<Env>();
aiDraft.use('/api/ai-draft/*', authMiddleware);

aiDraft.post('/api/ai-draft/generate', async (c) => {
  try {
    const { chatId, chatHistory } = await c.req.json<{
      chatId?: string;
      chatHistory?: { direction: string; content: string }[];
    }>();

    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'GEMINI_API_KEYが設定されていません。Workerの環境変数を確認してください。' });
    }

    const contextLines = (chatHistory ?? []).slice(-10).map((m) =>
      `${m.direction === 'incoming' ? '顧客' : 'オペレーター'}: ${m.content.slice(0, 200)}`
    ).join('\n');

    const prompt = `あなたはECサイト「ORYZAE（オリゼ）」のカスタマーサポート担当です。
米麹発酵食品（KOJIPOP、甘酒、グラノーラなど）を販売しています。

以下の会話履歴に対して、オペレーターの返信文を1つ提案してください。

ルール:
- 丁寧だが堅すぎない、親しみやすい敬語
- 100文字以内で簡潔に
- 質問がある場合は回答を含める
- 商品案内が必要な場合は自然に提案
- 謝罪が必要な場合は誠実に対応

会話履歴:
${contextLines}

オペレーターの返信文のみを書いてください。`;

    const MODEL = 'gemini-3-flash-preview';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return c.json({ success: false, error: `Gemini API error (${res.status}): ${errText.slice(0, 200)}` });
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const draftText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    if (!draftText) {
      return c.json({ success: false, error: 'Geminiからの返答が空でした。' });
    }

    return c.json({ success: true, data: { draft: draftText } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: `サーバーエラー: ${msg}` });
  }
});

export { aiDraft };
