/**
 * PaperExchange — fully in-process trading simulation.
 *
 * No network calls are made. Prices drift randomly from seed values.
 * Useful for agent training and offline testing before connecting to a live exchange.
 */

import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';

const SEED_PRICES: Record<string, number> = {
  BTC:  73_000,
  ETH:   2_300,
  SOL:     150,
  BNB:     300,
  XRP:       0.5,
  USDT:      1,
};

export class PaperExchange implements ExchangeInterface {
  private readonly balances   = new Map<string, Balance>();
  private readonly orders     = new Map<string, Order>();
  private readonly prices     = new Map<string, number>(Object.entries(SEED_PRICES));
  private orderCounter        = 0;

  constructor(initialCapital = 10_000) {
    this.balances.set('USDT', { symbol: 'USDT', available: initialCapital, held: 0, total: initialCapital });
  }

  async getExchangeName(): Promise<string> {
    return 'Paper Trading (Simulated)';
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
    const base = SEED_PRICES[symbol] ?? 100;
    const prev = this.prices.get(symbol) ?? base;
    // Random walk: ±1% per tick
    const next = prev * (1 + (Math.random() - 0.5) * 0.02);
    this.prices.set(symbol, next);
    return next;
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
    const { symbol, side, size, price = 0 } = params;

    const order: Order = {
      id:        `paper_${++this.orderCounter}_${Date.now()}`,
      symbol,
      type:      side,
      quantity:  size,
      price,
      status:    'FILLED',
      timestamp: new Date(),
    };

    // Update balances
    const usdt    = await this.getBalance('USDT');
    const asset   = await this.getBalance(symbol);
    const value   = size * price;

    if (side === 'BUY') {
      this.balances.set('USDT',  { ...usdt,  available: usdt.available  - value, total: usdt.total  - value });
      this.balances.set(symbol,  { ...asset, available: asset.available + size,  total: asset.total + size  });
    } else {
      this.balances.set('USDT',  { ...usdt,  available: usdt.available  + value, total: usdt.total  + value });
      this.balances.set(symbol,  { ...asset, available: asset.available - size,  total: asset.total - size  });
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
    if (!order) throw new Error(`Order not found: ${orderId}`);
    return order;
  }

  async getOrderHistory(limit = 500): Promise<Order[]> {
    const all = Array.from(this.orders.values());
    return all.slice(-Math.min(limit, all.length));
  }
}
