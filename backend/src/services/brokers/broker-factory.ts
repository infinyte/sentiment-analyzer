/**
 * Factory for instantiating broker adapters from decrypted credentials.
 * Add new providers here as they are implemented.
 */

import type { BrokerCredentials, IBrokerAdapter } from '../../types/broker.js';
import { AlpacaAdapter } from './alpaca-adapter.js';

export function createBrokerAdapter(credentials: BrokerCredentials): IBrokerAdapter {
  switch (credentials.provider) {
    case 'ALPACA':
      return new AlpacaAdapter({
        credentialId: credentials.id,
        mode:         credentials.mode,
        apiKey:       credentials.apiKey,
        apiSecret:    credentials.apiSecret,
      });
    default: {
      const exhaustive: never = credentials.provider;
      throw new Error(`[broker-factory] unsupported provider: ${exhaustive}`);
    }
  }
}
