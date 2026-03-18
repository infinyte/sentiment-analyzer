/**
 * EvolutionaryOrchestrator — Phase 2 of the Evolutionary Agent System
 *
 * Wires together:
 *   GenomeManager         — agent registration + genome CRUD
 *   GeneticCrossover      — offspring creation via uniform / blended crossover
 *   MutationEngine        — post-crossover gene mutation
 *   FitnessCalculator     — 0–100 composite fitness scoring
 *   SelectionAlgorithm    — survivor / retirement partitioning
 *   AgentStatisticsManager — cumulative stats + competition history
 *   MarlCompetitionEngine  — runs the actual trading competition each generation
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
  private readonly marlEngine: MarlCompetitionEngine;

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
    this.marlEngine     = new MarlCompetitionEngine();
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
    };
    this.upsertRecord(record);

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

  // ── Core generational loop ─────────────────────────────────────────────────

  private async runGenerations(
    tournamentId: string,
    record: TournamentRecord,
    cfg: EvolutionaryTournamentConfig,
  ): Promise<void> {
    const survivalPercent  = cfg.survivalPercent  ?? 30;
    const mutationRate     = cfg.mutationRate     ?? 0.5;
    const mutationSeverity = cfg.mutationSeverity ?? 'MEDIUM';
    const crossoverStrat   = cfg.crossoverStrategy ?? 'UNIFORM';
    const retirementEnabled = cfg.retirementEnabled ?? true;
    const initialCapital   = cfg.initialCapital   ?? 10_000;
    const duration         = cfg.competitionDuration ?? 200;

    let population = [...record.currentPopulation];

    for (let gen = 1; gen <= cfg.maxGenerations; gen++) {
      logger.info('evolutionary generation start', { tournamentId, gen, populationSize: population.length });

      // ── 1. Run competition ───────────────────────────────────────────────
      const competitionId = `evo_comp_${tournamentId}_g${gen}`;
      const competitionCfg: CompetitionConfig = {
        mode: 'SINGLE',
        agents: population.map((id, i) => ({
          id,
          riskProfile: this.getAgentRiskProfile(id),
          initialCapital,
        })),
        symbols: cfg.symbols,
        duration,
        refreshInterval: 1000,
        learningEnabled: true,
      };

      const result = await this.marlEngine.runCompetition(
        competitionCfg,
        undefined,
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
          largestWin: 0,   // not available in FinalRanking
          largestLoss: 0,
          sharpeRatio: ranking.sharpeRatio,
          maxDrawdownPercent: ranking.maxDrawdown * 100,
        });
      }

      // ── 3. Fitness scoring + selection ───────────────────────────────────
      const allStats = this.buildFitnessStats(population);
      const { survivors, retirementCandidates, middleTier } =
        this.selection.selectTopPercent(allStats, survivalPercent);

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
      // Fill back up to populationSize: survivors + middle stay, breed the rest
      const keepIds = [...survivorIds, ...(retirementEnabled ? [] : retiredIds), ...middleIds];
      const offspringCount = Math.max(0, cfg.populationSize - keepIds.length);
      const newOffspringIds: string[] = [];

      if (offspringCount > 0 && survivorIds.length >= 2) {
        const crossoverResults = this.crossover.breedPopulation(
          survivorIds,
          offspringCount,
          crossoverStrat,
        );
        for (const cr of crossoverResults) {
          this.statsManager.initializeStats(cr.offspringId);
          newOffspringIds.push(cr.offspringId);

          // ── 6. Mutate offspring stochastically ────────────────────────────
          if (Math.random() < mutationRate) {
            this.mutationEngine.mutateAndSave(cr.offspringId, mutationSeverity);
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
          this.mutationEngine.mutateAndSave(newId, mutationSeverity);
          newOffspringIds.push(newId);
        }
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
      };

      // ── 8. Assemble next population ──────────────────────────────────────
      population = [...keepIds, ...newOffspringIds];

      // Trim to populationSize in case rounding added extra
      if (population.length > cfg.populationSize) {
        population = population.slice(0, cfg.populationSize);
      }

      // ── 9. Persist progress ───────────────────────────────────────────────
      this.patchRecord(tournamentId, {
        currentGeneration: gen,
        currentPopulation: population,
        generations: [...(this.cache.get(tournamentId)?.generations ?? []), summary],
      });

      logger.info('evolutionary generation complete', {
        tournamentId, gen, topFitness: topAgent?.fitness?.toFixed(1),
        avgFitness: avgFitness.toFixed(1), retired: retiredIds.length,
        offspring: newOffspringIds.length,
      });
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
    this.db.prepare(`
      INSERT INTO evolutionary_tournaments (id, name, started_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
    `).run(
      record.tournamentId,
      record.name,
      record.startedAt,
      JSON.stringify(record),
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
