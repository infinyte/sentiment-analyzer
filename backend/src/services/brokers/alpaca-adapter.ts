/**
 * Alpaca Broker Adapter
 *
 * Supports both paper (paper-api.alpaca.markets) and live (api.alpaca.markets) modes.
 * Uses REST polling for order status — no WebSocket dependency required.
 *
 * Symbol mapping: internal "BTC" → Alpaca crypto "BTC/USD"
 * All limit prices are skewed slightly toward the market to maximize paper-fill speed.
 */

import { randomUUID } from 'node:crypto';
import { BaseBrokerAdapter } from './base-broker-adapter.js';
import type {
  BrokerProvider,
  ExchangeMode,
  BrokerAccount,
  BrokerPosition,
  BrokerOrder,
  OrderStatus,
  PlaceOrderRequest,
} from '../../types/broker.js';
import logger from '../../logger.js';

// ─── Symbol map (internal → Alpaca format) ────────────────────────────────────

const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  BTC:  'BTC/USD',
  ETH:  'ETH/USD',
  SOL:  'SOL/USD',
  ADA:  'ADA/USD',
  DOGE: 'DOGE/USD',
  DOT:  'DOT/USD',
  MATIC:'MATIC/USD',
  LINK: 'LINK/USD',
  AVAX: 'AVAX/USD',
  UNI:  'UNI/USD',
  LTC:  'LTC/USD',
  XRP:  'XRP/USD',
  BCH:  'BCH/USD',
  ATOM: 'ATOM/USD',
  XLM:  'XLM/USD',
  ALGO: 'ALGO/USD',
  NEAR: 'NEAR/USD',
  FIL:  'FIL/USD',
  SHIB: 'SHIB/USD',
};

function toAlpacaSymbol(symbol: string): string | undefined {
  return CRYPTO_SYMBOL_MAP[symbol.toUpperCase()];
}

function fromAlpacaSymbol(alpacaSymbol: string): string {
  // "BTC/USD" → "BTC"
  return alpacaSymbol.split('/')[0] ?? alpacaSymbol;
}

// ─── Alpaca REST response shapes (minimal — only fields we use) ───────────────

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  symbol: string;
}

interface AlpacaAccount {
  cash: string;
  portfolio_value: string;
  buying_power: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  market_value: string;
}

interface AlpacaAsset {
  symbol: string;
  tradable: boolean;
  status: string;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class AlpacaAdapter extends BaseBrokerAdapter {
  readonly provider: BrokerProvider = 'ALPACA';
  readonly mode: ExchangeMode;
  readonly credentialId: string;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  // Tracks clientOrderId → Alpaca orderId for cancellation
  private readonly orderIdMap = new Map<string, string>();

  constructor(opts: {
    credentialId: string;
    mode: ExchangeMode;
    apiKey: string;
    apiSecret: string;
  }) {
    super(200); // Alpaca: 200 requests/min
    this.credentialId = opts.credentialId;
    this.mode = opts.mode;

    const isPaper = opts.mode === 'PAPER';
    this.baseUrl = isPaper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets';

    this.headers = {
      'APCA-API-KEY-ID':     opts.apiKey,
      'APCA-API-SECRET-KEY': opts.apiSecret,
      'Content-Type':        'application/json',
      'Accept':              'application/json',
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    // Verify credentials by fetching account — throws on auth failure
    await this.safeApiCall('alpaca.connect', () => this.fetchAccount());
    logger.info('alpaca adapter connected', {
      credentialId: this.credentialId,
      mode: this.mode,
    });
  }

  async disconnect(): Promise<void> {
    this.orderIdMap.clear();
    logger.info('alpaca adapter disconnected', { credentialId: this.credentialId });
  }

  // ── Symbol validation ──────────────────────────────────────────────────────

  async validateSymbols(symbols: string[]): Promise<string[]> {
    const valid: string[] = [];
    for (const sym of symbols) {
      const alpacaSym = toAlpacaSymbol(sym);
      if (!alpacaSym) {
        logger.warn('alpaca: symbol not in mapping', { symbol: sym });
        continue;
      }
      try {
        const asset = await this.safeApiCall<AlpacaAsset>(
          `alpaca.asset.${sym}`,
          () => this.get<AlpacaAsset>(`/v2/assets/${encodeURIComponent(alpacaSym)}`),
        );
        if (asset.tradable && asset.status === 'active') {
          valid.push(sym);
        } else {
          logger.warn('alpaca: symbol not tradable', { symbol: sym, status: asset.status });
        }
      } catch {
        logger.warn('alpaca: symbol validation failed', { symbol: sym });
      }
    }
    return valid;
  }

  // ── Account ────────────────────────────────────────────────────────────────

  async getAccount(): Promise<BrokerAccount> {
    const [acct, positions] = await Promise.all([
      this.safeApiCall('alpaca.account', () => this.fetchAccount()),
      this.safeApiCall('alpaca.positions', () => this.fetchPositions()),
    ]);
    return {
      cash:        parseFloat(acct.cash),
      equity:      parseFloat(acct.portfolio_value),
      buyingPower: parseFloat(acct.buying_power),
      positions,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    return this.safeApiCall('alpaca.positions', () => this.fetchPositions());
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder> {
    const alpacaSym = toAlpacaSymbol(req.symbol);
    if (!alpacaSym) throw new Error(`[alpaca] unmapped symbol: ${req.symbol}`);

    // Skew limit price slightly toward market for faster paper fills:
    //   BUY  → pay up to 0.5% above limit (crosses the ask)
    //   SELL → accept 0.5% below limit (crosses the bid)
    const slipFactor = req.side === 'BUY' ? 1.005 : 0.995;
    const limitPrice = req.limitPrice
      ? parseFloat((req.limitPrice * slipFactor).toFixed(8))
      : undefined;

    const body = {
      symbol:          alpacaSym,
      qty:             req.quantity.toString(),
      side:            req.side === 'BUY' ? 'buy' : 'sell',
      type:            limitPrice ? 'limit' : 'market',
      time_in_force:   'gtc',
      limit_price:     limitPrice?.toString(),
      client_order_id: req.clientOrderId,
    };

    const raw = await this.safeApiCall<AlpacaOrder>(
      'alpaca.placeOrder',
      () => this.post<AlpacaOrder>('/v2/orders', body),
    );

    this.orderIdMap.set(req.clientOrderId, raw.id);

    const order: BrokerOrder = {
      id:             randomUUID(),
      competitionId:  req.competitionId,
      agentId:        req.agentId,
      clientOrderId:  req.clientOrderId,
      brokerOrderId:  raw.id,
      credentialId:   req.credentialId,
      provider:       'ALPACA',
      mode:           this.mode,
      symbol:         req.symbol,
      side:           req.side,
      quantity:       req.quantity,
      limitPrice,
      status:         mapAlpacaStatus(raw.status),
      filledQuantity: parseFloat(raw.filled_qty),
      avgFillPrice:   raw.filled_avg_price ? parseFloat(raw.filled_avg_price) : 0,
      submittedAt:    new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      brokerResponse: this.sanitize(raw),
    };

    logger.debug('alpaca order placed', {
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      qty: order.quantity,
    });

    return order;
  }

  async pollOrderStatus(
    clientOrderId: string,
  ): Promise<Pick<BrokerOrder, 'status' | 'filledQuantity' | 'avgFillPrice' | 'brokerOrderId'>> {
    const raw = await this.safeApiCall<AlpacaOrder>(
      'alpaca.getOrderByClientId',
      () => this.get<AlpacaOrder>(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`),
    );

    return {
      brokerOrderId:  raw.id,
      status:         mapAlpacaStatus(raw.status),
      filledQuantity: parseFloat(raw.filled_qty),
      avgFillPrice:   raw.filled_avg_price ? parseFloat(raw.filled_avg_price) : 0,
    };
  }

  async cancelOrder(clientOrderId: string): Promise<boolean> {
    const brokerOrderId = this.orderIdMap.get(clientOrderId);
    if (!brokerOrderId) return false;

    try {
      await this.safeApiCall(
        'alpaca.cancelOrder',
        () => this.delete(`/v2/orders/${brokerOrderId}`),
        1, // no retry for cancel
      );
      this.orderIdMap.delete(clientOrderId);
      return true;
    } catch {
      return false;
    }
  }

  async cancelAllOrders(competitionId: string): Promise<number> {
    // Alpaca: DELETE /v2/orders cancels all open orders
    try {
      const cancelled = await this.safeApiCall<AlpacaOrder[]>(
        'alpaca.cancelAll',
        () => this.delete<AlpacaOrder[]>('/v2/orders'),
        1,
      );
      const count = Array.isArray(cancelled) ? cancelled.length : 0;
      logger.info('alpaca all orders cancelled', { competitionId, count });
      return count;
    } catch (err) {
      logger.warn('alpaca cancel-all failed', { competitionId, error: String(err) });
      return 0;
    }
  }

  // ── Private HTTP helpers ───────────────────────────────────────────────────

  private async fetchAccount(): Promise<AlpacaAccount> {
    return this.get<AlpacaAccount>('/v2/account');
  }

  private async fetchPositions(): Promise<BrokerPosition[]> {
    const raw = await this.get<AlpacaPosition[]>('/v2/positions');
    return raw.map(p => ({
      symbol:        fromAlpacaSymbol(p.symbol),
      quantity:      parseFloat(p.qty),
      avgEntryPrice: parseFloat(p.avg_entry_price),
      marketValue:   parseFloat(p.market_value),
    }));
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[alpaca] GET ${path} → ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[alpaca] POST ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async delete<T = void>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    if (!res.ok && res.status !== 207) {
      const text = await res.text();
      throw new Error(`[alpaca] DELETE ${path} → ${res.status}: ${text}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

// ─── Status mapping ────────────────────────────────────────────────────────────

function mapAlpacaStatus(alpacaStatus: string): OrderStatus {
  switch (alpacaStatus) {
    case 'new':
    case 'accepted':
    case 'pending_new':       return 'SUBMITTED';
    case 'partially_filled':  return 'PARTIALLY_FILLED';
    case 'filled':            return 'FILLED';
    case 'canceled':
    case 'expired':
    case 'replaced':          return 'CANCELLED';
    case 'rejected':
    case 'suspended':         return 'REJECTED';
    default:                  return 'PENDING';
  }
}
