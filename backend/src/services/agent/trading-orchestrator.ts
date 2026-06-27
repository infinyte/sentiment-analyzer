/**
 * TradingAgentOrchestrator — single-cycle agent decision + execution engine.
 *
 * This is the Phase 3 bridge between *signals* and *execution*. The existing
 * `trading-agent.ts` makes BUY/SELL/HOLD decisions but settles against its own
 * in-memory cash book; nothing it does reaches the real `ExchangeInterface`. The
 * orchestrator closes that gap: for each symbol it takes a directional signal,
 * applies a transparent decision policy, and routes the resulting order through
 * the safety-guarded `TradingService` onto the shared (realistic) paper exchange —
 * so the Phase 2 expectancy analytics, which read that exchange's order history,
 * measure the agent's own trades.
 *
 * Scope: ONE decision cycle per `run()`. The continuous loop / scheduler that
 * repeatedly calls this is Phase 4 and is deliberately out of scope here.
 *
 * Stateless: it holds no positions of its own — the exchange balances are the
 * single source of truth for cash and open positions. No DB schema, no new deps.
 */

import type { ExchangeInterface } from '../exchange/exchange-interface.js';
import type { TradingService, TradeRejectReason } from '../exchange/trading-service.js';
import type { Sentiment } from '../../types.js';
import logger from '../../logger.js';

// ── Signal contract ───────────────────────────────────────────────────────────

/**
 * A directional signal the orchestrator acts on. Intentionally minimal so any
 * producer (cached sentiment, an external model, a manual call) can feed it;
 * mirrors the direction + 0–1 strength of the richer `TradingSignal`.
 */
export interface AgentSignal {
  symbol:     string;
  signal:     'BUY' | 'SELL' | 'HOLD';
  strength:   number;   // 0–1 conviction
  reasoning?: string;
}

/** Pluggable per-symbol signal provider. */
export interface SignalSource {
  getSignal(symbol: string): Promise<AgentSignal>;
}

// ── Decision / report types ─────────────────────────────────────────────────

/** Tunable, transparent decision policy. */
export interface OrchestratorConfig {
  /** Enter a BUY only when signal strength ≥ this. Default 0.3. */
  minStrength:            number;
  /** Notional per entry as a fraction of available USDT cash. Default 0.1 (10%). */
  tradeFractionOfCapital: number;
  /** Hard cap on symbols evaluated in one cycle (abuse guard). Default 25. */
  maxSymbols:             number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  minStrength:            0.3,
  tradeFractionOfCapital: 0.1,
  maxSymbols:             25,
};

/** Outcome status for one symbol's decision in a cycle. */
export type DecisionStatus = 'EXECUTED' | 'SKIPPED' | 'BLOCKED' | 'ERROR';

/** Per-symbol result of one decision cycle. */
export interface AgentDecision {
  symbol:        string;
  signal:        'BUY' | 'SELL' | 'HOLD';
  strength:      number;
  action:        'BUY' | 'SELL' | 'HOLD';   // resolved action after policy + position
  status:        DecisionStatus;
  reason:        string;                     // human-readable explanation
  price?:        number;
  quantity?:     number;
  orderId?:      string;
  rejectReason?: TradeRejectReason;          // present when a guard blocked the order
}

/** Full report for one orchestration run. */
export interface OrchestrationReport {
  generatedAt:      Date;
  dryRun:           boolean;
  symbolsEvaluated: number;
  executedCount:    number;
  decisions:        AgentDecision[];
  portfolio: {
    cashUsdt:  number;
    positions: Array<{ symbol: string; quantity: number }>;
  };
}

/** Parameters for a single run. */
export interface RunParams {
  /** Symbols to evaluate. Defaults to the symbols carried by `signals` when omitted. */
  symbols?: string[];
  /** Explicit signals for this run; overrides the configured SignalSource per symbol. */
  signals?: AgentSignal[];
  /** When true, decide but place no orders (status SKIPPED, reason "dry run"). */
  dryRun?:  boolean;
}

// Quantities at or below this are treated as no position (float-dust guard).
const POSITION_EPSILON = 1e-8;

// ── Decision policy (pure) ────────────────────────────────────────────────────

/**
 * Transparent decision policy, extracted as a pure function so the live agent and
 * the walk-forward validator score the *same* rules. Asymmetric by design:
 * entering (BUY) requires conviction ≥ minStrength, but de-risking (SELL to close)
 * is always permitted regardless of strength — the same risk-off bias as the
 * trading layer, where SELLs bypass the kill switch. Never shorts: a SELL with no
 * position is a no-op.
 */
export function resolvePolicyAction(
  signal: { signal: 'BUY' | 'SELL' | 'HOLD'; strength: number },
  hasPosition: boolean,
  minStrength: number,
): { action: 'BUY' | 'SELL' | 'HOLD'; reason: string } {
  if (signal.signal === 'BUY') {
    if (hasPosition) return { action: 'HOLD', reason: 'BUY signal but already holding; no add' };
    if (signal.strength < minStrength) {
      return { action: 'HOLD', reason: `BUY strength ${fmt(signal.strength)} < min ${fmt(minStrength)}` };
    }
    return { action: 'BUY', reason: `BUY signal, strength ${fmt(signal.strength)}` };
  }
  if (signal.signal === 'SELL') {
    if (!hasPosition) return { action: 'HOLD', reason: 'SELL signal but no open position' };
    return { action: 'SELL', reason: 'SELL signal; closing position' };
  }
  return { action: 'HOLD', reason: 'HOLD signal' };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export class TradingAgentOrchestrator {
  private readonly exchange:       ExchangeInterface;
  private readonly tradingService: TradingService;
  private readonly signalSource:   SignalSource;
  private readonly config:         OrchestratorConfig;

  constructor(deps: {
    exchange:       ExchangeInterface;
    tradingService: TradingService;
    signalSource:   SignalSource;
    config?:        Partial<OrchestratorConfig>;
  }) {
    this.exchange       = deps.exchange;
    this.tradingService = deps.tradingService;
    this.signalSource   = deps.signalSource;
    this.config         = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...deps.config };
  }

  getConfig(): OrchestratorConfig {
    return { ...this.config };
  }

  /**
   * Update the decision-policy config at runtime (used by the Phase 7 MARL feeder
   * to apply an evolved policy to the live agent). Validated/clamped; returns the
   * effective config. Non-finite or out-of-range fields are ignored.
   */
  setConfig(partial: Partial<OrchestratorConfig>): OrchestratorConfig {
    if (partial.minStrength !== undefined && Number.isFinite(partial.minStrength)) {
      this.config.minStrength = Math.max(0, partial.minStrength);
    }
    if (partial.tradeFractionOfCapital !== undefined && Number.isFinite(partial.tradeFractionOfCapital)) {
      this.config.tradeFractionOfCapital = Math.min(1, Math.max(0, partial.tradeFractionOfCapital));
    }
    if (partial.maxSymbols !== undefined && Number.isFinite(partial.maxSymbols)) {
      this.config.maxSymbols = Math.max(1, Math.floor(partial.maxSymbols));
    }
    return this.getConfig();
  }

  /** Run one decision cycle across the requested symbols. */
  async run(params: RunParams = {}): Promise<OrchestrationReport> {
    const dryRun = params.dryRun ?? false;

    // Per-run signal overrides keyed by upper-cased symbol.
    const overrides = new Map<string, AgentSignal>();
    for (const s of params.signals ?? []) overrides.set(s.symbol.toUpperCase(), s);

    // Resolve the symbol list: explicit symbols, else the symbols carried by signals.
    const requested = params.symbols ?? (params.signals ?? []).map(s => s.symbol);
    const symbols = dedupeUpper(requested).slice(0, this.config.maxSymbols);

    // Keep the guard wrapper's capital view in sync with the exchange before sizing.
    await this.tradingService.updateCapital();

    const decisions: AgentDecision[] = [];
    for (const symbol of symbols) {
      decisions.push(await this.evaluateSymbol(symbol, overrides.get(symbol), dryRun));
    }

    const executedCount = decisions.filter(d => d.status === 'EXECUTED').length;

    return {
      generatedAt:      new Date(),
      dryRun,
      symbolsEvaluated: symbols.length,
      executedCount,
      decisions,
      portfolio:        await this.snapshotPortfolio(),
    };
  }

  // ── Per-symbol evaluation ──────────────────────────────────────────────────

  private async evaluateSymbol(
    symbol: string,
    override: AgentSignal | undefined,
    dryRun: boolean,
  ): Promise<AgentDecision> {
    // 1. Signal — explicit override wins, else the configured source (HOLD on failure).
    let signal: AgentSignal;
    try {
      signal = override ?? await this.signalSource.getSignal(symbol);
    } catch (err: unknown) {
      logger.warn('orchestrator: signal source failed; treating as HOLD', {
        symbol, error: err instanceof Error ? err.message : String(err),
      });
      signal = { symbol, signal: 'HOLD', strength: 0, reasoning: 'signal source error' };
    }

    const base: AgentDecision = {
      symbol,
      signal:   signal.signal,
      strength: signal.strength,
      action:   'HOLD',
      status:   'SKIPPED',
      reason:   '',
    };

    // 2. Market price + current position (exchange is the source of truth).
    let price: number;
    let position: number;
    try {
      price    = await this.exchange.getCurrentPrice(symbol);
      position = (await this.exchange.getBalance(symbol)).total;
    } catch (err: unknown) {
      return { ...base, status: 'ERROR', reason: `price/balance lookup failed: ${errMsg(err)}` };
    }
    if (!(price > 0)) {
      return { ...base, status: 'ERROR', reason: `non-positive price (${price})` };
    }

    const hasPosition = position > POSITION_EPSILON;

    // 3. Policy → resolved action.
    const { action, reason } = this.resolveAction(signal, hasPosition);
    if (action === 'HOLD') {
      return { ...base, action: 'HOLD', status: 'SKIPPED', reason, price };
    }

    // 4. Size the order. BUY = fraction of cash; SELL = close the whole position.
    let quantity: number;
    if (action === 'BUY') {
      const cash = (await this.exchange.getBalance('USDT')).available;
      if (!(cash > 0)) {
        return { ...base, action, status: 'SKIPPED', reason: 'no USDT cash available', price };
      }
      // notional = cash * tradeFraction;  quantity = notional / price
      quantity = (cash * this.config.tradeFractionOfCapital) / price;
    } else {
      quantity = position;
    }
    if (!(quantity > 0)) {
      return { ...base, action, status: 'SKIPPED', reason: 'computed quantity is zero', price };
    }

    // 5. Dry run stops here — decided, but no order placed.
    if (dryRun) {
      return { ...base, action, status: 'SKIPPED', reason: `${reason} (dry run, no order placed)`, price, quantity };
    }

    // 6. Execute through the safety-guarded TradingService.
    try {
      const result = await this.tradingService.executeOrder({ symbol, side: action, size: quantity, price });
      if (result.success && result.order) {
        return {
          ...base,
          action,
          status:   'EXECUTED',
          reason,
          price:    result.order.price,
          quantity: result.order.quantity,
          orderId:  result.order.id,
        };
      }
      // A guard rejected it (kill switch, max positions, size, min notional).
      return {
        ...base,
        action,
        status:       'BLOCKED',
        reason:       result.error ?? 'order rejected by safety guard',
        price,
        quantity,
        rejectReason: result.reason === 'EXECUTED' ? undefined : result.reason,
      };
    } catch (err: unknown) {
      return { ...base, action, status: 'ERROR', reason: `execution failed: ${errMsg(err)}`, price, quantity };
    }
  }

  private resolveAction(
    signal: AgentSignal,
    hasPosition: boolean,
  ): { action: 'BUY' | 'SELL' | 'HOLD'; reason: string } {
    return resolvePolicyAction(signal, hasPosition, this.config.minStrength);
  }

  private async snapshotPortfolio(): Promise<OrchestrationReport['portfolio']> {
    const balances = await this.exchange.getAllBalances();
    const cashUsdt = balances.find(b => b.symbol === 'USDT')?.available ?? 0;
    const positions = balances
      .filter(b => b.symbol !== 'USDT' && b.total > POSITION_EPSILON)
      .map(b => ({ symbol: b.symbol, quantity: b.total }));
    return { cashUsdt, positions };
  }
}

// ── Signal sources ────────────────────────────────────────────────────────────

/** Returns HOLD for any symbol it has no entry for — the safe default. */
export class StaticSignalSource implements SignalSource {
  private readonly signals: Map<string, AgentSignal>;

  constructor(signals: AgentSignal[] = []) {
    this.signals = new Map(signals.map(s => [s.symbol.toUpperCase(), s]));
  }

  async getSignal(symbol: string): Promise<AgentSignal> {
    return this.signals.get(symbol.toUpperCase())
      ?? { symbol, signal: 'HOLD', strength: 0, reasoning: 'no signal provided' };
  }
}

/** Minimal read surface the sentiment source needs (a slice of StorageService). */
export interface SentimentReader {
  getSentiment(symbol: string): Sentiment | undefined;
}

/**
 * Derives signals from cached sentiment (a cheap DB read, no network):
 * BULL → BUY, BEAR → SELL, NEUTRAL/absent → HOLD, with `confidence` as strength.
 */
export class SentimentSignalSource implements SignalSource {
  constructor(private readonly reader: SentimentReader) {}

  async getSignal(symbol: string): Promise<AgentSignal> {
    const sentiment = this.reader.getSentiment(symbol);
    if (!sentiment) {
      return { symbol, signal: 'HOLD', strength: 0, reasoning: 'no cached sentiment' };
    }
    const direction: AgentSignal['signal'] =
      sentiment.sentiment_score === 'BULL' ? 'BUY'
      : sentiment.sentiment_score === 'BEAR' ? 'SELL'
      : 'HOLD';
    return {
      symbol,
      signal:    direction,
      strength:  normalizeConfidence(sentiment.confidence),
      reasoning: `sentiment ${sentiment.sentiment_score} (confidence ${fmt(normalizeConfidence(sentiment.confidence))})`,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp confidence to 0–1, tolerating a 0–100 scale (values > 1 are divided by 100). */
function normalizeConfidence(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const scaled = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, scaled));
}

function dedupeUpper(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const u = s.toUpperCase();
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

const fmt = (n: number): string => n.toFixed(2);
const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));
