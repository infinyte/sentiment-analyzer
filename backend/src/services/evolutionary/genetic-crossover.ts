/**
 * GeneticCrossover — Phase 2.3 of the Evolutionary Agent System
 *
 * Produces offspring genomes by combining traits from two parent agents.
 *
 * Crossover strategy:
 *   - **Uniform crossover** (default): each gene independently inherits from
 *     parent1 or parent2 with 50 % probability.
 *   - **Blended crossover** (optional): offspring gene = arithmetic mean of
 *     both parents.  Useful when both parents are strong performers.
 *   - **Policy-weight crossover**: element-wise uniform selection per weight,
 *     so offspring networks blend the learned representations of both parents.
 *
 * All offspring genes are clamped to their valid ranges after crossover.
 * A genealogy record is written to `agent_genealogy` and the offspring is
 * registered in `agent_registry`.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type AgentGenome,
  type PolicyWeights,
  GENE_BOUNDS,
  NUMERIC_GENES,
  GenomeManager,
} from './agent-genome.js';
import {
  type ArchitectureParams,
  type ModelArchitecture,
  type LSTMParams,
  type GANParams,
  type TransformerParams,
  isLSTMParams,
  isGANParams,
  isTransformerParams,
} from './architecture-params.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CrossoverStrategy = 'UNIFORM' | 'BLENDED';

export interface CrossoverResult {
  offspringId:     string;
  offspringGenome: AgentGenome;
  /** Which parent each numeric gene was inherited from ('parent1' | 'parent2' | 'blend'). */
  inheritanceMap: Record<string, 'parent1' | 'parent2' | 'blend'>;
  generationNumber: number;
}

// ── GeneticCrossover ──────────────────────────────────────────────────────────

export class GeneticCrossover {
  private readonly db: Database.Database;
  private readonly genomeManager: GenomeManager;

  constructor(database: Database.Database) {
    this.db = database;
    this.genomeManager = new GenomeManager(database);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Breed two parent agents and persist the offspring.
   *
   * @param parent1Id - Agent registry ID of the first parent
   * @param parent2Id - Agent registry ID of the second parent
   * @param strategy  - Crossover method (default: 'UNIFORM')
   * @returns         - Full CrossoverResult including the new offspring ID
   */
  breed(
    parent1Id: string,
    parent2Id: string,
    strategy: CrossoverStrategy = 'UNIFORM',
  ): CrossoverResult {
    const g1 = this.requireGenome(parent1Id);
    const g2 = this.requireGenome(parent2Id);

    const gen1 = this.getGenerationNumber(parent1Id);
    const gen2 = this.getGenerationNumber(parent2Id);
    const offspringGeneration = Math.max(gen1, gen2) + 1;

    // ── Numeric gene crossover ───────────────────────────────────────────
    const offspringGenome = {} as AgentGenome;
    const inheritanceMap: Record<string, 'parent1' | 'parent2' | 'blend'> = {};

    for (const key of NUMERIC_GENES) {
      const { min, max, integer } = GENE_BOUNDS[key];
      let value: number;
      let source: 'parent1' | 'parent2' | 'blend';

      if (strategy === 'BLENDED') {
        value  = ((g1[key] as number) + (g2[key] as number)) / 2;
        source = 'blend';
      } else {
        // Uniform: 50 % from each parent
        const useParent1 = Math.random() < 0.5;
        value  = useParent1 ? (g1[key] as number) : (g2[key] as number);
        source = useParent1 ? 'parent1' : 'parent2';
      }

      // Clamp to valid range
      value = Math.max(min, Math.min(max, integer ? Math.round(value) : value));
      (offspringGenome as unknown as Record<string, number>)[key] = value;
      inheritanceMap[key] = source;
    }

    // ── Policy-weight crossover ──────────────────────────────────────────
    if (g1.policyWeights && g2.policyWeights) {
      offspringGenome.policyWeights = this.crossoverWeights(g1.policyWeights, g2.policyWeights);
    } else if (g1.policyWeights || g2.policyWeights) {
      offspringGenome.policyWeights = this.genomeManager.clone(
        (g1.policyWeights ? g1 : g2)
      ).policyWeights;
    }

    // ── Architecture crossover ───────────────────────────────────────────
    const archResult = this.crossoverArchitecture(
      g1.modelArchitecture, g1.architectureParams,
      g2.modelArchitecture, g2.architectureParams,
      strategy,
    );
    if (archResult.modelArchitecture) {
      offspringGenome.modelArchitecture = archResult.modelArchitecture;
      offspringGenome.architectureParams = archResult.architectureParams;
    }

    // ── Register offspring ───────────────────────────────────────────────
    const agentType    = this.getAgentType(parent1Id);
    const riskProfile  = this.getRiskProfile(parent1Id);
    const offspringId  = this.genomeManager.registerNewAgent({
      agentType,
      riskProfile,
      genome: offspringGenome,
      parentId1: parent1Id,
      parentId2: parent2Id,
      generationNumber: offspringGeneration,
    });

    // ── Write genealogy record ───────────────────────────────────────────
    this.db.prepare(`
      INSERT INTO agent_genealogy
        (id, agent_id, parent_1_id, parent_2_id, breeding_generation,
         inherited_genes, mutations_applied, mutation_severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      offspringId,
      parent1Id,
      parent2Id,
      offspringGeneration,
      JSON.stringify(inheritanceMap),
      JSON.stringify([]),   // no mutations yet at crossover time
      0,
    );

    // Increment offspring_count on both parents
    this.db.prepare(`
      UPDATE agent_genealogy
      SET offspring_count = offspring_count + 1
      WHERE agent_id = ?
    `).run(parent1Id);
    this.db.prepare(`
      UPDATE agent_genealogy
      SET offspring_count = offspring_count + 1
      WHERE agent_id = ?
    `).run(parent2Id);

    return { offspringId, offspringGenome, inheritanceMap, generationNumber: offspringGeneration };
  }

  /**
   * Breed multiple offspring pairs from a list of survivor IDs.
   * Pairs are formed randomly from the survivor pool.
   */
  breedPopulation(
    survivorIds: string[],
    offspringCount: number,
    strategy: CrossoverStrategy = 'UNIFORM',
  ): CrossoverResult[] {
    if (survivorIds.length < 2) {
      throw new Error('Need at least 2 survivors to breed');
    }
    const results: CrossoverResult[] = [];
    for (let i = 0; i < offspringCount; i++) {
      const shuffled = [...survivorIds].sort(() => Math.random() - 0.5);
      results.push(this.breed(shuffled[0]!, shuffled[1]!, strategy));
    }
    return results;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private requireGenome(agentId: string): AgentGenome {
    const g = this.genomeManager.loadGenome(agentId);
    if (!g) throw new Error(`No genome found for agent ${agentId}`);
    return g;
  }

  private getGenerationNumber(agentId: string): number {
    const row = this.db
      .prepare('SELECT generation_number FROM agent_registry WHERE id = ?')
      .get(agentId) as { generation_number: number } | undefined;
    return row?.generation_number ?? 0;
  }

  private getAgentType(agentId: string): string {
    const row = this.db
      .prepare('SELECT agent_type FROM agent_registry WHERE id = ?')
      .get(agentId) as { agent_type: string } | undefined;
    return row?.agent_type ?? 'ML_BASED';
  }

  private getRiskProfile(agentId: string): string {
    const row = this.db
      .prepare('SELECT risk_profile FROM agent_registry WHERE id = ?')
      .get(agentId) as { risk_profile: string } | undefined;
    return row?.risk_profile ?? 'CONSERVATIVE';
  }

  /**
   * Resolve architecture and architectureParams for offspring.
   *
   * Rules:
   *   - Both parents same architecture: crossover params field-by-field
   *     (BLENDED averages compatible floats/ints; UNIFORM picks one parent's params)
   *   - Parents have different architectures:
   *     BLENDED → HYBRID offspring inheriting a randomly chosen parent's params
   *     UNIFORM → randomly pick one parent's architecture + params wholesale
   *   - Only one parent has architecture: offspring inherits it directly
   *   - Neither has architecture: offspring has no architecture fields
   */
  private crossoverArchitecture(
    arch1: ModelArchitecture | undefined,
    params1: ArchitectureParams | undefined,
    arch2: ModelArchitecture | undefined,
    params2: ArchitectureParams | undefined,
    strategy: CrossoverStrategy,
  ): { modelArchitecture?: ModelArchitecture; architectureParams?: ArchitectureParams } {
    // Neither parent has an architecture
    if (!arch1 && !arch2) return {};

    // Only one parent has an architecture — inherit it directly
    if (arch1 && !arch2) return { modelArchitecture: arch1, architectureParams: params1 };
    if (!arch1 && arch2) return { modelArchitecture: arch2, architectureParams: params2 };

    // Both parents have an architecture
    if (arch1 === arch2) {
      // Same architecture — crossover the params
      if (strategy === 'UNIFORM') {
        // Pick one parent's params wholesale
        const useParent1 = Math.random() < 0.5;
        return {
          modelArchitecture: arch1!,
          architectureParams: useParent1 ? params1 : params2,
        };
      }
      // BLENDED — average compatible numeric fields
      return {
        modelArchitecture: arch1!,
        architectureParams: this.blendArchitectureParams(params1!, params2!),
      };
    }

    // Different architectures
    if (strategy === 'BLENDED') {
      // Produce a HYBRID offspring using one parent's params as the base
      const useParent1 = Math.random() < 0.5;
      return {
        modelArchitecture: 'HYBRID',
        architectureParams: useParent1 ? params1 : params2,
      };
    }

    // UNIFORM + different architectures → randomly pick one parent's architecture+params
    const useParent1 = Math.random() < 0.5;
    return {
      modelArchitecture: useParent1 ? arch1! : arch2!,
      architectureParams: useParent1 ? params1 : params2,
    };
  }

  /**
   * Blend two ArchitectureParams objects by averaging each numeric field.
   * Both params must be the same shape (same architecture type).
   */
  private blendArchitectureParams(
    p1: ArchitectureParams,
    p2: ArchitectureParams,
  ): ArchitectureParams {
    if (isLSTMParams(p1) && isLSTMParams(p2)) {
      return {
        sequenceLength: Math.round((p1.sequenceLength + p2.sequenceLength) / 2),
        hiddenUnits:    Math.round((p1.hiddenUnits    + p2.hiddenUnits)    / 2),
        dropout:        (p1.dropout + p2.dropout) / 2,
      } as LSTMParams;
    }
    if (isGANParams(p1) && isGANParams(p2)) {
      return {
        adversarialPressure: (p1.adversarialPressure + p2.adversarialPressure) / 2,
        discriminatorWeight: (p1.discriminatorWeight + p2.discriminatorWeight) / 2,
        generatorLR:         (p1.generatorLR         + p2.generatorLR)         / 2,
      } as GANParams;
    }
    if (isTransformerParams(p1) && isTransformerParams(p2)) {
      // attentionHeads: pick the parent with lower index in valid set (more conservative)
      const headAvg = Math.round((p1.attentionHeads + p2.attentionHeads) / 2);
      // Snap to nearest power-of-two in valid set {1,2,4,8}
      const validHeads = [1, 2, 4, 8];
      const attentionHeads = validHeads.reduce((best, h) =>
        Math.abs(h - headAvg) < Math.abs(best - headAvg) ? h : best
      );
      return {
        attentionHeads,
        embeddingDim:   Math.round((p1.embeddingDim   + p2.embeddingDim)   / 2),
        feedforwardDim: Math.round((p1.feedforwardDim + p2.feedforwardDim) / 2),
      } as TransformerParams;
    }
    // Mismatched types — fall back to first parent's params
    return p1;
  }

  /**
   * Element-wise uniform crossover of two PolicyWeight objects.
   * Each scalar weight randomly comes from w1 or w2.
   */
  private crossoverWeights(w1: PolicyWeights, w2: PolicyWeights): PolicyWeights {
    const xMatrix = (a: number[][], b: number[][]): number[][] =>
      a.map((row, i) => row.map((v, j) => (Math.random() < 0.5 ? v : b[i]![j]!)));
    const xVector = (a: number[], b: number[]): number[] =>
      a.map((v, i) => (Math.random() < 0.5 ? v : b[i]!));

    return {
      w1: xMatrix(w1.w1, w2.w1),
      b1: xVector(w1.b1, w2.b1),
      w2: xMatrix(w1.w2, w2.w2),
      b2: xVector(w1.b2, w2.b2),
      w3: xMatrix(w1.w3, w2.w3),
      b3: xVector(w1.b3, w2.b3),
    };
  }
}
