/**
 * FERMENT: Worker 環境変数の型定義
 *
 * apps/worker/src/index.ts の Env 型を継承する形で定義。
 * ferment/ ディレクトリ内の全ファイルで使用。
 */

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
    // FERMENT 追加シークレット
    RESEND_API_KEY?: string;
    RESEND_WEBHOOK_SECRET?: string;
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    SLACK_WEBHOOK_URL?: string;
    FERMENT_SHOPIFY_WEBHOOK_SECRET?: string;
    FERMENT_HMAC_SECRET?: string;
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
