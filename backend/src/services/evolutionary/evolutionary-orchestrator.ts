/**
 * EvolutionaryOrchestrator — Phase 2 of the Evolutionary Agent System
 *
 * Wires together:
 *   GenomeManager           — agent registration + genome CRUD
 *   GeneticCrossover        — offspring creation via uniform / blended crossover
 *   MutationEngine          — post-crossover gene mutation
 *   FitnessCalculator       — 0–100 composite fitness scoring
 *   SelectionAlgorithm      — survivor / retirement partitioning
 *   AgentStatisticsManager  — cumulative stats + competition history
 *   MarlCompetitionEngine   — runs the actual trading competition each generation
 *   ClaudeGAOrchestrator    — optional AI-driven parameter adaptation between generations
 *   GAEventBus              — typed lifecycle events for observability
 *   GenerationResultStore   — checkpoint + extended lineage persistence
 *
 * Each tournament runs N generations in a background async loop.  Status is
 * persisted to the `evolutionary_tournaments` SQLite table so it survives
 * server restarts (as a snapshot — not live streaming).
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { GenomeManager, createRandomGenome } from './agent-genome.js';
import { GeneticCrossover } from './genetic-crossover.js';
import type { CrossoverStrategy } from './genetic-crossover.js';
import { MutationEngine } from './mutation-engine.js';
import type { MutationSeverity } from './mutation-engine.js';
import { FitnessCalculator } from './fitness-calculator.js';
import type { AgentStats as FitnessAgentStats } from './fitness-calculator.js';
import { SelectionAlgorithm } from './selection-algorithm.js';
import { AgentStatisticsManager } from './agent-statistics-manager.js';
import { MarlCompetitionEngine } from '../marl-competition-engine.js';
import type { CompetitionConfig } from '../marl-competition-engine.js';
import { claudeGAOrchestrator } from './claude-ga-orchestrator.js';
import type { GenerationDirective, PopulationReport, AgentMetric, FitnessStats } from './ga-directive-types.js';
import { gaEventBus } from './ga-event-bus.js';
import { GenerationResultStore } from './generation-result-store.js';
import { AdversarialTrainer } from './adversarial-trainer.js';
import type { AdversarialRoundSummary } from './adversarial-trainer.js';
import logger from '../../logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export type TournamentStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
export type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';

export interface EvolutionaryTournamentConfig {
  /** Human-readable label. */
  name?: string;

  /** Number of agents in each generation. Min 4. */
  populationSize: number;

  /** How many generations to run before the tournament ends. */
  maxGenerations: number;

  /**
   * Percentage of the ranked population kept as survivors for the next
   * generation (also used as the retirement threshold).  Default: 30.
   */
  survivalPercent?: number;

  /** Probability (0–1) that a newly bred offspring is mutated. Default: 0.5. */
  mutationRate?: number;

  /** How aggressively genes are mutated when a mutation fires. Default: 'MEDIUM'. */
  mutationSeverity?: MutationSeverity;

  /** Crossover strategy applied when breeding survivors. Default: 'UNIFORM'. */
  crossoverStrategy?: CrossoverStrategy;

  /**
   * When true, bottom-ranked agents are retired after each generation rather
   * than kept in the middle tier.  Default: true.
   */
  retirementEnabled?: boolean;

  /** Steps (simulation ticks) per competition.  Default: 200. */
  competitionDuration?: number;

  /** Symbols traded in each competition. */
  symbols: string[];

  /** Starting capital for each agent.  Default: 10 000. */
  initialCapital?: number;

  /**
   * Risk profiles distributed across the initial population.
   * Cycles through the array when populationSize > riskProfiles.length.
   * Default: ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'].
   */
  riskProfiles?: RiskProfile[];

  /**
   * When true, Claude is called after each generation to produce a
   * GenerationDirective that adaptively controls mutation severity,
   * survival rate, crossover strategy, and early-stopping decisions
   * for the next generation.  Default: false.
   */
  claudeOrchestrated?: boolean;

  /**
   * When true, adversarial rounds are run every `adversarialRoundInterval`
   * generations.  Adversary agents with inverted strategies stress-test the
   * population; sentiment agents that beat them receive a +10 % fitness bonus.
   * Default: false.
   */
  adversarialTraining?: boolean;

  /**
   * Number of adversary agents created per round.
   * Default: Math.ceil(populationSize * 0.2).
   */
  adversaryPopulationSize?: number;

  /**
   * How many generations pass between adversarial rounds.  Default: 3.
   */
  adversarialRoundInterval?: number;
}

export interface GenerationSummary {
  generation: number;
  competitionId: string;
  population: string[];
  survivors: string[];
  offspring: string[];
  retired: string[];
  topAgentId: string;
  topFitness: number;
  avgFitness: number;
  completedAt: string;  // ISO string
  /** Claude directive applied before breeding this generation (if claudeOrchestrated). */
  claudeDirective?: GenerationDirective;
  /** Adversarial round summary for this generation (if adversarialTraining is enabled). */
  adversarialSummary?: AdversarialRoundSummary;
}

export interface TournamentRecord {
  tournamentId: string;
  name: string;
  config: EvolutionaryTournamentConfig;
  status: TournamentStatus;
  currentGeneration: number;
  generations: GenerationSummary[];
  currentPopulation: string[];
  startedAt: string;   // ISO string
  completedAt?: string;
  error?: string;
  /**
   * All Claude directives produced during this tournament, indexed by
   * generation number.  Only populated when claudeOrchestrated is true.
   */
  directives?: GenerationDirective[];
  /**
   * Adversarial round summaries for this tournament.
   * Only populated when adversarialTraining is true.
   */
  adversarialSummaries?: AdversarialRoundSummary[];
}

// ── EvolutionaryOrchestrator ──────────────────────────────────────────────────

export class EvolutionaryOrchestrator {
  private readonly db: Database.Database;
  private readonly genomeManager: GenomeManager;
  private readonly crossover: GeneticCrossover;
  private readonly mutationEngine: MutationEngine;
  private readonly fitnessCalc: FitnessCalculator;
  private readonly selection: SelectionAlgorithm;
  private readonly statsManager: AgentStatisticsManager;
  private readonly marlEngine:         MarlCompetitionEngine;
  private readonly resultStore:        GenerationResultStore;
  private readonly adversarialTrainer: AdversarialTrainer;

  // In-process cache so GET /status is fast without hitting SQLite
  private readonly cache = new Map<string, TournamentRecord>();

  constructor(database: Database.Database) {
    this.db             = database;
    this.genomeManager  = new GenomeManager(database);
    this.crossover      = new GeneticCrossover(database);
    this.mutationEngine = new MutationEngine(database);
    this.fitnessCalc    = new FitnessCalculator();
    this.selection      = new SelectionAlgorithm(this.fitnessCalc);
    this.statsManager   = new AgentStatisticsManager(database);
    this.marlEngine          = new MarlCompetitionEngine();
    this.resultStore         = new GenerationResultStore(database);
    this.adversarialTrainer  = new AdversarialTrainer(database);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Create an initial population, persist a tournament record, and kick off the
   * generational loop in the background.
   *
   * Returns immediately with the `tournamentId`; callers poll `getTournament()`
   * to track progress.
   */
  async startTournament(config: EvolutionaryTournamentConfig): Promise<string> {
    const tournamentId = `evo_${randomUUID()}`;
    const name         = config.name ?? `Evolution ${new Date().toISOString().slice(0, 10)}`;

    // ── Validate ────────────────────────────────────────────────────────────
    if (config.populationSize < 4) {
      throw new Error('populationSize must be ≥ 4');
    }
    if (config.symbols.length === 0) {
      throw new Error('at least one symbol is required');
    }

    // ── Create initial population ────────────────────────────────────────────
    const profiles = config.riskProfiles ?? ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'];
    const population: string[] = [];
    for (let i = 0; i < config.populationSize; i++) {
      const riskProfile = profiles[i % profiles.length]!;
      const agentId = this.genomeManager.registerNewAgent({
        riskProfile,
        genome: createRandomGenome(),
        generationNumber: 0,
      });
      this.statsManager.initializeStats(agentId);
      population.push(agentId);

      // Extended lineage: genesis agents have no parents
      const genome = this.genomeManager.loadGenome(agentId);
      if (genome) {
        this.resultStore.saveLineageEntry({
          agentId,
          parentIds: [],
          generation: 0,
          architecture: genome,
          fitnessAtBirth: 0,
          tournamentId,
        });
      }
    }

    // ── Persist initial record ───────────────────────────────────────────────
    const record: TournamentRecord = {
      tournamentId,
      name,
      config,
      status: 'RUNNING',
      currentGeneration: 0,
      generations: [],
      currentPopulation: population,
      startedAt: new Date().toISOString(),
      directives:           config.claudeOrchestrated   ? [] : undefined,
      adversarialSummaries: config.adversarialTraining  ? [] : undefined,
    };
    this.upsertRecord(record);

    gaEventBus.emit('task:queued', {
      tournamentId,
      name,
      populationSize: config.populationSize,
      maxGenerations: config.maxGenerations,
    });

    // ── Start generational loop (non-blocking) ────────────────────────────────
    void this.runGenerations(tournamentId, record, config).catch(err => {
      logger.error('evolutionary tournament failed', { tournamentId, error: String(err) });
      this.patchRecord(tournamentId, {
        status: 'FAILED',
        error: String(err),
        completedAt: new Date().toISOString(),
      });
    });

    return tournamentId;
  }

  getTournament(tournamentId: string): TournamentRecord | undefined {
    return this.cache.get(tournamentId) ?? this.loadFromDb(tournamentId);
  }

  listTournaments(): TournamentRecord[] {
    const rows = this.db
      .prepare('SELECT payload FROM evolutionary_tournaments ORDER BY started_at DESC')
      .all() as { payload: string }[];
    return rows.map(r => JSON.parse(r.payload) as TournamentRecord);
  }

  /**
   * Restore a tournament to the state captured at a given generation checkpoint.
   *
   * - Loads the checkpoint population from `generation_checkpoints`.
   * - Trims the tournament's generation history to [1 .. generation].
   * - Sets status to 'PAUSED' so callers know the loop is no longer active.
   * - Returns the restored TournamentRecord, or throws if the checkpoint
   *   does not exist.
   */
  rollbackToGeneration(
    tournamentId: string,
    generation: number,
  ): TournamentRecord {
    const checkpoint = this.resultStore.loadCheckpoint(tournamentId, generation);
    if (!checkpoint) {
      throw new Error(
        `No checkpoint found for tournament ${tournamentId} at generation ${generation}`,
      );
    }

    const current = this.cache.get(tournamentId) ?? this.loadFromDb(tournamentId);
    if (!current) {
      throw new Error(`Tournament not found: ${tournamentId}`);
    }

    const trimmedGenerations          = current.generations.filter(g => g.generation <= generation);
    const trimmedDirectives           = current.directives?.filter(d => d.generation <= generation);
    const trimmedAdversarialSummaries = current.adversarialSummaries?.filter(s => s.generation <= generation);

    const restored: TournamentRecord = {
      ...current,
      status:               'PAUSED',
      currentGeneration:    generation,
      currentPopulation:    checkpoint.population,
      generations:          trimmedGenerations,
      directives:           trimmedDirectives,
      adversarialSummaries: trimmedAdversarialSummaries,
      completedAt:          undefined,
      error:                undefined,
    };

    this.upsertRecord(restored);
    logger.info('evolutionary tournament rolled back', { tournamentId, generation });

    return restored;
  }

  // ── Core generational loop ─────────────────────────────────────────────────

  private async runGenerations(
    tournamentId: string,
    record: TournamentRecord,
    cfg: EvolutionaryTournamentConfig,
  ): Promise<void> {
    // Base parameters — may be overridden per-generation by Claude directives
    const baseSurvivalPercent     = cfg.survivalPercent         ?? 30;
    const mutationRate             = cfg.mutationRate            ?? 0.5;
    const baseMutationSeverity     = cfg.mutationSeverity        ?? 'MEDIUM';
    const baseCrossoverStrat       = cfg.crossoverStrategy       ?? 'UNIFORM';
    const retirementEnabled        = cfg.retirementEnabled       ?? true;
    const initialCapital           = cfg.initialCapital          ?? 10_000;
    const duration                 = cfg.competitionDuration     ?? 200;
    const profiles                 = cfg.riskProfiles            ?? ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'];
    const adversarialRoundInterval = cfg.adversarialRoundInterval ?? 3;
    const adversaryPopulationSize  = cfg.adversaryPopulationSize
      ?? Math.ceil(cfg.populationSize * 0.2);

    let population = [...record.currentPopulation];

    for (let gen = 1; gen <= cfg.maxGenerations; gen++) {
      logger.info('evolutionary generation start', { tournamentId, gen, populationSize: population.length });

      // ── 1. Run competition ───────────────────────────────────────────────
      const competitionId = `evo_comp_${tournamentId}_g${gen}`;
      const competitionCfg: CompetitionConfig = {
        mode: 'SINGLE',
        agents: population.map((id) => ({
          id,
          riskProfile: this.getAgentRiskProfile(id),
          initialCapital,
        })),
        symbols: cfg.symbols,
        duration,
        refreshInterval: 1000,
        learningEnabled: true,
      };

      gaEventBus.emit('task:started', {
        tournamentId,
        generation: gen,
        populationSize: population.length,
        competitionId,
      });

      const result = await this.marlEngine.runCompetition(
        competitionCfg,
        (progress) => {
          gaEventBus.emit('task:progress', { tournamentId, generation: gen, competitionId, progress });
        },
        competitionId,
      );

      // ── 2. Record competition results for each agent ──────────────────────
      for (const ranking of result.finalRankings) {
        this.statsManager.recordCompetitionResult(ranking.agentId, {
          competitionId,
          rank: ranking.rank,
          agentCount: result.finalRankings.length,
          startingCapital: initialCapital,
          endingCapital: ranking.finalCapital,
          tradesExecuted: ranking.tradesExecuted,
          winTrades: Math.round(ranking.winRate * ranking.tradesExecuted),
          lossTrades: Math.round((1 - ranking.winRate) * ranking.tradesExecuted),
          largestWin: 0,
          largestLoss: 0,
          sharpeRatio: ranking.sharpeRatio,
          maxDrawdownPercent: ranking.maxDrawdown * 100,
        });
      }

      // ── 3. Fitness scoring ───────────────────────────────────────────────
      let allStats = this.buildFitnessStats(population);

      // ── 3a. Adversarial round (optional, every N generations) ────────────
      let adversarialSummary: AdversarialRoundSummary | undefined;
      if (cfg.adversarialTraining && gen % adversarialRoundInterval === 0) {
        adversarialSummary = await this.adversarialTrainer.runAdversarialRound(
          tournamentId,
          gen,
          population,
          allStats,
          { symbols: cfg.symbols, initialCapital, duration, adversaryPopulationSize },
        );

        // Mark sentiment agents that beat an adversary so FitnessCalculator
        // can apply the +10 % bonus
        const beatingSet = new Set(adversarialSummary.beatingAgentIds);
        allStats = allStats.map(s =>
          beatingSet.has(s.agentId) ? { ...s, beatsAdversary: true } : s,
        );

        logger.info('adversarial training round applied', {
          tournamentId,
          gen,
          beatingAgentCount: adversarialSummary.beatingAgentIds.length,
          sentimentWinRate: adversarialSummary.sentimentWinRate.toFixed(1),
        });
      }

      // ── 3b. Claude directive (between selection and breeding) ─────────────
      let effectiveSurvivalPercent = baseSurvivalPercent;
      let effectiveMutationSeverity: MutationSeverity = baseMutationSeverity;
      let effectiveCrossoverStrat: CrossoverStrategy = baseCrossoverStrat;
      let effectivePopulationSize = cfg.populationSize;
      let directive: GenerationDirective | undefined;

      if (cfg.claudeOrchestrated) {
        const previousAvgFitness = gen > 1
          ? (this.cache.get(tournamentId)?.generations[gen - 2]?.avgFitness ?? 0)
          : 0;

        const report = this.buildPopulationReport(
          allStats,
          gen,
          cfg.maxGenerations,
          previousAvgFitness,
        );

        directive = await claudeGAOrchestrator.decideNextGeneration(report, gen);

        effectiveSurvivalPercent  = directive.survivalPercent;
        effectiveMutationSeverity = directive.mutationSeverity;
        effectiveCrossoverStrat   = directive.crossoverStrategy;
        if (directive.targetPopulationSize) {
          effectivePopulationSize = directive.targetPopulationSize;
        }

        logger.info('evolutionary claude directive applied', {
          tournamentId, gen,
          mutationSeverity:       directive.mutationSeverity,
          survivalPercent:        directive.survivalPercent,
          crossoverStrategy:      directive.crossoverStrategy,
          diversityBoost:         directive.diversityBoost,
          earlyStopIfFitnessAbove: directive.earlyStopIfFitnessAbove,
        });
      }

      // ── 3b. Selection ─────────────────────────────────────────────────────
      const { survivors, retirementCandidates, middleTier } =
        this.selection.selectTopPercent(allStats, effectiveSurvivalPercent);

      const survivorIds   = survivors.map(s => s.agentId);
      const retiredIds    = retirementEnabled ? retirementCandidates.map(s => s.agentId) : [];
      const middleIds     = middleTier.map(s => s.agentId);

      // ── 4. Retire bottom performers ──────────────────────────────────────
      for (const agentId of retiredIds) {
        this.db
          .prepare(`UPDATE agent_registry SET status = 'RETIRED' WHERE id = ?`)
          .run(agentId);
      }

      // ── 5. Breed offspring from survivors ────────────────────────────────
      const keepIds = [...survivorIds, ...(retirementEnabled ? [] : retiredIds), ...middleIds];
      const offspringCount = Math.max(0, effectivePopulationSize - keepIds.length);
      const newOffspringIds: string[] = [];

      if (offspringCount > 0 && survivorIds.length >= 2) {
        const crossoverResults = this.crossover.breedPopulation(
          survivorIds,
          offspringCount,
          effectiveCrossoverStrat,
        );
        for (const cr of crossoverResults) {
          this.statsManager.initializeStats(cr.offspringId);
          newOffspringIds.push(cr.offspringId);

          // ── 6. Mutate offspring stochastically ────────────────────────────
          if (Math.random() < mutationRate) {
            this.mutationEngine.mutateAndSave(cr.offspringId, effectiveMutationSeverity);
          }

          // Extended lineage record for new offspring
          const offspringGenome = this.genomeManager.loadGenome(cr.offspringId);
          if (offspringGenome) {
            this.resultStore.saveLineageEntry({
              agentId:        cr.offspringId,
              parentIds:      this.getParentIds(cr.offspringId),
              generation:     gen,
              architecture:   offspringGenome,
              fitnessAtBirth: 0,
              tournamentId,
            });
          }
        }
      } else if (offspringCount > 0 && survivorIds.length === 1) {
        // Edge case: only one survivor — clone + mutate to fill
        for (let i = 0; i < offspringCount; i++) {
          const genome = this.genomeManager.loadGenome(survivorIds[0]!)!;
          const newId  = this.genomeManager.registerNewAgent({
            riskProfile: this.getAgentRiskProfile(survivorIds[0]!),
            genome,
            parentId1: survivorIds[0],
            generationNumber: gen,
          });
          this.statsManager.initializeStats(newId);
          this.mutationEngine.mutateAndSave(newId, effectiveMutationSeverity);
          newOffspringIds.push(newId);

          const cloneGenome = this.genomeManager.loadGenome(newId);
          if (cloneGenome) {
            this.resultStore.saveLineageEntry({
              agentId:        newId,
              parentIds:      this.getParentIds(newId),
              generation:     gen,
              architecture:   cloneGenome,
              fitnessAtBirth: 0,
              tournamentId,
            });
          }
        }
      }

      // ── 6b. Diversity boost — inject fresh random agents ─────────────────
      if (directive?.diversityBoost) {
        const boostCount = Math.max(1, Math.ceil(effectivePopulationSize * 0.2));
        for (let i = 0; i < boostCount; i++) {
          const riskProfile = profiles[i % profiles.length]!;
          const freshId = this.genomeManager.registerNewAgent({
            riskProfile,
            genome: createRandomGenome(),
            generationNumber: gen,
          });
          this.statsManager.initializeStats(freshId);
          newOffspringIds.push(freshId);

          const freshGenome = this.genomeManager.loadGenome(freshId);
          if (freshGenome) {
            this.resultStore.saveLineageEntry({
              agentId:        freshId,
              parentIds:      [],
              generation:     gen,
              architecture:   freshGenome,
              fitnessAtBirth: 0,
              tournamentId,
            });
          }
        }
        logger.info('evolutionary diversity boost applied', { tournamentId, gen, boostCount });
      }

      // ── 7. Compute generation summary ────────────────────────────────────
      const rankedWithFitness = this.fitnessCalc.rankAgents(allStats);
      const topAgent   = rankedWithFitness[0];
      const avgFitness = rankedWithFitness.length > 0
        ? rankedWithFitness.reduce((s, a) => s + a.fitness, 0) / rankedWithFitness.length
        : 0;

      const summary: GenerationSummary = {
        generation: gen,
        competitionId,
        population: [...population],
        survivors: survivorIds,
        offspring: newOffspringIds,
        retired: retiredIds,
        topAgentId: topAgent?.agentId ?? '',
        topFitness: topAgent?.fitness ?? 0,
        avgFitness,
        completedAt: new Date().toISOString(),
        claudeDirective:    directive,
        adversarialSummary: adversarialSummary,
      };

      // ── 8. Assemble next population ──────────────────────────────────────
      population = [...keepIds, ...newOffspringIds];

      // Trim to effectivePopulationSize in case rounding added extra
      if (population.length > effectivePopulationSize) {
        population = population.slice(0, effectivePopulationSize);
      }

      // ── 9. Persist progress + checkpoint ─────────────────────────────────
      const currentRecord = this.cache.get(tournamentId);
      const updatedDirectives = cfg.claudeOrchestrated && directive
        ? [...(currentRecord?.directives ?? []), directive]
        : currentRecord?.directives;
      const updatedAdversarialSummaries = cfg.adversarialTraining && adversarialSummary
        ? [...(currentRecord?.adversarialSummaries ?? []), adversarialSummary]
        : currentRecord?.adversarialSummaries;

      this.patchRecord(tournamentId, {
        currentGeneration: gen,
        currentPopulation: population,
        generations: [...(currentRecord?.generations ?? []), summary],
        directives:           updatedDirectives,
        adversarialSummaries: updatedAdversarialSummaries,
      });

      // Save generation checkpoint for rollback capability
      this.resultStore.saveCheckpoint(tournamentId, gen, population, directive);

      gaEventBus.emit('task:completed', {
        tournamentId,
        generation: gen,
        competitionId,
        topFitness: topAgent?.fitness ?? 0,
        avgFitness,
      });

      gaEventBus.emit('generation:complete', { tournamentId, generation: gen, summary });

      logger.info('evolutionary generation complete', {
        tournamentId, gen, topFitness: topAgent?.fitness?.toFixed(1),
        avgFitness: avgFitness.toFixed(1), retired: retiredIds.length,
        offspring: newOffspringIds.length,
      });

      // ── 10. Early stop check ─────────────────────────────────────────────
      if (directive?.earlyStopIfFitnessAbove !== undefined) {
        const topFitness = topAgent?.fitness ?? 0;
        if (topFitness >= directive.earlyStopIfFitnessAbove) {
          gaEventBus.emit('convergence:detected', {
            tournamentId,
            generation: gen,
            topFitness,
            threshold: directive.earlyStopIfFitnessAbove,
          });
          logger.info('evolutionary early stop triggered', {
            tournamentId, gen, topFitness, threshold: directive.earlyStopIfFitnessAbove,
          });
          break;
        }
      }
    }

    // ── Tournament complete ───────────────────────────────────────────────────
    this.patchRecord(tournamentId, {
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    });
    logger.info('evolutionary tournament complete', { tournamentId, generations: cfg.maxGenerations });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Build FitnessAgentStats[] for a given population from the stats table. */
  private buildFitnessStats(population: string[]): FitnessAgentStats[] {
    const result: FitnessAgentStats[] = [];
    for (const agentId of population) {
      try {
        const s = this.statsManager.getStats(agentId);
        result.push({
          agentId,
          winRatePct:        s.win_rate_percent,
          sharpeRatio:       s.sharpe_ratio,
          totalPnl:          s.total_pnl,
          totalCompetitions: s.total_competitions,
        });
      } catch {
        // Agent has no stats yet (just bred) — use neutral defaults
        result.push({ agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 });
      }
    }
    return result;
  }

  /** Build a PopulationReport for the Claude directive request. */
  private buildPopulationReport(
    allStats: FitnessAgentStats[],
    generation: number,
    totalGenerations: number,
    previousAvgFitness: number,
  ): PopulationReport {
    const ranked = this.fitnessCalc.rankAgents(allStats);

    const agents: AgentMetric[] = ranked.map(a => ({
      agentId: a.agentId,
      fitness: a.fitness,
      winRate: a.winRatePct,
      sharpe:  a.sharpeRatio,
      pnl:     a.totalPnl,
    }));

    const fitnesses = ranked.map(a => a.fitness);
    const mean = fitnesses.length > 0
      ? fitnesses.reduce((s, f) => s + f, 0) / fitnesses.length
      : 0;
    const max = fitnesses.length > 0 ? Math.max(...fitnesses) : 0;
    const min = fitnesses.length > 0 ? Math.min(...fitnesses) : 0;
    const variance = fitnesses.length > 0
      ? fitnesses.reduce((s, f) => s + Math.pow(f - mean, 2), 0) / fitnesses.length
      : 0;
    const stdDev = Math.sqrt(variance);

    const fitnessStats: FitnessStats = {
      mean,
      stdDev,
      max,
      min,
      trend: generation > 1 ? mean - previousAvgFitness : 0,
    };

    return { generation, totalGenerations, agents, fitnessStats };
  }

  private getParentIds(agentId: string): string[] {
    const row = this.db
      .prepare('SELECT parent_id_1, parent_id_2 FROM agent_registry WHERE id = ?')
      .get(agentId) as { parent_id_1: string | null; parent_id_2: string | null } | undefined;
    return [row?.parent_id_1, row?.parent_id_2].filter((id): id is string => !!id);
  }

  private getAgentRiskProfile(agentId: string): RiskProfile {
    const row = this.db
      .prepare('SELECT risk_profile FROM agent_registry WHERE id = ?')
      .get(agentId) as { risk_profile: string } | undefined;
    const profile = row?.risk_profile ?? 'CONSERVATIVE';
    return profile as RiskProfile;
  }

  // ── SQLite persistence ────────────────────────────────────────────────────

  private upsertRecord(record: TournamentRecord): void {
    this.cache.set(record.tournamentId, record);
    const directivesJson =
      record.directives && record.directives.length > 0
        ? JSON.stringify(record.directives)
        : null;
    this.db.prepare(`
      INSERT INTO evolutionary_tournaments (id, name, started_at, payload, claude_directive)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload          = excluded.payload,
        claude_directive = excluded.claude_directive
    `).run(
      record.tournamentId,
      record.name,
      record.startedAt,
      JSON.stringify(record),
      directivesJson,
    );
  }

  private patchRecord(
    tournamentId: string,
    updates: Partial<TournamentRecord>,
  ): void {
    const current = this.cache.get(tournamentId) ?? this.loadFromDb(tournamentId);
    if (!current) {
      logger.warn('patchRecord: tournament not found', { tournamentId });
      return;
    }
    const updated = { ...current, ...updates };
    this.upsertRecord(updated);
  }

  private loadFromDb(tournamentId: string): TournamentRecord | undefined {
    const row = this.db
      .prepare('SELECT payload FROM evolutionary_tournaments WHERE id = ?')
      .get(tournamentId) as { payload: string } | undefined;
    if (!row) return undefined;
    const record = JSON.parse(row.payload) as TournamentRecord;
    this.cache.set(tournamentId, record);
    return record;
  }
}
