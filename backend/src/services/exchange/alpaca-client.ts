/**
 * AlpacaClient — REST client for Alpaca Trading + Crypto Data APIs.
 *
 * Trading API:
 *   Paper: https://paper-api.alpaca.markets/v2
 *   Live:  https://api.alpaca.markets
 *
 * Data API:
 *   https://data.alpaca.markets
 */

import axios, { type AxiosInstance } from 'axios';
import logger from '../../logger.js';

export interface AlpacaClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  dataBaseUrl: string;
  paper?: boolean;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  qty: string;
  limit_price: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
}

interface AlpacaAccount {
  cash: string;
  buying_power: string;
  portfolio_value: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
}

export class AlpacaClient {
  private readonly baseUrl: string;
  private readonly paper: boolean;
  private readonly tradingClient: AxiosInstance;
  private readonly dataClient: AxiosInstance;

  constructor(config: AlpacaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.paper = config.paper ?? false;

    const headers = {
      'APCA-API-KEY-ID': config.apiKey,
      'APCA-API-SECRET-KEY': config.apiSecret,
    };

    this.tradingClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10_000,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    this.dataClient = axios.create({
      baseURL: config.dataBaseUrl.replace(/\/$/, ''),
      timeout: 10_000,
      headers,
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.getAccount();
      return true;
    } catch {
      return false;
    }
  }

  async getAccount(): Promise<AlpacaAccount> {
    return this.tradingGet<AlpacaAccount>('/v2/account');
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    return this.tradingGet<AlpacaPosition[]>('/v2/positions');
  }

  async getLatestTradePrice(symbol: string): Promise<number> {
    const payload = await this.dataGet<{ trades: Record<string, { p: number | string }> }>(
      '/v1beta3/crypto/us/latest/trades',
      { symbols: symbol },
    );

    const trade = payload.trades?.[symbol];
    if (!trade) {
      throw new Error(`[alpaca-client] no latest trade found for symbol: ${symbol}`);
    }

    const price = typeof trade.p === 'string' ? parseFloat(trade.p) : trade.p;
    if (!Number.isFinite(price)) {
      throw new Error(`[alpaca-client] invalid latest trade price for symbol: ${symbol}`);
    }

    return price;
  }

  async createOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    qty: string;
    type: 'market' | 'limit';
    time_in_force?: 'gtc' | 'ioc' | 'fok' | 'day';
    limit_price?: string;
    client_order_id?: string;
  }): Promise<AlpacaOrder> {
    return this.tradingPost<AlpacaOrder>('/v2/orders', {
      time_in_force: 'gtc',
      ...params,
    });
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.tradingDelete(`/v2/orders/${orderId}`);
      return true;
    } catch {
      return false;
    }
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    return this.tradingGet<AlpacaOrder>(`/v2/orders/${orderId}`);
  }

  async getOpenOrders(symbol?: string): Promise<AlpacaOrder[]> {
    const params: Record<string, string> = { status: 'open' };
    if (symbol) params['symbols'] = symbol;
    return this.tradingGet<AlpacaOrder[]>('/v2/orders', params);
  }

  async getOrderHistory(limit = 100): Promise<AlpacaOrder[]> {
    return this.tradingGet<AlpacaOrder[]>('/v2/orders', {
      status: 'all',
      direction: 'desc',
      limit: String(Math.min(Math.max(limit, 1), 500)),
    });
  }

  async getBalance(currency: string): Promise<{ available: number; held: number; total: number }> {
    if (currency === 'USDT' || currency === 'USD') {
      const account = await this.getAccount();
      const available = parseFloat(account.cash);
      return {
        available,
        held: 0,
        total: available,
      };
    }

    const positions = await this.getPositions();
    const p = positions.find(x => this.fromAlpacaSymbol(x.symbol) === currency.toUpperCase());
    if (!p) {
      return { available: 0, held: 0, total: 0 };
    }

    const qty = parseFloat(p.qty);
    return { available: qty, held: 0, total: qty };
  }

  async getAllBalances(): Promise<Array<{ currency: string; available: number; held: number; total: number }>> {
    const [account, positions] = await Promise.all([
      this.getAccount(),
      this.getPositions(),
    ]);

    const balances: Array<{ currency: string; available: number; held: number; total: number }> = [];
    const usd = parseFloat(account.cash);
    balances.push({ currency: 'USDT', available: usd, held: 0, total: usd });

    for (const p of positions) {
      const qty = parseFloat(p.qty);
      if (qty <= 0) continue;
      balances.push({
        currency: this.fromAlpacaSymbol(p.symbol),
        available: qty,
        held: 0,
        total: qty,
      });
    }

    return balances;
  }

  private fromAlpacaSymbol(symbol: string): string {
    return symbol.split('/')[0]?.toUpperCase() ?? symbol.toUpperCase();
  }

  private async tradingGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    try {
      const resp = await this.tradingClient.get<T>(path, { params });
      return resp.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown; status?: number }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Alpaca trading GET failed', { path, status: err.response?.status, msg });
      throw new Error(`Alpaca GET ${path}: ${msg}`);
    }
  }

  private async dataGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    try {
      const resp = await this.dataClient.get<T>(path, { params });
      return resp.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown; status?: number }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Alpaca data GET failed', { path, status: err.response?.status, msg });
      throw new Error(`Alpaca data GET ${path}: ${msg}`);
    }
  }

  private async tradingPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    try {
      const resp = await this.tradingClient.post<T>(path, body);
      return resp.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown; status?: number }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Alpaca trading POST failed', { path, status: err.response?.status, msg });
      throw new Error(`Alpaca POST ${path}: ${msg}`);
    }
  }

  private async tradingDelete(path: string): Promise<void> {
    try {
      await this.tradingClient.delete(path);
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown; status?: number }; message?: string };
      const msg = JSON.stringify(err.response?.data) ?? err.message ?? String(error);
      logger.error('Alpaca trading DELETE failed', { path, status: err.response?.status, msg });
      throw new Error(`Alpaca DELETE ${path}: ${msg}`);
    }
  }

  getModeLabel(): string {
    return this.paper ? 'Paper' : 'Live';
  }
}
