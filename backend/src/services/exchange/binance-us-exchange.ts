/**
 * BinanceUSExchange — REST adapter for Binance.US (and Binance testnet).
 *
 * Auth:    HMAC-SHA256 (X-MBX-APIKEY header + `signature` query param).
 * Symbol:  Internal "BTC" is mapped to Binance pair "BTCUSDT".
 *
 * Order tracking: Binance requires `symbol` alongside every `orderId` in
 * cancel / status calls. We maintain an in-process Map<orderId, symbol>
 * populated when placeOrder() succeeds so subsequent calls work without
 * the caller needing to pass the symbol again.
 */

import axios, { type AxiosInstance } from 'axios';
import crypto from 'crypto';
import type { ExchangeInterface, Order, Balance, PlaceOrderParams } from './exchange-interface.js';
import logger from '../../logger.js';

export interface BinanceUSConfig {
  apiKey:      string;
  apiSecret:   string;
  /** Defaults to Binance.US live endpoint when omitted. */
  baseUrl?:    string;
  useTestnet?: boolean;
}

export class BinanceUSExchange implements ExchangeInterface {
  private readonly apiKey:     string;
  private readonly apiSecret:  string;
  private readonly useTestnet: boolean;
  private readonly client:     AxiosInstance;

  /** orderId (string) → internal symbol (e.g. "BTC") */
  private readonly orderSymbols = new Map<string, string>();

  constructor(config: BinanceUSConfig) {
    this.apiKey     = config.apiKey;
    this.apiSecret  = config.apiSecret;
    this.useTestnet = config.useTestnet ?? false;

    const baseUrl = config.baseUrl ?? (this.useTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.us');

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private sign(params: Record<string, string | number>): string {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number> = {},
    signed = true,
  ): Promise<T> {
    const finalParams = { ...params };

    if (signed) {
      finalParams['timestamp'] = Date.now();
      finalParams['signature'] = this.sign(finalParams);
    }

    try {
      const response = await this.client.request<T>({
        method,
        url: path,
        ...(method === 'GET' || method === 'DELETE'
          ? { params: finalParams }
          : { data:   new URLSearchParams(
                Object.fromEntries(Object.entries(finalParams).map(([k, v]) => [k, String(v)])),
              ).toString(),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }),
      });
      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: { msg?: string } } };
      const msg = err.response?.data?.msg ?? String(error);
      logger.error('BinanceUS API error', { path, method, status: err.response?.status, msg });
      throw new Error(`BinanceUS ${method} ${path}: ${msg}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private pair(symbol: string): string {
    return symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  }

  private requireSymbol(orderId: string): string {
    const symbol = this.orderSymbols.get(orderId);
    if (!symbol) {
      throw new Error(
        `Symbol not found for orderId ${orderId}. ` +
        'Only orders placed through this exchange instance can be managed by ID.',
      );
    }
    return symbol;
  }

  // ── ExchangeInterface ─────────────────────────────────────────────────────

  async getExchangeName(): Promise<string> {
    return this.useTestnet ? 'Binance.US Testnet' : 'Binance.US Live';
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.request('GET', '/api/v3/ping', {}, false);
      return true;
    } catch {
      return false;
    }
  }

  async getBalance(symbol: string): Promise<Balance> {
    const account = await this.request<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
      'GET', '/api/v3/account',
    );
    const entry = account.balances.find(b => b.asset === symbol);
    if (!entry) return { symbol, available: 0, held: 0, total: 0 };

    const available = parseFloat(entry.free);
    const held      = parseFloat(entry.locked);
    return { symbol, available, held, total: available + held };
  }

  async getAllBalances(): Promise<Balance[]> {
    const account = await this.request<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
      'GET', '/api/v3/account',
    );
    return account.balances
      .map(b => ({
        symbol:    b.asset,
        available: parseFloat(b.free),
        held:      parseFloat(b.locked),
        total:     parseFloat(b.free) + parseFloat(b.locked),
      }))
      .filter(b => b.total > 0);
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    const ticker = await this.request<{ price: string }>(
      'GET', '/api/v3/ticker/price', { symbol: this.pair(symbol) }, false,
    );
    return parseFloat(ticker.price);
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    // Fetch the full ticker list (single unauthenticated call) and filter client-side.
    try {
      const tickers = await this.request<Array<{ symbol: string; price: string }>>(
        'GET', '/api/v3/ticker/price', {}, false,
      );
      const tickerMap = new Map(tickers.map(t => [t.symbol, parseFloat(t.price)]));
      for (const s of symbols) {
        const price = tickerMap.get(this.pair(s));
        if (price !== undefined) result.set(s, price);
      }
    } catch {
      // Fallback: individual calls
      await Promise.allSettled(
        symbols.map(async s => {
          try { result.set(s, await this.getCurrentPrice(s)); } catch { /* skip */ }
        }),
      );
    }
    return result;
  }

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const { symbol, side, size, price, orderType = 'LIMIT' } = params;

    const body: Record<string, string | number> = {
      symbol:      this.pair(symbol),
      side:        side.toUpperCase(),
      type:        orderType.toUpperCase(),
      quantity:    size,
      timeInForce: 'GTC',
    };
    if (orderType === 'LIMIT' && price !== undefined) {
      body['price'] = price;
    }

    logger.info('BinanceUS placing order', { symbol, side, size, price, orderType });

    const result = await this.request<{
      orderId:      number;
      symbol:       string;
      side:         string;
      origQty:      string;
      price:        string;
      status:       string;
      transactTime: number;
      fills?:       Array<{ commission: string }>;
    }>('POST', '/api/v3/order', body);

    const orderId = String(result.orderId);
    this.orderSymbols.set(orderId, symbol);

    return {
      id:         orderId,
      symbol,
      type:       side,
      quantity:   parseFloat(result.origQty),
      price:      price ?? parseFloat(result.price),
      status:     this.mapStatus(result.status),
      timestamp:  new Date(result.transactTime),
      commission: parseFloat(result.fills?.[0]?.commission ?? '0'),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const symbol = this.requireSymbol(orderId);
    try {
      await this.request('DELETE', '/api/v3/order', { symbol: this.pair(symbol), orderId });
      this.orderSymbols.delete(orderId);
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params: Record<string, string> = {};
    if (symbol) params['symbol'] = this.pair(symbol);

    const orders = await this.request<Array<{
      orderId: number; symbol: string; side: string; origQty: string;
      price: string; status: string; time: number;
    }>>('GET', '/api/v3/openOrders', params);

    return orders.map(o => ({
      id:        String(o.orderId),
      symbol:    o.symbol.replace('USDT', ''),
      type:      o.side as 'BUY' | 'SELL',
      quantity:  parseFloat(o.origQty),
      price:     parseFloat(o.price),
      status:    this.mapStatus(o.status),
      timestamp: new Date(o.time),
    }));
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const symbol = this.requireSymbol(orderId);
    const o = await this.request<{
      orderId: number; symbol: string; side: string; origQty: string;
      price: string; status: string; updateTime: number;
    }>('GET', '/api/v3/order', { symbol: this.pair(symbol), orderId });

    return {
      id:        String(o.orderId),
      symbol:    o.symbol.replace('USDT', ''),
      type:      o.side as 'BUY' | 'SELL',
      quantity:  parseFloat(o.origQty),
      price:     parseFloat(o.price),
      status:    this.mapStatus(o.status),
      timestamp: new Date(o.updateTime),
    };
  }

  async getOrderHistory(limit = 500): Promise<Order[]> {
    if (this.orderSymbols.size === 0) return [];

    // Fan out per tracked symbol
    const uniqueSymbols = [...new Set(this.orderSymbols.values())];
    const perSymbol = await Promise.allSettled(
      uniqueSymbols.map(sym =>
        this.request<Array<{
          orderId: number; symbol: string; side: string; origQty: string;
          price: string; status: string; updateTime: number;
        }>>('GET', '/api/v3/allOrders', { symbol: this.pair(sym), limit: Math.min(limit, 1000) }),
      ),
    );

    type RawOrder = { orderId: number; symbol: string; side: string; origQty: string; price: string; status: string; updateTime: number };
    const all: Order[] = perSymbol
      .filter((r): r is PromiseFulfilledResult<RawOrder[]> => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .map(o => ({
        id:        String(o.orderId),
        symbol:    o.symbol.replace('USDT', ''),
        type:      o.side as 'BUY' | 'SELL',
        quantity:  parseFloat(o.origQty),
        price:     parseFloat(o.price),
        status:    this.mapStatus(o.status),
        timestamp: new Date(o.updateTime),
      }));

    return all.slice(-Math.min(limit, all.length));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mapStatus(s: string): Order['status'] {
    switch (s.toUpperCase()) {
      case 'FILLED':           return 'FILLED';
      case 'PARTIALLY_FILLED': return 'PARTIAL';
      case 'CANCELED':
      case 'REJECTED':
      case 'EXPIRED':          return 'CANCELED';
      default:                 return 'PENDING';
    }
  }

  async disconnect(): Promise<void> {
    this.orderSymbols.clear();
    logger.info('BinanceUS exchange disconnected');
  }
}
