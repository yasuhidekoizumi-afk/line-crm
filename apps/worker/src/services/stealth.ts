// =============================================================================
// Stealth Delivery — Rate limiting, jitter, and human-like sending patterns
// =============================================================================

/**
 * Add random jitter to a delay in milliseconds.
 * Returns base + random(0, jitterRange) ms.
 */
export function addJitter(baseMs: number, jitterRangeMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterRangeMs);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add random variation to message text to avoid identical bulk messages.
 * Inserts zero-width spaces or slight punctuation variations.
 */
export function addMessageVariation(text: string, index: number): string {
  // Use different unicode whitespace characters at random positions
  // This makes each message slightly unique without visible differences
  const variations = [
    '\u200B', // zero-width space
    '\u200C', // zero-width non-joiner
    '\u200D', // zero-width joiner
    '\uFEFF', // zero-width no-break space
  ];

  // Deterministic but unique per-message variation
  const varChar = variations[index % variations.length];
  const position = (index * 7 + 3) % Math.max(text.length, 1);

  if (text.length === 0) return text;
  return text.slice(0, position) + varChar + text.slice(position);
}

/**
 * Calculate staggered delay for bulk sending.
 * Cloudflare Workers の cron は最大 15 分で強制終了される。
 * バッチ間を 1〜2 秒に抑えることで 10,000 件(20バッチ)でも 40秒以内に完走できる。
 *
 * @param totalMessages Total number of messages to send
 * @param batchIndex Current batch index (0-based)
 * @returns Delay in milliseconds before sending this batch
 */
export function calculateStaggerDelay(
  totalMessages: number,
  _batchIndex: number,
): number {
  if (totalMessages <= 100) {
    // Small sends: minimal delay with jitter
    return addJitter(100, 500);
  }

  // バッチ間は 1〜2 秒で固定（旧実装の 5 分スプレッドは Cloudflare の実行時間制限を超えていた）
  return addJitter(1000, 1000);
}

/**
 * Calculate jittered delivery time for step delivery.
 * Adds random minutes (±5 min) to scheduled delivery to avoid
 * all scenario deliveries firing at exactly the same time.
 */
export function jitterDeliveryTime(scheduledAt: Date): Date {
  const jitterMinutes = Math.floor(Math.random() * 10) - 5; // -5 to +5 minutes
  const result = new Date(scheduledAt);
  result.setMinutes(result.getMinutes() + jitterMinutes);
  return result;
}

/**
 * Rate limiter for LINE API calls.
 * LINE rate limit is 100,000 messages/min, but we stay well under.
 */
export class StealthRateLimiter {
  private callCount = 0;
  private windowStart = Date.now();
  private readonly maxCallsPerWindow: number;
  private readonly windowMs: number;

  constructor(maxCallsPerWindow = 1000, windowMs = 60_000) {
    this.maxCallsPerWindow = maxCallsPerWindow;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();

    // Reset window if expired
    if (now - this.windowStart >= this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
    }

    // If we've hit the limit, wait for the window to reset
    if (this.callCount >= this.maxCallsPerWindow) {
      const waitTime = this.windowMs - (now - this.windowStart) + addJitter(100, 500);
      await sleep(waitTime);
      this.callCount = 0;
      this.windowStart = Date.now();
    }

    this.callCount++;
  }
}
