/**
 * FERMENT: Google Gemini API ラッパー（Cloudflare Workers 用）
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/personalize.ts
 *
 * モデル: gemini-2.0-flash（件名生成・高速・低コスト）
 * フォールバック: API 失敗時はベース件名をそのまま返す
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.0-flash';

/**
 * メール件名のバリアントを複数生成する（A/B テスト用）
 *
 * @param apiKey Gemini API キー
 * @param baseSubject ベースとなる件名
 * @param bodyPreview 本文の先頭部分（文脈情報として使用）
 * @param count 生成するバリアント数（デフォルト 3）
 * @returns 件名バリアントの配列
 */
export async function generateSubjectVariants(
  apiKey: string,
  baseSubject: string,
  bodyPreview: string,
  count = 3,
): Promise<string[]> {
  const prompt = `あなたはメールマーケティングの専門家です。
以下の件名をベースに、開封率を高めるための${count}つのバリアントを生成してください。

ベース件名: ${baseSubject}
本文プレビュー: ${bodyPreview.slice(0, 300)}

# ルール
- 各件名は30文字以内
- 絵文字は1つまで（使わなくてもよい）
- 日本語
- プレースホルダー（{{name}} 等）はそのまま維持
- JSON 配列のみ返す（説明不要）

JSON 形式で返答: ["件名1", "件名2", "件名3"]`;

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 256 },
        }),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[ai-sdk] Gemini API error', res.status, errorText);
      return [baseSubject];
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return [baseSubject];

    // JSON 配列をパース
    const jsonMatch = text.match(/\[.*\]/s);
    if (!jsonMatch) return [baseSubject];

    const variants = JSON.parse(jsonMatch[0]) as string[];
    if (!Array.isArray(variants) || variants.length === 0) return [baseSubject];

    return variants.slice(0, count);
  } catch (err) {
    console.error('[ai-sdk] generateSubjectVariants exception:', err);
    return [baseSubject];
  }
}
