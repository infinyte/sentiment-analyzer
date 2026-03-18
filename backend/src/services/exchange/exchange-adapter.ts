/**
 * Exchange Adapter abstraction layer.
 *
 * Provides a uniform interface for all exchange integrations so the
 * trading engine can swap between Coinbase, Binance, etc. without
 * changes to any calling code.
 *
 * AccountMode ladder:
 *   PAPER           → fully simulated, no real network calls
 *   PAPER_CONNECTED → sandbox/testnet environment of the real exchange
 *   LIVE_MICRO      → live exchange, hard-capped at $1 per trade
 *   LIVE_FULL       → live exchange, no artificial caps
 */

export type AccountMode = 'PAPER' | 'PAPER_CONNECTED' | 'LIVE_MICRO' | 'LIVE_FULL';

export interface ExchangePrice {
  symbol: string;
  price: number;
  timestamp: Date;
  bid: number;
  ask: number;
  volume24h: number;
}

export interface ExchangeOrder {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  status: 'PENDING' | 'FILLED' | 'FAILED';
  quantity: number;
  price: number;
  filled_quantity?: number;
  timestamp: Date;
}

export interface ExchangePosition {
  symbol: string;
  quantity: number;
  avg_entry: number;
  current_price: number;
  unrealized_pnl: number;
}

export interface ExchangeAccount {
  account_id: string;
  mode: AccountMode;
  balance: number;
  available_balance: number;
  holds: number;
  positions: ExchangePosition[];
  orders: ExchangeOrder[];
}

export abstract class ExchangeAdapter {
  abstract name: string;
  abstract mode: AccountMode;

  abstract authenticate(credentials: Record<string, unknown>): Promise<void>;

  /** Gracefully close any open connections. No-op for stateless HTTP adapters. */
  async disconnect(): Promise<void> { /* no-op by default */ }

  abstract getAccount(): Promise<ExchangeAccount>;

  abstract getPrice(symbol: string): Promise<ExchangePrice>;
  abstract getPrices(symbols: string[]): Promise<ExchangePrice[]>;

  abstract placeOrder(
    symbol: string,
    type: 'BUY' | 'SELL',
    quantity: number,
    price?: number,   // omit for market orders
  ): Promise<ExchangeOrder>;

  abstract cancelOrder(orderId: string): Promise<void>;

  abstract getOrder(orderId: string): Promise<ExchangeOrder>;
  abstract getOrders(status?: string): Promise<ExchangeOrder[]>;

  abstract getPositions(): Promise<ExchangePosition[]>;
  abstract getPosition(symbol: string): Promise<ExchangePosition | null>;

  abstract closePosition(symbol: string): Promise<ExchangeOrder>;
}
