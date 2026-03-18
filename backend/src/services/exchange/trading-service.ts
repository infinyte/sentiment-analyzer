/**
 * TradingService — safety-guarded wrapper around any ExchangeInterface.
 *
 * Safety checks applied before every order:
 *   1. Kill switch     — halts all new BUY orders if cumulative loss exceeds the limit
 *   2. Open positions  — blocks BUY orders when maxOpenPositions is reached
 *   3. Position size   — blocks orders whose notional value exceeds the per-trade cap
 *   4. Minimum order   — blocks orders below $1 notional (Crypto.com minimum)
 */

import type { ExchangeInterface, Order } from './exchange-interface.js';
import logger from '../../logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TradeRequest {
  symbol:     string;
  side:       'BUY' | 'SELL';
  size:       number;
  price?:     number;
  orderType?: 'MARKET' | 'LIMIT';
  reason?:    string;
}

export type TradeRejectReason =
  | 'KILL_SWITCH'
  | 'MAX_POSITIONS'
  | 'POSITION_TOO_LARGE'
  | 'ORDER_TOO_SMALL'
  | 'EXECUTION_ERROR';

export interface TradeResult {
  success: boolean;
  order?:  Order;
  error?:  string;
  reason?: TradeRejectReason | 'EXECUTED';
}

export interface TradingServiceConfig {
  initialCapital:            number;
  maxLossPercentage:         number;   // 0–100
  maxPositionSizePercentage: number;   // 0–100
  maxOpenPositions:          number;
  requireManualApproval:     boolean;
}

// ── TradingService ────────────────────────────────────────────────────────────

export class TradingService {
  private readonly exchange:              ExchangeInterface;
  private readonly initialCapital:        number;
  private readonly maxLossPercentage:     number;
  private readonly maxPositionPercent:    number;
  private readonly maxOpenPositions:      number;
  private readonly requireManualApproval: boolean;

  private currentCapital: number;
  private readonly history: TradeResult[] = [];

  constructor(exchange: ExchangeInterface, config: TradingServiceConfig) {
    this.exchange             = exchange;
    this.initialCapital       = config.initialCapital;
    this.maxLossPercentage    = config.maxLossPercentage;
    this.maxPositionPercent   = config.maxPositionSizePercentage;
    this.maxOpenPositions     = config.maxOpenPositions;
    this.requireManualApproval = config.requireManualApproval;
    this.currentCapital       = config.initialCapital;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async executeOrder(request: TradeRequest): Promise<TradeResult> {
    logger.info('TradingService executeOrder', {
      symbol: request.symbol, side: request.side, size: request.size,
    });

    // ── Guard 1: Kill switch ─────────────────────────────────────────────
    const maxAllowedLoss = this.initialCapital * (this.maxLossPercentage / 100);
    const currentLoss    = this.initialCapital - this.currentCapital;
    if (request.side === 'BUY' && currentLoss > maxAllowedLoss) {
      return this.reject(
        'KILL_SWITCH',
        `Kill switch: lost $${currentLoss.toFixed(2)} of allowed $${maxAllowedLoss.toFixed(2)}`,
      );
    }

    // ── Guard 2: Open positions ───────────────────────────────────────────
    if (request.side === 'BUY') {
      try {
        const open = await this.exchange.getOpenOrders();
        if (open.length >= this.maxOpenPositions) {
          return this.reject(
            'MAX_POSITIONS',
            `Max open positions reached (${this.maxOpenPositions})`,
          );
        }
      } catch {
        logger.warn('TradingService could not check open positions');
      }
    }

    // ── Guard 3 + 4: Notional checks ─────────────────────────────────────
    let currentPrice: number;
    try {
      currentPrice = await this.exchange.getCurrentPrice(request.symbol);
    } catch {
      currentPrice = request.price ?? 0;
    }

    const notional        = request.size * (request.price ?? currentPrice);
    const maxPositionValue = this.currentCapital * (this.maxPositionPercent / 100);

    if (notional < 1.0) {
      return this.reject('ORDER_TOO_SMALL', `Order too small: $${notional.toFixed(4)} (min $1.00)`);
    }
    if (request.side === 'BUY' && notional > maxPositionValue) {
      return this.reject(
        'POSITION_TOO_LARGE',
        `Position too large: $${notional.toFixed(2)} (max $${maxPositionValue.toFixed(2)})`,
      );
    }

    // ── Manual approval (logged; auto-approved unless wired to UI) ────────
    if (this.requireManualApproval) {
      logger.info('TradingService manual approval required (auto-approved)', { request });
    }

    // ── Execute ───────────────────────────────────────────────────────────
    try {
      const order = await this.exchange.placeOrder({
        symbol:    request.symbol,
        side:      request.side,
        size:      request.size,
        price:     request.price ?? currentPrice,
        orderType: request.orderType ?? 'LIMIT',
      });

      logger.info('TradingService order placed', { orderId: order.id, status: order.status });
      const result: TradeResult = { success: true, order, reason: 'EXECUTED' };
      this.history.push(result);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('TradingService order execution failed', { error: msg });
      const result: TradeResult = { success: false, error: msg, reason: 'EXECUTION_ERROR' };
      this.history.push(result);
      return result;
    }
  }

  /**
   * Refresh `currentCapital` from the exchange USDT balance.
   * Returns the updated value.
   */
  async updateCapital(): Promise<number> {
    try {
      const balances = await this.exchange.getAllBalances();
      const usdt     = balances.find(b => b.symbol === 'USDT');
      if (usdt) this.currentCapital = usdt.total;
    } catch {
      logger.warn('TradingService could not update capital from exchange');
    }
    return this.currentCapital;
  }

  getStats(): {
    initialCapital:   number;
    currentCapital:   number;
    pnl:              number;
    pnlPercent:       number;
    totalTrades:      number;
    successfulTrades: number;
    maxLoss:          number;
    maxPosition:      number;
  } {
    const pnl        = this.currentCapital - this.initialCapital;
    const successful = this.history.filter(t => t.success).length;
    return {
      initialCapital:   this.initialCapital,
      currentCapital:   this.currentCapital,
      pnl,
      pnlPercent:       (pnl / this.initialCapital) * 100,
      totalTrades:      this.history.length,
      successfulTrades: successful,
      maxLoss:          this.initialCapital * (this.maxLossPercentage / 100),
      maxPosition:      this.currentCapital * (this.maxPositionPercent  / 100),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private reject(reason: TradeRejectReason, error: string): TradeResult {
    logger.warn('TradingService order rejected', { reason, error });
    const result: TradeResult = { success: false, error, reason };
    this.history.push(result);
    return result;
  }
}
