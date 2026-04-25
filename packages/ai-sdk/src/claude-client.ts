/**
 * FERMENT: Anthropic Claude API ラッパー（Cloudflare Workers 用）
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/personalize.ts
 *
 * モデル: claude-sonnet-4-6（品質重視のメール本文パーソナライズ）
 * フォールバック: API 失敗時はベース本文をそのまま返す
 */

import type { PersonalizeParams, PersonalizeResult } from './types.js';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const MODEL = 'claude-sonnet-4-6';

/**
 * 顧客情報に基づいてメール本文をパーソナライズする
 *
 * @param apiKey Anthropic API キー
 * @param params パーソナライズパラメータ
 * @returns パーソナライズ済み HTML 本文
 */
export async function generatePersonalizedBody(
  apiKey: string,
  params: PersonalizeParams,
): Promise<PersonalizeResult> {
  const { systemPrompt, baseContent, customerContext } = params;

  // デフォルトシステムプロンプト（テンプレートで上書き可能）
  const effectiveSystemPrompt =
    systemPrompt ||
    `あなたは株式会社オリゼのブランドボイスで書くメール編集者です。
オリゼは米麹発酵食品を中心とした D2C ブランドです。
主力商品: KOJIPOP（発酵リカバリーソーダ）、麹甘味料、甘酒、グラノーラ。

# トーン
- 親しみやすく、専門的すぎない
- 発酵の"恵み"と健康への想いを自然に伝える
- 押しつけがましくない、信頼できるブランド

# ルール
- HTML タグは維持する（見た目を壊さない）
- {{name}}, {{unsubscribe_url}} などのプレースホルダーはそのまま維持する
- 大幅な構成変更はしない（文言の調整・追加文のみ）
- 返答は HTML 本文のみ（説明文不要）`;

  const userMessage = `# 顧客情報
名前: ${customerContext.display_name}
リージョン: ${customerContext.region}
言語: ${customerContext.language}
LTV ティア: ${customerContext.ltv_tier}
直近の購入商品: ${customerContext.past_products.join(', ') || 'なし'}
最後のインタラクション: ${customerContext.last_interaction}
タグ: ${customerContext.tags.join(', ') || 'なし'}

# ベース本文
${baseContent}

上記の顧客情報に合わせて本文を自然に調整してください。HTML 本文のみ返してください。`;

  try {
    const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: effectiveSystemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('[ai-sdk] Claude API error', res.status, errorText);
      return { html: baseContent, method: 'fallback' };
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) {
      return { html: baseContent, method: 'fallback' };
    }

    return { html: text.trim(), method: 'ai' };
  } catch (err) {
    console.error('[ai-sdk] generatePersonalizedBody exception:', err);
    return { html: baseContent, method: 'fallback' };
  }
}
