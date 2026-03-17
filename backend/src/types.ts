// Shared type definitions

export interface TrendingSentiment {
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  composite_score: number;
  velocity: number;
  mention_count: number;
  unique_sources: number;
  signals: {
    sentiment: number;
    engagement: number;
    authority: number;
    recency: number;
  };
}

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  volatility_7d: number;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  sentiment_summary: string;
  trending_score: number;
  trending_sentiment?: TrendingSentiment;
  timestamp: Date;
  market_rank: number;
}

export interface Sentiment {
  symbol: string;
  analysis_date: string;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  key_catalysts: string[];
  risk_factors: string[];
  short_term_outlook: string;
  volatility_warning: boolean;
  trending_score: number;
  scored_items?: ScoredSentimentItem[];
  source_breakdown?: SentimentSourceBreakdown[];
  collection_stats?: SentimentCollectionStats;
}

export type SentimentContentSource = 'newsapi' | 'reddit' | 'x';

export interface ScoredSentimentItem {
  id: string;
  source: SentimentContentSource;
  source_label: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  published_at?: string;
  engagement_score: number;
  recency_score: number;
  relevance_score: number;
  keyword_score: number;
  sentiment_score: number;
  weighted_score: number;
  source_weight: number;
  /** True when sarcasm/irony was detected in the content. */
  sarcasm_flagged?: boolean;
  /** True when ABSA context window was used instead of full text. */
  context_window_used?: boolean;
}

export interface SentimentSourceBreakdown {
  source: SentimentContentSource;
  source_label: string;
  item_count: number;
  average_sentiment_score: number;
  average_weighted_score: number;
  weighted_frequency: number;
}

export interface SentimentCollectionStats {
  total_items: number;
  source_count: number;
  weighted_frequency: number;
  average_recency_score: number;
  trending_score: number;
  collected_at: string;
}
