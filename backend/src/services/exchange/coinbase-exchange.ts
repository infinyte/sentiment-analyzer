/**
 * CoinbaseExchange — ExchangeInterface adapter for Coinbase Advanced Trade API.
 *
 * Symbol convention: internal "BTC" maps to Coinbase product "BTC-USD".
 * Override the default quote currency via config.quoteCurrency if you need
 * USDC-quoted pairs (e.g. BTC-USDC).
 *
 * Fees (Advanced Trade tier 0, may be lower with volume):
 *   Maker: 0.60%  |  Taker: 1.20%
 */

import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';
import type { CoinbaseClient, CoinbaseOrder } from './coinbase-client.js';
import logger from '../../logger.js';

export interface CoinbaseExchangeConfig {
  /** Default product used by getOpenOrders / getOrderHistory. Default: 'BTC-USD'. */
  defaultProduct?: string;
  /** Quote currency appended when normalising bare symbols. Default: 'USD'. */
  quoteCurrency?:  string;
  feeMaker?:       number;  // fraction e.g. 0.006
  feeTaker?:       number;  // fraction e.g. 0.012
}

export class CoinbaseExchange implements ExchangeInterface {
  private readonly client:         CoinbaseClient;
  private readonly defaultProduct: string;
  private readonly quoteCurrency:  string;
  private readonly feeMaker:       number;
  private readonly feeTaker:       number;

  /** orderId → internal symbol (e.g. 'BTC'), populated by placeOrder(). */
  private readonly orderSymbols = new Map<string, string>();

  constructor(client: CoinbaseClient, config: CoinbaseExchangeConfig = {}) {
    this.client         = client;
    this.defaultProduct = config.defaultProduct ?? 'BTC-USD';
    this.quoteCurrency  = config.quoteCurrency  ?? 'USD';
    this.feeMaker       = config.feeMaker       ?? 0.006;
    this.feeTaker       = config.feeTaker       ?? 0.012;
  }

  // ── ExchangeInterface ─────────────────────────────────────────────────────

  async getExchangeName(): Promise<string> {
    return 'Coinbase Advanced Trade';
  }

  async isConnected(): Promise<boolean> {
    return this.client.ping();
  }

  async getBalance(symbol: string): Promise<Balance> {
    const b = await this.client.getBalance(symbol);
    return { symbol, available: b.available, held: b.held, total: b.total };
  }

  async getAllBalances(): Promise<Balance[]> {
    const accounts = await this.client.getAccounts();
    return accounts
      .filter(a => parseFloat(a.available) > 0 || parseFloat(a.held) > 0)
      .map(a => ({
        symbol:    a.currency,
        available: parseFloat(a.available),
        held:      parseFloat(a.held),
        total:     parseFloat(a.available) + parseFloat(a.held),
      }));
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const productId = this.toProduct(symbol);
    const ticker    = await this.client.getTicker(productId);
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
    const productId = this.toProduct(symbol);

    // Enforce $1 minimum notional
    const notional = size * (price ?? await this.getCurrentPrice(symbol));
    if (notional < 1.0) {
      throw new Error(
        `Order too small: $${notional.toFixed(4)} (Coinbase minimum is $1.00)`,
      );
    }

    logger.info('Coinbase placeOrder', { symbol, side, size, price, orderType });

    const cbOrder = await this.client.createOrder({
      productId,
      side:     side.toUpperCase() as 'BUY' | 'SELL',
      orderType: orderType.toUpperCase() as 'LIMIT' | 'MARKET',
      size:     size.toString(),
      price:    price?.toString(),
      clientOrderId: `sa_${Date.now()}`,
    });

    this.orderSymbols.set(cbOrder.order_id, symbol);
    return this.mapOrder(cbOrder, symbol);
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const ok = await this.client.cancelOrder(orderId);
    if (ok) this.orderSymbols.delete(orderId);
    return ok;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const productId = symbol ? this.toProduct(symbol) : undefined;
    const orders    = await this.client.getOpenOrders(productId);
    return orders.map(o => this.mapOrder(o, this.fromProduct(o.product_id)));
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const symbol = this.requireSymbol(orderId);
    const o      = await this.client.getOrderStatus(orderId);
    return this.mapOrder(o, symbol);
  }

  async getOrderHistory(limit = 100): Promise<Order[]> {
    const orders = await this.client.getOrderHistory(this.defaultProduct, limit);
    return orders.map(o => this.mapOrder(o, this.fromProduct(o.product_id)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** 'BTC' → 'BTC-USD' (pass-through if already contains '-'). */
  private toProduct(symbol: string): string {
    return symbol.includes('-') ? symbol.toUpperCase() : `${symbol.toUpperCase()}-${this.quoteCurrency}`;
  }

  /** 'BTC-USD' → 'BTC' */
  private fromProduct(productId: string): string {
    return productId.split('-')[0] ?? productId;
  }

  private requireSymbol(orderId: string): string {
    const s = this.orderSymbols.get(orderId);
    if (!s) {
      throw new Error(
        `Symbol not found for orderId ${orderId}. ` +
        'Only orders placed through this instance can be looked up by ID.',
      );
    }
    return s;
  }

  private mapOrder(o: CoinbaseOrder, symbol: string): Order {
    return {
      id:         o.order_id,
      symbol,
      type:       o.side.toUpperCase() as 'BUY' | 'SELL',
      quantity:   parseFloat(o.size),
      price:      o.price ? parseFloat(o.price) : 0,
      status:     this.mapStatus(o.status),
      timestamp:  new Date(o.created_time || Date.now()),
      commission: o.fee ? parseFloat(o.fee) : undefined,
    };
  }

  private mapStatus(s: CoinbaseOrder['status']): Order['status'] {
    switch (s) {
      case 'FILLED':   return 'FILLED';
      case 'PARTIAL':  return 'PARTIAL';
      case 'CANCELED':
      case 'EXPIRED':  return 'CANCELED';
      default:         return 'PENDING';
    }
  }
}
