MARL COMPETITIVE TRADING FRAMEWORK - ARCHITECTURE DIAGRAMS & SYSTEM DESIGN
========================================================================

File: MARL_ARCHITECTURE_DIAGRAMS.md

Complete visual and textual documentation of how the multi-agent competitive framework operates.

---

1. SYSTEM-LEVEL ARCHITECTURE
============================

┌─────────────────────────────────────────────────────────────────────┐
│                   MARL COMPETITION ENGINE                            │
│                   (Tournament Orchestrator)                           │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
        ▼         ▼         ▼
   ┌────────┐ ┌────────┐ ┌──────────┐
   │ SINGLE │ │ EVOLV. │ │CONTINUOUS│
   │TOURNEY │ │TOURNEY │ │ LEARNING │
   └────────┘ └────────┘ └──────────┘
        │         │         │
        └─────────┼─────────┘
                  │
                  ▼
    ┌─────────────────────────────┐
    │   SHARED ORDER BOOK         │
    │  (Limit Order Book State)   │
    │                             │
    │  BID SIDE          ASK SIDE │
    │  $60,010 [  ] [$] $60,020   │
    │  $60,000 [X] [$] $60,050    │
    │  $59,990 [X] [$] $60,100    │
    │  $59,500 [X] [$] $61,000    │
    └─────────────────────────────┘
        ▲    ▲    ▲    ▲    ▲
        │    │    │    │    │
        │    │    │    │    │
    ┌───┴────┴────┴────┴────┴────┐
    │   AGENT POPULATION          │
    │                             │
    │  ┌─────┐  ┌─────┐  ┌─────┐ │
    │  │ A1  │  │ A2  │  │ A3  │ │
    │  │CONS │  │AGGS │  │SCAL │ │
    │  └─────┘  └─────┘  └─────┘ │
    │                             │
    │  Each has:                  │
    │  - Q-Value Table            │
    │  - Policy Network           │
    │  - Portfolio State          │
    │  - Learning History         │
    └─────────────────────────────┘


Key Components:

1. MarlCompetitionEngine
   - Entry point for all tournaments
   - Manages 3 tournament modes (SINGLE/EVOLUTIONARY/CONTINUOUS)
   - Initializes agent population
   - Runs main event loop
   - Collects metrics and results

2. SharedOrderBook
   - Central market state
   - Tracks all agent orders
   - Calculates execution prices with slippage
   - Maintains order history
   - Publishes market state to agents

3. Agent Population
   - Each agent has own:
     * Starting capital ($10,000)
     * Portfolio (positions, cash)
     * Q-values (state→action→reward mapping)
     * Policy network (neural network for action selection)
     * Observation history
   - Agents observe market independently
   - Agents execute actions simultaneously
   - Agents learn from shared outcomes


---

2. AGENT OBSERVATION & DECISION FLOW
====================================

TIME t:

Step 1: Market State Publication
──────────────────────────────────

    SHARED ORDER BOOK
    ┌────────────────────┐
    │ BTC/USD            │
    │ Price: $60,050     │
    │ Bid:   $60,010     │
    │ Ask:   $60,100     │
    │ Spread: 0.15%      │
    │                    │
    │ DEPTH (Top 5)      │
    │ Bid:               │
    │  1. $60,010 (5 qty)│
    │  2. $60,000 (10)   │
    │  3. $59,990 (20)   │
    │  4. $59,500 (100)  │
    │  5. $59,000 (500)  │
    └────────────────────┘
              │
              │ Publishes to all agents
              ▼
    
    AGENT 1 RECEIVES OBSERVATION
    ┌──────────────────────────────┐
    │ AgentObservation {           │
    │   // Price data              │
    │   currentPrice: 60050,       │
    │   bidAsk: {                  │
    │     bid: 60010,              │
    │     ask: 60100               │
    │   },                         │
    │   spreadBps: 15,             │
    │                              │
    │   // Portfolio data          │
    │   portfolio: [               │
    │     {                        │
    │       symbol: "BTC",         │
    │       quantity: 0.5,         │
    │       avgPrice: 58000,       │
    │       unrealizedPnL: 1025    │
    │     }                        │
    │   ],                         │
    │   cash: 7500,                │
    │   equity: 37025,             │
    │   equityHistory: [36900,     │
    │     36950, 37000, 37025],   │
    │                              │
    │   // Competitor orders       │
    │   competitorOrders: [        │
    │     {                        │
    │       agentId: "agent_2",    │
    │       totalBidQuantity: 2,   │
    │       totalAskQuantity: 1    │
    │     },                       │
    │     {                        │
    │       agentId: "agent_3",    │
    │       totalBidQuantity: 5,   │
    │       totalAskQuantity: 0.2  │
    │     }                        │
    │   ],                         │
    │                              │
    │   // Sentiment signal        │
    │   sentimentSignal: {         │
    │     score: 72,               │
    │     confidence: 0.85,        │
    │     signal: "BUY",           │
    │     targetPrice: 62000       │
    │   }                          │
    │ }                            │
    └──────────────────────────────┘


Step 2: Agent Decision Making
──────────────────────────────

    AGENT 1 INTERNALLY PROCESSES
    
    Input: AgentObservation (50 features)
    ╭─────────────────────────────╮
    │ STATE DISCRETIZATION        │
    │ ─────────────────────────── │
    │ Price bucket: $60,000-$60,050
    │ Spread bucket: 10-20 bps     │
    │ Equity bucket: $37,000-$38,000
    │ Momentum: +0.07% (trend up)  │
    │ Competitor aggression: HIGH  │
    │ → STATE_KEY = "P:60K|S:15|E:37K" │
    ╰─────────────────────────────╯
                │
                ▼
    ╭─────────────────────────────╮
    │ EPSILON-GREEDY DECISION     │
    │ ─────────────────────────── │
    │ epsilon = 0.05 (5% random)  │
    │ random() = 0.043            │
    │ → EXPLORE: Pick random      │
    ╰─────────────────────────────╯
                │
                ▼
    ╭─────────────────────────────╮
    │ POLICY NETWORK FORWARD PASS │
    │ ─────────────────────────── │
    │ Input: [60050, 0.15, ...(50)]
    │                             │
    │ Hidden1 (64 units, ReLU)    │
    │ → [0.2, 0.8, 0.1, ..., 0.5]│
    │                             │
    │ Hidden2 (32 units, ReLU)    │
    │ → [0.1, 0.9, 0.2, ..., 0.7]│
    │                             │
    │ Output (5 units, softmax)   │
    │ → [0.15, 0.25, 0.45,       │
    │    0.10, 0.05]              │
    │                             │
    │ P(BUY)=0.15, P(SELL)=0.25,  │
    │ P(HOLD)=0.45, P(CANCEL)=0.1,│
    │ P(WAIT)=0.05                │
    │                             │
    │ Sample multinomial:         │
    │ → Action = HOLD             │
    ╰─────────────────────────────╯
                │
                ▼
    ╭─────────────────────────────╮
    │ ACTION GENERATED            │
    │ ─────────────────────────── │
    │ Action {                    │
    │   type: "HOLD",             │
    │   reason: "Wait for better  │
    │   opportunity"              │
    │ }                           │
    ╰─────────────────────────────╯


    AGENT 2 (AGGRESSIVE) SIMULTANEOUSLY PROCESSES
    
    Different portfolio, different strategies lead to:
    
    ╭─────────────────────────────╮
    │ ACTION GENERATED            │
    │ ─────────────────────────── │
    │ Action {                    │
    │   type: "BUY",              │
    │   symbol: "BTC",            │
    │   quantity: 1.5,            │
    │   price: 60000,             │
    │   reason: "Bullish sentiment,│
    │   competitors buying"        │
    │ }                           │
    ╰─────────────────────────────╯


    AGENT 3 (SCALPER) SIMULTANEOUSLY PROCESSES
    
    ╭─────────────────────────────╮
    │ ACTION GENERATED            │
    │ ─────────────────────────── │
    │ Action {                    │
    │   type: "SELL",             │
    │   symbol: "BTC",            │
    │   quantity: 0.3,            │
    │   price: 60100,             │
    │   reason: "Take profits,    │
    │ quick scalp"                │
    │ }                           │
    ╰─────────────────────────────╯


Step 3: Order Book Execution
────────────────────────────

    AGENT 2 BUY ORDER ARRIVES
    ┌────────────────────────────────┐
    │ placeOrder(                    │
    │   orderId: "agent2_t123",      │
    │   agentId: "agent_2",          │
    │   symbol: "BTC",               │
    │   side: "BID",                 │
    │   price: 60000,                │
    │   quantity: 1.5                │
    │ )                              │
    └────────────────────────────────┘
                │
                ▼
    ORDER BOOK MATCHING LOGIC
    ┌────────────────────────────────┐
    │ Check ASK side for matches     │
    │                                │
    │ ASK Level 1: $60,100 (0.2 qty) │
    │   Price 60000 < 60100?         │
    │   NO → Does not match          │
    │                                │
    │ No matching liquidity at       │
    │ agent's price, so:             │
    │                                │
    │ → Add to BID book at $60,000   │
    │                                │
    │ NEW BID BOOK:                  │
    │  1. $60,010 (5 qty)            │
    │  2. $60,000 (10 qty) ← existing│
    │  3. $60,000 (1.5 qty) ← NEW    │
    │  4. $59,990 (20)               │
    └────────────────────────────────┘
                │
                ▼
    AGENT 3 SELL ORDER ARRIVES
    ┌────────────────────────────────┐
    │ placeOrder(                    │
    │   orderId: "agent3_t124",      │
    │   agentId: "agent_3",          │
    │   symbol: "BTC",               │
    │   side: "ASK",                 │
    │   price: 60100,                │
    │   quantity: 0.3                │
    │ )                              │
    └────────────────────────────────┘
                │
                ▼
    ORDER BOOK MATCHING LOGIC
    ┌────────────────────────────────┐
    │ Check BID side for matches     │
    │                                │
    │ BID Level 1: $60,010 (5 qty)   │
    │   Price 60100 > 60010?         │
    │   YES → Match!                 │
    │                                │
    │   Fill: 0.3 qty (fully filled) │
    │   Agent 3 gets $60,010 per BTC │
    │   + slippage adjustment        │
    │                                │
    │ Slippage calc:                 │
    │   orderSize / marketDepth      │
    │   = 0.3 / 125 = 0.0024 = 24bp  │
    │                                │
    │   ExecutionPrice = 60,010 - 24bp
    │   = $60,009.75                 │
    │                                │
    │ Agent 3 FILLED at $60,009.75   │
    │ Agent at BID level 1 FILLED    │
    │ at $60,009.75                  │
    └────────────────────────────────┘


RESULT: After Step 3 (ORDER EXECUTION)

    Agent 1: HOLD  → No orders placed, no execution
    Agent 2: BUY   → Order added to bid book (not filled yet)
    Agent 3: SELL  → Order FILLED at $60,009.75


---

3. LEARNING LOOP & FEEDBACK
===========================

TIME t+1 (After Execution):

Step 4: Reward Calculation
──────────────────────────

    Agent 1 (HOLD):
    ┌────────────────────────┐
    │ Portfolio Value at t:  │
    │ = 0.5 BTC × 60050 +    │
    │   7500 cash            │
    │ = 30025 + 7500 = 37525 │
    │                        │
    │ Portfolio Value at t+1:│
    │ = 0.5 BTC × 60050 +    │
    │   7500 cash            │
    │ = 30025 + 7500 = 37525 │
    │                        │
    │ Reward = 37525 - 37525 │
    │        = $0 (neutral)  │
    │                        │
    │ Q-Update:              │
    │ Q("P:60K|S:15|E:37K",  │
    │   "HOLD") += 0.01 × 0  │
    │ = no change            │
    └────────────────────────┘

    Agent 2 (BUY):
    ┌────────────────────────┐
    │ Placed buy order but   │
    │ NOT filled this step   │
    │ (waiting in book)      │
    │                        │
    │ Portfolio Value (order │
    │ reserved in calc):     │
    │ = Previous + order_val │
    │                        │
    │ Reward = Small negative│
    │ (opportunity cost,     │
    │ capital locked)        │
    │ = -$5 (est.)          │
    │                        │
    │ Q-Update:              │
    │ Q(state, "BUY") += 0.01 × -5
    └────────────────────────┘

    Agent 3 (SELL):
    ┌────────────────────────┐
    │ SOLD 0.3 BTC at        │
    │ $60,009.75 = $18,002.93│
    │                        │
    │ Previous portfolio:    │
    │ = Some BTC + cash      │
    │                        │
    │ New portfolio value:   │
    │ = (remaining BTC ×     │
    │   price) + increased   │
    │   cash                 │
    │                        │
    │ If was underwater:     │
    │ Reward = +$200 (profit)│
    │                        │
    │ If was profitable:     │
    │ Reward = -$500 (loss)  │
    │                        │
    │ Q-Update reflects:     │
    │ This state + SELL      │
    │ led to this outcome    │
    └────────────────────────┘


Step 5: Learning Update (Temporal Difference Learning)
──────────────────────────────────────────────────

    AGENT 1 Q-LEARNING UPDATE
    ─────────────────────────
    
    Formula: Q(s,a) ← Q(s,a) + α[r + γ·max(Q(s',a')) - Q(s,a)]
    
    Where:
    - s = "P:60K|S:15|E:37K" (previous state)
    - a = "HOLD" (action taken)
    - r = 0 (reward received)
    - s' = new state (after execution)
    - α = 0.01 (learning rate)
    - γ = 0.99 (discount factor)
    
    OLD Q-value: Q(s, "HOLD") = 0.05
    MAX next Q: max(Q(s', a)) = 0.08
    
    NEW Q-value = 0.05 + 0.01 × [0 + 0.99 × 0.08 - 0.05]
                = 0.05 + 0.01 × [0 + 0.0792 - 0.05]
                = 0.05 + 0.01 × 0.0292
                = 0.05 + 0.000292
                = 0.050292 ✓ (slight improvement)
    
    Stored in agent's Q-value table:
    ┌────────────────────────────────┐
    │ qValues Map {                  │
    │   "P:60K|S:15|E:37K" → 0.050292
    │   "P:60K|S:20|E:37K" → 0.043
    │   ...                          │
    │ }                              │
    └────────────────────────────────┘


    AGENT 2 POLICY NETWORK BACKPROPAGATION
    ──────────────────────────────────────
    
    Forward pass output:
    [P(BUY)=0.15, P(SELL)=0.25, P(HOLD)=0.45, ...]
    
    Action taken: BUY (index 0)
    Reward: -$5
    
    Gradient: ∇J(θ) = ∇ log π(a|s) · (r - baseline)
                    = ∇ log(0.15) · (-5)
    
    Update weights to DECREASE probability of BUY in this state
    (since it led to loss)
    
    New forward pass will output:
    [P(BUY)=0.12, P(SELL)=0.27, P(HOLD)=0.46, ...]
    
    Effect: Agent 2 learns "don't buy in this market condition"


    AGENT 3 IMPROVED EXPLOIT
    ────────────────────────
    
    Reward: +$200 (profitable scalp)
    Q(state, "SELL") updated upward
    
    Next time in similar state:
    → Agent 3 MORE LIKELY to SELL (higher Q-value)
    → Policy network increases P(SELL)
    
    Emergent behavior: Agent 3 specializes in scalping


Step 6: Exploration Decay
─────────────────────────

    For all agents:
    
    OLD epsilon = 0.05
    NEW epsilon = 0.05 × 0.995 = 0.04975
    
    Over 1000 steps:
    ε decreases from 0.1 → 0.006 (mostly exploiting)
    
    Agent shifts from:
    - Early: 10% random exploration
    - Late:  0.6% random exploration


---

4. TOURNAMENT-SPECIFIC FLOWS
============================

A. SINGLE TOURNAMENT
──────────────────

    T=0 ────────────────────────────────────────────── T=3600s (1 hour)
    
    │ Init agents with $10k each
    │
    │     OBSERVATION → DECISION → EXECUTION → LEARNING → DECAY
    │     └─── Repeat every 1 second for 3600 iterations ───┘
    │
    │     Agent 1 learns: stable, +2.3% return
    │     Agent 2 learns: aggressive, but -1.5% return
    │     Agent 3 learns: scalping, +1.8% return
    │
    └──→ TOURNAMENT ENDS
        
        RANKINGS:
        1. Agent 1: $10,230 (+2.3%)
        2. Agent 3: $10,180 (+1.8%)
        3. Agent 2: $9,850 (-1.5%)


B. EVOLUTIONARY TOURNAMENT
──────────────────────────

    ROUND 1 (1 hour)
    ┌───────────────────────────┐
    │ 8 agents trade            │
    │ Rankings:                 │
    │ 1. AgentA: +$300 ✓ TOP    │
    │ 2. AgentB: +$150 ✓ TOP    │
    │ 3. AgentC: +$50           │
    │ 4. AgentD: +$30           │
    │ 5. AgentE: -$20           │
    │ 6. AgentF: -$100 ✗ ELIM   │
    │ 7. AgentG: -$150 ✗ ELIM   │
    │ 8. AgentH: -$200 ✗ ELIM   │
    └───────────────────────────┘
              │
              │ BREEDING PHASE
              ▼
    ┌───────────────────────────────────┐
    │ Survivors: A, B (keep Q-values)   │
    │ Mutations:                        │
    │ A' = Clone(A), mutate ±5%         │
    │ B' = Clone(B), mutate ±5%         │
    │ C' = Mutate(C) (random neighbor)  │
    │ D' = Mutate(D) (random neighbor)  │
    │                                   │
    │ New population: A, B, A', B', C'  │
    │ (+ 3 more mutations)              │
    └───────────────────────────────────┘
              │
              │ ROUND 2
              ▼
    ┌───────────────────────────┐
    │ 8 agents trade (evolved)  │
    │ Rankings:                 │
    │ 1. A': +$420 ✓ BETTER!    │
    │ 2. B': +$250 ✓ BETTER!    │
    │ 3. A:  +$300              │
    │ ...                       │
    │ 6. X: -$50 ✗ ELIM         │
    │ 7. Y: -$80 ✗ ELIM         │
    │ 8. Z: -$120 ✗ ELIM        │
    └───────────────────────────┘
              │
              │ REPEAT 3 more rounds
              ▼
    
    ROUND 5 (Final)
    ┌────────────────────────────┐
    │ Final standings:            │
    │ Winner: A''' +$900         │
    │ 2nd: B''' +$700            │
    │ (Heavily evolved)           │
    │                             │
    │ Evolution pressure:         │
    │ Weak → eliminated           │
    │ Strong → bred & improved    │
    │ Population skill ↑          │
    └────────────────────────────┘


C. CONTINUOUS LEARNING
──────────────────────

    TIME: Ongoing (never ends)
    
    Every SECOND:
    ├─ Agents observe market
    ├─ Agents decide & execute
    ├─ Orders fill with slippage
    └─ Learning happens immediately
    
    Every HOUR (in parallel):
    ├─ Replay last 100 trades
    ├─ For each trade:
    │  ├─ Recalculate if it was good
    │  ├─ Update Q-values
    │  └─ Backprop policy network
    ├─ Average improvement metrics
    └─ Continue trading
    
    Result:
    - Agents continuously improve
    - Never reach final "winner"
    - Reflects real market (always learning)


---

5. SHARED ORDER BOOK MECHANICS (Deep Dive)
==========================================

SCENARIO: Agent A wants to buy 5 BTC, Agent B wants to buy 2 BTC

BEFORE (Initial state):
┌───────────────────────────────────────┐
│        LIMIT ORDER BOOK               │
│  BIDS          │        │        ASKS │
│ $60,010 (10Q)  │        │ $60,090 (5) │
│ $60,000 (20Q)  │ SPREAD │ $60,150 (10)│
│ $59,950 (50Q)  │  40 bps │ $61,000 (50)│
│ $59,500 (200Q) │        │ $62,000 (100)
│                │        │             │
│ Best Bid: $60,010 / Best Ask: $60,090 │
└───────────────────────────────────────┘

EXECUTION:

Agent A places BUY order:
  - Price: $60,090 (at ask)
  - Quantity: 5
  - Side: BID

Order book checks for matches:
  - Does BID $60,090 match ASK $60,090? YES!
  - Match 5 qty against ASK level 1 (which has 5 qty)
  
Order execution:
  ┌─────────────────────────────┐
  │ MATCH:                      │
  │ Agent A's demand: 5 BTC     │
  │ ASK level 1: 5 BTC @ 60,090 │
  │                             │
  │ Fill quantity: min(5, 5) = 5
  │                             │
  │ SLIPPAGE CALCULATION:       │
  │ Agent A's order size = 5    │
  │ Market ask depth = 5+10+50+100= 165
  │                             │
  │ Slippage = (5 / 165) × 100 bp
  │          = 0.03 × 100       │
  │          = 3 bps            │
  │                             │
  │ Execution price:            │
  │ = 60,090 + 3 bps            │
  │ = 60,090.18                 │
  │                             │
  │ Agent A filled: 5 @ 60,090.18
  │ Cost: 5 × 60,090.18 = 300,450.90
  └─────────────────────────────┘

AFTER Agent A's fill:
┌───────────────────────────────────────┐
│        LIMIT ORDER BOOK               │
│  BIDS          │        │        ASKS │
│ $60,010 (10Q)  │        │ $60,150 (10)│ ← (top ask changed)
│ $60,000 (20Q)  │ SPREAD │ $61,000 (50)│
│ $59,950 (50Q)  │  140bps │ $62,000 (100)
│ $59,500 (200Q) │        │             │
│                │        │             │
│ ASK L1 fully consumed by Agent A      │
└───────────────────────────────────────┘

Agent B places BUY order:
  - Price: $60,090 (also at ask, but ask moved!)
  - Quantity: 2
  - Side: BID

Order book checks:
  - Does BID $60,090 match ASK $60,150? NO (60090 < 60150)
  - Agent B's order does NOT match
  - Added to BID book:

AFTER Agent B's order added (no fill):
┌───────────────────────────────────────┐
│        LIMIT ORDER BOOK               │
│  BIDS          │        │        ASKS │
│ $60,090 (2Q)   │        │ $60,150 (10)│ ← Agent B's order here
│ $60,010 (10Q)  │        │ $61,000 (50)│
│ $60,000 (20Q)  │ SPREAD │ $62,000 (100)
│ $59,950 (50Q)  │  60 bps │             │
│ $59,500 (200Q) │        │             │
│                │        │             │
│ Spread narrowed from 40 bps → 60 bps  │
│ (because Agent B's order improves bid)│
└───────────────────────────────────────┘

KEY INSIGHTS FROM THIS SCENARIO:

1. Order Size Matters
   - Agent A's 5 BTC moved market by 3 bps
   - Agent B's 2 BTC didn't fill (stuck in book)
   
2. Timing Matters
   - Agent A went first → got fill
   - Agent B went second → order waiting
   
3. Agents Learn
   - Agent A: "Large orders get filled but cost slippage"
   - Agent B: "Ask moved while I was ordering, need faster execution"
   
4. Adversarial Interaction
   - Agent A's order improved market spread for Agent B (wider bid-ask)
   - But Agent B then provides liquidity for future sellers
   - Both compete for same limited liquidity


---

6. COMPETITIVE DYNAMICS OVER TIME
=================================

EXAMPLE: 100-iteration tournament

ITERATION 1:
Agent A: Uniform random (ε=0.1) → buys randomly → loses money
Agent B: Uniform random (ε=0.1) → sells randomly → loses money
Agent C: Uniform random (ε=0.1) → holds randomly → neutral

ITERATIONS 2-10:
Agents start building Q-values:
- When price up, buying previous winner → increase Q(state, BUY)
- When price down, selling previous winner → increase Q(state, SELL)
- Holding during volatility → increase Q(state, HOLD)

ITERATION 25 (Quarter point):
Agent A has discovered: "Buy when competitors are selling"
Agent B has discovered: "Sell when price peaks"
Agent C has discovered: "Hold through noise, let others make mistakes"

Portfolios:
A: +$250 (best)
B: +$100 (middle)
C: +$50 (worst)

ITERATION 50 (Midpoint):
Agent A adapts to Agent B's strategy:
- "I see agent B selling peaks, so I should predict peaks too"
- Agent A now fights Agent B for sells at peaks
- Agents converge toward similar strategy = mutual inhibition

Portfolios:
A: +$400 (still ahead but growth slowing)
B: +$320 (catching up)
C: +$200 (learning from A & B's mistakes)

ITERATION 75:
Three distinct strategies emerge:
- Agent A: Momentum trader (buys trends)
- Agent B: Mean reversion trader (fades moves)
- Agent C: Arbitrageur (exploits bid-ask mismatches)

A & B's returns slowing (strategies canceling out)
C accelerating (exploits the conflict between A & B)

Final standings (Iteration 100):
1. Agent C: +$580 (arbitrage strategy won)
2. Agent A: +$450 (momentum but gets whipsawed)
3. Agent B: +$420 (mean reversion but slow)

Nash Equilibrium: No agent can improve by changing strategy alone
- A can't exploit B more without B adapting
- B can't beat A without changing
- C has found the only unchallenged niche


---

7. DATA STRUCTURES IN CODE
==========================

KEY DATA STRUCTURES:

1. Agent State
   ┌─────────────────────────────────┐
   │ MarlTradingAgent {              │
   │   agentId: string               │
   │   riskProfile: "CONSERVATIVE"   │
   │   initialCash: 10000            │
   │   cash: number                  │
   │   portfolio: {                  │
   │     symbol → {                  │
   │       quantity: number          │
   │       avgPrice: number          │
   │       unrealizedPnL: number     │
   │     }                           │
   │   }                             │
   │                                 │
   │   qValues: Map<StateKey, Qval>  │
   │   policyNetwork: {              │
   │     layers: NetworkLayer[]      │
   │     weights: number[][]         │
   │   }                             │
   │   epsilon: number               │
   │   learningRate: number          │
   │   gamma: number                 │
   │ }                               │
   └─────────────────────────────────┘

2. Observation
   ┌──────────────────────────────┐
   │ AgentObservation {           │
   │   currentPrice: number       │
   │   bidAsk: {bid, ask}         │
   │   spreadBps: number          │
   │   portfolio: Position[]      │
   │   cash: number               │
   │   equity: number             │
   │   equityHistory: number[]    │
   │   sentimentSignal: {         │
   │     score, confidence        │
   │   }                          │
   │   competitorOrders: {        │
   │     agentId → {bid, ask qty} │
   │   }                          │
   │ }                            │
   └──────────────────────────────┘

3. Order Book Entry
   ┌──────────────────────────────┐
   │ OrderBookEntry {             │
   │   orderId: string            │
   │   agentId: string            │
   │   side: "BID" | "ASK"        │
   │   price: number              │
   │   quantity: number           │
   │   timestamp: Date            │
   │   filled: number             │
   │ }                            │
   └──────────────────────────────┘

4. Competition Result
   ┌───────────────────────────────┐
   │ CompetitionResult {           │
   │   competitionId: string       │
   │   mode: "SINGLE"              │
   │   finalRankings: {            │
   │     agentId → {               │
   │       rank, capital, return   │
   │       sharpeRatio, maxDD      │
   │       tradesExecuted, winRate │
   │     }                         │
   │   }                           │
   │   headToHeadMetrics: [ ... ]  │
   │   competitorImpact: [ ... ]   │
   │   equityEvolution: [ ... ]    │
   │ }                            │
   └───────────────────────────────┘


---

8. CONCURRENCY & REAL-TIME EXECUTION
====================================

Time Synchronization:

    T=0:    Agents 1,2,3 observe simultaneously
    T=0:    Agents 1,2,3 decide simultaneously
    T=0:    Orders placed in sequence (handled)
    T=0:    Order book executed in sequence
    T=0:    Rewards calculated
    T=0:    Learning updates applied
    
    T=1000ms (1 second):    Repeat

Issues handled:
- No race conditions (sequential order processing)
- Fair execution (orders added in timestamp order)
- Deterministic matching (first in, first match)


---

SUMMARY: HOW IT ALL WORKS TOGETHER
==================================

1. INITIALIZATION
   └─ Engine creates N agents with $10k each
   └─ Each agent initialized with random Q-values, policy network

2. TOURNAMENT LOOP (Repeats every 1 second)
   └─ Each agent observes market state
   └─ Each agent decides action (BUY/SELL/HOLD) using ε-greedy
   └─ All actions placed on shared order book
   └─ Order book matches orders with realistic slippage
   └─ Rewards calculated (change in agent equity)
   └─ Q-values updated via temporal difference learning
   └─ Policy network updated via gradient descent
   └─ Exploration rate decayed
   
3. EMERGENT BEHAVIORS
   └─ Agents learn which strategies work vs. competitors
   └─ Arms race of intelligence as each adapts to others
   └─ Convergence to Nash Equilibrium or regional strategies
   └─ Weak agents eliminated (evolutionary mode)
   └─ Strong agents breed and improve
   
4. RESULTS COLLECTION
   └─ Final capital, returns, Sharpe ratio, max drawdown
   └─ Head-to-head matchup analysis
   └─ Competitor impact (liquidity effects)
   └─ Equity evolution over time

This creates a realistic market simulation where intelligence
emerges from competition, without pre-programmed rules.

