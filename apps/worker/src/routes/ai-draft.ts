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

    const contextLines = (chatHistory ?? []).slice(-8).map((m) =>
      `${m.direction === 'incoming' ? '顧客' : 'オペレーター'}: ${m.content.slice(0, 500)}`
    ).join('\n');

const prompt = `あなたはECブランド「ORYZAE（オリゼ）」のカスタマーサポート担当です。
米麹発酵食品（KOJIPOP、甘酒、グラノーラなど）を販売しています。

以下の会話履歴に対するオペレーターの返信文を1つ提案してください。

【絶対守るルール】
- 120〜180文字に収める。長くても200文字まで。
- 堅苦しい表現は禁止：「お詫び申し上げます」「心よりお詫び」「スタッフ一同」「弊社」は使わない
- 謝罪は1回だけ、シンプルに「申し訳ございません」でOK
- 最後に「これからもORYZAEをよろしくお願いいたします」のような決まり文句は不要
- 改行は最小限。LINEの1メッセージとして読める長さに。
- トーン：丁寧だけど親しみやすい。実際のLINEのオペレーター返信のように。

会話履歴:
${contextLines}

オペレーターの返信文のみを書いてください。`;

    const MODEL = 'gemini-2.5-flash';

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
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
