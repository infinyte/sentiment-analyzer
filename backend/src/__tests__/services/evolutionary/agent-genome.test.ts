/**
 * AgentGenome & GenomeManager unit tests (Phase 2.2)
 *
 * Uses an in-memory SQLite DB with the minimal schema required.
 */

import Database from 'better-sqlite3';
import {
  GenomeManager,
  createDefaultGenome,
  createRandomGenome,
  GENE_BOUNDS,
  NUMERIC_GENES,
} from '../../../services/evolutionary/agent-genome.js';

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
  `);
  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentGenome — createDefaultGenome', () => {
  it('returns a genome with all numeric genes', () => {
    const g = createDefaultGenome();
    for (const key of NUMERIC_GENES) {
      expect(typeof g[key]).toBe('number');
    }
  });

  it('all genes are within their bounds', () => {
    const g = createDefaultGenome();
    for (const key of NUMERIC_GENES) {
      const { min, max } = GENE_BOUNDS[key];
      expect(g[key] as number).toBeGreaterThanOrEqual(min);
      expect(g[key] as number).toBeLessThanOrEqual(max);
    }
  });
});

describe('AgentGenome — createRandomGenome', () => {
  it('generates genes within bounds for 100 samples', () => {
    for (let i = 0; i < 100; i++) {
      const g = createRandomGenome();
      for (const key of NUMERIC_GENES) {
        const { min, max } = GENE_BOUNDS[key];
        expect(g[key] as number).toBeGreaterThanOrEqual(min);
        expect(g[key] as number).toBeLessThanOrEqual(max);
      }
    }
  });

  it('integer gene holdDurationMax is always an integer', () => {
    for (let i = 0; i < 50; i++) {
      const g = createRandomGenome();
      expect(Number.isInteger(g.holdDurationMax)).toBe(true);
    }
  });
});

describe('GenomeManager', () => {
  let db:  Database.Database;
  let mgr: GenomeManager;

  beforeEach(() => {
    db  = makeDb();
    mgr = new GenomeManager(db);
  });

  afterEach(() => { db.close(); });

  // ── saveGenome / loadGenome ───────────────────────────────────────────────

  it('saves and loads a genome round-trip', () => {
    const agentId = 'agent-001';
    db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(agentId);

    const genome = createDefaultGenome();
    mgr.saveGenome(agentId, genome);

    const loaded = mgr.loadGenome(agentId);
    expect(loaded).not.toBeNull();
    expect(loaded!.epsilon).toBeCloseTo(genome.epsilon, 6);
    expect(loaded!.holdDurationMax).toBe(genome.holdDurationMax);
  });

  it('loadGenome returns null for unknown agent', () => {
    expect(mgr.loadGenome('nonexistent')).toBeNull();
  });

  it('saveGenome is idempotent (upserts)', () => {
    const agentId = 'agent-002';
    db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(agentId);

    const g1 = createDefaultGenome();
    mgr.saveGenome(agentId, g1);

    const g2 = { ...g1, epsilon: 0.42 };
    mgr.saveGenome(agentId, g2);

    const loaded = mgr.loadGenome(agentId);
    expect(loaded!.epsilon).toBeCloseTo(0.42, 6);
  });

  // ── deleteGenome ─────────────────────────────────────────────────────────

  it('deleteGenome removes the row', () => {
    const agentId = 'agent-003';
    db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(agentId);
    mgr.saveGenome(agentId, createDefaultGenome());
    mgr.deleteGenome(agentId);
    expect(mgr.loadGenome(agentId)).toBeNull();
  });

  // ── getGene / setGene ────────────────────────────────────────────────────

  it('getGene returns the correct value', () => {
    const g = createDefaultGenome();
    expect(mgr.getGene(g, 'epsilon')).toBeCloseTo(0.10, 6);
    expect(mgr.getGene(g, 'holdDurationMax')).toBe(5);
  });

  it('setGene returns updated genome without mutating original', () => {
    const g = createDefaultGenome();
    const updated = mgr.setGene(g, 'epsilon', 0.30);
    expect(updated.epsilon).toBeCloseTo(0.30, 6);
    expect(g.epsilon).toBeCloseTo(0.10, 6); // original unchanged
  });

  it('setGene clamps to bounds', () => {
    const g = createDefaultGenome();
    const clamped = mgr.setGene(g, 'epsilon', 999);
    expect(clamped.epsilon).toBe(GENE_BOUNDS.epsilon.max);

    const clamped2 = mgr.setGene(g, 'epsilon', -999);
    expect(clamped2.epsilon).toBe(GENE_BOUNDS.epsilon.min);
  });

  it('setGene rounds integer genes', () => {
    const g = createDefaultGenome();
    const updated = mgr.setGene(g, 'holdDurationMax', 3.7);
    expect(updated.holdDurationMax).toBe(4);
    expect(Number.isInteger(updated.holdDurationMax)).toBe(true);
  });

  // ── clone ────────────────────────────────────────────────────────────────

  it('clone produces an independent deep copy', () => {
    const g = createDefaultGenome();
    const copy = mgr.clone(g);

    copy.epsilon = 0.99;
    expect(g.epsilon).toBeCloseTo(0.10, 6); // original unchanged

    // Verify equality of other fields
    expect(copy.learningRate).toBeCloseTo(g.learningRate, 6);
  });

  // ── toJSON / fromJSON ────────────────────────────────────────────────────

  it('round-trips through JSON', () => {
    const g = createDefaultGenome();
    const json = mgr.toJSON(g);
    const parsed = mgr.fromJSON(json);
    expect(parsed.epsilon).toBeCloseTo(g.epsilon, 6);
    expect(parsed.holdDurationMax).toBe(g.holdDurationMax);
  });

  // ── registerNewAgent ─────────────────────────────────────────────────────

  it('registerNewAgent creates registry row + genome', () => {
    const id = mgr.registerNewAgent({ agentType: 'ML_BASED', riskProfile: 'AGGRESSIVE' });

    const row = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id) as { agent_type: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.agent_type).toBe('ML_BASED');

    const genome = mgr.loadGenome(id);
    expect(genome).not.toBeNull();
  });

  it('registerNewAgent records parent IDs and generation', () => {
    const p1 = mgr.registerNewAgent();
    const p2 = mgr.registerNewAgent();
    const child = mgr.registerNewAgent({ parentId1: p1, parentId2: p2, generationNumber: 1 });

    const row = db.prepare('SELECT parent_id_1, parent_id_2, generation_number FROM agent_registry WHERE id = ?')
      .get(child) as { parent_id_1: string; parent_id_2: string; generation_number: number };

    expect(row.parent_id_1).toBe(p1);
    expect(row.parent_id_2).toBe(p2);
    expect(row.generation_number).toBe(1);
  });
});
