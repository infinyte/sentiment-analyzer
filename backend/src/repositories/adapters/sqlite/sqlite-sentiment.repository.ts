import type Database from 'better-sqlite3';
import type { Sentiment } from '../../../types.js';
import { DEFAULT_TTL_MS } from '../../interfaces/sentiment.repository.js';
import type { ISentimentRepository } from '../../interfaces/sentiment.repository.js';

export class SQLiteSentimentRepository implements ISentimentRepository {
  constructor(private readonly db: Database.Database) {}

  async save(symbol: string, data: Sentiment, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    this.db.prepare(`
      INSERT INTO sentiment_cache (symbol, payload, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        payload    = excluded.payload,
        expires_at = excluded.expires_at
    `).run(symbol, JSON.stringify(data), expiresAt);
  }

  async findBySymbol(symbol: string): Promise<Sentiment | null> {
    const now = Date.now();
    // Prune in the same query pass to keep reads clean.
    this.db.prepare('DELETE FROM sentiment_cache WHERE expires_at < ?').run(now);
    const row = this.db.prepare(
      'SELECT payload FROM sentiment_cache WHERE symbol = ? AND expires_at > ?',
    ).get(symbol, now) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Sentiment) : null;
  }

  async pruneExpired(): Promise<number> {
    return this.db.prepare('DELETE FROM sentiment_cache WHERE expires_at < ?').run(Date.now()).changes;
  }

  async cacheSize(): Promise<number> {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM sentiment_cache WHERE expires_at > ?',
    ).get(Date.now()) as { count: number };
    return row.count;
  }
}
