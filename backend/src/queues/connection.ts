/**
 * BullMQ / Redis connection factory.
 *
 * Parses REDIS_URL into IORedis-compatible options so callers never deal
 * with raw URL strings.  `maxRetriesPerRequest: null` is required by BullMQ
 * blocking commands used inside Worker instances.
 *
 * Usage:
 *   import { createConnectionOptions, isQueueAvailable } from './connection.js';
 */

import type { ConnectionOptions } from 'bullmq';

/**
 * Build connection options from REDIS_URL.
 * Throws if REDIS_URL is not set — guard with `isQueueAvailable()` first.
 */
export function createConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required for BullMQ queues');
  }

  const parsed = new URL(redisUrl);
  const opts: ConnectionOptions = {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    // Required for BullMQ workers that use blocking Redis commands.
    maxRetriesPerRequest: null,
  };

  if (parsed.password) {
    opts.password = decodeURIComponent(parsed.password);
  }
  if (parsed.username && parsed.username !== 'default') {
    opts.username = decodeURIComponent(parsed.username);
  }
  if (parsed.protocol === 'rediss:') {
    opts.tls = {};
  }

  return opts;
}

/** True when Redis is configured and BullMQ queues can be used. */
export function isQueueAvailable(): boolean {
  return !!process.env['REDIS_URL'];
}
