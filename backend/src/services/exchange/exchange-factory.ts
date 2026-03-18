/**
 * Creates an ExchangeAdapter from a provider name + credentials.
 * Add new providers here as adapters are implemented.
 */

import type { AccountMode } from './exchange-adapter.js';
import { ExchangeAdapter } from './exchange-adapter.js';
import { CoinbaseAdapter } from './adapters/coinbase-adapter.js';
import { BinanceAdapter }  from './adapters/binance-adapter.js';

export type ExchangeProvider = 'COINBASE' | 'BINANCE';

export interface ExchangeAdapterConfig {
  provider:    ExchangeProvider;
  mode:        AccountMode;
  credentials: Record<string, unknown>;
}

export function createExchangeAdapter(config: ExchangeAdapterConfig): ExchangeAdapter {
  switch (config.provider) {
    case 'COINBASE':
      return new CoinbaseAdapter(
        config.mode,
        config.credentials as {
          apiKey: string;
          apiSecret: string;
          passphrase: string;
          accountId: string;
          sandbox?: boolean;
        },
      );
    case 'BINANCE':
      return new BinanceAdapter(
        config.mode,
        config.credentials as { apiKey: string; apiSecret: string; testnet?: boolean },
      );
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`[exchange-factory] unsupported provider: ${exhaustive}`);
    }
  }
}
