/**
 * AlpacaExchange — ExchangeInterface adapter for Alpaca Trading + Crypto Data APIs.
 *
 * Symbol convention: internal "BTC" maps to Alpaca "BTC/USD".
 */

import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';
import type { AlpacaClient, AlpacaOrder } from './alpaca-client.js';
import logger from '../../logger.js';

export interface AlpacaExchangeConfig {
  defaultPair?: string;
}

const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTC/USD',
  ETH: 'ETH/USD',
  SOL: 'SOL/USD',
  ADA: 'ADA/USD',
  DOGE: 'DOGE/USD',
  DOT: 'DOT/USD',
  MATIC: 'MATIC/USD',
  LINK: 'LINK/USD',
  AVAX: 'AVAX/USD',
  UNI: 'UNI/USD',
  LTC: 'LTC/USD',
  XRP: 'XRP/USD',
  BCH: 'BCH/USD',
  ATOM: 'ATOM/USD',
  XLM: 'XLM/USD',
  ALGO: 'ALGO/USD',
  NEAR: 'NEAR/USD',
  FIL: 'FIL/USD',
  SHIB: 'SHIB/USD',
};

export class AlpacaExchange implements ExchangeInterface {
  private readonly client: AlpacaClient;
  private readonly defaultPair: string;

  private readonly orderSymbols = new Map<string, string>();

  constructor(client: AlpacaClient, config: AlpacaExchangeConfig = {}) {
    this.client = client;
    this.defaultPair = config.defaultPair ?? 'BTC/USD';
  }

  async getExchangeName(): Promise<string> {
    return `Alpaca ${this.client.getModeLabel()}`;
  }

  async isConnected(): Promise<boolean> {
    return this.client.ping();
  }

  async getBalance(symbol: string): Promise<Balance> {
    const normalized = symbol.toUpperCase() === 'USD' ? 'USDT' : symbol.toUpperCase();
    const b = await this.client.getBalance(normalized);
    return {
      symbol: normalized,
      available: b.available,
      held: b.held,
      total: b.total,
    };
  }

  async getAllBalances(): Promise<Balance[]> {
    const all = await this.client.getAllBalances();
    return all
      .filter(b => b.total > 0)
      .map(b => ({
        symbol: b.currency,
        available: b.available,
        held: b.held,
        total: b.total,
      }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    return this.client.getLatestTradePrice(this.toPair(symbol));
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await Promise.allSettled(
      symbols.map(async s => {
        try {
          out.set(s, await this.getCurrentPrice(s));
        } catch {
          // Skip symbols unavailable from Alpaca.
        }
      }),
    );
    return out;
  }

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const { symbol, side, size, price, orderType = 'LIMIT' } = params;

    const notional = size * (price ?? await this.getCurrentPrice(symbol));
    if (notional < 1.0) {
      throw new Error(`Order too small: $${notional.toFixed(4)} (Alpaca minimum is $1.00)`);
    }

    logger.info('Alpaca placeOrder', { symbol, side, size, price, orderType });

    const raw = await this.client.createOrder({
      symbol: this.toPair(symbol),
      side: side === 'BUY' ? 'buy' : 'sell',
      qty: size.toString(),
      type: orderType === 'MARKET' ? 'market' : 'limit',
      limit_price: orderType === 'LIMIT' && price !== undefined ? price.toString() : undefined,
      client_order_id: `sa_${Date.now()}`,
    });

    this.orderSymbols.set(raw.id, symbol.toUpperCase());
    return this.mapOrder(raw, symbol.toUpperCase());
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const ok = await this.client.cancelOrder(orderId);
    if (ok) this.orderSymbols.delete(orderId);
    return ok;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const pair = symbol ? this.toPair(symbol) : undefined;
    const orders = await this.client.getOpenOrders(pair);
    return orders.map(o => this.mapOrder(o, this.fromPair(o.symbol)));
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const fallbackSymbol = this.orderSymbols.get(orderId) ?? this.fromPair(this.defaultPair);
    const raw = await this.client.getOrder(orderId);
    return this.mapOrder(raw, fallbackSymbol);
  }

  async getOrderHistory(limit = 100): Promise<Order[]> {
    const orders = await this.client.getOrderHistory(limit);
    return orders.map(o => this.mapOrder(o, this.fromPair(o.symbol)));
  }

  private toPair(symbol: string): string {
    const normalized = symbol.toUpperCase();
    return CRYPTO_SYMBOL_MAP[normalized] ?? (symbol.includes('/') ? symbol.toUpperCase() : `${normalized}/USD`);
  }

  private fromPair(pair: string): string {
    return pair.split('/')[0]?.toUpperCase() ?? pair.toUpperCase();
  }

  private mapOrder(raw: AlpacaOrder, symbol: string): Order {
    return {
      id: raw.id,
      symbol,
      type: raw.side === 'buy' ? 'BUY' : 'SELL',
      quantity: parseFloat(raw.qty),
      price: raw.limit_price ? parseFloat(raw.limit_price) : (raw.filled_avg_price ? parseFloat(raw.filled_avg_price) : 0),
      status: this.mapStatus(raw.status),
      timestamp: new Date(raw.created_at),
    };
  }

  private mapStatus(status: string): Order['status'] {
    switch (status) {
      case 'filled':
        return 'FILLED';
      case 'partially_filled':
        return 'PARTIAL';
      case 'canceled':
      case 'expired':
      case 'rejected':
      case 'stopped':
        return 'CANCELED';
      default:
        return 'PENDING';
    }
  }
}
