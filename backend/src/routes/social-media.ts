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
import type { SocialSource } from '../types/social-media.js';
import logger from '../logger.js';

const router = Router();

const scraperManager = new SocialMediaScraperManager();
const discoveryEngine = new TrendingTopicDiscoveryEngine();
const trendCalculator = new MultiSourceTrendingScoreCalculator();

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

    res.json({
      timeWindow: `${timeWindow}h`,
      count: topics.length,
      topics: topics.map((t, i) => ({
        rank: i + 1,
        topic: t.topic,
        topic_type: t.topic_type,
        coin_symbol: t.coin_symbol,
        mention_count: t.mention_count,
        unique_sources: t.unique_sources,
        signal_composite: t.signal_composite,
        signal_sentiment: t.signal_sentiment,
        velocity: t.velocity,
        trend_direction:
          t.signal_sentiment > 65 ? 'BULLISH'
          : t.signal_sentiment < 40 ? 'BEARISH' : 'NEUTRAL',
        last_updated: t.last_updated,
      })),
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
    const minScore   = req.query.min_score ? parseFloat(req.query.min_score as string) : undefined;
    const sinceHours = req.query.since_hours ? parseInt(req.query.since_hours as string) : 24;

    const result = socialStore.queryItems({ coin, source, sort, limit, offset, minScore, sinceHours });

    res.json({
      coin: coin?.toUpperCase(),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
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
        score_sentiment:  item.score_sentiment,
        score_engagement: item.score_engagement,
        score_authority:  item.score_authority,
        score_recency:    item.score_recency,
        score_composite:  item.score_composite,
        weights: { sentiment: '30%', engagement: '25%', authority: '25%', recency: '20%' },
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
          if (targets.length === 0) {
            // Fallback: refresh RSS only when no symbols specified
            await scraperManager.refreshRssAll();
          } else {
            const results = await scraperManager.fetchBatch(targets);
            const total = results.reduce((s, r) => s + r.items_scraped, 0);
            logger.info('social refresh: batch complete', { symbols: targets.length, total });
          }
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
