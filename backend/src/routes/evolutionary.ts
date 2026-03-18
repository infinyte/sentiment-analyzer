/**
 * Evolutionary Tournament Routes — Phase 2
 *
 * Endpoints:
 *   POST /api/evolutionary/tournament           - start a new tournament
 *   GET  /api/evolutionary/tournament           - list all tournaments
 *   GET  /api/evolutionary/tournament/:id       - get tournament status/summary
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
