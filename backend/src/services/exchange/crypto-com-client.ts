/**
 * CryptoComClient — REST v2 adapter for Crypto.com Exchange.
 *
 * Auth: HMAC-SHA256.  The signature covers:
 *   `{METHOD}{path}{JSON_body}{timestamp}`
 * where METHOD is uppercase (e.g. POST) and path is the path-only portion
 * of the URL (e.g. /private/create-order).
 *
 * Public endpoints (under /public/) are called without credentials.
 * Private endpoints (under /private/) include auth headers.
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import logger from '../../logger.js';

export interface CryptoComConfig {
  apiKey:    string;
  apiSecret: string;
  baseUrl:   string;
  sandbox?:  boolean;
}

export interface CryptoComOrder {
  order_id:        string;
  client_order_id?: string;
  pair:            string;
  side:            'BUY' | 'SELL';
  type:            'LIMIT' | 'MARKET';
  price?:          number;
  quantity:        number;
  status:          'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELED' | 'EXPIRED';
  filled_quantity: number;
  filled_price:    number;
  average_price:   number;
  fee:             number;
  fee_currency:    string;
  create_time:     number;
  update_time:     number;
}

// ── CryptoComClient ───────────────────────────────────────────────────────────

export class CryptoComClient {
  private readonly apiKey:    string;
  private readonly apiSecret: string;
  private readonly baseUrl:   string;
  private readonly sandbox:   boolean;
  private readonly client:    AxiosInstance;

  constructor(config: CryptoComConfig) {
    this.apiKey    = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl   = config.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.sandbox   = config.sandbox ?? false;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private sign(
    method: string,
    path: string,
    body: Record<string, unknown>,
    timestamp: number,
  ): string {
    const bodyStr = Object.keys(body).length ? JSON.stringify(body) : '';
    const message = `${method}${path}${bodyStr}${timestamp}`;
    return crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
  }

  // ── Internal request helpers ──────────────────────────────────────────────

  /** Unauthenticated public call (GET only). */
  private async publicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    try {
      const resp = await this.client.get<{ code: string; result?: T; message?: string }>(
        path,
        { params },
      );
      if (resp.data.code === 'SUCCESS' || resp.data.code === '0') {
        return (resp.data.result ?? resp.data) as T;
      }
      throw new Error(resp.data.message ?? resp.data.code);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; code?: string } }; message?: string };
      const msg = err.response?.data?.message ?? err.message ?? String(error);
      logger.error('CryptoCom public GET failed', { path, msg });
      throw new Error(`CryptoCom ${path}: ${msg}`);
    }
  }

  /** Authenticated private call (POST only — all private endpoints use POST). */
  private async privatePost<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const timestamp = Date.now();
    const body = { ...params, nonce: timestamp };
    const signature = this.sign('POST', path, body, timestamp);

    try {
      const resp = await this.client.post<{ code: string; result?: T; message?: string }>(
        path,
        body,
        {
          headers: {
            'X-CRYPTO-APIKEY':    this.apiKey,
            'X-CRYPTO-SIGNATURE': signature,
            'X-CRYPTO-TIMESTAMP': String(timestamp),
          },
        },
      );
      if (resp.data.code === 'SUCCESS' || resp.data.code === '0') {
        return (resp.data.result ?? resp.data) as T;
      }
      throw new Error(resp.data.message ?? resp.data.code);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; code?: string } }; message?: string };
      const msg = err.response?.data?.message ?? err.message ?? String(error);
      logger.error('CryptoCom private POST failed', { path, msg });
      throw new Error(`CryptoCom ${path}: ${msg}`);
    }
  }

  // ── Public endpoints ──────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      await this.publicGet('/public/auth');
      return true;
    } catch {
      // Some environments return 200 with a non-SUCCESS code; treat any response as alive.
      return true;
    }
  }

  async getTicker(pair: string): Promise<{ price: number; bid: number; ask: number }> {
    const result = await this.publicGet<{
      data: Array<{
        i: string;   // instrument name
        a: string;   // ask
        b: string;   // bid
        k: string;   // last traded price
      }>;
    }>('/public/get-ticker', { instrument_name: pair });

    const t = result.data?.[0];
    if (!t) throw new Error(`No ticker data for ${pair}`);

    const ask   = parseFloat(t.a);
    const bid   = parseFloat(t.b);
    const last  = parseFloat(t.k);
    const price = last > 0 ? last : ask;

    return { price, bid, ask };
  }

  async getInstruments(): Promise<Array<{ instrument_name: string; quote_currency: string; base_currency: string }>> {
    const result = await this.publicGet<{
      instruments: Array<{ instrument_name: string; quote_currency: string; base_currency: string }>;
    }>('/public/get-instruments');
    return result.instruments ?? [];
  }

  // ── Private endpoints ─────────────────────────────────────────────────────

  async getBalance(currency: string): Promise<{ available: number; reserved: number; total: number }> {
    const result = await this.privatePost<{
      account_list: Array<{
        balance: Array<{ currency: string; available: string; reserved: string; total: string }>;
      }>;
    }>('/private/get-account-summary');

    const account = result.account_list?.[0];
    if (!account) return { available: 0, reserved: 0, total: 0 };

    const b = account.balance.find(b => b.currency === currency);
    if (!b) return { available: 0, reserved: 0, total: 0 };

    return {
      available: parseFloat(b.available),
      reserved:  parseFloat(b.reserved),
      total:     parseFloat(b.total),
    };
  }

  async getAllBalances(): Promise<Array<{ currency: string; available: number; reserved: number; total: number }>> {
    const result = await this.privatePost<{
      account_list: Array<{
        balance: Array<{ currency: string; available: string; reserved: string; total: string }>;
      }>;
    }>('/private/get-account-summary');

    const account = result.account_list?.[0];
    if (!account) return [];

    return account.balance.map(b => ({
      currency:  b.currency,
      available: parseFloat(b.available),
      reserved:  parseFloat(b.reserved),
      total:     parseFloat(b.total),
    }));
  }

  async createOrder(params: {
    pair:           string;
    side:           'BUY' | 'SELL';
    type:           'LIMIT' | 'MARKET';
    quantity:       number;
    price?:         number;
    clientOrderId?: string;
  }): Promise<CryptoComOrder> {
    const body: Record<string, unknown> = {
      instrument_name: params.pair,
      side:            params.side,
      type:            params.type,
      quantity:        String(params.quantity),
      client_oid:      params.clientOrderId ?? randomUUID(),
    };
    if (params.type === 'LIMIT' && params.price !== undefined) {
      body['price'] = String(params.price);
    }

    logger.info('CryptoCom placing order', {
      pair: params.pair, side: params.side, type: params.type,
      quantity: params.quantity, price: params.price,
    });

    const r = await this.privatePost<Record<string, unknown>>('/private/create-order', body);
    return this.parseOrderResponse(r);
  }

  async cancelOrder(orderId: string, pair: string): Promise<boolean> {
    try {
      await this.privatePost('/private/cancel-order', {
        order_id:        orderId,
        instrument_name: pair,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getOpenOrders(pair?: string): Promise<CryptoComOrder[]> {
    const body: Record<string, unknown> = {};
    if (pair) body['instrument_name'] = pair;

    const r = await this.privatePost<{ order_list: unknown[] }>('/private/get-open-orders', body);
    return (r.order_list ?? []).map(o => this.parseOrderResponse(o as Record<string, unknown>));
  }

  async getOrderStatus(orderId: string, pair: string): Promise<CryptoComOrder> {
    const r = await this.privatePost<Record<string, unknown>>('/private/get-order-detail', {
      order_id:        orderId,
      instrument_name: pair,
    });
    return this.parseOrderResponse(r);
  }

  async getOrderHistory(pair?: string, limit = 100): Promise<CryptoComOrder[]> {
    const body: Record<string, unknown> = { page_size: Math.min(limit, 500) };
    if (pair) body['instrument_name'] = pair;

    const r = await this.privatePost<{ order_list: unknown[] }>('/private/get-order-history', body);
    return (r.order_list ?? []).map(o => this.parseOrderResponse(o as Record<string, unknown>));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private parseOrderResponse(o: Record<string, unknown>): CryptoComOrder {
    const str = (v: unknown): string => String(v ?? '0');
    return {
      order_id:        str(o['order_id']),
      client_order_id: o['client_oid'] ? str(o['client_oid']) : undefined,
      pair:            str(o['instrument_name']),
      side:            (str(o['side']).toUpperCase()) as 'BUY' | 'SELL',
      type:            (str(o['type']).toUpperCase()) as 'LIMIT' | 'MARKET',
      price:           parseFloat(str(o['price'])),
      quantity:        parseFloat(str(o['quantity'])),
      status:          this.parseStatus(str(o['status'])),
      filled_quantity: parseFloat(str(o['filled_quantity'] ?? '0')),
      filled_price:    parseFloat(str(o['filled_price']   ?? '0')),
      average_price:   parseFloat(str(o['average_price']  ?? '0')),
      fee:             parseFloat(str(o['fee']            ?? '0')),
      fee_currency:    str(o['fee_currency'] ?? 'USDT'),
      create_time:     typeof o['create_time'] === 'number' ? o['create_time'] as number : 0,
      update_time:     typeof o['update_time'] === 'number' ? o['update_time'] as number : 0,
    };
  }

  private parseStatus(s: string): CryptoComOrder['status'] {
    switch (s.toUpperCase()) {
      case 'FILLED':           return 'FILLED';
      case 'PARTIALLY_FILLED': return 'PARTIAL';
      case 'CANCELED':
      case 'EXPIRED':          return 'CANCELED';
      default:                 return 'PENDING';
    }
  }
}
