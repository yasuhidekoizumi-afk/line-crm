/**
 * FERMENT: メールパーソナライズ統合関数
 *
 * テンプレートと顧客情報を受け取り、送信可能なメール1通分のコンテンツを生成する。
 * ai_enabled = 0 の場合はプレースホルダー置換のみ。
 * ai_enabled = 1 の場合は Claude で本文、Gemini で件名バリアントを生成。
 *
 * 呼び出し元:
 *   - apps/worker/src/ferment/send-engine.ts
 *   - apps/worker/src/ferment/cron-flows.ts
 *   - apps/worker/src/ferment/routes/templates.ts (プレビュー)
 */

import { generatePersonalizedBody } from '@line-crm/ai-sdk';
import { generateSubjectVariants } from '@line-crm/ai-sdk';
import type { EmailTemplate, Customer } from '@line-crm/db';
import type { CustomerContext } from '@line-crm/ai-sdk';

/** 配信停止 URL を生成（HMAC-SHA256 署名付きトークン） */
export async function generateUnsubscribeUrl(
  baseUrl: string,
  email: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(email.toLowerCase()));
  const token = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const encoded = encodeURIComponent(email);
  return `${baseUrl}?email=${encoded}&token=${token}`;
}

/** 配信停止トークンを検証する */
export async function verifyUnsubscribeToken(
  email: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(email.toLowerCase()));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  // タイミング攻撃対策: 文字数が違う場合も同一処理
  return expected === token;
}

/** LTV 金額からティアを決定 */
function getLtvTier(ltv: number, currency: string): CustomerContext['ltv_tier'] {
  const yenValue = currency === 'JPY' ? ltv : ltv * 150; // USD → JPY 概算
  if (yenValue >= 100000) return 'vip';
  if (yenValue >= 30000) return 'high';
  if (yenValue >= 10000) return 'mid';
  return 'low';
}

/** 顧客情報から CustomerContext を作成 */
function buildCustomerContext(customer: Customer): CustomerContext {
  const tags = customer.tags ? (JSON.parse(customer.tags) as string[]) : [];
  const products = customer.preferred_products
    ? (JSON.parse(customer.preferred_products) as string[]).slice(0, 3)
    : [];

  let lastInteraction = '初めてのご利用';
  if (customer.last_order_at) {
    const days = Math.floor(
      (Date.now() - new Date(customer.last_order_at).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days === 0) lastInteraction = '本日購入';
    else if (days < 7) lastInteraction = `${days}日前に購入`;
    else if (days < 30) lastInteraction = `約${Math.floor(days / 7)}週間前に購入`;
    else lastInteraction = `約${Math.floor(days / 30)}ヶ月前に購入`;
  }

  return {
    display_name: customer.display_name ?? 'お客様',
    region: customer.region,
    language: customer.language,
    ltv_tier: getLtvTier(customer.ltv, customer.ltv_currency),
    past_products: products,
    last_interaction: lastInteraction,
    tags,
  };
}

/** プレースホルダーを顧客情報で置換する */
function replacePlaceholders(
  content: string,
  customer: Customer,
  unsubscribeUrl: string,
): string {
  const name = customer.display_name ?? 'お客様';
  const firstName = name.split(/\s+/)[0];

  return content
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{region\}\}/g, customer.region)
    .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);
}

export interface PersonalizeEmailResult {
  subject: string;
  html: string;
  text: string;
  /** A/B テスト用バリアント名（a/b/c） */
  variant?: string;
}

/**
 * テンプレートと顧客情報からメールコンテンツを生成する
 *
 * @param template メールテンプレート
 * @param customer 顧客情報
 * @param env Worker 環境変数
 */
export async function personalizeEmail(
  template: EmailTemplate,
  customer: Customer,
  env: {
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    FERMENT_UNSUBSCRIBE_BASE_URL?: string;
    FERMENT_HMAC_SECRET?: string;
  },
): Promise<PersonalizeEmailResult> {
  const unsubscribeUrl = env.FERMENT_UNSUBSCRIBE_BASE_URL
    ? await generateUnsubscribeUrl(
        env.FERMENT_UNSUBSCRIBE_BASE_URL,
        customer.email ?? '',
        env.FERMENT_HMAC_SECRET ?? 'dev-secret',
      )
    : '#unsubscribe';

  const baseHtml = template.body_html ?? '';
  const baseText = template.body_text ?? '';
  const baseSubject = template.subject_base ?? '(件名なし)';

  // プレースホルダー置換後のベース本文
  const replacedHtml = replacePlaceholders(baseHtml, customer, unsubscribeUrl);
  const replacedText = replacePlaceholders(baseText, customer, unsubscribeUrl);
  const replacedSubject = replacePlaceholders(baseSubject, customer, unsubscribeUrl);

  // AI パーソナライズが無効の場合はここで返す
  if (!template.ai_enabled || !env.ANTHROPIC_API_KEY) {
    return { subject: replacedSubject, html: replacedHtml, text: replacedText };
  }

  const customerContext = buildCustomerContext(customer);

  // 並列: Claude で本文生成、Gemini で件名バリアント生成
  const [bodyResult, subjectVariants] = await Promise.all([
    generatePersonalizedBody(env.ANTHROPIC_API_KEY, {
      systemPrompt: template.ai_system_prompt ?? '',
      baseContent: replacedHtml,
      customerContext,
    }),
    env.GEMINI_API_KEY
      ? generateSubjectVariants(env.GEMINI_API_KEY, replacedSubject, replacedHtml, 3)
      : Promise.resolve([replacedSubject]),
  ]);

  // A/B テスト: 件名ランダム選択
  const variants = ['a', 'b', 'c'];
  const idx = Math.floor(Math.random() * subjectVariants.length);
  const selectedSubject = subjectVariants[idx] ?? replacedSubject;
  const variant = subjectVariants.length > 1 ? variants[idx] : undefined;

  return {
    subject: selectedSubject,
    html: bodyResult.html,
    text: replacedText, // プレーンテキストはベース版を使用
    variant,
  };
}
