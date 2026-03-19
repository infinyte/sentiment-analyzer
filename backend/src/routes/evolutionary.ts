/**
 * Evolutionary Tournament Routes — Phase 2
 *
 * Endpoints:
 *   POST /api/evolutionary/tournament           - start a new tournament
 *   GET  /api/evolutionary/tournament           - list all tournaments
 *   GET  /api/evolutionary/tournament/:id       - get tournament status/summary
 *   GET  /api/evolutionary/summary              - aggregate tournament history for dashboards
 *   GET  /api/agents/:id/genome                 - get an agent's genome
 *   GET  /api/agents/:id/genealogy              - get an agent's ancestry
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import { EvolutionaryOrchestrator } from '../services/evolutionary/evolutionary-orchestrator.js';
import type { EvolutionaryTournamentConfig } from '../services/evolutionary/evolutionary-orchestrator.js';
import { GenomeManager } from '../services/evolutionary/agent-genome.js';
import { GeneticCrossover } from '../services/evolutionary/genetic-crossover.js';
import type { CrossoverStrategy } from '../services/evolutionary/genetic-crossover.js';
import { MutationEngine } from '../services/evolutionary/mutation-engine.js';
import type { MutationSeverity } from '../services/evolutionary/mutation-engine.js';
import { AgentStatisticsManager } from '../services/evolutionary/agent-statistics-manager.js';
import type { TournamentRecord } from '../services/evolutionary/evolutionary-orchestrator.js';

interface TournamentTimelineEntry {
  generation: number;
  topFitness: number;
  avgFitness: number;
  avgPnl: number;
  survivalRate: number;
  populationCount: number;
  survivorCount: number;
  offspringCount: number;
  retiredCount: number;
  completedAt: string;
}

interface TournamentDashboardSummary {
  tournamentId: string;
  name: string;
  status: string;
  currentGeneration: number;
  maxGenerations: number;
  populationSize: number;
  symbols: string[];
  startedAt: string;
  completedAt?: string;
  generationCount: number;
  latestTopFitness: number;
  latestAvgFitness: number;
  latestAvgPnl: number;
  latestSurvivalRate: number;
}

interface CrossTournamentComparisonEntry {
  tournamentId: string;
  name: string;
  status: string;
  completedAt?: string;
  symbols: string[];
  generationCount: number;
  latestTopFitness: number;
  latestAvgFitness: number;
  latestAvgPnl: number;
  latestSurvivalRate: number;
}

interface LatestVsPreviousComparison {
  latestTournamentId: string;
  previousTournamentId: string;
  topFitnessDelta: number;
  avgFitnessDelta: number;
  generationCountDelta: number;
}

function getCompetitionMetrics(db: Database.Database, competitionId: string): { avgPnl: number } {
  let row: { avgPnl: number | null } | undefined;

  try {
    row = db.prepare(`
      SELECT AVG(pnl) AS avgPnl
      FROM agent_competitions
      WHERE competition_id = ?
    `).get(competitionId) as { avgPnl: number | null } | undefined;
  } catch {
    return { avgPnl: 0 };
  }

  return {
    avgPnl: typeof row?.avgPnl === 'number' ? row.avgPnl : 0,
  };
}

function buildTimeline(record: TournamentRecord, db: Database.Database): TournamentTimelineEntry[] {
  return record.generations.map(generation => {
    const metrics = getCompetitionMetrics(db, generation.competitionId);

    return {
      generation: generation.generation,
      topFitness: generation.topFitness,
      avgFitness: generation.avgFitness,
      avgPnl: metrics.avgPnl,
      survivalRate: generation.population.length > 0 ? (generation.survivors.length / generation.population.length) * 100 : 0,
      populationCount: generation.population.length,
      survivorCount: generation.survivors.length,
      offspringCount: generation.offspring.length,
      retiredCount: generation.retired.length,
      completedAt: generation.completedAt,
    };
  });
}

function summarizeTournament(record: TournamentRecord, db: Database.Database): TournamentDashboardSummary {
  const latestGeneration = record.generations[record.generations.length - 1];
  const latestMetrics = latestGeneration ? getCompetitionMetrics(db, latestGeneration.competitionId) : { avgPnl: 0 };

  return {
    tournamentId: record.tournamentId,
    name: record.name,
    status: record.status,
    currentGeneration: record.currentGeneration,
    maxGenerations: record.config.maxGenerations,
    populationSize: record.config.populationSize,
    symbols: record.config.symbols,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    generationCount: record.generations.length,
    latestTopFitness: latestGeneration?.topFitness ?? 0,
    latestAvgFitness: latestGeneration?.avgFitness ?? 0,
    latestAvgPnl: latestMetrics.avgPnl,
    latestSurvivalRate: latestGeneration && latestGeneration.population.length > 0
      ? (latestGeneration.survivors.length / latestGeneration.population.length) * 100
      : 0,
  };
}

function buildCrossTournamentComparisons(tournaments: TournamentRecord[], db: Database.Database): {
  bestTournament: CrossTournamentComparisonEntry | null;
  latestVsPrevious: LatestVsPreviousComparison | null;
  recentPerformance: CrossTournamentComparisonEntry[];
} {
  const comparable = tournaments.map(record => {
    const latestGeneration = record.generations[record.generations.length - 1];
    const latestMetrics = latestGeneration ? getCompetitionMetrics(db, latestGeneration.competitionId) : { avgPnl: 0 };

    return {
      tournamentId: record.tournamentId,
      name: record.name,
      status: record.status,
      completedAt: record.completedAt,
      symbols: record.config.symbols,
      generationCount: record.generations.length,
      latestTopFitness: latestGeneration?.topFitness ?? 0,
      latestAvgFitness: latestGeneration?.avgFitness ?? 0,
      latestAvgPnl: latestMetrics.avgPnl,
      latestSurvivalRate: latestGeneration && latestGeneration.population.length > 0
        ? (latestGeneration.survivors.length / latestGeneration.population.length) * 100
        : 0,
    };
  });

  const bestTournament = comparable.reduce<CrossTournamentComparisonEntry | null>((best, current) => {
    if (!best) return current;
    return current.latestTopFitness > best.latestTopFitness ? current : best;
  }, null);

  const latest = comparable[0] ?? null;
  const previous = comparable[1] ?? null;

  return {
    bestTournament,
    latestVsPrevious: latest && previous ? {
      latestTournamentId: latest.tournamentId,
      previousTournamentId: previous.tournamentId,
      topFitnessDelta: latest.latestTopFitness - previous.latestTopFitness,
      avgFitnessDelta: latest.latestAvgFitness - previous.latestAvgFitness,
      generationCountDelta: latest.generationCount - previous.generationCount,
    } : null,
    recentPerformance: comparable.slice(0, 6),
  };
}

export function createEvolutionaryRouter(db: Database.Database): Router {
  const router       = Router();
  const orchestrator = new EvolutionaryOrchestrator(db);
  const genomes      = new GenomeManager(db);
  const crossover    = new GeneticCrossover(db);
  const mutation     = new MutationEngine(db);
  const stats        = new AgentStatisticsManager(db);

  // ── POST /api/evolutionary/tournament — start a new tournament ────────────

  router.post('/api/evolutionary/tournament', async (req, res) => {
    try {
      const config = req.body as EvolutionaryTournamentConfig;

      if (!config.symbols || config.symbols.length === 0) {
        res.status(400).json({ error: 'symbols array is required' });
        return;
      }
      if (!config.populationSize || config.populationSize < 4) {
        res.status(400).json({ error: 'populationSize must be ≥ 4' });
        return;
      }
      if (!config.maxGenerations || config.maxGenerations < 1) {
        res.status(400).json({ error: 'maxGenerations must be ≥ 1' });
        return;
      }

      const tournamentId = await orchestrator.startTournament(config);
      res.status(202).json({ tournamentId, status: 'RUNNING' });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  // ── POST /api/evolutionary/breed — create mutated children from selected parents

  router.post('/api/evolutionary/breed', (req, res) => {
    try {
      const {
        parentIds,
        childCount,
        crossoverStrategy,
        mutationSeverity,
      } = req.body as {
        parentIds?: string[];
        childCount?: number;
        crossoverStrategy?: CrossoverStrategy;
        mutationSeverity?: MutationSeverity;
      };

      const uniqueParentIds = Array.from(new Set((parentIds ?? []).filter(id => typeof id === 'string' && id.trim())));
      if (uniqueParentIds.length < 2) {
        res.status(400).json({ error: 'At least 2 parentIds are required' });
        return;
      }

      const strategy = crossoverStrategy ?? 'UNIFORM';
      const severity = mutationSeverity ?? 'MEDIUM';
      const totalChildren = Math.min(Math.max(Math.floor(childCount ?? uniqueParentIds.length), 1), 20);

      if (!['UNIFORM', 'BLENDED'].includes(strategy)) {
        res.status(400).json({ error: 'crossoverStrategy must be UNIFORM or BLENDED' });
        return;
      }

      if (!['LIGHT', 'MEDIUM', 'HEAVY'].includes(severity)) {
        res.status(400).json({ error: 'mutationSeverity must be LIGHT, MEDIUM, or HEAVY' });
        return;
      }

      const activeParents = uniqueParentIds.filter(parentId => {
        const row = db.prepare("SELECT id FROM agent_registry WHERE id = ? AND status = 'ACTIVE'").get(parentId);
        return !!row;
      });

      if (activeParents.length < 2) {
        res.status(400).json({ error: 'At least 2 selected parents must be active agents' });
        return;
      }

      const children = crossover.breedPopulation(activeParents, totalChildren, strategy).map(result => {
        const mutationResult = mutation.mutateAndSave(result.offspringId, severity);
        stats.initializeStats(result.offspringId);

        const row = db.prepare('SELECT id, agent_type, risk_profile, generation_number, parent_id_1, parent_id_2, status FROM agent_registry WHERE id = ?')
          .get(result.offspringId) as {
            id: string;
            agent_type: string;
            risk_profile: string;
            generation_number: number;
            parent_id_1: string | null;
            parent_id_2: string | null;
            status: string;
          };

        return {
          id: row.id,
          agentType: row.agent_type,
          riskProfile: row.risk_profile,
          generationNumber: row.generation_number,
          status: row.status,
          parent1Id: row.parent_id_1,
          parent2Id: row.parent_id_2,
          mutationsApplied: mutationResult.mutations,
          mutationSeverity: mutationResult.mutationSeverity,
        };
      });

      res.status(201).json({
        parentIds: activeParents,
        childCount: children.length,
        crossoverStrategy: strategy,
        mutationSeverity: severity,
        children,
      });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  // ── GET /api/evolutionary/tournament — list all tournaments ──────────────

  router.get('/api/evolutionary/tournament', (_req, res) => {
    try {
      const list = orchestrator.listTournaments().map(t => ({
        tournamentId:      t.tournamentId,
        name:              t.name,
        status:            t.status,
        currentGeneration: t.currentGeneration,
        maxGenerations:    t.config.maxGenerations,
        populationSize:    t.config.populationSize,
        startedAt:         t.startedAt,
        completedAt:       t.completedAt,
      }));
      res.json({ tournaments: list });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/evolutionary/summary — aggregate dashboard summary ──────────

  router.get('/api/evolutionary/summary', (_req, res) => {
    try {
      const tournaments = orchestrator.listTournaments();
      const recentTournaments = tournaments.slice(0, 6).map(tournament => summarizeTournament(tournament, db));
      const latestTournament = tournaments[0] ?? null;

      const allGenerations = tournaments.flatMap(tournament => tournament.generations);
      const totalTopFitness = allGenerations.reduce((sum, generation) => sum + generation.topFitness, 0);
      const totalAvgFitness = allGenerations.reduce((sum, generation) => sum + generation.avgFitness, 0);

      res.json({
        totals: {
          totalTournaments: tournaments.length,
          completedTournaments: tournaments.filter(tournament => tournament.status === 'COMPLETED').length,
          runningTournaments: tournaments.filter(tournament => tournament.status === 'RUNNING').length,
          failedTournaments: tournaments.filter(tournament => tournament.status === 'FAILED').length,
          totalGenerations: allGenerations.length,
          averageTopFitness: allGenerations.length > 0 ? totalTopFitness / allGenerations.length : 0,
          averageGenerationFitness: allGenerations.length > 0 ? totalAvgFitness / allGenerations.length : 0,
        },
        crossTournament: buildCrossTournamentComparisons(tournaments, db),
        recentTournaments,
        latestTournament: latestTournament ? {
          ...summarizeTournament(latestTournament, db),
          generationTimeline: buildTimeline(latestTournament, db),
        } : null,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/evolutionary/tournament/:id — full status + generation history

  router.get('/api/evolutionary/tournament/:id', (req, res) => {
    try {
      const record = orchestrator.getTournament(req.params.id!);
      if (!record) {
        res.status(404).json({ error: 'tournament not found' });
        return;
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/agents/:id/genome ────────────────────────────────────────────

  router.get('/api/agents/:id/genome', (req, res) => {
    try {
      const genome = genomes.loadGenome(req.params.id!);
      if (!genome) {
        res.status(404).json({ error: 'genome not found for agent' });
        return;
      }
      res.json({ agentId: req.params.id, genome });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/agents/:id/genealogy ─────────────────────────────────────────

  router.get('/api/agents/:id/genealogy', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT
          g.id, g.agent_id, g.parent_1_id, g.parent_2_id,
          g.breeding_date, g.breeding_generation,
          g.inherited_genes, g.mutations_applied, g.mutation_severity,
          g.offspring_count
        FROM agent_genealogy g
        WHERE g.agent_id = ?
        ORDER BY g.breeding_generation ASC
      `).all(req.params.id) as Array<{
        id: string;
        agent_id: string;
        parent_1_id: string | null;
        parent_2_id: string | null;
        breeding_date: string;
        breeding_generation: number;
        inherited_genes: string | null;
        mutations_applied: string | null;
        mutation_severity: number;
        offspring_count: number;
      }>;

      const genealogy = rows.map(r => ({
        id:                 r.id,
        agentId:            r.agent_id,
        parent1Id:          r.parent_1_id,
        parent2Id:          r.parent_2_id,
        breedingDate:       r.breeding_date,
        breedingGeneration: r.breeding_generation,
        inheritedGenes:     r.inherited_genes ? JSON.parse(r.inherited_genes) : null,
        mutationsApplied:   r.mutations_applied ? JSON.parse(r.mutations_applied) : [],
        mutationSeverity:   r.mutation_severity,
        offspringCount:     r.offspring_count,
      }));

      res.json({ agentId: req.params.id, genealogy });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
