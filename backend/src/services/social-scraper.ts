/**
 * Social Media Scraping Engine
 *
 * Collects raw posts from Reddit, Stocktwits, and X (Twitter).
 * Features:
 *   - Per-platform rate limiting via token-bucket throttling
 *   - 24-hour deduplication store (avoids reprocessing seen post IDs)
 *   - Normalised ScrapedPost output across all platforms
 *   - Optional platform filtering per scrape call
 */

import logger from '../logger.js';
import { appConfigService } from './app-config-service.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SocialPlatform = 'reddit' | 'x' | 'stocktwits';

export interface ScrapedPost {
  id: string;
  platform: SocialPlatform;
  platform_label: string;
  text: string;
  title?: string;
  url: string;
  author?: string;
  published_at: string; // ISO 8601
  likes: number;
  comments: number;
  shares: number;
}

export interface PlatformScrapeResult {
  platform: SocialPlatform;
  posts: ScrapedPost[];
  fetched_at: string;
  error?: string;
}

export interface SocialScrapeResult {
  symbol: string;
  query: string;
  platforms: PlatformScrapeResult[];
  total_posts: number;
  new_posts: number; // posts not seen in the dedup window
  scraped_at: string;
}

interface RedditScrapePost {
  id?: string;
  subreddit?: string;
  title?: string;
  selftext?: string;
  permalink?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
}

interface RedditScrapeResponse {
  data?: {
    children?: Array<{ data?: RedditScrapePost }>;
  };
}

interface StocktwitsMessage {
  id?: number | string;
  body?: string;
  created_at?: string;
  user?: { username?: string };
  likes?: { total?: number };
  reshares?: { reshared_count?: number };
}

interface StocktwitsResponse {
  messages?: StocktwitsMessage[];
}

interface XScrapeTweet {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  };
}

interface XScrapeResponse {
  data?: XScrapeTweet[];
}

// ── Rate limiter ───────────────────────────────────────────────────────────────

class RateLimiter {
  private readonly lastCall = new Map<string, number>();

  async throttle(key: string, minIntervalMs: number): Promise<void> {
    const elapsed = Date.now() - (this.lastCall.get(key) ?? 0);
    if (elapsed < minIntervalMs) {
      await new Promise<void>(resolve => setTimeout(resolve, minIntervalMs - elapsed));
    }
    this.lastCall.set(key, Date.now());
  }
}

// ── 24-hour deduplication store ────────────────────────────────────────────────

class SeenPostStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs = 24 * 60 * 60 * 1000;

  has(id: string): boolean {
    const ts = this.seen.get(id);
    if (ts == null) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.seen.delete(id);
      return false;
    }
    return true;
  }

  add(id: string): void {
    this.seen.set(id, Date.now());
    if (this.seen.size > 50_000) {
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, v] of this.seen) {
        if (v < cutoff) this.seen.delete(k);
      }
    }
  }

  get size(): number { return this.seen.size; }
}

// ── Platform adapter interface ─────────────────────────────────────────────────

interface PlatformAdapter {
  readonly platform: SocialPlatform;
  scrape(symbol: string, query: string): Promise<ScrapedPost[]>;
}

// ── Reddit adapter ─────────────────────────────────────────────────────────────

const CRYPTO_SUBREDDITS = [
  'CryptoCurrency', 'CryptoMarkets', 'CryptoMoonShots',
  'Bitcoin', 'ethereum', 'altcoin', 'SatoshiStreetBets',
].join('+');

class RedditAdapter implements PlatformAdapter {
  readonly platform = 'reddit' as const;

  async scrape(symbol: string, query: string): Promise<ScrapedPost[]> {
    try {
      const q = encodeURIComponent(`${symbol} ${query}`.trim());
      const url =
        `https://www.reddit.com/r/${CRYPTO_SUBREDDITS}/search.json` +
        `?q=${q}&sort=new&t=day&limit=25&restrict_sr=1`;

      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'sentiment-analyzer/1.0' },
      });

      if (!response.ok) {
        logger.warn('reddit scrape non-ok', { symbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as RedditScrapeResponse;
      return (data?.data?.children ?? []).map((entry): ScrapedPost | null => {
        const p = entry.data ?? {};
        if (!p.id) return null;
        return {
          id: `reddit-${p.id}`,
          platform: 'reddit',
          platform_label: `r/${p.subreddit ?? 'reddit'}`,
          text: [p.title, p.selftext].filter(Boolean).join('\n'),
          title: p.title || '',
          url: p.permalink ? `https://www.reddit.com${p.permalink}` : '',
          author: p.author,
          published_at: p.created_utc
            ? new Date(p.created_utc * 1000).toISOString()
            : new Date().toISOString(),
          likes: p.score ?? 0,
          comments: p.num_comments ?? 0,
          shares: 0,
        };
      }).filter(Boolean) as ScrapedPost[];
    } catch (err) {
      logger.warn('reddit scrape error', { symbol, error: String(err) });
      return [];
    }
  }
}

// ── Stocktwits adapter ──────────────────────────────────────────────────────────
// Public API — no auth needed. Crypto symbols use the ".X" suffix (e.g. BTC.X).

class StocktwitsAdapter implements PlatformAdapter {
  readonly platform = 'stocktwits' as const;

  async scrape(symbol: string, _query: string): Promise<ScrapedPost[]> {
    try {
      const stSymbol = `${symbol.toUpperCase()}.X`;
      const response = await fetch(
        `https://api.stocktwits.com/api/2/streams/symbol/${stSymbol}.json?limit=30`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        logger.warn('stocktwits scrape non-ok', { symbol: stSymbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as StocktwitsResponse;
      return (data?.messages ?? []).map((msg): ScrapedPost => ({
        id: `stocktwits-${msg.id}`,
        platform: 'stocktwits',
        platform_label: 'Stocktwits',
        text: msg.body || '',
        url: msg.user?.username
          ? `https://stocktwits.com/${msg.user.username}/message/${msg.id}`
          : `https://stocktwits.com/symbol/${stSymbol}`,
        author: msg.user?.username,
        published_at: msg.created_at
          ? new Date(msg.created_at).toISOString()
          : new Date().toISOString(),
        likes: msg.likes?.total ?? 0,
        comments: 0,
        shares: msg.reshares?.reshared_count ?? 0,
      }));
    } catch (err) {
      logger.warn('stocktwits scrape error', { symbol, error: String(err) });
      return [];
    }
  }
}

// ── X (Twitter) adapter ─────────────────────────────────────────────────────────
// Requires X_BEARER_TOKEN or TWITTER_BEARER_TOKEN env var. Silently skips otherwise.

class XAdapter implements PlatformAdapter {
  readonly platform = 'x' as const;

  private get bearerToken(): string {
    return appConfigService.get('X_BEARER_TOKEN') ?? appConfigService.get('TWITTER_BEARER_TOKEN') ?? '';
  }

  async scrape(symbol: string, _query: string): Promise<ScrapedPost[]> {
    if (!this.bearerToken) return [];

    try {
      const q = encodeURIComponent(
        `(${symbol} OR #${symbol} OR $${symbol}) lang:en -is:retweet`
      );
      const response = await fetch(
        `https://api.twitter.com/2/tweets/search/recent` +
        `?query=${q}&max_results=25&tweet.fields=created_at,public_metrics,author_id`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${this.bearerToken}` } }
      );

      if (!response.ok) {
        logger.warn('x scrape non-ok', { symbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as XScrapeResponse;
      return (data?.data ?? []).map((tweet): ScrapedPost => ({
        id: `x-${tweet.id}`,
        platform: 'x',
        platform_label: 'X (Twitter)',
        text: tweet.text || '',
        url: tweet.id ? `https://x.com/i/web/status/${tweet.id}` : '',
        author: tweet.author_id,
        published_at: tweet.created_at ?? new Date().toISOString(),
        likes: tweet.public_metrics?.like_count ?? 0,
        comments: tweet.public_metrics?.reply_count ?? 0,
        shares: tweet.public_metrics?.retweet_count ?? 0,
      }));
    } catch (err) {
      logger.warn('x scrape error', { symbol, error: String(err) });
      return [];
    }
  }
}

// ── Social Scraper Service ──────────────────────────────────────────────────────

/** Minimum milliseconds between successive calls per platform. */
const RATE_INTERVALS: Record<SocialPlatform, number> = {
  reddit:     2_000,
  stocktwits: 1_000,
  x:          3_000,
};

export class SocialScraperService {
  private readonly rateLimiter = new RateLimiter();
  private readonly seen = new SeenPostStore();
  private readonly adapters: PlatformAdapter[];

  constructor(enabledPlatforms?: SocialPlatform[]) {
    const all: PlatformAdapter[] = [
      new RedditAdapter(),
      new StocktwitsAdapter(),
      new XAdapter(),
    ];
    this.adapters = enabledPlatforms
      ? all.filter(a => enabledPlatforms.includes(a.platform))
      : all;
  }

  /**
   * Scrape all (or selected) platforms for a single symbol.
   * @param symbol    Coin ticker (e.g. "BTC")
   * @param query     Optional extra search keywords (defaults to symbol)
   * @param platforms Subset of platforms to hit; omit for all enabled adapters
   */
  async scrape(
    symbol: string,
    query?: string,
    platforms?: SocialPlatform[]
  ): Promise<SocialScrapeResult> {
    const effectiveQuery = query ?? symbol;
    const activeAdapters = platforms
      ? this.adapters.filter(a => platforms.includes(a.platform))
      : this.adapters;

    const platformResults = await Promise.all(
      activeAdapters.map(async (adapter): Promise<PlatformScrapeResult> => {
        await this.rateLimiter.throttle(adapter.platform, RATE_INTERVALS[adapter.platform]);
        try {
          const raw = await adapter.scrape(symbol, effectiveQuery);
          const fresh = raw.filter(p => !this.seen.has(p.id));
          fresh.forEach(p => this.seen.add(p.id));
          return { platform: adapter.platform, posts: fresh, fetched_at: new Date().toISOString() };
        } catch (err) {
          const msg = String(err);
          logger.error('adapter scrape failed', { platform: adapter.platform, symbol, error: msg });
          return {
            platform: adapter.platform,
            posts: [],
            fetched_at: new Date().toISOString(),
            error: msg,
          };
        }
      })
    );

    const allPosts = platformResults.flatMap(r => r.posts);
    return {
      symbol,
      query: effectiveQuery,
      platforms: platformResults,
      total_posts: allPosts.length,
      new_posts: allPosts.length,
      scraped_at: new Date().toISOString(),
    };
  }

  /**
   * Scrape multiple symbols sequentially (respects per-platform rate limits).
   */
  async scrapeBatch(
    symbols: string[],
    query?: string,
    platforms?: SocialPlatform[]
  ): Promise<SocialScrapeResult[]> {
    const results: SocialScrapeResult[] = [];
    for (const symbol of symbols) {
      results.push(await this.scrape(symbol, query, platforms));
    }
    return results;
  }

  get seenPostCount(): number { return this.seen.size; }
}
