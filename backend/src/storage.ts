/**
 * SQLite persistence layer.
 *
 * Persists two things that are otherwise lost on restart:
 *   1. Backtest simulation results (SimulationResult → JSON blob)
 *   2. Sentiment analysis cache (so the 24-hr window survives a reboot)
 *
 * better-sqlite3 is synchronous — no async/await needed inside this module.
 * All public methods are safe to call from async Express handlers.
 */

import Database from 'better-sqlite3';
import path from 'path';
import type { SimulationResult } from './services/backtesting-engine.js';
import type { Sentiment } from './types.js';
import logger from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BacktestSummaryRow {
  testId: string;
  symbols: string;       // comma-separated
  agentCount: number;
  topPerformer: string;
  createdAt: string;     // ISO timestamp
}

export interface StorageOptions {
  /** Path to the .db file. Defaults to DATABASE_PATH env var or ./sentiment_analyzer.db */
  dbPath?: string;
}

// ─── StorageService ─────────────────────────────────────────────────────────

export class StorageService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(options: StorageOptions = {}) {
    this.dbPath = path.resolve(
      options.dbPath ?? process.env.DATABASE_PATH ?? './sentiment_analyzer.db'
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Open the database and create tables if they don't exist. */
  connect(): void {
    this.db = new Database(this.dbPath);

    // WAL mode: better read concurrency, faster writes
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.createTables();
    logger.info('sqlite connected', { path: this.dbPath });
  }

  /** Close the database connection gracefully. */
  close(): void {
    this.db?.close();
    this.db = null;
    logger.info('sqlite closed');
  }

  // ── Backtest Results ──────────────────────────────────────────────────────

  /**
   * Persist a completed simulation result.
   * Upserts by testId so re-runs don't duplicate rows.
   */
  saveBacktestResult(result: SimulationResult): void {
    const db = this.requireDb();
    const stmt = db.prepare(`
      INSERT INTO backtest_results (test_id, symbols, agent_count, top_performer, payload, created_at)
      VALUES (@testId, @symbols, @agentCount, @topPerformer, @payload, @createdAt)
      ON CONFLICT(test_id) DO UPDATE SET
        payload      = excluded.payload,
        created_at   = excluded.created_at
    `);

    stmt.run({
      testId: result.testId,
      symbols: result.config.symbols.join(','),
      agentCount: result.agentResults.length,
      topPerformer: result.comparison.topPerformerByReturn,
      payload: JSON.stringify(result, dateReplacer),
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Retrieve a full simulation result by testId.
   * Returns `undefined` if not found.
   */
  getBacktestResult(testId: string): SimulationResult | undefined {
    const db = this.requireDb();
    const row = db
      .prepare('SELECT payload FROM backtest_results WHERE test_id = ?')
      .get(testId) as { payload: string } | undefined;

    if (!row) return undefined;
    return JSON.parse(row.payload, dateReviver) as SimulationResult;
  }

  /**
   * List all saved backtest summaries (lightweight — no payload).
   * Sorted newest-first.
   */
  listBacktestResults(): BacktestSummaryRow[] {
    const db = this.requireDb();
    return db
      .prepare(`
        SELECT test_id AS testId, symbols, agent_count AS agentCount,
               top_performer AS topPerformer, created_at AS createdAt
        FROM backtest_results
        ORDER BY created_at DESC
      `)
      .all() as BacktestSummaryRow[];
  }

  /**
   * Delete a single backtest result by testId.
   */
  deleteBacktestResult(testId: string): boolean {
    const db = this.requireDb();
    const info = db
      .prepare('DELETE FROM backtest_results WHERE test_id = ?')
      .run(testId);
    return info.changes > 0;
  }

  // ── Sentiment Cache ───────────────────────────────────────────────────────

  /**
   * Persist a sentiment result.
   * `ttlMs` defaults to 24 hours — matches the in-memory sentimentCache TTL.
   */
  saveSentiment(symbol: string, data: Sentiment, ttlMs = 24 * 60 * 60 * 1000): void {
    const db = this.requireDb();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.prepare(`
      INSERT INTO sentiment_cache (symbol, payload, expires_at)
      VALUES (@symbol, @payload, @expiresAt)
      ON CONFLICT(symbol) DO UPDATE SET
        payload    = excluded.payload,
        expires_at = excluded.expires_at
    `).run({ symbol: symbol.toUpperCase(), payload: JSON.stringify(data), expiresAt });
  }

  /**
   * Retrieve a cached sentiment result.
   * Returns `undefined` if missing or expired (and prunes the expired row).
   */
  getSentiment(symbol: string): Sentiment | undefined {
    const db = this.requireDb();
    const row = db
      .prepare('SELECT payload, expires_at FROM sentiment_cache WHERE symbol = ?')
      .get(symbol.toUpperCase()) as { payload: string; expires_at: string } | undefined;

    if (!row) return undefined;

    if (new Date(row.expires_at) < new Date()) {
      // Prune expired entry
      db.prepare('DELETE FROM sentiment_cache WHERE symbol = ?').run(symbol.toUpperCase());
      return undefined;
    }

    return JSON.parse(row.payload) as Sentiment;
  }

  /**
   * Delete all expired sentiment rows.
   * Call periodically (e.g. on server startup or from cron) to keep the DB lean.
   */
  pruneExpiredSentiment(): number {
    const db = this.requireDb();
    const info = db
      .prepare("DELETE FROM sentiment_cache WHERE expires_at < datetime('now')")
      .run();
    return info.changes;
  }

  /**
   * Return the total number of non-expired sentiment rows.
   */
  sentimentCacheSize(): number {
    const db = this.requireDb();
    const row = db
      .prepare("SELECT COUNT(*) AS cnt FROM sentiment_cache WHERE expires_at >= datetime('now')")
      .get() as { cnt: number };
    return row.cnt;
  }

  // ── Health ────────────────────────────────────────────────────────────────

  /** Quick connectivity check — returns true if the DB responds. */
  isHealthy(): boolean {
    try {
      this.requireDb().prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private createTables(): void {
    const db = this.requireDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        test_id       TEXT    PRIMARY KEY,
        symbols       TEXT    NOT NULL,
        agent_count   INTEGER NOT NULL DEFAULT 0,
        top_performer TEXT    NOT NULL DEFAULT '',
        payload       TEXT    NOT NULL,
        created_at    TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backtest_created ON backtest_results (created_at DESC);

      CREATE TABLE IF NOT EXISTS sentiment_cache (
        symbol     TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sentiment_expires ON sentiment_cache (expires_at);
    `);
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('[storage] Database not connected — call connect() first');
    return this.db;
  }
}

// ─── JSON Date helpers ────────────────────────────────────────────────────────

/** JSON.stringify replacer: converts Date objects to ISO strings tagged for revival. */
function dateReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { __date__: value.toISOString() };
  return value;
}

/** JSON.parse reviver: restores tagged ISO strings back to Date objects. */
function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && '__date__' in value) {
    return new Date((value as { __date__: string }).__date__);
  }
  return value;
}

// ─── Module-level singleton ───────────────────────────────────────────────────

export const storage = new StorageService();
