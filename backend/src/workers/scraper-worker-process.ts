/**
 * Scraper Worker Process
 *
 * Stand-alone Node.js process that consumes the `scraper` BullMQ queue and
 * executes social-media scraping runs.  Extracts heavy I/O scraping out of
 * the API server process.
 *
 * Start (dev):   npx tsx src/workers/scraper-worker-process.ts
 * Start (prod):  node dist/workers/scraper-worker-process.js
 *
 * Required env vars:
 *   REDIS_URL     — Redis connection URL (shared with API process)
 *   DATABASE_PATH — Path to SQLite file (shared with API process; WAL mode
 *                   allows concurrent access from API + scraper processes)
 *
 * Optional:
 *   SCRAPER_WORKER_CONCURRENCY — number of concurrent scrape jobs (default 1)
 *   TRENDING_WINDOW_HOURS      — hours for trending topic window (default 24)
 *   SOCIAL_HISTORY_DAYS        — days of history to retain (default 30)
 */

import { Worker } from 'bullmq';
import { SocialMediaScraperManager } from '../services/social-media/scraper/scraper-manager.js';
import { TrendingTopicDiscoveryEngine } from '../services/social-media/trending/trending-discovery-engine.js';
import { socialStore } from '../database/sqlite-social-store.js';
import { storage } from '../storage.js';
import { appConfigService } from '../services/app-config-service.js';
import type { ScraperJobData } from '../queues/scraper.queue.js';
import { createConnectionOptions } from '../queues/connection.js';
import logger from '../logger.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

logger.info('[scraper-worker] starting up');

try {
  storage.connect();
  if (storage.isHealthy()) {
    appConfigService.init(storage.getDb()!);
    logger.info('[scraper-worker] app-config-service initialized');
  }
} catch (err) {
  logger.warn('[scraper-worker] storage unavailable for app-config initialization', { error: String(err) });
}

const scraperManager  = new SocialMediaScraperManager();
const discoveryEngine = new TrendingTopicDiscoveryEngine();

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker<ScraperJobData>(
  'scraper',
  async (job) => {
    const { targets, rss_only } = job.data;

    if (rss_only) {
      const count = await scraperManager.refreshRssAll();
      logger.info('[scraper-worker] rss refresh complete', { jobId: job.id, count });
      return;
    }

    const scrapeResult = await scraperManager.scrapeAll(targets);
    logger.info('[scraper-worker] scrape complete', {
      jobId:          job.id,
      symbols:        targets.length,
      rss:            scrapeResult.rss_items,
      discord:        scrapeResult.discord_items,
      telegram:       scrapeResult.telegram_items,
      total_scraped:  scrapeResult.total_items_scraped,
      total_stored:   scrapeResult.total_items_stored,
      duration_ms:    scrapeResult.duration_ms,
    });

    // Recompute trending topics in DB after fresh scrape
    const trendWindow = parseInt(appConfigService.get('TRENDING_WINDOW_HOURS') ?? '24', 10);
    const topics = await discoveryEngine.discoverTrends(trendWindow, 30);
    logger.info('[scraper-worker] trending topics updated', { count: topics.length });

    // Prune old items
    const retainDays = parseInt(appConfigService.get('SOCIAL_HISTORY_DAYS') ?? '30', 10);
    const pruned = socialStore.pruneOldItems(retainDays);
    if (pruned > 0) {
      logger.info('[scraper-worker] pruned old items', { count: pruned });
    }
  },
  {
    connection:  createConnectionOptions(),
    concurrency: parseInt(process.env['SCRAPER_WORKER_CONCURRENCY'] ?? '1', 10),
  },
);

// ── Error handling ────────────────────────────────────────────────────────────

worker.on('failed', (job, err) => {
  logger.error('[scraper-worker] job failed', {
    jobId:   job?.id,
    targets: job?.data.targets,
    error:   String(err),
  });
});

worker.on('error', (err) => {
  logger.error('[scraper-worker] worker error', { error: String(err) });
});

logger.info('[scraper-worker] ready — waiting for jobs');

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info('[scraper-worker] received signal, shutting down', { signal });
  await worker.close();
  logger.info('[scraper-worker] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
