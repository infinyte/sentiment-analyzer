/**
 * IngestQueue — Event-Driven Social Ingest Pipeline (Enhancement #15)
 *
 * A concurrency-limited async queue that processes SocialMediaItem[] payloads
 * through the full pipeline in a consistent order:
 *
 *   1. Bot detection  — BotDetectionService.scoreAll; attaches bot_score to each item
 *   2. Normalisation  — populate coin mentions (extractCoins fallback + targetSymbol pinning)
 *   3. Scoring        — scoreItemsAsync (FinBERT / keyword + engagement + authority + recency)
 *   4. Upsert         — socialStore.upsertItems + incrementFetchCount per source
 *
 * The queue replaces the direct await-chains inside ScrapeManager, decoupling
 * the scraping triggers from the heavy persistence work.  This is the
 * foundation for a future Kafka/Kinesis migration: replacing `push()` with a
 * Kafka producer call only requires changes inside this module.
 *
 * Concurrency defaults to 4 (env: INGEST_QUEUE_CONCURRENCY).
 * Queue depth and per-payload latency are logged at debug level via Winston.
 */

import { EventEmitter } from 'events';
import { extractCoins } from './scoring/coin-extractor.js';
import { botDetectionService } from '../bot-detection.js';
import { scoreItemsAsync } from './scoring/item-scorer.js';
import { socialStore } from '../../database/sqlite-social-store.js';
import { appConfigService } from '../app-config-service.js';
import logger from '../../logger.js';
import type { SocialMediaItem, SocialSource } from '../../types/social-media.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface IngestPayload {
  /** Raw scraped items to process. */
  items: SocialMediaItem[];
  /**
   * When set, this symbol is pinned to the front of `coins_mentioned` on every
   * item that does not already contain it (mirrors `ScrapeManager.populateCoins`).
   */
  targetSymbol?: string;
  /**
   * Source-level item counts used to update `source_metadata.items_fetched_today`.
   * Pass one entry per source that contributed items.
   */
  sourceCounters: Array<{ source: SocialSource; count: number }>;
}

export interface IngestResult {
  /** Number of items successfully written to SQLite. */
  stored: number;
  /** Number of items with bot_score ≥ 0.8 (not filtered from storage, but excluded from trending). */
  botFiltered: number;
  /** Wall-clock time in milliseconds from queue entry to upsert completion. */
  latencyMs: number;
}

// ── IngestQueue ───────────────────────────────────────────────────────────────

type QueueEntry = {
  payload: IngestPayload;
  enqueueTime: number;
  resolve: (result: IngestResult) => void;
  reject: (err: unknown) => void;
};

export class IngestQueue extends EventEmitter {
  private readonly concurrency: number;
  private running = 0;
  private readonly pending: QueueEntry[] = [];

  private _processed = 0;
  private _errors = 0;
  private _totalLatencyMs = 0;

  constructor(concurrency?: number) {
    super();
    const configuredConcurrency = parseInt(appConfigService.get('INGEST_QUEUE_CONCURRENCY') ?? '4', 10) || 4;
    this.concurrency = Math.max(
      1,
      concurrency ?? configuredConcurrency,
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Enqueue a payload for processing.
   *
   * Returns a Promise that resolves with an `IngestResult` once the full
   * pipeline (normalise → bot-detect → score → upsert) completes for
   * this payload.
   */
  push(payload: IngestPayload): Promise<IngestResult> {
    return new Promise<IngestResult>((resolve, reject) => {
      const entry: QueueEntry = {
        payload,
        enqueueTime: Date.now(),
        resolve,
        reject,
      };
      this.pending.push(entry);

      logger.debug('ingest-queue: enqueued', {
        depth: this.pending.length,
        running: this.running,
        items: payload.items.length,
        targetSymbol: payload.targetSymbol ?? null,
      });

      this.emit('enqueue', { depth: this.pending.length, items: payload.items.length });
      this.drain();
    });
  }

  /** Current snapshot of queue health metrics. */
  getStats(): {
    queueDepth: number;
    running: number;
    processed: number;
    errors: number;
    avgLatencyMs: number;
  } {
    return {
      queueDepth: this.pending.length,
      running: this.running,
      processed: this._processed,
      errors: this._errors,
      avgLatencyMs: this._processed > 0
        ? Math.round(this._totalLatencyMs / this._processed)
        : 0,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this.running++;

      logger.debug('ingest-queue: dequeued — starting pipeline', {
        depth: this.pending.length,
        running: this.running,
        items: entry.payload.items.length,
        waitMs: Date.now() - entry.enqueueTime,
      });

      this.processPayload(entry.payload)
        .then(result => {
          this.running--;
          this._processed++;
          this._totalLatencyMs += result.latencyMs;
          entry.resolve(result);
          this.emit('processed', result);
          this.drain();
        })
        .catch(err => {
          this.running--;
          this._errors++;
          entry.reject(err);
          this.emit('error', err);
          this.drain();
        });
    }
  }

  private async processPayload(payload: IngestPayload): Promise<IngestResult> {
    const pipelineStart = Date.now();
    const { items, targetSymbol, sourceCounters } = payload;

    if (items.length === 0) {
      return { stored: 0, botFiltered: 0, latencyMs: 0 };
    }

    // ── 1. Bot detection ────────────────────────────────────────────────────
    const botScores = botDetectionService.scoreAll(items);
    let botFiltered = 0;
    for (const item of items) {
      item.bot_score = botScores.get(item.id)?.score ?? null;
      if ((item.bot_score ?? 0) >= 0.8) botFiltered++;
    }

    // ── 2. Normalisation ────────────────────────────────────────────────────
    // Populate missing coin mentions via CoinExtractor, then pin targetSymbol.
    for (const item of items) {
      if (item.coins_mentioned.length === 0) {
        const fullText = [item.title, item.content].filter(Boolean).join(' ');
        item.coins_mentioned = extractCoins(fullText);
      }
      if (targetSymbol && !item.coins_mentioned.includes(targetSymbol)) {
        item.coins_mentioned.unshift(targetSymbol);
      }
    }

    // ── 3. Scoring ──────────────────────────────────────────────────────────
    const scored = await scoreItemsAsync(items);

    // ── 4. Upsert ───────────────────────────────────────────────────────────
    let stored = 0;
    try {
      stored = socialStore.upsertItems(scored);
      for (const { source, count } of sourceCounters) {
        if (count > 0) socialStore.incrementFetchCount(source, count);
      }
    } catch (err) {
      logger.warn('ingest-queue: upsert error', { error: String(err) });
    }

    const latencyMs = Date.now() - pipelineStart;

    logger.debug('ingest-queue: pipeline complete', {
      items: items.length,
      stored,
      botFiltered,
      latencyMs,
      queueDepth: this.pending.length,
      running: this.running,
    });

    this.emit('payload-complete', { items: items.length, stored, botFiltered, latencyMs });

    return { stored, botFiltered, latencyMs };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const ingestQueue = new IngestQueue();
