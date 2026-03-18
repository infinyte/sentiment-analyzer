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

export function createEvolutionaryRouter(db: Database.Database): Router {
  const router       = Router();
  const orchestrator = new EvolutionaryOrchestrator(db);
  const genomes      = new GenomeManager(db);

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
