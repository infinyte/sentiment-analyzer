/**
 * CryptoComExchange — ExchangeInterface adapter for Crypto.com Exchange REST v2.
 *
 * Symbol convention: internal "BTC" maps to Crypto.com pair "BTC_USDT".
 * The pair is configurable via the constructor so any USDT-quoted market works.
 *
 * Fees: 0.25 % maker / 0.50 % taker (defaults; overridable via config).
 */

import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';
import type { CryptoComClient, CryptoComOrder } from './crypto-com-client.js';
import logger from '../../logger.js';

export interface CryptoComExchangeConfig {
  /** Default trading pair used by getOpenOrders / getOrderHistory.  Default: 'BTC_USDT'. */
  defaultPair?: string;
  feeMaker?:    number;   // fraction, e.g. 0.0025
  feeTaker?:    number;   // fraction, e.g. 0.0050
}

export class CryptoComExchange implements ExchangeInterface {
  private readonly client:      CryptoComClient;
  private readonly defaultPair: string;
  private readonly feeMaker:    number;
  private readonly feeTaker:    number;

  /** orderId → internal symbol (e.g. 'BTC'), populated by placeOrder(). */
  private readonly orderSymbols = new Map<string, string>();

  constructor(client: CryptoComClient, config: CryptoComExchangeConfig = {}) {
    this.client      = client;
    this.defaultPair = config.defaultPair ?? 'BTC_USDT';
    this.feeMaker    = config.feeMaker    ?? 0.0025;
    this.feeTaker    = config.feeTaker    ?? 0.0050;
  }

  // ── ExchangeInterface ─────────────────────────────────────────────────────

  async getExchangeName(): Promise<string> {
    return 'Crypto.com Exchange';
  }

  async isConnected(): Promise<boolean> {
    return this.client.ping();
  }

  async getBalance(symbol: string): Promise<Balance> {
    const b = await this.client.getBalance(symbol);
    return { symbol, available: b.available, held: b.reserved, total: b.total };
  }

  async getAllBalances(): Promise<Balance[]> {
    const all = await this.client.getAllBalances();
    return all
      .filter(b => b.total > 0)
      .map(b => ({
        symbol:    b.currency,
        available: b.available,
        held:      b.reserved,
        total:     b.total,
      }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const pair = this.toPair(symbol);
    const ticker = await this.client.getTicker(pair);
    return ticker.price;
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await Promise.allSettled(
      symbols.map(async s => {
        try { result.set(s, await this.getCurrentPrice(s)); } catch { /* skip */ }
      }),
    );
    return result;
  }

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const { symbol, side, size, price, orderType = 'LIMIT' } = params;
    const pair = this.toPair(symbol);

    // Enforce $1 minimum notional
    const notional = size * (price ?? await this.getCurrentPrice(symbol));
    if (notional < 1.0) {
      throw new Error(
        `Order too small: $${notional.toFixed(4)} (Crypto.com minimum is $1.00)`,
      );
    }

    logger.info('CryptoCom placeOrder', { symbol, side, size, price, orderType });

    const ccOrder = await this.client.createOrder({
      pair,
      side:     side.toUpperCase() as 'BUY' | 'SELL',
      type:     orderType.toUpperCase() as 'LIMIT' | 'MARKET',
      quantity: size,
      price,
      clientOrderId: `sa_${Date.now()}`,
    });

    this.orderSymbols.set(ccOrder.order_id, symbol);
    return this.mapOrder(ccOrder, symbol);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const symbol = this.orderSymbols.get(orderId);
    const pair   = symbol ? this.toPair(symbol) : this.defaultPair;
    const ok     = await this.client.cancelOrder(orderId, pair);
    if (ok) this.orderSymbols.delete(orderId);
    return ok;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const pair   = symbol ? this.toPair(symbol) : undefined;
    const orders = await this.client.getOpenOrders(pair);
    return orders.map(o => this.mapOrder(o, this.fromPair(o.pair)));
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const symbol = this.requireSymbol(orderId);
    const pair   = this.toPair(symbol);
    const o      = await this.client.getOrderStatus(orderId, pair);
    return this.mapOrder(o, symbol);
  }

  async getOrderHistory(limit = 100): Promise<Order[]> {
    const orders = await this.client.getOrderHistory(this.defaultPair, limit);
    return orders.map(o => this.mapOrder(o, this.fromPair(o.pair)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** 'BTC' → 'BTC_USDT' (pass-through if already contains '_'). */
  private toPair(symbol: string): string {
    return symbol.includes('_') ? symbol.toUpperCase() : `${symbol.toUpperCase()}_USDT`;
  }

  /** 'BTC_USDT' → 'BTC' */
  private fromPair(pair: string): string {
    return pair.split('_')[0] ?? pair;
  }

  private requireSymbol(orderId: string): string {
    const s = this.orderSymbols.get(orderId);
    if (!s) {
      throw new Error(
        `Symbol not found for orderId ${orderId}. ` +
        'Only orders placed through this instance can be managed by ID.',
      );
    }
    return s;
  }

  private mapOrder(o: CryptoComOrder, symbol: string): Order {
    return {
      id:         o.order_id,
      symbol,
      type:       o.side.toUpperCase() as 'BUY' | 'SELL',
      quantity:   o.quantity,
      price:      o.price ?? 0,
      status:     this.mapStatus(o.status),
      timestamp:  new Date(o.create_time || Date.now()),
      commission: o.fee,
    };
  }

  private mapStatus(s: CryptoComOrder['status']): Order['status'] {
    switch (s) {
      case 'FILLED':   return 'FILLED';
      case 'PARTIAL':  return 'PARTIAL';
      case 'CANCELED':
      case 'EXPIRED':  return 'CANCELED';
      default:         return 'PENDING';
    }
  }
}
