import type { Sentiment } from '../../types.js';

export type { Sentiment };

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — exported for adapters
export { DEFAULT_TTL_MS };

// ── Repository interface ──────────────────────────────────────────────────────

export interface ISentimentRepository {
  /** Persist sentiment data for a symbol, expiring after ttlMs (default 24 h). */
  save(symbol: string, data: Sentiment, ttlMs?: number): Promise<void>;
  /** Returns cached sentiment if not expired, null otherwise. */
  findBySymbol(symbol: string): Promise<Sentiment | null>;
  /** Delete all expired rows. Returns number of rows deleted. */
  pruneExpired(): Promise<number>;
  /** Count of non-expired cached entries. */
  cacheSize(): Promise<number>;
}
