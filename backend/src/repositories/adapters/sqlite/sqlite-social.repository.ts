import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ScoredSocialItem,
  TrendingTopicRecord,
  SocialSource,
  TopicType,
  SourceMetadata,
} from '../../../types/social-media.js';
import type {
  ISocialRepository,
  SocialItemQuery,
  SocialItemsResult,
  HistoricalSignalPoint,
  SocialStats,
} from '../../interfaces/social.repository.js';

export class SQLiteSocialRepository implements ISocialRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Items ──────────────────────────────────────────────────────────────────

  async upsertItem(item: ScoredSocialItem): Promise<void> {
    this.db.prepare(`
      INSERT INTO social_media_items (
        id, source, source_id, content, title, author, author_followers,
        engagement_likes, engagement_shares, engagement_comments, engagement_views,
        content_created_at, fetched_at, url,
        coins_mentioned, metadata,
        sentiment_score, sentiment_confidence,
        score_sentiment, score_engagement, score_recency, score_authority, score_composite,
        last_updated, language, sarcasm_flagged, context_window_used, bot_score
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(source, source_id) DO UPDATE SET
        content              = excluded.content,
        title                = excluded.title,
        coins_mentioned      = excluded.coins_mentioned,
        sentiment_score      = excluded.sentiment_score,
        sentiment_confidence = excluded.sentiment_confidence,
        score_sentiment      = excluded.score_sentiment,
        score_engagement     = excluded.score_engagement,
        score_recency        = excluded.score_recency,
        score_authority      = excluded.score_authority,
        score_composite      = excluded.score_composite,
        last_updated         = excluded.last_updated,
        sarcasm_flagged      = excluded.sarcasm_flagged,
        context_window_used  = excluded.context_window_used,
        bot_score            = excluded.bot_score
    `).run(
      item.id ?? randomUUID(),
      item.source,
      item.source_id,
      item.content,
      item.title ?? null,
      item.author ?? null,
      item.author_followers ?? 0,
      item.engagement_likes,
      item.engagement_shares,
      item.engagement_comments,
      item.engagement_views ?? 0,
      item.content_created_at,
      item.fetched_at,
      item.url,
      JSON.stringify(item.coins_mentioned ?? []),
      JSON.stringify(item.metadata ?? {}),
      item.sentiment_score,
      item.sentiment_confidence,
      item.score_sentiment,
      item.score_engagement,
      item.score_recency,
      item.score_authority,
      item.score_composite,
      item.last_updated,
      item.language ?? null,
      item.sarcasm_flagged ? 1 : 0,
      item.context_window_used ? 1 : 0,
      item.bot_score ?? 0,
    );
  }

  async findItems(query: SocialItemQuery): Promise<SocialItemsResult> {
    const conditions: string[] = [];
    const params: unknown[]    = [];

    if (query.coin) {
      conditions.push('coins_mentioned LIKE ?');
      params.push(`%"${query.coin}"%`);
    }
    if (query.source) {
      conditions.push('source = ?');
      params.push(query.source);
    }
    if (query.minScore !== undefined) {
      conditions.push('score_composite >= ?');
      params.push(query.minScore);
    }
    if (query.sinceHours !== undefined) {
      const since = new Date(Date.now() - query.sinceHours * 3_600_000).toISOString();
      conditions.push('fetched_at >= ?');
      params.push(since);
    }

    const orderBy = query.sortBy === 'recency' ? 'fetched_at' : query.sortBy === 'engagement' ? 'score_engagement' : 'score_composite';

    // Keyset pagination: cursor is (sortKeyValue, id) tuple encoded as JSON
    // For DESC ordering: (sortValue < ?) OR (sortValue = ? AND id < ?)
    if (query.cursor) {
      // Decode compound cursor: { v: sortColumnValue, id: lastId }
      // Use (sortCol, id) composite comparison so the cursor matches the ORDER BY.
      try {
        const { v, id: cursorId } = JSON.parse(Buffer.from(query.cursor, 'base64').toString('utf8')) as { v: unknown; id: string };
        const orderBy = query.sortBy === 'recency' ? 'fetched_at' : query.sortBy === 'engagement' ? 'score_engagement' : 'score_composite';
        // For DESC ordering: next page has (col < v) OR (col = v AND id < cursorId)
        conditions.push(`(${orderBy} < ? OR (${orderBy} = ? AND id < ?))`);
        params.push(v, v, cursorId);
      } catch {
        // Ignore malformed cursors — return from the start
      }
    }

    const where   = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit   = (query.limit ?? 50) + 1; // fetch one extra to detect next page
    params.push(limit);

    const rows = this.db.prepare(
      `SELECT * FROM social_media_items ${where} ORDER BY ${orderBy} DESC, id DESC LIMIT ?`,
    ).all(...params) as Array<Record<string, unknown>>;

    const hasMore = rows.length === limit;
    const items   = (hasMore ? rows.slice(0, -1) : rows).map(r => this.mapRow(r));

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  async findItemsForCoin(coin: string, hours: number): Promise<ScoredSocialItem[]> {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const rows  = this.db.prepare(`
      SELECT * FROM social_media_items
      WHERE  coins_mentioned LIKE ?
        AND  fetched_at >= ?
        AND  (bot_score IS NULL OR bot_score < 0.8)
      ORDER  BY score_composite DESC
    `).all(`%"${coin}"%`, since) as Array<Record<string, unknown>>;
    return rows.map(r => this.mapRow(r));
  }

  async findItemById(id: string): Promise<ScoredSocialItem | null> {
    const row = this.db.prepare(
      'SELECT * FROM social_media_items WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  async pruneOldItems(retainDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retainDays * 86_400_000).toISOString();
    return this.db.prepare(
      'DELETE FROM social_media_items WHERE fetched_at < ?',
    ).run(cutoff).changes;
  }

  // ── Trending topics ────────────────────────────────────────────────────────

  async upsertTrendingTopic(topic: TrendingTopicRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO trending_topics (
        id, topic, topic_type, coin_symbol,
        mention_count, unique_sources,
        signal_sentiment, signal_engagement, signal_recency, signal_authority, signal_composite,
        velocity, peak_time, last_updated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic) DO UPDATE SET
        mention_count      = excluded.mention_count,
        unique_sources     = excluded.unique_sources,
        signal_sentiment   = excluded.signal_sentiment,
        signal_engagement  = excluded.signal_engagement,
        signal_recency     = excluded.signal_recency,
        signal_authority   = excluded.signal_authority,
        signal_composite   = excluded.signal_composite,
        velocity           = excluded.velocity,
        peak_time          = excluded.peak_time,
        last_updated       = excluded.last_updated
    `).run(
      topic.id,
      topic.topic,
      topic.topic_type,
      topic.coin_symbol ?? null,
      topic.mention_count,
      topic.unique_sources,
      topic.signal_sentiment,
      topic.signal_engagement,
      topic.signal_recency,
      topic.signal_authority,
      topic.signal_composite,
      topic.velocity,
      topic.peak_time,
      topic.last_updated,
      topic.created_at,
    );
  }

  async getTrendingTopics(limit: number, topicType?: TopicType): Promise<TrendingTopicRecord[]> {
    if (topicType) {
      return this.db.prepare(
        'SELECT * FROM trending_topics WHERE topic_type = ? ORDER BY signal_composite DESC LIMIT ?',
      ).all(topicType, limit) as TrendingTopicRecord[];
    }
    return this.db.prepare(
      'SELECT * FROM trending_topics ORDER BY signal_composite DESC LIMIT ?',
    ).all(limit) as TrendingTopicRecord[];
  }

  async saveTrendingSnapshot(coin: string, signalComposite: number, signalSentiment: number): Promise<void> {
    this.db.prepare(`
      INSERT INTO trending_topic_history (id, coin_symbol, signal_composite, signal_sentiment, snapshot_time)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), coin, signalComposite, signalSentiment, new Date().toISOString());
  }

  async getHistoricalSignal(coin: string): Promise<HistoricalSignalPoint[]> {
    return this.db.prepare(`
      SELECT signal_composite, signal_sentiment, snapshot_time
      FROM   trending_topic_history
      WHERE  coin_symbol = ?
      ORDER  BY snapshot_time DESC
      LIMIT  168
    `).all(coin) as HistoricalSignalPoint[];
  }

  // ── Source metadata ────────────────────────────────────────────────────────

  async upsertSourceMeta(meta: SourceMetadata): Promise<void> {
    this.db.prepare(`
      INSERT INTO source_metadata (source, last_fetch_timestamp, items_fetched_today, error_count, status, next_retry)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_fetch_timestamp = excluded.last_fetch_timestamp,
        items_fetched_today  = excluded.items_fetched_today,
        error_count          = excluded.error_count,
        status               = excluded.status,
        next_retry           = excluded.next_retry
    `).run(
      meta.source,
      meta.last_fetch_timestamp,
      meta.items_fetched_today,
      meta.error_count,
      meta.status,
      meta.next_retry ?? null,
    );
  }

  async getSourceMeta(source: SocialSource): Promise<SourceMetadata | null> {
    const row = this.db.prepare(
      'SELECT * FROM source_metadata WHERE source = ?',
    ).get(source) as SourceMetadata | undefined;
    return row ?? null;
  }

  async getAllSourceMeta(): Promise<SourceMetadata[]> {
    return this.db.prepare('SELECT * FROM source_metadata').all() as SourceMetadata[];
  }

  async incrementFetchCount(source: SocialSource, delta: number): Promise<void> {
    this.db.prepare(
      'UPDATE source_metadata SET items_fetched_today = items_fetched_today + ? WHERE source = ?',
    ).run(delta, source);
  }

  async recordSourceError(source: SocialSource, nextRetrySeconds: number): Promise<void> {
    const nextRetry = new Date(Date.now() + nextRetrySeconds * 1_000).toISOString();
    this.db.prepare(`
      UPDATE source_metadata
      SET    error_count = error_count + 1,
             status      = 'error',
             next_retry  = ?
      WHERE  source = ?
    `).run(nextRetry, source);
  }

  async resetDailyCounters(): Promise<void> {
    this.db.prepare(`
      UPDATE source_metadata SET items_fetched_today = 0, error_count = 0, status = 'idle'
    `).run();
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getStats(): Promise<SocialStats> {
    const since24h = new Date(Date.now() - 86_400_000).toISOString();

    const total      = (this.db.prepare('SELECT COUNT(*) AS c FROM social_media_items').get() as { c: number }).c;
    const items24h   = (this.db.prepare('SELECT COUNT(*) AS c FROM social_media_items WHERE fetched_at >= ?').get(since24h) as { c: number }).c;
    const trending   = (this.db.prepare('SELECT COUNT(*) AS c FROM trending_topics').get() as { c: number }).c;
    const botFiltered = (this.db.prepare('SELECT COUNT(*) AS c FROM social_media_items WHERE bot_score >= 0.8').get() as { c: number }).c;

    const perSourceRows = this.db.prepare(`
      SELECT source, COUNT(*) AS count, MAX(fetched_at) AS last_fetch
      FROM   social_media_items
      GROUP  BY source
    `).all() as Array<{ source: string; count: number; last_fetch: string }>;

    const per_source: Record<string, { count: number; last_fetch: string }> = {};
    for (const row of perSourceRows) {
      per_source[row.source] = { count: row.count, last_fetch: row.last_fetch };
    }

    return { total_items: total, items_24h: items24h, trending_count: trending, bot_filtered_count: botFiltered, per_source };
  }

  // ── Mapper ─────────────────────────────────────────────────────────────────

  private mapRow(row: Record<string, unknown>): ScoredSocialItem {
    return {
      ...row,
      coins_mentioned:     JSON.parse(row['coins_mentioned'] as string ?? '[]') as string[],
      metadata:            JSON.parse(row['metadata'] as string ?? '{}') as Record<string, unknown>,
      sarcasm_flagged:     Boolean(row['sarcasm_flagged']),
      context_window_used: Boolean(row['context_window_used']),
    } as unknown as ScoredSocialItem;
  }
}
