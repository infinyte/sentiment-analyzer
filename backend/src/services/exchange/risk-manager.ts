/**
 * RiskManager — exchange-level safety gate for the ExchangeAdapter layer.
 *
 * Responsibilities:
 *   - Kill switch: instantly disables all new orders
 *   - Daily loss limit: blocks orders once the account has lost more than
 *     `maxDailyLossPct` of the balance recorded at session open
 *   - Per-trade size cap: hard $ limit on the notional value of any single order
 *   - Open-position cap: prevents opening more positions than `maxOpenPositions`
 *
 * This class is intentionally separate from the MARL-layer RiskGuard
 * (services/risk/risk-guard.ts).  RiskGuard operates on simulated portfolio
 * state using percentage-based drawdown rules; RiskManager operates on real
 * ExchangeAccount data using absolute dollar limits appropriate for micro/live
 * trading.
 */

import type { ExchangeAccount } from './exchange-adapter.js';
import logger from '../../logger.js';

export interface RiskManagerConfig {
  /** Maximum daily loss as a percentage of the session-open balance (default 5%). */
  maxDailyLossPct: number;
  /** Hard cap on the notional value (qty × price) of a single order in USD (default $1). */
  maxOrderValueUsd: number;
  /** Maximum number of concurrent open positions (default 3). */
  maxOpenPositions: number;
}

export interface OrderCheckResult {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_CONFIG: RiskManagerConfig = {
  maxDailyLossPct:  5,
  maxOrderValueUsd: 1,
  maxOpenPositions: 3,
};

export class RiskManager {
  private readonly config: RiskManagerConfig;
  private enabled = true;
  private sessionOpenBalance: number | null = null;

  constructor(config: Partial<RiskManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Session tracking ────────────────────────────────────────────────────────

  /**
   * Record the account balance at the start of a trading session.
   * Must be called once before the first `canPlaceOrder` check so that the
   * daily-loss comparison has a baseline.
   */
  recordSessionOpen(balance: number): void {
    this.sessionOpenBalance = balance;
    logger.info('risk-manager: session open recorded', { balance });
  }

  // ── Kill switch ──────────────────────────────────────────────────────────────

  disable(): void {
    this.enabled = false;
    logger.warn('risk-manager: trading DISABLED (kill switch)');
  }

  enable(): void {
    this.enabled = true;
    logger.info('risk-manager: trading ENABLED');
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // ── Pre-trade check ──────────────────────────────────────────────────────────

  /**
   * Returns `{ allowed: true }` if the order passes all safety checks,
   * or `{ allowed: false, reason }` explaining which rule blocked it.
   */
  canPlaceOrder(
    account: ExchangeAccount,
    orderQuantity: number,
    orderPrice: number,
  ): OrderCheckResult {
    // 1. Kill switch
    if (!this.enabled) {
      return { allowed: false, reason: 'Trading is currently disabled (kill switch active)' };
    }

    // 2. Daily loss limit
    if (this.sessionOpenBalance !== null && this.sessionOpenBalance > 0) {
      const lossThreshold = this.sessionOpenBalance * (1 - this.config.maxDailyLossPct / 100);
      if (account.balance < lossThreshold) {
        const lossPct = ((this.sessionOpenBalance - account.balance) / this.sessionOpenBalance * 100).toFixed(2);
        logger.warn('risk-manager: daily loss limit reached', {
          sessionOpen:    this.sessionOpenBalance,
          current:        account.balance,
          lossPct,
          limitPct:       this.config.maxDailyLossPct,
        });
        return {
          allowed: false,
          reason:  `Daily loss limit reached (${lossPct}% loss vs ${this.config.maxDailyLossPct}% limit)`,
        };
      }
    }

    // 3. Per-order notional cap
    const orderValue = orderQuantity * orderPrice;
    if (orderValue > this.config.maxOrderValueUsd) {
      return {
        allowed: false,
        reason:  `Order value $${orderValue.toFixed(4)} exceeds the $${this.config.maxOrderValueUsd} per-order limit`,
      };
    }

    // 4. Open-position cap
    const openPositions = account.positions.filter(p => p.quantity > 0).length;
    if (openPositions >= this.config.maxOpenPositions) {
      return {
        allowed: false,
        reason:  `Open-position cap reached (${openPositions}/${this.config.maxOpenPositions})`,
      };
    }

    return { allowed: true };
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  getConfig(): Readonly<RiskManagerConfig> {
    return { ...this.config };
  }

  getStatus(): {
    enabled: boolean;
    sessionOpenBalance: number | null;
    config: RiskManagerConfig;
  } {
    return {
      enabled:            this.enabled,
      sessionOpenBalance: this.sessionOpenBalance,
      config:             this.getConfig(),
    };
  }
}
