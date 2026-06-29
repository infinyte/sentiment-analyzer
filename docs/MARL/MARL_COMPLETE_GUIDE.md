ADVERSARIAL MULTI-AGENT RL TRADING FRAMEWORK
===========================================

LIVE AGENT PIPELINE (PHASES 4-7) - HOW MARL FEEDS PRODUCTION
============================================================

The MARL competition + evolutionary system described in this document is now the
*research engine* behind a live, measurable agent pipeline. The loop closes like this:

- Phase 7 - MarlPolicyFeeder maps the best evolved agent's genome onto the live
  decision policy (entryThreshold -> minStrength, positionSizePct -> tradeFractionOfCapital).
- Phase 3 - TradingAgentOrchestrator applies that policy one cycle at a time, routing
  orders through the safety-guarded TradingService onto a shared (realistic) paper exchange.
- Phase 4 - ShadowHarness drives the orchestrator continuously to accumulate a track record.
- Phase 5 - Walk-forward validation guards the fed parameters against overfitting using the
  SAME policy and the SAME net-of-fees scoring as production.
- Phase 6 - A Server-Sent Events feed (GET /api/shadow/stream) streams each cycle to the
  "Shadow Live" dashboard tab.
- Net-of-fees expectancy analytics (GET /api/paper/*) measure whether the evolved strategy
  has a real edge after fees and slippage.

So the competitive/adversarial dynamics covered here do not end at the tournament: the winning
genome is promoted into the live policy, validated, and continuously measured. See the README
section "Phase 4-7: Live Agent Pipeline" and CLAUDE.md for full detail.

---


Complete architectural guide for the competitive agent system.

---

EXECUTIVE SUMMARY
=================

You now have a complete **multi-agent reinforcement learning (MARL) competitive trading 
system** where N agents with configurable starting capital (defaulting to the same initial bankroll unless overridden) compete in a shared market environment 
and learn from each other's actions.

Key capabilities:

✅ **Shared Order Book**: All agents trade on same liquidity pool (realistic)
✅ **Adversarial Learning**: Agent A's profit directly impacts Agent B's returns
✅ **3 Tournament Modes**: Single, Evolutionary (multi-round elimination), Continuous
✅ **MARL Algorithms**: Q-learning, policy gradients, actor-critic networks
✅ **Evolutionary Fitness**: Weak agents eliminated, strong agents breed
✅ **Liquidity Impact**: Slippage compounds based on order size and market depth
✅ **Learning Curves**: Agents improve through replaying past trades
✅ **Competition Metrics**: Head-to-head analysis, liquidity impact, win rates


WHAT MAKES THIS ADVERSARIAL
============================

Traditional RL has a stationary environment. Your agents operate in a **non-stationary, 
competitive environment** where every agent's learning changes the game for everyone:

Scenario:

Time 1: Agent A learns: "Buy BTC at 9:00 AM, sell at 10:00 AM" → +$100 profit
Time 2: Agent B learns this pattern and starts buying at 9:00 AM too
Time 3: Combined demand at 9:00 AM drives price up, Agent A's entry becomes worse
Time 4: Agent A learns: "Need to buy earlier" → changes strategy
Time 5: Agent B adapts to Agent A's adaptation
...
Agents keep improving against each other = **arms race of intelligence**

Result: Emergent strategies that couldn't exist in isolation.


CORE ALGORITHMS
===============

1. Q-LEARNING (Temporal Difference)
   
   For each agent independently:
   
   Q(s,a) ← Q(s,a) + α[r + γ·max(Q(s',a')) - Q(s,a)]
   
   Where:
   - s = current market state (price, spread, portfolio, competitor orders)
   - a = action (BUY, SELL, HOLD, CANCEL)
   - r = reward (change in equity)
   - γ = discount factor (0.99 = value future returns)
   - α = learning rate (0.01 = conservative learning)
   
   Each agent builds its own Q-value table: "in state X, taking action Y gives reward Z"
   
   Over time: agent learns which actions work best in each situation
   Against others: agent learns which actions work when competitors are present

2. POLICY GRADIENT (Actor-Critic)
   
   Neural network learns to output action probabilities:
   
   Input: 50-feature observation vector
   └─ Hidden1 (64 neurons, ReLU activation)
   └─ Hidden2 (32 neurons, ReLU activation)
   └─ Output (5 neurons, softmax) → [P(BUY), P(SELL), P(HOLD), P(CANCEL), P(WAIT)]
   
   Agent samples actions: multinomial draw from these probabilities
   
   Gradient update: ∇J(θ) = E[∇ log π(a|s) · Q(s,a)]
   
   Learns: which action probabilities maximize expected return
   
3. MARL COORDINATION (Implicit)
   
   Each agent:
   - Observes all competitor orders
   - Learns which competitors are aggressive/conservative
   - Adjusts strategy: "If aggressive agents are bidding high, move to offers"
   - Converges to Nash Equilibrium over time


SHARED ORDER BOOK MECHANICS
==========================

The order book is the engine of competition. Every trade creates liquidity impact.

Example:

Agent A: Places 10 BTC ask order at $60,000
  └─ Adds depth to order book
  └─ Increases liquidity

Agent B: Market buy 5 BTC
  └─ Fills 5 against Agent A's order
  └─ Partially fills Agent A's offer

Agent C: Market buy 5 BTC
  └─ Fills remaining 5 from Agent A
  └─ Now hits next depth level
  └─ Experiences slippage (worse price)
  └─ Agent A profited from C's trade

Slippage calculation:

slippage = (agent_order_size / market_depth) * 100 basis points

If market has $1M of depth and Agent A has $10k order:
  slippage = (10,000 / 1,000,000) * 100 = 1 basis point

If Agent A has $100k order:
  slippage = (100,000 / 1,000,000) * 100 = 10 basis points

Agents learn: large orders move prices against you.
Competitive strategy: "Let competitors take large positions, then trade smaller"


TOURNAMENT STRUCTURES
====================

1. SINGLE TOURNAMENT
   ═════════════════
   
   Configuration:
   - 3-8 agents with different risk profiles
   - Trade for fixed duration (1 hour to 1 week)
   - Agents learn during the tournament
   - Winner = highest final equity
   
   Execution:
   
   Time 0:
   ├─ Agent A (Conservative): $10,000
   ├─ Agent B (Aggressive): $10,000
   └─ Agent C (Scalping): $10,000
   
   Time 30 min:
   ├─ Agent A: $10,150 (learned stable strategy)
   ├─ Agent B: $10,380 (taking risks, ahead)
   └─ Agent C: $9,920 (scalping not working)
   
   Time 60 min:
   ├─ Agent A: $10,320 (steady learning)
   ├─ Agent B: $10,150 (took losses, volatility hurt)
   └─ Agent C: $10,050 (caught up, scalping improved)
   
   Winner: Agent A (steady strategy wins under uncertainty)
   
   Metrics tracked:
   - Final capital
   - Return %
   - Sharpe ratio (return per unit of risk)
   - Max drawdown (worst peak-to-trough)
   - Win rate (% of profitable trades)
   - Trades executed
   
2. EVOLUTIONARY TOURNAMENT
   ═══════════════════════
   
   Multi-round elimination with selection pressure.
   
   Round 1: 8 agents (random)
   ├─ Agent A ($10,200) ← Top performer
   ├─ Agent B ($10,150) ← 2nd place
   ├─ Agent C ($10,050)
   ├─ Agent D ($10,020)
   ├─ Agent E ($9,950)
   ├─ Agent F ($9,800) ← Eliminated
   ├─ Agent G ($9,750) ← Eliminated
   └─ Agent H ($9,600) ← Eliminated
   
   Selection: Top 2 survive, breed mutants
   
   Breeding:
   ├─ Clone A, mutate Q-values by ±5%: "A_gen1"
   ├─ Clone B, mutate Q-values by ±5%: "B_gen1"
   └─ Mutate remaining 4 agents
   
   Round 2: 8 agents (evolved)
   ├─ A_gen1 ($10,580) ← Better strategy
   ├─ B_gen1 ($10,300) ← Better strategy
   ├─ C_mutated ($10,100)
   ├─ ...
   
   Repeat until convergence (5-10 rounds)
   
   Result: Population increasingly skilled, strategies specialize
   
   Evolutionary pressure: survive = you were right about market dynamics
   
3. CONTINUOUS LEARNING
   ═══════════════════
   
   Never-ending tournament with background learning.
   
   Every hour:
   ├─ Agents trade for 60 minutes (live competition)
   └─ 5-minute learning phase: replay last 100 trades
        └─ For each trade: "was this good? update Q-value"
        └─ For each state: "did my policy work? backprop"
   
   Learning happens in parallel:
   - Trading thread: agents make decisions in real-time
   - Learning thread: agents improve from past trades every hour
   - No tournament end: agents keep competing indefinitely
   
   Use case: Realistic market simulation where agents adapt continuously
   
   Agents converge to: strategies that work in current market regime
   
   If market regime changes: agents re-learn from scratch


OBSERVATION SPACE (STATE)
=========================

Each agent observes 50 features:

Price & Spreads (5 features):
  - Current price
  - Bid-ask spread (bps)
  - Price momentum (7d change %)
  - Bid level 1-5 prices
  - Ask level 1-5 prices

Portfolio (10 features):
  - Cash available
  - Total equity
  - Unrealized P&L
  - Number of open positions
  - Average entry price (weighted)
  - Position duration (days)
  - Max position drawdown
  - Largest position size
  - Concentration (% in largest position)
  - Margin used %

Competitor Orders (15 features):
  - Competitor 1: total bid quantity, ask quantity, count
  - Competitor 2: (same)
  - Competitor 3: (same)
  - Competitor 4: (same)
  - Competitor 5: (same)
  
History (10 features):
  - Last 10 equity values (normalized)
  - Max equity in last 10
  - Min equity in last 10
  - Equity volatility
  - Trades in last 10 minutes

Sentiment Signal (5 features):
  - Sentiment score (0-100)
  - Confidence (0-1)
  - Signal (BUY/SELL/HOLD encoded as 1/0/-1)
  - Target price
  - Risk factors count


ACTION SPACE
============

5 possible actions (agent picks one each decision step):

1. BUY: Place limit buy order
   - Price: typically 0.5-2% below current ask
   - Quantity: based on risk profile (1-10% of available cash)
   - Conservative: small order far from market
   - Aggressive: large order near market

2. SELL: Place limit sell order
   - Price: typically 0.5-2% above current bid
   - Quantity: based on position size
   - Conservative: sell losers first
   - Aggressive: hold winners

3. HOLD: Do nothing
   - Let existing orders sit
   - Wait for better prices

4. CANCEL: Cancel existing order
   - If market moved against you
   - If competitor took better position

5. WAIT: Similar to HOLD but explicit state
   - Used when observation quality is low
   - Reduces noise


REWARD FUNCTION
===============

Simple but effective: change in total equity

r(t) = equity(t) - equity(t-1)

Equity = cash + portfolio_value

If agent:
  - Entered trade at $10,000 and now at $10,100: r = +$100
  - Opened losing position: r = negative
  
Agent learns: maximize change in equity

Risk-adjusted alternatives:
  
  r(t) = (equity(t) - equity(t-1)) / drawdown(t)  # Sharpe-like
  
  r(t) = log(equity(t) / equity(t-1))  # Log returns (penalizes volatility)
  
  r(t) = positive_return ? 0.1 * return : 1.0 * return  # Asymmetric loss


LEARNING RATES & HYPERPARAMETERS
================================

Critical for convergence:

epsilon (exploration rate):
  - Start: 0.1 (10% random actions)
  - Decay: ×0.995 per step
  - Min: 0.01 (always explore a bit)
  - Effect: early = explore everywhere, late = exploit best actions

alpha (learning rate):
  - Q-learning: 0.01 (slow, stable)
  - Higher (0.1): fast but noisy
  - Lower (0.001): very stable but slow
  
gamma (discount factor):
  - 0.99: value future rewards heavily
  - 0.9: myopic, focus on immediate profit
  - Use 0.99 for long-term strategies

hidden_layers (policy network):
  - [64, 32]: default, good balance
  - [128, 64]: more complex strategies, slower
  - [32]: fast training, simpler strategies


HEAD-TO-HEAD METRICS
====================

After tournament, analyze agent matchups:

Agent A vs Agent B:
  - Agent A return: +$320 (+3.2%)
  - Agent B return: +$150 (+1.5%)
  - Winner: Agent A
  - Margin: $170
  
Network of all head-to-head:
  - Agent A beats B, C, D, E (80% win rate)
  - Agent B beats D, E, F (60%)
  - Agent C beats E, F (50%)
  
This creates tournament bracket visualization:
  
  A defeats most: likely the strongest agent
  C loses to A but beats E: middle tier
  F loses to everyone: weakest


COMPETITOR IMPACT ANALYSIS
==========================

Measure how agents affect each other:

Agent B (Aggressive trader):
  - Average liquidity impact: 8.3 bps
  - Times outbid: 45 (competitor beat my buy order)
  - Times outsold: 12 (competitor beat my sell order)
  - Net: Very aggressive buyer, less aggressive seller
  
Agent C (Conservative trader):
  - Average liquidity impact: 1.2 bps
  - Times outbid: 8
  - Times outsold: 38
  - Net: Conservative buyer, willing to sell

This shows: Agent B learned to be aggressive on buys, passive on sells


CONVERGENCE & NASH EQUILIBRIUM
==============================

In game theory, Nash Equilibrium = no agent can improve by unilaterally changing strategy

In trading:
  - Agent A: "I'll buy at 9:00 AM" earns +$100
  - Agent B learns this, "I'll also buy at 9:00 AM"
  - Both now get +$50 (compete for same liquidity)
  
Agents keep adapting:
  - Agent A: "Move to 8:50 AM"
  - Agent B: "Follow to 8:50 AM"
  - ...continues until they find position neither wants to move from

At equilibrium:
  - Each agent's strategy is optimal given others' strategies
  - If A moved alone, A would do worse
  - But all could collectively do better (tragedy of commons)


EMERGENT BEHAVIORS
==================

What strategies emerge from adversarial learning?

Observed in simulations:

1. Momentum Chasing
   Agents learn: follow price trends
   Rational: if price up, likely to continue up
   Emergent risk: creates volatility feedback loops

2. Mean Reversion
   Agents learn: buy oversold, sell overbought
   Rational: extreme moves often correct
   Emergent risk: whipsaws when trends persist

3. Front-Running
   Agents learn: place orders just before competitor orders
   Rational: get better price by going first
   Emergent risk: arms race in timing reduces profitability

4. Market Making
   Agents learn: provide liquidity, earn spread
   Rational: consistent small profit from bid-ask
   Emergent risk: stuck with inventory when market moves

5. Herding
   Agents learn: do what top performers do
   Rational: copy winning strategies
   Emergent risk: crowd effects, crashes


API USAGE EXAMPLES
==================

1. Start Simple Tournament
═══════════════════════════

POST /api/marl/competition/start
{
  "mode": "SINGLE",
  "agents": [
    { "id": "agent_conservative", "riskProfile": "CONSERVATIVE" },
    { "id": "agent_aggressive", "riskProfile": "AGGRESSIVE" },
    { "id": "agent_scalper", "riskProfile": "SCALPING" }
  ],
  "symbols": ["BTC", "ETH", "SOL"],
  "duration": 3600000,  // 1 hour
  "refreshInterval": 1000,  // Update every 1 second
  "learningEnabled": true
}

Response: {"competitionId": "comp_1710644400000", "status": "STARTED"}

Check status: GET /api/marl/competition/comp_1710644400000/status
Get results: GET /api/marl/competition/comp_1710644400000/results

2. Run Evolutionary Tournament
═══════════════════════════════

POST /api/marl/competition/start
{
  "mode": "EVOLUTIONARY",
  "agents": [
    { "id": "agent1", "riskProfile": "CONSERVATIVE" },
    { "id": "agent2", "riskProfile": "AGGRESSIVE" },
    { "id": "agent3", "riskProfile": "SCALPING" },
    { "id": "agent4", "riskProfile": "CONSERVATIVE" },
    { "id": "agent5", "riskProfile": "AGGRESSIVE" },
    { "id": "agent6", "riskProfile": "SCALPING" },
    { "id": "agent7", "riskProfile": "CONSERVATIVE" },
    { "id": "agent8", "riskProfile": "AGGRESSIVE" }
  ],
  "symbols": ["BTC", "ETH"],
  "duration": 1800000,  // 30 min per round
  "evolutionaryRounds": 5,
  "learningEnabled": true
}

Result: 5 rounds × 30 min = 150 minutes total
Round 1: 8 agents, bottom 3 eliminated
Round 2: Top 2 + 6 mutants, bottom 3 eliminated
...
Round 5: Final standings

3. Compare Two Agents
═════════════════════

POST /api/marl/agents/compare
{
  "agents": [
    { "id": "agent_a", "riskProfile": "CONSERVATIVE" },
    { "id": "agent_b", "riskProfile": "AGGRESSIVE" }
  ],
  "symbols": ["BTC", "ETH"],
  "duration": 600000,  // 10 minutes per round
  "rounds": 5  // Run 5 times, average results
}

Result:
{
  "agent_a": {
    "avgReturn": 2.3,
    "returnStdDev": 1.2,
    "winRate": 60,  // Won 3 out of 5
    "avgSharpe": 0.85
  },
  "agent_b": {
    "avgReturn": 3.8,
    "returnStdDev": 2.1,
    "winRate": 40,  // Won 2 out of 5
    "avgSharpe": 0.92
  },
  "winner": "agent_b"
}

4. View All Results
════════════════════

GET /api/marl/competitions

{
  "count": 3,
  "competitions": [
    {
      "competitionId": "comp_1710644400000",
      "mode": "SINGLE",
      "agents": 3,
      "topPerformer": "agent_aggressive",
      "topPerformerReturn": 4.5
    },
    ...
  ]
}


PRACTICAL APPLICATIONS
======================

1. PORTFOLIO REBALANCING RESEARCH
   Run agents with different rebalancing strategies
   See which works best in current market
   Adapt your own strategy based on winner

2. MARKET MICROSTRUCTURE STUDY
   Understand how order flow affects prices
   See how different trading styles interact
   Learn optimal trade sizing

3. COMPETITIVE BENCHMARKING
   Test your strategy vs. alternatives
   Find weaknesses by losing to agents
   Evolve strategy that beats the rest

4. ADVERSARIAL ROBUSTNESS
   If strategy beats MARL agents: robust
   If loses to specialized agent: has weakness
   Use to stress-test before live trading

5. MACHINE LEARNING VALIDATION
   MARL agents = synthetic market critics
   If ML model loses to MARL: model overfitted
   If ML model beats MARL: genuinely predictive


NEXT STEPS FOR YOUR PROJECT
============================

Phase 1 (Complete):
✅ Single-agent sentiment analyzer (4 modes)
✅ Single-agent backtesting engine
✅ Multi-agent shared order book
✅ MARL competition framework (3 tournament types)

Phase 2 (Optional extensions):
☐ Persistent Q-value storage (PostgreSQL/MongoDB)
☐ Policy network pre-training on synthetic data
☐ Real-time live trading integration
☐ Web dashboard visualization of competitions
☐ Multi-market / multi-pair tournaments
☐ Deep Reinforcement Learning (DQN, A3C variants)
☐ Genetic algorithm optimization of hyperparameters


REFERENCES & INSPIRATION
========================

Algorithms:
- Q-Learning: Watkins & Dayan (1992)
- Policy Gradient: Sutton et al. (2000)
- Actor-Critic: Konda & Tsitsiklis (2000)
- Multi-Agent RL: Busoniu et al. (2008)

Applications in Finance:
- AlphaGo self-play = agents improving through competition
- DeepMind's AlphaZero = multi-agent RL on games
- OpenAI's multi-agent environments = foundation

Trading-specific:
- Market Microstructure Theory: Stoll, Hasbrouck
- Optimal Execution: Almgren & Chriss
- Latency Arbitrage: Menkveld


Final thought:

You've implemented a system where **intelligence emerges from competition**.

Not pre-programmed rules. Not statistical patterns from the past.
But agents learning what works by trying to beat each other in real-time.

This is the cutting edge of trading technology. 🚀

