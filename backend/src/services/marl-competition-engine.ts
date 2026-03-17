/**
 * MARL Competition Engine
 * Multi-Agent Reinforcement Learning competitive trading framework.
 *
 * Architecture:
 *   SharedOrderBook  – shared limit-order book with slippage
 *   MarlTradingAgent – Q-learning agent with policy network
 *   MarlCompetitionEngine – tournament runner (SINGLE, EVOLUTIONARY, CONTINUOUS)
 *
 * No external dependencies beyond Node.js + existing project types.
 */

import { TradingAgent } from './trading-agent.js';
import type { AgentConfig, AgentMetrics } from './trading-agent.js';
import type { TradingSignal } from './sentiment-analyzer.js';
import { CoinGeckoService } from './coingecko.js';
import { storage } from '../storage.js';
import logger from '../logger.js';

// ─── Order Book Types ────────────────────────────────────────────────────────

export interface OrderBookEntry {
  orderId: string;
  agentId: string;
  symbol: string;
  side: 'BID' | 'ASK';
  price: number;
  quantity: number;
  timestamp: Date;
  filled: number;
  sequence: number;
}

export interface MarketState {
  symbol: string;
  bidBook: OrderBookEntry[];
  askBook: OrderBookEntry[];
  lastPrice: number;
  spreadBps: number;
  depth: { price: number; quantity: number }[];
}

export interface FillResult {
  filled: number;
  avgFillPrice: number;
  remainingQuantity: number;
}

export interface CompetitorOrderSummary {
  agentId: string;
  totalBidQuantity: number;
  totalAskQuantity: number;
  orderCount: number;
}

// ─── Agent Interaction Types ─────────────────────────────────────────────────

export interface AgentObservation {
  currentPrice: number;
  bidAsk: { bid: number; ask: number };
  spreadBps: number;
  portfolio: { symbol: string; quantity: number; avgPrice: number; unrealizedPnl: number }[];
  cash: number;
  equity: number;
  equityHistory: number[];
  sentimentSignal: TradingSignal;
  competitorOrders: CompetitorOrderSummary[];
}

export interface AgentAction {
  type: 'BUY' | 'SELL' | 'CANCEL' | 'HOLD' | 'WAIT';
  symbol?: string;
  quantity?: number;
  price?: number;
  orderId?: string;
  reason?: string;
}

// ─── Competition Types ───────────────────────────────────────────────────────

export interface CompetitionAgentSpec {
  id: string;
  riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
  initialCapital?: number;
}

export interface CompetitionConfig {
  mode: 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
  agents: CompetitionAgentSpec[];
  symbols: string[];
  duration: number;       // milliseconds for real-time; steps for simulation
  refreshInterval: number;
  evolutionaryRounds?: number;
  learningEnabled: boolean;
  /** If set to 'PAPER' or 'LIVE', real orders are placed via the broker adapter. Defaults to 'SIMULATED'. */
  exchangeMode?: 'SIMULATED' | 'PAPER' | 'LIVE';
  /** Credential ID (from broker_credentials table) required when exchangeMode is PAPER or LIVE. */
  brokerCredentialId?: string;
  /** Risk limits applied when exchangeMode is PAPER or LIVE. Safe defaults used if omitted. */
  riskConfig?: import('../types/broker.js').RiskConfig;
}

export interface FinalRanking {
  rank: number;
  agentId: string;
  finalCapital: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesExecuted: number;
  winRate: number;
}

export interface HeadToHeadMetric {
  agent1: string;
  agent2: string;
  agent1Return: number;
  agent2Return: number;
  winner: string;
}

export interface EquitySnapshot {
  timestamp: Date;
  agentEquities: { agentId: string; equity: number }[];
}

export interface CompetitorImpact {
  agentId: string;
  averageLiquidityImpact: number;
  timesOutbid: number;
  timesOutsold: number;
}

export interface CompetitionResult {
  competitionId: string;
  mode: string;
  duration: number;
  finalRankings: FinalRanking[];
  headToHeadMetrics: HeadToHeadMetric[];
  equityEvolution: EquitySnapshot[];
  competitorImpact: CompetitorImpact[];
}

export interface CompetitionRecord {
  competitionId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  config: CompetitionConfig;
  startedAt: Date;
  completedAt?: Date;
  result?: CompetitionResult;
  progress: number; // 0-100
  topPerformerId?: string;
}

// ─── Policy Network ───────────────────────────────────────────────────────────
// Implements simple feedforward network in pure TypeScript (no ML libs)
// Input: 50 features → Hidden(64, ReLU) → Hidden(32, ReLU) → Output(5, Softmax)

const INPUT_SIZE = 50;
const HIDDEN1 = 64;
const HIDDEN2 = 32;
const OUTPUT_SIZE = 5; // BUY, SELL, HOLD, CANCEL, WAIT

type Matrix = number[][];

function randomMatrix(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.1)
  );
}

function matMul(A: number[], W: Matrix, b: number[]): number[] {
  return b.map((bv, j) => {
    let sum = bv;
    for (let i = 0; i < A.length; i++) sum += A[i] * W[i][j];
    return sum;
  });
}

function relu(v: number[]): number[] {
  return v.map(x => Math.max(0, x));
}

function softmax(v: number[]): number[] {
  const max = Math.max(...v);
  const exps = v.map(x => Math.exp(x - max));
  const total = exps.reduce((s, e) => s + e, 0);
  return exps.map(e => e / total);
}

class PolicyNetwork {
  private w1: Matrix;
  private b1: number[];
  private w2: Matrix;
  private b2: number[];
  private w3: Matrix;
  private b3: number[];

  constructor() {
    this.w1 = randomMatrix(INPUT_SIZE, HIDDEN1);
    this.b1 = new Array(HIDDEN1).fill(0);
    this.w2 = randomMatrix(HIDDEN1, HIDDEN2);
    this.b2 = new Array(HIDDEN2).fill(0);
    this.w3 = randomMatrix(HIDDEN2, OUTPUT_SIZE);
    this.b3 = new Array(OUTPUT_SIZE).fill(0);
  }

  forward(input: number[]): number[] {
    const h1 = relu(matMul(input, this.w1, this.b1));
    const h2 = relu(matMul(h1, this.w2, this.b2));
    return softmax(matMul(h2, this.w3, this.b3));
  }

  /** Gradient-free update: nudge weights toward higher-reward actions */
  update(input: number[], actionIdx: number, reward: number, learningRate: number): void {
    const probs = this.forward(input);
    const delta = reward * learningRate;
    const advantage = 1 - probs[actionIdx];

    for (let i = 0; i < HIDDEN2; i++) {
      this.w3[i][actionIdx] += delta * advantage;
    }
    this.b3[actionIdx] += delta * advantage;

    for (let i = 0; i < INPUT_SIZE; i++) {
      this.w1[i][actionIdx % HIDDEN1] += delta * input[i] * advantage;
    }
  }

  /** Clone weights (for mutation / evolutionary) */
  cloneWeights(): { w1: Matrix; b1: number[]; w2: Matrix; b2: number[]; w3: Matrix; b3: number[] } {
    return {
      w1: this.w1.map(row => [...row]),
      b1: [...this.b1],
      w2: this.w2.map(row => [...row]),
      b2: [...this.b2],
      w3: this.w3.map(row => [...row]),
      b3: [...this.b3],
    };
  }

  /** Load weights (for cloning) */
  loadWeights(weights: ReturnType<PolicyNetwork['cloneWeights']>): void {
    this.w1 = weights.w1.map(row => [...row]);
    this.b1 = [...weights.b1];
    this.w2 = weights.w2.map(row => [...row]);
    this.b2 = [...weights.b2];
    this.w3 = weights.w3.map(row => [...row]);
    this.b3 = [...weights.b3];
  }

  /** Mutate weights by ±mutationRate */
  mutate(mutationRate: number): void {
    const mutateMatrix = (m: Matrix) =>
      m.forEach(row => row.forEach((_, j) => {
        if (Math.random() < 0.1) row[j] += (Math.random() - 0.5) * 2 * mutationRate;
      }));
    mutateMatrix(this.w1);
    mutateMatrix(this.w2);
    mutateMatrix(this.w3);
  }
}

// ─── Action index mapping ─────────────────────────────────────────────────────

const ACTION_TYPES: AgentAction['type'][] = ['BUY', 'SELL', 'HOLD', 'CANCEL', 'WAIT'];

// ─── Experience replay buffer entry ─────────────────────────────────────────

interface Experience {
  stateKey: string;
  actionIdx: number;
  reward: number;
  nextStateKey: string;
  features: number[];
}

interface LearningStateSnapshot {
  qValues: Array<[string, number[]]>;
  policyWeights: ReturnType<PolicyNetwork['cloneWeights']>;
  epsilon: number;
}

// ─── MarlTradingAgent ────────────────────────────────────────────────────────

export class MarlTradingAgent extends TradingAgent {
  /** Q-values: stateKey → array of Q-values per action */
  readonly qValues: Map<string, number[]> = new Map();
  readonly policyNetwork: PolicyNetwork;
  epsilon: number;
  readonly learningRate: number;
  readonly gamma: number;
  private replayBuffer: Experience[] = [];
  private currentObservation: AgentObservation | null = null;
  private currentStateKey: string = '';
  private lastActionIdx: number = 2;
  private totalReward: number = 0;
  private rewardHistory: number[] = [];
  private marlTradesExecuted: number = 0;
  private marlWinningTrades: number = 0;
  private learningIterations: number = 0;

  constructor(config: AgentConfig) {
    super(config);
    this.policyNetwork = new PolicyNetwork();
    this.epsilon = 0.1;
    this.learningRate = 0.01;
    this.gamma = 0.99;
  }

  // ── Observation ────────────────────────────────────────────────────────────

  observe(state: AgentObservation): void {
    this.currentObservation = state;
    this.currentStateKey = this.discretizeState(state);
  }

  // ── Action Selection (epsilon-greedy) ─────────────────────────────────────

  computeAction(observation: AgentObservation): AgentAction {
    this.observe(observation);
    const features = this.extractFeatures(observation);
    let actionIdx: number;

    if (Math.random() < this.epsilon) {
      // Explore: random action
      actionIdx = Math.floor(Math.random() * OUTPUT_SIZE);
    } else {
      // Exploit: use policy network
      const probs = this.policyNetwork.forward(features);
      actionIdx = probs.indexOf(Math.max(...probs));

      // Also check Q-table
      const qRow = this.qValues.get(this.currentStateKey);
      if (qRow) {
        const qBest = qRow.indexOf(Math.max(...qRow));
        // Blend: 50/50 between Q-table and policy network
        if (Math.random() < 0.5) actionIdx = qBest;
      }
    }

    this.lastActionIdx = actionIdx;

    const actionType = ACTION_TYPES[actionIdx];
    const symbol = observation.sentimentSignal.symbol;
    const price = observation.currentPrice;

    return this.buildAction(actionType, symbol, price, observation);
  }

  private buildAction(
    type: AgentAction['type'],
    symbol: string,
    price: number,
    obs: AgentObservation
  ): AgentAction {
    const riskPctMap: Record<string, number> = {
      CONSERVATIVE: 0.01,
      AGGRESSIVE: 0.05,
      SCALPING: 0.03,
    };
    const riskPct = riskPctMap[this.riskProfile] ?? 0.02;
    const quantity = (obs.cash * riskPct) / price;

    switch (type) {
      case 'BUY':
        return { type: 'BUY', symbol, quantity: Math.max(quantity, 0.001), price, reason: 'Q-policy BUY' };
      case 'SELL':
        return { type: 'SELL', symbol, quantity: Math.max(quantity, 0.001), price, reason: 'Q-policy SELL' };
      case 'CANCEL':
        return { type: 'CANCEL', reason: 'Q-policy CANCEL' };
      case 'WAIT':
        return { type: 'WAIT', reason: 'Q-policy WAIT' };
      default:
        return { type: 'HOLD', reason: 'Q-policy HOLD' };
    }
  }

  // ── Learning ───────────────────────────────────────────────────────────────

  learn(reward: number, nextObservation: AgentObservation): void {
    if (!this.currentObservation) return;

    const nextStateKey = this.discretizeState(nextObservation);
    const features = this.extractFeatures(this.currentObservation);
    const actionIdx = this.getLastActionIdx();

    // Store experience
    this.replayBuffer.push({
      stateKey: this.currentStateKey,
      actionIdx,
      reward,
      nextStateKey,
      features,
    });
    if (this.replayBuffer.length > 1000) this.replayBuffer.shift();

    // Q-learning update
    this.updateQValue(this.currentStateKey, actionIdx, reward, nextStateKey);

    // Policy network update
    this.policyNetwork.update(features, actionIdx, reward, this.learningRate);

    // Track rewards
    this.totalReward += reward;
    this.rewardHistory.push(reward);
    if (this.rewardHistory.length > 200) this.rewardHistory.shift();

    this.learningIterations++;
    if (this.replayBuffer.length >= 32 && this.learningIterations % 8 === 0) {
      this.replayExperiences(8);
    }
  }

  /** Replay N random experiences from buffer */
  replayExperiences(count: number): void {
    if (this.replayBuffer.length < 10) return;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.replayBuffer.length);
      const exp = this.replayBuffer[idx];
      this.updateQValue(exp.stateKey, exp.actionIdx, exp.reward, exp.nextStateKey);
      this.policyNetwork.update(exp.features, exp.actionIdx, exp.reward, this.learningRate * 0.5);
    }
  }

  updateQValue(stateKey: string, actionIdx: number, reward: number, nextStateKey: string): void {
    const current = this.qValues.get(stateKey) ?? new Array(OUTPUT_SIZE).fill(0);
    const next = this.qValues.get(nextStateKey) ?? new Array(OUTPUT_SIZE).fill(0);
    const maxNextQ = Math.max(...next);
    const updatedQ = [...current];
    updatedQ[actionIdx] = current[actionIdx] +
      this.learningRate * (reward + this.gamma * maxNextQ - current[actionIdx]);
    this.qValues.set(stateKey, updatedQ);
  }

  decay(): void {
    this.epsilon = Math.max(0.01, this.epsilon * 0.995);
  }

  recordMarlTrade(): void {
    this.marlTradesExecuted++;
  }

  recordMarlTradeOutcome(reward: number): void {
    this.marlTradesExecuted++;
    if (reward > 0) {
      this.marlWinningTrades++;
    }
  }

  exportLearningState(): LearningStateSnapshot {
    return {
      qValues: Array.from(this.qValues.entries()).map(([stateKey, values]) => [stateKey, [...values]]),
      policyWeights: this.policyNetwork.cloneWeights(),
      epsilon: this.epsilon,
    };
  }

  importLearningState(snapshot: LearningStateSnapshot): void {
    this.qValues.clear();
    for (const [stateKey, values] of snapshot.qValues) {
      this.qValues.set(stateKey, [...values]);
    }
    this.policyNetwork.loadWeights(snapshot.policyWeights);
    this.epsilon = snapshot.epsilon;
  }

  mutateLearningState(mutationRate: number): void {
    this.policyNetwork.mutate(mutationRate);
    for (const [stateKey, values] of this.qValues.entries()) {
      const mutated = values.map(value => value + (Math.random() - 0.5) * 2 * mutationRate);
      this.qValues.set(stateKey, mutated);
    }
    this.epsilon = Math.min(0.5, Math.max(0.01, this.epsilon + (Math.random() - 0.5) * mutationRate));
  }

  getMarLMetrics(): {
    totalReward: number;
    avgReward: number;
    tradesExecuted: number;
    learningCurve: number[];
    epsilon: number;
    winRate: number;
  } {
    const avgReward =
      this.rewardHistory.length > 0
        ? this.rewardHistory.reduce((s, r) => s + r, 0) / this.rewardHistory.length
        : 0;
    return {
      totalReward: this.totalReward,
      avgReward,
      tradesExecuted: this.marlTradesExecuted,
      learningCurve: [...this.rewardHistory],
      epsilon: this.epsilon,
      winRate: this.marlTradesExecuted > 0 ? this.marlWinningTrades / this.marlTradesExecuted : 0,
    };
  }

  /** Required by abstract TradingAgent — used in compatibility contexts */
  makeDecision(_context: { symbol: string; signal: TradingSignal; currentPrice: number; date: Date }): 'BUY' | 'SELL' | 'HOLD' {
    if (!this.currentObservation) return 'HOLD';
    const action = this.computeAction(this.currentObservation);
    if (action.type === 'BUY') return 'BUY';
    if (action.type === 'SELL') return 'SELL';
    return 'HOLD';
  }

  // ── Feature Extraction (50 features) ─────────────────────────────────────

  extractFeatures(obs: AgentObservation): number[] {
    const features: number[] = [];

    // Price features (5): current + normalised bid/ask levels
    const midPrice = obs.currentPrice > 0 ? obs.currentPrice : 1;
    features.push(obs.currentPrice / 100000);           // 0: current (normalised)
    features.push(obs.bidAsk.bid / midPrice);            // 1: bid ratio
    features.push(obs.bidAsk.ask / midPrice);            // 2: ask ratio
    features.push((obs.bidAsk.ask - obs.bidAsk.bid) / midPrice); // 3: spread ratio
    features.push(obs.bidAsk.bid > 0 ? obs.currentPrice / obs.bidAsk.bid - 1 : 0); // 4: price vs bid

    // Spread (1)
    features.push(Math.min(obs.spreadBps / 1000, 1));   // 5

    // Portfolio features (10)
    const totalPos = obs.portfolio.reduce((s, p) => s + p.quantity * obs.currentPrice, 0);
    features.push(obs.cash / Math.max(obs.equity, 1));  // 6: cash ratio
    features.push(obs.equity / 100000);                  // 7: equity normalised
    features.push(totalPos / Math.max(obs.equity, 1));  // 8: position concentration
    features.push(obs.portfolio.length / 10);            // 9: num positions
    const totalUnreal = obs.portfolio.reduce((s, p) => s + p.unrealizedPnl, 0);
    features.push(totalUnreal / Math.max(obs.equity, 1)); // 10: unrealised pnl ratio
    // Pad to 16 with per-position data (up to 5 positions)
    for (let i = 0; i < 5; i++) {
      const pos = obs.portfolio[i];
      features.push(pos ? pos.quantity * obs.currentPrice / Math.max(obs.equity, 1) : 0); // 11-15
    }

    // Competitor features (15): 5 agents × (bid qty, ask qty, order count)
    for (let i = 0; i < 5; i++) {
      const comp = obs.competitorOrders[i];
      features.push(comp ? Math.min(comp.totalBidQuantity / 100, 1) : 0);  // 16-20
      features.push(comp ? Math.min(comp.totalAskQuantity / 100, 1) : 0);  // 21-25
      features.push(comp ? Math.min(comp.orderCount / 20, 1) : 0);         // 26-30
    }

    // History features (10): equity trend + volatility
    const hist = obs.equityHistory.slice(-10);
    const histNorm = hist.length > 0 ? obs.equity : 1;
    for (let i = 0; i < 10; i++) {
      features.push(hist[i] !== undefined ? hist[i] / histNorm : 1); // 31-40
    }

    // Sentiment features (5)
    const sig = obs.sentimentSignal;
    features.push(sig.signal === 'BUY' ? 1 : sig.signal === 'SELL' ? -1 : 0);  // 41: direction
    features.push(sig.strength);                                                  // 42: strength
    features.push(sig.target_price_high / Math.max(midPrice, 1));               // 43: target high ratio
    features.push(sig.target_price_low / Math.max(midPrice, 1));                // 44: target low ratio
    features.push(sig.risk_reward_ratio / 10);                                   // 45: risk/reward norm

    // Risk factor (1)
    features.push(sig.stop_loss / Math.max(midPrice, 1));                       // 46

    // Pad to exactly 50
    while (features.length < INPUT_SIZE) features.push(0);

    return features.slice(0, INPUT_SIZE);
  }

  // ── State Discretization ──────────────────────────────────────────────────
  //
  // Old approach bucketed absolute dollar price (P:73900, P:74000 …).
  // With BTC at $70k+ that produces thousands of unique states visited only
  // once per simulation, so Q-values never converge.
  //
  // New: scale-invariant features that recur across steps and competitions:
  //   POS  – holding this symbol right now? (0/1)
  //   GAIN – unrealised % gain from avg entry, 1 %-step buckets, capped ±10 %
  //          (zero when flat, which is the most common actionable state)
  //   CASH – cash as % of total equity, 10 %-step buckets (0…100)
  //   SIG  – sentiment direction (BUY / SELL / HOLD)
  //
  // State space: 2 × 21 × 11 × 3 = ~1 386 states.
  // A 100-step / 2-symbol run generates ~400 observations → ~0.3 visits per
  // bucket — far more reuse than the previous thousands-of-unique-keys approach.
  // EVOLUTIONARY / CONTINUOUS modes reinforce the same buckets across rounds.

  private discretizeState(obs: AgentObservation): string {
    const symbol = obs.sentimentSignal.symbol;
    const pos = obs.portfolio.find(p => p.symbol === symbol);

    // Unrealised % gain from avg entry price, capped ±10 %, rounded to 1 %
    const gainPct = pos && pos.avgPrice > 0
      ? (obs.currentPrice - pos.avgPrice) / pos.avgPrice * 100
      : 0;
    const gainBucket = Math.max(-10, Math.min(10, Math.round(gainPct)));

    // Cash ratio in 10 % buckets (0, 10, 20 … 100)
    const cashPct = Math.round((obs.cash / Math.max(obs.equity, 1)) * 10) * 10;

    return `POS:${pos ? 1 : 0}|GAIN:${gainBucket}|CASH:${cashPct}|SIG:${obs.sentimentSignal.signal}`;
  }

  private getLastActionIdx(): number {
    return this.lastActionIdx;
  }
}

// ─── Shared Order Book ────────────────────────────────────────────────────────

export class SharedOrderBook {
  private books: Map<string, { bids: OrderBookEntry[]; asks: OrderBookEntry[] }> = new Map();
  private lastPrices: Map<string, number> = new Map();
  private orderMap: Map<string, OrderBookEntry> = new Map();
  private sequenceCounter = 0;

  private getBook(symbol: string) {
    if (!this.books.has(symbol)) {
      this.books.set(symbol, { bids: [], asks: [] });
    }
    return this.books.get(symbol)!;
  }

  /** Place an order and attempt immediate matching */
  placeOrder(
    orderId: string,
    agentId: string,
    symbol: string,
    side: 'BID' | 'ASK',
    price: number,
    quantity: number
  ): FillResult {
    const book = this.getBook(symbol);
    let remaining = quantity;
    let totalFilled = 0;
    let totalCost = 0;

    if (side === 'BID') {
      // Match against ask side (lowest ask first)
      const sortedAsks = [...book.asks]
        .filter(e => e.price <= price && e.agentId !== agentId)
        .sort((a, b) => this.comparePriceTimePriority(a, b, 'ASK'));

      for (const ask of sortedAsks) {
        if (remaining <= 0) break;
        const depth = this.getMarketDepth(symbol);
        const slippageBps = Math.min((remaining / Math.max(depth, 1)) * 100, 50);
        const fillPrice = ask.price * (1 + slippageBps / 10000);
        const fillQty = Math.min(remaining, ask.quantity - ask.filled);
        if (fillQty <= 0) continue;
        ask.filled += fillQty;
        totalFilled += fillQty;
        totalCost += fillQty * fillPrice;
        remaining -= fillQty;
        this.lastPrices.set(symbol, fillPrice);
        if (ask.filled >= ask.quantity) {
          book.asks = book.asks.filter(e => e.orderId !== ask.orderId);
          this.orderMap.delete(ask.orderId);
        }
      }
    } else {
      // ASK: match against bid side (highest bid first)
      const sortedBids = [...book.bids]
        .filter(e => e.price >= price && e.agentId !== agentId)
        .sort((a, b) => this.comparePriceTimePriority(a, b, 'BID'));

      for (const bid of sortedBids) {
        if (remaining <= 0) break;
        const depth = this.getMarketDepth(symbol);
        const slippageBps = Math.min((remaining / Math.max(depth, 1)) * 100, 50);
        const fillPrice = bid.price * (1 - slippageBps / 10000);
        const fillQty = Math.min(remaining, bid.quantity - bid.filled);
        if (fillQty <= 0) continue;
        bid.filled += fillQty;
        totalFilled += fillQty;
        totalCost += fillQty * fillPrice;
        remaining -= fillQty;
        this.lastPrices.set(symbol, fillPrice);
        if (bid.filled >= bid.quantity) {
          book.bids = book.bids.filter(e => e.orderId !== bid.orderId);
          this.orderMap.delete(bid.orderId);
        }
      }
    }

    // Add unfilled remainder as resting order
    if (remaining > 0) {
      const entry: OrderBookEntry = {
        orderId,
        agentId,
        symbol,
        side,
        price,
        quantity,
        timestamp: new Date(),
        filled: quantity - remaining,
        sequence: ++this.sequenceCounter,
      };
      if (side === 'BID') {
        book.bids.push(entry);
        book.bids.sort((a, b) => this.comparePriceTimePriority(a, b, 'BID'));
      } else {
        book.asks.push(entry);
        book.asks.sort((a, b) => this.comparePriceTimePriority(a, b, 'ASK'));
      }
      this.orderMap.set(orderId, entry);
    }

    return {
      filled: totalFilled,
      avgFillPrice: totalFilled > 0 ? totalCost / totalFilled : price,
      remainingQuantity: remaining,
    };
  }

  cancelOrder(orderId: string, symbol: string): boolean {
    const book = this.getBook(symbol);
    const entry = this.orderMap.get(orderId);
    if (!entry) return false;
    book.bids = book.bids.filter(e => e.orderId !== orderId);
    book.asks = book.asks.filter(e => e.orderId !== orderId);
    this.orderMap.delete(orderId);
    return true;
  }

  getMarketState(symbol: string): MarketState {
    const book = this.getBook(symbol);
    const bestBid = book.bids[0]?.price ?? 0;
    const bestAsk = book.asks[0]?.price ?? 0;
    const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : this.lastPrices.get(symbol) ?? 0;
    const spreadBps = midPrice > 0 && bestBid > 0 && bestAsk > 0
      ? ((bestAsk - bestBid) / midPrice) * 10000
      : 0;

    const depth = [
      ...book.bids.slice(0, 10).map(e => ({ price: e.price, quantity: e.quantity - e.filled })),
      ...book.asks.slice(0, 10).map(e => ({ price: e.price, quantity: e.quantity - e.filled })),
    ];

    return {
      symbol,
      bidBook: book.bids.slice(0, 20),
      askBook: book.asks.slice(0, 20),
      lastPrice: this.lastPrices.get(symbol) ?? midPrice,
      spreadBps,
      depth,
    };
  }

  setLastPrice(symbol: string, price: number): void {
    this.lastPrices.set(symbol, price);
  }

  getCompetitorOrders(symbol: string, excludeAgentId: string): CompetitorOrderSummary[] {
    const book = this.getBook(symbol);
    const map = new Map<string, CompetitorOrderSummary>();

    for (const entry of [...book.bids, ...book.asks]) {
      if (entry.agentId === excludeAgentId) continue;
      const existing = map.get(entry.agentId) ?? {
        agentId: entry.agentId,
        totalBidQuantity: 0,
        totalAskQuantity: 0,
        orderCount: 0,
      };
      if (entry.side === 'BID') existing.totalBidQuantity += entry.quantity - entry.filled;
      else existing.totalAskQuantity += entry.quantity - entry.filled;
      existing.orderCount++;
      map.set(entry.agentId, existing);
    }

    return Array.from(map.values());
  }

  private getMarketDepth(symbol: string): number {
    const book = this.getBook(symbol);
    const bidDepth = book.bids.reduce((s, e) => s + e.quantity - e.filled, 0);
    const askDepth = book.asks.reduce((s, e) => s + e.quantity - e.filled, 0);
    return bidDepth + askDepth;
  }

  clearSymbol(symbol: string): void {
    this.books.set(symbol, { bids: [], asks: [] });
  }

  private comparePriceTimePriority(
    left: OrderBookEntry,
    right: OrderBookEntry,
    side: 'BID' | 'ASK'
  ): number {
    if (left.price !== right.price) {
      return side === 'BID' ? right.price - left.price : left.price - right.price;
    }

    const timeDelta = left.timestamp.getTime() - right.timestamp.getTime();
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.sequence - right.sequence;
  }
}

// ─── Portfolio tracker for MARL ───────────────────────────────────────────────

interface MarlPortfolioEntry {
  symbol: string;
  quantity: number;
  avgPrice: number;
}

interface MarlAgentState {
  agentId: string;
  agent: MarlTradingAgent;
  cash: number;
  initialCapital: number;
  portfolio: Map<string, MarlPortfolioEntry>;
  equityHistory: number[];
  orderCounter: number;
  impactStats: { timesOutbid: number; timesOutsold: number; liquidityImpacts: number[] };
}

interface ActionExecutionResult {
  reward: number;
  tradeExecuted: boolean;
  realizedPnl: number;
}

interface MarketRegimeState {
  drift: number;
  volatility: number;
}

function computeEquity(state: MarlAgentState, prices: Map<string, number>): number {
  let equity = state.cash;
  for (const [sym, pos] of state.portfolio) {
    const price = prices.get(sym) ?? pos.avgPrice;
    equity += pos.quantity * price;
  }
  return equity;
}

function buildObservation(
  state: MarlAgentState,
  prices: Map<string, number>,
  symbol: string,
  signal: TradingSignal,
  orderBook: SharedOrderBook
): AgentObservation {
  const price = prices.get(symbol) ?? 0;
  const marketState = orderBook.getMarketState(symbol);
  const equity = computeEquity(state, prices);
  const portfolio = Array.from(state.portfolio.entries()).map(([sym, pos]) => {
    const curPrice = prices.get(sym) ?? pos.avgPrice;
    return {
      symbol: sym,
      quantity: pos.quantity,
      avgPrice: pos.avgPrice,
      unrealizedPnl: (curPrice - pos.avgPrice) * pos.quantity,
    };
  });

  return {
    currentPrice: price,
    bidAsk: {
      bid: marketState.bidBook[0]?.price ?? price * 0.9995,
      ask: marketState.askBook[0]?.price ?? price * 1.0005,
    },
    spreadBps: marketState.spreadBps,
    portfolio,
    cash: state.cash,
    equity,
    equityHistory: state.equityHistory.slice(-20),
    sentimentSignal: signal,
    competitorOrders: orderBook.getCompetitorOrders(symbol, state.agentId),
  };
}

// ─── MarlCompetitionEngine ────────────────────────────────────────────────────

export class MarlCompetitionEngine {
  private static readonly BASE_PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
  private static basePriceCache: { fetchedAt: number; prices: Map<string, number> } | null = null;
  private static learningStateCache: Map<string, LearningStateSnapshot> = new Map();

  private results: Map<string, CompetitionRecord> = new Map();
  private coinGecko: CoinGeckoService;

  constructor() {
    this.coinGecko = new CoinGeckoService();
    this.loadLearningStatesFromDb();
  }

  /**
   * Warm the in-process learningStateCache from SQLite on startup.
   * Silently skips if the DB isn't connected yet (e.g. in unit tests that
   * reset the cache manually via beforeEach).
   */
  private loadLearningStatesFromDb(): void {
    try {
      const rows = storage.getAllAgentLearningStates();
      for (const { cacheKey, snapshot } of rows) {
        MarlCompetitionEngine.learningStateCache.set(cacheKey, snapshot as LearningStateSnapshot);
      }
      if (rows.length > 0) {
        logger.info('marl learning states loaded from db', { count: rows.length });
      }
    } catch {
      // DB not yet connected (e.g. tests) — start with empty cache, no problem.
    }
  }

  /**
   * Fetch live prices for the given symbols from CoinGecko.
   * Falls back to 1000 per symbol on any error.
   */
  private async fetchBasePrices(symbols: string[]): Promise<Map<string, number>> {
    const freshCache = this.getCachedBasePrices(symbols);
    if (freshCache) {
      logger.info('marl base prices seeded from cache', {
        symbols,
        prices: Object.fromEntries(freshCache),
      });
      return freshCache;
    }

    try {
      const coins = await this.coinGecko.getTopCoins(250);
      const priceMap = new Map(coins.map(c => [c.symbol.toUpperCase(), c.price_usd]));
      const result = new Map<string, number>();
      for (const sym of symbols) {
        result.set(sym, priceMap.get(sym.toUpperCase()) ?? 1000);
      }
      MarlCompetitionEngine.basePriceCache = {
        fetchedAt: Date.now(),
        prices: new Map(result),
      };
      logger.info('marl base prices seeded from coingecko', {
        symbols,
        prices: Object.fromEntries(result),
      });
      return result;
    } catch (err) {
      const staleCache = this.getCachedBasePrices(symbols, true);
      if (staleCache) {
        logger.warn('marl base price fetch rate limited, using cached prices', {
          error: String(err),
          age_ms: Date.now() - (MarlCompetitionEngine.basePriceCache?.fetchedAt ?? Date.now()),
        });
        return staleCache;
      }
      logger.warn('marl base price fetch failed, using fallback', { error: String(err) });
      return new Map(symbols.map(sym => [sym, 1000]));
    }
  }

  private getCachedBasePrices(symbols: string[], allowStale = false): Map<string, number> | null {
    const cache = MarlCompetitionEngine.basePriceCache;
    if (!cache) return null;

    const ageMs = Date.now() - cache.fetchedAt;
    if (!allowStale && ageMs > MarlCompetitionEngine.BASE_PRICE_CACHE_TTL_MS) {
      return null;
    }

    const result = new Map<string, number>();
    for (const symbol of symbols) {
      const cachedPrice = cache.prices.get(symbol);
      if (cachedPrice == null) return null;
      result.set(symbol, cachedPrice);
    }
    return result;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  private createAgentState(
    spec: CompetitionAgentSpec,
    capital = spec.initialCapital ?? 10000,
    learningSnapshot?: LearningStateSnapshot,
    mutationRate?: number
  ): MarlAgentState {
    const config: AgentConfig = {
      agentId: spec.id,
      type: 'ML_BASED',
      riskProfile: spec.riskProfile,
      initialCapital: capital,
    };
    const agent = new MarlTradingAgent(config);
    const seedSnapshot = learningSnapshot ?? MarlCompetitionEngine.learningStateCache.get(this.getLearningCacheKey(spec));
    if (seedSnapshot) {
      agent.importLearningState(seedSnapshot);
      if (mutationRate && mutationRate > 0) {
        agent.mutateLearningState(mutationRate);
      }
    }
    return {
      agentId: spec.id,
      agent,
      cash: capital,
      initialCapital: capital,
      portfolio: new Map(),
      equityHistory: [capital],
      orderCounter: 0,
      impactStats: { timesOutbid: 0, timesOutsold: 0, liquidityImpacts: [] },
    };
  }

  // ── Simulate price movement (brownian motion around baseline) ─────────────

  private simulatePrices(
    symbols: string[],
    steps: number,
    basePrices: Map<string, number>
  ): Map<string, number>[] {
    const series: Map<string, number>[] = [];
    const current = new Map(basePrices);
    const regimes = new Map<string, MarketRegimeState>(
      symbols.map(symbol => [symbol, {
        drift: (Math.random() - 0.5) * 0.004,
        volatility: 0.0025 + Math.random() * 0.002,
      }])
    );

    for (let i = 0; i < steps; i++) {
      const next = new Map<string, number>();
      for (const sym of symbols) {
        const prev = current.get(sym) ?? 1000;
        const regime = regimes.get(sym) ?? { drift: 0, volatility: 0.003 };
        const regimeNoise = (Math.random() - 0.5) * regime.volatility;
        const regimeShift = Math.random() < 0.03 ? (Math.random() - 0.5) * 0.012 : 0;
        const nextDrift = Math.max(-0.015, Math.min(0.015, regime.drift * 0.92 + regimeNoise + regimeShift));
        const nextVolatility = Math.max(0.0015, Math.min(0.008, regime.volatility * 0.85 + Math.abs(regimeNoise) * 0.75 + 0.0005));
        regimes.set(sym, { drift: nextDrift, volatility: nextVolatility });

        const microNoise = (Math.random() - 0.5) * nextVolatility;
        const shock = nextDrift + microNoise;
        next.set(sym, Math.max(prev * (1 + shock), 1));
      }
      series.push(next);
      for (const [k, v] of next) current.set(k, v);
    }
    return series;
  }

  private getLearningCacheKey(spec: Pick<CompetitionAgentSpec, 'id' | 'riskProfile'>): string {
    return `${spec.id}::${spec.riskProfile}`;
  }

  private persistLearningStates(agentStates: MarlAgentState[]): void {
    for (const state of agentStates) {
      const key = this.getLearningCacheKey({ id: state.agentId, riskProfile: state.agent.riskProfile });
      const snapshot = state.agent.exportLearningState();

      // 1. Always update the in-process cache (fast, survives within the session).
      MarlCompetitionEngine.learningStateCache.set(key, snapshot);

      // 2. Write through to SQLite so learning survives application restarts.
      try {
        storage.saveAgentLearningState(key, snapshot);
      } catch (err) {
        // DB unavailable (e.g. unit tests) — in-memory cache is still updated.
        logger.warn('marl learning state db write failed', { key, error: String(err) });
      }
    }
    logger.info('marl learning states persisted', { count: agentStates.length });
  }

  private normalizedReward(priceDelta: number, referencePrice: number, quantity: number): number {
    const notional = Math.max(referencePrice * quantity, 1);
    const reward = (priceDelta * quantity / notional) * 100;
    return Math.max(-5, Math.min(5, Number(reward.toFixed(6))));
  }

  /** Derive a TradingSignal from the price change between the previous and current step. */
  private buildSignal(symbol: string, price: number, prevPrice: number): TradingSignal {
    const change = prevPrice > 0 ? (price - prevPrice) / prevPrice : 0;
    const signal: 'BUY' | 'SELL' | 'HOLD' =
      change > 0.002 ? 'BUY' : change < -0.002 ? 'SELL' : 'HOLD';
    const absChange = Math.max(Math.abs(change), 0.005);
    const strength = Math.min(absChange * 200, 1);
    return {
      symbol,
      signal,
      strength: Math.max(strength, 0.1),
      target_price_high: price * (1 + absChange * 3),
      target_price_low: price * (1 - absChange * 3),
      stop_loss: signal === 'BUY' ? price * (1 - absChange * 1.5) : price * (1 + absChange * 1.5),
      reasoning: `Price ${change >= 0 ? 'up' : 'down'} ${(Math.abs(change) * 100).toFixed(2)}% from prior step`,
      risk_reward_ratio: Math.max(absChange * 300, 1.5),
    };
  }

  // ── Execute one agent action against the order book ───────────────────────

  private executeAction(
    state: MarlAgentState,
    action: AgentAction,
    prices: Map<string, number>,
    nextPrices: Map<string, number>,
    orderBook: SharedOrderBook,
    _competitorStates: MarlAgentState[]
  ): ActionExecutionResult {
    if (!action.symbol) return { reward: 0, tradeExecuted: false, realizedPnl: 0 };
    const symbol = action.symbol;
    const price = prices.get(symbol) ?? 0;
    const nextPrice = nextPrices.get(symbol) ?? price;
    if (price <= 0) return { reward: 0, tradeExecuted: false, realizedPnl: 0 };

    const orderId = `${state.agentId}_${++state.orderCounter}`;
    let tradeExecuted = false;
    let reward = 0;
    let realizedPnl = 0;

    if (action.type === 'BUY' && action.quantity && state.cash >= action.quantity * price) {
      const qty = action.quantity;
      const result = orderBook.placeOrder(orderId, state.agentId, symbol, 'BID', price, qty);
      const cost = result.filled * result.avgFillPrice;
      if (result.filled > 0) {
        tradeExecuted = true;
        state.cash -= cost;
        const existing = state.portfolio.get(symbol);
        if (existing) {
          const totalQty = existing.quantity + result.filled;
          existing.avgPrice = (existing.quantity * existing.avgPrice + cost) / totalQty;
          existing.quantity = totalQty;
        } else {
          state.portfolio.set(symbol, { symbol, quantity: result.filled, avgPrice: result.avgFillPrice });
        }
        reward = this.normalizedReward(nextPrice - result.avgFillPrice, result.avgFillPrice, result.filled);
        const compOrders = orderBook.getCompetitorOrders(symbol, state.agentId);
        if (compOrders.some(c => c.totalBidQuantity > qty)) {
          state.impactStats.timesOutbid++;
        }
      }
      if (result.filled > 0) {
        const impact = Math.abs(result.avgFillPrice - price) / price * 10000;
        state.impactStats.liquidityImpacts.push(impact);
      }
    } else if (action.type === 'SELL') {
      const pos = state.portfolio.get(symbol);
      if (pos && pos.quantity > 0) {
        const qty = Math.min(action.quantity ?? pos.quantity, pos.quantity);
        const avgEntryPrice = pos.avgPrice;
        const result = orderBook.placeOrder(orderId, state.agentId, symbol, 'ASK', price, qty);
        const proceeds = result.filled * result.avgFillPrice;
        if (result.filled > 0) {
          tradeExecuted = true;
          state.cash += proceeds;
          realizedPnl = result.filled * (result.avgFillPrice - avgEntryPrice);
          reward = this.normalizedReward(result.avgFillPrice - nextPrice, result.avgFillPrice, result.filled);
          pos.quantity -= result.filled;
          if (pos.quantity <= 0.0001) state.portfolio.delete(symbol);
          const compOrders = orderBook.getCompetitorOrders(symbol, state.agentId);
          if (compOrders.some(c => c.totalAskQuantity > qty)) {
            state.impactStats.timesOutsold++;
          }
        }
      }
    } else if (action.type === 'CANCEL' && action.orderId) {
      orderBook.cancelOrder(action.orderId, symbol);
    } else {
      reward = this.normalizedReward(
        computeEquity(state, nextPrices) - computeEquity(state, prices),
        computeEquity(state, prices),
        1
      );
    }

    if (tradeExecuted) {
      state.agent.recordMarlTradeOutcome(reward);
    }
    return { reward, tradeExecuted, realizedPnl };
  }

  // ── Core tournament step ─────────────────────────────────────────────────

  private runStep(
    agentStates: MarlAgentState[],
    prevPrices: Map<string, number>,
    prices: Map<string, number>,
    nextPrices: Map<string, number>,
    symbols: string[],
    step: number,
    orderBook: SharedOrderBook,
    learningEnabled: boolean
  ): void {
    // CHECKPOINT 5 — Price updates + synthetic market-maker seeding
    // Clear stale resting orders and inject synthetic BID+ASK at exact market price.
    // Without this the order book starts empty: BUYs can't fill (no ASKs) and SELLs
    // can't execute (no position). Agents never trade → flat equity.
    for (const symbol of symbols) {
      orderBook.clearSymbol(symbol);
      const price = prices.get(symbol) ?? 1000;
      const prevPrice = prevPrices.get(symbol) ?? price;
      const pricePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
      logger.debug(`[STEP ${step}] price ${symbol}: ${prevPrice.toFixed(2)} → ${price.toFixed(2)} (${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(3)}%)`);

      // Synthetic market-maker at exact current price gives every order immediate liquidity.
      const MARKET_DEPTH = 1e9;
      orderBook.placeOrder(`_mm_ask_${symbol}_${step}`, '_mm_', symbol, 'ASK', price, MARKET_DEPTH);
      orderBook.placeOrder(`_mm_bid_${symbol}_${step}`, '_mm_', symbol, 'BID', price, MARKET_DEPTH);
      orderBook.setLastPrice(symbol, price);
    }

    for (const state of agentStates) {
      // CHECKPOINT 1 — agent state before decisions
      logger.debug(`[STEP ${step}] agent=${state.agentId} cash=${state.cash.toFixed(2)} positions=${state.portfolio.size}`);

      for (const symbol of symbols) {
        const currentPrice = prices.get(symbol) ?? 1000;
        const signal = this.buildSignal(symbol, currentPrice, prevPrices.get(symbol) ?? currentPrice);
        const obs = buildObservation(state, prices, symbol, signal, orderBook);

        // CHECKPOINT 2 — decision
        const action = state.agent.computeAction(obs);
        logger.debug(`[STEP ${step}] agent=${state.agentId} symbol=${symbol} decision=${action.type} qty=${action.quantity !== undefined ? action.quantity.toFixed(6) : 'N/A'} price=${currentPrice.toFixed(2)}`);

        const competitors = agentStates.filter(s => s.agentId !== state.agentId);

        // CHECKPOINT 3 — order execution
        const { reward, tradeExecuted, realizedPnl } = this.executeAction(state, action, prices, nextPrices, orderBook, competitors);

        // CHECKPOINT 4 — portfolio update
        if (tradeExecuted) {
          logger.info(`[STEP ${step}] TRADE agent=${state.agentId} ${action.type} ${symbol} qty=${action.quantity?.toFixed(6)} @ ${currentPrice.toFixed(2)} reward=${reward.toFixed(4)} realized_pnl=${realizedPnl.toFixed(4)} cash=${state.cash.toFixed(2)} positions=${state.portfolio.size}`);
        }

        if (learningEnabled) {
          const nextObs = buildObservation(state, nextPrices, symbol, signal, orderBook);
          state.agent.learn(reward, nextObs);
          state.agent.decay();
        }
      }

      // Record equity
      const equity = computeEquity(state, prices);
      state.equityHistory.push(equity);
    }
  }

  // ── Build CompetitionResult ──────────────────────────────────────────────

  private buildResult(
    competitionId: string,
    mode: string,
    agentStates: MarlAgentState[],
    prices: Map<string, number>,
    equitySnapshots: EquitySnapshot[],
    durationMs: number
  ): CompetitionResult {
    const rankings: FinalRanking[] = agentStates
      .map(state => {
        const finalCapital = computeEquity(state, prices);
        const totalReturn = (finalCapital - state.initialCapital) / state.initialCapital;
        const hist = state.equityHistory;
        const sharpe = this.calculateSharpeRatio(hist);
        const maxDrawdown = this.calculateMaxDrawdown(hist);
        const marlMetrics = state.agent.getMarLMetrics();
        const agentMetrics: AgentMetrics = state.agent.metrics;

        return {
          rank: 0,
          agentId: state.agentId,
          finalCapital,
          totalReturn,
          sharpeRatio: sharpe,
          maxDrawdown,
          tradesExecuted: marlMetrics.tradesExecuted,
          winRate: marlMetrics.winRate || agentMetrics.winRate,
        };
      })
      .sort((a, b) => b.totalReturn - a.totalReturn)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const headToHead = this.calculateHeadToHead(rankings);

    const competitorImpact: CompetitorImpact[] = agentStates.map(state => ({
      agentId: state.agentId,
      averageLiquidityImpact:
        state.impactStats.liquidityImpacts.length > 0
          ? state.impactStats.liquidityImpacts.reduce((s, v) => s + v, 0) /
            state.impactStats.liquidityImpacts.length
          : 0,
      timesOutbid: state.impactStats.timesOutbid,
      timesOutsold: state.impactStats.timesOutsold,
    }));

    return {
      competitionId,
      mode,
      duration: durationMs,
      finalRankings: rankings,
      headToHeadMetrics: headToHead,
      equityEvolution: equitySnapshots,
      competitorImpact,
    };
  }

  // ── Public: run competition (router entry point) ──────────────────────────

  async runCompetition(
    config: CompetitionConfig,
    onProgress?: (progress: number) => void,
    competitionId?: string
  ): Promise<CompetitionResult> {
    // Route to real-trading path when exchangeMode is PAPER or LIVE
    if (config.exchangeMode === 'PAPER' || config.exchangeMode === 'LIVE') {
      return this.runSingleTournamentReal(config, onProgress, competitionId);
    }
    switch (config.mode) {
      case 'EVOLUTIONARY':
        return this.runEvolutionaryTournament(config, onProgress, competitionId);
      case 'CONTINUOUS':
        return this.runContinuousLearning(config, onProgress, competitionId);
      default:
        return this.runSingleTournament(config, onProgress, competitionId);
    }
  }

  // ── SINGLE tournament ─────────────────────────────────────────────────────

  async runSingleTournament(
    config: CompetitionConfig,
    onProgress?: (progress: number) => void,
    competitionId = `comp_${Date.now()}`
  ): Promise<CompetitionResult> {
    const STEPS = Math.max(config.duration, 100);
    const SNAPSHOT_INTERVAL = Math.max(Math.floor(STEPS / 50), 1);

    const agentStates = config.agents.map(spec => this.createAgentState(spec));
    const orderBook = new SharedOrderBook();
    const equitySnapshots: EquitySnapshot[] = [];

    // Initialise base prices from live CoinGecko data
    const basePrices = await this.fetchBasePrices(config.symbols);
    const priceSeries = this.simulatePrices(config.symbols, STEPS, basePrices);

    for (let step = 0; step < STEPS; step++) {
      const prevPrices = priceSeries[Math.max(step - 1, 0)];
      const prices = priceSeries[step];
      const nextPrices = priceSeries[Math.min(step + 1, STEPS - 1)];

      this.runStep(agentStates, prevPrices, prices, nextPrices, config.symbols, step, orderBook, config.learningEnabled);

      if (step % SNAPSHOT_INTERVAL === 0) {
        equitySnapshots.push({
          timestamp: new Date(),
          agentEquities: agentStates.map(s => ({
            agentId: s.agentId,
            equity: computeEquity(s, prices),
          })),
        });
        onProgress?.(Math.round((step / STEPS) * 100));
      }
    }

    const finalPrices = priceSeries[STEPS - 1];
    this.persistLearningStates(agentStates);
    return this.buildResult(
      competitionId,
      'SINGLE',
      agentStates,
      finalPrices,
      equitySnapshots,
      config.duration
    );
  }

  // ── REAL / PAPER tournament (wall-clock setInterval) ─────────────────────

  async runSingleTournamentReal(
    config: CompetitionConfig,
    onProgress?: (progress: number) => void,
    competitionId = `comp_real_${Date.now()}`
  ): Promise<CompetitionResult> {
    const { brokerRegistry } = await import('./brokers/broker-registry.js');
    const { RiskGuard } = await import('./risk/risk-guard.js');
    const { DEFAULT_RISK_CONFIG } = await import('../types/broker.js');
    const { storage } = await import('../storage.js');
    const { randomUUID } = await import('node:crypto');

    const credentialId = config.brokerCredentialId;
    if (!credentialId) throw new Error('[marl] brokerCredentialId is required for PAPER/LIVE mode');

    const adapter = brokerRegistry.get(credentialId);
    if (!adapter) throw new Error(`[marl] no connected adapter for credentialId: ${credentialId}`);

    // Validate symbols against the broker
    const validSymbols = await adapter.validateSymbols(config.symbols);
    if (validSymbols.length === 0) throw new Error('[marl] no valid symbols for this broker');

    const riskGuard = new RiskGuard(config.riskConfig ?? DEFAULT_RISK_CONFIG);
    const agentStates = config.agents.map(spec => this.createAgentState(spec));
    const equitySnapshots: EquitySnapshot[] = [];

    // Seed live prices
    const initialPrices = await this.fetchBasePrices(validSymbols);
    let currentPrices = new Map(initialPrices);

    // Init risk guard with opening equity per agent
    for (const state of agentStates) {
      riskGuard.initAgent(state.agentId, computeEquity(state, currentPrices));
    }

    const durationMs   = config.duration * 1000;
    const intervalMs   = config.refreshInterval;
    const startTime    = Date.now();
    let stepCount      = 0;
    let emergencyStop  = false;

    logger.info('marl real tournament started', {
      competitionId,
      mode: config.exchangeMode,
      credentialId,
      symbols: validSymbols,
      durationMs,
      intervalMs,
    });

    await new Promise<void>((resolve) => {
      const tick = setInterval(async () => {
        try {
          const elapsed  = Date.now() - startTime;
          const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
          onProgress?.(progress);

          if (elapsed >= durationMs || emergencyStop) {
            clearInterval(tick);
            resolve();
            return;
          }

          // Fetch fresh prices from CoinGecko
          try {
            const fresh = await this.fetchBasePrices(validSymbols);
            currentPrices = fresh;
          } catch {
            // Keep last known prices on CoinGecko failure — non-fatal
          }

          for (const state of agentStates) {
            riskGuard.recordStepOpen(state.agentId, computeEquity(state, currentPrices));

            // Daily drawdown check
            if (riskGuard.checkDailyDrawdown(state.agentId, computeEquity(state, currentPrices))) {
              logger.warn('marl real: emergency stop triggered', { agentId: state.agentId, competitionId });
              emergencyStop = true;
              await adapter.cancelAllOrders(competitionId).catch(() => {});
              clearInterval(tick);
              resolve();
              return;
            }

            const symbol = validSymbols[stepCount % validSymbols.length];
            const price  = currentPrices.get(symbol) ?? 0;
            if (price === 0) continue;

            const sentimentSignal = {
              symbol,
              signal: 'BUY' as const,
              strength: 0.5,
              target_price_high: price * 1.05,
              target_price_low:  price * 0.97,
              stop_loss:         price * 0.95,
              reasoning:         'live market observation',
              risk_reward_ratio: 2,
            };

            const portfolioArr = Array.from(state.portfolio.values()).map(p => ({
              ...p,
              unrealizedPnl: (currentPrices.get(p.symbol) ?? p.avgPrice) * p.quantity - p.avgPrice * p.quantity,
            }));
            const equity = computeEquity(state, currentPrices);

            const observation: AgentObservation = {
              currentPrice:  price,
              bidAsk:        { bid: price * 0.9999, ask: price * 1.0001 },
              spreadBps:     2,
              portfolio:     portfolioArr,
              cash:          state.cash,
              equity,
              equityHistory: state.equityHistory.slice(-20),
              sentimentSignal,
              competitorOrders: [],
            };

            const action = state.agent.computeAction(observation);

            if (action.type === 'HOLD' || action.type === 'WAIT') continue;
            if (action.type !== 'BUY' && action.type !== 'SELL') continue;

            const pos = state.portfolio.get(symbol);
            if (action.type === 'SELL' && (!pos || pos.quantity <= 0)) continue;

            const quantity = action.type === 'BUY'
              ? Math.max(0.001, Math.min(action.quantity ?? 1, state.cash / price * 0.95))
              : Math.min(action.quantity ?? 1, pos?.quantity ?? 0);

            if (quantity <= 0) continue;

            const portfolioValue = portfolioArr.reduce((s, p) => s + p.quantity * (currentPrices.get(p.symbol) ?? p.avgPrice), 0);

            const riskResult = riskGuard.checkOrder({
              agentId:        state.agentId,
              symbol,
              side:           action.type,
              quantity,
              price,
              cash:           state.cash,
              portfolioValue,
            });

            if (!riskResult.approved) {
              logger.debug('marl real: order blocked by risk guard', { agentId: state.agentId, symbol, reason: riskResult.reason });
              continue;
            }

            const finalQty     = riskResult.adjustedQuantity ?? quantity;
            const clientOrderId = randomUUID();

            let placedOrder;
            try {
              placedOrder = await adapter.placeOrder({
                competitionId,
                agentId:       state.agentId,
                credentialId,
                clientOrderId,
                symbol,
                side:          action.type,
                quantity:      finalQty,
                limitPrice:    price,
              });
              try { storage.insertBrokerOrder(placedOrder); } catch { /* non-fatal */ }
            } catch (err) {
              logger.warn('marl real: order placement failed', { agentId: state.agentId, symbol, error: String(err) });
              continue;
            }

            // Poll for fill (up to 10s)
            const filled = await this.pollUntilFilled(adapter, clientOrderId, 10_000);
            if (filled) {
              try { storage.updateBrokerOrder(clientOrderId, filled); } catch { /* non-fatal */ }

              const fillPrice = filled.avgFillPrice;
              if (action.type === 'BUY') {
                state.cash -= filled.filledQuantity * fillPrice;
                const existing = state.portfolio.get(symbol);
                if (existing) {
                  const totalQty = existing.quantity + filled.filledQuantity;
                  existing.avgPrice = (existing.avgPrice * existing.quantity + fillPrice * filled.filledQuantity) / totalQty;
                  existing.quantity = totalQty;
                } else {
                  state.portfolio.set(symbol, { symbol, quantity: filled.filledQuantity, avgPrice: fillPrice });
                }
              } else {
                const existing = state.portfolio.get(symbol);
                if (existing) {
                  state.cash += filled.filledQuantity * fillPrice;
                  existing.quantity -= filled.filledQuantity;
                  if (existing.quantity <= 0) state.portfolio.delete(symbol);
                }
              }

              state.orderCounter += 1;

              if (config.learningEnabled) {
                const reward = action.type === 'BUY'
                  ? (price - fillPrice) / Math.max(fillPrice, 1)
                  : (fillPrice - (pos?.avgPrice ?? fillPrice)) / Math.max(pos?.avgPrice ?? fillPrice, 1);
                state.agent.learn(reward, observation);
              }
            }
          }

          // Snapshot equity every 10 ticks
          if (stepCount % 10 === 0) {
            equitySnapshots.push({
              timestamp: new Date(),
              agentEquities: agentStates.map(s => ({
                agentId: s.agentId,
                equity:  computeEquity(s, currentPrices),
              })),
            });
          }

          stepCount++;
        } catch (err) {
          logger.error('marl real: tick error', { competitionId, error: String(err) });
        }
      }, intervalMs);
    });

    this.persistLearningStates(agentStates);

    const openOrderCount = await adapter.cancelAllOrders(competitionId).catch(() => 0);
    if (openOrderCount > 0) {
      logger.info('marl real: cancelled remaining open orders', { competitionId, count: openOrderCount });
    }

    return this.buildResult(competitionId, 'SINGLE', agentStates, currentPrices, equitySnapshots, config.duration);
  }

  /** Poll an order until it reaches a terminal status or the timeout elapses. */
  private async pollUntilFilled(
    adapter: { pollOrderStatus: (id: string) => Promise<{ status: string; filledQuantity: number; avgFillPrice: number; brokerOrderId?: string }>; cancelOrder: (id: string) => Promise<boolean> },
    clientOrderId: string,
    timeoutMs: number,
  ): Promise<{ status: string; filledQuantity: number; avgFillPrice: number; brokerOrderId?: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const s = await adapter.pollOrderStatus(clientOrderId);
        if (s.status === 'FILLED' || s.status === 'PARTIALLY_FILLED') return s;
        if (s.status === 'CANCELLED' || s.status === 'REJECTED') return null;
      } catch { break; }
    }
    await adapter.cancelOrder(clientOrderId).catch(() => {});
    return null;
  }

  // ── EVOLUTIONARY tournament ───────────────────────────────────────────────

  async runEvolutionaryTournament(
    config: CompetitionConfig,
    onProgress?: (progress: number) => void,
    competitionId = `comp_evo_${Date.now()}`
  ): Promise<CompetitionResult> {
    const rounds = config.evolutionaryRounds ?? 3;
    const stepsPerRound = Math.max(Math.floor(config.duration / rounds), 50);
    const basePrices = await this.fetchBasePrices(config.symbols);

    let population = config.agents.map(spec => this.createAgentState(spec));
    const allEquitySnapshots: EquitySnapshot[] = [];
    let finalRoundStates = population;

    for (let round = 0; round < rounds; round++) {
      const orderBook = new SharedOrderBook();
      const priceSeries = this.simulatePrices(config.symbols, stepsPerRound, basePrices);

      for (let step = 0; step < stepsPerRound; step++) {
        const prevPrices = priceSeries[Math.max(step - 1, 0)];
        const prices = priceSeries[step];
        const nextPrices = priceSeries[Math.min(step + 1, stepsPerRound - 1)];
        this.runStep(population, prevPrices, prices, nextPrices, config.symbols, step, orderBook, config.learningEnabled);

        if (step % Math.max(Math.floor(stepsPerRound / 10), 1) === 0) {
          allEquitySnapshots.push({
            timestamp: new Date(),
            agentEquities: population.map(s => ({
              agentId: `${s.agentId}_r${round}`,
              equity: computeEquity(s, prices),
            })),
          });
        }
      }

      const finalPrices = priceSeries[stepsPerRound - 1];
      const sorted = population
        .map(s => ({ state: s, equity: computeEquity(s, finalPrices) }))
        .sort((a, b) => b.equity - a.equity);
      finalRoundStates = sorted.map(entry => entry.state);

      const survivors = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));

      if (round < rounds - 1) {
        const survivorStates = survivors.map(entry => entry.state);
        const nextPopulation = survivorStates.map(entry => {
          const spec = config.agents.find(agent => agent.id === entry.agentId) ?? {
            id: entry.agentId,
            riskProfile: entry.agent.riskProfile,
          };

          return this.createAgentState(spec, entry.initialCapital, entry.agent.exportLearningState());
        });

        const targetSize = config.agents.length;
        while (nextPopulation.length < targetSize) {
          const parent = survivorStates[nextPopulation.length % survivorStates.length];
          const parentSpec = config.agents.find(agent => agent.id === parent.agentId) ?? {
            id: parent.agentId,
            riskProfile: parent.agent.riskProfile,
          };
          nextPopulation.push(
            this.createAgentState(
              {
                id: `${parentSpec.id}_mutant_${round}_${nextPopulation.length - survivorStates.length}`,
                riskProfile: parentSpec.riskProfile,
              },
              parent.initialCapital,
              parent.agent.exportLearningState(),
              0.05
            )
          );
        }

        population = nextPopulation;
      }

      onProgress?.(Math.round(((round + 1) / rounds) * 100));
    }

    const finalBasePrices = new Map<string, number>(
      config.symbols.map(sym => [sym, basePrices.get(sym) ?? 1000])
    );
    this.persistLearningStates(finalRoundStates);
    return this.buildResult(
      competitionId,
      'EVOLUTIONARY',
      finalRoundStates,
      finalBasePrices,
      allEquitySnapshots,
      config.duration
    );
  }

  // ── CONTINUOUS learning ───────────────────────────────────────────────────

  async runContinuousLearning(
    config: CompetitionConfig,
    onProgress?: (progress: number) => void,
    competitionId = `comp_cont_${Date.now()}`
  ): Promise<CompetitionResult> {
    const HOURS = Math.max(Math.floor(config.duration / 3600), 1);
    const STEPS_PER_HOUR = 60;
    const totalSteps = HOURS * STEPS_PER_HOUR;

    const agentStates = config.agents.map(spec => this.createAgentState(spec));
    const orderBook = new SharedOrderBook();
    const allSnapshots: EquitySnapshot[] = [];
    const basePrices = await this.fetchBasePrices(config.symbols);
    const priceSeries = this.simulatePrices(config.symbols, totalSteps, basePrices);

    for (let hour = 0; hour < HOURS; hour++) {
      const offset = hour * STEPS_PER_HOUR;

      // Trade phase
      for (let step = 0; step < STEPS_PER_HOUR; step++) {
        const i = offset + step;
        const prevPrices = priceSeries[Math.max(i - 1, 0)];
        const prices = priceSeries[i];
        const nextPrices = priceSeries[Math.min(i + 1, totalSteps - 1)];
        this.runStep(agentStates, prevPrices, prices, nextPrices, config.symbols, i, orderBook, true);
      }

      // Learning phase: replay 100 experiences
      for (const state of agentStates) {
        state.agent.replayExperiences(100);
      }

      allSnapshots.push({
        timestamp: new Date(),
        agentEquities: agentStates.map(s => ({
          agentId: s.agentId,
          equity: computeEquity(s, priceSeries[offset + STEPS_PER_HOUR - 1]),
        })),
      });
      onProgress?.(Math.round(((hour + 1) / HOURS) * 100));
    }

    const finalPrices = priceSeries[totalSteps - 1];
    this.persistLearningStates(agentStates);
    return this.buildResult(
      competitionId,
      'CONTINUOUS',
      agentStates,
      finalPrices,
      allSnapshots,
      config.duration
    );
  }

  // ── Analytics helpers ─────────────────────────────────────────────────────

  calculateSharpeRatio(equityHistory: number[]): number {
    if (equityHistory.length < 3) return 0;
    const returns: number[] = [];
    for (let i = 1; i < equityHistory.length; i++) {
      if (equityHistory[i - 1] > 0) {
        returns.push((equityHistory[i] - equityHistory[i - 1]) / equityHistory[i - 1]);
      }
    }
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  calculateMaxDrawdown(equityHistory: number[]): number {
    let peak = equityHistory[0] ?? 0;
    let maxDD = 0;
    for (const equity of equityHistory) {
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  }

  calculateHeadToHead(rankings: FinalRanking[]): HeadToHeadMetric[] {
    const metrics: HeadToHeadMetric[] = [];
    for (let i = 0; i < rankings.length; i++) {
      for (let j = i + 1; j < rankings.length; j++) {
        const a = rankings[i];
        const b = rankings[j];
        metrics.push({
          agent1: a.agentId,
          agent2: b.agentId,
          agent1Return: a.totalReturn,
          agent2Return: b.totalReturn,
          winner: a.totalReturn >= b.totalReturn ? a.agentId : b.agentId,
        });
      }
    }
    return metrics;
  }

  // ── Learning state management (public) ───────────────────────────────────

  /**
   * List all agent learning states held in the process-level cache.
   * Used by `GET /api/marl/agents/learning`.
   */
  listLearningStates(): Array<{ cacheKey: string; agentId: string; riskProfile: string }> {
    return Array.from(MarlCompetitionEngine.learningStateCache.keys()).map(key => {
      const [agentId, riskProfile] = key.split('::');
      return { cacheKey: key, agentId: agentId ?? key, riskProfile: riskProfile ?? 'UNKNOWN' };
    });
  }

  /**
   * Clear learned state for one agent (optionally filtered to a single riskProfile).
   * Removes from both the in-process cache and SQLite.
   * Returns the number of cache keys actually cleared.
   */
  clearAgentLearningState(agentId: string, riskProfile?: string): number {
    const profiles: Array<'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING'> = riskProfile
      ? [riskProfile as 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING']
      : ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'];

    let cleared = 0;
    for (const profile of profiles) {
      const key = this.getLearningCacheKey({ id: agentId, riskProfile: profile });
      if (MarlCompetitionEngine.learningStateCache.delete(key)) cleared++;
      try { storage.deleteAgentLearningState(key); } catch { /* DB unavailable */ }
    }
    return cleared;
  }

  // ── Result store ──────────────────────────────────────────────────────────

  storeRecord(record: CompetitionRecord): void {
    this.results.set(record.competitionId, record);
  }

  updateRecord(competitionId: string, updates: Partial<CompetitionRecord>): void {
    const existing = this.results.get(competitionId);
    if (existing) this.results.set(competitionId, { ...existing, ...updates });
  }

  getRecord(competitionId: string): CompetitionRecord | undefined {
    return this.results.get(competitionId);
  }

  getAllRecords(): CompetitionRecord[] {
    return Array.from(this.results.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }
}
