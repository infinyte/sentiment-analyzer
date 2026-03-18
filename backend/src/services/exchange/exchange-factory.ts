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
 */

import type { AccountMode } from './exchange-adapter.js';
import { ExchangeAdapter } from './exchange-adapter.js';
import { CoinbaseAdapter } from './adapters/coinbase-adapter.js';
import { BinanceAdapter }  from './adapters/binance-adapter.js';
import { BinanceUSExchange } from './binance-us-exchange.js';
import { PaperExchange }     from './paper-exchange.js';
import { CryptoComClient }   from './crypto-com-client.js';
import { CryptoComExchange } from './crypto-com-exchange.js';
import type { ExchangeInterface } from './exchange-interface.js';

/** Low-level adapter providers (for ExchangeRegistry / real-trading routes). */
export type ExchangeProvider = 'COINBASE' | 'BINANCE';

/** Higher-level provider selector read from TRADING_PROVIDER env var. */
export type TradingProvider = 'binance-us' | 'crypto-com';

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

export function getTradingConfig(): TradingConfig {
  const raw  = (process.env.TRADING_MODE ?? 'paper').toLowerCase();
  const mode = Object.values(TradingMode).includes(raw as TradingMode)
    ? (raw as TradingMode)
    : TradingMode.PAPER;

  const rawProvider = (process.env.TRADING_PROVIDER ?? 'crypto-com').toLowerCase();
  const provider: TradingProvider = rawProvider === 'binance-us' ? 'binance-us' : 'crypto-com';

  return {
    mode,
    provider,
    initialCapital:            parseInt(process.env.TRADING_INITIAL_CAPITAL      ?? '10000', 10),
    maxLossPercentage:         parseInt(process.env.TRADING_MAX_LOSS_PERCENT      ?? '5',     10),
    maxPositionSizePercentage: parseInt(process.env.TRADING_MAX_POSITION_PERCENT  ?? '15',    10),
    maxOpenPositions:          parseInt(process.env.TRADING_MAX_OPEN_POSITIONS    ?? '3',     10),
    requireManualApproval:     process.env.REQUIRE_MANUAL_APPROVAL === 'true',
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
      const apiKey    = process.env.CRYPTO_COM_API_KEY;
      const apiSecret = process.env.CRYPTO_COM_API_SECRET;
      const pair      = process.env.CRYPTO_COM_TRADING_PAIR ?? 'BTC_USDT';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'CRYPTO_COM_API_KEY and CRYPTO_COM_API_SECRET must be set for crypto-com mode.',
        );
      }

      if (config.mode === TradingMode.SANDBOX) {
        const baseUrl = process.env.CRYPTO_COM_REST_URL ?? 'https://uat.crypto.com/exchange/v1';
        const client  = new CryptoComClient({ apiKey, apiSecret, baseUrl, sandbox: true });
        return new CryptoComExchange(client, { defaultPair: pair });
      }

      if (config.mode === TradingMode.LIVE) {
        const baseUrl = process.env.CRYPTO_COM_LIVE_URL ?? 'https://api.crypto.com/exchange/v1';
        const client  = new CryptoComClient({ apiKey, apiSecret, baseUrl, sandbox: false });
        return new CryptoComExchange(client, { defaultPair: pair });
      }
    }

    // ── Binance.US ──────────────────────────────────────────────────────────
    if (config.mode === TradingMode.SANDBOX) {
      const apiKey    = process.env.BINANCE_SANDBOX_API_KEY;
      const apiSecret = process.env.BINANCE_SANDBOX_API_SECRET;
      const baseUrl   = process.env.BINANCE_SANDBOX_TEST_NET ?? 'https://testnet.binance.vision';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'BINANCE_SANDBOX_API_KEY and BINANCE_SANDBOX_API_SECRET must be set for binance-us SANDBOX mode.',
        );
      }
      return new BinanceUSExchange({ apiKey, apiSecret, baseUrl, useTestnet: true });
    }

    if (config.mode === TradingMode.LIVE) {
      const apiKey    = process.env.BINANCE_LIVE_API_KEY;
      const apiSecret = process.env.BINANCE_LIVE_API_SECRET;
      const baseUrl   = process.env.BINANCE_LIVE_URL ?? 'https://api.binance.us';

      if (!apiKey || !apiSecret) {
        throw new Error(
          'BINANCE_LIVE_API_KEY and BINANCE_LIVE_API_SECRET must be set for binance-us LIVE mode.',
        );
      }
      return new BinanceUSExchange({ apiKey, apiSecret, baseUrl, useTestnet: false });
    }

    // exhaustive check
    const _: never = config.mode;
    throw new Error(`[ExchangeFactory] unknown trading mode: ${_}`);
  }
}
