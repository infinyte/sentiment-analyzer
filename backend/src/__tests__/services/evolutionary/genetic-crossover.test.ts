/**
 * GeneticCrossover unit tests (Phase 2.3)
 */

import Database from 'better-sqlite3';
import { GeneticCrossover } from '../../../services/evolutionary/genetic-crossover.js';
import { GenomeManager, createDefaultGenome, GENE_BOUNDS, NUMERIC_GENES, type AgentGenome } from '../../../services/evolutionary/agent-genome.js';

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
