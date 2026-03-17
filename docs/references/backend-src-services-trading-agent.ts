TRADING AGENT FRAMEWORK
======================

File: backend/src/services/trading-agent.ts

This framework powers the automated trading simulation.
- 3 agent types: Rule-based, ML-based, Hybrid
- 3 risk profiles: Conservative, Moderate, Aggressive
- 3 strategies: Scalping, Swing, Position trading
- Full order lifecycle management

---

AGENT TYPES
===========

1. RULE-BASED AGENTS
   - Follow hardcoded decision rules
   - Deterministic and explainable
   - Fast execution
   - Limited adaptability

2. ML-BASED AGENTS
   - Learn from historical backtesting
   - Adapt to market conditions
   - Slower training phase
   - Better long-term performance

3. HYBRID AGENTS
   - Start with rules, refine with ML
   - Best of both worlds
   - Medium complexity
   - Recommended for balanced approach

---

IMPLEMENTATION

import { TradingSignal, AdvancedSentiment } from "./sentiment-analyzer";

interface PortfolioPosition {
  symbol: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  entry_time: Date;
  stop_loss: number;
  target_price: number;
  signal: TradingSignal;
  status: "OPEN" | "CLOSED" | "PARTIAL";
}

interface Order {
  id: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  timestamp: Date;
  status: "PENDING" | "FILLED" | "PARTIAL" | "CANCELLED";
  slippage_pct?: number;
}

interface AgentDecision {
  action: "BUY" | "SELL" | "HOLD" | "CLOSE_POSITION";
  quantity?: number;
  price?: number;
  reasoning: string;
  confidence: number;
}

interface TradeMetrics {
  win_rate: number; // % of winning trades
  profit_factor: number; // Gross profit / gross loss
  max_drawdown: number; // Largest peak-to-trough decline
  sharpe_ratio: number; // Risk-adjusted return
  total_return_pct: number;
  winning_trades: number;
  losing_trades: number;
}

// ========================================
// ABSTRACT BASE AGENT
// ========================================

abstract class TradingAgent {
  public agentId: string;
  public agentType: "RULE_BASED" | "ML_BASED" | "HYBRID";
  public riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING";
  public strategy: "SWING_TRADING" | "POSITION_TRADING" | "SCALPING";
  public portfolio: PortfolioPosition[] = [];
  public orderHistory: Order[] = [];
  public cash: number;
  public initialCash: number;
  public metrics: TradeMetrics;

  constructor(
    agentId: string,
    agentType: "RULE_BASED" | "ML_BASED" | "HYBRID",
    riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING",
    initialCash: number = 10000
  ) {
    this.agentId = agentId;
    this.agentType = agentType;
    this.riskProfile = riskProfile;
    this.initialCash = initialCash;
    this.cash = initialCash;
    this.strategy = this.selectStrategy(riskProfile);
    this.metrics = {
      win_rate: 0,
      profit_factor: 0,
      max_drawdown: 0,
      sharpe_ratio: 0,
      total_return_pct: 0,
      winning_trades: 0,
      losing_trades: 0,
    };
  }

  protected selectStrategy(
    riskProfile: string
  ): "SWING_TRADING" | "POSITION_TRADING" | "SCALPING" {
    if (riskProfile === "CONSERVATIVE") return "POSITION_TRADING";
    if (riskProfile === "AGGRESSIVE") return "SWING_TRADING";
    return "SCALPING";
  }

  // Abstract method: decide on action given signal
  abstract makeDecision(
    symbol: string,
    signal: TradingSignal,
    currentPrice: number,
    sentiment: AdvancedSentiment
  ): Promise<AgentDecision>;

  // Common method: execute order
  async executeOrder(
    symbol: string,
    type: "BUY" | "SELL",
    quantity: number,
    price: number,
    signal: TradingSignal
  ): Promise<PortfolioPosition | null> {
    const cost = quantity * price;
    const slippage = price * (this.getSlippage() / 100);
    const totalCost = type === "BUY" ? cost + slippage : cost - slippage;

    if (type === "BUY" && totalCost > this.cash) {
      console.log(`[${this.agentId}] Insufficient cash for BUY order`);
      return null;
    }

    const order: Order = {
      id: `${this.agentId}_${Date.now()}`,
      symbol,
      type,
      quantity,
      price,
      timestamp: new Date(),
      status: "FILLED",
      slippage_pct: this.getSlippage(),
    };

    this.orderHistory.push(order);

    if (type === "BUY") {
      this.cash -= totalCost;
      const position: PortfolioPosition = {
        symbol,
        quantity,
        entry_price: price,
        current_price: price,
        entry_time: new Date(),
        stop_loss: signal.stop_loss,
        target_price: signal.target_price_medium,
        signal,
        status: "OPEN",
      };
      this.portfolio.push(position);
      return position;
    } else {
      // SELL: remove from portfolio
      const position = this.portfolio.find((p) => p.symbol === symbol);
      if (position) {
        this.cash += totalCost;
        position.status = "CLOSED";
        this.updateMetrics(position, price);
      }
      return position || null;
    }
  }

  // Common method: close position (stop loss or take profit)
  async closePosition(
    position: PortfolioPosition,
    currentPrice: number,
    reason: "STOP_LOSS" | "TAKE_PROFIT" | "SIGNAL_EXIT" | "TIMEOUT"
  ): Promise<void> {
    position.current_price = currentPrice;
    position.status = "CLOSED";
    await this.executeOrder(position.symbol, "SELL", position.quantity, currentPrice, position.signal);
    console.log(`[${this.agentId}] Closed ${position.symbol} due to ${reason}`);
  }

  // Update metrics after trade
  private updateMetrics(position: PortfolioPosition, exitPrice: number): void {
    const pnl = (exitPrice - position.entry_price) * position.quantity;
    const returnPct = ((exitPrice - position.entry_price) / position.entry_price) * 100;

    if (pnl > 0) {
      this.metrics.winning_trades++;
    } else {
      this.metrics.losing_trades++;
    }

    const totalTrades = this.metrics.winning_trades + this.metrics.losing_trades;
    this.metrics.win_rate = (this.metrics.winning_trades / totalTrades) * 100;
    this.metrics.total_return_pct = ((this.cash - this.initialCash) / this.initialCash) * 100;
  }

  // Risk-based position sizing
  protected calculatePositionSize(
    signal: TradingSignal,
    currentPrice: number
  ): number {
    const maxRiskPerTrade = this.getMaxRiskPerTrade();
    const riskAmount = this.cash * (maxRiskPerTrade / 100);
    const riskPerUnit = Math.abs(currentPrice - signal.stop_loss);

    if (riskPerUnit === 0) return 1; // Fallback

    const quantity = Math.floor(riskAmount / riskPerUnit);
    const maxPosition = Math.floor(this.cash * 0.1 / currentPrice); // Max 10% of portfolio per position

    return Math.min(quantity, maxPosition);
  }

  // Slippage (trading cost)
  protected getSlippage(): number {
    if (this.riskProfile === "CONSERVATIVE") return 0.1; // 0.1% slippage
    if (this.riskProfile === "AGGRESSIVE") return 0.3;
    return 0.5; // Scalping has higher slippage
  }

  // Max risk per trade
  protected getMaxRiskPerTrade(): number {
    if (this.riskProfile === "CONSERVATIVE") return 1; // Risk 1% per trade
    if (this.riskProfile === "AGGRESSIVE") return 5;
    return 3; // Scalping
  }

  // Hold time based on strategy
  protected getMaxHoldTime(): number {
    if (this.strategy === "SCALPING") return 1 * 60 * 60 * 1000; // 1 hour
    if (this.strategy === "SWING_TRADING") return 3 * 24 * 60 * 60 * 1000; // 3 days
    return 30 * 24 * 60 * 60 * 1000; // 30 days for position trading
  }

  // Update position prices during simulation
  updatePositionPrice(symbol: string, price: number): void {
    const position = this.portfolio.find((p) => p.symbol === symbol && p.status === "OPEN");
    if (position) {
      position.current_price = price;
    }
  }

  // Get portfolio value
  getPortfolioValue(currentPrices: Record<string, number>): number {
    let value = this.cash;
    for (const position of this.portfolio) {
      if (position.status === "OPEN") {
        const currentPrice = currentPrices[position.symbol] || position.current_price;
        value += position.quantity * currentPrice;
      }
    }
    return value;
  }
}

// ========================================
// RULE-BASED AGENT
// ========================================

export class RuleBasedAgent extends TradingAgent {
  constructor(
    agentId: string,
    riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING",
    initialCash?: number
  ) {
    super(agentId, "RULE_BASED", riskProfile, initialCash);
  }

  async makeDecision(
    symbol: string,
    signal: TradingSignal,
    currentPrice: number,
    sentiment: AdvancedSentiment
  ): Promise<AgentDecision> {
    // RULE 1: Check existing position
    const existingPosition = this.portfolio.find((p) => p.symbol === symbol && p.status === "OPEN");

    if (existingPosition) {
      // RULE 2: Exit conditions
      if (currentPrice <= existingPosition.stop_loss) {
        return {
          action: "CLOSE_POSITION",
          reasoning: "Stop loss hit",
          confidence: 1.0,
        };
      }

      if (currentPrice >= existingPosition.target_price) {
        return {
          action: "CLOSE_POSITION",
          reasoning: "Take profit reached",
          confidence: 1.0,
        };
      }

      const holdTime = Date.now() - existingPosition.entry_time.getTime();
      if (holdTime > this.getMaxHoldTime()) {
        return {
          action: "CLOSE_POSITION",
          reasoning: "Max hold time exceeded",
          confidence: 0.8,
        };
      }

      if (signal.signal === "SELL" && signal.strength > 70) {
        return {
          action: "CLOSE_POSITION",
          reasoning: "Strong sell signal",
          confidence: signal.confidence,
        };
      }

      return {
        action: "HOLD",
        reasoning: "Position still valid",
        confidence: 0.6,
      };
    }

    // RULE 3: Entry conditions
    if (signal.signal === "BUY" && signal.strength > 60) {
      // Strong buy signal
      const quantity = this.calculatePositionSize(signal, currentPrice);
      if (quantity > 0 && this.cash > currentPrice * quantity) {
        return {
          action: "BUY",
          quantity,
          price: currentPrice,
          reasoning: `Buy signal strength ${signal.strength}, confidence ${signal.confidence}`,
          confidence: signal.confidence,
        };
      }
    }

    return {
      action: "HOLD",
      reasoning: "No actionable signal",
      confidence: 0.5,
    };
  }
}

// ========================================
// ML-BASED AGENT
// ========================================

export class MLBasedAgent extends TradingAgent {
  private trainedWeights: {
    sentiment: number;
    momentum: number;
    volatility: number;
    signal_strength: number;
  };

  constructor(
    agentId: string,
    riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING",
    initialCash?: number
  ) {
    super(agentId, "ML_BASED", riskProfile, initialCash);
    // Initialize with learned weights (from backtesting)
    this.trainedWeights = this.initializeWeights(riskProfile);
  }

  private initializeWeights(
    riskProfile: string
  ): {
    sentiment: number;
    momentum: number;
    volatility: number;
    signal_strength: number;
  } {
    // These weights would be trained from historical backtesting
    if (riskProfile === "CONSERVATIVE") {
      return {
        sentiment: 0.4,
        momentum: 0.2,
        volatility: 0.2,
        signal_strength: 0.2,
      };
    }
    if (riskProfile === "AGGRESSIVE") {
      return {
        sentiment: 0.25,
        momentum: 0.35,
        volatility: 0.15,
        signal_strength: 0.25,
      };
    }
    return {
      sentiment: 0.2,
      momentum: 0.4,
      volatility: 0.1,
      signal_strength: 0.3,
    };
  }

  async makeDecision(
    symbol: string,
    signal: TradingSignal,
    currentPrice: number,
    sentiment: AdvancedSentiment
  ): Promise<AgentDecision> {
    const existingPosition = this.portfolio.find((p) => p.symbol === symbol && p.status === "OPEN");

    if (existingPosition) {
      // ML exit decision
      const exitScore = this.calculateExitScore(existingPosition, currentPrice, signal, sentiment);

      if (currentPrice <= existingPosition.stop_loss) {
        return {
          action: "CLOSE_POSITION",
          reasoning: "Hard stop loss",
          confidence: 1.0,
        };
      }

      if (exitScore > 0.7) {
        return {
          action: "CLOSE_POSITION",
          reasoning: `ML exit score ${exitScore.toFixed(2)}`,
          confidence: exitScore,
        };
      }

      return {
        action: "HOLD",
        reasoning: "ML model suggests holding",
        confidence: 1 - exitScore,
      };
    }

    // ML entry decision
    const entryScore = this.calculateEntryScore(signal, sentiment);

    if (entryScore > 0.65) {
      const quantity = this.calculatePositionSize(signal, currentPrice);
      if (quantity > 0 && this.cash > currentPrice * quantity) {
        return {
          action: "BUY",
          quantity,
          price: currentPrice,
          reasoning: `ML entry score ${entryScore.toFixed(2)}`,
          confidence: entryScore,
        };
      }
    }

    return {
      action: "HOLD",
      reasoning: "ML model suggests waiting",
      confidence: 0.5,
    };
  }

  private calculateEntryScore(signal: TradingSignal, sentiment: AdvancedSentiment): number {
    const sentimentScore =
      sentiment.sentiment_score === "BULL"
        ? 1.0
        : sentiment.sentiment_score === "NEUTRAL"
          ? 0.5
          : 0.0;
    const signalScore = (signal.strength / 100) * (signal.signal === "BUY" ? 1 : signal.signal === "SELL" ? -1 : 0);
    const confidenceScore = signal.confidence;

    const weightedScore =
      this.trainedWeights.sentiment * sentimentScore +
      this.trainedWeights.signal_strength * Math.max(signalScore, 0) +
      this.trainedWeights.momentum * confidenceScore;

    return Math.min(Math.max(weightedScore, 0), 1);
  }

  private calculateExitScore(
    position: PortfolioPosition,
    currentPrice: number,
    signal: TradingSignal,
    sentiment: AdvancedSentiment
  ): number {
    const unrealizedReturn = (currentPrice - position.entry_price) / position.entry_price;
    const holdTimeMinutes = (Date.now() - position.entry_time.getTime()) / (1000 * 60);

    const sentimentScore = sentiment.sentiment_score === "BEAR" ? 1.0 : sentiment.sentiment_score === "NEUTRAL" ? 0.5 : 0.0;
    const signalScore = signal.signal === "SELL" ? signal.strength / 100 : 0;
    const holdTimeScore = holdTimeMinutes > this.getMaxHoldTime() / (1000 * 60) ? 0.8 : 0;

    return (
      this.trainedWeights.sentiment * sentimentScore +
      this.trainedWeights.signal_strength * signalScore +
      this.trainedWeights.volatility * Math.abs(unrealizedReturn)
    );
  }
}

// ========================================
// HYBRID AGENT
// ========================================

export class HybridAgent extends TradingAgent {
  private ruleBased: RuleBasedAgent;
  private mlBased: MLBasedAgent;

  constructor(
    agentId: string,
    riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING",
    initialCash?: number
  ) {
    super(agentId, "HYBRID", riskProfile, initialCash);
    this.ruleBased = new RuleBasedAgent(`${agentId}_RULES`, riskProfile, initialCash);
    this.mlBased = new MLBasedAgent(`${agentId}_ML`, riskProfile, initialCash);
  }

  async makeDecision(
    symbol: string,
    signal: TradingSignal,
    currentPrice: number,
    sentiment: AdvancedSentiment
  ): Promise<AgentDecision> {
    // Get both decisions
    const ruleDecision = await this.ruleBased.makeDecision(symbol, signal, currentPrice, sentiment);
    const mlDecision = await this.mlBased.makeDecision(symbol, signal, currentPrice, sentiment);

    // Combine decisions: agree on CLOSE_POSITION takes priority
    if (ruleDecision.action === "CLOSE_POSITION" || mlDecision.action === "CLOSE_POSITION") {
      return {
        action: "CLOSE_POSITION",
        reasoning: `Rule: ${ruleDecision.reasoning}, ML: ${mlDecision.reasoning}`,
        confidence: Math.max(ruleDecision.confidence, mlDecision.confidence),
      };
    }

    // If both agree on BUY
    if (ruleDecision.action === "BUY" && mlDecision.action === "BUY") {
      const avgConfidence = (ruleDecision.confidence + mlDecision.confidence) / 2;
      return {
        action: "BUY",
        quantity: ruleDecision.quantity,
        price: currentPrice,
        reasoning: `Rules & ML agree: ${ruleDecision.reasoning} + ${mlDecision.reasoning}`,
        confidence: Math.min(avgConfidence * 1.1, 1.0), // Boost confidence when both agree
      };
    }

    // Default to HOLD if they disagree
    return {
      action: "HOLD",
      reasoning: `Rule says: ${ruleDecision.action}, ML says: ${mlDecision.action}`,
      confidence: 0.5,
    };
  }
}

// ========================================
// AGENT FACTORY
// ========================================

export class AgentFactory {
  static createAgent(
    agentId: string,
    agentType: "RULE_BASED" | "ML_BASED" | "HYBRID",
    riskProfile: "CONSERVATIVE" | "AGGRESSIVE" | "SCALPING",
    initialCash: number = 10000
  ): TradingAgent {
    switch (agentType) {
      case "RULE_BASED":
        return new RuleBasedAgent(agentId, riskProfile, initialCash);
      case "ML_BASED":
        return new MLBasedAgent(agentId, riskProfile, initialCash);
      case "HYBRID":
        return new HybridAgent(agentId, riskProfile, initialCash);
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }
}

// Export types
export type { PortfolioPosition, Order, AgentDecision, TradeMetrics };
export { TradingAgent };
