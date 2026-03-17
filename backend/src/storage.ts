/**
 * SQLite persistence layer.
 *
 * Persists things that are otherwise lost on restart:
 *   1. Backtest simulation results (SimulationResult → JSON blob)
 *   2. Sentiment analysis cache (so the 24-hr window survives a reboot)
 *   3. MARL agent learning states (Q-table + policy-network weights + epsilon)
 *   4. Broker credentials (AES-256-GCM encrypted — master key in BROKER_MASTER_KEY env)
 *   5. Broker order audit trail (every real/paper order, credentials stripped)
 *
 * better-sqlite3 is synchronous — no async/await needed inside this module.
 * All public methods are safe to call from async Express handlers.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import type { SimulationResult } from './services/backtesting-engine.js';
import type { Sentiment } from './types.js';
import type {
  StoredCredential,
  BrokerOrder,
  BrokerProvider,
  ExchangeMode,
  EncryptedBlob,
} from './types/broker.js';
import logger from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type { StoredCredential, BrokerOrder };

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

  // ── Broker Credentials ───────────────────────────────────────────────────

  /**
   * Persist encrypted broker credentials.
   * The plaintext apiKey and apiSecret are encrypted with AES-256-GCM before storage.
   * Upserts by id.
   */
  saveBrokerCredential(cred: {
    id: string;
    label: string;
    provider: BrokerProvider;
    mode: ExchangeMode;
    apiKey: string;
    apiSecret: string;
  }): void {
    const db = this.requireDb();
    const payload = JSON.stringify({ apiKey: cred.apiKey, apiSecret: cred.apiSecret });
    const encrypted = encryptWithMasterKey(payload);
    db.prepare(`
      INSERT INTO broker_credentials (id, label, provider, mode, encrypted, created_at)
      VALUES (@id, @label, @provider, @mode, @encrypted, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        label     = excluded.label,
        provider  = excluded.provider,
        mode      = excluded.mode,
        encrypted = excluded.encrypted
    `).run({
      id:        cred.id,
      label:     cred.label,
      provider:  cred.provider,
      mode:      cred.mode,
      encrypted: JSON.stringify(encrypted),
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Load all stored credentials (without decrypting).
   * Used to show the admin which credentials exist.
   */
  listBrokerCredentials(): StoredCredential[] {
    const db = this.requireDb();
    const rows = db
      .prepare('SELECT id, label, provider, mode, encrypted, created_at AS createdAt, last_used AS lastUsed FROM broker_credentials ORDER BY created_at DESC')
      .all() as Array<{ id: string; label: string; provider: BrokerProvider; mode: ExchangeMode; encrypted: string; createdAt: string; lastUsed?: string }>;
    return rows.map(r => ({ ...r, encrypted: JSON.parse(r.encrypted) as EncryptedBlob }));
  }

  /**
   * Decrypt and return the raw credentials for a given credential ID.
   * Returns undefined if not found or if the master key is missing/wrong.
   */
  decryptBrokerCredential(id: string): { apiKey: string; apiSecret: string } | undefined {
    const db = this.requireDb();
    const row = db
      .prepare('SELECT encrypted FROM broker_credentials WHERE id = ?')
      .get(id) as { encrypted: string } | undefined;
    if (!row) return undefined;

    const blob = JSON.parse(row.encrypted) as EncryptedBlob;
    const plaintext = decryptWithMasterKey(blob);
    const parsed = JSON.parse(plaintext) as { apiKey: string; apiSecret: string };

    // Touch last_used timestamp
    db.prepare('UPDATE broker_credentials SET last_used = ? WHERE id = ?')
      .run(new Date().toISOString(), id);

    return parsed;
  }

  /** Delete a stored credential. Returns true if a row was removed. */
  deleteBrokerCredential(id: string): boolean {
    const db = this.requireDb();
    return db.prepare('DELETE FROM broker_credentials WHERE id = ?').run(id).changes > 0;
  }

  // ── Broker Order Audit ────────────────────────────────────────────────────

  /** Insert a new order row (typically right after submission). */
  insertBrokerOrder(order: BrokerOrder): void {
    const db = this.requireDb();
    db.prepare(`
      INSERT OR IGNORE INTO broker_order_audit (
        id, competition_id, agent_id, client_order_id, broker_order_id,
        credential_id, provider, mode, symbol, side, quantity, limit_price,
        status, filled_quantity, avg_fill_price, submitted_at, updated_at, broker_response
      ) VALUES (
        @id, @competitionId, @agentId, @clientOrderId, @brokerOrderId,
        @credentialId, @provider, @mode, @symbol, @side, @quantity, @limitPrice,
        @status, @filledQuantity, @avgFillPrice, @submittedAt, @updatedAt, @brokerResponse
      )
    `).run({
      ...order,
      limitPrice:     order.limitPrice ?? null,
      brokerOrderId:  order.brokerOrderId ?? null,
      brokerResponse: order.brokerResponse ? JSON.stringify(order.brokerResponse) : null,
    });
  }

  /** Update fill/status fields after a poll or fill event. */
  updateBrokerOrder(clientOrderId: string, updates: {
    status?:         BrokerOrder['status'];
    filledQuantity?: number;
    avgFillPrice?:   number;
    brokerOrderId?:  string;
    brokerResponse?: unknown;
  }): void {
    const db = this.requireDb();
    const fields: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { clientOrderId, updatedAt: new Date().toISOString() };

    if (updates.status         !== undefined) { fields.push('status = @status');                   params.status         = updates.status; }
    if (updates.filledQuantity !== undefined) { fields.push('filled_quantity = @filledQuantity');   params.filledQuantity = updates.filledQuantity; }
    if (updates.avgFillPrice   !== undefined) { fields.push('avg_fill_price = @avgFillPrice');      params.avgFillPrice   = updates.avgFillPrice; }
    if (updates.brokerOrderId  !== undefined) { fields.push('broker_order_id = @brokerOrderId');    params.brokerOrderId  = updates.brokerOrderId; }
    if (updates.brokerResponse !== undefined) { fields.push('broker_response = @brokerResponse');   params.brokerResponse = JSON.stringify(updates.brokerResponse); }

    db.prepare(`UPDATE broker_order_audit SET ${fields.join(', ')} WHERE client_order_id = @clientOrderId`)
      .run(params);
  }

  /** Return all audit rows for a competition (newest first). */
  getBrokerOrders(competitionId: string, agentId?: string): BrokerOrder[] {
    const db = this.requireDb();
    const base = `
      SELECT id, competition_id AS competitionId, agent_id AS agentId,
             client_order_id AS clientOrderId, broker_order_id AS brokerOrderId,
             credential_id AS credentialId, provider, mode, symbol, side, quantity,
             limit_price AS limitPrice, status, filled_quantity AS filledQuantity,
             avg_fill_price AS avgFillPrice, submitted_at AS submittedAt,
             updated_at AS updatedAt, broker_response AS brokerResponse
      FROM broker_order_audit
      WHERE competition_id = ?
    `;
    const rows = agentId
      ? db.prepare(`${base} AND agent_id = ? ORDER BY submitted_at DESC`).all(competitionId, agentId)
      : db.prepare(`${base} ORDER BY submitted_at DESC`).all(competitionId);

    return (rows as Array<BrokerOrder & { brokerResponse: string | null }>).map(r => ({
      ...r,
      limitPrice:     r.limitPrice ?? undefined,
      brokerOrderId:  r.brokerOrderId ?? undefined,
      brokerResponse: r.brokerResponse ? JSON.parse(r.brokerResponse) : undefined,
    }));
  }

  /** Return open orders across all competitions (for restart reconciliation). */
  getOpenBrokerOrders(): BrokerOrder[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, competition_id AS competitionId, agent_id AS agentId,
             client_order_id AS clientOrderId, broker_order_id AS brokerOrderId,
             credential_id AS credentialId, provider, mode, symbol, side, quantity,
             limit_price AS limitPrice, status, filled_quantity AS filledQuantity,
             avg_fill_price AS avgFillPrice, submitted_at AS submittedAt,
             updated_at AS updatedAt, broker_response AS brokerResponse
      FROM broker_order_audit
      WHERE status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED')
      ORDER BY submitted_at DESC
    `).all();

    return (rows as Array<BrokerOrder & { brokerResponse: string | null }>).map(r => ({
      ...r,
      limitPrice:     r.limitPrice ?? undefined,
      brokerOrderId:  r.brokerOrderId ?? undefined,
      brokerResponse: r.brokerResponse ? JSON.parse(r.brokerResponse) : undefined,
    }));
  }

  // ── Agent Learning States ─────────────────────────────────────────────────

  /**
   * Persist a MARL agent's learning snapshot (Q-table + policy weights + epsilon).
   * `cacheKey` is `"{agentId}::{riskProfile}"`.
   * Upserts by key so repeated competitions accumulate learning, not duplicate rows.
   */
  saveAgentLearningState(cacheKey: string, snapshot: unknown): void {
    const db = this.requireDb();
    db.prepare(`
      INSERT INTO agent_learning_states (cache_key, payload, updated_at)
      VALUES (@cacheKey, @payload, @updatedAt)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload    = excluded.payload,
        updated_at = excluded.updated_at
    `).run({
      cacheKey,
      payload: JSON.stringify(snapshot),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Load all persisted agent learning snapshots.
   * Called once at engine startup to warm `learningStateCache`.
   */
  getAllAgentLearningStates(): Array<{ cacheKey: string; snapshot: unknown }> {
    const db = this.requireDb();
    const rows = db
      .prepare('SELECT cache_key AS cacheKey, payload FROM agent_learning_states ORDER BY updated_at DESC')
      .all() as Array<{ cacheKey: string; payload: string }>;
    return rows.map(r => ({ cacheKey: r.cacheKey, snapshot: JSON.parse(r.payload) }));
  }

  /**
   * Delete the learning state for a specific agent (e.g. to reset learning).
   */
  deleteAgentLearningState(cacheKey: string): boolean {
    const db = this.requireDb();
    return db.prepare('DELETE FROM agent_learning_states WHERE cache_key = ?').run(cacheKey).changes > 0;
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

      CREATE TABLE IF NOT EXISTS agent_learning_states (
        cache_key  TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS broker_credentials (
        id         TEXT PRIMARY KEY,
        label      TEXT NOT NULL,
        provider   TEXT NOT NULL,
        mode       TEXT NOT NULL,
        encrypted  TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used  TEXT
      );

      CREATE TABLE IF NOT EXISTS broker_order_audit (
        id              TEXT PRIMARY KEY,
        competition_id  TEXT NOT NULL,
        agent_id        TEXT NOT NULL,
        client_order_id TEXT NOT NULL UNIQUE,
        broker_order_id TEXT,
        credential_id   TEXT NOT NULL,
        provider        TEXT NOT NULL,
        mode            TEXT NOT NULL,
        symbol          TEXT NOT NULL,
        side            TEXT NOT NULL,
        quantity        REAL NOT NULL,
        limit_price     REAL,
        status          TEXT NOT NULL DEFAULT 'PENDING',
        filled_quantity REAL NOT NULL DEFAULT 0,
        avg_fill_price  REAL NOT NULL DEFAULT 0,
        submitted_at    TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        broker_response TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_competition ON broker_order_audit (competition_id);
      CREATE INDEX IF NOT EXISTS idx_audit_agent       ON broker_order_audit (agent_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_open        ON broker_order_audit (status) WHERE status IN ('PENDING','SUBMITTED','PARTIALLY_FILLED');
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

// ─── AES-256-GCM Encryption ───────────────────────────────────────────────────
//
// Master key is read from BROKER_MASTER_KEY env var at call time (not module load).
// If the env var is missing, encryption/decryption throws — intentional fail-fast.
//
// Key derivation: if BROKER_MASTER_KEY is 64 hex chars → use directly as 32-byte key.
//                 Otherwise → SHA-256 hash the string to produce 32 bytes.

function getMasterKey(): Buffer {
  const raw = process.env.BROKER_MASTER_KEY;
  if (!raw) throw new Error('[storage] BROKER_MASTER_KEY env var is not set');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Derive 32 bytes via SHA-256 of the provided string
  return createHash('sha256').update(raw).digest();
}

function encryptWithMasterKey(plaintext: string): EncryptedBlob {
  const key = getMasterKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv:         iv.toString('hex'),
    authTag:    cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

function decryptWithMasterKey(blob: EncryptedBlob): string {
  const key     = getMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  return decipher.update(Buffer.from(blob.ciphertext, 'hex')).toString('utf8')
       + decipher.final('utf8');
}

// ─── Module-level singleton ───────────────────────────────────────────────────

export const storage = new StorageService();
