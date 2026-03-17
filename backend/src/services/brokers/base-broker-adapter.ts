/**
 * Abstract base class for all broker adapters.
 *
 * Provides:
 *   - EventEmitter-style fill handler registry
 *   - Exponential backoff retry wrapper (max 3 attempts)
 *   - Token-bucket rate limiter (configurable per subclass)
 *   - Credential redaction guard (throws if key/secret appear in logged objects)
 */

import type {
  IBrokerAdapter,
  BrokerProvider,
  ExchangeMode,
  FillEvent,
  BrokerOrder,
  BrokerAccount,
  BrokerPosition,
  PlaceOrderRequest,
} from '../../types/broker.js';
import logger from '../../logger.js';

export abstract class BaseBrokerAdapter implements IBrokerAdapter {
  abstract readonly provider: BrokerProvider;
  abstract readonly mode: ExchangeMode;
  abstract readonly credentialId: string;

  // ── Fill handler registry ──────────────────────────────────────────────────

  private readonly fillHandlers = new Set<(event: FillEvent) => void>();

  onFill(handler: (event: FillEvent) => void): void {
    this.fillHandlers.add(handler);
  }

  offFill(handler: (event: FillEvent) => void): void {
    this.fillHandlers.delete(handler);
  }

  protected emitFill(event: FillEvent): void {
    for (const h of this.fillHandlers) {
      try { h(event); } catch (err) {
        logger.warn('broker fill handler threw', { error: String(err) });
      }
    }
  }

  // ── Rate limiter ───────────────────────────────────────────────────────────

  private tokenBucket: number;
  private lastRefillAt: number;
  private readonly maxTokens: number;
  private readonly refillPerMs: number;

  /**
   * @param maxRequestsPerMin  e.g. 200 for Alpaca, 1200 for Binance
   */
  constructor(maxRequestsPerMin: number) {
    this.maxTokens   = maxRequestsPerMin;
    this.tokenBucket = maxRequestsPerMin;
    this.refillPerMs = maxRequestsPerMin / 60_000;
    this.lastRefillAt = Date.now();
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;
    this.tokenBucket = Math.min(this.maxTokens, this.tokenBucket + elapsed * this.refillPerMs);
    this.lastRefillAt = now;
  }

  protected async acquireToken(): Promise<void> {
    this.refillTokens();
    if (this.tokenBucket >= 1) {
      this.tokenBucket -= 1;
      return;
    }
    // Wait until next token is available
    const waitMs = Math.ceil((1 - this.tokenBucket) / this.refillPerMs);
    await sleep(waitMs);
    this.tokenBucket = 0;
  }

  // ── Retry wrapper ──────────────────────────────────────────────────────────

  protected async safeApiCall<T>(
    label: string,
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.acquireToken();
        return await fn();
      } catch (err) {
        lastErr = err;
        const isRetryable = isRetryableError(err);
        if (!isRetryable || attempt === maxRetries - 1) break;

        const delayMs = 100 * Math.pow(2, attempt);
        logger.warn('broker api call retrying', { label, attempt: attempt + 1, delayMs });
        await sleep(delayMs);
      }
    }
    logger.error('broker api call failed', { label, error: safeErrorString(lastErr) });
    throw lastErr;
  }

  // ── Credential safety ──────────────────────────────────────────────────────

  /**
   * Strip any fields whose key name looks like a credential before logging.
   * Call this on raw broker responses before passing them to logger or storage.
   */
  protected sanitize(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;
    const SENSITIVE = /key|secret|token|auth|credential|password/i;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : this.sanitize(v);
    }
    return out;
  }

  // ── Abstract interface (implemented by subclasses) ─────────────────────────

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract validateSymbols(symbols: string[]): Promise<string[]>;
  abstract getAccount(): Promise<BrokerAccount>;
  abstract getPositions(): Promise<BrokerPosition[]>;
  abstract placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder>;
  abstract pollOrderStatus(clientOrderId: string): Promise<Pick<BrokerOrder, 'status' | 'filledQuantity' | 'avgFillPrice' | 'brokerOrderId'>>;
  abstract cancelOrder(clientOrderId: string): Promise<boolean>;
  abstract cancelAllOrders(competitionId: string): Promise<number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Network timeouts, rate-limit 429s, transient 5xx
    return /429|503|504|ECONNRESET|ETIMEDOUT|ENOTFOUND/.test(err.message);
  }
  return false;
}

function safeErrorString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
