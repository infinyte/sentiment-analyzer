export type SocialSource = 'twitter' | 'reddit' | 'rss' | 'tiktok' | 'discord' | 'telegram' | 'youtube';
export type TrendDirection = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type TrendStrength = 'STRONG' | 'MODERATE' | 'WEAK';
export type TopicType = 'coin' | 'hashtag' | 'keyword';

export interface ClusteredTrendingTopic {
  rank: number;
  topic: string;
  primary_topic: string;
  topic_type: TopicType;
  coin_symbol?: string;
  mention_count: number;
  unique_sources: number;
  signal_composite: number;
  signal_sentiment: number;
  velocity: number;
  trend_direction: TrendDirection;
  last_updated: string;
  cluster_size: number;
  clustered_topics: string[];
}

export interface TrendingTopicsResponse {
  timeWindow: string;
  count: number;
  topics: ClusteredTrendingTopic[];
}

export interface ScoredSocialItem {
  id: string;
  source: SocialSource;
  source_id: string;
  content: string;
  title?: string;
  author?: string;
  engagement_likes: number;
  engagement_shares: number;
  engagement_comments: number;
  content_created_at: string;
  fetched_at: string;
  url: string;
  coins_mentioned: string[];
  sentiment_score: number;
  sentiment_confidence: number;
  score_sentiment: number;
  score_engagement: number;
  score_recency: number;
  score_authority: number;
  score_composite: number;
  last_updated: string;
}

export interface SocialItemsResponse {
  coin?: string;
  total: number;
  limit: number;
  offset: number;
  next_cursor?: string;
  items: ScoredSocialItem[];
}

export interface SourceStat {
  source: SocialSource;
  total_items: number;
  items_24h: number;
  fetch_count_today: number;
  error_count_today: number;
  last_fetched_at?: string;
}

export interface SocialStats {
  total_items: number;
  items_24h: number;
  trending_topics: number;
  sources: SourceStat[];
}

export interface SourceBreakdownEntry {
  source: SocialSource;
  mentions: number;
  avg_composite: number;
}

// ── Scrape / ingest utility types ─────────────────────────────────────────────

export interface ScrapePost {
  platform: string;
  id?: string;
  text: string;
  author?: string;
  url?: string;
  created_at?: string;
  likes?: number;
  shares?: number;
  comments?: number;
}

export interface ScrapeplatformResult {
  platform: string;
  posts: ScrapePost[];
  post_count: number;
  error?: string;
}

export interface ScrapeResult {
  symbol: string;
  query?: string;
  total_posts: number;
  platforms: ScrapeplatformResult[];
  scraped_at: string;
}

export interface BatchScrapeResult {
  results: ScrapeResult[];
  total_symbols: number;
  total_posts: number;
  scraped_at: string;
}

export interface IngestPost {
  platform: string;
  text: string;
  id?: string;
  author?: string;
  url?: string;
  created_at?: string;
}

export interface IngestResult {
  ingested: number;
  stored_total: number;
}

export interface TrendingRecomputeResult {
  topics: ClusteredTrendingTopic[];
  count: number;
  timeWindow: string;
}

export interface MultiSourceTrendReport {
  symbol: string;
  signal_sentiment: number;
  signal_engagement: number;
  signal_recency: number;
  signal_authority: number;
  signal_composite: number;
  trend_direction: TrendDirection;
  trend_strength: TrendStrength;
  velocity: number;
  mention_count_24h: number;
  unique_sources: number;
  sentiment_distribution: { BULL: number; NEUTRAL: number; BEAR: number };
  top_sources: SourceBreakdownEntry[];
  top_hashtags: string[];
  trending_keywords: string[];
  recent_items: ScoredSocialItem[];
  comparison: {
    score_24h_ago: number | null;
    score_7d_ago: number | null;
    trend_acceleration: 'accelerating' | 'decelerating' | 'stable';
  };
  computed_at: string;
}
