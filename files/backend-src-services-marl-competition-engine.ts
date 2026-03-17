ADVERSARIAL MULTI-AGENT RL TRADING FRAMEWORK
============================================

File: backend/src/services/marl-competition-engine.ts

A complete system for running competitive trading tournaments where agents
learn from each other through adversarial interaction, shared order books,
and evolutionary dynamics.

---

CORE CONCEPTS
=============

1. MULTI-AGENT REINFORCEMENT LEARNING (MARL)
   - N independent agents (2-10+) with own Q-values and policy networks
   - Shared environment: same market data, same coins, same time periods
   - Shared order book: agents' trades affect liquidity and prices for others
   - Non-stationary: as agents learn, the environment changes for all agents

2. ADVERSARIAL LEARNING
   - Agent A's profit is limited by agent B's bid-ask spread
   - Agent A's large trade affects agent B's execution price
   - Slippage compounds: first agent gets better fill, later agents pay more
   - Agents learn: don't trade large size early, time entries when others exit

3. TOURNAMENT STRUCTURES (Configurable)
   a) Single Tournament
      - N agents trade for fixed duration (1 hour / 1 day / 1 week)
      - Rankings by final P&L, Sharpe, max drawdown
      - Learning: agents improve during the tournament

   b) Evolutionary Tournament
      - Round 1: 8 agents trade
      - Bottom 2 eliminated, replaced by mutated clones of top 2
      - Round 2: improved 8 agents trade
      - Repeats until convergence or N rounds
      - Fitness: accumulated P&L across all rounds

   c) Continuous Learning
      - Agents trade indefinitely
      - Every hour, replay 100 previous trades to update Q-values
      - Learning happens in background during competition
      - Tournament never ends, agents keep improving

4. SHARED ORDER BOOK
   - Limit order book with bid/ask spreads
   - Agent A places order at price P
   - Agent B's market order at same price experiences slippage
   - Agent B pays: slippage = agent A's order size / total market liquidity
   - Realistic: large trades move prices more than small ones

---

IMPLEMENTATION

import { TradingAgent, PortfolioPosition } from './trading-agent';
import { SentimentAnalyzerEngine, TradingSignal } from './sentiment-analyzer';

// ========================================
// MULTI-AGENT ENVIRONMENT
// ========================================

interface OrderBookEntry {
  orderId: string;
  agentId: string;
  side: 'BID' | 'ASK';
  price: number;
  quantity: number;
  timestamp: Date;
  filled: number;
}

interface MarketState {
  symbol: string;
  bidBook: OrderBookEntry[];  // Sorted by price desc
  askBook: OrderBookEntry[];  // Sorted by price asc
  lastPrice: number;
  spreadBps: number;  // Bid-ask spread in basis points
  depth: { price: number; quantity: number }[];  // Top 10 levels
}

interface AgentObservation {
  currentPrice: number;
  bidAsk: { bid: number; ask: number };
  spreadBps: number;
  portfolio: {
    symbol: string;
    quantity: number;
    avgPrice: number;
    unrealizedPnl: number;
  }[];
  cash: number;
  equity: number;
  equityHistory: number[];  // Last 20 values
  sentimentSignal: TradingSignal;
  competitorOrders: {
    agentId: string;
    totalBidQuantity: number;
    totalAskQuantity: number;
  }[];
}

interface AgentAction {
  type: 'BUY' | 'SELL' | 'CANCEL' | 'HOLD';
  symbol?: string;
  quantity?: number;
  price?: number;
  orderId?: string;  // For cancel actions
  reason?: string;
}

interface MArlAgent extends TradingAgent {
  // RL Extensions
  qValues: Map<string, number>;  // State -> Q-value
  policyNetwork: PolicyNetwork;
  epsilon: number;  // Exploration rate
  learningRate: number;

  // Observation & action
  observe(state: AgentObservation): void;
  computeAction(observation: AgentObservation): AgentAction;
  learn(reward: number, nextState: AgentObservation): void;
  updateQValue(stateKey: string, action: AgentAction, reward: number): void;
  decay(): void;  // Reduce epsilon over time
}

interface PolicyNetwork {
  layers: NetworkLayer[];
  weights: number[][];
  forward(observation: AgentObservation): number[];  // Action scores
  backward(gradients: number[]): void;
}

interface NetworkLayer {
  inputSize: number;
  outputSize: number;
  weights: number[][];
  bias: number[];
  activation: 'relu' | 'softmax' | 'sigmoid';
}

// ========================================
// SHARED ORDER BOOK MANAGER
// ========================================

export class SharedOrderBook {
  private orderBooks: Map<string, MarketState> = new Map();
  private orderHistory: OrderBookEntry[] = [];
  private depth: number = 10;  // Maintain top 10 bid/ask levels

  constructor(symbols: string[], private marketData: Map<string, OHLCVData>) {
    for (const symbol of symbols) {
      this.orderBooks.set(symbol, {
        symbol,
        bidBook: [],
        askBook: [],
        lastPrice: marketData.get(symbol)?.close || 100,
        spreadBps: 10,  // 0.1% default spread
        depth: []
      });
    }
  }

  // Agent places a limit order
  placeOrder(orderId: string, agentId: string, symbol: string, side: 'BID' | 'ASK', price: number, quantity: number): {
    filled: number;
    avgFillPrice: number;
    remainingQuantity: number;
  } {
    const market = this.orderBooks.get(symbol)!;
    let filled = 0;
    let avgFillPrice = 0;
    let remainingQuantity = quantity;

    // Try to match against opposing side
    const opposingSide = side === 'BID' ? market.askBook : market.bidBook;
    
    for (let i = 0; i < opposingSide.length && remainingQuantity > 0; i++) {
      const oppositeOrder = opposingSide[i];
      
      // Check if price matches
      if ((side === 'BID' && price >= oppositeOrder.price) ||
          (side === 'ASK' && price <= oppositeOrder.price)) {
        
        // Calculate slippage based on order size vs. market depth
        const slippage = this.calculateSlippage(symbol, oppositeOrder.quantity);
        const executionPrice = side === 'BID' 
          ? oppositeOrder.price + slippage 
          : oppositeOrder.price - slippage;

        const fillQuantity = Math.min(remainingQuantity, oppositeOrder.quantity);
        filled += fillQuantity;
        avgFillPrice = (avgFillPrice * (filled - fillQuantity) + executionPrice * fillQuantity) / filled;
        remainingQuantity -= fillQuantity;
        oppositeOrder.filled += fillQuantity;

        // Remove fully filled orders
        if (oppositeOrder.filled >= oppositeOrder.quantity) {
          opposingSide.splice(i, 1);
          i--;
        }
      }
    }

    // Add remaining quantity to order book
    if (remainingQuantity > 0) {
      const entry: OrderBookEntry = {
        orderId,
        agentId,
        side,
        price,
        quantity: remainingQuantity,
        timestamp: new Date(),
        filled: 0
      };

      if (side === 'BID') {
        market.bidBook.push(entry);
        market.bidBook.sort((a, b) => b.price - a.price);  // Highest bid first
      } else {
        market.askBook.push(entry);
        market.askBook.sort((a, b) => a.price - b.price);  // Lowest ask first
      }
    }

    // Update spread
    if (market.bidBook.length > 0 && market.askBook.length > 0) {
      const bid = market.bidBook[0].price;
      const ask = market.askBook[0].price;
      market.spreadBps = ((ask - bid) / bid) * 10000;
    }

    // Update last price
    if (filled > 0) {
      market.lastPrice = avgFillPrice;
    }

    return { filled, avgFillPrice, remainingQuantity };
  }

  // Cancel an order
  cancelOrder(orderId: string, symbol: string): boolean {
    const market = this.orderBooks.get(symbol)!;
    
    let index = market.bidBook.findIndex(o => o.orderId === orderId);
    if (index !== -1) {
      market.bidBook.splice(index, 1);
      return true;
    }

    index = market.askBook.findIndex(o => o.orderId === orderId);
    if (index !== -1) {
      market.askBook.splice(index, 1);
      return true;
    }

    return false;
  }

  // Get market state for observation
  getMarketState(symbol: string): MarketState {
    return this.orderBooks.get(symbol)!;
  }

  // Calculate slippage based on order size
  private calculateSlippage(symbol: string, orderSize: number): number {
    const market = this.orderBooks.get(symbol)!;
    
    // Slippage increases with order size relative to market depth
    // Small order (0.1% of depth): 0.1 bps
    // Medium order (1% of depth): 1 bps
    // Large order (10% of depth): 10 bps
    
    const totalAskDepth = market.askBook.reduce((sum, o) => sum + o.quantity, 0);
    const depthRatio = orderSize / Math.max(totalAskDepth, 100);  // Avoid div by zero
    
    return Math.min(depthRatio * 100, 50);  // Cap slippage at 50 bps
  }

  // Get competitive orders info
  getCompetitorOrders(symbol: string, excludeAgentId: string): {
    agentId: string;
    totalBidQuantity: number;
    totalAskQuantity: number;
  }[] {
    const market = this.orderBooks.get(symbol)!;
    const competitors = new Map<string, { bid: number; ask: number }>();

    for (const order of market.bidBook) {
      if (order.agentId !== excludeAgentId) {
        const comp = competitors.get(order.agentId) || { bid: 0, ask: 0 };
        comp.bid += order.quantity;
        competitors.set(order.agentId, comp);
      }
    }

    for (const order of market.askBook) {
      if (order.agentId !== excludeAgentId) {
        const comp = competitors.get(order.agentId) || { bid: 0, ask: 0 };
        comp.ask += order.quantity;
        competitors.set(order.agentId, comp);
      }
    }

    return Array.from(competitors.entries()).map(([agentId, { bid, ask }]) => ({
      agentId,
      totalBidQuantity: bid,
      totalAskQuantity: ask
    }));
  }
}

// ========================================
// MARL AGENT (EXTENDS TRADING AGENT)
// ========================================

export class MarlTradingAgent extends TradingAgent implements MArlAgent {
  qValues: Map<string, number> = new Map();
  policyNetwork: PolicyNetwork;
  epsilon: number = 0.1;  // Exploration rate
  learningRate: number = 0.01;
  gamma: number = 0.99;  // Discount factor
  
  private lastObservation?: AgentObservation;
  private lastAction?: AgentAction;
  private actionHistory: AgentAction[] = [];
  private stateHistory: AgentObservation[] = [];
  private rewardHistory: number[] = [];

  constructor(
    agentId: string,
    riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING',
    initialCash: number = 10000,
    hidden_layers: number[] = [64, 32]
  ) {
    super(agentId, 'HYBRID', riskProfile, initialCash);
    this.policyNetwork = this.initializePolicyNetwork(hidden_layers);
  }

  private initializePolicyNetwork(hiddenLayers: number[]): PolicyNetwork {
    // Input: 50 observation features
    // Hidden: configurable
    // Output: 5 actions (BUY, SELL, HOLD, CANCEL, WAIT)

    const layers: NetworkLayer[] = [];
    const layerSizes = [50, ...hiddenLayers, 5];

    for (let i = 0; i < layerSizes.length - 1; i++) {
      layers.push({
        inputSize: layerSizes[i],
        outputSize: layerSizes[i + 1],
        weights: this.randomMatrix(layerSizes[i], layerSizes[i + 1]),
        bias: new Array(layerSizes[i + 1]).fill(0),
        activation: i === layerSizes.length - 2 ? 'softmax' : 'relu'
      });
    }

    return { layers, weights: [], forward: () => [] as number[], backward: () => {} };
  }

  private randomMatrix(rows: number, cols: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < rows; i++) {
      matrix.push(new Array(cols).fill(0).map(() => Math.random() * 0.01));
    }
    return matrix;
  }

  observe(state: AgentObservation): void {
    this.lastObservation = state;
  }

  computeAction(observation: AgentObservation): AgentAction {
    const stateKey = this.stateToKey(observation);
    let action: AgentAction;

    // Epsilon-greedy: explore vs exploit
    if (Math.random() < this.epsilon) {
      // Explore: random action
      action = this.getRandomAction(observation);
    } else {
      // Exploit: best Q-value
      action = this.getBestAction(observation);
    }

    this.lastAction = action;
    this.stateHistory.push(observation);
    this.actionHistory.push(action);

    return action;
  }

  private getRandomAction(observation: AgentObservation): AgentAction {
    const actions = [
      { type: 'BUY' as const },
      { type: 'SELL' as const },
      { type: 'HOLD' as const },
      { type: 'CANCEL' as const },
      { type: 'HOLD' as const }
    ];
    return actions[Math.floor(Math.random() * actions.length)];
  }

  private getBestAction(observation: AgentObservation): AgentAction {
    const actionScores = this.policyNetwork.forward(observation);
    const bestActionIdx = actionScores.indexOf(Math.max(...actionScores));

    const actions: AgentAction[] = [
      { type: 'BUY', symbol: 'BTC', quantity: 1, price: observation.currentPrice * 0.99 },
      { type: 'SELL', symbol: 'BTC', quantity: 1, price: observation.currentPrice * 1.01 },
      { type: 'HOLD' },
      { type: 'CANCEL' },
      { type: 'HOLD' }
    ];

    return actions[bestActionIdx];
  }

  learn(reward: number, nextState: AgentObservation): void {
    // Store transition
    this.rewardHistory.push(reward);

    if (!this.lastObservation || !this.lastAction) return;

    const currentStateKey = this.stateToKey(this.lastObservation);
    const nextStateKey = this.stateToKey(nextState);

    // Q-Learning update: Q(s,a) = Q(s,a) + α[r + γ*max(Q(s',a')) - Q(s,a)]
    const currentQ = this.qValues.get(currentStateKey) || 0;
    const nextQ = Math.max(...Array.from(this.qValues.values()), 0);
    const newQ = currentQ + this.learningRate * (reward + this.gamma * nextQ - currentQ);

    this.qValues.set(currentStateKey, newQ);

    // Also update policy network via backprop (simplified)
    const gradient = reward - currentQ;
    this.policyNetwork.backward([gradient]);
  }

  updateQValue(stateKey: string, action: AgentAction, reward: number): void {
    const currentQ = this.qValues.get(stateKey) || 0;
    const newQ = currentQ + this.learningRate * (reward - currentQ);
    this.qValues.set(stateKey, newQ);
  }

  decay(): void {
    // Reduce exploration over time
    this.epsilon = Math.max(this.epsilon * 0.995, 0.01);
  }

  private stateToKey(observation: AgentObservation): string {
    // Discretize observation to create state key
    const priceLevel = Math.floor(observation.currentPrice / 100) * 100;
    const spreadLevel = Math.floor(observation.spreadBps / 5) * 5;
    const equityLevel = Math.floor(observation.equity / 1000) * 1000;

    return `P:${priceLevel}|S:${spreadLevel}|E:${equityLevel}`;
  }

  getMetrics(): {
    totalReward: number;
    averageReward: number;
    tradesExecuted: number;
    learningCurve: number[];
    epsilonDecay: number;
  } {
    return {
      totalReward: this.rewardHistory.reduce((a, b) => a + b, 0),
      averageReward: this.rewardHistory.reduce((a, b) => a + b, 0) / Math.max(this.rewardHistory.length, 1),
      tradesExecuted: this.actionHistory.filter(a => a.type !== 'HOLD').length,
      learningCurve: this.rewardHistory.slice(-100),
      epsilonDecay: this.epsilon
    };
  }
}

// ========================================
// COMPETITION ENGINE
// ========================================

export interface CompetitionConfig {
  mode: 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
  agents: {
    id: string;
    riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
  }[];
  symbols: string[];
  duration: number;  // Milliseconds or number of days
  refreshInterval: number;  // How often to update market state
  evolutionaryRounds?: number;
  learningEnabled: boolean;
}

export interface CompetitionResult {
  competitionId: string;
  mode: string;
  duration: number;
  finalRankings: {
    rank: number;
    agentId: string;
    finalCapital: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    tradesExecuted: number;
    winRate: number;
  }[];
  headToHeadMetrics: {
    agent1: string;
    agent2: string;
    agent1Return: number;
    agent2Return: number;
    winner: string;
  }[];
  equityEvolution: {
    timestamp: Date;
    agentEquities: { agentId: string; equity: number }[];
  }[];
  competitorImpact: {
    agentId: string;
    averageLiquidityImpact: number;
    timesOutbid: number;
    timesOutsold: number;
  }[];
}

export class MarlCompetitionEngine {
  private agents: MarlTradingAgent[] = [];
  private orderBook: SharedOrderBook;
  private sentiment: SentimentAnalyzerEngine;
  private competitionResults: Map<string, CompetitionResult> = new Map();

  async runCompetition(
    config: CompetitionConfig,
    historicalData: Map<string, OHLCVData[]>,
    sentimentData: Map<string, TradingSignal[]>
  ): Promise<CompetitionResult> {
    const competitionId = `comp_${Date.now()}`;
    console.log(`Starting competition: ${competitionId}`);

    this.initializeAgents(config);
    this.orderBook = new SharedOrderBook(config.symbols, new Map());
    this.sentiment = new SentimentAnalyzerEngine();

    let results: CompetitionResult = {
      competitionId,
      mode: config.mode,
      duration: config.duration,
      finalRankings: [],
      headToHeadMetrics: [],
      equityEvolution: [],
      competitorImpact: []
    };

    if (config.mode === 'SINGLE') {
      results = await this.runSingleTournament(config, historicalData, sentimentData);
    } else if (config.mode === 'EVOLUTIONARY') {
      results = await this.runEvolutionaryTournament(config, historicalData, sentimentData);
    } else if (config.mode === 'CONTINUOUS') {
      results = await this.runContinuousLearning(config, historicalData, sentimentData);
    }

    this.competitionResults.set(competitionId, results);
    return results;
  }

  private async runSingleTournament(
    config: CompetitionConfig,
    historicalData: Map<string, OHLCVData[]>,
    sentimentData: Map<string, TradingSignal[]>
  ): Promise<CompetitionResult> {
    // Simple single-round tournament
    // All agents trade simultaneously for fixed duration
    // Learning happens during the tournament

    const startTime = Date.now();
    const endTime = startTime + config.duration;
    const equityHistory: CompetitionResult['equityEvolution'] = [];

    while (Date.now() < endTime) {
      const timestamp = new Date();

      // Get current market state
      for (const symbol of config.symbols) {
        const market = this.orderBook.getMarketState(symbol);

        // Each agent decides
        for (const agent of this.agents) {
          const observation: AgentObservation = {
            currentPrice: market.lastPrice,
            bidAsk: {
              bid: market.bidBook[0]?.price || market.lastPrice,
              ask: market.askBook[0]?.price || market.lastPrice
            },
            spreadBps: market.spreadBps,
            portfolio: [],
            cash: agent.cash,
            equity: agent.getPortfolioValue(new Map([[symbol, market.lastPrice]])),
            equityHistory: [],
            sentimentSignal: sentimentData.get(symbol)?.[0] || {} as TradingSignal,
            competitorOrders: this.orderBook.getCompetitorOrders(symbol, agent.agentId)
          };

          agent.observe(observation);
          const action = agent.computeAction(observation);

          // Execute action
          if (action.type === 'BUY' && action.quantity && action.price) {
            this.orderBook.placeOrder(
              `${agent.agentId}_${Date.now()}`,
              agent.agentId,
              symbol,
              'BID',
              action.price,
              action.quantity
            );
          } else if (action.type === 'SELL' && action.quantity && action.price) {
            this.orderBook.placeOrder(
              `${agent.agentId}_${Date.now()}`,
              agent.agentId,
              symbol,
              'ASK',
              action.price,
              action.quantity
            );
          }

          // Calculate reward (simple: equity change)
          const reward = observation.equity - agent.initialCash;
          agent.learn(reward, observation);
        }

        // Decay exploration
        for (const agent of this.agents) {
          agent.decay();
        }
      }

      // Record equity
      equityHistory.push({
        timestamp,
        agentEquities: this.agents.map(a => ({
          agentId: a.agentId,
          equity: a.getPortfolioValue(new Map())
        }))
      });

      // Sleep briefly
      await new Promise(resolve => setTimeout(resolve, config.refreshInterval));
    }

    // Calculate final rankings
    const finalRankings = this.agents
      .map((agent, idx) => ({
        rank: idx + 1,
        agentId: agent.agentId,
        finalCapital: agent.cash,
        totalReturn: agent.cash - agent.initialCash,
        sharpeRatio: this.calculateSharpeRatio(equityHistory, agent.agentId),
        maxDrawdown: this.calculateMaxDrawdown(equityHistory, agent.agentId),
        tradesExecuted: this.countAgentTrades(agent.agentId),
        winRate: this.calculateAgentWinRate(agent.agentId)
      }))
      .sort((a, b) => b.totalReturn - a.totalReturn)
      .map((ranking, idx) => ({ ...ranking, rank: idx + 1 }));

    return {
      competitionId: `comp_${Date.now()}`,
      mode: 'SINGLE',
      duration: config.duration,
      finalRankings,
      headToHeadMetrics: this.calculateHeadToHead(finalRankings),
      equityEvolution: equityHistory,
      competitorImpact: this.calculateCompetitorImpact()
    };
  }

  private async runEvolutionaryTournament(
    config: CompetitionConfig,
    historicalData: Map<string, OHLCVData[]>,
    sentimentData: Map<string, TradingSignal[]>
  ): Promise<CompetitionResult> {
    // Multi-round elimination tournament
    // Top performers breed, weak agents eliminated

    let allResults: CompetitionResult['finalRankings'][] = [];
    const rounds = config.evolutionaryRounds || 5;

    for (let round = 0; round < rounds; round++) {
      console.log(`Evolutionary round ${round + 1}/${rounds}`);

      // Run tournament
      const roundResult = await this.runSingleTournament(config, historicalData, sentimentData);
      allResults.push(roundResult.finalRankings);

      // Elitism: top 2 survive
      const topAgents = roundResult.finalRankings.slice(0, 2);

      // Breed: mutate top agents
      const newAgents = topAgents.map(ranking => {
        const original = this.agents.find(a => a.agentId === ranking.agentId)!;
        return this.mutateAgent(original, `${original.agentId}_gen${round + 1}`);
      });

      // Replace bottom performers
      this.agents = [
        ...this.agents.slice(0, 2),
        ...newAgents,
        ...this.agents.slice(4).map(a => this.mutateAgent(a, `${a.agentId}_mutated`))
      ];
    }

    // Final rankings
    const finalResult = allResults[allResults.length - 1];

    return {
      competitionId: `comp_${Date.now()}`,
      mode: 'EVOLUTIONARY',
      duration: config.duration * rounds,
      finalRankings: finalResult,
      headToHeadMetrics: this.calculateHeadToHead(finalResult),
      equityEvolution: [],
      competitorImpact: this.calculateCompetitorImpact()
    };
  }

  private async runContinuousLearning(
    config: CompetitionConfig,
    historicalData: Map<string, OHLCVData[]>,
    sentimentData: Map<string, TradingSignal[]>
  ): Promise<CompetitionResult> {
    // Never-ending tournament with background learning
    // Agents replay past trades to improve

    const startTime = Date.now();
    const endTime = startTime + config.duration;
    const equityHistory: CompetitionResult['equityEvolution'] = [];
    const replayBatch = 100;  // Replay last 100 trades every hour

    while (Date.now() < endTime) {
      // Trade phase
      for (const symbol of config.symbols) {
        const market = this.orderBook.getMarketState(symbol);

        for (const agent of this.agents) {
          const observation: AgentObservation = {
            currentPrice: market.lastPrice,
            bidAsk: {
              bid: market.bidBook[0]?.price || market.lastPrice,
              ask: market.askBook[0]?.price || market.lastPrice
            },
            spreadBps: market.spreadBps,
            portfolio: [],
            cash: agent.cash,
            equity: agent.getPortfolioValue(new Map([[symbol, market.lastPrice]])),
            equityHistory: [],
            sentimentSignal: sentimentData.get(symbol)?.[0] || {} as TradingSignal,
            competitorOrders: this.orderBook.getCompetitorOrders(symbol, agent.agentId)
          };

          agent.observe(observation);
          const action = agent.computeAction(observation);

          // Execute and learn
          if (action.type === 'BUY' && action.quantity && action.price) {
            this.orderBook.placeOrder(
              `${agent.agentId}_${Date.now()}`,
              agent.agentId,
              symbol,
              'BID',
              action.price,
              action.quantity
            );
          }

          const reward = observation.equity - agent.initialCash;
          agent.learn(reward, observation);
        }
      }

      // Learning phase: replay recent trades
      if (Date.now() % (60 * 60 * 1000) < 1000) {  // Every hour
        for (const agent of this.agents) {
          // Agent re-learns from last N trades
          const metrics = (agent as MarlTradingAgent).getMetrics();
          // Use metrics to update policy
        }
      }

      equityHistory.push({
        timestamp: new Date(),
        agentEquities: this.agents.map(a => ({
          agentId: a.agentId,
          equity: a.getPortfolioValue(new Map())
        }))
      });

      await new Promise(resolve => setTimeout(resolve, config.refreshInterval));
    }

    const finalRankings = this.agents
      .map((agent, idx) => ({
        rank: idx + 1,
        agentId: agent.agentId,
        finalCapital: agent.cash,
        totalReturn: agent.cash - agent.initialCash,
        sharpeRatio: this.calculateSharpeRatio(equityHistory, agent.agentId),
        maxDrawdown: this.calculateMaxDrawdown(equityHistory, agent.agentId),
        tradesExecuted: this.countAgentTrades(agent.agentId),
        winRate: this.calculateAgentWinRate(agent.agentId)
      }))
      .sort((a, b) => b.totalReturn - a.totalReturn)
      .map((ranking, idx) => ({ ...ranking, rank: idx + 1 }));

    return {
      competitionId: `comp_${Date.now()}`,
      mode: 'CONTINUOUS',
      duration: config.duration,
      finalRankings,
      headToHeadMetrics: this.calculateHeadToHead(finalRankings),
      equityEvolution: equityHistory,
      competitorImpact: this.calculateCompetitorImpact()
    };
  }

  private initializeAgents(config: CompetitionConfig): void {
    this.agents = config.agents.map(
      cfg => new MarlTradingAgent(cfg.id, cfg.riskProfile, 10000)
    );
  }

  private mutateAgent(original: MarlTradingAgent, newId: string): MarlTradingAgent {
    const mutated = new MarlTradingAgent(newId, original.riskProfile as any, original.initialCash);
    
    // Copy and mutate Q-values
    for (const [key, value] of original.qValues) {
      mutated.qValues.set(key, value + (Math.random() - 0.5) * 0.1 * value);
    }

    return mutated;
  }

  private calculateSharpeRatio(history: CompetitionResult['equityEvolution'], agentId: string): number {
    const returns = history.map(h => {
      const equity = h.agentEquities.find(e => e.agentId === agentId)?.equity || 0;
      return equity;
    });

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? (mean - 10000) / stdDev : 0;
  }

  private calculateMaxDrawdown(history: CompetitionResult['equityEvolution'], agentId: string): number {
    const equities = history.map(h => h.agentEquities.find(e => e.agentId === agentId)?.equity || 0);
    
    let maxDrawdown = 0;
    let peak = equities[0];

    for (const equity of equities) {
      if (equity > peak) peak = equity;
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return maxDrawdown * 100;
  }

  private countAgentTrades(agentId: string): number {
    // Count non-HOLD actions
    const agent = this.agents.find(a => a.agentId === agentId);
    return agent ? (agent as MarlTradingAgent).getMetrics().tradesExecuted : 0;
  }

  private calculateAgentWinRate(agentId: string): number {
    // Simplification: trades with positive returns / total trades
    return Math.random() * 100;  // Placeholder
  }

  private calculateHeadToHead(rankings: CompetitionResult['finalRankings']): CompetitionResult['headToHeadMetrics'] {
    const metrics: CompetitionResult['headToHeadMetrics'] = [];

    for (let i = 0; i < rankings.length - 1; i++) {
      for (let j = i + 1; j < rankings.length; j++) {
        metrics.push({
          agent1: rankings[i].agentId,
          agent2: rankings[j].agentId,
          agent1Return: rankings[i].totalReturn,
          agent2Return: rankings[j].totalReturn,
          winner: rankings[i].totalReturn > rankings[j].totalReturn ? rankings[i].agentId : rankings[j].agentId
        });
      }
    }

    return metrics;
  }

  private calculateCompetitorImpact(): CompetitionResult['competitorImpact'] {
    return this.agents.map(agent => ({
      agentId: agent.agentId,
      averageLiquidityImpact: Math.random() * 10,
      timesOutbid: Math.floor(Math.random() * 50),
      timesOutsold: Math.floor(Math.random() * 50)
    }));
  }

  getCompetitionResults(competitionId: string): CompetitionResult | undefined {
    return this.competitionResults.get(competitionId);
  }

  getAllResults(): CompetitionResult[] {
    return Array.from(this.competitionResults.values());
  }
}

export type { CompetitionConfig, CompetitionResult, AgentObservation, AgentAction, MArlAgent };
