/**
 * CoinbaseClient — REST client for Coinbase Advanced Trade API v3.
 *
 * Auth scheme (legacy API-key format):
 *   CB-ACCESS-KEY       — your API key
 *   CB-ACCESS-SIGN      — HMAC-SHA256( timestamp + METHOD + path + body, base64-decoded secret )
 *   CB-ACCESS-TIMESTAMP — Unix seconds (float)
 *
 * Public endpoints (/products, /products/:id/ticker) need no credentials.
 * Private endpoints (/accounts, /orders) require all three headers.
 *
 * Sandbox base URL : https://api-sandbox.coinbase.com/api/v3/brokerage
 * Live base URL    : https://api.coinbase.com/api/v3/brokerage
 *
 * Note: Coinbase Advanced Trade replaced Coinbase Pro. If you have existing
 * Pro keys they work here; new keys are created at coinbase.com/settings/api.
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import logger from '../../logger.js';

// ── Config & shared types ─────────────────────────────────────────────────────

export interface CoinbaseConfig {
  apiKey:    string;
  apiSecret: string;
  baseUrl:   string;
  sandbox?:  boolean;
}

export interface CoinbaseOrder {
  order_id:         string;
  client_order_id?: string;
  product_id:       string;
  side:             'BUY' | 'SELL';
  order_type:       'LIMIT' | 'MARKET';
  size:             string;
  price?:           string;
  status:           'PENDING' | 'OPEN' | 'FILLED' | 'PARTIAL' | 'CANCELED' | 'EXPIRED';
  filled_size:      string;
  average_price?:   string;
  fee?:             string;
  created_time:     string;
  filled_time?:     string;
}

// ── CoinbaseClient ────────────────────────────────────────────────────────────

export class CoinbaseClient {
  private readonly apiKey:    string;
  private readonly apiSecret: string;
  private readonly baseUrl:   string;
  private readonly sandbox:   boolean;
  private readonly client:    AxiosInstance;

  constructor(config: CoinbaseConfig) {
    this.apiKey    = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl   = config.baseUrl.replace(/\/$/, '');
    this.sandbox   = config.sandbox ?? false;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /** HMAC-SHA256 over `timestamp + METHOD + path + body` using base64-decoded secret. */
  private sign(timestamp: number, method: string, path: string, body: string): string {
    const message = `${timestamp}${method}${path}${body}`;
    return crypto
      .createHmac('sha256', Buffer.from(this.apiSecret, 'base64'))
      .update(message)
      .digest('base64');
  }

  private authHeaders(method: string, path: string, body: string): Record<string, string> {
    const timestamp = Date.now() / 1000; // float seconds
    return {
      'CB-ACCESS-KEY':       this.apiKey,
      'CB-ACCESS-SIGN':      this.sign(timestamp, method, path, body),
      'CB-ACCESS-TIMESTAMP': String(timestamp),
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Unauthenticated GET (public endpoints). */
  private async publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    try {
      const resp = await this.client.get<T>(path, { params });
      return resp.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Coinbase public GET failed', { path, msg });
      throw new Error(`Coinbase ${path}: ${msg}`);
    }
  }

  /** Authenticated request (GET / POST / DELETE). */
  private async privateRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = this.authHeaders(method, path, bodyStr);

    try {
      const resp = await this.client.request<T>({
        method,
        url: path,
        headers,
        data: bodyStr || undefined,
      });
      return resp.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Coinbase private request failed', { method, path, msg });
      throw new Error(`Coinbase ${method} ${path}: ${msg}`);
    }
  }

  // ── Public endpoints ──────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      await this.publicGet('/products');
      return true;
    } catch {
      return false;
    }
  }

  async getTicker(productId: string): Promise<{ price: number; bid: number; ask: number }> {
    const data = await this.publicGet<{
      price: string;
      bid:   string;
      ask:   string;
    }>(`/products/${productId}/ticker`);

    return {
      price: parseFloat(data.price),
      bid:   parseFloat(data.bid),
      ask:   parseFloat(data.ask),
    };
  }

  async getProducts(): Promise<Array<{ product_id: string; base_currency: string; quote_currency: string }>> {
    const data = await this.publicGet<{
      products?: Array<{ product_id: string; base_currency: string; quote_currency: string }>;
    }>('/products');
    return data.products ?? (data as unknown as Array<{ product_id: string; base_currency: string; quote_currency: string }>);
  }

  // ── Private endpoints ─────────────────────────────────────────────────────

  async getAccounts(): Promise<Array<{ currency: string; available: string; held: string }>> {
    const data = await this.privateRequest<{
      accounts?: Array<{
        currency: string;
        available_balance?: { value: string };
        hold?: { value: string };
      }>;
    }>('GET', '/accounts');

    return (data.accounts ?? []).map(a => ({
      currency:  a.currency,
      available: a.available_balance?.value ?? '0',
      held:      a.hold?.value ?? '0',
    }));
  }

  async getBalance(currency: string): Promise<{ available: number; held: number; total: number }> {
    const accounts = await this.getAccounts();
    const account  = accounts.find(a => a.currency === currency);
    if (!account) return { available: 0, held: 0, total: 0 };

    const available = parseFloat(account.available);
    const held      = parseFloat(account.held);
    return { available, held, total: available + held };
  }

  async createOrder(params: {
    productId:       string;
    side:            'BUY' | 'SELL';
    orderType:       'LIMIT' | 'MARKET';
    size:            string;
    price?:          string;
    clientOrderId?:  string;
  }): Promise<CoinbaseOrder> {
    const { productId, side, orderType, size, price, clientOrderId } = params;

    const orderConfig: Record<string, unknown> =
      orderType === 'MARKET'
        ? { market_order: { base_size: size } }
        : {
            limit_limit_gtc: {
              base_size:   size,
              limit_price: price ?? '0',
              post_only:   false,
            },
          };

    const body = {
      client_order_id:     clientOrderId ?? randomUUID(),
      product_id:          productId,
      side:                side,
      order_configuration: orderConfig,
    };

    logger.info('Coinbase placing order', { productId, side, orderType, size, price });

    const data = await this.privateRequest<{
      success:              boolean;
      order_id?:            string;
      client_order_id?:     string;
      success_response?:    { order_id: string; product_id: string; side: string; client_order_id: string };
      error_response?:      { error: string; message: string; preview_failure_reason: string };
    }>('POST', '/orders', body);

    if (!data.success || !data.success_response) {
      throw new Error(
        `Coinbase order rejected: ${data.error_response?.message ?? 'unknown error'}`,
      );
    }

    const sr = data.success_response;
    return {
      order_id:         sr.order_id,
      client_order_id:  sr.client_order_id,
      product_id:       sr.product_id,
      side:             sr.side.toUpperCase() as 'BUY' | 'SELL',
      order_type:       orderType,
      size,
      price,
      status:           'PENDING',
      filled_size:      '0',
      created_time:     new Date().toISOString(),
    };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.privateRequest('POST', '/orders/batch_cancel', { order_ids: [orderId] });
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(productId?: string): Promise<CoinbaseOrder[]> {
    const params: Record<string, unknown> = { order_status: ['OPEN', 'PENDING'] };
    if (productId) params['product_id'] = productId;

    const data = await this.privateRequest<{ orders?: unknown[] }>('GET', '/orders/historical/batch');
    return (data.orders ?? []).map(o => this.parseOrder(o as Record<string, unknown>));
  }

  async getOrderStatus(orderId: string): Promise<CoinbaseOrder> {
    const data = await this.privateRequest<{ order?: unknown }>('GET', `/orders/historical/${orderId}`);
    if (!data.order) throw new Error(`Order ${orderId} not found`);
    return this.parseOrder(data.order as Record<string, unknown>);
  }

  async getOrderHistory(productId?: string, limit = 100): Promise<CoinbaseOrder[]> {
    const params: Record<string, unknown> = { limit: Math.min(limit, 250) };
    if (productId) params['product_id'] = productId;

    const data = await this.privateRequest<{ orders?: unknown[] }>('GET', '/orders/historical/batch');
    return (data.orders ?? []).map(o => this.parseOrder(o as Record<string, unknown>));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private parseOrder(o: Record<string, unknown>): CoinbaseOrder {
    const str  = (v: unknown) => String(v ?? '0');
    const cfg  = (o['order_configuration'] ?? {}) as Record<string, unknown>;
    const ll   = (cfg['limit_limit_gtc'] ?? cfg['limit_limit_ioc'] ?? {}) as Record<string, string>;
    const mo   = (cfg['market_market_ioc'] ?? {}) as Record<string, string>;
    const size = ll['base_size'] ?? mo['base_size'] ?? str(o['base_size']);

    return {
      order_id:        str(o['order_id']),
      client_order_id: o['client_order_id'] ? str(o['client_order_id']) : undefined,
      product_id:      str(o['product_id']),
      side:            (str(o['side']).toUpperCase()) as 'BUY' | 'SELL',
      order_type:      ll['base_size'] ? 'LIMIT' : 'MARKET',
      size,
      price:           ll['limit_price'],
      status:          this.parseStatus(str(o['status'])),
      filled_size:     str(o['filled_size'] ?? '0'),
      average_price:   o['average_filled_price'] ? str(o['average_filled_price']) : undefined,
      fee:             o['total_fees'] ? str(o['total_fees']) : undefined,
      created_time:    str(o['created_time']),
      filled_time:     o['last_fill_time'] ? str(o['last_fill_time']) : undefined,
    };
  }

  private parseStatus(s: string): CoinbaseOrder['status'] {
    switch (s.toUpperCase()) {
      case 'FILLED':           return 'FILLED';
      case 'PARTIALLY_FILLED': return 'PARTIAL';
      case 'CANCELLED':
      case 'CANCELED':
      case 'EXPIRED':
      case 'FAILED':           return 'CANCELED';
      case 'OPEN':             return 'OPEN';
      default:                 return 'PENDING';
    }
  }
}
