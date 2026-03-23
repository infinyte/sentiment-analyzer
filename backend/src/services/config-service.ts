/**
 * ConfigService — runtime application configuration with optional Redis hot-reload.
 *
 * Precedence (highest → lowest):
 *   1. Redis HASH `marl:config`       live overrides, updated at any time
 *   2. Environment variables           set at process start
 *   3. Compiled defaults               always available
 *
 * Hot-reload: publish to Redis channel `marl:config:updates` with JSON payload
 *   { "key": "sentimentTtlMs", "value": 3600000 }
 * The in-memory value is updated immediately and `onChange` listeners are fired.
 *
 * Usage:
 *   import { configService } from './config-service.js';
 *
 *   // Read a value:
 *   const ttl = configService.get('sentimentTtlMs');
 *
 *   // React to runtime changes:
 *   configService.onChange('maxConcurrentWorkers', (n) => pool.resize(n));
 *
 * To enable Redis:  npm install ioredis   and set  REDIS_URL=redis://localhost:6379
 */

import { EventEmitter } from 'node:events';
import logger from '../logger.js';

// ── AppConfig ─────────────────────────────────────────────────────────────────

export interface AppConfig {
  /**
   * Sentiment cache TTL in milliseconds.
   * Env: SENTIMENT_TTL_MS  Default: 86 400 000 (24 h)
   */
  sentimentTtlMs: number;

  /**
   * How many days of social-media items to retain before pruning.
   * Env: SOCIAL_PRUNE_RETAIN_DAYS  Default: 7
   */
  socialPruneRetainDays: number;

  /**
   * SSE heartbeat comment interval in milliseconds.
   * Keeps TCP connections alive through proxies and load-balancers.
   * Env: SSE_HEARTBEAT_MS  Default: 30 000 (30 s)
   */
  sseHeartbeatIntervalMs: number;

  /**
   * Maximum number of MARL simulation Worker Threads that may run concurrently.
   * Env: MARL_MAX_WORKERS  Default: 4
   */
  maxConcurrentWorkers: number;

  /**
   * Default competition step-count when the request omits `duration`.
   * Env: MARL_DEFAULT_DURATION  Default: 200
   */
  defaultCompetitionDuration: number;
}

type ConfigKey = keyof AppConfig;

// ── Env-var defaults ──────────────────────────────────────────────────────────

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ENV_DEFAULTS: AppConfig = {
  sentimentTtlMs:             envNum('SENTIMENT_TTL_MS',         86_400_000),
  socialPruneRetainDays:      envNum('SOCIAL_PRUNE_RETAIN_DAYS', 7),
  sseHeartbeatIntervalMs:     envNum('SSE_HEARTBEAT_MS',         30_000),
  maxConcurrentWorkers:       envNum('MARL_MAX_WORKERS',         4),
  defaultCompetitionDuration: envNum('MARL_DEFAULT_DURATION',    200),
};

// ── ConfigService ─────────────────────────────────────────────────────────────

export class ConfigService {
  private readonly config: AppConfig = { ...ENV_DEFAULTS };
  private readonly emitter           = new EventEmitter();

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Get the current value of a config key (type-safe). */
  get<K extends ConfigKey>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /**
   * Register a callback that fires whenever a specific key changes at runtime.
   * Returns an unsubscribe function — call it when the subscriber is torn down.
   */
  onChange<K extends ConfigKey>(key: K, handler: (value: AppConfig[K]) => void): () => void {
    const listener = (value: AppConfig[K]) => handler(value);
    this.emitter.on(`change:${key}`, listener);
    return () => this.emitter.off(`change:${key}`, listener);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Attempt Redis connection for initial overrides and hot-reload subscription.
   * Silently falls back to env/defaults if Redis is unavailable.
   * Call once at startup — safe to fire-and-forget with `void configService.init()`.
   */
  async init(): Promise<void> {
    const url = process.env['REDIS_URL'];
    if (!url) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // @ts-ignore ioredis is an optional runtime dependency; not present at compile time
      const mod = await import('ioredis') as any;
      const IORedis = mod.default ?? mod;

      // Use a single connection for both HGETALL (reads) and SUBSCRIBE.
      // A separate connection is required for pub/sub mode in ioredis.
      const client = new IORedis(url) as {
        hgetall(k: string): Promise<Record<string, string> | null>;
        subscribe(ch: string): Promise<unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on(event: string, handler: (...args: any[]) => void): void;
        quit(): Promise<unknown>;
      };

      // Load stored overrides.
      const stored = await client.hgetall('marl:config');
      if (stored) {
        for (const [k, v] of Object.entries(stored)) {
          this.applyRaw(k, v);
        }
        logger.info('[config] loaded Redis overrides', { keys: Object.keys(stored) });
      }

      // Subscribe to hot-reload channel.
      await client.subscribe('marl:config:updates');
      client.on('message', (_ch: string, raw: string) => {
        try {
          const { key, value } = JSON.parse(raw) as { key: ConfigKey; value: number };
          this.applyRaw(key, String(value));
          logger.info('[config] hot-reload applied', { key, value });
        } catch {
          /* malformed update — skip */
        }
      });

      logger.info('[config] Redis hot-reload ready', { url });
    } catch (err) {
      logger.info('[config] ioredis unavailable — using env/defaults only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private applyRaw(key: string, rawValue: string): void {
    if (!(key in this.config)) return; // unknown key — ignore

    const num = Number(rawValue);
    if (!Number.isFinite(num) || num <= 0) {
      logger.warn('[config] invalid value ignored', { key, rawValue });
      return;
    }

    (this.config as unknown as Record<string, number>)[key] = num;
    this.emitter.emit(`change:${key}`, num);
  }
}

// ── Module singleton ──────────────────────────────────────────────────────────

export const configService = new ConfigService();
