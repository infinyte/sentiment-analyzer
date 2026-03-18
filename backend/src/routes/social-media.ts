/**
 * Social Media API Routes
 *
 * GET  /api/social-media/trending-topics  — top trending topics across all sources
 * GET  /api/social-media/items            — paginated scored items (filterable by coin)
 * GET  /api/social-media/item/:id         — single item with full scoring breakdown
 * GET  /api/social-media/stats            — source health + fetch counters
 * GET  /api/trending-score/:symbol        — comprehensive multi-source trend report
 * POST /api/social-media/refresh          — trigger immediate scrape of a coin or batch
 */

import { Router } from 'express';
import { socialStore } from '../database/sqlite-social-store.js';
import { SocialMediaScraperManager } from '../services/social-media/scraper/scraper-manager.js';
import { TrendingTopicDiscoveryEngine } from '../services/social-media/trending/trending-discovery-engine.js';
import { MultiSourceTrendingScoreCalculator } from '../services/social-media/trending/multi-source-calculator.js';
import type { SocialSource, TopicType, TrendingTopicRecord } from '../types/social-media.js';
import logger from '../logger.js';

const router = Router();

const scraperManager = new SocialMediaScraperManager();
const discoveryEngine = new TrendingTopicDiscoveryEngine();
const trendCalculator = new MultiSourceTrendingScoreCalculator();

export interface ClusteredTrendingTopicResponse {
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
  trend_direction: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  last_updated: string;
  cluster_size: number;
  clustered_topics: string[];
}

export function clusterTrendingTopicsForResponse(topics: TrendingTopicRecord[]): ClusteredTrendingTopicResponse[] {
  const groups = new Map<string, TrendingTopicRecord[]>();

  for (const topic of topics) {
    const key = topic.coin_symbol?.toUpperCase() ?? `${topic.topic_type}:${topic.topic.toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(topic);
    groups.set(key, group);
  }

  const clustered = Array.from(groups.values()).map((records) => {
    const sorted = [...records].sort((left, right) => right.signal_composite - left.signal_composite);
    const primary = sorted[0];
    const mentionCount = sorted.reduce((sum, record) => sum + record.mention_count, 0);
    const weightedAverage = (selector: (record: TrendingTopicRecord) => number) => {
      const numerator = sorted.reduce((sum, record) => sum + selector(record) * record.mention_count, 0);
      return mentionCount > 0 ? Number((numerator / mentionCount).toFixed(2)) : 0;
    };

    const signalSentiment = weightedAverage(record => record.signal_sentiment);
    return {
      rank: 0,
      topic: primary.coin_symbol ?? primary.topic,
      primary_topic: primary.topic,
      topic_type: primary.coin_symbol ? 'coin' : primary.topic_type,
      coin_symbol: primary.coin_symbol,
      mention_count: mentionCount,
      unique_sources: Math.max(...sorted.map(record => record.unique_sources)),
      signal_composite: weightedAverage(record => record.signal_composite),
      signal_sentiment: signalSentiment,
      velocity: Number(sorted.reduce((sum, record) => sum + record.velocity, 0).toFixed(3)),
      trend_direction: signalSentiment > 65 ? 'BULLISH' : signalSentiment < 40 ? 'BEARISH' : 'NEUTRAL',
      last_updated: sorted.reduce((latest, record) => latest > record.last_updated ? latest : record.last_updated, sorted[0].last_updated),
      cluster_size: sorted.length,
      clustered_topics: Array.from(new Set(sorted.map(record => record.topic))).sort(),
    } satisfies ClusteredTrendingTopicResponse;
  });

  return clustered
    .sort((left, right) => right.signal_composite - left.signal_composite)
    .map((topic, index) => ({ ...topic, rank: index + 1 }));
}

// ── GET /api/social-media/trending-topics ─────────────────────────────────────

router.get('/api/social-media/trending-topics', async (req, res) => {
  try {
    const timeWindow = Math.min(parseFloat(req.query.timeWindow as string) || 24, 168);
    const limit      = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const topicType  = req.query.type as string | undefined;

    // Try DB first (fast path — no recompute)
    let topics = socialStore.getTrendingTopics(
      limit,
      topicType as 'coin' | 'hashtag' | undefined
    );

    // If DB is empty or stale (>1h old), recompute
    const isStale = topics.length === 0 ||
      (topics[0] && Date.now() - Date.parse(topics[0].last_updated) > 60 * 60 * 1000);

    if (isStale) {
      logger.info('social-media: recomputing trending topics');
      topics = await discoveryEngine.discoverTrends(timeWindow, limit);
    }

    const clustered = clusterTrendingTopicsForResponse(topics);

    res.json({
      timeWindow: `${timeWindow}h`,
      count: clustered.length,
      topics: clustered,
    });
  } catch (err) {
    logger.error('route error', { endpoint: '/api/social-media/trending-topics', error: String(err) });
    res.status(500).json({ error: 'Failed to fetch trending topics' });
  }
});

// ── GET /api/social-media/items ───────────────────────────────────────────────

router.get('/api/social-media/items', (req, res) => {
  try {
    const coin       = req.query.coin as string | undefined;
    const source     = req.query.source as SocialSource | undefined;
    const sort       = (req.query.sort as string) === 'recency' ? 'recency' :
                       (req.query.sort as string) === 'engagement' ? 'engagement' : 'score';
    const limit      = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset     = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const cursor     = req.query.cursor as string | undefined;
    const minScore   = req.query.min_score ? parseFloat(req.query.min_score as string) : undefined;
    const sinceHours = req.query.since_hours ? parseInt(req.query.since_hours as string) : 24;

    const result = socialStore.queryItems({ coin, source, sort, limit, offset, cursor, minScore, sinceHours });

    res.json({
      coin: coin?.toUpperCase(),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      next_cursor: result.nextCursor,
      items: result.items,
    });
  } catch (err) {
    logger.error('route error', { endpoint: '/api/social-media/items', error: String(err) });
    res.status(500).json({ error: 'Failed to query items' });
  }
});

// ── GET /api/social-media/item/:id ────────────────────────────────────────────

router.get('/api/social-media/item/:id', (req, res) => {
  try {
    const item = socialStore.getItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    res.json({
      ...item,
      scoring_breakdown: {
        score_sentiment:     item.score_sentiment,
        score_engagement:    item.score_engagement,
        score_authority:     item.score_authority,
        score_recency:       item.score_recency,
        score_composite:     item.score_composite,
        context_window_used: item.context_window_used ?? false,
        weights: { sentiment: '30%', engagement: '25%', authority: '25%', recency: '20%' },
        feature_attribution: {
          sentiment:  parseFloat((item.score_sentiment  * 0.30).toFixed(4)),
          engagement: parseFloat((item.score_engagement * 0.25).toFixed(4)),
          authority:  parseFloat((item.score_authority  * 0.25).toFixed(4)),
          recency:    parseFloat((item.score_recency    * 0.20).toFixed(4)),
        },
      },
    });
  } catch (err) {
    logger.error('route error', { endpoint: '/api/social-media/item/:id', error: String(err) });
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// ── GET /api/social-media/stats ───────────────────────────────────────────────

router.get('/api/social-media/stats', (req, res) => {
  try {
    const stats = socialStore.getStats();
    res.json(stats);
  } catch (err) {
    logger.error('route error', { endpoint: '/api/social-media/stats', error: String(err) });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/trending-score/:symbol ──────────────────────────────────────────

router.get('/api/trending-score/:symbol', async (req, res) => {
  try {
    const symbol      = req.params.symbol.toUpperCase();
    const intervalHrs = Math.min(parseInt(req.query.interval as string) || 24, 168);

    const report = await trendCalculator.calculate(symbol, intervalHrs);
    res.json(report);
  } catch (err) {
    logger.error('route error', { endpoint: '/api/trending-score/:symbol', error: String(err) });
    res.status(500).json({ error: 'Failed to compute trend score' });
  }
});

// ── POST /api/social-media/refresh ───────────────────────────────────────────

router.post('/api/social-media/refresh', async (req, res) => {
  try {
    const { symbols, rss_only } = req.body as {
      symbols?: string[];
      rss_only?: boolean;
    };

    // Fire-and-forget
    res.status(202).json({
      status: 'refreshing',
      mode: rss_only ? 'rss_only' : 'all_sources',
      symbols: symbols ?? 'top-coins',
    });

    setImmediate(async () => {
      try {
        if (rss_only) {
          const count = await scraperManager.refreshRssAll();
          logger.info('social refresh: rss complete', { count });
        } else {
          const targets = symbols?.map(s => s.toUpperCase()) ?? [];
          const result = await scraperManager.scrapeAll(targets);
          logger.info('social refresh: scrape complete', {
            symbols: targets.length,
            total_scraped: result.total_items_scraped,
            total_stored: result.total_items_stored,
            rss: result.rss_items,
            discord: result.discord_items,
            telegram: result.telegram_items,
          });
          // After scraping, update trending topics
          await discoveryEngine.discoverTrends();
        }
      } catch (err) {
        logger.error('social refresh: background error', { error: String(err) });
      }
    });
  } catch (err) {
    logger.error('route error', { endpoint: '/api/social-media/refresh', error: String(err) });
    res.status(500).json({ error: 'Failed to trigger refresh' });
  }
});

export default router;
