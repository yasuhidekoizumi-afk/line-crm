/**
 * 楽天 RMS WEB SERVICE クライアント (Cloudflare Workers 対応)
 *
 * 認証: ESA 方式 - Authorization: ESA Base64(serviceSecret:licenseKey)
 *
 * 設計書: docs/CS_RAKUTEN_RMS_DESIGN.md
 */

import type {
  RmsInquiry,
  RmsListInquiriesParams,
  RmsListInquiriesResult,
  RmsCountsResult,
  RmsReplyParams,
  RmsReplyResult,
} from './types.js';
import { RmsApiError, RmsLicenseExpiredError, RmsRateLimitError } from './errors.js';

const DEFAULT_BASE = 'https://api.rms.rakuten.co.jp/es/1.0/';

export interface RmsClientOptions {
  serviceSecret: string;
  licenseKey: string;
  baseUrl?: string;
  /** 各APIコール後のフック（ログ記録等） */
  onCall?: (info: {
    endpoint: string;
    status: number | null;
    durationMs: number;
    error?: string;
  }) => Promise<void> | void;
}

export class RmsClient {
  private readonly serviceSecret: string;
  private readonly licenseKey: string;
  private readonly baseUrl: string;
  private readonly onCall?: RmsClientOptions['onCall'];

  constructor(opts: RmsClientOptions) {
    this.serviceSecret = opts.serviceSecret;
    this.licenseKey = opts.licenseKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.onCall = opts.onCall;
  }

  private authHeader(): string {
    const raw = `${this.serviceSecret}:${this.licenseKey}`;
    // Workers でも btoa は利用可能（ASCII限定）
    const b64 = btoa(raw);
    return `ESA ${b64}`;
  }

  /**
   * 問い合わせ件数取得（疎通確認用 / licenseKey 検証に最適）
   * 楽天公式エンドポイント名はドキュメント取得後に確定する。
   */
  async getCounts(): Promise<RmsCountsResult> {
    return this.apiPost<RmsCountsResult>('inquirymng-api/inquirymngapi/counts/20231001/get', {});
  }

  /** 問い合わせ一覧取得 */
  async listInquiries(params: RmsListInquiriesParams): Promise<RmsListInquiriesResult> {
    return this.apiPost<RmsListInquiriesResult>(
      'inquirymng-api/inquirymngapi/inquiries/20231001/get',
      params,
    );
  }

  /** 問い合わせ詳細取得 */
  async getInquiry(inquiryNumber: string): Promise<RmsInquiry> {
    return this.apiPost<RmsInquiry>(
      'inquirymng-api/inquirymngapi/inquiry/20231001/get',
      { inquiryNumber },
    );
  }

  /** 問い合わせへの返信送信 */
  async replyToInquiry(params: RmsReplyParams): Promise<RmsReplyResult> {
    return this.apiPost<RmsReplyResult>(
      'inquirymng-api/inquirymngapi/reply/20231001/post',
      params,
    );
  }

  /** 既読マーク */
  async markAsRead(inquiryNumber: string): Promise<{ ok: boolean }> {
    return this.apiPost(
      'inquirymng-api/inquirymngapi/inquiries/20231001/patch/read',
      { inquiryNumbers: [inquiryNumber] },
    );
  }

  /** 完了マーク */
  async markAsComplete(inquiryNumber: string): Promise<{ ok: boolean }> {
    return this.apiPost(
      'inquirymng-api/inquirymngapi/inquiries/20231001/patch/complete',
      { inquiryNumbers: [inquiryNumber] },
    );
  }

  // ===== 内部実装 =====

  private async apiPost<T>(path: string, body: unknown): Promise<T> {
    const url = this.baseUrl + path;
    const start = Date.now();
    let status: number | null = null;
    let error: string | undefined;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      });
      status = res.status;
      const text = await res.text();

      if (res.status === 401) {
        error = `401 unauthorized (license expired?): ${text.slice(0, 200)}`;
        throw new RmsLicenseExpiredError(path, text);
      }
      if (res.status === 429) {
        error = `429 rate limit: ${text.slice(0, 200)}`;
        throw new RmsRateLimitError(path, text);
      }
      if (!res.ok) {
        error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        throw new RmsApiError(`Rakuten RMS API ${res.status} at ${path}`, res.status, path, text);
      }
      return JSON.parse(text) as T;
    } catch (e) {
      if (!error) error = String(e);
      throw e;
    } finally {
      if (this.onCall) {
        try {
          await this.onCall({ endpoint: path, status, durationMs: Date.now() - start, error });
        } catch {
          // hook の失敗は無視
        }
      }
    }
  }
}
