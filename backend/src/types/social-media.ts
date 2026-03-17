/**
 * Shared type definitions for the social media scraping + scoring pipeline.
 */

// ── Source identifiers ────────────────────────────────────────────────────────

export type SocialSource = 'twitter' | 'reddit' | 'rss' | 'tiktok' | 'discord' | 'telegram' | 'youtube';

// ── Raw scraped item (before scoring) ────────────────────────────────────────

export interface SocialMediaItem {
  /** UUID generated at scrape time. */
  id: string;
  source: SocialSource;
  /** Original ID from the platform (tweet_id, post_id, article URL, etc.). */
  source_id: string;
  /** Full text of the post / headline + description. */
  content: string;
  /** Optional separate headline (RSS, Reddit title). */
  title?: string;
  author?: string;
  /** Follower/subscriber count for the author, when available. */
  author_followers?: number;
  engagement_likes: number;
  engagement_shares: number;
  engagement_comments: number;
  /** Views/impressions — available on Twitter and TikTok. */
  engagement_views?: number;
  /** When the content was originally published on the platform. */
  content_created_at: string; // ISO 8601
  /** When we fetched it from the API. */
  fetched_at: string;
  url: string;
  /** Coin tickers extracted from content — populated by CoinExtractor. */
  coins_mentioned: string[];
  /** Extra platform-specific fields (subreddit, etc.). */
  metadata: Record<string, unknown>;
}

// ── Scored item (after scoring pipeline) ─────────────────────────────────────

export interface ScoredSocialItem extends SocialMediaItem {
  /** Raw sentiment in [-1, 1]. */
  sentiment_score: number;
  /** Confidence in the sentiment reading [0, 1]. */
  sentiment_confidence: number;
  /** Scaled sentiment signal [0, 100]. */
  score_sentiment: number;
  /** Scaled engagement signal [0, 100]. */
  score_engagement: number;
  /** Scaled recency signal [0, 100]. */
  score_recency: number;
  /** Scaled source/author authority signal [0, 100]. */
  score_authority: number;
  /** Composite weighted signal [0, 100]. */
  score_composite: number;
  last_updated: string;
}

// ── Trending topic ────────────────────────────────────────────────────────────

export type TopicType = 'coin' | 'hashtag' | 'keyword';

export interface TrendingTopicRecord {
  id: string;
  topic: string;
  topic_type: TopicType;
  /** Filled when topic_type === 'coin'. */
  coin_symbol?: string;
  mention_count: number;
  unique_sources: number;
  signal_sentiment: number;
  signal_engagement: number;
  signal_recency: number;
  signal_authority: number;
  signal_composite: number;
  velocity: number; // mentions per hour
  peak_time: string;
  last_updated: string;
  created_at: string;
}

// ── Source metadata ───────────────────────────────────────────────────────────

export type SourceStatus = 'healthy' | 'rate_limited' | 'error' | 'idle';

export interface SourceMetadata {
  source: SocialSource;
  last_fetch_timestamp: string;
  items_fetched_today: number;
  error_count: number;
  status: SourceStatus;
  next_retry?: string;
}

// ── Multi-source trend report ─────────────────────────────────────────────────

export type TrendDirection = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export type TrendStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export interface SourceBreakdown {
  source: SocialSource;
  mentions: number;
  avg_engagement: number;
  avg_authority: number;
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
  top_sources: SourceBreakdown[];
  top_hashtags: string[];
  trending_keywords: string[];
  recent_items: Array<{
    id: string;
    source: SocialSource;
    author?: string;
    content: string;
    score_composite: number;
    published_at: string;
    url: string;
  }>;
  comparison: {
    score_24h_ago: number | null;
    score_7d_ago: number | null;
    trend_acceleration: 'accelerating' | 'stable' | 'decelerating';
  };
  computed_at: string;
}
