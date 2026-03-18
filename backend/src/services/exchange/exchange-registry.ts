/**
 * ExchangeRegistry — process-lifetime singleton.
 *
 * Maps adapterId → authenticated ExchangeAdapter instance.
 * Adapters are registered via POST /api/exchange/connect and removed via
 * DELETE /api/exchange/disconnect/:id.
 * Like the broker registry, adapters do NOT survive a process restart.
 */

import type { ExchangeAdapter } from './exchange-adapter.js';
import logger from '../../logger.js';

class ExchangeRegistryClass {
  private readonly adapters = new Map<string, ExchangeAdapter>();

  /** Register an already-authenticated adapter under the given id. */
  register(id: string, adapter: ExchangeAdapter): void {
    const existing = this.adapters.get(id);
    if (existing) {
      logger.warn('exchange-registry: replacing existing adapter', { id, previous: existing.name });
    }
    this.adapters.set(id, adapter);
    logger.info('exchange-registry: adapter registered', { id, name: adapter.name, mode: adapter.mode });
  }

  get(id: string): ExchangeAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  unregister(id: string): boolean {
    const existed = this.adapters.has(id);
    this.adapters.delete(id);
    if (existed) logger.info('exchange-registry: adapter removed', { id });
    return existed;
  }

  listAll(): Array<{ id: string; name: string; mode: string }> {
    return Array.from(this.adapters.entries()).map(([id, a]) => ({
      id,
      name: a.name,
      mode: a.mode,
    }));
  }
}

export const exchangeRegistry = new ExchangeRegistryClass();
