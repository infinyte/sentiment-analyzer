import {
  simulatePolicy,
  evaluateReport,
  objectiveValue,
  generateFolds,
  deriveMomentumSignals,
  runWalkForward,
  type Bar,
  type SimConfig,
  type PolicyParams,
} from '../../services/analytics/walk-forward.js';

const BASE_TS = Date.UTC(2026, 0, 1);
const bar = (price: number, signal: Bar['signal'], strength = 1, i = 0): Bar =>
  ({ timestamp: new Date(BASE_TS + i * 60_000), price, signal, strength });

const noFeeSim = (initialCapital = 1_000): SimConfig =>
  ({ initialCapital, feeTaker: 0, slippagePct: 0, feePreset: 'binance-us' });

// ── Fill simulation ─────────────────────────────────────────────────────────

describe('simulatePolicy', () => {
  it('opens on a strong BUY and force-closes on the final bar (flat-to-flat)', () => {
    const bars = [bar(100, 'BUY', 1, 0), bar(110, 'HOLD', 0, 1)];
    const orders = simulatePolicy('BTC', bars, { minStrength: 0.5, tradeFractionOfCapital: 1 }, noFeeSim(1_000));

    expect(orders).toHaveLength(2);
    expect(orders[0]!.type).toBe('BUY');
    expect(orders[0]!.quantity).toBeCloseTo(10, 10);   // 1000 / 100
    expect(orders[1]!.type).toBe('SELL');
    expect(orders[1]!.price).toBeCloseTo(110, 10);      // forced close on last bar

    const report = evaluateReport(orders, { feePreset: 'binance-us', initialCapital: 1_000, generatedAt: new Date(BASE_TS) });
    expect(report.totalNetPnl).toBeCloseTo(100, 6);     // (110-100)*10, zero fees
    expect(report.unrealized.positions).toHaveLength(0);
  });

  it('respects minStrength — a weak BUY does not open', () => {
    const bars = [bar(100, 'BUY', 0.2, 0), bar(110, 'HOLD', 0, 1)];
    const orders = simulatePolicy('BTC', bars, { minStrength: 0.5, tradeFractionOfCapital: 1 }, noFeeSim());
    expect(orders).toHaveLength(0);
  });

  it('charges fees that strictly reduce net P&L vs the zero-fee control', () => {
    const bars = [bar(100, 'BUY', 1, 0), bar(110, 'SELL', 1, 1)];
    const params: PolicyParams = { minStrength: 0.5, tradeFractionOfCapital: 0.5 };

    const free = evaluateReport(simulatePolicy('BTC', bars, params, noFeeSim()), { feePreset: 'binance-us', initialCapital: 1_000, generatedAt: new Date(BASE_TS) });
    const withFee = evaluateReport(
      simulatePolicy('BTC', bars, params, { initialCapital: 1_000, feeTaker: 0.01, slippagePct: 0, feePreset: 'coinbase' }),
      { feePreset: 'coinbase', initialCapital: 1_000, generatedAt: new Date(BASE_TS) },
    );

    expect(withFee.totalNetPnl).toBeLessThan(free.totalNetPnl);
    expect(withFee.totalCommissionPaid).toBeGreaterThan(0);
  });
});

// ── Window generation ────────────────────────────────────────────────────────

describe('generateFolds', () => {
  it('rolling: fixed IS window slides forward by the OOS step', () => {
    const folds = generateFolds(10, 4, 2, false);
    // windows: IS[0,4) OOS[4,6) ; IS[2,6) OOS[6,8) ; IS[4,8) OOS[8,10)
    expect(folds).toHaveLength(3);
    expect(folds[0]).toEqual({ isStart: 0, isEnd: 4, oosStart: 4, oosEnd: 6 });
    expect(folds[1]).toEqual({ isStart: 2, isEnd: 6, oosStart: 6, oosEnd: 8 });
    expect(folds[2]).toEqual({ isStart: 4, isEnd: 8, oosStart: 8, oosEnd: 10 });
  });

  it('anchored: IS window starts at 0 and grows each fold', () => {
    const folds = generateFolds(10, 4, 2, true);
    expect(folds[0]).toEqual({ isStart: 0, isEnd: 4, oosStart: 4, oosEnd: 6 });
    expect(folds[1]).toEqual({ isStart: 0, isEnd: 6, oosStart: 6, oosEnd: 8 });
    expect(folds[2]).toEqual({ isStart: 0, isEnd: 8, oosStart: 8, oosEnd: 10 });
  });

  it('returns no folds when there is not enough data', () => {
    expect(generateFolds(5, 4, 2, false)).toHaveLength(0);
    expect(generateFolds(10, 0, 2, false)).toHaveLength(0);
  });
});

// ── Objective extraction ──────────────────────────────────────────────────────

describe('objectiveValue', () => {
  const report = (over: Partial<ReturnType<typeof evaluateReport>>) =>
    ({ totalNetPnl: 5, expectancyPerTrade: 2, sharpe: 1.5, profitFactor: 3, closedTradeCount: 4, ...over }) as ReturnType<typeof evaluateReport>;

  it('maps each objective name to the right field', () => {
    expect(objectiveValue(report({}), 'netPnl')).toBe(5);
    expect(objectiveValue(report({}), 'expectancy')).toBe(2);
    expect(objectiveValue(report({}), 'sharpe')).toBe(1.5);
    expect(objectiveValue(report({}), 'profitFactor')).toBe(3);
  });

  it('guards an infinite profit factor for ranking', () => {
    expect(objectiveValue(report({ profitFactor: Infinity, closedTradeCount: 2 }), 'profitFactor')).toBe(1e9);
    expect(objectiveValue(report({ profitFactor: Infinity, closedTradeCount: 0 }), 'profitFactor')).toBe(0);
  });
});

// ── Momentum signal derivation ─────────────────────────────────────────────────

describe('deriveMomentumSignals', () => {
  it('flags BUY above the trailing average and SELL below it', () => {
    const bars = deriveMomentumSignals([100, 100, 100, 130, 70], { lookback: 3, band: 0.01 });
    expect(bars).toHaveLength(5);
    expect(bars[3]!.signal).toBe('BUY');   // 130 well above its trailing SMA
    expect(bars[4]!.signal).toBe('SELL');  // 70 well below
    expect(bars[3]!.strength).toBeGreaterThan(0);
  });
});

// ── End-to-end walk-forward ─────────────────────────────────────────────────────

describe('runWalkForward', () => {
  // A steady uptrend: the momentum policy (buy above the trailing average, hold,
  // force-close at window end) is profitable, and the edge is identical in every
  // window so IS performance carries to OOS.
  const prices: number[] = [];
  for (let i = 0; i < 40; i++) prices.push(100 + i);
  const bars = deriveMomentumSignals(prices, { lookback: 3, band: 0.0 });

  const candidates: PolicyParams[] = [
    { minStrength: 0.0, tradeFractionOfCapital: 0.1 },
    { minStrength: 0.9, tradeFractionOfCapital: 0.1 },  // too strict — rarely trades
  ];

  it('produces folds, picks params from the candidate set, and reports OOS + efficiency', () => {
    const report = runWalkForward({
      symbol: 'BTC', bars, candidates,
      inSampleSize: 12, outOfSampleSize: 8, objective: 'netPnl',
      initialCapital: 10_000, feePreset: 'binance-us',
    });

    expect(report.folds.length).toBeGreaterThan(0);
    expect(report.candidatesEvaluated).toBe(2);
    for (const fold of report.folds) {
      expect(candidates).toContainEqual(fold.selectedParams);
      expect(Number.isFinite(fold.outOfSampleMetrics.totalNetPnl)).toBe(true);
    }
    // aggregate OOS report is well-formed and net-of-fees
    expect(Number.isFinite(report.aggregateOutOfSample.totalNetPnl)).toBe(true);
    expect(Number.isFinite(report.walkForwardEfficiency)).toBe(true);
  });

  it('returns a well-formed report with zero folds when data is too short', () => {
    const report = runWalkForward({
      symbol: 'BTC', bars: bars.slice(0, 5), candidates,
      inSampleSize: 12, outOfSampleSize: 8,
    });
    expect(report.folds).toHaveLength(0);
    expect(report.notes.join(' ')).toMatch(/not enough bars/i);
    expect(report.aggregateOutOfSample.closedTradeCount).toBe(0);
    expect(Number.isFinite(report.aggregateOutOfSample.totalNetPnl)).toBe(true);
    expect(report.walkForwardEfficiency).toBe(0);
  });

  it('selects the profitable candidate over one that barely trades, in-sample', () => {
    const report = runWalkForward({
      symbol: 'BTC', bars, candidates,
      inSampleSize: 12, outOfSampleSize: 8, objective: 'netPnl',
    });
    // The dip-buying params (minStrength 0) should win at least the first fold.
    expect(report.folds[0]!.selectedParams.minStrength).toBe(0);
  });
});
