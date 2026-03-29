/**
 * AdversarialTrainer — Phase 3 of the Evolutionary Agent System
 *
 * Creates short-lived adversary agents whose genomes are deliberately inverted
 * relative to their sentiment targets, runs them in a combined competition, then
 * retires them.  Sentiment agents that outperform their paired adversary receive a
 * `beatsAdversary` flag so the FitnessCalculator can apply a +10 % bonus in the
 * main tournament ranking.
 *
 * Flow (per round):
 *   1. Rank current sentiment population by fitness.
 *   2. Pick top `adversaryPopulationSize` sentiment agents as "targets".
 *   3. For each target, derive an adversary genome via `buildAdversaryGenome`.
 *   4. Register temporary adversary agents in `agent_registry`.
 *   5. Run a competition with the full combined population.
 *   6. Compare head-to-head: if sentiment_fitness ≥ adversary_fitness → sentiment wins.
 *   7. Retire all adversary agents.
 *   8. Return AdversarialRoundSummary (includes `beatingAgentIds`).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  GenomeManager,
  type AgentGenome,
  ADVERSARY_GENE_BOUNDS,
  GENE_BOUNDS,
} from './agent-genome.js';
import { FitnessCalculator, type AgentStats } from './fitness-calculator.js';
import { AgentStatisticsManager } from './agent-statistics-manager.js';
import { MarlCompetitionEngine } from '../marl-competition-engine.js';
import type { CompetitionConfig } from '../marl-competition-engine.js';
import logger from '../../logger.js';

type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';

// ── Public types ──────────────────────────────────────────────────────────────

/** Outcome of a single sentiment-vs-adversary head-to-head matchup. */
export interface AdversarialMatchup {
  sentimentAgentId: string;
  adversaryAgentId: string;
  sentimentFitness: number;
  adversaryFitness: number;
  /** True when the sentiment agent achieved fitness ≥ the adversary. */
  sentimentWon: boolean;
}

/** Aggregate summary returned by `runAdversarialRound`. */
export interface AdversarialRoundSummary {
  generation: number;
  sentimentAgentsCount: number;
  adversaryAgentsCount: number;
  matchups: AdversarialMatchup[];
  /** Percentage of matchups won by sentiment agents (0–100). */
  sentimentWinRate: number;
  /** IDs of sentiment agents that beat at least one adversary in this round. */
  beatingAgentIds: string[];
}

/** Configuration for a single adversarial round. */
export interface AdversarialRoundConfig {
  symbols: string[];
  initialCapital: number;
  duration: number;
  adversaryPopulationSize: number;
}

// ── AdversarialTrainer ────────────────────────────────────────────────────────

export class AdversarialTrainer {
  private readonly genomeManager: GenomeManager;
  private readonly fitnessCalc:   FitnessCalculator;
  private readonly statsManager:  AgentStatisticsManager;
  private readonly marlEngine:    MarlCompetitionEngine;

  constructor(private readonly db: Database.Database) {
    this.genomeManager = new GenomeManager(db);
    this.fitnessCalc   = new FitnessCalculator();
    this.statsManager  = new AgentStatisticsManager(db);
    this.marlEngine    = new MarlCompetitionEngine();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Derive an adversary genome from `targetGenome` by inverting the key
   * behavioural genes:
   *
   *   entryThreshold : mapped from [30,80] → [20,50] (inverted — lower ≡ more aggressive)
   *   exitThreshold  : mapped from [20,70] → [60,90] (inverted — higher ≡ exits later)
   *   stopLossPct    : scaled to 40 % of original, clamped to [1,5]
   *   takeProfitPct  : scaled to 40 % of original, clamped to [1,8]
   *   positionSizePct: scaled to 150 % of original, clamped to [20,30]
   *   riskPercent    : scaled to 180 % of original, clamped to [3,5]
   *   holdDurationMax: scaled to 40 % of original (integer), clamped to [1,5]
   *
   * Learning hyperparameters are inherited unchanged.
   */
  buildAdversaryGenome(targetGenome: AgentGenome): AgentGenome {
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    // Invert entry threshold: high-signal sentiment agent → low-signal adversary
    const normalEntryRange  = GENE_BOUNDS.entryThreshold.max - GENE_BOUNDS.entryThreshold.min;     // 50
    const advEntryRange     = ADVERSARY_GENE_BOUNDS.entryThreshold.max - ADVERSARY_GENE_BOUNDS.entryThreshold.min; // 30
    const normalEntryFrac   = (targetGenome.entryThreshold - GENE_BOUNDS.entryThreshold.min) / normalEntryRange;
    const adversaryEntry    = ADVERSARY_GENE_BOUNDS.entryThreshold.max - normalEntryFrac * advEntryRange;

    // Invert exit threshold: high-exit sentiment agent → low-exit adversary (exits earlier)
    const normalExitRange   = GENE_BOUNDS.exitThreshold.max - GENE_BOUNDS.exitThreshold.min;      // 50
    const advExitRange      = ADVERSARY_GENE_BOUNDS.exitThreshold.max - ADVERSARY_GENE_BOUNDS.exitThreshold.min; // 30
    const normalExitFrac    = (targetGenome.exitThreshold - GENE_BOUNDS.exitThreshold.min) / normalExitRange;
    const adversaryExit     = ADVERSARY_GENE_BOUNDS.exitThreshold.max - normalExitFrac * advExitRange;

    return {
      // Learning hyperparameters inherited unchanged
      epsilon:              targetGenome.epsilon,
      learningRate:         targetGenome.learningRate,
      gamma:                targetGenome.gamma,
      explorationDecayRate: targetGenome.explorationDecayRate,

      // Inverted behavioural thresholds
      entryThreshold:  clamp(adversaryEntry,  ADVERSARY_GENE_BOUNDS.entryThreshold.min,  ADVERSARY_GENE_BOUNDS.entryThreshold.max),
      exitThreshold:   clamp(adversaryExit,   ADVERSARY_GENE_BOUNDS.exitThreshold.min,   ADVERSARY_GENE_BOUNDS.exitThreshold.max),

      // Tighter risk controls
      stopLossPct:     clamp(targetGenome.stopLossPct    * 0.4, ADVERSARY_GENE_BOUNDS.stopLossPct.min,     ADVERSARY_GENE_BOUNDS.stopLossPct.max),
      takeProfitPct:   clamp(targetGenome.takeProfitPct  * 0.4, ADVERSARY_GENE_BOUNDS.takeProfitPct.min,   ADVERSARY_GENE_BOUNDS.takeProfitPct.max),

      // Larger positions, higher risk, shorter holds
      positionSizePct: clamp(targetGenome.positionSizePct * 1.5, ADVERSARY_GENE_BOUNDS.positionSizePct.min, ADVERSARY_GENE_BOUNDS.positionSizePct.max),
      riskPercent:     clamp(targetGenome.riskPercent     * 1.8, ADVERSARY_GENE_BOUNDS.riskPercent.min,     ADVERSARY_GENE_BOUNDS.riskPercent.max),
      holdDurationMax: clamp(
        Math.max(1, Math.round(targetGenome.holdDurationMax * 0.4)),
        ADVERSARY_GENE_BOUNDS.holdDurationMax.min,
        ADVERSARY_GENE_BOUNDS.holdDurationMax.max,
      ),

      agentType: 'ADVERSARY',
    };
  }

  /**
   * Run one adversarial round for `generation`.
   *
   * Creates up to `cfg.adversaryPopulationSize` temporary adversary agents,
   * runs them against the full sentiment population in a competition, determines
   * head-to-head outcomes, retires the adversary agents, and returns a summary.
   */
  async runAdversarialRound(
    tournamentId: string,
    generation: number,
    sentimentPopulation: string[],
    allSentimentStats: AgentStats[],
    cfg: AdversarialRoundConfig,
  ): Promise<AdversarialRoundSummary> {
    const adversaryCount = Math.min(cfg.adversaryPopulationSize, sentimentPopulation.length);

    // ── 1. Pick top sentiment agents as adversary targets ────────────────────
    const ranked  = this.fitnessCalc.rankAgents(allSentimentStats);
    const targets = ranked.slice(0, adversaryCount).map(a => a.agentId);

    // ── 2. Create adversary agents ───────────────────────────────────────────
    const adversaryIds: string[] = [];
    const adversaryTargetMap = new Map<string, string>(); // adversaryId → sentimentAgentId

    for (const targetId of targets) {
      const targetGenome = this.genomeManager.loadGenome(targetId);
      if (!targetGenome) continue;

      const adversaryGenome: AgentGenome = {
        ...this.buildAdversaryGenome(targetGenome),
        targetAgentId: targetId,
      };

      const adversaryId = randomUUID();
      this.db.prepare(`
        INSERT INTO agent_registry
          (id, agent_type, risk_profile, status, generation_number, parent_id_1, parent_id_2)
        VALUES (?, 'ADVERSARY', 'AGGRESSIVE', 'ACTIVE', ?, NULL, NULL)
      `).run(adversaryId, generation);

      this.genomeManager.saveGenome(adversaryId, adversaryGenome);
      this.statsManager.initializeStats(adversaryId);

      adversaryIds.push(adversaryId);
      adversaryTargetMap.set(adversaryId, targetId);
    }

    // Edge case: no adversaries could be created (all target genomes missing)
    if (adversaryIds.length === 0) {
      logger.warn('adversarial round: no adversary agents created', { tournamentId, generation });
      return {
        generation,
        sentimentAgentsCount: sentimentPopulation.length,
        adversaryAgentsCount: 0,
        matchups: [],
        sentimentWinRate: 100,
        beatingAgentIds: [],
      };
    }

    // ── 3. Run combined competition ──────────────────────────────────────────
    const combinedPopulation = [...sentimentPopulation, ...adversaryIds];
    const competitionId      = `adv_${tournamentId}_g${generation}`;
    const competitionCfg: CompetitionConfig = {
      mode: 'SINGLE',
      agents: combinedPopulation.map(id => ({
        id,
        riskProfile: this.getAgentRiskProfile(id),
        initialCapital: cfg.initialCapital,
      })),
      symbols: cfg.symbols,
      duration: cfg.duration,
      refreshInterval: 1000,
      learningEnabled: true,
    };

    const result = await this.marlEngine.runCompetition(
      competitionCfg,
      () => { /* no progress events for adversarial rounds */ },
      competitionId,
    );

    // ── 4. Record competition results ────────────────────────────────────────
    for (const ranking of result.finalRankings) {
      this.statsManager.recordCompetitionResult(ranking.agentId, {
        competitionId,
        rank:               ranking.rank,
        agentCount:         result.finalRankings.length,
        startingCapital:    cfg.initialCapital,
        endingCapital:      ranking.finalCapital,
        tradesExecuted:     ranking.tradesExecuted,
        winTrades:          Math.round(ranking.winRate * ranking.tradesExecuted),
        lossTrades:         Math.round((1 - ranking.winRate) * ranking.tradesExecuted),
        largestWin:         0,
        largestLoss:        0,
        sharpeRatio:        ranking.sharpeRatio,
        maxDrawdownPercent: ranking.maxDrawdown * 100,
      });
    }

    // ── 5. Build per-agent fitness for the combined population ───────────────
    const fitnessMap = new Map<string, number>();
    const combinedStats = this.buildFitnessStatsForAgents(combinedPopulation);
    for (const ranked of this.fitnessCalc.rankAgents(combinedStats)) {
      fitnessMap.set(ranked.agentId, ranked.fitness);
    }

    // ── 6. Compute head-to-head matchup outcomes ─────────────────────────────
    const matchups: AdversarialMatchup[] = [];
    const beatingSet = new Set<string>();

    for (const adversaryId of adversaryIds) {
      const targetSentimentId = adversaryTargetMap.get(adversaryId)!;
      const sentimentFitness  = fitnessMap.get(targetSentimentId) ?? 0;
      const adversaryFitness  = fitnessMap.get(adversaryId)       ?? 0;
      const sentimentWon      = sentimentFitness >= adversaryFitness;

      matchups.push({ sentimentAgentId: targetSentimentId, adversaryAgentId: adversaryId, sentimentFitness, adversaryFitness, sentimentWon });

      if (sentimentWon) {
        beatingSet.add(targetSentimentId);
      }
    }

    // ── 7. Retire adversary agents ───────────────────────────────────────────
    for (const adversaryId of adversaryIds) {
      this.db.prepare(`UPDATE agent_registry SET status = 'RETIRED' WHERE id = ?`).run(adversaryId);
    }

    const sentimentWinRate = matchups.length > 0
      ? (matchups.filter(m => m.sentimentWon).length / matchups.length) * 100
      : 0;

    const summary: AdversarialRoundSummary = {
      generation,
      sentimentAgentsCount: sentimentPopulation.length,
      adversaryAgentsCount: adversaryIds.length,
      matchups,
      sentimentWinRate,
      beatingAgentIds: Array.from(beatingSet),
    };

    logger.info('adversarial round complete', {
      tournamentId,
      generation,
      adversaryCount: adversaryIds.length,
      sentimentWinRate: sentimentWinRate.toFixed(1),
      beatingAgentCount: beatingSet.size,
    });

    return summary;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildFitnessStatsForAgents(agentIds: string[]): AgentStats[] {
    return agentIds.map(agentId => {
      try {
        const s = this.statsManager.getStats(agentId);
        return {
          agentId,
          winRatePct:        s.win_rate_percent,
          sharpeRatio:       s.sharpe_ratio,
          totalPnl:          s.total_pnl,
          totalCompetitions: s.total_competitions,
        };
      } catch {
        return { agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 };
      }
    });
  }

  private getAgentRiskProfile(agentId: string): RiskProfile {
    const row = this.db
      .prepare('SELECT risk_profile FROM agent_registry WHERE id = ?')
      .get(agentId) as { risk_profile: string } | undefined;
    const profile = row?.risk_profile ?? 'AGGRESSIVE';
    return profile as RiskProfile;
  }
}
