/**
 * Binance adapter.
 *
 * Testnet (testnet.binance.vision) is used automatically for PAPER and
 * PAPER_CONNECTED modes; the production endpoint is used for LIVE_*.
 *
 * Auth: X-MBX-APIKEY header + HMAC-SHA256 signature appended as query param.
 * Symbol convention: internal "BTC" → Binance "BTCUSDT".
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

interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
}

export class BinanceAdapter extends ExchangeAdapter {
  name = 'Binance';
  mode: AccountMode;

  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(mode: AccountMode, credentials: BinanceCredentials) {
    super();
    this.mode      = mode;
    this.apiKey    = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;

    const useTestnet =
      credentials.testnet === true ||
      mode === 'PAPER' ||
      mode === 'PAPER_CONNECTED';

    this.apiUrl = useTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';
  }

  async authenticate(): Promise<void> {
    try {
      const account = await this.getAccount();
      logger.info('Binance authenticated', { balance: account.balance, mode: this.mode });
    } catch (error) {
      logger.error('Binance auth failed', { error: String(error) });
      throw error;
    }
  }

  // ── HMAC-SHA256 request signing ──────────────────────────────────────────

  private generateSignature(params: Record<string, string | number>): string {
    const queryString = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  private async request(
    method: string,
    path: string,
    params: Record<string, string | number> = {},
    signed = true,
  ): Promise<unknown> {
    const finalParams = { ...params };

    if (signed) {
      finalParams['timestamp'] = Date.now();
      finalParams['signature'] = this.generateSignature(finalParams);
    }

    try {
      const response = await axios({
        method,
        url:     `${this.apiUrl}${path}`,
        params:  finalParams,
        headers: { 'X-MBX-APIKEY': this.apiKey },
      });
      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number; data?: unknown } };
      logger.error('Binance API error', {
        path,
        status: err.response?.status,
        error:  err.response?.data,
      });
      throw error;
    }
  }

  // ── ExchangeAdapter implementation ───────────────────────────────────────

  async getAccount(): Promise<ExchangeAccount> {
    const account = (await this.request('GET', '/api/v3/account', {}, true)) as {
      accountId: string;
      balances: Array<{ asset: string; free: string; locked: string }>;
      positions?: Array<{
        symbol: string;
        positionAmt: string;
        entryPrice: string;
        markPrice: string;
        unrealizedProfit: string;
      }>;
    };

    const totalBalance = account.balances.reduce(
      (sum, b) => sum + parseFloat(b.free),
      0,
    );

    return {
      account_id:        account.accountId ?? 'binance',
      mode:              this.mode,
      balance:           totalBalance,
      available_balance: totalBalance,
      holds:             0,
      positions: (account.positions ?? []).map(p => ({
        symbol:         p.symbol.replace('USDT', ''),
        quantity:       parseFloat(p.positionAmt),
        avg_entry:      parseFloat(p.entryPrice),
        current_price:  parseFloat(p.markPrice),
        unrealized_pnl: parseFloat(p.unrealizedProfit),
      })),
      orders: [],
    };
  }

  async getPrice(symbol: string): Promise<ExchangePrice> {
    const ticker = (await this.request(
      'GET',
      '/api/v3/ticker/24hr',
      { symbol: `${symbol}USDT` },
      false,
    )) as Record<string, string>;

    return {
      symbol,
      price:     parseFloat(ticker['lastPrice']),
      timestamp: new Date(),
      bid:       parseFloat(ticker['bidPrice']),
      ask:       parseFloat(ticker['askPrice']),
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

    const params: Record<string, string> = {
      symbol:    `${symbol}USDT`,
      side:      type,
      type:      price ? 'LIMIT' : 'MARKET',
      quantity:  quantity.toString(),
    };

    if (price) {
      params['price']       = price.toString();
      params['timeInForce'] = 'GTC';
    }

    logger.info('Placing order on Binance', { symbol, type, quantity, price, mode: this.mode });

    const order = (await this.request('POST', '/api/v3/order', params, true)) as Record<string, string>;

    return {
      id:        order['orderId'],
      symbol,
      type,
      status:    'PENDING',
      quantity:  parseFloat(order['origQty']),
      price:     price ?? 0,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request('DELETE', '/api/v3/order', { orderId }, true);
    logger.info('Order cancelled', { orderId });
  }

  async getOrder(orderId: string): Promise<ExchangeOrder> {
    const order = (await this.request(
      'GET',
      '/api/v3/order',
      { orderId },
      true,
    )) as Record<string, string>;

    return {
      id:              order['orderId'],
      symbol:          order['symbol'].replace('USDT', ''),
      type:            order['side'] as 'BUY' | 'SELL',
      status:          this.mapOrderStatus(order['status']),
      quantity:        parseFloat(order['origQty']),
      price:           parseFloat(order['price']),
      filled_quantity: parseFloat(order['executedQty']),
      timestamp:       new Date(parseInt(order['time'], 10)),
    };
  }

  async getOrders(status?: string): Promise<ExchangeOrder[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;

    const orders = (await this.request('GET', '/api/v3/allOrders', params, true)) as Array<Record<string, string>>;

    return orders.map(o => ({
      id:              o['orderId'],
      symbol:          o['symbol'].replace('USDT', ''),
      type:            o['side'] as 'BUY' | 'SELL',
      status:          this.mapOrderStatus(o['status']),
      quantity:        parseFloat(o['origQty']),
      price:           parseFloat(o['price']),
      filled_quantity: parseFloat(o['executedQty']),
      timestamp:       new Date(parseInt(o['time'], 10)),
    }));
  }

  async getPositions(): Promise<ExchangePosition[]> {
    const account = await this.getAccount();
    return account.positions;
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mapOrderStatus(binanceStatus: string): ExchangeOrder['status'] {
    switch (binanceStatus.toUpperCase()) {
      case 'FILLED':          return 'FILLED';
      case 'CANCELED':
      case 'REJECTED':
      case 'EXPIRED':         return 'FAILED';
      default:                return 'PENDING';
    }
  }

  private validateOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    quantity: number,
    price?: number,
  ): void {
    if (this.mode === 'LIVE_MICRO') {
      const maxTradeValue = 1;  // $1 hard cap
      const estimatedCost = (price ?? 100) * quantity;

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
