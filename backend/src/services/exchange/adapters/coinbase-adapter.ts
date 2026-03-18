/**
 * Coinbase Advanced Trade / Exchange adapter.
 *
 * Sandbox (api-sandbox.exchange.coinbase.com) is used automatically for
 * PAPER and PAPER_CONNECTED modes; the live endpoint is used for LIVE_*.
 *
 * Auth: CB-ACCESS-SIGN HMAC-SHA256 (key + secret + passphrase).
 */

import axios from 'axios';
import crypto from 'crypto';
import type {
  AccountMode,
  ExchangeAccount,
  ExchangeOrder,
  ExchangePosition,
  ExchangePrice,
} from '../exchange-adapter.js';
import { ExchangeAdapter } from '../exchange-adapter.js';
import logger from '../../../logger.js';

interface CoinbaseCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  accountId: string;
  sandbox?: boolean;
}

export class CoinbaseAdapter extends ExchangeAdapter {
  name = 'Coinbase Pro';
  mode: AccountMode;

  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private readonly accountId: string;

  constructor(mode: AccountMode, credentials: CoinbaseCredentials) {
    super();
    this.mode       = mode;
    this.apiKey     = credentials.apiKey;
    this.apiSecret  = credentials.apiSecret;
    this.passphrase = credentials.passphrase;
    this.accountId  = credentials.accountId;

    const useSandbox =
      credentials.sandbox === true ||
      mode === 'PAPER' ||
      mode === 'PAPER_CONNECTED';

    this.apiUrl = useSandbox
      ? 'https://api-sandbox.exchange.coinbase.com'
      : 'https://api.exchange.coinbase.com';
  }

  async authenticate(): Promise<void> {
    try {
      const account = await this.getAccount();
      logger.info('Coinbase authenticated', {
        accountId: account.account_id,
        balance:   account.balance,
        mode:      this.mode,
      });
    } catch (error) {
      logger.error('Coinbase auth failed', { error: String(error) });
      throw error;
    }
  }

  // ── HMAC-SHA256 request signing ──────────────────────────────────────────

  private generateHeaders(
    method: string,
    path: string,
    body = '',
  ): Record<string, string | number> {
    const timestamp = Date.now() / 1000;
    const message   = `${timestamp}${method}${path}${body}`;
    const signature = crypto
      .createHmac('sha256', Buffer.from(this.apiSecret, 'base64'))
      .update(message)
      .digest('base64');

    return {
      'CB-ACCESS-KEY':       this.apiKey,
      'CB-ACCESS-SIGN':      signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'CB-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type':        'application/json',
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = this.generateHeaders(method.toUpperCase(), path, bodyStr);

    try {
      const response = await axios({
        method,
        url:     `${this.apiUrl}${path}`,
        headers,
        data:    bodyStr || undefined,
      });
      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: unknown } };
      logger.error('Coinbase API error', {
        method,
        path,
        status: err.response?.status,
        error:  err.response?.data,
      });
      throw error;
    }
  }

  // ── IBrokerAdapter implementation ────────────────────────────────────────

  async getAccount(): Promise<ExchangeAccount> {
    const accountData = (await this.request('GET', `/accounts/${this.accountId}`)) as Record<string, string>;
    const orders      = (await this.request('GET', '/orders?status=all')) as Array<Record<string, string>>;
    const positions   = (await this.request('GET', '/position')) as Array<Record<string, string>>;

    return {
      account_id:        accountData['id'],
      mode:              this.mode,
      balance:           parseFloat(accountData['balance']),
      available_balance: parseFloat(accountData['available']),
      holds:             parseFloat(accountData['hold']),
      positions: positions.map(p => ({
        symbol:         p['product_id'],
        quantity:       parseFloat(p['size']),
        avg_entry:      parseFloat(p['avg_entry_price']),
        current_price:  parseFloat(p['current_price']),
        unrealized_pnl: (parseFloat(p['current_price']) - parseFloat(p['avg_entry_price'])) * parseFloat(p['size']),
      })),
      orders: orders.map(o => ({
        id:              o['id'],
        symbol:          o['product_id'],
        type:            o['side'].toUpperCase() as 'BUY' | 'SELL',
        status:          o['status'].toUpperCase() as ExchangeOrder['status'],
        quantity:        parseFloat(o['size']),
        price:           parseFloat(o['price']),
        filled_quantity: parseFloat(o['filled_size']),
        timestamp:       new Date(o['created_at']),
      })),
    };
  }

  async getPrice(symbol: string): Promise<ExchangePrice> {
    const productId = `${symbol}-USD`;
    const ticker    = (await this.request('GET', `/products/${productId}/ticker`)) as Record<string, string>;

    return {
      symbol,
      price:     parseFloat(ticker['price']),
      timestamp: new Date(),
      bid:       parseFloat(ticker['bid']),
      ask:       parseFloat(ticker['ask']),
      volume24h: parseFloat(ticker['volume']),
    };
  }

  async getPrices(symbols: string[]): Promise<ExchangePrice[]> {
    return Promise.all(symbols.map(s => this.getPrice(s)));
  }

  async placeOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    quantity: number,
    price?: number,
  ): Promise<ExchangeOrder> {
    this.validateOrder(symbol, type, quantity, price);

    const productId = `${symbol}-USD`;
    const orderBody = {
      side:            type.toLowerCase(),
      product_id:      productId,
      client_order_id: `${Date.now()}_${Math.random()}`,
      type:            price ? 'limit' : 'market',
      size:            quantity.toString(),
      ...(price && { price: price.toString() }),
    };

    logger.info('Placing order on Coinbase', { symbol, type, quantity, price, mode: this.mode });

    const order = (await this.request('POST', '/orders', orderBody)) as Record<string, string>;

    return {
      id:        order['id'],
      symbol,
      type,
      status:    'PENDING',
      quantity,
      price:     price ?? 0,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request('DELETE', `/orders/${orderId}`);
    logger.info('Order cancelled', { orderId });
  }

  async getOrder(orderId: string): Promise<ExchangeOrder> {
    const order = (await this.request('GET', `/orders/${orderId}`)) as Record<string, string>;

    return {
      id:              order['id'],
      symbol:          order['product_id'].replace('-USD', ''),
      type:            order['side'].toUpperCase() as 'BUY' | 'SELL',
      status:          order['status'].toUpperCase() as ExchangeOrder['status'],
      quantity:        parseFloat(order['size']),
      price:           parseFloat(order['price']),
      filled_quantity: parseFloat(order['filled_size']),
      timestamp:       new Date(order['created_at']),
    };
  }

  async getOrders(status = 'done'): Promise<ExchangeOrder[]> {
    const orders = (await this.request('GET', `/orders?status=${status}`)) as Array<Record<string, string>>;

    return orders.map(o => ({
      id:              o['id'],
      symbol:          o['product_id'].replace('-USD', ''),
      type:            o['side'].toUpperCase() as 'BUY' | 'SELL',
      status:          o['status'].toUpperCase() as ExchangeOrder['status'],
      quantity:        parseFloat(o['size']),
      price:           parseFloat(o['price']),
      filled_quantity: parseFloat(o['filled_size']),
      timestamp:       new Date(o['created_at']),
    }));
  }

  async getPositions(): Promise<ExchangePosition[]> {
    const positions = (await this.request('GET', '/position')) as Array<Record<string, string>>;

    return positions.map(p => ({
      symbol:         p['product_id'].replace('-USD', ''),
      quantity:       parseFloat(p['size']),
      avg_entry:      parseFloat(p['avg_entry_price']),
      current_price:  parseFloat(p['current_price']),
      unrealized_pnl: (parseFloat(p['current_price']) - parseFloat(p['avg_entry_price'])) * parseFloat(p['size']),
    }));
  }

  async getPosition(symbol: string): Promise<ExchangePosition | null> {
    const positions = await this.getPositions();
    return positions.find(p => p.symbol === symbol) ?? null;
  }

  async closePosition(symbol: string): Promise<ExchangeOrder> {
    const position = await this.getPosition(symbol);
    if (!position) throw new Error(`No open position for ${symbol}`);
    return this.placeOrder(symbol, 'SELL', position.quantity);
  }

  /** No persistent connection to close (stateless HTTP). */
  async disconnect(): Promise<void> {
    logger.info('Coinbase adapter disconnected', { mode: this.mode });
  }

  // ── Safety guard ─────────────────────────────────────────────────────────

  private validateOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    quantity: number,
    price?: number,
  ): void {
    if (this.mode === 'LIVE_MICRO') {
      const maxTradeValue   = 1;  // $1 hard cap
      const estimatedCost   = (price ?? 100) * quantity;

      if (estimatedCost > maxTradeValue) {
        logger.warn('Order rejected: exceeds LIVE_MICRO limit', {
          symbol, type, quantity, estimatedCost, maxAllowed: maxTradeValue,
        });
        throw new Error(
          `Order for ${symbol} (est. $${estimatedCost.toFixed(2)}) exceeds LIVE_MICRO $${maxTradeValue} limit`,
        );
      }
    }
  }
}
