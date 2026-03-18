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
  apiKey?: string;
  apiSecret?: string;
  testnet?: boolean;
}

export class BinanceAdapter extends ExchangeAdapter {
  name = 'Binance';
  mode: AccountMode;

  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;

  /** True when PAPER mode has no credentials — all account ops are local simulation. */
  private readonly simulated: boolean;

  // ── Local simulation state ────────────────────────────────────────────────
  private simBalance = 10_000;   // starting USDT paper balance
  private simOrderCounter = 0;
  private simOrders: Map<string, ExchangeOrder> = new Map();

  // ── Live order tracking (issue 4) ─────────────────────────────────────────
  // Binance requires `symbol` alongside `orderId` for cancel/getOrder calls.
  // We populate this when an order is placed so we can look up the symbol later.
  private readonly orderSymbolMap = new Map<string, string>();

  // ── Known traded symbols (issue 2) ───────────────────────────────────────
  // /api/v3/allOrders requires a symbol; we track every symbol we've traded
  // so getOrders() can fan out per symbol and merge results.
  private readonly trackedSymbols = new Set<string>();

  constructor(mode: AccountMode, credentials: BinanceCredentials = {}) {
    super();
    this.mode      = mode;
    this.apiKey    = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;

    const hasCredentials = Boolean(credentials.apiKey && credentials.apiSecret);

    this.simulated = mode === 'PAPER' && !hasCredentials;

    const useTestnet =
      credentials.testnet === true ||
      mode === 'PAPER' ||
      mode === 'PAPER_CONNECTED';

    this.apiUrl = useTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';

    if (this.simulated) {
      logger.info('Binance PAPER mode: no testnet credentials provided — using local simulation');
    }
  }

  async authenticate(): Promise<void> {
    if (this.simulated) {
      logger.info('Binance PAPER simulation: skipping auth (no credentials required)');
      return;
    }
    this.requireCredentials();
    try {
      const account = await this.getAccount();
      logger.info('Binance authenticated', { balance: account.balance, mode: this.mode });
    } catch (error) {
      logger.error('Binance auth failed', { error: String(error) });
      throw error;
    }
  }

  /** Throws a descriptive error if credentials are absent for a live operation. */
  private requireCredentials(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        `Binance ${this.mode} mode requires API credentials (apiKey + apiSecret). ` +
        'Provide them when connecting this broker.',
      );
    }
  }

  // ── HMAC-SHA256 request signing ──────────────────────────────────────────

  private generateSignature(params: Record<string, string | number>): string {
    // apiSecret is guaranteed non-null here because requireCredentials() was called first
    const queryString = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();
    return crypto
      .createHmac('sha256', this.apiSecret!)
      .update(queryString)
      .digest('hex');
  }

  private async request(
    method: string,
    path: string,
    params: Record<string, string | number> = {},
    signed = true,
  ): Promise<unknown> {
    if (signed) this.requireCredentials();
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
    if (this.simulated) {
      return {
        account_id:        'binance-paper-sim',
        mode:              this.mode,
        balance:           this.simBalance,
        available_balance: this.simBalance,
        holds:             0,
        positions:         [],
        orders:            Array.from(this.simOrders.values()),
      };
    }

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

    // Sum only USDT balances — mixing asset quantities across different assets
    // (BTC, ETH, USDT) as if they share a unit produces a meaningless number.
    const usdtEntry = account.balances.find(b => b.asset === 'USDT');
    const totalBalance     = usdtEntry ? parseFloat(usdtEntry.free) + parseFloat(usdtEntry.locked) : 0;
    const availableBalance = usdtEntry ? parseFloat(usdtEntry.free) : 0;
    const holds            = usdtEntry ? parseFloat(usdtEntry.locked) : 0;

    return {
      account_id:        account.accountId ?? 'binance',
      mode:              this.mode,
      balance:           totalBalance,
      available_balance: availableBalance,
      holds,
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

    if (this.simulated) {
      const orderId  = `SIM-${++this.simOrderCounter}`;
      const fillPrice = price ?? 0;
      const tradeValue = fillPrice * quantity;
      this.simBalance += type === 'SELL' ? tradeValue : -tradeValue;

      const order: ExchangeOrder = {
        id:        orderId,
        symbol,
        type,
        status:    'FILLED',
        quantity,
        price:     fillPrice,
        filled_quantity: quantity,
        timestamp: new Date(),
      };
      this.simOrders.set(orderId, order);
      logger.info('Binance PAPER sim: order filled', { orderId, symbol, type, quantity, price: fillPrice });
      return order;
    }

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

    const orderId = order['orderId'];
    // Track symbol so cancelOrder / getOrder can supply it to the API (required by Binance).
    this.orderSymbolMap.set(orderId, symbol);
    this.trackedSymbols.add(symbol);

    return {
      id:        orderId,
      symbol,
      type,
      status:    'PENDING',
      quantity:  parseFloat(order['origQty']),
      price:     price ?? 0,
      timestamp: new Date(),
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (this.simulated) {
      const order = this.simOrders.get(orderId);
      if (!order) throw new Error(`Simulated order ${orderId} not found`);
      order.status = 'FAILED';
      logger.info('Binance PAPER sim: order cancelled', { orderId });
      return;
    }
    const symbol = this.orderSymbolMap.get(orderId);
    if (!symbol) {
      throw new Error(
        `Cannot cancel order ${orderId}: symbol not found. ` +
        'Only orders placed through this adapter instance can be cancelled.',
      );
    }
    await this.request('DELETE', '/api/v3/order', { symbol: `${symbol}USDT`, orderId }, true);
    this.orderSymbolMap.delete(orderId);
    logger.info('Order cancelled', { orderId, symbol });
  }

  async getOrder(orderId: string): Promise<ExchangeOrder> {
    if (this.simulated) {
      const order = this.simOrders.get(orderId);
      if (!order) throw new Error(`Simulated order ${orderId} not found`);
      return order;
    }

    const symbol = this.orderSymbolMap.get(orderId);
    if (!symbol) {
      throw new Error(
        `Cannot get order ${orderId}: symbol not found. ` +
        'Only orders placed through this adapter instance can be retrieved by ID.',
      );
    }
    const order = (await this.request(
      'GET',
      '/api/v3/order',
      { symbol: `${symbol}USDT`, orderId },
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
    if (this.simulated) {
      const all = Array.from(this.simOrders.values());
      return status ? all.filter(o => o.status === status) : all;
    }

    // Binance /api/v3/allOrders requires `symbol` and does not accept a `status`
    // filter. We fan out per tracked symbol and filter client-side.
    if (this.trackedSymbols.size === 0) return [];

    const perSymbol = await Promise.all(
      Array.from(this.trackedSymbols).map(sym =>
        this.request('GET', '/api/v3/allOrders', { symbol: `${sym}USDT` }, true)
          .then(res => res as Array<Record<string, string>>)
          .catch(() => [] as Array<Record<string, string>>),
      ),
    );

    const all: ExchangeOrder[] = perSymbol.flat().map(o => ({
      id:              o['orderId'],
      symbol:          o['symbol'].replace('USDT', ''),
      type:            o['side'] as 'BUY' | 'SELL',
      status:          this.mapOrderStatus(o['status']),
      quantity:        parseFloat(o['origQty']),
      price:           parseFloat(o['price']),
      filled_quantity: parseFloat(o['executedQty']),
      timestamp:       new Date(parseInt(o['time'], 10)),
    }));

    return status ? all.filter(o => o.status === status) : all;
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

  /** No persistent connection to close (stateless HTTP). Clears in-memory order maps. */
  async disconnect(): Promise<void> {
    this.orderSymbolMap.clear();
    this.trackedSymbols.clear();
    logger.info('Binance adapter disconnected', { mode: this.mode });
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
