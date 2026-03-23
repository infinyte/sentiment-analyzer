/**
 * Scraper BullMQ queue.
 *
 * Producers (API process cron + refresh endpoint) call `getScraperQueue()` to
 * enqueue a scrape run.  Consumers (scraper-worker-process) create a `Worker`
 * against the same queue name.
 */

import { Queue } from 'bullmq';
import { createConnectionOptions } from './connection.js';

// ── Job payload ───────────────────────────────────────────────────────────────

export interface ScraperJobData {
  /** Coin symbols to scrape. Empty array means "scrape default top coins". */
  targets:  string[];
  rss_only: boolean;
}

// ── Queue singleton ───────────────────────────────────────────────────────────

let _queue: Queue<ScraperJobData> | null = null;

export function getScraperQueue(): Queue<ScraperJobData> {
  if (!_queue) {
    _queue = new Queue<ScraperJobData>('scraper', {
      connection: createConnectionOptions(),
      defaultJobOptions: {
        attempts:         1,
        removeOnComplete: 50,
        removeOnFail:     50,
      },
    });
  }
  return _queue;
}

export async function closeScraperQueue(): Promise<void> {
  if (_queue) {
    const q = _queue;
    _queue = null;
    await q.close();
  }
}
