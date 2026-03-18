/**
 * MutationEngine — Phase 2.4 of the Evolutionary Agent System
 *
 * Introduces controlled variation into offspring genomes to prevent
 * premature convergence to local optima.
 *
 * Mutation types (applied per gene):
 *   - Parameter drift : value × Uniform(1 − drift, 1 + drift)
 *   - Threshold shift : value + Uniform(−shift, +shift)  [for threshold genes]
 *   - Random reset    : replace with uniform random within bounds (5 % chance)
 *
 * Severity controls how many genes are mutated and the magnitude of change:
 *
 *   | Severity | Genes mutated | Drift factor | Policy weight noise |
 *   |----------|---------------|--------------|---------------------|
 *   | LIGHT    | 2             | 0.10         | 0.01                |
 *   | MEDIUM   | 4             | 0.20         | 0.05                |
 *   | HEAVY    | 7             | 0.40         | 0.10                |
 *
 * Policy network weights are optionally mutated with Gaussian noise scaled
 * by the severity's weight noise factor.
 *
 * All mutations are clamped to GENE_BOUNDS.  A mutation log is returned so
 * callers can persist it to `agent_genealogy.mutations_applied`.
 */

import {
  type AgentGenome,
  type PolicyWeights,
  GENE_BOUNDS,
  NUMERIC_GENES,
  GenomeManager,
} from './agent-genome.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationSeverity = 'LIGHT' | 'MEDIUM' | 'HEAVY';

export interface MutationRecord {
  param: string;
  oldValue: number;
  newValue: number;
}

export interface MutationResult {
  genome:            AgentGenome;
  mutations:         MutationRecord[];
  mutationSeverity:  number;  // 0–1 scalar reflecting how much changed
  severityLabel:     MutationSeverity;
}

interface SeverityConfig {
  numGenes:        number;  // how many numeric genes to mutate
  driftFactor:     number;  // magnitude for drift/shift mutations
  weightNoise:     number;  // std-dev for policy weight perturbation
  resetChance:     number;  // probability of random-reset per selected gene
}

const SEVERITY_CONFIG: Record<MutationSeverity, SeverityConfig> = {
  LIGHT:  { numGenes: 2, driftFactor: 0.10, weightNoise: 0.01, resetChance: 0.05 },
  MEDIUM: { numGenes: 4, driftFactor: 0.20, weightNoise: 0.05, resetChance: 0.05 },
  HEAVY:  { numGenes: 7, driftFactor: 0.40, weightNoise: 0.10, resetChance: 0.10 },
};

// Threshold-style genes use additive shift instead of multiplicative drift
const THRESHOLD_GENES = new Set<string>([
  'entryThreshold', 'exitThreshold',
]);

// ── MutationEngine ────────────────────────────────────────────────────────────

export class MutationEngine {
  private readonly db:            Database.Database | null;
  private readonly genomeManager: GenomeManager | null;

  /** Pass `null` for `database` when using in-memory / test mode without persistence. */
  constructor(database: Database.Database | null = null) {
    this.db            = database;
    this.genomeManager = database ? new GenomeManager(database) : null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Apply random mutations to `genome` and return the mutated copy + log.
   *
   * The original genome is never modified.
   */
  mutate(genome: AgentGenome, severity: MutationSeverity = 'MEDIUM'): MutationResult {
    const cfg = SEVERITY_CONFIG[severity];
    const mutated: AgentGenome = JSON.parse(JSON.stringify(genome)) as AgentGenome;
    const mutations: MutationRecord[] = [];

    // ── Select which genes to mutate ──────────────────────────────────────
    const shuffled = [...NUMERIC_GENES].sort(() => Math.random() - 0.5);
    const targets  = shuffled.slice(0, Math.min(cfg.numGenes, NUMERIC_GENES.length));

    for (const key of targets) {
      const { min, max, integer } = GENE_BOUNDS[key];
      const oldValue = (mutated as unknown as Record<string, number>)[key] as number;
      let newValue: number;

      // 5–10 % chance of full random reset
      if (Math.random() < cfg.resetChance) {
        newValue = min + Math.random() * (max - min);
      } else if (THRESHOLD_GENES.has(key)) {
        // Threshold genes: additive uniform shift
        const shift = (Math.random() * 2 - 1) * cfg.driftFactor * (max - min);
        newValue = oldValue + shift;
      } else {
        // Continuous genes: multiplicative drift
        const scale = 1 + (Math.random() * 2 - 1) * cfg.driftFactor;
        newValue = oldValue * scale;
      }

      // Clamp + integer rounding
      newValue = Math.max(min, Math.min(max, integer ? Math.round(newValue) : newValue));

      if (newValue !== oldValue) {
        (mutated as unknown as Record<string, number>)[key] = newValue;
        mutations.push({ param: key, oldValue, newValue });
      }
    }

    // ── Policy weight perturbation ────────────────────────────────────────
    if (mutated.policyWeights && cfg.weightNoise > 0) {
      mutated.policyWeights = this.perturbWeights(mutated.policyWeights, cfg.weightNoise);
    }

    // ── Compute scalar severity (0–1) ─────────────────────────────────────
    const mutationSeverity = this.computeSeverityScore(mutations, genome);

    return { genome: mutated, mutations, mutationSeverity, severityLabel: severity };
  }

  /**
   * Persist mutation records to `agent_genealogy` for the given agent.
   * Call this AFTER the genome has been saved via GenomeManager.
   */
  persistMutations(agentId: string, result: MutationResult): void {
    if (!this.db) throw new Error('No database configured');

    const row = this.db
      .prepare('SELECT id FROM agent_genealogy WHERE agent_id = ? ORDER BY breeding_date DESC LIMIT 1')
      .get(agentId) as { id: string } | undefined;

    if (row) {
      // Update the most recent genealogy record
      this.db.prepare(`
        UPDATE agent_genealogy
        SET mutations_applied = ?,
            mutation_severity = ?
        WHERE id = ?
      `).run(JSON.stringify(result.mutations), result.mutationSeverity, row.id);
    } else {
      // Orphan agent (no crossover record) — create a new row
      this.db.prepare(`
        INSERT INTO agent_genealogy
          (id, agent_id, mutations_applied, mutation_severity)
        VALUES (?, ?, ?, ?)
      `).run(randomUUID(), agentId, JSON.stringify(result.mutations), result.mutationSeverity);
    }
  }

  /**
   * Apply mutation and persist the updated genome in one step.
   * Returns the MutationResult so callers can inspect what changed.
   */
  mutateAndSave(agentId: string, severity: MutationSeverity = 'MEDIUM'): MutationResult {
    if (!this.genomeManager) throw new Error('No database configured');

    const genome = this.genomeManager.loadGenome(agentId);
    if (!genome) throw new Error(`No genome for agent ${agentId}`);

    const result = this.mutate(genome, severity);
    this.genomeManager.saveGenome(agentId, result.genome);
    this.persistMutations(agentId, result);
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Add Gaussian-style noise to every weight element with probability 10 %.
   */
  private perturbWeights(weights: PolicyWeights, stdDev: number): PolicyWeights {
    const noise = () => (Math.random() < 0.10 ? (Math.random() * 2 - 1) * stdDev : 0);
    const pertMatrix = (m: number[][]): number[][] =>
      m.map(row => row.map(v => v + noise()));
    const pertVector = (v: number[]): number[] =>
      v.map(x => x + noise());

    return {
      w1: pertMatrix(weights.w1),
      b1: pertVector(weights.b1),
      w2: pertMatrix(weights.w2),
      b2: pertVector(weights.b2),
      w3: pertMatrix(weights.w3),
      b3: pertVector(weights.b3),
    };
  }

  /**
   * Compute a 0–1 severity score based on average relative change across
   * all mutated genes.
   */
  private computeSeverityScore(mutations: MutationRecord[], original: AgentGenome): number {
    if (mutations.length === 0) return 0;

    const relativeChanges = mutations.map(({ param, oldValue, newValue }) => {
      const { min, max } = GENE_BOUNDS[param as keyof typeof GENE_BOUNDS] ?? { min: 0, max: 1 };
      const range = max - min || 1;
      return Math.abs(newValue - oldValue) / range;
    });

    const avg = relativeChanges.reduce((s, v) => s + v, 0) / relativeChanges.length;
    // Scale by fraction of genome mutated to weight coverage
    const coverageFraction = mutations.length / NUMERIC_GENES.length;
    return Math.min(1, avg * 2 * coverageFraction);
  }
}
