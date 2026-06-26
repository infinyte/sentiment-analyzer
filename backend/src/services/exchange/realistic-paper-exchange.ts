/**
 * RealisticPaperExchange — paper trading with realistic market simulation.
 *
 * Compared with the basic PaperExchange it adds:
 *   • Live quote source with transparent fallback to seeded random walk
 *   • Named fee presets matching real providers (crypto-com, binance-us,
 *     coinbase, alpaca) with per-field override support
 *   • Side-specific slippage: BUY pays a small premium, SELL receives a small
 *     discount, reflecting real market-impact costs
 *   • Commission deducted from the USDT balance at fill time; the amount is
 *     returned in order.commission for downstream P&L accounting
 */

import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';

// ── Seed prices (fallback random walk) ───────────────────────────────────────

const SEED_PRICES: Record<string, number> = {
  BTC:  73_000,
  ETH:   2_300,
  SOL:     150,
  BNB:     300,
  XRP:       0.5,
  USDT:      1,
};

// ── Fee presets ───────────────────────────────────────────────────────────────

/** Maker / taker fee fractions (e.g. 0.001 = 0.1%). */
export interface FeeConfig {
  maker: number;
  taker: number;
}

/** Named provider fee presets. */
export type FeePreset = 'crypto-com' | 'binance-us' | 'coinbase' | 'alpaca';

export const FEE_PRESETS: Record<FeePreset, FeeConfig> = {
  'crypto-com': { maker: 0.0025, taker: 0.0050 },
  // Source: Binance.US public fee schedule, entry tier (0% maker / 0.02% taker),
  // verified mid-2026. Re-verify before relying on it — tiers change with volume/BNB.
  'binance-us': { maker: 0.0000, taker: 0.0002 },
  'coinbase':   { maker: 0.0060, taker: 0.0120 },
  'alpaca':     { maker: 0.0015, taker: 0.0025 },
};

// ── Quote sources ─────────────────────────────────────────────────────────────

/** Injectable price source abstraction. */
export interface QuoteSource {
  getPrice(symbol: string): Promise<number>;
}

/**
 * HTTP quote source backed by the Binance.US public ticker endpoint.
 * No API key is required.
 *
 * Symbol mapping: 'BTC' → 'BTCUSDT', 'ETH' → 'ETHUSDT', etc.
 */
export class HttpQuoteSource implements QuoteSource {
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://api.binance.us/api/v3') {
    this.baseUrl = baseUrl;
  }

  async getPrice(symbol: string): Promise<number> {
    const pair = `${symbol.toUpperCase()}USDT`;
    const resp = await fetch(`${this.baseUrl}/ticker/price?symbol=${pair}`);
    if (!resp.ok) throw new Error(`[HttpQuoteSource] HTTP ${resp.status} for ${pair}`);
    const data = await resp.json() as { price?: string };
    const price = parseFloat(data.price ?? '');
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`[HttpQuoteSource] invalid price "${String(data.price)}" for ${symbol}`);
    }
    return price;
  }
}

/**
 * Wraps a primary QuoteSource and falls back to a seeded random-walk price
 * if the primary throws or is unavailable.
 */
export class FallbackQuoteSource implements QuoteSource {
  private readonly prices = new Map<string, number>(Object.entries(SEED_PRICES));

  constructor(private readonly primary?: QuoteSource) {}

  async getPrice(symbol: string): Promise<number> {
    if (this.primary) {
      try {
        return await this.primary.getPrice(symbol);
      } catch {
        // primary unavailable — fall through to random walk
      }
    }
    return this.randomWalk(symbol);
  }

  private randomWalk(symbol: string): number {
    const base = SEED_PRICES[symbol] ?? 100;
    const prev = this.prices.get(symbol) ?? base;
    const next = prev * (1 + (Math.random() - 0.5) * 0.02);
    this.prices.set(symbol, next);
    return next;
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

export interface RealisticPaperExchangeConfig {
  /** Starting USDT capital. Default: 10 000. */
  initialCapital?: number;

  /**
   * Named fee preset selecting maker/taker rates for a known provider.
   * Default: 'binance-us' (0 % maker / 0.02 % taker, entry tier).
   * Individual feeMaker / feeTaker fields override the preset when supplied.
   */
  feePreset?: FeePreset;

  /** Override maker fee fraction (e.g. 0.0025 = 0.25 %). Overrides preset. */
  feeMaker?: number;
  /** Override taker fee fraction. Overrides preset. */
  feeTaker?: number;

  /**
   * Fraction of the execution price added to BUY orders to simulate adverse
   * market impact. Default: 0.001 (0.1 %).
   */
  slippageBuyPct?: number;

  /**
   * Fraction of the execution price subtracted from SELL orders to simulate
   * adverse market impact. Default: 0.001 (0.1 %).
   */
  slippageSellPct?: number;

  /**
   * Injectable quote source.
   * Default: FallbackQuoteSource wrapping HttpQuoteSource (Binance.US public API).
   */
  quoteSource?: QuoteSource;
}

// ── RealisticPaperExchange ────────────────────────────────────────────────────

export class RealisticPaperExchange implements ExchangeInterface {
  /** Name of the fee preset in effect — surfaced for analytics/reporting. */
  readonly feePreset: FeePreset;

  private readonly balances     = new Map<string, Balance>();
  private readonly orders       = new Map<string, Order>();
  private readonly feeMaker:    number;
  private readonly feeTaker:    number;
  private readonly slippageBuy:  number;
  private readonly slippageSell: number;
  private readonly quotes:      QuoteSource;
  private orderCounter = 0;

  constructor(config: RealisticPaperExchangeConfig = {}) {
    const capital = config.initialCapital ?? 10_000;
    this.balances.set('USDT', { symbol: 'USDT', available: capital, held: 0, total: capital });

    // Fee resolution: individual fields override the preset when supplied
    this.feePreset   = config.feePreset ?? 'binance-us';
    const preset     = FEE_PRESETS[this.feePreset];
    this.feeMaker    = config.feeMaker ?? preset.maker;
    this.feeTaker    = config.feeTaker ?? preset.taker;

    this.slippageBuy  = config.slippageBuyPct  ?? 0.001;
    this.slippageSell = config.slippageSellPct ?? 0.001;

    this.quotes = config.quoteSource
      ?? new FallbackQuoteSource(new HttpQuoteSource());
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  async getExchangeName(): Promise<string> {
    return 'Realistic Paper Exchange';
  }

  async isConnected(): Promise<boolean> {
    return true;
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  async getBalance(symbol: string): Promise<Balance> {
    return this.balances.get(symbol) ?? { symbol, available: 0, held: 0, total: 0 };
  }

  async getAllBalances(): Promise<Balance[]> {
    return Array.from(this.balances.values()).filter(b => b.total > 0);
  }

  // ── Prices ────────────────────────────────────────────────────────────────

  async getCurrentPrice(symbol: string): Promise<number> {
    return this.quotes.getPrice(symbol);
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const s of symbols) {
      result.set(s, await this.getCurrentPrice(s));
    }
    return result;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const { symbol, side, size } = params;

    // Use the supplied limit price when present; otherwise fetch live/fallback quote
    const basePrice = params.price && params.price > 0
      ? params.price
      : await this.getCurrentPrice(symbol);

    // Apply side-specific slippage (adverse fill simulation)
    const execPrice = side === 'BUY'
      ? basePrice * (1 + this.slippageBuy)
      : basePrice * (1 - this.slippageSell);

    // Market-order fills are always taker
    const grossValue = execPrice * size;
    const commission = grossValue * this.feeTaker;

    const order: Order = {
      id:         `rpaper_${++this.orderCounter}_${Date.now()}`,
      symbol,
      type:       side,
      quantity:   size,
      price:      execPrice,
      status:     'FILLED',
      timestamp:  new Date(),
      commission,
    };

    // Update balances — commission is in USDT on both sides
    const usdt  = await this.getBalance('USDT');
    const asset = await this.getBalance(symbol);

    if (side === 'BUY') {
      const totalDebit = grossValue + commission;
      this.balances.set('USDT',  { ...usdt,  available: usdt.available  - totalDebit, total: usdt.total  - totalDebit });
      this.balances.set(symbol,  { ...asset, available: asset.available + size,       total: asset.total + size       });
    } else {
      const netCredit = grossValue - commission;
      this.balances.set('USDT',  { ...usdt,  available: usdt.available  + netCredit,  total: usdt.total  + netCredit  });
      this.balances.set(symbol,  { ...asset, available: asset.available - size,       total: asset.total - size       });
    }

    this.orders.set(order.id, order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;
    order.status = 'CANCELED';
    return true;
  }

  async getOpenOrders(_symbol?: string): Promise<Order[]> {
    return Array.from(this.orders.values()).filter(o => o.status === 'PENDING');
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`[RealisticPaperExchange] order not found: ${orderId}`);
    return order;
  }

  async getOrderHistory(limit = 500): Promise<Order[]> {
    const all = Array.from(this.orders.values());
    return all.slice(-Math.min(limit, all.length));
  }
}
