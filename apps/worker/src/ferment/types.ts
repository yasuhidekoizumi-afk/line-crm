/**
 * FERMENT: Worker 環境変数の型定義
 *
 * apps/worker/src/index.ts の Env 型を継承する形で定義。
 * ferment/ ディレクトリ内の全ファイルで使用。
 */

// Cron等の関数が受け取るのは index.ts から渡されるフラットなBindings（実ランタイム準拠）。
// Honoルートは Context<FermentEnv> で c.env = Bindings として受ける。
export type FermentBindings = FermentEnv['Bindings'];

export type FermentEnv = {
  Bindings: {
    DB: D1Database;
    // LINE 関連（既存）
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    X_HARNESS_URL?: string;
    SHOPIFY_ADMIN_TOKEN?: string;
    SHOPIFY_SHOP_DOMAIN?: string;
    SHOPIFY_CLIENT_ID?: string;
    SHOPIFY_CLIENT_SECRET?: string;
    // FERMENT 追加シークレット
    RESEND_API_KEY?: string;
    RESEND_WEBHOOK_SECRET?: string;
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    OPENAI_API_KEY?: string;
    IMAGES?: R2Bucket;
    SLACK_WEBHOOK_URL?: string;
    FERMENT_SHOPIFY_WEBHOOK_SECRET?: string;
    // 本番で実運用されている共有トークン（secret list 確認済み・FERMENT_SETUP.md 参照）
    FERMENT_SHOPIFY_TOKEN?: string;
    FERMENT_HMAC_SECRET?: string;
    // Shopify Webhook の HMAC SHA256 検証用シークレット
    SHOPIFY_WEBHOOK_SECRET?: string;
    // 緊急停止フラグ: '1' で /webhook/shopify/cart 系を 503 にする
    CART_WEBHOOK_DISABLED?: string;
    // FERMENT 追加 vars（wrangler.toml の [vars]）
    FERMENT_FROM_EMAIL_JP?: string;
    FERMENT_FROM_EMAIL_US?: string;
    FERMENT_FROM_NAME_JP?: string;
    FERMENT_FROM_NAME_US?: string;
    FERMENT_UNSUBSCRIBE_BASE_URL?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' };
  };
};
