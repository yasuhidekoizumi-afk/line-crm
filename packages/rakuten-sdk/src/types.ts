/**
 * 楽天 RMS WEB SERVICE 型定義
 *
 * 注: 公式仕様は店舗の RMS 管理画面でしか閲覧できないため、
 * 一部フィールドは公開情報・OSS実装を元に推定。実装時に検証する。
 */

export interface RmsInquiry {
  inquiryNumber: string; // 楽天問い合わせID
  inquiryType?: string;
  inquiryStatus?: string;
  customerName?: string;
  customerEmail?: string;       // マスクメール
  orderNumber?: string;
  subject?: string;
  body?: string;
  isRead?: boolean;
  isCompleted?: boolean;
  receivedAt?: string;
  attachments?: RmsAttachment[];
}

export interface RmsAttachment {
  fileName: string;
  fileSize?: number;
  contentType?: string;
  downloadKey?: string;
}

export interface RmsListInquiriesParams {
  fromDate: string;       // YYYY-MM-DDTHH:mm:ss+09:00
  toDate: string;
  page?: number;
  limit?: number;         // 既定100件
  status?: string;
}

export interface RmsListInquiriesResult {
  total: number;
  page: number;
  inquiries: RmsInquiry[];
}

export interface RmsCountsResult {
  unreadCount: number;
  totalCount: number;
}

export interface RmsReplyParams {
  inquiryNumber: string;
  body: string;
  attachments?: Array<{ fileName: string; data: ArrayBuffer | string }>;
}

export interface RmsReplyResult {
  ok: boolean;
  replyMessageNumber?: string;
}
