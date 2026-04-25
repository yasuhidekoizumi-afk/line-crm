/**
 * FERMENT email-sdk: 共通型定義
 */

/** メール送信パラメータ */
export interface SendEmailParams {
  /** 送信元 例: "オリゼ <noreply@mail.oryzae.jp>" */
  from: string;
  /** 送信先メールアドレス */
  to: string;
  /** 件名 */
  subject: string;
  /** HTML 本文 */
  html: string;
  /** プレーンテキスト本文（省略時は HTML から自動生成しない） */
  text?: string;
  /** 返信先メールアドレス */
  replyTo?: string;
  /** Resend のタグ（配信管理・フィルタリング用） */
  tags?: Array<{ name: string; value: string }>;
  /** カスタムヘッダー（List-Unsubscribe 等） */
  headers?: Record<string, string>;
}

/** メール送信結果 */
export interface SendResult {
  /** 成功したか */
  ok: boolean;
  /** Resend API が返す ID（成功時） */
  resendId?: string;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/** Resend Webhook イベント */
export interface ResendWebhookEvent {
  type:
    | 'email.sent'
    | 'email.delivered'
    | 'email.delivery_delayed'
    | 'email.opened'
    | 'email.clicked'
    | 'email.bounced'
    | 'email.complained';
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject?: string;
    click?: { link: string; timestamp: string; userAgent: string };
    bounce?: { message: string };
  };
}
