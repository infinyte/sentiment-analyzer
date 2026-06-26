/**
 * Net-of-fees expectancy analytics.
 *
 * A stateless service that turns a flat stream of exchange fills (the BUY/SELL
 * `Order[]` returned by `getOrderHistory()`) into per-closed-trade expectancy
 * metrics. It exists because the realistic paper exchange already charges a
 * `commission` on every fill, but nothing downstream consumed it — so there was
 * no way to see whether a strategy has a *net-of-fees* edge.
 *
 * Core idea — round-trip reconstruction:
 *   `getOrderHistory()` is a flat stream of fills, but expectancy is a
 *   per-*closed-trade* metric. We rebuild round trips by FIFO-matching SELL
 *   fills against prior BUY fills, per symbol, pro-rating each fill's commission
 *   across the matched quantity. Unmatched BUY quantity stays an open position,
 *   marked to the current price for unrealized P&L.
 *
 * Everything here is plain TypeScript — no DB, no new dependencies. Persistence
 * (if the optional export endpoint is used) is a JSON file, never the schema.
 *
 * Known limitation (flagged, not fixed): the realistic exchange's in-memory
 * order Map is unbounded, so a months-long shadow run grows memory monotonically
 * and this recomputes over the whole history each call. Acceptable for the MVP.
 */

import type { ExchangeInterface, Order } from '../exchange/exchange-interface.js';
import logger from '../../logger.js';

// ── Public types ────────────────────────────────────────────────────────────

/** One reconstructed round-trip trade: SELL fills FIFO-matched to prior BUY fills, per symbol. */
export interface ClosedTrade {
  symbol:          string;
  quantity:        number;   // matched quantity for this round trip
  entryPrice:      number;   // post-slippage BUY exec price of the matched lot
  exitPrice:       number;   // post-slippage SELL exec price
  entryTimestamp:  Date;
  exitTimestamp:   Date;
  holdingPeriodMs: number;
  entryCommission: number;   // pro-rated to matched qty
  exitCommission:  number;   // pro-rated to matched qty
  grossPnl:        number;   // (exitPrice - entryPrice) * quantity
  netPnl:          number;   // grossPnl - entryCommission - exitCommission
  returnPct:       number;   // netPnl / (entryPrice * quantity)
}

/** Unmatched BUY quantity remaining open, marked to the current price. */
export interface OpenPosition {
  symbol:         string;
  quantity:       number;
  avgEntryPrice:  number;    // qty-weighted, post-slippage
  costBasis:      number;    // entry notional + entry commissions allocated to the open qty
  markPrice:      number;    // current price
  unrealizedPnl:  number;    // markPrice*qty - costBasis
}

/** Full net-of-fees expectancy report computed on demand. */
export interface ExpectancyReport {
  generatedAt:          Date;
  feePreset:            string;
  closedTradeCount:     number;
  winCount:             number;
  lossCount:            number;
  winRate:              number;  // winCount / closedTradeCount        (0 if no trades)
  avgWin:               number;  // mean netPnl of winners             (0 if none)
  avgLoss:              number;  // mean |netPnl| of losers, positive  (0 if none)
  expectancyPerTrade:   number;  // mean netPnl across all closed trades
  expectancyR:          number;  // expectancyPerTrade / avgLoss       (0 if avgLoss == 0)
  profitFactor:         number;  // grossProfit / grossLoss            (Infinity-guarded)
  totalNetPnl:          number;
  totalGrossPnl:        number;
  totalCommissionPaid:  number;  // commissions allocated to closed trades (entry + exit)
  feeDragPct:           number;  // totalCommissionPaid / turnoverNotional
  avgHoldingPeriodMs:   number;
  turnoverNotional:     number;  // sum of |fill notional| across all fills
  maxDrawdownPct:       number;  // on the realized (closed-trade) equity curve
  sharpe:               number;  // per-closed-trade returnPct; NOT annualized (see comment)
  sortino:              number;  // downside-deviation variant; NOT annualized
  unrealized: {
    positions:          OpenPosition[];
    totalUnrealizedPnl: number;
  };
}

/** Options for the on-demand report computation. */
export interface ExpectancyOptions {
  /** Max fills to pull from `getOrderHistory()`. Default: 100_000 (effectively all). */
  limit?:          number;
  /** Capital base for the realized-equity drawdown percentage. Default: 10_000. */
  initialCapital?: number;
  /** Fee preset label for the report. Falls back to the exchange's own, else 'unknown'. */
  feePreset?:      string;
}

// ── Internal FIFO lot ───────────────────────────────────────────────────────

/** An open BUY lot awaiting a matching SELL. */
interface OpenLot {
  symbol:            string;
  qtyRemaining:      number;
  price:             number;   // post-slippage BUY exec price
  commissionPerUnit: number;   // BUY commission allocated per unit of quantity
  timestamp:         Date;
}

// Quantities below this are treated as fully consumed — avoids float dust lingering as lots.
const QTY_EPSILON = 1e-12;

// ── Round-trip reconstruction ───────────────────────────────────────────────

/**
 * Reconstruct closed round-trips and remaining open lots from a flat fill stream.
 *
 * FIFO per symbol: each SELL consumes the oldest open BUY lots first, emitting a
 * `ClosedTrade` per matched slice. A SELL with no matching inventory (short or a
 * data gap) is logged and its unmatched remainder skipped — never a negative position.
 */
export function reconstructTrades(orders: Order[]): {
  closedTrades: ClosedTrade[];
  openLots:     Map<string, OpenLot[]>;
} {
  // Process in chronological order. Array.prototype.sort is stable in V8, so equal
  // timestamps preserve the original insertion order from getOrderHistory().
  const fills = [...orders].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const openLots     = new Map<string, OpenLot[]>();
  const closedTrades: ClosedTrade[] = [];

  for (const fill of fills) {
    if (!(fill.quantity > 0)) continue;  // skip zero/negative/NaN quantities defensively

    // Commission is charged on the whole fill; spread it evenly across its quantity.
    const commissionPerUnit = (fill.commission ?? 0) / fill.quantity;

    if (fill.type === 'BUY') {
      const lots = openLots.get(fill.symbol) ?? [];
      lots.push({
        symbol:            fill.symbol,
        qtyRemaining:      fill.quantity,
        price:             fill.price,
        commissionPerUnit,
        timestamp:         fill.timestamp,
      });
      openLots.set(fill.symbol, lots);
      continue;
    }

    // SELL — drain oldest BUY lots first.
    const lots = openLots.get(fill.symbol) ?? [];
    let sellQtyRemaining = fill.quantity;
    const sellCommissionPerUnit = commissionPerUnit;

    while (sellQtyRemaining > QTY_EPSILON && lots.length > 0) {
      const lot = lots[0]!;
      const matched = Math.min(lot.qtyRemaining, sellQtyRemaining);

      const entryCommission = lot.commissionPerUnit * matched;       // pro-rated BUY commission
      const exitCommission  = sellCommissionPerUnit * matched;       // pro-rated SELL commission
      const grossPnl        = (fill.price - lot.price) * matched;    // (exit - entry) * qty
      const netPnl          = grossPnl - entryCommission - exitCommission;
      const entryNotional   = lot.price * matched;
      const returnPct       = entryNotional > 0 ? netPnl / entryNotional : 0;

      closedTrades.push({
        symbol:          fill.symbol,
        quantity:        matched,
        entryPrice:      lot.price,
        exitPrice:       fill.price,
        entryTimestamp:  lot.timestamp,
        exitTimestamp:   fill.timestamp,
        holdingPeriodMs: Math.max(0, fill.timestamp.getTime() - lot.timestamp.getTime()),
        entryCommission,
        exitCommission,
        grossPnl,
        netPnl,
        returnPct,
      });

      lot.qtyRemaining -= matched;
      sellQtyRemaining -= matched;
      if (lot.qtyRemaining <= QTY_EPSILON) lots.shift();  // lot fully consumed
    }

    if (sellQtyRemaining > QTY_EPSILON) {
      // No BUY inventory left to match — short sell or a data gap. Skip the remainder
      // rather than fabricate a negative position.
      logger.warn('expectancy: SELL fill has no matching BUY inventory; skipping unmatched quantity', {
        symbol:    fill.symbol,
        orderId:   fill.id,
        unmatched: sellQtyRemaining,
      });
    }

    if (lots.length === 0) openLots.delete(fill.symbol);
  }

  return { closedTrades, openLots };
}

/** Reconstruct just the closed round-trips (convenience for the /trades endpoint). */
export function reconstructClosedTrades(orders: Order[]): ClosedTrade[] {
  return reconstructTrades(orders).closedTrades;
}

// ── Open-position marking ───────────────────────────────────────────────────

/**
 * Collapse the remaining FIFO lots per symbol into `OpenPosition`s, marked to the
 * supplied prices. `markPrices` missing a symbol falls back to that lot's avg entry
 * price (→ zero unrealized P&L) so the report never emits NaN for a stale quote.
 */
export function markOpenPositions(
  openLots:   Map<string, OpenLot[]>,
  markPrices: Map<string, number>,
): OpenPosition[] {
  const positions: OpenPosition[] = [];

  for (const [symbol, lots] of openLots) {
    let quantity  = 0;
    let costBasis = 0;  // entry notional + allocated entry commission, for the open qty
    for (const lot of lots) {
      quantity  += lot.qtyRemaining;
      costBasis += lot.qtyRemaining * (lot.price + lot.commissionPerUnit);
    }
    if (quantity <= QTY_EPSILON) continue;

    const avgEntryPrice = costBasis / quantity;  // qty-weighted, fee-inclusive
    const mark          = markPrices.get(symbol);
    const markPrice     = mark !== undefined && Number.isFinite(mark) && mark > 0 ? mark : avgEntryPrice;

    positions.push({
      symbol,
      quantity,
      avgEntryPrice,
      costBasis,
      markPrice,
      unrealizedPnl: markPrice * quantity - costBasis,
    });
  }

  return positions;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Build the full `ExpectancyReport` from reconstructed trades + marked positions.
 * Pure and synchronous — every division is guarded so empty input yields an
 * all-zero, NaN/Infinity-free report.
 */
export function buildExpectancyReport(params: {
  closedTrades:    ClosedTrade[];
  openPositions:   OpenPosition[];
  turnoverNotional: number;
  feePreset:       string;
  initialCapital:  number;
  generatedAt:     Date;
}): ExpectancyReport {
  const { closedTrades, openPositions, turnoverNotional, feePreset, initialCapital, generatedAt } = params;

  const n = closedTrades.length;

  const winners = closedTrades.filter(t => t.netPnl > 0);
  const losers  = closedTrades.filter(t => t.netPnl < 0);  // break-even (==0) counts as neither

  const totalGrossPnl       = sum(closedTrades.map(t => t.grossPnl));
  const totalNetPnl         = sum(closedTrades.map(t => t.netPnl));
  const totalCommissionPaid = sum(closedTrades.map(t => t.entryCommission + t.exitCommission));

  const grossProfit = sum(winners.map(t => t.netPnl));        // net profit of winners
  const grossLoss   = sum(losers.map(t => Math.abs(t.netPnl))); // net loss of losers (positive)

  const avgWin             = winners.length > 0 ? grossProfit / winners.length : 0;
  const avgLoss            = losers.length  > 0 ? grossLoss   / losers.length  : 0;  // positive
  const expectancyPerTrade = n > 0 ? totalNetPnl / n : 0;                            // mean netPnl

  // Expectancy in R-multiples: average net P&L per trade expressed in units of avg loss.
  const expectancyR = avgLoss > 0 ? expectancyPerTrade / avgLoss : 0;

  // Profit factor = gross profit / gross loss. All-winners (no loss) → Infinity by convention;
  // no trades → 0 (guarded, never NaN).
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  const winRate = n > 0 ? winners.length / n : 0;

  // Fee drag = commissions as a fraction of total traded notional.
  const feeDragPct = turnoverNotional > 0 ? totalCommissionPaid / turnoverNotional : 0;

  const avgHoldingPeriodMs = n > 0 ? sum(closedTrades.map(t => t.holdingPeriodMs)) / n : 0;

  // Per-closed-trade return series, in exit order, drives risk-adjusted stats.
  const returns = closedTrades.map(t => t.returnPct);
  const sharpe  = sharpeRatio(returns);   // mean / stddev — NOT annualized (per-trade units)
  const sortino = sortinoRatio(returns);  // mean / downside-deviation — NOT annualized

  const maxDrawdownPct = realizedMaxDrawdownPct(closedTrades, initialCapital);

  const totalUnrealizedPnl = sum(openPositions.map(p => p.unrealizedPnl));

  return {
    generatedAt,
    feePreset,
    closedTradeCount:    n,
    winCount:            winners.length,
    lossCount:           losers.length,
    winRate,
    avgWin,
    avgLoss,
    expectancyPerTrade,
    expectancyR,
    profitFactor,
    totalNetPnl,
    totalGrossPnl,
    totalCommissionPaid,
    feeDragPct,
    avgHoldingPeriodMs,
    turnoverNotional,
    maxDrawdownPct,
    sharpe,
    sortino,
    unrealized: {
      positions:          openPositions,
      totalUnrealizedPnl,
    },
  };
}

// ── On-demand orchestration ─────────────────────────────────────────────────

/**
 * Compute a net-of-fees `ExpectancyReport` directly from a live exchange.
 *
 * Pulls the fill history, reconstructs round trips, fetches current prices for any
 * open symbols, and assembles the report. Read-only: it never places or mutates orders.
 */
export async function computeExpectancyReport(
  exchange: ExchangeInterface,
  options:  ExpectancyOptions = {},
): Promise<ExpectancyReport> {
  const limit          = options.limit ?? 100_000;
  const initialCapital = options.initialCapital ?? 10_000;

  const orders = await exchange.getOrderHistory(limit);
  const { closedTrades, openLots } = reconstructTrades(orders);

  // Mark open positions to live prices (one batched fetch).
  const openSymbols = [...openLots.keys()];
  const markPrices  = new Map<string, number>();
  if (openSymbols.length > 0) {
    try {
      const prices = await exchange.getPrices(openSymbols);
      for (const [sym, px] of prices) markPrices.set(sym, px);
    } catch (err: unknown) {
      logger.warn('expectancy: could not fetch mark prices; open positions valued at cost', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const openPositions = markOpenPositions(openLots, markPrices);

  // Turnover = total notional across every fill (BUY and SELL), used for fee-drag.
  const turnoverNotional = sum(orders.map(o => Math.abs(o.price * o.quantity)));

  const feePreset = options.feePreset ?? feePresetOf(exchange) ?? 'unknown';

  return buildExpectancyReport({
    closedTrades,
    openPositions,
    turnoverNotional,
    feePreset,
    initialCapital,
    generatedAt: new Date(),
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Exchanges that surface their fee preset (e.g. RealisticPaperExchange). */
interface FeePresetAware {
  readonly feePreset?: string;
}

/** Read the fee-preset label off an exchange when it exposes one. */
function feePresetOf(exchange: ExchangeInterface): string | undefined {
  const candidate = (exchange as ExchangeInterface & FeePresetAware).feePreset;
  return typeof candidate === 'string' ? candidate : undefined;
}

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Population mean of a series (0 for empty). */
function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

/** Population standard deviation (divide by N, not N-1) — avoids NaN at n === 1. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map(v => (v - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * Sharpe ratio over the per-trade return series: mean(return) / stddev(return).
 * NOTE: not annualized and risk-free rate assumed 0 — these are per-closed-trade
 * units, suitable only for comparing strategies measured the same way. Guarded so
 * zero-variance / empty series returns 0 rather than NaN/Infinity.
 */
function sharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const sd = stdDev(returns);
  return sd > 0 ? mean(returns) / sd : 0;
}

/**
 * Sortino ratio: mean(return) / downside-deviation, where downside-deviation only
 * penalizes negative returns: sqrt(mean(min(0, r)^2)). Same non-annualized caveat
 * as Sharpe. Guarded against a zero downside deviation.
 */
function sortinoRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const downside = Math.sqrt(mean(returns.map(r => (r < 0 ? r * r : 0))));
  return downside > 0 ? mean(returns) / downside : 0;
}

/**
 * Maximum drawdown (%) on the realized equity curve.
 * Equity_t = initialCapital + cumulative net P&L after the t-th closed trade (in exit order).
 * Drawdown_t = (peak - equity_t) / peak; the report returns the maximum. Guarded so a
 * non-positive peak (capital fully eroded) does not divide by zero.
 */
function realizedMaxDrawdownPct(closedTrades: ClosedTrade[], initialCapital: number): number {
  if (closedTrades.length === 0) return 0;

  const ordered = [...closedTrades].sort(
    (a, b) => a.exitTimestamp.getTime() - b.exitTimestamp.getTime(),
  );

  let equity      = initialCapital;
  let peak        = initialCapital;
  let maxDrawdown = 0;

  for (const trade of ordered) {
    equity += trade.netPnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}
