/**
 * MutationEngine unit tests (Phase 2.4)
 */

import Database from 'better-sqlite3';
import { MutationEngine, type MutationSeverity } from '../../../services/evolutionary/mutation-engine.js';
import { GenomeManager, createDefaultGenome, GENE_BOUNDS, NUMERIC_GENES, type AgentGenome } from '../../../services/evolutionary/agent-genome.js';
import {
  createDefaultLSTMParams,
  createDefaultGANParams,
  createDefaultTransformerParams,
  isLSTMParams,
  isGANParams,
  isTransformerParams,
  LSTM_PARAM_BOUNDS,
  GAN_PARAM_BOUNDS,
  TRANSFORMER_PARAM_BOUNDS,
  VALID_ATTENTION_HEADS,
} from '../../../services/evolutionary/architecture-params.js';

// ── DB helpers ────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agent_registry (
      id                TEXT PRIMARY KEY,
      agent_type        TEXT NOT NULL DEFAULT 'ML_BASED',
      risk_profile      TEXT NOT NULL DEFAULT 'CONSERVATIVE',
      status            TEXT NOT NULL DEFAULT 'ACTIVE',
      generation_number INTEGER NOT NULL DEFAULT 0,
      parent_id_1       TEXT,
      parent_id_2       TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE agent_genomes (
      agent_id   TEXT PRIMARY KEY REFERENCES agent_registry(id),
      genome     TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE agent_genealogy (
      id                  TEXT PRIMARY KEY,
      agent_id            TEXT NOT NULL REFERENCES agent_registry(id),
      parent_1_id         TEXT,
      parent_2_id         TEXT,
      breeding_date       TEXT NOT NULL DEFAULT (datetime('now')),
      breeding_generation INTEGER NOT NULL DEFAULT 0,
      inherited_genes     TEXT,
      mutations_applied   TEXT,
      mutation_severity   REAL NOT NULL DEFAULT 0,
      offspring_count     INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MutationEngine — mutate()', () => {
  const engine = new MutationEngine();  // no DB needed for pure mutation

  it('does not mutate the original genome', () => {
    const genome = createDefaultGenome();
    const original = JSON.parse(JSON.stringify(genome));
    engine.mutate(genome, 'HEAVY');
    expect(genome).toEqual(original);
  });

  it('mutated genome still has all numeric genes', () => {
    const genome = createDefaultGenome();
    const { genome: mutated } = engine.mutate(genome, 'MEDIUM');
    for (const key of NUMERIC_GENES) {
      expect(typeof mutated[key]).toBe('number');
    }
  });

  // ── Bounds checking (100 mutations per severity) ──────────────────────────

  const severities: MutationSeverity[] = ['LIGHT', 'MEDIUM', 'HEAVY'];

  for (const severity of severities) {
    it(`${severity}: all genes stay within bounds (100 mutations)`, () => {
      const base = createDefaultGenome();
      for (let i = 0; i < 100; i++) {
        const { genome: m } = engine.mutate(base, severity);
        for (const key of NUMERIC_GENES) {
          const { min, max } = GENE_BOUNDS[key];
          expect(m[key] as number).toBeGreaterThanOrEqual(min);
          expect(m[key] as number).toBeLessThanOrEqual(max);
        }
      }
    });
  }

  it('integer gene holdDurationMax remains an integer after 100 mutations', () => {
    const base = createDefaultGenome();
    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(base, 'HEAVY');
      expect(Number.isInteger(m.holdDurationMax)).toBe(true);
    }
  });

  // ── Mutation records ──────────────────────────────────────────────────────

  it('returns a mutations array with param/oldValue/newValue', () => {
    const base = createDefaultGenome();
    // Run many times; at least one should produce a mutation record
    let found = false;
    for (let i = 0; i < 50; i++) {
      const { mutations } = engine.mutate(base, 'MEDIUM');
      if (mutations.length > 0) {
        found = true;
        for (const m of mutations) {
          expect(typeof m.param).toBe('string');
          expect(typeof m.oldValue).toBe('number');
          expect(typeof m.newValue).toBe('number');
          expect(NUMERIC_GENES).toContain(m.param);
        }
        break;
      }
    }
    expect(found).toBe(true);
  });

  // ── Severity label ────────────────────────────────────────────────────────

  it('returns the correct severityLabel', () => {
    const base = createDefaultGenome();
    for (const sev of severities) {
      expect(engine.mutate(base, sev).severityLabel).toBe(sev);
    }
  });

  // ── Mutation severity score ───────────────────────────────────────────────

  it('mutationSeverity is in [0, 1]', () => {
    const base = createDefaultGenome();
    for (let i = 0; i < 50; i++) {
      const { mutationSeverity } = engine.mutate(base, 'HEAVY');
      expect(mutationSeverity).toBeGreaterThanOrEqual(0);
      expect(mutationSeverity).toBeLessThanOrEqual(1);
    }
  });

  // ── HEAVY produces more change than LIGHT on average ─────────────────────

  it('HEAVY mutations change more genes on average than LIGHT', () => {
    const base = createDefaultGenome();
    const lightCounts: number[] = [];
    const heavyCounts: number[] = [];

    for (let i = 0; i < 200; i++) {
      lightCounts.push(engine.mutate(base, 'LIGHT').mutations.length);
      heavyCounts.push(engine.mutate(base, 'HEAVY').mutations.length);
    }

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    expect(avg(heavyCounts)).toBeGreaterThan(avg(lightCounts));
  });
});

// ── Architecture-param mutation tests ─────────────────────────────────────────

describe('MutationEngine — architecture parameter mutation', () => {
  const engine = new MutationEngine();

  it('LSTM: mutated sequenceLength stays within bounds (100 runs)', () => {
    const base = { ...createDefaultGenome(), modelArchitecture: 'LSTM' as const, architectureParams: createDefaultLSTMParams() };
    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(base, 'HEAVY');
      expect(isLSTMParams(m.architectureParams!)).toBe(true);
      if (isLSTMParams(m.architectureParams!)) {
        expect(m.architectureParams.sequenceLength).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.min);
        expect(m.architectureParams.sequenceLength).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.max);
        expect(Number.isInteger(m.architectureParams.sequenceLength)).toBe(true);
        expect(m.architectureParams.hiddenUnits).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.min);
        expect(m.architectureParams.hiddenUnits).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.max);
        expect(m.architectureParams.dropout).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.dropout.min);
        expect(m.architectureParams.dropout).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.dropout.max);
      }
    }
  });

  it('GAN: mutated params stay within bounds (100 runs)', () => {
    const base = { ...createDefaultGenome(), modelArchitecture: 'GAN' as const, architectureParams: createDefaultGANParams() };
    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(base, 'HEAVY');
      expect(isGANParams(m.architectureParams!)).toBe(true);
      if (isGANParams(m.architectureParams!)) {
        expect(m.architectureParams.adversarialPressure).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.min);
        expect(m.architectureParams.adversarialPressure).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.max);
        expect(m.architectureParams.discriminatorWeight).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.min);
        expect(m.architectureParams.discriminatorWeight).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.max);
        expect(m.architectureParams.generatorLR).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.min);
        expect(m.architectureParams.generatorLR).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.max);
      }
    }
  });

  it('TRANSFORMER: attentionHeads stays in valid set (100 runs)', () => {
    const base = { ...createDefaultGenome(), modelArchitecture: 'TRANSFORMER' as const, architectureParams: createDefaultTransformerParams() };
    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(base, 'HEAVY');
      expect(isTransformerParams(m.architectureParams!)).toBe(true);
      if (isTransformerParams(m.architectureParams!)) {
        expect(VALID_ATTENTION_HEADS).toContain(m.architectureParams.attentionHeads as typeof VALID_ATTENTION_HEADS[number]);
        expect(m.architectureParams.embeddingDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.min);
        expect(m.architectureParams.embeddingDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.max);
        expect(m.architectureParams.feedforwardDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.min);
        expect(m.architectureParams.feedforwardDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.max);
      }
    }
  });

  it('HYBRID uses LSTM param mutation', () => {
    const base = { ...createDefaultGenome(), modelArchitecture: 'HYBRID' as const, architectureParams: createDefaultLSTMParams() };
    const { genome: m } = engine.mutate(base, 'MEDIUM');
    expect(m.modelArchitecture).toBe('HYBRID');
    expect(isLSTMParams(m.architectureParams!)).toBe(true);
  });

  it('genome without architecture is unaffected (no architectureParams set)', () => {
    const base = createDefaultGenome();
    const { genome: m } = engine.mutate(base, 'HEAVY');
    expect(m.modelArchitecture).toBeUndefined();
    expect(m.architectureParams).toBeUndefined();
  });

  it('does not mutate the original architecture params', () => {
    const origParams = createDefaultLSTMParams();
    const base = { ...createDefaultGenome(), modelArchitecture: 'LSTM' as const, architectureParams: origParams };
    const origCopy = { ...origParams };
    engine.mutate(base, 'HEAVY');
    expect(origParams).toEqual(origCopy);
  });

  it('TRANSFORMER: attentionHeads only mutates for MEDIUM severity or higher', () => {
    const base = { ...createDefaultGenome(), modelArchitecture: 'TRANSFORMER' as const, architectureParams: { ...createDefaultTransformerParams(), attentionHeads: 4 } };
    let anyChange = false;
    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(base, 'LIGHT');
      if (isTransformerParams(m.architectureParams!) && m.architectureParams.attentionHeads !== 4) {
        anyChange = true;
        break;
      }
    }
    // LIGHT has numGenes=2 so headDelta is always 0 — attentionHeads should never change
    expect(anyChange).toBe(false);
  });
});

describe('MutationEngine — mutate() with extreme genomes', () => {
  const engine = new MutationEngine();

  it('handles a genome at minimum bounds without going below', () => {
    const minGenome: Record<string, number> = {};
    for (const key of NUMERIC_GENES) {
      minGenome[key] = GENE_BOUNDS[key].min;
    }

    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(minGenome as unknown as AgentGenome, 'HEAVY');
      for (const key of NUMERIC_GENES) {
        expect(m[key] as number).toBeGreaterThanOrEqual(GENE_BOUNDS[key].min);
      }
    }
  });

  it('handles a genome at maximum bounds without exceeding', () => {
    const maxGenome: Record<string, number> = {};
    for (const key of NUMERIC_GENES) {
      maxGenome[key] = GENE_BOUNDS[key].max;
    }

    for (let i = 0; i < 100; i++) {
      const { genome: m } = engine.mutate(maxGenome as unknown as AgentGenome, 'HEAVY');
      for (const key of NUMERIC_GENES) {
        expect(m[key] as number).toBeLessThanOrEqual(GENE_BOUNDS[key].max);
      }
    }
  });
});

describe('MutationEngine — persistMutations + mutateAndSave', () => {
  let db:  Database.Database;
  let mgr: GenomeManager;

  beforeEach(() => {
    db  = makeDb();
    mgr = new GenomeManager(db);
  });

  afterEach(() => { db.close(); });

  it('mutateAndSave updates the stored genome', () => {
    const engine = new MutationEngine(db);
    const agentId = mgr.registerNewAgent();

    const original = mgr.loadGenome(agentId)!;

    // Run mutateAndSave many times until at least one gene changes
    let changed = false;
    for (let i = 0; i < 50 && !changed; i++) {
      engine.mutateAndSave(agentId, 'HEAVY');
      const updated = mgr.loadGenome(agentId)!;
      if (NUMERIC_GENES.some(k => updated[k] !== original[k])) {
        changed = true;
      }
    }
    expect(changed).toBe(true);
  });

  it('persistMutations writes to agent_genealogy', () => {
    const engine = new MutationEngine(db);
    const agentId = mgr.registerNewAgent();

    // Insert a genealogy row first (simulate having been bred)
    db.prepare(`
      INSERT INTO agent_genealogy (id, agent_id) VALUES ('gx-1', ?)
    `).run(agentId);

    const base = createDefaultGenome();
    const result = engine.mutate(base, 'MEDIUM');
    if (result.mutations.length > 0) {
      engine.persistMutations(agentId, result);

      const row = db.prepare(
        'SELECT mutations_applied, mutation_severity FROM agent_genealogy WHERE agent_id = ?'
      ).get(agentId) as { mutations_applied: string; mutation_severity: number };

      expect(row.mutation_severity).toBeGreaterThanOrEqual(0);
      const parsed = JSON.parse(row.mutations_applied) as { param: string }[];
      expect(Array.isArray(parsed)).toBe(true);
    }
  });

  it('mutateAndSave throws for unknown agent', () => {
    const engine = new MutationEngine(db);
    expect(() => engine.mutateAndSave('ghost-agent')).toThrow();
  });
});
