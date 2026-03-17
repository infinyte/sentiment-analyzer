/**
 * SQLite persistence layer for the social media scraping pipeline.
 *
 * Manages three tables:
 *   social_media_items   — individual scored posts / articles
 *   trending_topics      — aggregated trending topics
 *   source_metadata      — per-source health + fetch counters
 *
 * Shares the same database file as StorageService (sentiment_analyzer.db).
 * Uses better-sqlite3 (synchronous) — no async/await inside this module.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  ScoredSocialItem,
  SocialSource,
  SourceMetadata,
  SourceStatus,
  TrendingTopicRecord,
  TopicType,
} from '../types/social-media.js';
import logger from '../logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SocialItemsQuery {
  coin?: string;
  source?: SocialSource;
  limit?: number;
  offset?: number;
  sort?: 'score' | 'recency' | 'engagement';
  minScore?: number;
  sinceHours?: number;
}

export interface PaginatedItems {
  items: ScoredSocialItem[];
  total: number;
  limit: number;
  offset: number;
}

// ── SocialStorageService ──────────────────────────────────────────────────────

export class SocialStorageService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = path.resolve(
      dbPath ?? process.env.DATABASE_PATH ?? './sentiment_analyzer.db'
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connect(): void {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
    logger.info('social-store connected', { path: this.dbPath });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  isHealthy(): boolean {
    try {
      this.requireDb().prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  // ── Social Media Items ─────────────────────────────────────────────────────

  upsertItem(item: ScoredSocialItem): void {
    const db = this.requireDb();
    db.prepare(`
      INSERT INTO social_media_items (
        id, source, source_id, content, title, author, author_followers,
        engagement_likes, engagement_shares, engagement_comments, engagement_views,
        content_created_at, fetched_at, url,
        coins_mentioned, metadata,
        sentiment_score, sentiment_confidence,
        score_sentiment, score_engagement, score_recency, score_authority, score_composite,
        last_updated
      ) VALUES (
        @id, @source, @source_id, @content, @title, @author, @author_followers,
        @engagement_likes, @engagement_shares, @engagement_comments, @engagement_views,
        @content_created_at, @fetched_at, @url,
        @coins_mentioned, @metadata,
        @sentiment_score, @sentiment_confidence,
        @score_sentiment, @score_engagement, @score_recency, @score_authority, @score_composite,
        @last_updated
      )
      ON CONFLICT(source, source_id) DO UPDATE SET
        engagement_likes    = excluded.engagement_likes,
        engagement_shares   = excluded.engagement_shares,
        engagement_comments = excluded.engagement_comments,
        engagement_views    = excluded.engagement_views,
        coins_mentioned     = excluded.coins_mentioned,
        score_sentiment     = excluded.score_sentiment,
        score_engagement    = excluded.score_engagement,
        score_recency       = excluded.score_recency,
        score_authority     = excluded.score_authority,
        score_composite     = excluded.score_composite,
        sentiment_score     = excluded.sentiment_score,
        sentiment_confidence = excluded.sentiment_confidence,
        last_updated        = excluded.last_updated
    `).run({
      id: item.id || randomUUID(),
      source: item.source,
      source_id: item.source_id,
      content: item.content,
      title: item.title ?? null,
      author: item.author ?? null,
      author_followers: item.author_followers ?? null,
      engagement_likes: item.engagement_likes,
      engagement_shares: item.engagement_shares,
      engagement_comments: item.engagement_comments,
      engagement_views: item.engagement_views ?? null,
      content_created_at: item.content_created_at,
      fetched_at: item.fetched_at,
      url: item.url,
      coins_mentioned: JSON.stringify(item.coins_mentioned),
      metadata: JSON.stringify(item.metadata ?? {}),
      sentiment_score: item.sentiment_score,
      sentiment_confidence: item.sentiment_confidence,
      score_sentiment: item.score_sentiment,
      score_engagement: item.score_engagement,
      score_recency: item.score_recency,
      score_authority: item.score_authority,
      score_composite: item.score_composite,
      last_updated: item.last_updated,
    });
  }

  /** Bulk upsert — wrapped in a single transaction for performance. */
  upsertItems(items: ScoredSocialItem[]): number {
    if (items.length === 0) return 0;
    const upsert = this.requireDb().transaction((batch: ScoredSocialItem[]) => {
      for (const item of batch) this.upsertItem(item);
    });
    upsert(items);
    return items.length;
  }

  getItem(id: string): ScoredSocialItem | undefined {
    const row = this.requireDb()
      .prepare('SELECT * FROM social_media_items WHERE id = ?')
      .get(id) as RawItemRow | undefined;
    return row ? parseItemRow(row) : undefined;
  }

  queryItems(query: SocialItemsQuery = {}): PaginatedItems {
    const db = this.requireDb();
    const { coin, source, limit = 50, offset = 0, sort = 'score', minScore, sinceHours } = query;

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (coin) {
      conditions.push(`coins_mentioned LIKE @coinPattern`);
      params.coinPattern = `%"${coin.toUpperCase()}"%`;
    }
    if (source) {
      conditions.push('source = @source');
      params.source = source;
    }
    if (minScore !== undefined) {
      conditions.push('score_composite >= @minScore');
      params.minScore = minScore;
    }
    if (sinceHours !== undefined) {
      conditions.push(`fetched_at >= datetime('now', @since)`);
      params.since = `-${sinceHours} hours`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderCol = sort === 'score' ? 'score_composite' : sort === 'engagement' ? 'score_engagement' : 'content_created_at';

    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM social_media_items ${where}`).get(params) as { cnt: number };
    const rows = db.prepare(
      `SELECT * FROM social_media_items ${where} ORDER BY ${orderCol} DESC LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset }) as RawItemRow[];

    return { items: rows.map(parseItemRow), total: countRow.cnt, limit, offset };
  }

  /** Items mentioning a coin, within the last N hours — for trend aggregation. */
  getItemsForCoin(coin: string, hours = 24): ScoredSocialItem[] {
    const rows = this.requireDb().prepare(`
      SELECT * FROM social_media_items
      WHERE coins_mentioned LIKE @pattern
        AND fetched_at >= datetime('now', @since)
      ORDER BY fetched_at DESC
    `).all({
      pattern: `%"${coin.toUpperCase()}"%`,
      since: `-${hours} hours`,
    }) as RawItemRow[];
    return rows.map(parseItemRow);
  }

  pruneOldItems(retainDays = 30): number {
    const info = this.requireDb().prepare(`
      DELETE FROM social_media_items
      WHERE fetched_at < datetime('now', @since)
    `).run({ since: `-${retainDays} days` });
    return info.changes;
  }

  // ── Trending Topics ────────────────────────────────────────────────────────

  upsertTrendingTopic(topic: TrendingTopicRecord): void {
    this.requireDb().prepare(`
      INSERT INTO trending_topics (
        id, topic, topic_type, coin_symbol,
        mention_count, unique_sources,
        signal_sentiment, signal_engagement, signal_recency,
        signal_authority, signal_composite,
        velocity, peak_time, last_updated, created_at
      ) VALUES (
        @id, @topic, @topic_type, @coin_symbol,
        @mention_count, @unique_sources,
        @signal_sentiment, @signal_engagement, @signal_recency,
        @signal_authority, @signal_composite,
        @velocity, @peak_time, @last_updated, @created_at
      )
      ON CONFLICT(topic) DO UPDATE SET
        mention_count    = excluded.mention_count,
        unique_sources   = excluded.unique_sources,
        signal_sentiment = excluded.signal_sentiment,
        signal_engagement = excluded.signal_engagement,
        signal_recency   = excluded.signal_recency,
        signal_authority = excluded.signal_authority,
        signal_composite = excluded.signal_composite,
        velocity         = excluded.velocity,
        peak_time        = excluded.peak_time,
        last_updated     = excluded.last_updated
    `).run({
      id: topic.id || randomUUID(),
      topic: topic.topic,
      topic_type: topic.topic_type,
      coin_symbol: topic.coin_symbol ?? null,
      mention_count: topic.mention_count,
      unique_sources: topic.unique_sources,
      signal_sentiment: topic.signal_sentiment,
      signal_engagement: topic.signal_engagement,
      signal_recency: topic.signal_recency,
      signal_authority: topic.signal_authority,
      signal_composite: topic.signal_composite,
      velocity: topic.velocity,
      peak_time: topic.peak_time,
      last_updated: topic.last_updated,
      created_at: topic.created_at,
    });
  }

  getTrendingTopics(limit = 20, topicType?: TopicType): TrendingTopicRecord[] {
    const where = topicType ? 'WHERE topic_type = ?' : '';
    const args: unknown[] = topicType ? [topicType, limit] : [limit];
    return (this.requireDb().prepare(`
      SELECT * FROM trending_topics ${where}
      ORDER BY signal_composite DESC
      LIMIT ?
    `).all(...args) as TrendingTopicRecord[]);
  }

  /** Historical signal for a coin — returns up to 2 snapshots (24h ago, 7d ago). */
  getHistoricalSignal(coin: string): { snapshot_time: string; signal_composite: number }[] {
    return this.requireDb().prepare(`
      SELECT snapshot_time, signal_composite
      FROM trending_topic_history
      WHERE coin_symbol = ?
      ORDER BY snapshot_time DESC
      LIMIT 10
    `).all(coin.toUpperCase()) as { snapshot_time: string; signal_composite: number }[];
  }

  saveTrendingSnapshot(coin: string, signalComposite: number): void {
    this.requireDb().prepare(`
      INSERT INTO trending_topic_history (id, coin_symbol, signal_composite, snapshot_time)
      VALUES (?, ?, ?, datetime('now'))
    `).run(randomUUID(), coin.toUpperCase(), signalComposite);
  }

  // ── Source Metadata ────────────────────────────────────────────────────────

  upsertSourceMeta(meta: SourceMetadata): void {
    this.requireDb().prepare(`
      INSERT INTO source_metadata (
        source, last_fetch_timestamp, items_fetched_today, error_count, status, next_retry
      ) VALUES (@source, @last_fetch_timestamp, @items_fetched_today, @error_count, @status, @next_retry)
      ON CONFLICT(source) DO UPDATE SET
        last_fetch_timestamp = excluded.last_fetch_timestamp,
        items_fetched_today  = excluded.items_fetched_today,
        error_count          = excluded.error_count,
        status               = excluded.status,
        next_retry           = excluded.next_retry
    `).run({
      source: meta.source,
      last_fetch_timestamp: meta.last_fetch_timestamp,
      items_fetched_today: meta.items_fetched_today,
      error_count: meta.error_count,
      status: meta.status,
      next_retry: meta.next_retry ?? null,
    });
  }

  getAllSourceMeta(): SourceMetadata[] {
    return this.requireDb()
      .prepare('SELECT * FROM source_metadata')
      .all() as SourceMetadata[];
  }

  getSourceMeta(source: SocialSource): SourceMetadata | undefined {
    return this.requireDb()
      .prepare('SELECT * FROM source_metadata WHERE source = ?')
      .get(source) as SourceMetadata | undefined;
  }

  incrementFetchCount(source: SocialSource, delta: number): void {
    this.requireDb().prepare(`
      UPDATE source_metadata
      SET items_fetched_today = items_fetched_today + ?,
          last_fetch_timestamp = datetime('now'),
          status = 'healthy',
          error_count = 0
      WHERE source = ?
    `).run(delta, source);
  }

  recordSourceError(source: SocialSource, nextRetrySeconds = 300): void {
    this.requireDb().prepare(`
      INSERT INTO source_metadata (source, last_fetch_timestamp, items_fetched_today, error_count, status, next_retry)
      VALUES (?, datetime('now'), 0, 1, 'error', datetime('now', ?))
      ON CONFLICT(source) DO UPDATE SET
        error_count = error_count + 1,
        status = 'error',
        next_retry = datetime('now', ?)
    `).run(source, `+${nextRetrySeconds} seconds`, `+${nextRetrySeconds} seconds`);
  }

  /** Reset daily counters — call at midnight. */
  resetDailyCounters(): void {
    this.requireDb().prepare(`
      UPDATE source_metadata SET items_fetched_today = 0
    `).run();
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats(): {
    total_items: number;
    items_24h: number;
    trending_topics: number;
    sources: SourceMetadata[];
  } {
    const db = this.requireDb();
    const total = (db.prepare('SELECT COUNT(*) AS cnt FROM social_media_items').get() as { cnt: number }).cnt;
    const h24 = (db.prepare(`SELECT COUNT(*) AS cnt FROM social_media_items WHERE fetched_at >= datetime('now', '-24 hours')`).get() as { cnt: number }).cnt;
    const topics = (db.prepare('SELECT COUNT(*) AS cnt FROM trending_topics').get() as { cnt: number }).cnt;
    const sources = this.getAllSourceMeta();
    return { total_items: total, items_24h: h24, trending_topics: topics, sources };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private createTables(): void {
    this.requireDb().exec(`
      CREATE TABLE IF NOT EXISTS social_media_items (
        id                   TEXT    NOT NULL,
        source               TEXT    NOT NULL,
        source_id            TEXT    NOT NULL,
        content              TEXT    NOT NULL DEFAULT '',
        title                TEXT,
        author               TEXT,
        author_followers     INTEGER,
        engagement_likes     INTEGER NOT NULL DEFAULT 0,
        engagement_shares    INTEGER NOT NULL DEFAULT 0,
        engagement_comments  INTEGER NOT NULL DEFAULT 0,
        engagement_views     INTEGER,
        content_created_at   TEXT    NOT NULL,
        fetched_at           TEXT    NOT NULL,
        url                  TEXT    NOT NULL DEFAULT '',
        coins_mentioned      TEXT    NOT NULL DEFAULT '[]',
        metadata             TEXT    NOT NULL DEFAULT '{}',
        sentiment_score      REAL    NOT NULL DEFAULT 0,
        sentiment_confidence REAL    NOT NULL DEFAULT 0,
        score_sentiment      REAL    NOT NULL DEFAULT 0,
        score_engagement     REAL    NOT NULL DEFAULT 0,
        score_recency        REAL    NOT NULL DEFAULT 0,
        score_authority      REAL    NOT NULL DEFAULT 0,
        score_composite      REAL    NOT NULL DEFAULT 0,
        last_updated         TEXT    NOT NULL,
        PRIMARY KEY (source, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_smi_id           ON social_media_items (id);
      CREATE INDEX IF NOT EXISTS idx_smi_coins        ON social_media_items (coins_mentioned);
      CREATE INDEX IF NOT EXISTS idx_smi_fetched      ON social_media_items (fetched_at DESC);
      CREATE INDEX IF NOT EXISTS idx_smi_composite    ON social_media_items (score_composite DESC);
      CREATE INDEX IF NOT EXISTS idx_smi_source       ON social_media_items (source);

      CREATE TABLE IF NOT EXISTS trending_topics (
        id               TEXT    PRIMARY KEY,
        topic            TEXT    UNIQUE NOT NULL,
        topic_type       TEXT    NOT NULL,
        coin_symbol      TEXT,
        mention_count    INTEGER NOT NULL DEFAULT 0,
        unique_sources   INTEGER NOT NULL DEFAULT 0,
        signal_sentiment REAL    NOT NULL DEFAULT 0,
        signal_engagement REAL   NOT NULL DEFAULT 0,
        signal_recency   REAL    NOT NULL DEFAULT 0,
        signal_authority REAL    NOT NULL DEFAULT 0,
        signal_composite REAL    NOT NULL DEFAULT 0,
        velocity         REAL    NOT NULL DEFAULT 0,
        peak_time        TEXT    NOT NULL,
        last_updated     TEXT    NOT NULL,
        created_at       TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tt_coin      ON trending_topics (coin_symbol);
      CREATE INDEX IF NOT EXISTS idx_tt_composite ON trending_topics (signal_composite DESC);
      CREATE INDEX IF NOT EXISTS idx_tt_created   ON trending_topics (created_at DESC);

      CREATE TABLE IF NOT EXISTS trending_topic_history (
        id               TEXT PRIMARY KEY,
        coin_symbol      TEXT NOT NULL,
        signal_composite REAL NOT NULL,
        snapshot_time    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tth_coin ON trending_topic_history (coin_symbol, snapshot_time DESC);

      CREATE TABLE IF NOT EXISTS source_metadata (
        source                TEXT PRIMARY KEY,
        last_fetch_timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
        items_fetched_today   INTEGER NOT NULL DEFAULT 0,
        error_count           INTEGER NOT NULL DEFAULT 0,
        status                TEXT NOT NULL DEFAULT 'idle',
        next_retry            TEXT
      );
    `);
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('[social-store] Not connected — call connect() first');
    return this.db;
  }
}

// ── Row → domain object helpers ───────────────────────────────────────────────

interface RawItemRow {
  id: string; source: string; source_id: string;
  content: string; title: string | null; author: string | null;
  author_followers: number | null;
  engagement_likes: number; engagement_shares: number;
  engagement_comments: number; engagement_views: number | null;
  content_created_at: string; fetched_at: string; url: string;
  coins_mentioned: string; metadata: string;
  sentiment_score: number; sentiment_confidence: number;
  score_sentiment: number; score_engagement: number;
  score_recency: number; score_authority: number; score_composite: number;
  last_updated: string;
}

function parseItemRow(row: RawItemRow): ScoredSocialItem {
  return {
    id: row.id,
    source: row.source as SocialSource,
    source_id: row.source_id,
    content: row.content,
    title: row.title ?? undefined,
    author: row.author ?? undefined,
    author_followers: row.author_followers ?? undefined,
    engagement_likes: row.engagement_likes,
    engagement_shares: row.engagement_shares,
    engagement_comments: row.engagement_comments,
    engagement_views: row.engagement_views ?? undefined,
    content_created_at: row.content_created_at,
    fetched_at: row.fetched_at,
    url: row.url,
    coins_mentioned: JSON.parse(row.coins_mentioned) as string[],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    sentiment_score: row.sentiment_score,
    sentiment_confidence: row.sentiment_confidence,
    score_sentiment: row.score_sentiment,
    score_engagement: row.score_engagement,
    score_recency: row.score_recency,
    score_authority: row.score_authority,
    score_composite: row.score_composite,
    last_updated: row.last_updated,
  };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const socialStore = new SocialStorageService();
