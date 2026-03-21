/**
 * PreTrainer — bootstraps MarlTradingAgent learning states using synthetic
 * market scenarios before agents enter their first live competition.
 *
 * Pre-training gives agents a non-random starting point so they spend less
 * of each real tournament on pure exploration.  The trained state is injected
 * into the engine's persistence layer via `MarlCompetitionEngine.injectPretrainedState()`
 * so subsequent competitions automatically load it.
 *
 * Usage:
 *   const trainer = new PreTrainer();
 *   const result  = await trainer.pretrain('bull', 'AGGRESSIVE', engine, { episodes: 100 });
 */

import { MarlTradingAgent, MarlCompetitionEngine } from './marl-competition-engine.js';
import type { AgentObservation } from './marl-competition-engine.js';
import { SyntheticMarketGenerator } from './synthetic-market-generator.js';
import type { MarketRegime, SyntheticBar } from './synthetic-market-generator.js';
import logger from '../logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';

/** Options for a single `pretrain()` call. */
export interface PreTrainOptions {
  /** Number of full episodes (synthetic price series) to run.  Default: 100. */
  episodes?:        number;
  /** Price steps per episode.  Default: 1000.  Clamped to [500, 2000]. */
  stepsPerEpisode?: number;
  /** Regimes to include.  Default: all five. */
  regimes?:         MarketRegime[];
  /** Starting capital for simulation.  Default: 10 000. */
  initialCapital?:  number;
}

/** Return value of `pretrain()`. */
export interface PreTrainingResult {
  agentId:          string;
  riskProfile:      RiskProfile;
  episodes:         number;
  avgReturn:        number;
  bestReturn:       number;
  /**
   * Average return per 10-episode block — use as the convergence curve.
   * Length ≈ ceil(episodes / 10).
   */
  convergenceCurve: number[];
  finalEpsilon:     number;
  status:           'completed';
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Experience-replay calls per episode (end-of-episode burst). */
const REPLAY_BURST = 16;

/** Sliding window kept for `equityHistory` observations. */
const EQUITY_WINDOW = 20;

// ── PreTrainer ────────────────────────────────────────────────────────────────

/**
 * Runs a `MarlTradingAgent` through synthetic market scenarios and persists
 * the resulting policy into the engine's learning-state cache + SQLite.
 */
export class PreTrainer {
  private readonly generator = new SyntheticMarketGenerator();

  /**
   * Pre-train an agent for `agentId` / `riskProfile` using synthetic markets.
   *
   * If prior learning state already exists for this agent it is loaded first,
   * making subsequent pre-training calls additive.
   *
   * @param agentId     - Agent identifier (matches CompetitionAgentSpec.id)
   * @param riskProfile - Risk profile for the agent
   * @param engine      - Running MarlCompetitionEngine instance for state I/O
   * @param options     - Training configuration
   */
  async pretrain(
    agentId:     string,
    riskProfile: RiskProfile,
    engine:      MarlCompetitionEngine,
    options:     PreTrainOptions = {},
  ): Promise<PreTrainingResult> {
    const {
      episodes        = 100,
      stepsPerEpisode = 1000,
      regimes,
      initialCapital  = 10_000,
    } = options;

    logger.info('pre-trainer: starting', { agentId, riskProfile, episodes });

    // Create a temporary agent for training (not registered in the competition).
    const agent = new MarlTradingAgent(
      { agentId, type: 'ML_BASED', riskProfile, initialCapital },
      /* useSentimentFeatures */ false,
    );

    // Load prior state so pre-training is additive across calls.
    const prior = engine.getAgentLearningState(agentId, riskProfile);
    if (prior) {
      agent.importLearningState(prior);
      logger.info('pre-trainer: loaded prior state', { agentId });
    }

    const episodeReturns: number[] = [];
    const SYMBOL = 'SYNTHETIC';

    for (let ep = 0; ep < episodes; ep++) {
      const series  = this.generator.generate(SYMBOL, { steps: stepsPerEpisode, regimes });
      const result  = this.runEpisode(agent, series.bars, SYMBOL, initialCapital);
      episodeReturns.push(result.totalReturn);

      if ((ep + 1) % 10 === 0) {
        const recent = episodeReturns.slice(-10);
        const avg    = recent.reduce((a, b) => a + b, 0) / recent.length;
        logger.debug('pre-trainer: progress', { agentId, episode: ep + 1, recentAvgReturn: avg.toFixed(4) });
      }
    }

    // Persist the trained learning state.
    engine.injectPretrainedState(agentId, riskProfile, agent.exportLearningState());
    logger.info('pre-trainer: state persisted', { agentId, riskProfile, episodes });

    // Build convergence curve (one point per 10-episode block).
    const convergenceCurve: number[] = [];
    for (let i = 0; i < episodeReturns.length; i += 10) {
      const block = episodeReturns.slice(i, i + 10);
      convergenceCurve.push(block.reduce((a, b) => a + b, 0) / block.length);
    }

    const avgReturn  = episodeReturns.reduce((a, b) => a + b, 0) / episodeReturns.length;
    const bestReturn = Math.max(...episodeReturns);

    return {
      agentId,
      riskProfile,
      episodes,
      avgReturn,
      bestReturn,
      convergenceCurve,
      finalEpsilon: agent.epsilon,
      status: 'completed',
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Simulate one episode: step through all bars, build observations, act, learn.
   */
  private runEpisode(
    agent:          MarlTradingAgent,
    bars:           SyntheticBar[],
    symbol:         string,
    initialCapital: number,
  ): { totalReturn: number; tradesExecuted: number } {
    let cash          = initialCapital;
    let holdings      = 0;          // quantity of symbol held
    let avgEntryPrice = 0;
    let tradesExecuted = 0;
    const equityHistory: number[] = [initialCapital];
    let prevEquity    = initialCapital;
    let prevObs: AgentObservation | null = null;

    for (const bar of bars) {
      const price        = bar.price;
      const unrealizedPnl = holdings > 0 ? (price - avgEntryPrice) * holdings : 0;
      const equity       = cash + holdings * price;

      // Maintain sliding equity window.
      equityHistory.push(equity);
      if (equityHistory.length > EQUITY_WINDOW) equityHistory.shift();

      const obs: AgentObservation = {
        currentPrice:    price,
        bidAsk:          { bid: price * 0.9995, ask: price * 1.0005 },
        spreadBps:       10,
        portfolio:       holdings > 0.000_01
          ? [{ symbol, quantity: holdings, avgPrice: avgEntryPrice, unrealizedPnl }]
          : [],
        cash,
        equity,
        equityHistory:   [...equityHistory],
        sentimentSignal: {
          symbol,
          signal:            bar.sentimentSignal,
          strength:          bar.sentimentStrength,
          target_price_high: price * 1.05,
          target_price_low:  price * 0.97,
          stop_loss:         price * 0.95,
          reasoning:         `synthetic ${bar.regime}`,
          risk_reward_ratio: 1.4,
        },
        competitorOrders: [],
      };

      // Deliver reward from the previous step then learn.
      if (prevObs !== null) {
        const reward = equity - prevEquity;
        agent.learn(reward, obs);
      }

      // Select and simulate action.
      const action = agent.computeAction(obs);

      switch (action.type) {
        case 'BUY': {
          const qty = action.quantity ?? 0;
          const cost = qty * price;
          if (qty > 0.000_01 && cash >= cost) {
            avgEntryPrice = holdings > 0.000_01
              ? (avgEntryPrice * holdings + price * qty) / (holdings + qty)
              : price;
            holdings += qty;
            cash     -= cost;
            tradesExecuted++;
          }
          break;
        }
        case 'SELL': {
          const qty = Math.min(action.quantity ?? holdings, holdings);
          if (qty > 0.000_01) {
            cash     += qty * price;
            holdings -= qty;
            holdings  = Math.max(holdings, 0);
            tradesExecuted++;
          }
          break;
        }
        default:
          // HOLD / WAIT / CANCEL — no position change.
          break;
      }

      prevEquity = equity;
      prevObs    = obs;
    }

    // End-of-episode experience replay burst for off-policy learning.
    agent.replayExperiences(REPLAY_BURST);

    const lastPrice  = bars[bars.length - 1]?.price ?? 0;
    const finalEquity = cash + holdings * lastPrice;
    return {
      totalReturn:    (finalEquity - initialCapital) / initialCapital,
      tradesExecuted,
    };
  }
}
