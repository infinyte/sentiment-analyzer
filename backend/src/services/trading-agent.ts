import type { TradingSignal } from './sentiment-analyzer.js';

// ─── Risk Profiles ─────────────────────────────────────────────────────────

export type AgentType = 'RULE_BASED' | 'ML_BASED' | 'HYBRID';

export type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';

interface RiskParameters {
  maxRiskPct: number;    // fraction of cash at risk per trade
  takeProfitPct: number; // target gain to auto-close
  stopLossPct: number;   // max loss before hard close
  maxHoldDays: number;   // force-close after this many days
  minConfidence: number; // minimum signal confidence to enter
  minStrength: number;   // minimum signal strength to enter (0-1)
}

const RISK_PARAMS: Record<RiskProfile, RiskParameters> = {
  CONSERVATIVE: {
    maxRiskPct: 0.01,
    takeProfitPct: 0.05,
    stopLossPct: 0.02,
    maxHoldDays: 5,
    minConfidence: 0.70,
    minStrength: 0.55,
  },
  AGGRESSIVE: {
    maxRiskPct: 0.05,
    takeProfitPct: 0.20,
    stopLossPct: 0.08,
    maxHoldDays: 14,
    minConfidence: 0.50,
    minStrength: 0.40,
  },
  SCALPING: {
    maxRiskPct: 0.03,
    takeProfitPct: 0.03,
    stopLossPct: 0.015,
    maxHoldDays: 2,
    minConfidence: 0.60,
    minStrength: 0.50,
  },
};

// ─── Portfolio & Orders ─────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  entryPrice: number;
  quantity: number;
  entryDate: Date;
  stopLoss: number;
  takeProfit: number;
  signal: 'BUY' | 'SELL';
}

export interface TradeRecord {
  symbol: string;
  signal: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryDate: Date;
  exitDate: Date;
  holdDays: number;
  pnl: number;
  pnlPct: number;
  exitReason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'SIGNAL_REVERSAL' | 'TIMEOUT' | 'MANUAL';
}

export interface AgentMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;          // 0-1
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  totalReturn: number;      // absolute $
  totalReturnPct: number;
  maxDrawdown: number;      // fraction, e.g. 0.05 = 5%
  sharpeRatio: number;
  equityCurve: Array<{ date: Date; capital: number }>;
}

export interface AgentConfig {
  agentId: string;
  type: AgentType;
  riskProfile: RiskProfile;
  initialCapital: number;
}

export interface DecisionContext {
  symbol: string;
  signal: TradingSignal;
  currentPrice: number;
  date: Date;
}

// ─── Abstract Base ──────────────────────────────────────────────────────────

export abstract class TradingAgent {
  readonly agentId: string;
  readonly agentType: AgentType;
  readonly riskProfile: RiskProfile;

  protected cash: number;
  protected readonly initialCapital: number;
  protected positions: Map<string, Position> = new Map();
  protected tradeHistory: TradeRecord[] = [];

  // for Sharpe ratio / drawdown tracking
  private peakCapital: number;
  private dailyReturns: number[] = [];
  private lastEquity: number;

  readonly metrics: AgentMetrics;

  constructor(config: AgentConfig) {
    this.agentId = config.agentId;
    this.agentType = config.type;
    this.riskProfile = config.riskProfile;
    this.cash = config.initialCapital;
    this.initialCapital = config.initialCapital;
    this.peakCapital = config.initialCapital;
    this.lastEquity = config.initialCapital;
    this.metrics = this.emptyMetrics();
  }

  // ── Subclass contract ─────────────────────────────────────────────────────

  /**
   * Each agent type implements its own entry/exit logic.
   * Returns the action to take: 'BUY', 'SELL', or 'HOLD'.
   */
  abstract makeDecision(context: DecisionContext): 'BUY' | 'SELL' | 'HOLD';

  // ── Trade Execution ───────────────────────────────────────────────────────

  /** Attempt to open a position. Respects cash availability and risk sizing. */
  executeOrder(context: DecisionContext, action: 'BUY' | 'SELL'): boolean {
    const { symbol, currentPrice, date } = context;
    const params = RISK_PARAMS[this.riskProfile];

    // Don't double-open
    if (this.positions.has(symbol)) return false;

    const stopLoss =
      action === 'BUY'
        ? currentPrice * (1 - params.stopLossPct)
        : currentPrice * (1 + params.stopLossPct);
    const takeProfit =
      action === 'BUY'
        ? currentPrice * (1 + params.takeProfitPct)
        : currentPrice * (1 - params.takeProfitPct);

    // Position sizing: risk at most maxRiskPct of current total equity
    const equity = this.totalEquity(currentPrice, symbol);
    const riskAmount = equity * params.maxRiskPct;
    const priceRisk = Math.abs(currentPrice - stopLoss);
    if (priceRisk === 0) return false;

    const quantity = riskAmount / priceRisk;
    const cost = quantity * currentPrice;
    if (cost > this.cash) return false;

    this.cash -= cost;
    this.positions.set(symbol, { symbol, entryPrice: currentPrice, quantity, entryDate: date, stopLoss, takeProfit, signal: action });
    return true;
  }

  /** Close an open position and record the trade. */
  closePosition(
    symbol: string,
    exitPrice: number,
    exitDate: Date,
    reason: TradeRecord['exitReason']
  ): TradeRecord | null {
    const pos = this.positions.get(symbol);
    if (!pos) return null;

    const proceeds = pos.quantity * exitPrice;
    const cost = pos.quantity * pos.entryPrice;
    const pnl = pos.signal === 'BUY' ? proceeds - cost : cost - proceeds;
    const pnlPct = pnl / cost;
    const holdDays = Math.round(
      (exitDate.getTime() - pos.entryDate.getTime()) / 86_400_000
    );

    this.cash += pos.signal === 'BUY' ? proceeds : cost + pnl; // return cost + profit
    this.positions.delete(symbol);

    const record: TradeRecord = {
      symbol,
      signal: pos.signal,
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.quantity,
      entryDate: pos.entryDate,
      exitDate,
      holdDays,
      pnl,
      pnlPct,
      exitReason: reason,
    };
    this.tradeHistory.push(record);
    return record;
  }

  /** Check open positions for stop-loss / take-profit / timeout triggers. */
  evaluateOpenPositions(
    currentPrices: Map<string, number>,
    currentDate: Date
  ): void {
    const params = RISK_PARAMS[this.riskProfile];
    for (const [symbol, pos] of this.positions) {
      const price = currentPrices.get(symbol);
      if (price === undefined) continue;

      const holdDays = (currentDate.getTime() - pos.entryDate.getTime()) / 86_400_000;

      let reason: TradeRecord['exitReason'] | null = null;
      if (pos.signal === 'BUY') {
        if (price <= pos.stopLoss) reason = 'STOP_LOSS';
        else if (price >= pos.takeProfit) reason = 'TAKE_PROFIT';
        else if (holdDays >= params.maxHoldDays) reason = 'TIMEOUT';
      } else {
        if (price >= pos.stopLoss) reason = 'STOP_LOSS';
        else if (price <= pos.takeProfit) reason = 'TAKE_PROFIT';
        else if (holdDays >= params.maxHoldDays) reason = 'TIMEOUT';
      }

      if (reason) this.closePosition(symbol, price, currentDate, reason);
    }
  }

  /** Snapshot equity for Sharpe / drawdown tracking — call once per simulated day. */
  recordDailyEquity(prices: Map<string, number>, date: Date): void {
    const equity = this.totalEquityAll(prices);
    const dailyReturn = (equity - this.lastEquity) / this.lastEquity;
    this.dailyReturns.push(dailyReturn);
    this.lastEquity = equity;

    if (equity > this.peakCapital) this.peakCapital = equity;
    const drawdown = (this.peakCapital - equity) / this.peakCapital;
    if (drawdown > this.metrics.maxDrawdown) this.metrics.maxDrawdown = drawdown;

    this.metrics.equityCurve.push({ date, capital: equity });
  }

  /** Finalise all metrics after simulation ends. */
  finalizeMetrics(prices: Map<string, number>): AgentMetrics {
    // Close any remaining open positions at last known price
    for (const [symbol, pos] of this.positions) {
      const price = prices.get(symbol) ?? pos.entryPrice;
      this.closePosition(symbol, price, new Date(), 'MANUAL');
    }

    const trades = this.tradeHistory;
    const winners = trades.filter((t) => t.pnl > 0);
    const losers = trades.filter((t) => t.pnl <= 0);
    const grossProfit = winners.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
    const finalCapital = this.cash; // positions closed above
    const totalReturn = finalCapital - this.initialCapital;

    this.metrics.totalTrades = trades.length;
    this.metrics.winningTrades = winners.length;
    this.metrics.losingTrades = losers.length;
    this.metrics.winRate = trades.length > 0 ? winners.length / trades.length : 0;
    this.metrics.grossProfit = grossProfit;
    this.metrics.grossLoss = grossLoss;
    this.metrics.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    this.metrics.totalReturn = totalReturn;
    this.metrics.totalReturnPct = totalReturn / this.initialCapital;
    this.metrics.sharpeRatio = this.calcSharpe();
    return this.metrics;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  protected get riskParams(): RiskParameters {
    return RISK_PARAMS[this.riskProfile];
  }

  /** Current equity for a single symbol's position only (used in sizing). */
  private totalEquity(currentPrice: number, symbol: string): number {
    let equity = this.cash;
    for (const [sym, pos] of this.positions) {
      const price = sym === symbol ? currentPrice : pos.entryPrice;
      equity += pos.quantity * price;
    }
    return equity;
  }

  /** Total portfolio value across all open positions. */
  private totalEquityAll(prices: Map<string, number>): number {
    let equity = this.cash;
    for (const [symbol, pos] of this.positions) {
      const price = prices.get(symbol) ?? pos.entryPrice;
      equity += pos.quantity * price;
    }
    return equity;
  }

  private calcSharpe(): number {
    if (this.dailyReturns.length < 2) return 0;
    const mean = this.dailyReturns.reduce((a, b) => a + b, 0) / this.dailyReturns.length;
    const variance =
      this.dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
      (this.dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    // Annualise (252 trading days)
    return stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  }

  private emptyMetrics(): AgentMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      totalReturn: 0,
      totalReturnPct: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      equityCurve: [],
    };
  }
}

// ─── RuleBasedAgent ─────────────────────────────────────────────────────────

export class RuleBasedAgent extends TradingAgent {
  constructor(config: AgentConfig) {
    super({ ...config, type: 'RULE_BASED' });
  }

  makeDecision(context: DecisionContext): 'BUY' | 'SELL' | 'HOLD' {
    const { signal } = context;
    const params = this.riskParams;
    const hasPosition = this.positions.has(context.symbol);

    // Exit rule: if we hold and signal reverses, close
    if (hasPosition) {
      const pos = this.positions.get(context.symbol)!;
      if (pos.signal === 'BUY' && signal.signal === 'SELL') return 'SELL';
      if (pos.signal === 'SELL' && signal.signal === 'BUY') return 'BUY';
      return 'HOLD';
    }

    // Entry rules
    if (
      signal.strength >= params.minStrength &&
      signal.signal !== 'HOLD'
    ) {
      return signal.signal;
    }

    return 'HOLD';
  }
}

// ─── MLBasedAgent ───────────────────────────────────────────────────────────

export class MLBasedAgent extends TradingAgent {
  // Learned weights — start at equal distribution, updated during backtesting
  private weights = {
    sentiment: 0.25,
    momentum: 0.35,
    volatility: 0.15, // inverse: high vol = lower score
    signalStrength: 0.25,
  };

  // Accumulated gradient information for weight updates
  private recentOutcomes: Array<{ features: number[]; outcome: number }> = [];

  constructor(config: AgentConfig) {
    super({ ...config, type: 'ML_BASED' });
  }

  makeDecision(context: DecisionContext): 'BUY' | 'SELL' | 'HOLD' {
    const { signal } = context;
    const params = this.riskParams;

    const sentimentScore = signal.signal === 'BUY' ? signal.strength : signal.signal === 'SELL' ? -signal.strength : 0;

    // Derive a simple momentum proxy from signal risk/reward
    const momentumScore = Math.min(signal.risk_reward_ratio / 3, 1); // 3:1 = full score

    // Volatility proxy: wide stop relative to price is high volatility
    const volatilityScore = signal.stop_loss > 0
      ? Math.min(
          Math.abs(context.currentPrice - signal.stop_loss) / context.currentPrice / 0.1,
          1
        )
      : 0.5;

    const entryScore =
      this.weights.sentiment * sentimentScore +
      this.weights.momentum * momentumScore -
      this.weights.volatility * volatilityScore +
      this.weights.signalStrength * signal.strength;

    // Store features for later weight learning
    this.recentOutcomes.push({
      features: [sentimentScore, momentumScore, volatilityScore, signal.strength],
      outcome: 0, // updated when trade closes
    });
    // Keep buffer bounded
    if (this.recentOutcomes.length > 100) this.recentOutcomes.shift();

    const hasPosition = this.positions.has(context.symbol);
    if (hasPosition) {
      // Exit if score flips strongly
      if (entryScore < -params.minStrength * 0.8) return 'SELL';
      return 'HOLD';
    }

    if (entryScore > params.minStrength && signal.signal === 'BUY') return 'BUY';
    if (entryScore < -params.minStrength && signal.signal === 'SELL') return 'SELL';
    return 'HOLD';
  }

  /**
   * Simple gradient update: if a trade was profitable, reinforce the weights
   * that were active; if not, reduce them slightly.
   */
  updateWeightsFromTrade(trade: TradeRecord, featureIdx: number): void {
    const outcome = trade.pnl > 0 ? 1 : -1;
    const entry = this.recentOutcomes[featureIdx];
    if (!entry) return;

    const lr = 0.01; // learning rate
    const [s, m, v, ss] = entry.features;
    this.weights.sentiment = Math.max(0.05, this.weights.sentiment + lr * outcome * s);
    this.weights.momentum = Math.max(0.05, this.weights.momentum + lr * outcome * m);
    this.weights.volatility = Math.max(0.05, this.weights.volatility - lr * outcome * v);
    this.weights.signalStrength = Math.max(0.05, this.weights.signalStrength + lr * outcome * ss);

    // Re-normalise
    const total = Object.values(this.weights).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(this.weights) as Array<keyof typeof this.weights>) {
      this.weights[k] /= total;
    }
  }

  getWeights() {
    return { ...this.weights };
  }
}

// ─── HybridAgent ─────────────────────────────────────────────────────────────

export class HybridAgent extends TradingAgent {
  private ruleAgent: RuleBasedAgent;
  private mlAgent: MLBasedAgent;

  constructor(config: AgentConfig) {
    super({ ...config, type: 'HYBRID' });
    this.ruleAgent = new RuleBasedAgent(config);
    this.mlAgent = new MLBasedAgent(config);
  }

  makeDecision(context: DecisionContext): 'BUY' | 'SELL' | 'HOLD' {
    const ruleDecision = this.ruleAgent.makeDecision(context);
    const mlDecision = this.mlAgent.makeDecision(context);

    // Consensus rule: only act if both agree
    if (ruleDecision === mlDecision) return ruleDecision;

    // Disagreement → hold
    return 'HOLD';
  }
}

// ─── AgentFactory ────────────────────────────────────────────────────────────

export class AgentFactory {
  private static counter = 0;

  static create(config: Omit<AgentConfig, 'agentId'> & { agentId?: string }): TradingAgent {
    const agentId =
      config.agentId ??
      `${config.type}_${config.riskProfile}_${++AgentFactory.counter}`;
    const full: AgentConfig = { ...config, agentId };

    switch (config.type) {
      case 'RULE_BASED':
        return new RuleBasedAgent(full);
      case 'ML_BASED':
        return new MLBasedAgent(full);
      case 'HYBRID':
        return new HybridAgent(full);
    }
  }

  static createAll(configs: Array<Omit<AgentConfig, 'agentId'> & { agentId?: string }>): TradingAgent[] {
    return configs.map((c) => AgentFactory.create(c));
  }
}
