/**
 * FERMENT ai-sdk: 共通型定義
 */

/** パーソナライズに使う顧客コンテキスト */
export interface CustomerContext {
  /** 表示名 */
  display_name: string;
  /** リージョン: JP | US */
  region: string;
  /** 言語: ja | en */
  language: string;
  /** LTV ティア: low / mid / high / vip */
  ltv_tier: 'low' | 'mid' | 'high' | 'vip';
  /** 直近3件の購入商品名 */
  past_products: string[];
  /** 最後のインタラクション（例: "2週間前に購入"） */
  last_interaction: string;
  /** タグ一覧 */
  tags: string[];
}

/** パーソナライズパラメータ */
export interface PersonalizeParams {
  /** テンプレートの system prompt */
  systemPrompt: string;
  /** ベース HTML 本文 */
  baseContent: string;
  /** 顧客コンテキスト */
  customerContext: CustomerContext;
}

/** パーソナライズ結果 */
export interface PersonalizeResult {
  /** 生成された HTML 本文 */
  html: string;
  /** 処理方法: 'ai' = AI生成, 'fallback' = ベース本文使用 */
  method: 'ai' | 'fallback';
}
