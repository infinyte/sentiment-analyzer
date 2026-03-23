/**
 * Pub/Sub abstraction for real-time competition event broadcasting.
 *
 * Default: in-process EventEmitter — zero dependencies, works immediately.
 * Optional: Redis pub/sub when REDIS_URL is set and ioredis is installed,
 *   enabling fan-out across multiple server instances (horizontal scaling).
 *
 * To enable Redis:  npm install ioredis   and set  REDIS_URL=redis://localhost:6379
 *
 * Usage:
 *   import { getPubSub, competitionChannel } from './pubsub.js';
 *   getPubSub().publish(competitionChannel('comp_123'), { type: 'progress', ... });
 */

import { EventEmitter } from 'node:events';
import logger from '../logger.js';

// ── Domain events ─────────────────────────────────────────────────────────────

export interface CompetitionProgressEvent {
  type:          'progress';
  competitionId: string;
  /** 0–100 */
  progress:      number;
}

export interface CompetitionCompletedEvent {
  type:            'completed';
  competitionId:   string;
  topPerformerId?: string;
}

export interface CompetitionFailedEvent {
  type:          'failed';
  competitionId: string;
  error:         string;
}

export type CompetitionPubSubEvent =
  | CompetitionProgressEvent
  | CompetitionCompletedEvent
  | CompetitionFailedEvent;

// ── Channel helper ────────────────────────────────────────────────────────────

/** Returns the canonical pub/sub channel name for a competition. */
export function competitionChannel(competitionId: string): string {
  return `marl:competition:${competitionId}`;
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IPubSub {
  /** Publish an event. Resolves when dispatched (fire-and-forget is fine). */
  publish(channel: string, event: CompetitionPubSubEvent): Promise<void>;
  /**
   * Subscribe to a channel. Returns an unsubscribe function.
   * Always call the returned function to prevent memory leaks.
   */
  subscribe(channel: string, handler: (event: CompetitionPubSubEvent) => void): () => void;
  close(): Promise<void>;
}

// ── LocalPubSub — EventEmitter, in-process ────────────────────────────────────

class LocalPubSub implements IPubSub {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Suppress MaxListenersExceededWarning for servers with many SSE connections.
    this.emitter.setMaxListeners(0);
  }

  async publish(channel: string, event: CompetitionPubSubEvent): Promise<void> {
    this.emitter.emit(channel, event);
  }

  subscribe(channel: string, handler: (event: CompetitionPubSubEvent) => void): () => void {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

// ── RedisPubSub — ioredis, multi-process ──────────────────────────────────────
// Uses `any` for the ioredis client type to avoid requiring @types/ioredis at
// compile time; the class is only instantiated after a successful dynamic import.

class RedisPubSub implements IPubSub {
  // Local emitter bridges Redis messages to typed handlers.
  private readonly emitter = new EventEmitter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pub: any, private readonly sub: any) {
    this.emitter.setMaxListeners(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.sub.on('message', (channel: string, raw: any) => {
      try {
        const event = JSON.parse(String(raw)) as CompetitionPubSubEvent;
        this.emitter.emit(channel, event);
      } catch {
        /* malformed message — discard */
      }
    });
  }

  async publish(channel: string, event: CompetitionPubSubEvent): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(event));
  }

  subscribe(channel: string, handler: (event: CompetitionPubSubEvent) => void): () => void {
    void this.sub.subscribe(channel);
    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
      // Unsubscribe from the Redis channel only when no local listeners remain.
      if (this.emitter.listenerCount(channel) === 0) {
        void this.sub.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.pub as any).quit(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.sub as any).quit(),
    ]);
    this.emitter.removeAllListeners();
  }
}

// ── Module singleton ──────────────────────────────────────────────────────────

// Starts as LocalPubSub so it's usable immediately at module load.
// Upgraded to RedisPubSub inside initPubSub() if Redis is reachable.
let _instance: IPubSub = new LocalPubSub();

/** Returns the active pub/sub instance. Always valid — never null. */
export function getPubSub(): IPubSub {
  return _instance;
}

/**
 * Called once at server startup.
 * Attempts to connect to Redis (REDIS_URL env var) and, if successful, swaps
 * the singleton from LocalPubSub to RedisPubSub.
 * Safe to call without awaiting — the upgrade happens asynchronously.
 */
export async function initPubSub(): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    logger.info('[pubsub] REDIS_URL not set — using in-process EventEmitter');
    return;
  }
  try {
    // Dynamic import: only resolves when ioredis is installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // @ts-ignore ioredis is an optional runtime dependency; not present at compile time
    const mod = await import('ioredis') as any;
    const IORedis = mod.default ?? mod;
    const pub = new IORedis(url);
    const sub = new IORedis(url);
    _instance = new RedisPubSub(pub, sub);
    logger.info('[pubsub] Redis pub/sub connected', { url });
  } catch (err) {
    logger.warn('[pubsub] ioredis not available — keeping EventEmitter pub/sub', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Gracefully closes the pub/sub connection during server shutdown. */
export async function closePubSub(): Promise<void> {
  await _instance.close();
}
