import type {
  ScoredSocialItem,
  TrendingTopicRecord,
  SocialSource,
  TopicType,
  SourceMetadata,
} from '../../types/social-media.js';

export type { ScoredSocialItem, TrendingTopicRecord, SocialSource, TopicType, SourceMetadata };

// ── Query / result shapes ─────────────────────────────────────────────────────

export interface SocialItemQuery {
  coin?: string;
  source?: SocialSource;
  minScore?: number;
  sinceHours?: number;
  sortBy?: 'score' | 'recency' | 'engagement';
  limit?: number;
  /** Opaque cursor returned by the previous page. */
  cursor?: string;
}

export interface SocialItemsResult {
  items: ScoredSocialItem[];
  /** Present when more pages are available. */
  nextCursor?: string;
}

export interface HistoricalSignalPoint {
  signal_composite: number;
  signal_sentiment: number;
  snapshot_time: string;
}

export interface SocialStats {
  total_items: number;
  items_24h: number;
  trending_count: number;
  bot_filtered_count: number;
  per_source: Record<string, { count: number; last_fetch: string }>;
}

// ── Repository interface ──────────────────────────────────────────────────────

export interface ISocialRepository {
  // Items
  upsertItem(item: ScoredSocialItem): Promise<void>;
  findItems(query: SocialItemQuery): Promise<SocialItemsResult>;
  findItemsForCoin(coin: string, hours: number): Promise<ScoredSocialItem[]>;
  findItemById(id: string): Promise<ScoredSocialItem | null>;
  pruneOldItems(retainDays: number): Promise<number>;

  // Trending topics
  upsertTrendingTopic(topic: TrendingTopicRecord): Promise<void>;
  getTrendingTopics(limit: number, topicType?: TopicType): Promise<TrendingTopicRecord[]>;
  saveTrendingSnapshot(coin: string, signalComposite: number, signalSentiment: number): Promise<void>;
  getHistoricalSignal(coin: string): Promise<HistoricalSignalPoint[]>;

  // Source metadata
  upsertSourceMeta(meta: SourceMetadata): Promise<void>;
  getSourceMeta(source: SocialSource): Promise<SourceMetadata | null>;
  getAllSourceMeta(): Promise<SourceMetadata[]>;
  incrementFetchCount(source: SocialSource, delta: number): Promise<void>;
  /** Record a fetch error and set next-retry time. */
  recordSourceError(source: SocialSource, nextRetrySeconds: number): Promise<void>;
  resetDailyCounters(): Promise<void>;

  // Aggregated stats
  getStats(): Promise<SocialStats>;
}
