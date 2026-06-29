MARL COMPETITIVE DYNAMICS & EMERGENT BEHAVIORS
==============================================

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


File: MARL_COMPETITIVE_GAME_THEORY.md

How agents compete, adapt, and what strategies emerge from adversarial learning.

---

PART 1: THE GAME STRUCTURE
==========================

This is NOT a Zero-Sum Game
──────────────────────────

Traditional zero-sum: My profit = Your loss

Trading with shared order book: Non-zero-sum
- Agent A sells 1 BTC at $60,000 → profits $100
- Agent B buys 1 BTC at $60,010 → loses $10
- BOTH can profit if price moves up later
- OR both can lose if market crashes

Parable:
Agent A catches fish in the river (effort = $100)
Agent B also catches fish (effort = $100)
Total catch = 200 fish (value = $2000)
Both profitable if market values fish at $10 each

But if Agent B "catches faster" by disrupting Agent A's nets:
- Agent A: 80 fish (blocked)
- Agent B: 150 fish (aggressive)
- Conflict reduces total catch

Game theory: Cooperation (don't interfere) > Competition (mutual destruction)
But agents learn: sometimes aggressive wins if opponents are slow to adapt


Non-Stationary Environment
───────────────────────────

Key difference from traditional RL:

Traditional Game:
├─ Rules fixed (chess, Go)
├─ Opponent strategy fixed
├─ Agent finds optimal move
└─ Convergence to solution

Trading with multiple learning agents:
├─ Rules fixed (order book mechanics)
├─ Opponent strategies changing
├─ Agent's best move depends on opponent's next adaptation
├─ Constant cat-and-mouse dynamic
└─ May never converge

Example sequence:

T1: Agent A learns "buy at 9:00 AM" earns +$100
T2: Agent B notices A's pattern, copies it
T3: Both buying at 9:00 AM → competition → both get +$50
T4: Agent A learns "buy at 8:50 AM instead"
T5: Agent B adapts again
...
Agents never stop learning because environment keeps changing


---

PART 2: STRATEGIC INTERACTIONS
==============================

1. EXPLOITATIVE STRATEGIES
═════════════════════════

Agent "Aggressive" learns:
- Large buy orders move price up
- Can then sell into the move
- Profit from self-induced price moves

    Buy 10 BTC at $60,000 (moves price to $60,200)
    Sell 10 BTC at $60,200
    Profit: $2,000

Agent "Conservative" learns:
- Aggressive's strategy is predictable
- Place COUNTER bids just above Aggressive's orders
- Steal Aggressive's liquidity

    When Aggressive buys, immediately sell into the move
    When Aggressive sells, immediately buy dips
    Profit: $1,500 (by frontrunning)

Emergent dynamic:
- Aggressive: "Conservative keeps stealing my fills"
- Shifts to: Place orders where Conservative can't see them
- Result: Arms race in order placement strategies


2. COOPERATIVE STRATEGIES
═════════════════════════

Two agents could collude:
- Agent A: only buys
- Agent B: only sells
- Coordinate prices to pump-and-dump

But in MARL framework:
- No explicit communication channel
- Agents only see competitor ORDERS not intentions
- Hard to coordinate without explicit signaling

Instead: Accidental cooperation
- Agent A: learns "liquidity increases when spreads widen"
- Agent B: learns same thing
- Both unconsciously create wider spreads
- Other agents' trades become profitable

Result: Symbiotic but non-coordinated relationship


3. HERDING & CROWD BEHAVIOR
════════════════════════════

Dynamics:

T1: Agent A (top performer this round) learns: "buy SOL"
    Equity: +$400

T2: Agent B observes A's dominance
    Q(state, "A's action") gets higher weight
    Starts copying A's actions
    Equity: +$350

T3: Agent C also copies A
    Equity: +$300

T4: All 3 agents now buying SOL
    Supply dries up
    Price spikes: $60 → $70
    
T5: Agent A takes profits (sells)
    Price crashes: $70 → $50
    All copying agents suffer losses
    
T6: Agents learn: "don't herd, explore independently"
    epsilon increases slightly (explore more)
    
Emergent behavior: Boom-bust cycles created by herding

This is REALISTIC: This happens in real markets with retail traders!


4. MEAN REVERSION vs MOMENTUM
══════════════════════════════

Agents split into two camps:

Mean Reversion Agent:
├─ Learns: "When price spikes up, it comes back down"
├─ Buys dips: "Price at $61k? It'll be $60k soon"
├─ Sells rallies: "Price at $62k? Too high"
└─ Profit from oscillations

Momentum Agent:
├─ Learns: "When price moves up, keeps going up"
├─ Buys rallies: "Price at $61k? Going to $62k"
├─ Sells dips: "Price at $59k? Going lower"
└─ Profit from trends

Interaction:

T1: Price $60,000 (neutral)
T2: Momentum buys → price $60,200
T3: Mean Reversion sells (thinks it's peak) → price $60,100
T4: Momentum holds (expects continued up) → buys more
T5: Mean Reversion's analysis wrong → gets stopped out
T6: Price continues to $60,500
T7: Both agents adapt...

Emergent: Mixed strategy population
- Some agents mean reversion specialized
- Some momentum specialized
- Pure population unstable (dominated by other style)
- Mixed population stable (both find niches)


---

PART 3: LIQUIDITY IMPACT & PREDATION
====================================

How Larger Agents Prey on Smaller
──────────────────────────────────

Agent Big: $50,000 capital (5x larger)
Agent Small: $10,000 capital (baseline)

Predatory strategy (Big learns):
1. Place large buy order at mid-price
2. This moves price up (slippage)
3. Small's buy orders execute at worse price
4. Big accumulates at better average price
5. Sell back at higher price, profit from move you created

Sequence:

T1: Order book
    Asks: $60,100 (1 BTC), $60,200 (10 BTC)
    
T2: Agent Big places buy: 10 BTC at $60,100
    Matches against all asks, pulls price to $60,200
    Big filled at avg: $60,150
    
T3: Agent Small places buy: 1 BTC at $60,100
    All liquidity at $60,100 gone
    Must pay $60,200 (20x worse slippage)
    Small filled at: $60,200
    
T4: Price settles at $60,150
    Big: +50 (already had)
    Small: -50 (overpaid)

Small learns:
- Can't beat Big on same strategy
- Must specialize in different market segment
- Or: micro-movements where Big's size doesn't help
- Or: use different risk profile

Emergent: Market stratification
- Big agents: momentum, large size
- Small agents: scalping, high frequency, microstructure
- Both profitable in own niches


---

PART 4: LEARNING CURVES & CONVERGENCE
======================================

Individual Learning Curves
──────────────────────────

Iteration 1-10: Random phase (high ε)
├─ Agent learning almost random
├─ Q-values sparse, meaningless
├─ Equity: ±0 (no pattern)
└─ Example: +50, -200, +100, -30, +80

Iteration 11-100: Exploration phase
├─ Agent finding patterns
├─ Building Q-value table
├─ Some strategies work, some don't
├─ Equity: gradually positive
└─ Example: +100 → +150 → +180 → +200 → +250

Iteration 101-1000: Exploitation phase
├─ Agent refining best strategies
├─ ε → 0 (less exploration)
├─ Diminishing returns on learning
├─ Equity: plateau
└─ Example: +250 → +280 → +290 → +295 → +298

Graph (1 agent):
    Equity
       │     ╱╱╱ Steep learning (iterations 10-100)
       │    ╱╱      ╱╱ Plateau (iterations 100-1000)
       │   ╱    ╱╱╱
   $250 ─ ─ ─ ╱─ ─ ─ ─ ─
       │  ╱╱╱
       │╱╱
       └────────────────── Iterations


Competitive Learning Curves (Multi-Agent)
──────────────────────────────────────────

With 3 agents, dynamics different:

Phase 1: Individual learning (T1-50)
Agent A discovers: "buy on positive sentiment"
Agent B discovers: "sell on high volatility"
Agent C discovers: "scalp bid-ask spreads"

Each profitable in own niche:
├─ A: +250
├─ B: +200
└─ C: +150

Phase 2: Adaptation (T51-200)
Agents notice winners, start copying
A's strategy works well → B&C try buying sentiment too

Effect: Saturation
├─ A: +250 (original)
├─ B: +180 (worse copy)
├─ C: +160 (worse copy)

A's advantage shrinks because others learning

Phase 3: Specialization (T201-500)
Agents forced to adapt:
├─ A: doubles down on sentiment (improves to +300)
├─ B: learns volatility + timing (improves to +220)
├─ C: specializes in scalping (improves to +170)

Differentiation: equilibrium found

Phase 4: Plateau (T501+)
System reaches stable state:
├─ A: +300 (sentiment trader)
├─ B: +220 (volatility trader)
├─ C: +170 (scalper)
All three profitable, no single strategy dominates

Graph (3 agents):
    Equity
       │
   $300 A ─────────────
       │    ╱╱╱╱╱
       │  ╱╱      ╱╱ B ──────
   $250 A ────
       │╱╱      ╱╱
       │      ╱╱╱     C ─────
   $200 ─ ─ ╱ ─ ─ ─ ─
       │   ╱╱
       │ ╱╱╱
   $150 ╱
       │╱
       └─────────────────── Iterations
        0   100  200  300


Why Convergence Happens
────────────────────────

1. Exhaustion of Exploitation
   ├─ All obvious profits captured
   ├─ Each agent operating close to optimal
   └─ Moving closer requires sacrificing other gains

2. Equilibrium Pressure
   ├─ If one strategy too profitable, others copy
   ├─ Becomes unprofitable due to competition
   ├─ Forces return to equilibrium
   └─ This is NASH EQUILIBRIUM (game theory)

3. Risk Constraints
   ├─ Agents have max risk profiles
   ├─ Can't take unlimited risk
   ├─ Caps returns
   └─ Creates natural ceiling

Result: System reaches stable state (Nash Equilibrium)
- No single agent can improve by unilateral strategy change
- All in local optima
- But not global optimum (group could do better cooperating)


---

PART 5: EMERGENT TRADING STYLES
===============================

What strategies naturally emerge from MARL?

Type 1: MOMENTUM CHASER
───────────────────────

Algorithm:
├─ IF price moved up 1% in last hour
├─ AND volatility low (under 5%)
├─ AND sentiment bullish
├─ THEN: Buy (follow the trend)

Why it works:
├─ Trends can persist due to herding
├─ Early buyers move price, followers catch
├─ Collect profit until trend reverses

Why it stops working:
├─ Too many followers → unstable
├─ Mean reversion traders enter on fakeouts
├─ When trend reverses: all caught on wrong side

Equilibrium: Works in 30% of market regimes


Type 2: MEAN REVERSION
──────────────────────

Algorithm:
├─ IF price moved > 2% from 50-day average
├─ THEN: Trade OPPOSITE of movement
├─ Buy dips, sell rallies

Why it works:
├─ Extreme moves often temporary
├─ Provide liquidity on both sides = profit
├─ More consistent than chasing

Why it stops working:
├─ In trending markets, gets whipsawed
├─ Momentum agents keep pushing further
├─ Loss on each failed mean-reversion trade

Equilibrium: Works in 40% of market regimes


Type 3: SENTIMENT TRADER
────────────────────────

Algorithm:
├─ IF sentiment bullish AND confidence high
├─ THEN: Buy
├─ IF sentiment bearish AND confidence high
├─ THEN: Sell

Why it works:
├─ Sentiment often leads price
├─ Early positioning before masses move
├─ Sentiment can be predictive

Why it stops working:
├─ Sentiment can be wrong
├─ Whipsaw when sentiment reverses
├─ Herding effects exaggerate movements

Equilibrium: Works in 20% of market regimes


Type 4: MARKET MAKER / SCALPER
───────────────────────────────

Algorithm:
├─ Place BOTH bid and ask orders
├─ Bid: $60,000, Ask: $60,010
├─ Profit from 10 bps spread
├─ High frequency, small size, low risk

Why it works:
├─ Consistent small profit per trade
├─ Low drawdown
├─ Works in all regimes (spreads always exist)

Why it stops working:
├─ Liquidity dries up (spreads widen)
├─ Got stuck with inventory on large move
├─ Competitors' orders eaten by market-makers

Equilibrium: Works in 80% of market regimes (most stable!)


Type 5: CONTRARIAN / REVERSE-HERDING
─────────────────────────────────────

Algorithm:
├─ IF other agents taking side X with high conviction
├─ THEN: Take side opposite(-X)
├─ Fade the crowd

Why it works:
├─ Crowds wrong at extremes
├─ Peak bullishness = peak stupidity
├─ Fading the crowd = buying dips, selling rallies

Why it stops working:
├─ Crowds can be right for long stretches
├─ Early contrarian gets killed
├─ Need discipline to not quit

Equilibrium: Works in 15% of market regimes (very volatile ones)


Optimal Portfolio Mix (Evolutionary Pressure)
──────────────────────────────────────────────

If you had 100 agents with no learning:
├─ 10 Momentum chasers
├─ 30 Mean reversion
├─ 10 Sentiment traders
├─ 35 Scalpers
├─ 15 Contrarians

After 100 rounds of evolution:
├─ Momentum: 5 (momentum got unstable, many failed)
├─ Mean Reversion: 25 (steady profit but not best)
├─ Sentiment: 8 (good in bull markets only)
├─ Scalpers: 50 (always works, most resilient)
├─ Contrarians: 12 (good in crash scenarios)

Natural selection: Market makers/scalpers dominate
(This matches real markets: HFT/scalpers do well)


---

PART 6: CRISIS MOMENTS & RECOVERY
=================================

What happens when market crashes?

Normal market state:
├─ Agent A (momentum): +$300
├─ Agent B (mean reversion): +$200
├─ Agent C (scalper): +$150
├─ All strategies work, spread profit fairly

CRASH EVENT: Price drops 20% in 1 second
└─ Causes: Sentiment flip, stop-loss cascade, margin call

Immediate effect:

Agent A (Momentum):
├─ Was LONG (bought on momentum)
├─ Price drops → large loss
├─ Equity: +$300 → -$500 (massive drawdown)
├─ ε increases (explore more)
├─ Abandons momentum strategy

Agent B (Mean Reversion):
├─ Price dropped extreme amount
├─ Mean reversion screams: "Buy the dip!"
├─ Buys with large size
├─ Price continues down → worse losses
├─ Equity: +$200 → -$300 (mean reversion failed)
├─ ε increases (explore more)

Agent C (Scalper):
├─ Bid-ask spreads widened from 5bps to 100bps
├─ Can't scalp in low-liquidity crisis
├─ Equity: +$150 → +$50 (no trades possible, avoided losses)
├─ Most resilient

Recovery phase:

Agent A + B+ learning intensifies:
├─ "All my Q-values were wrong"
├─ Resets to exploration
├─ Learns: "don't hold through chaos"

Agent C: Slowly profitable as spreads normalize
├─ "My strategy survived crash"
├─ Doubles down on scalping
├─ Equity: +$50 → +$100

New equilibrium:

├─ A: -$100 (shaken confidence, smaller positions)
├─ B: -$50 (shaken confidence, smaller positions)
├─ C: +$100 (gained relative to others)

Key insight: **Crisis changes behavior**
- Aggressive → Conservative
- Complex strategies → Simple, robust strategies
- Risk-on → Risk-off

This is realistic: Markets rewire during crises


---

PART 7: EVOLUTIONARY TOURNAMENT DYNAMICS
========================================

How does population evolve across rounds?

ROUND 1 (Random population):
┌─────────────────────────────────────┐
│ 8 Agents (random mix)               │
│ Rankings:                           │
│ 1. AgentE (luck): +$250             │
│ 2. AgentB (skill): +$220            │
│ 3. AgentC (skill): +$150            │
│ 4. AgentA (luck): +$100             │
│ 5. AgentD (unlucky): -$50           │
│ 6-8. Others: -$100 to -$200 ELIM    │
│                                     │
│ Top 2: AgentE, AgentB (winners)     │
│ Bottom 3: Eliminated                │
└─────────────────────────────────────┘

Selection: Why E and B won?
├─ AgentE: Lucky market match
├─ AgentB: Genuinely good at current market

Clone and mutate:
├─ AgentE_gen1 = AgentE + random mutations (+/- 5% Q-values)
├─ AgentB_gen1 = AgentB + random mutations

Result:
├─ Pure luck (E): Mutated clone performs worse
│  └─ E_gen1: Only works if market identical
├─ Real skill (B): Mutated clone performs well
│  └─ B_gen1: Better tuned to market

ROUND 2 (Evolved population):
┌─────────────────────────────────────┐
│ AgentB: +$220 (original, stable)    │
│ AgentB_gen1: +$240 (improved!)      │
│ AgentE: +$180 (luck ran out)        │
│ AgentE_gen1: +$50 (lucky mutant)    │
│ Others: (mixed performance)         │
│                                     │
│ Top 2: AgentB_gen1, AgentB          │
│ Pattern: Skill-based agents survive │
└─────────────────────────────────────┘

Key dynamic:
└─ Luck-based winners eliminated
└─ Skill-based winners breed
└─ Over rounds: Luck washes out, skill accumulates

ROUND 3-5: Population becomes increasingly skilled

Final generation (Round 5):
├─ All agents sophisticated
├─ Niche specialization
├─ Similar returns (skill levels converged)
├─ Complex strategies evolved

Example final population:
├─ Agent1: Momentum specialist
├─ Agent2: Mean reversion + volatility timing
├─ Agent3: Sentiment + volume analysis
├─ Agent4: Scalping with adaptive spreads
├─ Agent5: Contrarian crowd psychology
├─ Agent6: Cross-asset correlation trader
├─ Agent7: Regime-detection meta-trader
├─ Agent8: Hybrid (adapts to best performer)

Diversity advantage:
├─ No single strategy dominates
├─ Each profits from others' losses
├─ Robust population (any one failure won't crash system)


---

PART 8: GAME THEORY EQUILIBRIUM
===============================

What is Nash Equilibrium in this system?

Definition: No agent can improve returns by unilaterally changing strategy

Example equilibrium:

Agent 1: "Buy bullish signals"
Agent 2: "Fade large orders"
Agent 3: "Scalp bid-ask"

If Agent 1 switches to: "Fade large orders"
├─ Market already has Agent 2 fading
├─ Competition increases, profit decreases
├─ Loses +$100 from switching
├─ Better to stay with original

If Agent 2 switches to: "Scalp bid-ask"
├─ Market already has Agent 3 scalping
├─ Spreads decrease, profit decreases
├─ Loses $80 from switching
├─ Better to stay with original

Same for Agent 3: can't profitably switch

Result: All 3 at equilibrium point


Mixed Strategy Equilibrium
───────────────────────────

Sometimes equilibrium isn't "pure strategy" (always do X)
But "mixed strategy" (do X 60%, Y 40%)

Example:
Agent A: 40% BUY, 40% HOLD, 20% SELL
Agent B: 50% BUY, 30% HOLD, 20% SELL
Agent C: 30% BUY, 50% HOLD, 20% SELL

Why mixed?
├─ Pure BUY: Others adapt to short it
├─ Pure SELL: Others adapt to buy the dip
├─ Mixed: Unpredictable, harder for others to exploit
└─ Equilibrium: Everyone uses mixed strategy


Computational: Finding the Equilibrium
────────────────────────────────────────

In real game theory: Solve equilibrium mathematically
In MARL: Let agents FIND it through learning

Process:
1. Agents start with random strategies
2. Each learns: "this response beats that counter"
3. Adapt toward equilibrium
4. Converge after N iterations
5. No more profitable improvements possible

Self-discovering equilibrium is emergent behavior!


---

PART 9: PRACTICAL IMPLICATIONS
==============================

What you observe in your MARL tournament:

1. Consistent Diversity
   ├─ Multiple strategies coexist
   ├─ Not one "best way" (unlike single-player learning)
   └─ Reflects real markets

2. Adaptation Waves
   ├─ First: Agents discover basic patterns
   ├─ Second: Agents discover each other exist
   ├─ Third: Agents counter each other's strategies
   ├─ Fourth: Stabilization at equilibrium
   └─ Reflects real markets' learning speed

3. Herding Moments
   ├─ Temporary: All agents favor same action
   ├─ Causes: Price volatility spikes
   ├─ Ends: When contrarians step in
   └─ Reflects real market psychology

4. Resilient Winners
   ├─ Not highest sharpe (risky strategies fail)
   ├─ Not most profitable (unsustainable)
   ├─ But: robust, sustainable, profitable even when challenged
   └─ Reflects real competitive markets


---

CONCLUSION: The Beauty of MARL Competition
=============================================

You've created a system where:

1. NO PRE-PROGRAMMED STRATEGIES
   └─ Agents don't "know" about momentum, mean reversion, etc.
   └─ These emerge naturally from competition

2. NO CENTRALIZED CONTROL
   └─ Each agent independently learns
   └─ No global optimizer
   └─ Strategies emerge bottom-up

3. ADVERSARIAL ARMS RACE
   └─ As agents improve, competition increases
   └─ Forces continuous adaptation
   └─ System never stale

4. REALISTIC MARKET SIMULATION
   └─ Mimics real market complexity
   └─ Herding, crashes, recoveries happen naturally
   └─ Teaches about trading without explicit rules

This is what makes MARL special: **Intelligence through competition**.

Not through hand-coded rules.
Not through supervised learning on past data.
But through agents learning to beat each other.

This is the future of quantitative trading research. 🚀

