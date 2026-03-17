/**
 * Trending Topic Discovery Engine
 *
 * Aggregates social posts across sources, extracts crypto entities
 * (coin symbols, hashtags), and ranks them by a composite trending score
 * that combines:
 *   - Volume  — total mentions in the current window
 *   - Velocity — (current window count − prior window count) / max(prior, 1)
 *   - Source diversity — distinct platforms mentioning the topic
 *
 * Time windows are sliding (not fixed buckets).  Posts are stored in a
 * 48-hour in-memory ring; velocity is computed by comparing the current
 * window [now-W, now] to the prior window [now-2W, now-W].
 */

import logger from '../logger.js';
import type { ScrapedPost, SocialScraperService } from './social-scraper.js';

// ── Public types ───────────────────────────────────────────────────────────────

export type TopicType = 'coin' | 'hashtag';

export interface TrendingTopic {
  topic: string;
  topic_type: TopicType;
  /** Total mentions inside the current window. */
  volume: number;
  /** Growth rate vs prior window: (current − prior) / max(prior, 1). */
  velocity: number;
  /** Aggregate sentiment in [-1, 1]; positive = bullish signals dominant. */
  sentiment_score: number;
  /** Number of distinct platforms mentioning the topic. */
  source_count: number;
  sources: string[];
  sample_posts: Array<{
    text: string;
    url: string;
    platform: string;
    published_at: string;
  }>;
  first_seen: string;
  last_seen: string;
  /** Composite [0, 100] ranking score. */
  trending_score: number;
}

export interface TrendingTopicsResult {
  window_hours: number;
  topics: TrendingTopic[];
  total_posts_analyzed: number;
  prior_window_posts: number;
  computed_at: string;
}

// ── Crypto entity dictionary ───────────────────────────────────────────────────

/** Top-100 crypto tickers used for entity extraction. */
const CRYPTO_SYMBOLS = new Set([
  'BTC','ETH','BNB','XRP','ADA','SOL','DOT','DOGE','AVAX','SHIB',
  'MATIC','LTC','UNI','LINK','TRX','ATOM','XLM','ETC','FIL','NEAR',
  'ALGO','VET','ICP','FTM','SAND','MANA','AXS','THETA','XMR','ZEC',
  'HBAR','EGLD','FLOW','CAKE','STX','KSM','DASH','NEO','WAVES','AAVE',
  'COMP','SNX','YFI','CRV','BAL','SUSHI','GRT','INJ','OP','ARB',
  'APT','SUI','SEI','TIA','PYTH','JUP','WIF','PEPE','FLOKI','BONK',
  'TON','NOT','BLAST','ZK','STRK','MANTA','TAIKO','SCROLL','LINEA','BASE',
]);

const POSITIVE_TERMS = new Set([
  'surge','rally','bullish','moon','pump','buy','accumulate','breakout',
  'ath','adoption','partnership','launch','upgrade','inflow','record',
]);

const NEGATIVE_TERMS = new Set([
  'crash','dump','bearish','sell','fud','hack','scam','fraud','ban',
  'liquidation','rug','rugpull','exploit','lawsuit','regulation','decline',
]);

// ── Internal post store ────────────────────────────────────────────────────────

/** A ScrapedPost enriched with the wall-clock time it was stored. */
interface StoredPost extends ScrapedPost {
  stored_at: number; // epoch ms
}

/** Rolling 48-hour buffer of ingested posts. */
class PostStore {
  private readonly posts: StoredPost[] = [];
  private readonly maxAgeMs = 48 * 60 * 60 * 1000;

  add(incoming: ScrapedPost[]): void {
    const now = Date.now();
    for (const p of incoming) {
      this.posts.push({ ...p, stored_at: now });
    }
    this.prune();
  }

  /** Posts in [now - windowHours*h, now]. */
  currentWindow(windowHours: number): StoredPost[] {
    const cutoff = Date.now() - windowHours * 3_600_000;
    return this.posts.filter(p => p.stored_at >= cutoff);
  }

  /** Posts in [now - 2*windowHours*h, now - windowHours*h]. */
  priorWindow(windowHours: number): StoredPost[] {
    const now = Date.now();
    const windowMs = windowHours * 3_600_000;
    const end   = now - windowMs;
    const start = now - 2 * windowMs;
    return this.posts.filter(p => p.stored_at >= start && p.stored_at < end);
  }

  get count(): number { return this.posts.length; }

  private prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    while (this.posts.length > 0 && this.posts[0].stored_at < cutoff) {
      this.posts.shift();
    }
  }
}

// ── Entity extraction ──────────────────────────────────────────────────────────

interface ExtractedEntities {
  coins: string[];
  hashtags: string[];
}

function extractEntities(text: string): ExtractedEntities {
  const words = text.split(/\s+/);

  const coins = Array.from(new Set(
    words
      .map(w => w.replace(/^[$#]/, '').replace(/[^A-Za-z]/g, '').toUpperCase())
      .filter(w => w.length >= 2 && w.length <= 6 && CRYPTO_SYMBOLS.has(w))
  ));

  const hashtags = Array.from(new Set(
    words
      .filter(w => w.startsWith('#'))
      .map(w => w.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
      .filter(h => h.length > 1 && h.length <= 30)
  ));

  return { coins, hashtags };
}

function postSentiment(text: string): number {
  const lower = text.toLowerCase();
  const pos = Array.from(POSITIVE_TERMS).filter(t => lower.includes(t)).length;
  const neg = Array.from(NEGATIVE_TERMS).filter(t => lower.includes(t)).length;
  const total = pos + neg;
  return total === 0 ? 0 : (pos - neg) / total;
}

// ── Entity accumulator ─────────────────────────────────────────────────────────

interface EntityAccum {
  type: TopicType;
  volume: number;
  sentimentSum: number;
  sources: Set<string>;
  samplePosts: StoredPost[];
  firstSeen: string;
  lastSeen: string;
}

function upsertEntity(
  map: Map<string, EntityAccum>,
  key: string,
  type: TopicType,
  post: StoredPost,
  sentiment: number
): void {
  const existing = map.get(key);
  if (existing) {
    existing.volume++;
    existing.sentimentSum += sentiment;
    existing.sources.add(post.platform_label);
    if (post.published_at < existing.firstSeen) existing.firstSeen = post.published_at;
    if (post.published_at > existing.lastSeen)  existing.lastSeen  = post.published_at;
    if (existing.samplePosts.length < 5) existing.samplePosts.push(post);
  } else {
    map.set(key, {
      type,
      volume: 1,
      sentimentSum: sentiment,
      sources: new Set([post.platform_label]),
      samplePosts: [post],
      firstSeen: post.published_at,
      lastSeen:  post.published_at,
    });
  }
}

function buildEntityMap(posts: StoredPost[]): Map<string, EntityAccum> {
  const map = new Map<string, EntityAccum>();
  for (const post of posts) {
    const fullText = [post.title, post.text].filter(Boolean).join(' ');
    const { coins, hashtags } = extractEntities(fullText);
    const sentiment = postSentiment(fullText);
    for (const coin of coins)           upsertEntity(map, coin, 'coin',    post, sentiment);
    for (const tag  of hashtags.slice(0, 3)) upsertEntity(map, tag, 'hashtag', post, sentiment);
  }
  return map;
}

// ── Trending Topics Engine ─────────────────────────────────────────────────────

export class TrendingTopicsEngine {
  private readonly store = new PostStore();

  // ── Ingestion ────────────────────────────────────────────────────────────────

  /** Directly add pre-collected posts (e.g. from ContentSignalService). */
  ingestPosts(posts: ScrapedPost[]): void {
    this.store.add(posts);
    logger.debug('trending-topics: ingested posts', { count: posts.length });
  }

  /**
   * Scrape multiple symbols then ingest the results.
   * Intended for use by cron jobs.
   */
  async scrapeAndIngest(
    symbols: string[],
    scraper: SocialScraperService
  ): Promise<{ ingested: number; symbols: number }> {
    const results = await scraper.scrapeBatch(symbols);
    const allPosts = results.flatMap(r => r.platforms.flatMap(p => p.posts));
    this.store.add(allPosts);
    logger.info('trending-topics: scrape+ingest complete', {
      symbolCount: symbols.length,
      postCount: allPosts.length,
      storeSize: this.store.count,
    });
    return { ingested: allPosts.length, symbols: symbols.length };
  }

  // ── Analysis ─────────────────────────────────────────────────────────────────

  /**
   * Compute trending topics for the given time window.
   *
   * @param windowHours  Look-back window (default 4 h). Velocity is compared to
   *                     the equal-length window immediately before this one.
   * @param topN         Maximum number of topics to return (default 20).
   * @param minVolume    Discard topics with fewer mentions than this (default 2).
   */
  getTrendingTopics(
    windowHours = 4,
    topN = 20,
    minVolume = 2
  ): TrendingTopicsResult {
    const current = this.store.currentWindow(windowHours);
    const prior   = this.store.priorWindow(windowHours);

    const currentMap = buildEntityMap(current);
    const priorMap   = buildEntityMap(prior);

    const topics: TrendingTopic[] = [];

    for (const [entity, data] of currentMap.entries()) {
      if (data.volume < minVolume) continue;

      const priorVolume = priorMap.get(entity)?.volume ?? 0;
      const velocity = (data.volume - priorVolume) / Math.max(priorVolume, 1);

      // Normalise each component to [0, 1]
      const normVolume   = Math.min(data.volume / 50, 1);
      const normVelocity = Math.min(Math.max(velocity, 0), 5) / 5;
      const normDiversity = Math.min(data.sources.size / 3, 1);

      const trendingScore = parseFloat(
        ((normVolume * 0.35 + normVelocity * 0.45 + normDiversity * 0.20) * 100).toFixed(2)
      );

      topics.push({
        topic: entity,
        topic_type: data.type,
        volume: data.volume,
        velocity: parseFloat(velocity.toFixed(3)),
        sentiment_score: parseFloat(
          (data.sentimentSum / Math.max(data.volume, 1)).toFixed(3)
        ),
        source_count: data.sources.size,
        sources: Array.from(data.sources),
        sample_posts: data.samplePosts.slice(0, 3).map(p => ({
          text: p.text.slice(0, 200),
          url: p.url,
          platform: p.platform_label,
          published_at: p.published_at,
        })),
        first_seen: data.firstSeen,
        last_seen:  data.lastSeen,
        trending_score: trendingScore,
      });
    }

    topics.sort((a, b) => b.trending_score - a.trending_score);

    return {
      window_hours: windowHours,
      topics: topics.slice(0, topN),
      total_posts_analyzed: current.length,
      prior_window_posts: prior.length,
      computed_at: new Date().toISOString(),
    };
  }

  get storedPostCount(): number { return this.store.count; }
}
