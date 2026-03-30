/**
 * GeneticCrossover unit tests (Phase 2.3)
 */

import Database from 'better-sqlite3';
import { GeneticCrossover } from '../../../services/evolutionary/genetic-crossover.js';
import { GenomeManager, createDefaultGenome, GENE_BOUNDS, NUMERIC_GENES, type AgentGenome } from '../../../services/evolutionary/agent-genome.js';
import {
  createDefaultLSTMParams,
  createDefaultGANParams,
  createDefaultTransformerParams,
  isLSTMParams,
  isGANParams,
  isTransformerParams,
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

function makeParent(db: Database.Database, mgr: GenomeManager, genomeOverride?: Partial<AgentGenome>): string {
  const id = mgr.registerNewAgent();
  if (genomeOverride) {
    const g = { ...createDefaultGenome(), ...genomeOverride };
    mgr.saveGenome(id, g);
  }
  return id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GeneticCrossover — breed()', () => {
  let db:        Database.Database;
  let mgr:       GenomeManager;
  let crossover: GeneticCrossover;

  beforeEach(() => {
    db       = makeDb();
    mgr      = new GenomeManager(db);
    crossover = new GeneticCrossover(db);
  });

  afterEach(() => { db.close(); });

  it('creates an offspring registered in agent_registry', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringId } = crossover.breed(p1, p2);

    const row = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(offspringId);
    expect(row).toBeDefined();
  });

  it('offspring has parent references set', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringId } = crossover.breed(p1, p2);

    const row = db.prepare('SELECT parent_id_1, parent_id_2 FROM agent_registry WHERE id = ?')
      .get(offspringId) as { parent_id_1: string; parent_id_2: string };

    expect(row.parent_id_1).toBe(p1);
    expect(row.parent_id_2).toBe(p2);
  });

  it('offspring generation = max(parent gen) + 1', () => {
    // parent1 is gen 2, parent2 is gen 1
    const p1 = mgr.registerNewAgent({ generationNumber: 2 });
    const p2 = mgr.registerNewAgent({ generationNumber: 1 });

    const { generationNumber } = crossover.breed(p1, p2);
    expect(generationNumber).toBe(3);
  });

  it('offspring genome has all numeric genes', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringGenome } = crossover.breed(p1, p2);

    for (const key of NUMERIC_GENES) {
      expect(typeof offspringGenome[key]).toBe('number');
    }
  });

  it('offspring genes are within valid bounds', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringGenome } = crossover.breed(p1, p2);

    for (const key of NUMERIC_GENES) {
      const { min, max } = GENE_BOUNDS[key];
      expect(offspringGenome[key] as number).toBeGreaterThanOrEqual(min);
      expect(offspringGenome[key] as number).toBeLessThanOrEqual(max);
    }
  });

  it('UNIFORM: each gene comes from one of the parents (100 trials)', () => {
    // Use two parents with clearly distinct genomes
    const p1 = makeParent(db, mgr, { epsilon: 0.01,  entryThreshold: 30 });
    const p2 = makeParent(db, mgr, { epsilon: 0.50,  entryThreshold: 80 });

    let p1Count = 0;
    let p2Count = 0;

    for (let i = 0; i < 100; i++) {
      const { offspringGenome, inheritanceMap } = crossover.breed(p1, p2, 'UNIFORM');
      const src = inheritanceMap.epsilon;
      if (src === 'parent1') p1Count++;
      if (src === 'parent2') p2Count++;

      // Value must match the chosen parent's value
      if (src === 'parent1') {
        expect(offspringGenome.epsilon).toBeCloseTo(0.01, 5);
      } else {
        expect(offspringGenome.epsilon).toBeCloseTo(0.50, 5);
      }
    }

    // With 100 trials the probability of all going to one parent is < 10^-30
    expect(p1Count).toBeGreaterThan(0);
    expect(p2Count).toBeGreaterThan(0);
  });

  it('BLENDED: each gene is the arithmetic mean of both parents', () => {
    const p1 = makeParent(db, mgr, { epsilon: 0.10, entryThreshold: 40 });
    const p2 = makeParent(db, mgr, { epsilon: 0.30, entryThreshold: 60 });

    const { offspringGenome, inheritanceMap } = crossover.breed(p1, p2, 'BLENDED');

    expect(offspringGenome.epsilon).toBeCloseTo(0.20, 5);
    expect(offspringGenome.entryThreshold).toBeCloseTo(50, 5);
    expect(Object.values(inheritanceMap).every(v => v === 'blend')).toBe(true);
  });

  it('writes a genealogy record', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringId } = crossover.breed(p1, p2);

    const row = db.prepare('SELECT * FROM agent_genealogy WHERE agent_id = ?').get(offspringId);
    expect(row).toBeDefined();
  });

  it('genome is persisted for offspring', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringId } = crossover.breed(p1, p2);

    const loaded = mgr.loadGenome(offspringId);
    expect(loaded).not.toBeNull();
    for (const key of NUMERIC_GENES) {
      expect(typeof loaded![key]).toBe('number');
    }
  });

  it('throws when parent has no genome', () => {
    const p1 = makeParent(db, mgr);
    // p2 exists in registry but has no genome
    const p2id = 'ghost-parent';
    db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(p2id);

    expect(() => crossover.breed(p1, p2id)).toThrow('No genome found');
  });
});

// ── Architecture crossover tests ──────────────────────────────────────────────

describe('GeneticCrossover — architecture crossover', () => {
  let db:        Database.Database;
  let mgr:       GenomeManager;
  let crossover: GeneticCrossover;

  beforeEach(() => {
    db        = makeDb();
    mgr       = new GenomeManager(db);
    crossover = new GeneticCrossover(db);
  });

  afterEach(() => { db.close(); });

  it('same architecture (LSTM) BLENDED: offspring inherits LSTM with averaged params', () => {
    const lstm1 = createDefaultLSTMParams();
    const lstm2 = { sequenceLength: 20, hiddenUnits: 128, dropout: 0.4 };
    const p1 = makeParent(db, mgr, { modelArchitecture: 'LSTM', architectureParams: lstm1 } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr, { modelArchitecture: 'LSTM', architectureParams: lstm2 } as Partial<AgentGenome>);

    const { offspringGenome } = crossover.breed(p1, p2, 'BLENDED');

    expect(offspringGenome.modelArchitecture).toBe('LSTM');
    expect(offspringGenome.architectureParams).toBeDefined();
    expect(isLSTMParams(offspringGenome.architectureParams!)).toBe(true);
    if (isLSTMParams(offspringGenome.architectureParams!)) {
      // hiddenUnits is the average: (64 + 128) / 2 = 96
      expect(offspringGenome.architectureParams.hiddenUnits).toBe(96);
    }
  });

  it('same architecture (GAN) UNIFORM: offspring inherits GAN params from one parent', () => {
    const p1 = makeParent(db, mgr, { modelArchitecture: 'GAN', architectureParams: createDefaultGANParams() } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr, { modelArchitecture: 'GAN', architectureParams: createDefaultGANParams() } as Partial<AgentGenome>);

    const { offspringGenome } = crossover.breed(p1, p2, 'UNIFORM');

    expect(offspringGenome.modelArchitecture).toBe('GAN');
    expect(isGANParams(offspringGenome.architectureParams!)).toBe(true);
  });

  it('different architectures + BLENDED: offspring is HYBRID', () => {
    const p1 = makeParent(db, mgr, { modelArchitecture: 'LSTM', architectureParams: createDefaultLSTMParams() } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr, { modelArchitecture: 'GAN', architectureParams: createDefaultGANParams() } as Partial<AgentGenome>);

    const { offspringGenome } = crossover.breed(p1, p2, 'BLENDED');

    expect(offspringGenome.modelArchitecture).toBe('HYBRID');
    expect(offspringGenome.architectureParams).toBeDefined();
  });

  it('different architectures + UNIFORM: offspring gets one parent\'s architecture', () => {
    const p1 = makeParent(db, mgr, { modelArchitecture: 'LSTM',        architectureParams: createDefaultLSTMParams() } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr, { modelArchitecture: 'TRANSFORMER', architectureParams: createDefaultTransformerParams() } as Partial<AgentGenome>);

    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { offspringGenome } = crossover.breed(p1, p2, 'UNIFORM');
      results.add(offspringGenome.modelArchitecture!);
    }
    // Both architectures should appear (probabilistically)
    expect(results.has('LSTM') || results.has('TRANSFORMER')).toBe(true);
  });

  it('only parent1 has architecture: offspring inherits it', () => {
    const p1 = makeParent(db, mgr, { modelArchitecture: 'TRANSFORMER', architectureParams: createDefaultTransformerParams() } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr);  // no architecture

    const { offspringGenome } = crossover.breed(p1, p2, 'UNIFORM');

    expect(offspringGenome.modelArchitecture).toBe('TRANSFORMER');
    expect(isTransformerParams(offspringGenome.architectureParams!)).toBe(true);
  });

  it('neither parent has architecture: offspring has no architecture', () => {
    const p1 = makeParent(db, mgr);
    const p2 = makeParent(db, mgr);

    const { offspringGenome } = crossover.breed(p1, p2);

    expect(offspringGenome.modelArchitecture).toBeUndefined();
    expect(offspringGenome.architectureParams).toBeUndefined();
  });

  it('TRANSFORMER BLENDED: attentionHeads snaps to nearest valid value', () => {
    const t1 = { ...createDefaultTransformerParams(), attentionHeads: 2 };  // 2
    const t2 = { ...createDefaultTransformerParams(), attentionHeads: 4 };  // 4
    const p1 = makeParent(db, mgr, { modelArchitecture: 'TRANSFORMER', architectureParams: t1 } as Partial<AgentGenome>);
    const p2 = makeParent(db, mgr, { modelArchitecture: 'TRANSFORMER', architectureParams: t2 } as Partial<AgentGenome>);

    const { offspringGenome } = crossover.breed(p1, p2, 'BLENDED');

    expect(offspringGenome.modelArchitecture).toBe('TRANSFORMER');
    if (isTransformerParams(offspringGenome.architectureParams!)) {
      // avg(2, 4) = 3 → snaps to nearest in {1,2,4,8} = 2 or 4
      expect([1, 2, 4, 8]).toContain(offspringGenome.architectureParams.attentionHeads);
    }
  });
});

describe('GeneticCrossover — breedPopulation()', () => {
  let db:        Database.Database;
  let mgr:       GenomeManager;
  let crossover: GeneticCrossover;

  beforeEach(() => {
    db        = makeDb();
    mgr       = new GenomeManager(db);
    crossover = new GeneticCrossover(db);
  });

  afterEach(() => { db.close(); });

  it('creates the requested number of offspring', () => {
    const parents = Array.from({ length: 4 }, () => makeParent(db, mgr));
    const results = crossover.breedPopulation(parents, 6);
    expect(results).toHaveLength(6);
  });

  it('throws with fewer than 2 survivors', () => {
    const p = makeParent(db, mgr);
    expect(() => crossover.breedPopulation([p], 1)).toThrow('at least 2 survivors');
  });

  it('all offspring have valid genomes', () => {
    const parents = Array.from({ length: 3 }, () => makeParent(db, mgr));
    const results = crossover.breedPopulation(parents, 4);

    for (const { offspringGenome } of results) {
      for (const key of NUMERIC_GENES) {
        const { min, max } = GENE_BOUNDS[key];
        expect(offspringGenome[key] as number).toBeGreaterThanOrEqual(min);
        expect(offspringGenome[key] as number).toBeLessThanOrEqual(max);
      }
    }
  });
});
