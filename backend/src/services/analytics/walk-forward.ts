/**
 * Walk-forward validation — Phase 5.
 *
 * Guards the agent's decision policy against overfitting. Walk-forward analysis
 * splits a time series into sequential *in-sample* (IS) and *out-of-sample* (OOS)
 * windows that roll forward through time: optimise the policy parameters on the IS
 * window, then measure them on the immediately following OOS window the optimiser
 * never saw, then roll both windows forward and repeat. A policy that only looks
 * good on the data it was tuned on collapses out-of-sample.
 *
 * What makes this honest here:
 *   • It replays the SAME decision policy the live agent uses (`resolvePolicyAction`).
 *   • It scores with the SAME net-of-fees expectancy as production (`expectancy.ts`),
 *     using the SAME fee/slippage fill math as the realistic paper exchange.
 *
 * Pure and synchronous — given the same inputs it returns the same report. No DB,
 * no new dependencies. Heavy on comments because the windowing + objective math is
 * where validation logic hides bugs.
 */

import type { Order } from '../exchange/exchange-interface.js';
import { FEE_PRESETS, type FeePreset } from '../exchange/realistic-paper-exchange.js';
import { resolvePolicyAction } from '../agent/trading-orchestrator.js';
import {
  reconstructTrades,
  buildExpectancyReport,
  type ExpectancyReport,
} from './expectancy.js';

// ── Inputs ────────────────────────────────────────────────────────────────────

/** One point in time: a price and the agent's directional signal there. */
export interface Bar {
  timestamp: Date;
  price:     number;
  signal:    'BUY' | 'SELL' | 'HOLD';
  strength:  number;   // 0–1
}

/** The two parameters the walk-forward optimiser searches over. */
export interface PolicyParams {
  minStrength:            number;   // BUY only when signal strength ≥ this
  tradeFractionOfCapital: number;   // BUY notional as a fraction of cash
}

/** Objective the IS optimiser maximises (and the OOS report is summarised by). */
export type ObjectiveName = 'netPnl' | 'expectancy' | 'profitFactor' | 'sharpe';

/** Fill-simulation knobs (mirror the realistic paper exchange). */
export interface SimConfig {
  initialCapital: number;   // starting USDT per replay. Default 10_000
  feeTaker:       number;   // taker fee fraction. Default from feePreset
  slippagePct:    number;   // per-side slippage fraction. Default 0.001
  feePreset:      FeePreset;
}

export interface WalkForwardParams {
  symbol:           string;
  bars:             Bar[];
  /** Parameter grid to optimise over each fold. */
  candidates:       PolicyParams[];
  inSampleSize:     number;
  outOfSampleSize:  number;
  /** Anchored (growing IS window) vs rolling (fixed IS window). Default false (rolling). */
  anchored?:        boolean;
  objective?:       ObjectiveName;       // default 'netPnl'
  initialCapital?:  number;              // default 10_000
  feePreset?:       FeePreset;           // default 'binance-us'
  slippagePct?:     number;              // default 0.001
}

// ── Outputs ────────────────────────────────────────────────────────────────────

/** Compact per-fold performance (full ExpectancyReport would bloat the payload). */
export interface FoldMetrics {
  closedTradeCount:   number;
  winRate:            number;
  totalNetPnl:        number;
  expectancyPerTrade: number;
  profitFactor:       number;
  maxDrawdownPct:     number;
  objectiveValue:     number;
}

export interface WalkForwardFold {
  fold:             number;
  inSample:         { startIndex: number; endIndex: number; startTime: Date; endTime: Date; bars: number };
  outOfSample:      { startIndex: number; endIndex: number; startTime: Date; endTime: Date; bars: number };
  selectedParams:   PolicyParams;
  inSampleMetrics:  FoldMetrics;     // selected params measured on IS (the optimiser's pick)
  outOfSampleMetrics: FoldMetrics;   // same params measured on the unseen OOS window
}

export interface WalkForwardReport {
  generatedAt:           Date;
  symbol:                string;
  objective:             ObjectiveName;
  feePreset:             FeePreset;
  barCount:              number;
  candidatesEvaluated:   number;
  folds:                 WalkForwardFold[];
  /** Net-of-fees report over all OOS segments stitched together (each fold flat-to-flat). */
  aggregateOutOfSample:  ExpectancyReport;
  /**
   * Walk-forward efficiency = mean(OOS objective) / mean(IS objective). ~1.0 means
   * OOS held up to IS; well below 1 signals overfitting. 0 when IS mean ≤ 0 (guarded).
   */
  walkForwardEfficiency: number;
  notes:                 string[];
}

// Quantities at or below this are treated as flat.
const QTY_EPSILON = 1e-12;
// Exchange minimum notional (mirror TradingService's $1 floor).
const MIN_NOTIONAL = 1;

// ── Fill simulation (deterministic, fee-aware) ────────────────────────────────

/**
 * Replay the policy over `bars` and return the resulting fills. Long-only, one
 * symbol. Mirrors `RealisticPaperExchange`: BUY fills at price*(1+slip), SELL at
 * price*(1-slip), taker commission = grossValue*feeTaker. Any open position is
 * force-liquidated on the final bar so each replay is flat-to-flat — which keeps
 * P&L fully realized and lets OOS order streams be concatenated cleanly.
 */
export function simulatePolicy(symbol: string, bars: Bar[], params: PolicyParams, sim: SimConfig): Order[] {
  const orders: Order[] = [];
  let cash = sim.initialCapital;
  let position = 0;
  let counter = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (!(bar.price > 0)) continue;
    const hasPosition = position > QTY_EPSILON;
    const isLast = i === bars.length - 1;

    // On the last bar, force a close so the replay ends flat.
    const action = isLast && hasPosition
      ? 'SELL'
      : resolvePolicyAction({ signal: bar.signal, strength: bar.strength }, hasPosition, params.minStrength).action;

    if (action === 'BUY' && !hasPosition) {
      const notional = cash * params.tradeFractionOfCapital;
      if (notional < MIN_NOTIONAL) continue;              // below exchange minimum → skip
      const execPrice = bar.price * (1 + sim.slippagePct); // adverse fill
      const qty = notional / execPrice;
      const grossValue = execPrice * qty;                  // == notional
      const commission = grossValue * sim.feeTaker;        // market orders are taker
      cash -= grossValue + commission;
      position += qty;
      orders.push(makeOrder(++counter, symbol, 'BUY', qty, execPrice, commission, bar.timestamp));
    } else if (action === 'SELL' && hasPosition) {
      const execPrice = bar.price * (1 - sim.slippagePct);
      const qty = position;
      const grossValue = execPrice * qty;
      const commission = grossValue * sim.feeTaker;
      cash += grossValue - commission;
      position = 0;
      orders.push(makeOrder(++counter, symbol, 'SELL', qty, execPrice, commission, bar.timestamp));
    }
  }

  return orders;
}

/** Build a net-of-fees ExpectancyReport for one replay's fills (flat-to-flat → no open positions). */
export function evaluateReport(orders: Order[], opts: { feePreset: FeePreset; initialCapital: number; generatedAt: Date }): ExpectancyReport {
  const { closedTrades } = reconstructTrades(orders);
  const turnoverNotional = orders.reduce((acc, o) => acc + Math.abs(o.price * o.quantity), 0);
  return buildExpectancyReport({
    closedTrades,
    openPositions:    [],                 // simulatePolicy force-closes on the last bar
    turnoverNotional,
    feePreset:        opts.feePreset,
    initialCapital:   opts.initialCapital,
    generatedAt:      opts.generatedAt,
  });
}

/** Pull the chosen scalar objective out of a report (guards Infinity for ranking). */
export function objectiveValue(report: ExpectancyReport, objective: ObjectiveName): number {
  switch (objective) {
    case 'netPnl':       return report.totalNetPnl;
    case 'expectancy':   return report.expectancyPerTrade;
    case 'sharpe':       return report.sharpe;
    case 'profitFactor': return Number.isFinite(report.profitFactor) ? report.profitFactor : (report.closedTradeCount > 0 ? 1e9 : 0);
    default:             return report.totalNetPnl;
  }
}

function toFoldMetrics(report: ExpectancyReport, objective: ObjectiveName): FoldMetrics {
  return {
    closedTradeCount:   report.closedTradeCount,
    winRate:            report.winRate,
    totalNetPnl:        report.totalNetPnl,
    expectancyPerTrade: report.expectancyPerTrade,
    profitFactor:       report.profitFactor,
    maxDrawdownPct:     report.maxDrawdownPct,
    objectiveValue:     objectiveValue(report, objective),
  };
}

// ── Window generation ─────────────────────────────────────────────────────────

interface FoldWindow {
  isStart: number; isEnd: number;   // [isStart, isEnd)
  oosStart: number; oosEnd: number; // [oosStart, oosEnd)
}

/**
 * Sequential IS/OOS windows. Rolling: the IS window is a fixed size that slides
 * forward by one OOS step each fold. Anchored: the IS window always starts at 0
 * and grows by one OOS step each fold (more data, but stale regimes linger).
 */
export function generateFolds(total: number, inSampleSize: number, outOfSampleSize: number, anchored: boolean): FoldWindow[] {
  const folds: FoldWindow[] = [];
  if (inSampleSize <= 0 || outOfSampleSize <= 0) return folds;

  let step = 0;
  for (;;) {
    const isStart = anchored ? 0 : step * outOfSampleSize;
    const isEnd   = anchored ? inSampleSize + step * outOfSampleSize : isStart + inSampleSize;
    const oosStart = isEnd;
    const oosEnd   = oosStart + outOfSampleSize;
    if (oosEnd > total) break;       // not enough data for a full OOS window → stop
    folds.push({ isStart, isEnd, oosStart, oosEnd });
    step += 1;
  }
  return folds;
}

// ── Main entry ──────────────────────────────────────────────────────────────────

export function runWalkForward(params: WalkForwardParams): WalkForwardReport {
  const objective      = params.objective      ?? 'netPnl';
  const feePreset      = params.feePreset       ?? 'binance-us';
  const initialCapital = params.initialCapital  ?? 10_000;
  const slippagePct    = params.slippagePct     ?? 0.001;
  const anchored       = params.anchored        ?? false;

  const sim: SimConfig = {
    initialCapital,
    feeTaker:    FEE_PRESETS[feePreset].taker,
    slippagePct,
    feePreset,
  };

  const generatedAt = new Date();
  const notes: string[] = [];

  if (params.candidates.length === 0) {
    notes.push('no candidate parameter sets supplied');
  }

  const windows = generateFolds(params.bars.length, params.inSampleSize, params.outOfSampleSize, anchored);
  if (windows.length === 0) {
    notes.push(`not enough bars (${params.bars.length}) for inSampleSize ${params.inSampleSize} + outOfSampleSize ${params.outOfSampleSize}; zero folds`);
  }

  const folds: WalkForwardFold[] = [];
  const aggregateOosOrders: Order[] = [];
  const isObjectives: number[] = [];
  const oosObjectives: number[] = [];

  windows.forEach((w, idx) => {
    const isBars  = params.bars.slice(w.isStart, w.isEnd);
    const oosBars = params.bars.slice(w.oosStart, w.oosEnd);

    // 1. Optimise on the in-sample window: best candidate by objective, tie-broken
    //    by more closed trades (a result from more trades is more trustworthy).
    let best: { params: PolicyParams; report: ExpectancyReport; obj: number } | null = null;
    for (const candidate of params.candidates) {
      const orders = simulatePolicy(params.symbol, isBars, candidate, sim);
      const report = evaluateReport(orders, { feePreset, initialCapital, generatedAt });
      const obj = objectiveValue(report, objective);
      if (
        best === null ||
        obj > best.obj ||
        (obj === best.obj && report.closedTradeCount > best.report.closedTradeCount)
      ) {
        best = { params: candidate, report, obj };
      }
    }
    if (best === null) return;   // no candidates → skip fold (noted above)

    // 2. Apply the IS-selected params to the unseen out-of-sample window.
    const oosOrders = simulatePolicy(params.symbol, oosBars, best.params, sim);
    const oosReport = evaluateReport(oosOrders, { feePreset, initialCapital, generatedAt });
    aggregateOosOrders.push(...oosOrders);

    isObjectives.push(best.obj);
    oosObjectives.push(objectiveValue(oosReport, objective));

    folds.push({
      fold:               idx + 1,
      inSample:           rangeInfo(isBars, w.isStart, w.isEnd),
      outOfSample:        rangeInfo(oosBars, w.oosStart, w.oosEnd),
      selectedParams:     best.params,
      inSampleMetrics:    toFoldMetrics(best.report, objective),
      outOfSampleMetrics: toFoldMetrics(oosReport, objective),
    });
  });

  // Aggregate OOS report over the concatenated (flat-to-flat) OOS order streams.
  const aggregateOutOfSample = evaluateReport(aggregateOosOrders, { feePreset, initialCapital, generatedAt });

  // Walk-forward efficiency = mean(OOS obj) / mean(IS obj); 0 when IS mean ≤ 0.
  const meanIs  = mean(isObjectives);
  const meanOos = mean(oosObjectives);
  const walkForwardEfficiency = meanIs > 0 ? meanOos / meanIs : 0;

  return {
    generatedAt,
    symbol:               params.symbol,
    objective,
    feePreset,
    barCount:             params.bars.length,
    candidatesEvaluated:  params.candidates.length,
    folds,
    aggregateOutOfSample,
    walkForwardEfficiency,
    notes,
  };
}

// ── Convenience: derive momentum signals from a bare price series ──────────────

/**
 * Turn a price array into Bars with a simple, deterministic momentum signal:
 * compare each price to the trailing simple moving average of `lookback` prices.
 * Above the average by ≥ `band` → BUY, below by ≥ `band` → SELL, else HOLD.
 * Strength scales with the size of the deviation (clamped to 1). Lets the
 * endpoint run on a raw price series without the caller hand-building signals.
 */
export function deriveMomentumSignals(
  prices: number[],
  opts: { lookback?: number; band?: number; startMs?: number; stepMs?: number } = {},
): Bar[] {
  const lookback = Math.max(1, opts.lookback ?? 5);
  const band     = opts.band ?? 0.0;
  const startMs  = opts.startMs ?? 0;
  const stepMs   = opts.stepMs ?? 60_000;

  const bars: Bar[] = [];
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i]!;
    const window = prices.slice(Math.max(0, i - lookback + 1), i + 1);
    const sma = mean(window);
    const dev = sma > 0 ? (price - sma) / sma : 0;   // fractional deviation from the SMA

    let signal: Bar['signal'] = 'HOLD';
    if (dev > band) signal = 'BUY';
    else if (dev < -band) signal = 'SELL';

    bars.push({
      timestamp: new Date(startMs + i * stepMs),
      price,
      signal,
      strength: Math.min(1, Math.abs(dev) * 10),       // 10% deviation → full strength
    });
  }
  return bars;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrder(n: number, symbol: string, type: 'BUY' | 'SELL', quantity: number, price: number, commission: number, timestamp: Date): Order {
  return { id: `wf_${n}`, symbol, type, quantity, price, status: 'FILLED', timestamp, commission };
}

function rangeInfo(bars: Bar[], startIndex: number, endIndex: number) {
  return {
    startIndex,
    endIndex,
    startTime: bars[0]?.timestamp ?? new Date(0),
    endTime:   bars[bars.length - 1]?.timestamp ?? new Date(0),
    bars:      bars.length,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}
