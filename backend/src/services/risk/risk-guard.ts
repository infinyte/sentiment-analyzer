/**
 * RiskGuard — pre-trade circuit breaker for real/paper competitions.
 *
 * All checks are synchronous and stateless except for the per-agent equity log
 * used for the daily drawdown calculation.
 *
 * NOT instantiated for SIMULATED mode — zero overhead on the existing path.
 */

import type { RiskConfig } from '../../types/broker.js';
import logger from '../../logger.js';

export type { RiskConfig };

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  adjustedQuantity?: number;  // may reduce qty rather than reject outright
}

interface AgentRiskState {
  dayOpenEquity: number;
  stepOpenEquity: number;
}

export class RiskGuard {
  private readonly config: RiskConfig;
  private readonly agentState = new Map<string, AgentRiskState>();

  constructor(config: RiskConfig) {
    this.config = config;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Called once per agent at competition start to seed the day-open equity. */
  initAgent(agentId: string, initialEquity: number): void {
    this.agentState.set(agentId, {
      dayOpenEquity:  initialEquity,
      stepOpenEquity: initialEquity,
    });
  }

  /** Called at the start of each step to snapshot the equity for step-loss tracking. */
  recordStepOpen(agentId: string, equity: number): void {
    const state = this.agentState.get(agentId);
    if (state) state.stepOpenEquity = equity;
  }

  /**
   * Pre-trade check. Returns { approved: false, reason } to block the order,
   * or { approved: true, adjustedQuantity } (may reduce qty to fit position limit).
   */
  checkOrder(opts: {
    agentId:      string;
    symbol:       string;
    side:         'BUY' | 'SELL';
    quantity:     number;
    price:        number;
    cash:         number;
    portfolioValue: number;  // value of all positions (not including cash)
  }): RiskCheckResult {
    const { agentId, symbol, side, quantity, price, cash, portfolioValue } = opts;
    const equity = cash + portfolioValue;

    // 1. Symbol whitelist
    if (this.config.allowedSymbols.length > 0 &&
        !this.config.allowedSymbols.includes(symbol.toUpperCase())) {
      return { approved: false, reason: `symbol ${symbol} not in allowedSymbols whitelist` };
    }

    // 2. Capital isolation — agent cannot spend more than its own cash
    if (this.config.capitalIsolation && side === 'BUY') {
      const cost = quantity * price;
      if (cost > cash) {
        const maxQty = Math.floor(cash / price);
        if (maxQty <= 0) {
          return { approved: false, reason: 'insufficient cash (capital isolation)' };
        }
        logger.debug('risk: quantity reduced by capital isolation', { agentId, symbol, from: quantity, to: maxQty });
        return { approved: true, adjustedQuantity: maxQty };
      }
    }

    // 3. Max position size per symbol
    if (side === 'BUY' && equity > 0) {
      const newPositionValue = quantity * price;
      const positionPct = newPositionValue / equity;
      if (positionPct > this.config.maxPositionPct) {
        const maxQty = Math.floor((this.config.maxPositionPct * equity) / price);
        if (maxQty <= 0) {
          return { approved: false, reason: `position would exceed maxPositionPct (${(this.config.maxPositionPct * 100).toFixed(0)}%)` };
        }
        return { approved: true, adjustedQuantity: maxQty };
      }
    }

    // 4. Step-loss circuit breaker
    const state = this.agentState.get(agentId);
    if (state && state.stepOpenEquity > 0) {
      const stepLoss = (equity - state.stepOpenEquity) / state.stepOpenEquity;
      if (stepLoss < -this.config.maxLossPerStepPct) {
        return {
          approved: false,
          reason: `step loss ${(stepLoss * 100).toFixed(2)}% exceeds maxLossPerStepPct (${(this.config.maxLossPerStepPct * 100).toFixed(0)}%)`,
        };
      }
    }

    return { approved: true };
  }

  /**
   * Daily drawdown emergency check.
   * Returns true if the competition should be halted for this agent.
   */
  checkDailyDrawdown(agentId: string, currentEquity: number): boolean {
    const state = this.agentState.get(agentId);
    if (!state || state.dayOpenEquity <= 0) return false;
    const drawdown = (currentEquity - state.dayOpenEquity) / state.dayOpenEquity;
    if (drawdown < -this.config.maxDailyDrawdownPct) {
      logger.warn('risk: daily drawdown limit hit — emergency stop', {
        agentId,
        drawdownPct: (drawdown * 100).toFixed(2),
        limitPct: (this.config.maxDailyDrawdownPct * 100).toFixed(0),
      });
      return true;
    }
    return false;
  }
}
