CLAUDE CODE KICKOFF - PHASE 2: MARL COMPETITIVE FRAMEWORK
========================================================

Paste this entire prompt into Claude Code and it will implement the MARL system.

---

You are implementing Phase 2 of a cryptocurrency sentiment analysis trading platform.
Your task: Add a Multi-Agent Reinforcement Learning (MARL) competitive trading framework
to the existing sentiment analyzer project.

CONTEXT
=======

Existing repo: https://github.com/infinyte/sentiment-analyzer

Current state:
- Single-agent backtesting engine working
- Sentiment analyzer with 4 modes (BASIC, ADVANCED, TRADING_SIGNALS, SMART)
- API routes for coins, sentiment, backtesting
- React frontend with dashboard

Your job: Add competitive multi-agent system where agents trade against each other on 
shared order book and learn through adversarial reinforcement learning.

REQUIREMENTS
============

STRICT CONSTRAINTS
──────────────────

1. NO BREAKING CHANGES to existing code
   - All existing routes, services, components must work unchanged
   - Reuse existing CoinGeckoService, SentimentAnalyzerEngine, TradingAgent
   - No modifications to existing files except index.ts and App.tsx

2. TypeScript strict mode
   - No 'any' types (except where absolutely necessary)
   - All types explicitly defined
   - No type errors on compilation

3. Zero new dependencies
   - Do NOT add new npm packages
   - Use only: Node.js standard, Express, TypeScript, React (already installed)
   - Mathematical operations must be in pure TypeScript

4. Single files for each service
   - backend/src/services/marl-competition-engine.ts (~1000 lines OK)
   - backend/src/routes/marl-competition.ts (~600 lines OK)
   - frontend/src/hooks/useMarlCompetition.ts
   - frontend/src/components/MarlCompetitionViewer.tsx
   - No extra files unless essential

IMPLEMENTATION STEPS
====================

STEP 1: Create backend/src/services/marl-competition-engine.ts
──────────────────────────────────────────────────────────────

Classes to implement:

1. SharedOrderBook
   ├─ placeOrder(orderId, agentId, symbol, side, price, quantity)
   │  └─ Returns: { filled, avgFillPrice, remainingQuantity }
   │  └─ Implements: Order matching with slippage based on depth
   │
   ├─ cancelOrder(orderId, symbol): boolean
   │
   ├─ getMarketState(symbol): MarketState
   │  └─ Returns bid/ask book, spread, depth, last price
   │
   └─ getCompetitorOrders(symbol, excludeAgentId)
      └─ Returns: array of { agentId, totalBidQuantity, totalAskQuantity }

   Slippage formula:
   ```
   slippage = (order_size / market_depth) * 100 bps
   Cap at 50 bps
   ```

2. MarlTradingAgent extends TradingAgent
   ├─ Properties:
   │  ├─ qValues: Map<string, number>     // State -> Q-value
   │  ├─ policyNetwork: PolicyNetwork      // Neural network
   │  ├─ epsilon: number                   // Exploration rate (start 0.1)
   │  ├─ learningRate: number              // 0.01
   │  ├─ gamma: number                     // Discount factor (0.99)
   │  └─ history: { states, actions, rewards }  // For learning
   │
   ├─ observe(state: AgentObservation): void
   │  └─ Stores current market observation
   │
   ├─ computeAction(observation): AgentAction
   │  └─ Epsilon-greedy: explore vs exploit
   │  └─ Actions: BUY, SELL, HOLD, CANCEL, WAIT
   │
   ├─ learn(reward, nextState): void
   │  └─ Q-learning update: Q(s,a) += α[r + γ*max(Q(s',a')) - Q(s,a)]
   │  └─ Backprop through policy network
   │
   ├─ updateQValue(stateKey, action, reward): void
   │
   ├─ decay(): void
   │  └─ epsilon *= 0.995 (reduce exploration)
   │
   └─ getMetrics()
      └─ Returns: { totalReward, avgReward, tradesExecuted, learningCurve, epsilon }

   Observation space (50 features):
   - Price (5): current, bid/ask levels 1-5
   - Spread (1): bid-ask in bps
   - Portfolio (10): cash, equity, positions, concentration
   - Competitors (15): 5 agents × (bid qty, ask qty, order count)
   - History (10): equity values, volatility, trend
   - Sentiment (5): score, confidence, signal, target, risk factors

3. MarlCompetitionEngine
   ├─ constructor(agents, orderBook, sentiment)
   │
   ├─ runCompetition(config, historicalData, sentimentData)
   │  └─ Returns: CompetitionResult (Promise)
   │  └─ Route to correct tournament type based on config.mode
   │
   ├─ runSingleTournament()
   │  └─ All agents trade for fixed duration
   │  └─ Learning happens during tournament
   │  └─ Returns rankings, metrics, equity evolution
   │
   ├─ runEvolutionaryTournament()
   │  └─ Multi-round elimination
   │  └─ Top 2 agents survive each round
   │  └─ Bottom performers eliminated and replaced with mutants
   │  └─ Repeat for N rounds
   │
   ├─ runContinuousLearning()
   │  └─ Never-ending tournament
   │  └─ Every hour: trade phase, then learning phase (replay 100 trades)
   │
   ├─ mutateAgent(original, newId)
   │  └─ Clone agent, mutate Q-values by ±5%
   │
   ├─ calculateSharpeRatio(equityHistory, agentId)
   │  └─ (mean_return) / std_dev(returns)
   │
   ├─ calculateMaxDrawdown(history, agentId)
   │  └─ (peak - trough) / peak
   │
   ├─ calculateHeadToHead(rankings)
   │  └─ All pairwise comparisons
   │
   └─ getAllResults(), getCompetitionResults(id)

TYPES TO DEFINE
───────────────

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
  bidBook: OrderBookEntry[];
  askBook: OrderBookEntry[];
  lastPrice: number;
  spreadBps: number;
  depth: { price: number; quantity: number }[];
}

interface AgentObservation {
  currentPrice: number;
  bidAsk: { bid: number; ask: number };
  spreadBps: number;
  portfolio: { symbol: string; quantity: number; avgPrice: number; unrealizedPnl: number }[];
  cash: number;
  equity: number;
  equityHistory: number[];
  sentimentSignal: TradingSignal;
  competitorOrders: { agentId: string; totalBidQuantity: number; totalAskQuantity: number }[];
}

interface AgentAction {
  type: 'BUY' | 'SELL' | 'CANCEL' | 'HOLD' | 'WAIT';
  symbol?: string;
  quantity?: number;
  price?: number;
  orderId?: string;
  reason?: string;
}

interface CompetitionConfig {
  mode: 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
  agents: { id: string; riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING' }[];
  symbols: string[];
  duration: number;
  refreshInterval: number;
  evolutionaryRounds?: number;
  learningEnabled: boolean;
}

interface CompetitionResult {
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

IMPLEMENTATION NOTES
───────────────────

PolicyNetwork: Simple feedforward network
- Input: 50 features from AgentObservation
- Hidden layer 1: 64 neurons (ReLU)
- Hidden layer 2: 32 neurons (ReLU)
- Output: 5 neurons (softmax for action probabilities)

No external ML library needed - implement simple matrix math:
- matrix multiply: for (i) for (j) sum
- ReLU: max(0, x)
- softmax: exp(x) / sum(exp(x))
- gradient descent: w -= lr * dw

Q-Learning state discretization:
- Price: round to nearest 100
- Spread: round to nearest 5 bps
- Equity: round to nearest 1000
- Create state key: `P:${price}|S:${spread}|E:${equity}`

Reward function: r(t) = equity(t) - equity(t-1)
Simple but effective: agents maximize change in total equity each step


STEP 2: Create backend/src/routes/marl-competition.ts
─────────────────────────────────────────────────────

5 main endpoints:

1. POST /api/marl/competition/start
   - Input: CompetitionConfig (mode, agents, symbols, duration, etc)
   - Output: { competitionId, status, message }
   - Start tournament asynchronously, return immediately
   - Fire-and-forget: don't await the competition

2. GET /api/marl/competition/:competitionId/status
   - Output: { competitionId, status, progress%, agents, topPerformer }
   - For running competitions: return 404 or "RUNNING"
   - For completed: return full results

3. GET /api/marl/competition/:competitionId/results
   - Output: Complete CompetitionResult
   - Rankings, head-to-head, equity curves, competitor impact

4. POST /api/marl/agents/compare
   - Input: 2 agents, symbols, duration, rounds
   - Run N times, average results
   - Output: comparison stats, win rate, Sharpe ratio

5. GET /api/marl/competitions
   - List all competitions (running + completed)
   - Order by most recent

6. GET /api/marl/info
   - Documentation endpoint
   - Explain modes, risk profiles, metrics


STEP 3: Update backend/src/index.ts
────────────────────────────────────

Add import:
import marlRoutes from './routes/marl-competition';

Add route:
app.use(marlRoutes);

No changes to existing routes or middleware.


STEP 4: Create frontend/src/types/marl.ts
──────────────────────────────────────────

Export all types for TypeScript:
- CompetitionAgent
- CompetitionConfig
- CompetitionResult
- (nested types)


STEP 5: Create frontend/src/hooks/useMarlCompetition.ts
────────────────────────────────────────────────────────

Hook for MARL competition management:

export function useMarlCompetition() {
  const [loading, setLoading] = useState(false);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [results, setResults] = useState<CompetitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCompetition = async (config: CompetitionConfig) => {
    // POST /api/marl/competition/start
    // Poll /api/marl/competition/:id/status every 5 seconds
    // Until status === 'COMPLETED'
  };

  const compareAgents = async (agent1, agent2, symbols, rounds) => {
    // POST /api/marl/agents/compare
  };

  return { startCompetition, compareAgents, results, loading, error, competitionId };
}


STEP 6: Create frontend/src/components/MarlCompetitionViewer.tsx
────────────────────────────────────────────────────────────────

React component with:

1. Configuration form
   - Mode selector (SINGLE / EVOLUTIONARY / CONTINUOUS)
   - Agent count slider (2-10)
   - Duration input
   - Symbol multi-select
   - "Start Tournament" button

2. Status display (when running)
   - Competition ID
   - Progress bar
   - Current agent equities (live update)

3. Results display (when complete)
   - Final rankings table
     ├─ Rank, Agent ID, Final Capital, Return %, Sharpe, Max DD, Trades, Win Rate
   - Head-to-head metrics
     ├─ Agent A vs B, winner, margin
   - Competitor impact
     ├─ Liquidity impact, times outbid/outsold
   - Equity evolution chart (Chart.js)
     └─ 1 line per agent showing equity over time


STEP 7: Update frontend/src/App.tsx
─────────────────────────────────

Add route:
<Route path="/marl" element={<MarlCompetitionViewer />} />

Add navigation link to /marl


VALIDATION & TESTING
====================

After implementation, verify:

✅ TypeScript compilation (npm run build)
✅ No 'any' types (except PolicyNetwork.forward which can return number[])
✅ All imports resolve
✅ Tests to run:

CURL TEST - Single Tournament:
```
curl -X POST http://localhost:3000/api/marl/competition/start \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "SINGLE",
    "agents": [
      {"id": "conservative", "riskProfile": "CONSERVATIVE"},
      {"id": "aggressive", "riskProfile": "AGGRESSIVE"}
    ],
    "symbols": ["BTC", "ETH"],
    "duration": 60000,
    "refreshInterval": 1000,
    "learningEnabled": true
  }'
```

Expected response:
```
{
  "competitionId": "comp_1710644400000",
  "status": "STARTED",
  "mode": "SINGLE",
  "agentCount": 2,
  "message": "..."
}
```

CURL TEST - Get Results:
```
curl http://localhost:3000/api/marl/competition/comp_1710644400000/results
```

Expected response: CompetitionResult with rankings, metrics

FRONTEND TEST:
- Open http://localhost:5173/marl
- Configure tournament
- Click "Start Tournament"
- See competitionId
- Wait for results
- See rankings, charts


DELIVERABLES
============

After completion:

Files created:
☐ backend/src/services/marl-competition-engine.ts
☐ backend/src/routes/marl-competition.ts
☐ frontend/src/types/marl.ts
☐ frontend/src/hooks/useMarlCompetition.ts
☐ frontend/src/components/MarlCompetitionViewer.tsx

Files modified:
☐ backend/src/index.ts (+ MARL routes)
☐ frontend/src/App.tsx (+ MARL route & nav)

Documentation:
☐ Update README.md with MARL section
☐ Add MARL examples to CLAUDE.md

Testing:
☐ Run CURL tests (endpoint verification)
☐ Run frontend UI tests (component loads, forms work)
☐ Run 1-minute tournament end-to-end

Bonus:
☐ Add cURL examples in comments
☐ Add TypeScript intellisense-friendly JSDoc comments
☐ Error handling for all API calls


GUIDANCE FOR CLAUDE CODE
========================

1. Create files in order: services → routes → types → hooks → components → updates
2. Start with SharedOrderBook (foundational)
3. Then MarlTradingAgent (builds on TradingAgent)
4. Then MarlCompetitionEngine (uses both)
5. Routes are straightforward after engine is done
6. Frontend components are simplest

If you hit issues:
- "Cannot extend TradingAgent" → ensure import path correct
- "Q-learning math" → use reference from MARL_COMPLETE_GUIDE.md
- "State discretization" → see notes above
- "Order matching logic" → simple FIFO matching on price levels

You have all the information needed. Let's build this! 🚀

---

WHEN COMPLETE
=============

After all files are created and tested:

1. Commit to GitHub
2. Test live at: curl http://localhost:3000/api/marl/info
3. Run a 5-minute single tournament end-to-end
4. Verify results page loads and displays rankings
5. You have a fully functional MARL competitive trading system!

Next phase (optional): 
- Add persistent storage of competition results
- Integrate with live exchange APIs (CCXT)
- Multi-day evolutionary tournaments
- Web dashboard with real-time visualization
