import type {
  ScoredSentimentItem,
  SentimentCollectionStats,
  SentimentContentSource,
  SentimentSourceBreakdown,
} from '../types.js';
import logger from '../logger.js';
import { NewsAPIService } from './newsapi.js';
import { detectSarcasm } from './social-media/scoring/sarcasm-detector.js';
import { normalizeText } from './social-media/scoring/normalize-text.js';

type NormalizedSourceItem = {
  id: string;
  source: SentimentContentSource;
  sourceLabel: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  publishedAt?: string;
  engagementValue?: number;
  sourceWeight: number;
};

type CollectedSignalResult = {
  items: ScoredSentimentItem[];
  aggregateScore: number;
  sourceBreakdown: SentimentSourceBreakdown[];
  collectionStats: SentimentCollectionStats;
};

interface ContentSourceAdapter {
  collect(topic: string, symbol: string, days: number): Promise<NormalizedSourceItem[]>;
}

interface RedditSearchPost {
  id?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
}

interface RedditSearchResponse {
  data?: {
    children?: Array<{ data?: RedditSearchPost }>;
  };
}

interface XSearchTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
  };
}

interface XSearchResponse {
  data?: XSearchTweet[];
}

const POSITIVE_TERMS = [
  'surge', 'rally', 'gain', 'bull', 'bullish', 'breakout', 'approval', 'adoption', 'record', 'high',
  'partnership', 'upgrade', 'inflow', 'accumulation', 'launch', 'growth',
];

const NEGATIVE_TERMS = [
  'drop', 'sell-off', 'bear', 'bearish', 'hack', 'exploit', 'lawsuit', 'ban', 'liquidation', 'outflow',
  'loss', 'decline', 'downgrade', 'fraud', 'delay', 'outage',
];

/**
 * ABSA helper: extract a ±windowSize token window centred on the first
 * occurrence of `target` in `text`.  Returns null when `target` is not found.
 */
function extractContextWindow(text: string, target: string, windowSize = 50): string | null {
  const tokens = text.split(/\s+/);
  const targetLower = target.toLowerCase();
  const idx = tokens.findIndex(t => t.toLowerCase().includes(targetLower));
  if (idx === -1) return null;
  const start = Math.max(0, idx - windowSize);
  const end   = Math.min(tokens.length, idx + windowSize + 1);
  return tokens.slice(start, end).join(' ');
}

class NewsApiContentAdapter implements ContentSourceAdapter {
  constructor(private readonly newsApi: NewsAPIService) {}

  async collect(topic: string, _symbol: string, days: number): Promise<NormalizedSourceItem[]> {
    const articles = await this.newsApi.getArticles(topic, days);
    return articles.map((article, index) => ({
      id: `newsapi-${topic}-${index}`,
      source: 'newsapi',
      sourceLabel: article.sourceName || 'NewsAPI',
      title: article.title,
      body: article.description,
      url: article.url,
      publishedAt: article.publishedAt,
      sourceWeight: 1,
    }));
  }
}

class RedditContentAdapter implements ContentSourceAdapter {
  async collect(topic: string, symbol: string, _days: number): Promise<NormalizedSourceItem[]> {
    try {
      const query = encodeURIComponent(`${topic} ${symbol}`.trim());
      const response = await fetch(
        `https://www.reddit.com/search.json?q=${query}&sort=new&t=week&limit=10`,
        { headers: { Accept: 'application/json', 'User-Agent': 'sentiment-analyzer/1.0' } }
      );

      if (!response.ok) {
        logger.warn('reddit non-ok response', { topic, symbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as RedditSearchResponse;
      const posts = data?.data?.children ?? [];
      return posts.map((entry, index: number) => {
        const post = entry.data ?? {};
        return {
          id: `reddit-${post.id ?? index}`,
          source: 'reddit' as const,
          sourceLabel: 'Reddit',
          title: post.title || '',
          body: post.selftext || '',
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : `https://www.reddit.com/search/?q=${query}`,
          author: post.author,
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined,
          engagementValue: (post.score || 0) + (post.num_comments || 0) * 3,
          sourceWeight: 0.85,
        } satisfies NormalizedSourceItem;
      });
    } catch (error) {
      logger.warn('reddit fetch error', { topic, symbol, error: String(error) });
      return [];
    }
  }
}

class XContentAdapter implements ContentSourceAdapter {
  private readonly bearerToken = process.env.X_BEARER_TOKEN ?? process.env.TWITTER_BEARER_TOKEN ?? '';

  async collect(topic: string, symbol: string, _days: number): Promise<NormalizedSourceItem[]> {
    if (!this.bearerToken) return [];

    try {
      const query = encodeURIComponent(`(${topic} OR ${symbol}) lang:en -is:retweet`);
      const response = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=10&tweet.fields=created_at,public_metrics,text,author_id`,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.bearerToken}`,
          },
        }
      );

      if (!response.ok) {
        logger.warn('x api non-ok response', { topic, symbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as XSearchResponse;
      const tweets = data?.data ?? [];
      return tweets.map((tweet, index: number) => ({
        id: `x-${tweet.id ?? index}`,
        source: 'x',
        sourceLabel: 'X',
        title: tweet.text || '',
        body: tweet.text || '',
        url: tweet.id ? `https://x.com/i/web/status/${tweet.id}` : '',
        author: tweet.author_id,
        publishedAt: tweet.created_at,
        engagementValue: (tweet.public_metrics?.like_count || 0) +
          (tweet.public_metrics?.retweet_count || 0) * 2 +
          (tweet.public_metrics?.reply_count || 0) * 2,
        sourceWeight: 0.9,
      }));
    } catch (error) {
      logger.warn('x api fetch error', { topic, symbol, error: String(error) });
      return [];
    }
  }
}

export class ContentSignalService {
  private readonly adapters: ContentSourceAdapter[];

  constructor(newsApi = new NewsAPIService()) {
    this.adapters = [
      new NewsApiContentAdapter(newsApi),
      new RedditContentAdapter(),
      new XContentAdapter(),
    ];
  }

  async collect(topic: string, symbol: string, days = 7, targetCoin = symbol): Promise<CollectedSignalResult> {
    const sourceItems = await Promise.all(this.adapters.map(adapter => adapter.collect(topic, symbol, days)));
    const normalized = sourceItems
      .flat()
      .filter(item => item.title.trim().length > 0 || item.body.trim().length > 0);

    const scored = normalized
      .map(item => this.scoreItem(item, topic, symbol, targetCoin))
      .sort((left, right) => Math.abs(right.weighted_score) - Math.abs(left.weighted_score));

    const sourceBreakdown = this.buildSourceBreakdown(scored);
    const aggregateScore = this.computeAggregateScore(scored);
    const collectionStats = this.buildCollectionStats(scored);

    return {
      items: scored,
      aggregateScore,
      sourceBreakdown,
      collectionStats,
    };
  }

  private scoreItem(item: NormalizedSourceItem, topic: string, symbol: string, targetCoin: string): ScoredSentimentItem {
    const combinedText = normalizeText(`${item.title} ${item.body}`.trim()).toLowerCase();

    // ── ABSA: extract context window around the target coin mention ────────────
    // targetCoin defaults to symbol so this path is always attempted; falls back
    // to full combinedText when the target token is not found in the article.
    const window = extractContextWindow(combinedText, targetCoin);
    const scoringText = window ?? combinedText;
    const context_window_used = window !== null;

    // ── Sarcasm detection ──────────────────────────────────────────────────────
    const sarcasmResult = detectSarcasm(scoringText);

    // ── Keyword scoring ────────────────────────────────────────────────────────
    let rawKeywordScore = this.clamp(
      POSITIVE_TERMS.filter(term => scoringText.includes(term)).length -
        NEGATIVE_TERMS.filter(term => scoringText.includes(term)).length,
      -4,
      4
    ) / 4;

    // When sarcasm is detected with high confidence, invert the sentiment signal
    if (sarcasmResult.sarcastic && sarcasmResult.confidence >= 0.67) {
      rawKeywordScore = -rawKeywordScore * 0.5; // invert + halve magnitude
    }

    const symbolMatch = combinedText.includes(symbol.toLowerCase()) ? 1 : 0;
    const topicParts = topic.toLowerCase().split(/\s+/).filter(Boolean);
    const topicMatches = topicParts.filter(part => combinedText.includes(part)).length;
    const relevanceScore = this.clamp(0.35 + symbolMatch * 0.35 + Math.min(topicMatches / Math.max(topicParts.length, 1), 1) * 0.3, 0, 1);

    const recencyScore = this.computeRecencyScore(item.publishedAt);
    const engagementScore = this.computeEngagementScore(item.engagementValue ?? 0);
    const sentimentScore = this.clamp(rawKeywordScore * (0.75 + relevanceScore * 0.25), -1, 1);
    const weightedScore = sentimentScore * item.sourceWeight * recencyScore * (0.7 + relevanceScore * 0.3) * (0.85 + engagementScore * 0.15);

    return {
      id: item.id,
      source: item.source,
      source_label: item.sourceLabel,
      title: item.title,
      body: item.body,
      url: item.url,
      author: item.author,
      published_at: item.publishedAt,
      engagement_score: Number(engagementScore.toFixed(3)),
      recency_score: Number(recencyScore.toFixed(3)),
      relevance_score: Number(relevanceScore.toFixed(3)),
      keyword_score: Number(rawKeywordScore.toFixed(3)),
      sentiment_score: Number(sentimentScore.toFixed(3)),
      weighted_score: Number(weightedScore.toFixed(3)),
      source_weight: item.sourceWeight,
      sarcasm_flagged: sarcasmResult.sarcastic,
      context_window_used,
    };
  }

  private buildSourceBreakdown(items: ScoredSentimentItem[]): SentimentSourceBreakdown[] {
    const grouped = new Map<SentimentContentSource, ScoredSentimentItem[]>();

    for (const item of items) {
      const current = grouped.get(item.source) ?? [];
      current.push(item);
      grouped.set(item.source, current);
    }

    return Array.from(grouped.entries()).map(([source, sourceItems]) => ({
      source,
      source_label: sourceItems[0]?.source_label ?? source,
      item_count: sourceItems.length,
      average_sentiment_score: Number((sourceItems.reduce((sum, item) => sum + item.sentiment_score, 0) / sourceItems.length).toFixed(3)),
      average_weighted_score: Number((sourceItems.reduce((sum, item) => sum + item.weighted_score, 0) / sourceItems.length).toFixed(3)),
      weighted_frequency: Number(sourceItems.reduce((sum, item) => sum + item.source_weight * item.recency_score, 0).toFixed(3)),
    }));
  }

  private computeAggregateScore(items: ScoredSentimentItem[]): number {
    if (items.length === 0) return 0;

    const numerator = items.reduce((sum, item) => sum + item.weighted_score, 0);
    const denominator = items.reduce(
      (sum, item) => sum + item.source_weight * item.recency_score * (0.7 + item.relevance_score * 0.3) * (0.85 + item.engagement_score * 0.15),
      0
    );

    if (denominator <= 0) return 0;
    return Number(this.clamp(numerator / denominator, -1, 1).toFixed(3));
  }

  private buildCollectionStats(items: ScoredSentimentItem[]): SentimentCollectionStats {
    const totalItems = items.length;
    const weightedFrequency = items.reduce((sum, item) => sum + item.source_weight * item.recency_score * (0.7 + item.relevance_score * 0.3), 0);
    const averageRecency = totalItems > 0 ? items.reduce((sum, item) => sum + item.recency_score, 0) / totalItems : 0;
    const sourceCount = new Set(items.map(item => item.source)).size;
    const frequencyScore = this.clamp(totalItems / 18, 0, 1);
    const weightedFrequencyScore = this.clamp(weightedFrequency / 12, 0, 1);
    const diversityScore = this.clamp(sourceCount / 3, 0, 1);
    const trendingScore = Number((
      (frequencyScore * 0.45 + weightedFrequencyScore * 0.35 + averageRecency * 0.2) * (0.85 + diversityScore * 0.15) * 100
    ).toFixed(2));

    return {
      total_items: totalItems,
      source_count: sourceCount,
      weighted_frequency: Number(weightedFrequency.toFixed(3)),
      average_recency_score: Number(averageRecency.toFixed(3)),
      trending_score: trendingScore,
      collected_at: new Date().toISOString(),
    };
  }

  private computeRecencyScore(publishedAt?: string): number {
    if (!publishedAt) return 0.45;

    const publishedMs = Date.parse(publishedAt);
    if (Number.isNaN(publishedMs)) return 0.45;

    const ageHours = Math.max(0, (Date.now() - publishedMs) / (1000 * 60 * 60));
    return Number(this.clamp(Math.exp(-ageHours / 72), 0.15, 1).toFixed(3));
  }

  private computeEngagementScore(engagementValue: number): number {
    if (!Number.isFinite(engagementValue) || engagementValue <= 0) return 0;
    return Number(this.clamp(Math.log1p(engagementValue) / Math.log1p(5000), 0, 1).toFixed(3));
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
  }
}