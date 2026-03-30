/**
 * Agent Genome — Phase 2.2 of the Evolutionary Agent System
 *
 * Defines the heritable genetic traits of a MarlTradingAgent and provides
 * GenomeManager for CRUD + serialisation.
 *
 * Genome parameters fall into two categories:
 *   - Learning hyperparameters: directly map to MarlTradingAgent fields
 *     (epsilon, learningRate, gamma, explorationDecayRate)
 *   - Behavioural thresholds: virtual parameters governing trading decisions
 *     (entryThreshold, exitThreshold, stopLossPct, takeProfitPct,
 *      positionSizePct, riskPercent, holdDurationMax)
 *
 * Policy weights are optionally embedded so crossover can blend network
 * weights from two parents.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ModelArchitecture, ArchitectureParams } from './architecture-params.js';
export type { ModelArchitecture, ArchitectureParams } from './architecture-params.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Weight tensors from PolicyNetwork.cloneWeights() */
export interface PolicyWeights {
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
  w3: number[][];
  b3: number[];
}

/**
 * All heritable traits.  Every numeric gene has a defined valid range;
 * `holdDurationMax` is an integer gene.
 */
export interface AgentGenome {
  // ── Learning hyperparameters ──────────────────────────────────────────────
  /** Epsilon-greedy exploration rate.  Range: [0.01, 0.50] */
  epsilon: number;
  /** Gradient-free policy update rate (alpha).  Range: [0.001, 0.10] */
  learningRate: number;
  /** Discount factor for future rewards.  Range: [0.90, 0.999] */
  gamma: number;
  /** Per-step epsilon decay multiplier.  Range: [0.990, 0.9999] */
  explorationDecayRate: number;

  // ── Behavioural thresholds ────────────────────────────────────────────────
  /** Minimum sentiment signal strength to open a position.  Range: [30, 80] */
  entryThreshold: number;
  /** Minimum signal strength to close / exit a position.  Range: [20, 70] */
  exitThreshold: number;
  /** Stop-loss distance as % of entry price.  Range: [1, 15] */
  stopLossPct: number;
  /** Take-profit distance as % of entry price.  Range: [3, 30] */
  takeProfitPct: number;
  /** Maximum position size as % of total capital.  Range: [5, 30] */
  positionSizePct: number;
  /** Capital risked per trade as % of total capital.  Range: [0.5, 5] */
  riskPercent: number;
  /** Maximum steps to hold a position before forced close.  Range: [1, 20] (integer) */
  holdDurationMax: number;

  // ── Model architecture ────────────────────────────────────────────────────
  /**
   * Signal-processing architecture used by this agent in the competition engine.
   * Absent ≡ base feedforward policy network with no additional processing.
   */
  modelArchitecture?: ModelArchitecture;
  /**
   * Architecture-specific hyper-parameters (LSTMParams | GANParams | TransformerParams).
   * Shape depends on modelArchitecture; absent when modelArchitecture is absent.
   */
  architectureParams?: ArchitectureParams;

  // ── Adversarial training fields ───────────────────────────────────────────
  /** Role of this agent in adversarial training. Absent ≡ 'SENTIMENT'. */
  agentType?: 'SENTIMENT' | 'ADVERSARY';
  /** ID of the sentiment agent this adversary was built to stress-test (adversary agents only). */
  targetAgentId?: string;

  // ── Optional embedded policy weights (for network crossover) ─────────────
  policyWeights?: PolicyWeights;
}

/** Valid range + optional integer constraint per gene. */
export interface GeneBounds {
  min: number;
  max: number;
  integer?: boolean;
}

/** Canonical valid ranges — used by crossover and mutation to clamp values. */
export const GENE_BOUNDS: Record<keyof Omit<AgentGenome, 'policyWeights' | 'agentType' | 'targetAgentId' | 'modelArchitecture' | 'architectureParams'>, GeneBounds> = {
  epsilon:              { min: 0.01,   max: 0.50 },
  learningRate:         { min: 0.001,  max: 0.10 },
  gamma:                { min: 0.90,   max: 0.999 },
  explorationDecayRate: { min: 0.990,  max: 0.9999 },
  entryThreshold:       { min: 30,     max: 80 },
  exitThreshold:        { min: 20,     max: 70 },
  stopLossPct:          { min: 1,      max: 15 },
  takeProfitPct:        { min: 3,      max: 30 },
  positionSizePct:      { min: 5,      max: 30 },
  riskPercent:          { min: 0.5,    max: 5 },
  holdDurationMax:      { min: 1,      max: 20, integer: true },
};

export const NUMERIC_GENES = Object.keys(GENE_BOUNDS) as Array<keyof typeof GENE_BOUNDS>;

/**
 * Adversary-specific gene bounds.  Behavioural genes are inverted relative to
 * normal sentiment agents so that adversaries stress-test the population by
 * trading with counter-strategies.
 *
 *   entryThreshold : [20, 50]  — lower than normal [30, 80] → more aggressive entry
 *   exitThreshold  : [60, 90]  — higher than normal [20, 70] → adversary holds longer
 *   stopLossPct    : [1, 5]    — tighter stops than normal [1, 15]
 *   takeProfitPct  : [1, 8]    — smaller take-profit than normal [3, 30]
 *   positionSizePct: [20, 30]  — oversized positions to amplify pressure
 *   riskPercent    : [3, 5]    — elevated risk per trade
 *   holdDurationMax: [1, 5]    — very short hold windows
 */
export const ADVERSARY_GENE_BOUNDS: Record<
  keyof Omit<AgentGenome, 'policyWeights' | 'agentType' | 'targetAgentId' | 'modelArchitecture' | 'architectureParams'>,
  GeneBounds
> = {
  epsilon:              { min: 0.01,  max: 0.50 },
  learningRate:         { min: 0.001, max: 0.10 },
  gamma:                { min: 0.90,  max: 0.999 },
  explorationDecayRate: { min: 0.990, max: 0.9999 },
  entryThreshold:       { min: 20,    max: 50 },
  exitThreshold:        { min: 60,    max: 90 },
  stopLossPct:          { min: 1,     max: 5 },
  takeProfitPct:        { min: 1,     max: 8 },
  positionSizePct:      { min: 20,    max: 30 },
  riskPercent:          { min: 3,     max: 5 },
  holdDurationMax:      { min: 1,     max: 5, integer: true },
};

// ── Default genome (sensible mid-range starting values) ───────────────────────

export function createDefaultGenome(): AgentGenome {
  return {
    epsilon:              0.10,
    learningRate:         0.010,
    gamma:                0.990,
    explorationDecayRate: 0.9990,
    entryThreshold:       55,
    exitThreshold:        40,
    stopLossPct:          5,
    takeProfitPct:        10,
    positionSizePct:      15,
    riskPercent:          2,
    holdDurationMax:      5,
  };
}

/** Generate a random genome with values uniformly sampled within bounds. */
export function createRandomGenome(): AgentGenome {
  const genome = {} as AgentGenome;
  for (const key of NUMERIC_GENES) {
    const { min, max, integer } = GENE_BOUNDS[key];
    const raw = min + Math.random() * (max - min);
    (genome as unknown as Record<string, number>)[key] = integer ? Math.round(raw) : raw;
  }
  return genome;
}

// ── GenomeManager ─────────────────────────────────────────────────────────────

export class GenomeManager {
  private readonly db: Database.Database;

  constructor(database: Database.Database) {
    this.db = database;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /** Upsert a genome into `agent_genomes`. Idempotent. */
  saveGenome(agentId: string, genome: AgentGenome): void {
    this.db.prepare(`
      INSERT INTO agent_genomes (agent_id, genome, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        genome     = excluded.genome,
        updated_at = excluded.updated_at
    `).run(agentId, JSON.stringify(genome));
  }

  /**
   * Load the genome for `agentId`.
   * Returns `null` if no genome has been saved yet.
   */
  loadGenome(agentId: string): AgentGenome | null {
    const row = this.db
      .prepare('SELECT genome FROM agent_genomes WHERE agent_id = ?')
      .get(agentId) as { genome: string } | undefined;
    return row ? (JSON.parse(row.genome) as AgentGenome) : null;
  }

  /** Delete the genome row for `agentId`. */
  deleteGenome(agentId: string): void {
    this.db.prepare('DELETE FROM agent_genomes WHERE agent_id = ?').run(agentId);
  }

  // ── Gene accessors ────────────────────────────────────────────────────────

  getGene(genome: AgentGenome, key: keyof typeof GENE_BOUNDS): number {
    return genome[key] as number;
  }

  /**
   * Return a new genome with `key` set to `value`.
   * Clamps `value` to the valid range; rounds if integer gene.
   * The original genome is not mutated.
   */
  setGene(genome: AgentGenome, key: keyof typeof GENE_BOUNDS, value: number): AgentGenome {
    const { min, max, integer } = GENE_BOUNDS[key];
    const clamped = Math.max(min, Math.min(max, integer ? Math.round(value) : value));
    return { ...genome, [key]: clamped };
  }

  // ── Clone / serialise ─────────────────────────────────────────────────────

  /** Deep-clone a genome (independent copy). */
  clone(genome: AgentGenome): AgentGenome {
    return JSON.parse(JSON.stringify(genome)) as AgentGenome;
  }

  toJSON(genome: AgentGenome): string {
    return JSON.stringify(genome);
  }

  fromJSON(json: string): AgentGenome {
    return JSON.parse(json) as AgentGenome;
  }

  // ── Registry helper ───────────────────────────────────────────────────────

  /**
   * Create a new row in `agent_registry` + an initial genome.
   * Returns the new agent ID.
   */
  registerNewAgent(opts: {
    agentType?: string;
    riskProfile?: string;
    genome?: AgentGenome;
    parentId1?: string;
    parentId2?: string;
    generationNumber?: number;
  } = {}): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO agent_registry
        (id, agent_type, risk_profile, status, generation_number, parent_id_1, parent_id_2)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)
    `).run(
      id,
      opts.agentType ?? 'ML_BASED',
      opts.riskProfile ?? 'CONSERVATIVE',
      opts.generationNumber ?? 0,
      opts.parentId1 ?? null,
      opts.parentId2 ?? null,
    );

    this.saveGenome(id, opts.genome ?? createDefaultGenome());
    return id;
  }
}
