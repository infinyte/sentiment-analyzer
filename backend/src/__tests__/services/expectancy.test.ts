import {
  reconstructTrades,
  reconstructClosedTrades,
  buildExpectancyReport,
  computeExpectancyReport,
  type ExpectancyReport,
} from '../../services/analytics/expectancy.js';
import type {
  ExchangeInterface,
  Order,
  Balance,
  PlaceOrderParams,
} from '../../services/exchange/exchange-interface.js';
import logger from '../../logger.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0);
let seq = 0;

/** Build a FILLED Order with a monotonically increasing timestamp (insertion order). */
function makeOrder(
  type: 'BUY' | 'SELL',
  quantity: number,
  price: number,
  commission = 0,
  symbol = 'BTC',
): Order {
  seq += 1;
  return {
    id:        `o${seq}`,
    symbol,
    type,
    quantity,
    price,
    status:    'FILLED',
    timestamp: new Date(BASE_TS + seq * 1000),
    commission,
  };
}

beforeEach(() => {
  seq = 0;
});

/** Minimal in-memory ExchangeInterface returning a fixed order history + price map. */
class MockExchange implements ExchangeInterface {
  readonly feePreset = 'binance-us';

  constructor(
    private readonly orders: Order[],
    private readonly prices: Record<string, number> = {},
  ) {}

  async getExchangeName(): Promise<string> { return 'Mock'; }
  async isConnected(): Promise<boolean> { return true; }
  async getBalance(symbol: string): Promise<Balance> {
    return { symbol, available: 0, held: 0, total: 0 };
  }
  async getAllBalances(): Promise<Balance[]> { return []; }
  async getCurrentPrice(symbol: string): Promise<number> { return this.prices[symbol] ?? 0; }
  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const s of symbols) if (this.prices[s] !== undefined) m.set(s, this.prices[s]!);
    return m;
  }
  async placeOrder(_p: PlaceOrderParams): Promise<Order> { throw new Error('not implemented'); }
  async cancelOrder(_id: string): Promise<boolean> { return false; }
  async getOpenOrders(): Promise<Order[]> { return []; }
  async getOrderStatus(_id: string): Promise<Order> { throw new Error('not implemented'); }
  async getOrderHistory(limit = 500): Promise<Order[]> {
    return this.orders.slice(-Math.min(limit, this.orders.length));
  }
}

// ── 1. Single round trip ────────────────────────────────────────────────────

describe('expectancy — single round trip', () => {
  it('produces one closed trade with correct gross/net/returnPct', () => {
    const orders = [
      makeOrder('BUY', 1, 100, 0.10),
      makeOrder('SELL', 1, 110, 0.11),
    ];

    const { closedTrades, openLots } = reconstructTrades(orders);

    expect(closedTrades).toHaveLength(1);
    const t = closedTrades[0]!;
    expect(t.grossPnl).toBeCloseTo(10, 10);
    expect(t.netPnl).toBeCloseTo(10 - 0.10 - 0.11, 10);
    expect(t.returnPct).toBeCloseTo((10 - 0.21) / 100, 10);
    expect(t.entryCommission).toBeCloseTo(0.10, 10);
    expect(t.exitCommission).toBeCloseTo(0.11, 10);
    expect(openLots.size).toBe(0);
  });
});

// ── 2. Partial close ─────────────────────────────────────────────────────────

describe('expectancy — partial close', () => {
  it('allocates half the BUY commission and leaves one open position', () => {
    const orders = [
      makeOrder('BUY', 2, 100, 0.20),   // 0.10 commission per unit
      makeOrder('SELL', 1, 110, 0.11),
    ];

    const { closedTrades, openLots } = reconstructTrades(orders);

    expect(closedTrades).toHaveLength(1);
    const t = closedTrades[0]!;
    expect(t.quantity).toBe(1);
    expect(t.entryCommission).toBeCloseTo(0.10, 10);  // half of the 0.20 BUY commission
    expect(t.netPnl).toBeCloseTo(10 - 0.10 - 0.11, 10);

    const positions = openLots.get('BTC')!;
    expect(positions).toHaveLength(1);
    expect(positions[0]!.qtyRemaining).toBe(1);
    // costBasis for the open unit = price + per-unit commission = 100 + 0.10
    expect(positions[0]!.price).toBe(100);
    expect(positions[0]!.commissionPerUnit).toBeCloseTo(0.10, 10);
  });
});

// ── 3. FIFO ordering ───────────────────────────────────────────────────────

describe('expectancy — FIFO ordering', () => {
  it('closes the oldest lot first', () => {
    const orders = [
      makeOrder('BUY', 1, 100),
      makeOrder('BUY', 1, 120),
      makeOrder('SELL', 1, 130),
    ];

    const { closedTrades, openLots } = reconstructTrades(orders);

    expect(closedTrades).toHaveLength(1);
    expect(closedTrades[0]!.entryPrice).toBe(100);          // @100 lot closed first
    expect(closedTrades[0]!.grossPnl).toBeCloseTo(30, 10);

    const remaining = openLots.get('BTC')!;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.price).toBe(120);                  // @120 lot still open
  });
});

// ── 4. Multiple SELLs drain one BUY ──────────────────────────────────────────

describe('expectancy — multiple SELLs drain one BUY', () => {
  it('emits two closed trades with correct signs', () => {
    const orders = [
      makeOrder('BUY', 3, 100),
      makeOrder('SELL', 1, 110),
      makeOrder('SELL', 2, 90),
    ];

    const { closedTrades, openLots } = reconstructTrades(orders);

    expect(closedTrades).toHaveLength(2);
    expect(closedTrades[0]!.quantity).toBe(1);
    expect(closedTrades[0]!.grossPnl).toBeCloseTo(10, 10);   // (110-100)*1 win
    expect(closedTrades[1]!.quantity).toBe(2);
    expect(closedTrades[1]!.grossPnl).toBeCloseTo(-20, 10);  // (90-100)*2 loss
    expect(openLots.size).toBe(0);
  });
});

// ── 5. Fee drag proof ──────────────────────────────────────────────────────

describe('expectancy — fee drag', () => {
  it('expectancy is strictly lower with fees and the delta equals total commission', () => {
    // Two fully-closed round trips: +10 gross then -10 gross (net gross = 0).
    const layout: Array<['BUY' | 'SELL', number, number]> = [
      ['BUY', 1, 100],
      ['SELL', 1, 110],
      ['BUY', 1, 100],
      ['SELL', 1, 90],
    ];

    const zeroFee = layout.map(([t, q, p]) => makeOrder(t, q, p, 0));
    seq = 0;
    const TAKER = 0.012; // coinbase taker
    const withFee = layout.map(([t, q, p]) => makeOrder(t, q, p, p * q * TAKER));

    const reportZero = build(zeroFee, 10_000);
    const reportFee  = build(withFee, 10_000);

    expect(reportFee.expectancyPerTrade).toBeLessThan(reportZero.expectancyPerTrade);

    // (expectancyZero - expectancyFee) * tradeCount === total commission paid
    const delta = (reportZero.expectancyPerTrade - reportFee.expectancyPerTrade) * reportFee.closedTradeCount;
    expect(delta).toBeCloseTo(reportFee.totalCommissionPaid, 8);

    // Net-of-fees invariant.
    expect(reportFee.totalNetPnl).toBeCloseTo(reportFee.totalGrossPnl - reportFee.totalCommissionPaid, 8);
  });
});

// ── 6. Zero trades ───────────────────────────────────────────────────────────

describe('expectancy — zero trades', () => {
  it('returns an all-zero report with no NaN or Infinity', () => {
    const report = buildExpectancyReport({
      closedTrades:     [],
      openPositions:    [],
      turnoverNotional: 0,
      feePreset:        'binance-us',
      initialCapital:   10_000,
      generatedAt:      new Date(BASE_TS),
    });

    const numericFields: Array<keyof ExpectancyReport> = [
      'closedTradeCount', 'winCount', 'lossCount', 'winRate', 'avgWin', 'avgLoss',
      'expectancyPerTrade', 'expectancyR', 'profitFactor', 'totalNetPnl', 'totalGrossPnl',
      'totalCommissionPaid', 'feeDragPct', 'avgHoldingPeriodMs', 'turnoverNotional',
      'maxDrawdownPct', 'sharpe', 'sortino',
    ];
    for (const field of numericFields) {
      const value = report[field] as number;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(0);
    }
    expect(report.unrealized.totalUnrealizedPnl).toBe(0);
    expect(report.unrealized.positions).toEqual([]);
  });
});

// ── 7. Unmatched SELL ──────────────────────────────────────────────────────

describe('expectancy — unmatched SELL', () => {
  it('logs a warning, does not crash, and produces no negative position', () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    const orders = [makeOrder('SELL', 1, 100)];
    const { closedTrades, openLots } = reconstructTrades(orders);

    expect(closedTrades).toHaveLength(0);
    expect(openLots.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no matching BUY inventory'),
      expect.objectContaining({ unmatched: 1 }),
    );

    warnSpy.mockRestore();
  });
});

// ── 8. Metrics math against hand-computed values ─────────────────────────────

describe('expectancy — metrics math', () => {
  it('matches hand-computed winRate / profitFactor / expectancy / drawdown', () => {
    const orders = [
      makeOrder('BUY', 1, 100), makeOrder('SELL', 1, 110),  // +10 win
      makeOrder('BUY', 1, 100), makeOrder('SELL', 1, 120),  // +20 win
      makeOrder('BUY', 1, 100), makeOrder('SELL', 1, 70),   // -30 loss
    ];

    const report = build(orders, 1_000);

    expect(report.closedTradeCount).toBe(3);
    expect(report.winCount).toBe(2);
    expect(report.lossCount).toBe(1);
    expect(report.winRate).toBeCloseTo(2 / 3, 10);
    expect(report.avgWin).toBeCloseTo(15, 10);          // (10 + 20) / 2
    expect(report.avgLoss).toBeCloseTo(30, 10);         // |−30| / 1
    expect(report.profitFactor).toBeCloseTo(1, 10);     // 30 / 30
    expect(report.expectancyPerTrade).toBeCloseTo(0, 10); // (10 + 20 − 30) / 3
    // Realized equity 1000 → 1010 → 1030 (peak) → 1000; drawdown = 30 / 1030.
    expect(report.maxDrawdownPct).toBeCloseTo(30 / 1030, 10);
  });
});

// ── computeExpectancyReport end-to-end (open-position marking + feePreset) ────

describe('expectancy — computeExpectancyReport via exchange', () => {
  it('marks open positions to live price and reads the exchange fee preset', async () => {
    const orders = [
      makeOrder('BUY', 2, 100, 0),
      makeOrder('SELL', 1, 110, 0),  // close 1, leave 1 open
    ];
    const exchange = new MockExchange(orders, { BTC: 150 });

    const report = await computeExpectancyReport(exchange, { initialCapital: 10_000 });

    expect(report.feePreset).toBe('binance-us');
    expect(report.closedTradeCount).toBe(1);
    expect(report.unrealized.positions).toHaveLength(1);
    const pos = report.unrealized.positions[0]!;
    expect(pos.quantity).toBe(1);
    expect(pos.markPrice).toBe(150);
    expect(pos.costBasis).toBeCloseTo(100, 10);            // 1 unit @100, no commission
    expect(pos.unrealizedPnl).toBeCloseTo(150 - 100, 10);  // mark 150 − cost 100
    expect(report.unrealized.totalUnrealizedPnl).toBeCloseTo(50, 10);
  });

  it('reconstructClosedTrades returns just the closed round trips', () => {
    const orders = [makeOrder('BUY', 1, 100), makeOrder('SELL', 1, 110)];
    expect(reconstructClosedTrades(orders)).toHaveLength(1);
  });
});

// ── helper: reconstruct + build into a full report ────────────────────────────

function build(orders: Order[], initialCapital: number): ExpectancyReport {
  const { closedTrades, openLots } = reconstructTrades(orders);
  const turnoverNotional = orders.reduce((acc, o) => acc + Math.abs(o.price * o.quantity), 0);

  // Mark any open lots at their avg entry price (no live source in these unit tests).
  const markPrices = new Map<string, number>();
  const openPositions = Array.from(openLots.entries()).map(([symbol, lots]) => {
    let quantity = 0;
    let costBasis = 0;
    for (const lot of lots) {
      quantity += lot.qtyRemaining;
      costBasis += lot.qtyRemaining * (lot.price + lot.commissionPerUnit);
    }
    const avgEntryPrice = quantity > 0 ? costBasis / quantity : 0;
    const markPrice = markPrices.get(symbol) ?? avgEntryPrice;
    return { symbol, quantity, avgEntryPrice, costBasis, markPrice, unrealizedPnl: markPrice * quantity - costBasis };
  });

  return buildExpectancyReport({
    closedTrades,
    openPositions,
    turnoverNotional,
    feePreset:      'test',
    initialCapital,
    generatedAt:    new Date(BASE_TS),
  });
}
