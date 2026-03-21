import { RiskManager } from '../../../services/exchange/risk-manager.js';
import type { ExchangeAccount } from '../../../services/exchange/exchange-adapter.js';

// Minimal account fixture — positions/orders only matter for cap tests.
function makeAccount(balance: number, openPositions = 0): ExchangeAccount {
  return {
    account_id:        'test-account',
    mode:              'PAPER',
    balance,
    available_balance: balance,
    holds:             0,
    positions: Array.from({ length: openPositions }, (_, i) => ({
      symbol:         `COIN${i}-USD`,
      quantity:       1,
      avg_entry:      100,
      current_price:  100,
      unrealized_pnl: 0,
    })),
    orders: [],
  };
}

describe('RiskManager', () => {
  describe('kill switch', () => {
    it('allows orders when enabled (default state)', () => {
      const rm = new RiskManager();
      rm.recordSessionOpen(1000);
      const result = rm.canPlaceOrder(makeAccount(1000), 0.001, 50);
      expect(result.allowed).toBe(true);
    });

    it('blocks orders immediately after disable()', () => {
      const rm = new RiskManager();
      rm.recordSessionOpen(1000);
      rm.disable();
      const result = rm.canPlaceOrder(makeAccount(1000), 0.001, 50);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/kill switch/i);
    });

    it('re-allows orders after enable() re-arm', () => {
      const rm = new RiskManager({ maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      rm.disable();
      rm.enable();
      const result = rm.canPlaceOrder(makeAccount(1000), 1, 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('daily loss threshold', () => {
    it('blocks when balance falls below maxDailyLossPct of session open', () => {
      // 5% default limit; open at 1000, balance now 940 → 6% loss → blocked
      const rm = new RiskManager({ maxDailyLossPct: 5, maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      const result = rm.canPlaceOrder(makeAccount(940), 1, 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/daily loss/i);
    });

    it('allows when loss is exactly at (not exceeding) the threshold boundary', () => {
      // 5% limit; open at 1000, threshold is 950; balance 950 is NOT below threshold
      const rm = new RiskManager({ maxDailyLossPct: 5, maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      const result = rm.canPlaceOrder(makeAccount(950), 1, 100);
      expect(result.allowed).toBe(true);
    });

    it('skips daily-loss check when no session open has been recorded', () => {
      const rm = new RiskManager({ maxDailyLossPct: 5, maxOrderValueUsd: 1000 });
      // No recordSessionOpen call — loss check must be skipped, not throw
      const result = rm.canPlaceOrder(makeAccount(1), 1, 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('per-order notional cap', () => {
    it('blocks when order value exceeds maxOrderValueUsd', () => {
      const rm = new RiskManager({ maxOrderValueUsd: 1 });
      rm.recordSessionOpen(1000);
      // qty=0.1, price=50 → notional=$5 > $1
      const result = rm.canPlaceOrder(makeAccount(1000), 0.1, 50);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/per-order limit/i);
    });

    it('allows when order value is exactly at the cap', () => {
      const rm = new RiskManager({ maxOrderValueUsd: 5 });
      rm.recordSessionOpen(1000);
      // qty=0.1, price=50 → notional=$5 === cap
      const result = rm.canPlaceOrder(makeAccount(1000), 0.1, 50);
      expect(result.allowed).toBe(true);
    });
  });

  describe('open-position cap', () => {
    it('blocks when open positions equal maxOpenPositions', () => {
      const rm = new RiskManager({ maxOpenPositions: 3, maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      const result = rm.canPlaceOrder(makeAccount(1000, 3), 1, 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/open-position cap/i);
    });

    it('allows when open positions are below the cap', () => {
      const rm = new RiskManager({ maxOpenPositions: 3, maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      const result = rm.canPlaceOrder(makeAccount(1000, 2), 1, 100);
      expect(result.allowed).toBe(true);
    });
  });

  describe('check priority', () => {
    it('kill switch is evaluated before daily-loss check', () => {
      // Both kill switch AND loss limit would fire; kill switch must be cited.
      const rm = new RiskManager({ maxDailyLossPct: 5, maxOrderValueUsd: 1000 });
      rm.recordSessionOpen(1000);
      rm.disable();
      const result = rm.canPlaceOrder(makeAccount(900), 1, 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/kill switch/i);
    });
  });

  describe('getStatus', () => {
    it('reflects current enabled state and session balance', () => {
      const rm = new RiskManager({ maxDailyLossPct: 10 });
      rm.recordSessionOpen(5000);
      rm.disable();
      const status = rm.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.sessionOpenBalance).toBe(5000);
      expect(status.config.maxDailyLossPct).toBe(10);
    });
  });
});
