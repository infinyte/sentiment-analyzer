/**
 * GenerationResultStore
 *
 * SQLite-backed store for two concerns:
 *
 *   1. Generation checkpoints — a snapshot of the population (agent IDs) and
 *      the Claude directive in effect at the end of each generation.  Enables
 *      rollback to any prior generation state.
 *
 *   2. Extended agent lineage — richer birth-record for every agent created
 *      during an evolutionary tournament, capturing parentage, generation,
 *      genome architecture at birth, and the tournament context.
 *
 * Both tables are created by StorageService.createTables() and must exist
 * before this class is instantiated.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AgentGenome } from './agent-genome.js';
import type { GenerationDirective } from './ga-directive-types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface GenerationCheckpoint {
  /** Unique checkpoint ID. */
  id: string;
  /** Tournament this checkpoint belongs to. */
  tournamentId: string;
  /** Generation number that was completed when this checkpoint was saved. */
  generation: number;
  /** Ordered list of agent IDs that made up the population at end-of-generation. */
  population: string[];
  /** Claude directive that governed this generation (if claudeOrchestrated). */
  directive?: GenerationDirective;
  /** ISO timestamp when the checkpoint was persisted. */
  createdAt: string;
}

export interface AgentLineageExtended {
  /** Unique lineage record ID. */
  id: string;
  /** The agent this record describes. */
  agentId: string;
  /** Agent IDs of both parents (empty array for genesis agents). */
  parentIds: string[];
  /** Generation number when this agent was created / born. */
  generation: number;
  /** Full genome snapshot at the moment of birth. */
  architecture: AgentGenome;
  /** Fitness score at creation (0 for genesis agents; may be filled later). */
  fitnessAtBirth: number;
  /** Tournament in which this agent was created. */
  tournamentId: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

// ── GenerationResultStore ─────────────────────────────────────────────────────

export class GenerationResultStore {
  constructor(private readonly db: Database.Database) {}

  // ── Checkpoints ───────────────────────────────────────────────────────────

  /**
   * Persist a generation checkpoint.
   *
   * If a checkpoint already exists for (tournamentId, generation), it is
   * overwritten so re-running a generation produces a fresh snapshot.
   */
  saveCheckpoint(
    tournamentId: string,
    generation: number,
    population: string[],
    directive?: GenerationDirective,
  ): GenerationCheckpoint {
    const id        = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO generation_checkpoints
        (id, tournament_id, generation, population_json, directive_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tournament_id, generation) DO UPDATE SET
        id             = excluded.id,
        population_json = excluded.population_json,
        directive_json  = excluded.directive_json,
        created_at      = excluded.created_at
    `).run(
      id,
      tournamentId,
      generation,
      JSON.stringify(population),
      directive ? JSON.stringify(directive) : null,
      createdAt,
    );

    return { id, tournamentId, generation, population, directive, createdAt };
  }

  /**
   * Load a single checkpoint by tournament + generation.
   * Returns `undefined` if no checkpoint exists for that combination.
   */
  loadCheckpoint(
    tournamentId: string,
    generation: number,
  ): GenerationCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT id, tournament_id, generation, population_json, directive_json, created_at
      FROM generation_checkpoints
      WHERE tournament_id = ? AND generation = ?
    `).get(tournamentId, generation) as CheckpointRow | undefined;

    return row ? rowToCheckpoint(row) : undefined;
  }

  /**
   * List all checkpoints for a tournament, ordered by generation ascending.
   */
  listCheckpoints(tournamentId: string): GenerationCheckpoint[] {
    const rows = this.db.prepare(`
      SELECT id, tournament_id, generation, population_json, directive_json, created_at
      FROM generation_checkpoints
      WHERE tournament_id = ?
      ORDER BY generation ASC
    `).all(tournamentId) as CheckpointRow[];

    return rows.map(rowToCheckpoint);
  }

  // ── Extended lineage ──────────────────────────────────────────────────────

  /**
   * Persist an extended lineage record for a newly created agent.
   * Safe to call multiple times for the same agent (upserts by agent_id).
   */
  saveLineageEntry(entry: Omit<AgentLineageExtended, 'id' | 'createdAt'>): AgentLineageExtended {
    const id        = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO agent_lineage_extended
        (id, agent_id, parent_ids, generation, architecture, fitness_at_birth, tournament_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        parent_ids     = excluded.parent_ids,
        generation     = excluded.generation,
        architecture   = excluded.architecture,
        fitness_at_birth = excluded.fitness_at_birth,
        tournament_id  = excluded.tournament_id,
        created_at     = excluded.created_at
    `).run(
      id,
      entry.agentId,
      JSON.stringify(entry.parentIds),
      entry.generation,
      JSON.stringify(entry.architecture),
      entry.fitnessAtBirth,
      entry.tournamentId,
      createdAt,
    );

    return { id, createdAt, ...entry };
  }

  /**
   * Load all extended lineage records for a specific agent.
   * (Typically one per agent, but returns array for forward-compatibility.)
   */
  getLineage(agentId: string): AgentLineageExtended[] {
    const rows = this.db.prepare(`
      SELECT id, agent_id, parent_ids, generation, architecture, fitness_at_birth,
             tournament_id, created_at
      FROM agent_lineage_extended
      WHERE agent_id = ?
      ORDER BY created_at ASC
    `).all(agentId) as LineageRow[];

    return rows.map(rowToLineage);
  }

  /**
   * Load all extended lineage records created within a specific tournament,
   * ordered by generation then creation time.
   */
  getLineageForTournament(tournamentId: string): AgentLineageExtended[] {
    const rows = this.db.prepare(`
      SELECT id, agent_id, parent_ids, generation, architecture, fitness_at_birth,
             tournament_id, created_at
      FROM agent_lineage_extended
      WHERE tournament_id = ?
      ORDER BY generation ASC, created_at ASC
    `).all(tournamentId) as LineageRow[];

    return rows.map(rowToLineage);
  }

  /**
   * Update the fitness_at_birth of an existing lineage record.
   * Called once competition results are available for a new agent's first run.
   */
  updateFitnessAtBirth(agentId: string, fitness: number): void {
    this.db.prepare(`
      UPDATE agent_lineage_extended
      SET fitness_at_birth = ?
      WHERE agent_id = ?
    `).run(fitness, agentId);
  }
}

// ── Row-to-model helpers ──────────────────────────────────────────────────────

interface CheckpointRow {
  id:              string;
  tournament_id:   string;
  generation:      number;
  population_json: string;
  directive_json:  string | null;
  created_at:      string;
}

function rowToCheckpoint(row: CheckpointRow): GenerationCheckpoint {
  return {
    id:           row.id,
    tournamentId: row.tournament_id,
    generation:   row.generation,
    population:   JSON.parse(row.population_json) as string[],
    directive:    row.directive_json ? (JSON.parse(row.directive_json) as GenerationDirective) : undefined,
    createdAt:    row.created_at,
  };
}

interface LineageRow {
  id:               string;
  agent_id:         string;
  parent_ids:       string;
  generation:       number;
  architecture:     string;
  fitness_at_birth: number;
  tournament_id:    string;
  created_at:       string;
}

function rowToLineage(row: LineageRow): AgentLineageExtended {
  return {
    id:             row.id,
    agentId:        row.agent_id,
    parentIds:      JSON.parse(row.parent_ids) as string[],
    generation:     row.generation,
    architecture:   JSON.parse(row.architecture) as AgentGenome,
    fitnessAtBirth: row.fitness_at_birth,
    tournamentId:   row.tournament_id,
    createdAt:      row.created_at,
  };
}
