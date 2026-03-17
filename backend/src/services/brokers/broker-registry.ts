/**
 * BrokerRegistry — process-lifetime singleton.
 *
 * Maps credentialId → connected IBrokerAdapter.
 * Adapters are connected when credentials are registered and disconnected on removal.
 * Credentials (and therefore adapters) do NOT survive a process restart by design;
 * the admin must re-POST /api/marl/broker/credentials after restart.
 */

import type { IBrokerAdapter } from '../../types/broker.js';
import logger from '../../logger.js';

class BrokerRegistryClass {
  private readonly adapters = new Map<string, IBrokerAdapter>();

  /**
   * Register and connect an adapter.
   * Replaces any existing adapter with the same credentialId (disconnects the old one first).
   */
  async register(adapter: IBrokerAdapter): Promise<void> {
    const existing = this.adapters.get(adapter.credentialId);
    if (existing) {
      try { await existing.disconnect(); } catch { /* best-effort */ }
    }
    await adapter.connect();
    this.adapters.set(adapter.credentialId, adapter);
    logger.info('broker adapter registered', {
      credentialId: adapter.credentialId,
      provider: adapter.provider,
      mode: adapter.mode,
    });
  }

  /** Retrieve an adapter by credentialId. Returns undefined if not registered. */
  get(credentialId: string): IBrokerAdapter | undefined {
    return this.adapters.get(credentialId);
  }

  /** Disconnect and remove an adapter. */
  async unregister(credentialId: string): Promise<boolean> {
    const adapter = this.adapters.get(credentialId);
    if (!adapter) return false;
    try { await adapter.disconnect(); } catch { /* best-effort */ }
    this.adapters.delete(credentialId);
    logger.info('broker adapter unregistered', { credentialId });
    return true;
  }

  /** List all registered credential IDs. */
  listIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** True if an adapter is registered and connected. */
  has(credentialId: string): boolean {
    return this.adapters.has(credentialId);
  }

  /** Disconnect all adapters (call on SIGTERM/SIGINT). */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.adapters.values()].map(a => a.disconnect()),
    );
    this.adapters.clear();
  }
}

export const brokerRegistry = new BrokerRegistryClass();
