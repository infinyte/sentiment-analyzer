/**
 * Exchange factory.
 *
 * Two factory systems live here side-by-side:
 *
 * 1. createExchangeAdapter() — low-level ExchangeAdapter factory used by
 *    the exchange-registry / MARL real-trading routes.
 *
 * 2. ExchangeFactory.create() + getTradingConfig() — higher-level factory
 *    used by the agent MARL loop.  Reads TRADING_MODE / TRADING_PROVIDER from
 *    the environment and returns a PaperExchange, BinanceUSExchange, or
 *    CryptoComExchange instance.
 *
 * Provider selection (SANDBOX / LIVE modes):
 *   TRADING_PROVIDER=crypto-com  → uses CryptoComExchange (default)
 *   TRADING_PROVIDER=binance-us  → uses BinanceUSExchange
 *   TRADING_PROVIDER=coinbase    → uses CoinbaseExchange (Advanced Trade API v3)
 *   TRADING_PROVIDER=alpaca      → uses AlpacaExchange (Trading + Crypto Data APIs)
 */

import type { AccountMode } from './exchange-adapter.js';
import { ExchangeAdapter } from './exchange-adapter.js';
import { CoinbaseAdapter } from './adapters/coinbase-adapter.js';
import { BinanceAdapter }  from './adapters/binance-adapter.js';
import { BinanceUSExchange } from './binance-us-exchange.js';
import { PaperExchange }     from './paper-exchange.js';
import { CryptoComClient }   from './crypto-com-client.js';
import { CryptoComExchange } from './crypto-com-exchange.js';
import { CoinbaseClient }    from './coinbase-client.js';
import { CoinbaseExchange }  from './coinbase-exchange.js';
import { AlpacaClient }      from './alpaca-client.js';
import { AlpacaExchange }    from './alpaca-exchange.js';
import type { ExchangeInterface } from './exchange-interface.js';
import { appConfigService } from '../app-config-service.js';

/** Low-level adapter providers (for ExchangeRegistry / real-trading routes). */
export type ExchangeProvider = 'COINBASE' | 'BINANCE';

/** Higher-level provider selector read from TRADING_PROVIDER env var. */
export type TradingProvider = 'binance-us' | 'crypto-com' | 'coinbase' | 'alpaca';

const SUPPORTED_TRADING_PROVIDERS = ['binance-us', 'crypto-com', 'coinbase', 'alpaca'] as const;

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

// ── Higher-level factory (MARL agent loop) ────────────────────────────────────

export enum TradingMode {
  PAPER   = 'paper',
  SANDBOX = 'sandbox',
  LIVE    = 'live',
}

export interface TradingConfig {
  mode:                       TradingMode;
  /** Which live/sandbox exchange to use when mode ≠ PAPER. Default: 'crypto-com'. */
  provider?:                  TradingProvider;
  initialCapital:             number;
  maxLossPercentage:          number;
  maxPositionSizePercentage:  number;
  maxOpenPositions:           number;
  requireManualApproval:      boolean;
}

function cfg(key: string): string | undefined {
  return appConfigService.get(key);
}

export function getTradingConfig(): TradingConfig {
  const raw  = (cfg('TRADING_MODE') ?? 'paper').toLowerCase();
  const mode = Object.values(TradingMode).includes(raw as TradingMode)
    ? (raw as TradingMode)
    : TradingMode.PAPER;

  const rawProvider = (cfg('TRADING_PROVIDER') ?? 'crypto-com').toLowerCase();
  if (!SUPPORTED_TRADING_PROVIDERS.includes(rawProvider as TradingProvider)) {
    throw new Error(
      `[exchange-factory] unsupported TRADING_PROVIDER: "${rawProvider}". ` +
      `Supported values: ${SUPPORTED_TRADING_PROVIDERS.join(', ')}`,
    );
  }

  const provider = rawProvider as TradingProvider;

  return {
    mode,
    provider,
    initialCapital:            parseInt(cfg('TRADING_INITIAL_CAPITAL')      ?? '10000', 10),
    maxLossPercentage:         parseInt(cfg('TRADING_MAX_LOSS_PERCENT')      ?? '5',     10),
    maxPositionSizePercentage: parseInt(cfg('TRADING_MAX_POSITION_PERCENT')  ?? '15',    10),
    maxOpenPositions:          parseInt(cfg('TRADING_MAX_OPEN_POSITIONS')    ?? '3',     10),
    requireManualApproval:     (cfg('REQUIRE_MANUAL_APPROVAL') ?? '').toLowerCase() === 'true',
  };
}

export class ExchangeFactory {
  static create(config: TradingConfig): ExchangeInterface {
    // PAPER: always simulate locally regardless of provider
    if (config.mode === TradingMode.PAPER) {
      return new PaperExchange(config.initialCapital);
    }

    const provider = config.provider ?? 'crypto-com';

    // ── Crypto.com ──────────────────────────────────────────────────────────
    if (provider === 'crypto-com') {
      const apiKey    = cfg('CRYPTO_COM_API_KEY');
      const apiSecret = cfg('CRYPTO_COM_API_SECRET');
      const pair      = cfg('CRYPTO_COM_TRADING_PAIR') ?? 'BTC_USDT';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'CRYPTO_COM_API_KEY and CRYPTO_COM_API_SECRET must be set for crypto-com mode.',
        );
      }

      if (config.mode === TradingMode.SANDBOX) {
        const baseUrl = cfg('CRYPTO_COM_REST_URL') ?? 'https://uat.crypto.com/exchange/v1';
        const client  = new CryptoComClient({ apiKey, apiSecret, baseUrl, sandbox: true });
        return new CryptoComExchange(client, { defaultPair: pair });
      }

      if (config.mode === TradingMode.LIVE) {
        const baseUrl = cfg('CRYPTO_COM_LIVE_URL') ?? 'https://api.crypto.com/exchange/v1';
        const client  = new CryptoComClient({ apiKey, apiSecret, baseUrl, sandbox: false });
        return new CryptoComExchange(client, { defaultPair: pair });
      }
    }

    // ── Coinbase Advanced Trade ──────────────────────────────────────────────
    if (provider === 'coinbase') {
      const apiKey    = cfg('COINBASE_API_KEY');
      const apiSecret = cfg('COINBASE_API_SECRET');
      const product   = cfg('COINBASE_TRADING_PAIR') ?? 'BTC-USD';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'COINBASE_API_KEY and COINBASE_API_SECRET must be set for coinbase mode.',
        );
      }

      if (config.mode === TradingMode.SANDBOX) {
        const baseUrl = 'https://api-sandbox.coinbase.com/api/v3/brokerage';
        const client  = new CoinbaseClient({ apiKey, apiSecret, baseUrl, sandbox: true });
        return new CoinbaseExchange(client, { defaultProduct: product });
      }

      if (config.mode === TradingMode.LIVE) {
        const baseUrl = 'https://api.coinbase.com/api/v3/brokerage';
        const client  = new CoinbaseClient({ apiKey, apiSecret, baseUrl, sandbox: false });
        return new CoinbaseExchange(client, { defaultProduct: product });
      }
    }

    // ── Alpaca ─────────────────────────────────────────────────────────────
    if (provider === 'alpaca') {
      const apiKey    = cfg('ALPACA_API_KEY');
      const apiSecret = cfg('ALPACA_API_SECRET');

      if (!apiKey || !apiSecret) {
        throw new Error(
          'ALPACA_API_KEY and ALPACA_API_SECRET must be set for alpaca mode.',
        );
      }

      const dataBaseUrl = cfg('ALPACA_DATA_URL') ?? 'https://data.alpaca.markets';

      if (config.mode === TradingMode.SANDBOX) {
        const baseUrl = cfg('ALPACA_PAPER_API_URL') ?? 'https://paper-api.alpaca.markets';
        const client  = new AlpacaClient({
          apiKey,
          apiSecret,
          baseUrl,
          dataBaseUrl,
          paper: true,
        });
        return new AlpacaExchange(client);
      }

      if (config.mode === TradingMode.LIVE) {
        const baseUrl = cfg('ALPACA_LIVE_API_URL') ?? 'https://api.alpaca.markets';
        const client  = new AlpacaClient({
          apiKey,
          apiSecret,
          baseUrl,
          dataBaseUrl,
          paper: false,
        });
        return new AlpacaExchange(client);
      }
    }

    // ── Binance.US ─────────────────────────────────────────────────────────
    if (provider === 'binance-us' && config.mode === TradingMode.SANDBOX) {
      const apiKey    = cfg('BINANCE_SANDBOX_API_KEY');
      const apiSecret = cfg('BINANCE_SANDBOX_API_SECRET');
      const baseUrl   = cfg('BINANCE_SANDBOX_TEST_NET') ?? 'https://testnet.binance.vision';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'BINANCE_SANDBOX_API_KEY and BINANCE_SANDBOX_API_SECRET must be set for binance-us SANDBOX mode.',
        );
      }
      return new BinanceUSExchange({ apiKey, apiSecret, baseUrl, useTestnet: true });
    }

    if (provider === 'binance-us' && config.mode === TradingMode.LIVE) {
      const apiKey    = cfg('BINANCE_LIVE_API_KEY');
      const apiSecret = cfg('BINANCE_LIVE_API_SECRET');
      const baseUrl   = cfg('BINANCE_LIVE_URL') ?? 'https://api.binance.us';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'BINANCE_LIVE_API_KEY and BINANCE_LIVE_API_SECRET must be set for binance-us LIVE mode.',
        );
      }
      return new BinanceUSExchange({ apiKey, apiSecret, baseUrl, useTestnet: false });
    }

    throw new Error(
      `[ExchangeFactory] unsupported provider/mode combination: provider=${provider} mode=${config.mode}`,
    );
  }
}
