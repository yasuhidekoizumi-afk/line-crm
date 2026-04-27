/** 楽天 RMS API エラー基底 */
export class RmsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    public readonly responseText?: string,
  ) {
    super(message);
    this.name = 'RmsApiError';
  }
}

/** licenseKey 失効・認証エラー（401） */
export class RmsLicenseExpiredError extends RmsApiError {
  constructor(endpoint: string, responseText?: string) {
    super(
      `Rakuten RMS licenseKey expired or invalid (401) at ${endpoint}`,
      401,
      endpoint,
      responseText,
    );
    this.name = 'RmsLicenseExpiredError';
  }
}

/** レート制限エラー（429） */
export class RmsRateLimitError extends RmsApiError {
  constructor(endpoint: string, responseText?: string) {
    super(`Rakuten RMS rate limit (429) at ${endpoint}`, 429, endpoint, responseText);
    this.name = 'RmsRateLimitError';
  }
}
