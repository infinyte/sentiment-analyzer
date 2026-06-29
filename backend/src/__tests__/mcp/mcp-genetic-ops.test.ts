/**
 * MCP Genetic Ops — unit tests
 *
 * These tests verify the logic exercised by each tool handler by calling the
 * underlying services directly (same code paths invoked by the MCP tool
 * callbacks, without needing a running stdio transport).
 */

import Database from 'better-sqlite3';
import { MutationEngine } from '../../services/evolutionary/mutation-engine.js';
import { GeneticCrossover } from '../../services/evolutionary/genetic-crossover.js';
import { FitnessCalculator, type AgentStats } from '../../services/evolutionary/fitness-calculator.js';
import { SelectionAlgorithm } from '../../services/evolutionary/selection-algorithm.js';
import { GenomeManager, createDefaultGenome, NUMERIC_GENES } from '../../services/evolutionary/agent-genome.js';
import { GenerationResultStore } from '../../services/evolutionary/generation-result-store.js';

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
    CREATE TABLE agent_statistics (
      agent_id             TEXT PRIMARY KEY REFERENCES agent_registry(id),
      total_competitions   INTEGER NOT NULL DEFAULT 0,
      total_wins           INTEGER NOT NULL DEFAULT 0,
      total_losses         INTEGER NOT NULL DEFAULT 0,
      win_rate_percent     REAL    NOT NULL DEFAULT 0,
      total_pnl            REAL    NOT NULL DEFAULT 0,
      max_drawdown_percent REAL    NOT NULL DEFAULT 0,
      sharpe_ratio         REAL    NOT NULL DEFAULT 0,
      roi_percent          REAL    NOT NULL DEFAULT 0,
      trades_executed      INTEGER NOT NULL DEFAULT 0,
      consistency_score    REAL    NOT NULL DEFAULT 0,
      avg_trade_profit     REAL    NOT NULL DEFAULT 0,
      last_updated         TEXT    NOT NULL DEFAULT (datetime('now'))
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
    CREATE TABLE generation_checkpoints (
      id              TEXT PRIMARY KEY,
      tournament_id   TEXT NOT NULL,
      generation      INTEGER NOT NULL,
      population_json TEXT NOT NULL,
      directive_json  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tournament_id, generation)
    );
  `);
  return db;
}

// ── mutate_agent logic ────────────────────────────────────────────────────────

describe('mutate_agent tool logic', () => {
  let db:     Database.Database;
  let mgr:    GenomeManager;
  let engine: MutationEngine;

  beforeEach(() => {
    db     = makeDb();
    mgr    = new GenomeManager(db);
    engine = new MutationEngine(db);
  });

  afterEach(() => db.close());

  it('mutateAndSave returns a valid MutationResult', () => {
    const agentId = mgr.registerNewAgent();
    const result  = engine.mutateAndSave(agentId, 'MEDIUM');

    expect(result.severityLabel).toBe('MEDIUM');
    expect(result.mutationSeverity).toBeGreaterThanOrEqual(0);
    expect(result.mutationSeverity).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.mutations)).toBe(true);
    for (const key of NUMERIC_GENES) {
      expect(typeof result.genome[key]).toBe('number');
    }
  });

  it('throws for unknown agentId', () => {
    expect(() => engine.mutateAndSave('no-such-agent', 'LIGHT')).toThrow();
  });
});

// ── crossover_agents logic ────────────────────────────────────────────────────

describe('crossover_agents tool logic', () => {
  let db:       Database.Database;
  let mgr:      GenomeManager;
  let crossover: GeneticCrossover;

  beforeEach(() => {
    db        = makeDb();
    mgr       = new GenomeManager(db);
    crossover = new GeneticCrossover(db);
  });

  afterEach(() => db.close());

  it('breeds two parents and returns a persisted offspring', () => {
    const p1 = mgr.registerNewAgent();
    const p2 = mgr.registerNewAgent();

    const result = crossover.breed(p1, p2, 'UNIFORM');

    expect(typeof result.offspringId).toBe('string');
    expect(result.generationNumber).toBe(1);
    const genome = mgr.loadGenome(result.offspringId);
    expect(genome).not.toBeNull();
    for (const key of NUMERIC_GENES) {
      expect(typeof genome![key]).toBe('number');
    }
  });

  it('BLENDED: offspring genes are averages of parents', () => {
    const g1 = { ...createDefaultGenome(), epsilon: 0.10 };
    const g2 = { ...createDefaultGenome(), epsilon: 0.30 };
    const p1 = mgr.registerNewAgent({ genome: g1 });
    const p2 = mgr.registerNewAgent({ genome: g2 });

    const { offspringGenome } = crossover.breed(p1, p2, 'BLENDED');
    expect(offspringGenome.epsilon).toBeCloseTo(0.20, 5);
  });
});

// ── evaluate_fitness logic ────────────────────────────────────────────────────

describe('evaluate_fitness tool logic', () => {
  const calc = new FitnessCalculator();

  it('returns a score in [0, 100]', () => {
    const agent: AgentStats = { agentId: 'a', winRatePct: 60, sharpeRatio: 2, totalPnl: 500, totalCompetitions: 5 };
    const score = calc.calculateFitness(agent, [agent]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('rankAgents returns agents sorted highest fitness first', () => {
    const low  = { agentId: 'low',  winRatePct: 10, sharpeRatio: -1, totalPnl: 100, totalCompetitions: 1 };
    const high = { agentId: 'high', winRatePct: 90, sharpeRatio:  4, totalPnl: 900, totalCompetitions: 10 };
    const ranked = calc.rankAgents([low, high]);
    expect(ranked[0]!.agentId).toBe('high');
  });
});

// ── select_population logic ───────────────────────────────────────────────────

describe('select_population tool logic', () => {
  const calc = new FitnessCalculator();
  const algo = new SelectionAlgorithm(calc);

  it('partitions a population into survivors, middle, and retirement', () => {
    const stats: AgentStats[] = Array.from({ length: 10 }, (_, i) => ({
      agentId: `agent-${i}`,
      winRatePct: i * 10,
      sharpeRatio: i * 0.5,
      totalPnl: i * 100,
      totalCompetitions: 5,
    }));

    const result = algo.selectTopPercent(stats, 30);

    expect(result.survivors.length).toBeGreaterThanOrEqual(1);
    expect(result.survivors.length + result.middleTier.length + result.retirementCandidates.length).toBe(10);
    // Top agent should be in survivors
    const bestId = `agent-9`;
    expect(result.survivors.some(a => a.agentId === bestId)).toBe(true);
  });

  it('with a single agent returns 1 survivor and no retirees', () => {
    const one: AgentStats = { agentId: 'solo', winRatePct: 50, sharpeRatio: 1, totalPnl: 100, totalCompetitions: 1 };
    const result = algo.selectTopPercent([one], 30);
    expect(result.survivors).toHaveLength(1);
    expect(result.retirementCandidates).toHaveLength(0);
  });
});

// ── get_generation_summary logic ──────────────────────────────────────────────

describe('get_generation_summary tool logic', () => {
  let db:    Database.Database;
  let store: GenerationResultStore;

  beforeEach(() => {
    db    = makeDb();
    store = new GenerationResultStore(db);
  });

  afterEach(() => db.close());

  it('loads a saved checkpoint by tournament + generation', () => {
    store.saveCheckpoint('t1', 1, ['agent-1', 'agent-2']);
    const cp = store.loadCheckpoint('t1', 1);
    expect(cp).toBeDefined();
    expect(cp!.generation).toBe(1);
    expect(cp!.population).toEqual(['agent-1', 'agent-2']);
  });

  it('listCheckpoints returns all checkpoints ordered by generation', () => {
    store.saveCheckpoint('t2', 1, ['a']);
    store.saveCheckpoint('t2', 3, ['c']);
    store.saveCheckpoint('t2', 2, ['b']);
    const all = store.listCheckpoints('t2');
    expect(all.map(c => c.generation)).toEqual([1, 2, 3]);
  });

  it('returns undefined for non-existent checkpoint', () => {
    const cp = store.loadCheckpoint('no-such', 99);
    expect(cp).toBeUndefined();
  });

  it('latest checkpoint is the last in list', () => {
    store.saveCheckpoint('t3', 1, ['a']);
    store.saveCheckpoint('t3', 5, ['e']);
    const all = store.listCheckpoints('t3');
    const latest = all[all.length - 1];
    expect(latest!.generation).toBe(5);
  });
});
