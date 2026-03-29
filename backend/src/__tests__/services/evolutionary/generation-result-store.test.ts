import Database from 'better-sqlite3';
import { GenerationResultStore } from '../../../services/evolutionary/generation-result-store.js';
import type { AgentGenome } from '../../../services/evolutionary/agent-genome.js';

// ── In-memory DB setup ────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS generation_checkpoints (
      id              TEXT PRIMARY KEY,
      tournament_id   TEXT NOT NULL,
      generation      INTEGER NOT NULL,
      population_json TEXT NOT NULL,
      directive_json  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (tournament_id, generation)
    );

    CREATE TABLE IF NOT EXISTS agent_lineage_extended (
      id               TEXT PRIMARY KEY,
      agent_id         TEXT NOT NULL,
      parent_ids       TEXT NOT NULL,
      generation       INTEGER NOT NULL,
      architecture     TEXT NOT NULL,
      fitness_at_birth REAL NOT NULL DEFAULT 0,
      tournament_id    TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (agent_id)
    );
  `);

  return db;
}

function makeGenome(): AgentGenome {
  return {
    epsilon: 0.1,
    learningRate: 0.01,
    gamma: 0.99,
    explorationDecayRate: 0.999,
    entryThreshold: 55,
    exitThreshold: 40,
    stopLossPct: 5,
    takeProfitPct: 10,
    positionSizePct: 15,
    riskPercent: 2,
    holdDurationMax: 5,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GenerationResultStore', () => {
  let db: Database.Database;
  let store: GenerationResultStore;

  beforeEach(() => {
    db    = makeDb();
    store = new GenerationResultStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── saveCheckpoint / loadCheckpoint ───────────────────────────────────────

  it('saves and loads a checkpoint without directive', () => {
    const pop = ['agent-1', 'agent-2', 'agent-3'];
    store.saveCheckpoint('t1', 1, pop);

    const cp = store.loadCheckpoint('t1', 1);
    expect(cp).toBeDefined();
    expect(cp!.tournamentId).toBe('t1');
    expect(cp!.generation).toBe(1);
    expect(cp!.population).toEqual(pop);
    expect(cp!.directive).toBeUndefined();
    expect(cp!.id).toBeTruthy();
    expect(cp!.createdAt).toBeTruthy();
  });

  it('saves and loads a checkpoint with directive', () => {
    const directive = {
      generation: 2,
      mutationSeverity: 'HEAVY' as const,
      survivalPercent: 25,
      crossoverStrategy: 'BLENDED' as const,
      diversityBoost: true,
      reasoning: 'Population stagnating.',
    };
    store.saveCheckpoint('t1', 2, ['a1', 'a2'], directive);

    const cp = store.loadCheckpoint('t1', 2);
    expect(cp!.directive).toMatchObject({
      mutationSeverity: 'HEAVY',
      survivalPercent: 25,
      crossoverStrategy: 'BLENDED',
      diversityBoost: true,
    });
  });

  it('returns undefined for a non-existent checkpoint', () => {
    const cp = store.loadCheckpoint('t_missing', 99);
    expect(cp).toBeUndefined();
  });

  it('overwrites an existing checkpoint for the same tournament+generation', () => {
    store.saveCheckpoint('t1', 1, ['old-a', 'old-b']);
    store.saveCheckpoint('t1', 1, ['new-a', 'new-b', 'new-c']);

    const cp = store.loadCheckpoint('t1', 1);
    expect(cp!.population).toEqual(['new-a', 'new-b', 'new-c']);
  });

  // ── listCheckpoints ───────────────────────────────────────────────────────

  it('lists all checkpoints for a tournament ordered by generation', () => {
    store.saveCheckpoint('t1', 3, ['a', 'b']);
    store.saveCheckpoint('t1', 1, ['c', 'd']);
    store.saveCheckpoint('t1', 2, ['e', 'f']);
    store.saveCheckpoint('t2', 1, ['x', 'y']);  // different tournament — excluded

    const checkpoints = store.listCheckpoints('t1');
    expect(checkpoints).toHaveLength(3);
    expect(checkpoints.map(c => c.generation)).toEqual([1, 2, 3]);
  });

  it('returns empty array when no checkpoints exist for a tournament', () => {
    expect(store.listCheckpoints('non-existent')).toEqual([]);
  });

  // ── saveLineageEntry / getLineage ─────────────────────────────────────────

  it('saves and retrieves a lineage entry', () => {
    const genome = makeGenome();
    store.saveLineageEntry({
      agentId:        'agent-alpha',
      parentIds:      ['parent-1', 'parent-2'],
      generation:     2,
      architecture:   genome,
      fitnessAtBirth: 0,
      tournamentId:   't1',
    });

    const lineage = store.getLineage('agent-alpha');
    expect(lineage).toHaveLength(1);
    expect(lineage[0]!.agentId).toBe('agent-alpha');
    expect(lineage[0]!.parentIds).toEqual(['parent-1', 'parent-2']);
    expect(lineage[0]!.generation).toBe(2);
    expect(lineage[0]!.architecture).toMatchObject({ epsilon: 0.1 });
    expect(lineage[0]!.fitnessAtBirth).toBe(0);
    expect(lineage[0]!.tournamentId).toBe('t1');
  });

  it('saves a genesis agent with empty parentIds', () => {
    store.saveLineageEntry({
      agentId:        'genesis-agent',
      parentIds:      [],
      generation:     0,
      architecture:   makeGenome(),
      fitnessAtBirth: 0,
      tournamentId:   't1',
    });

    const lineage = store.getLineage('genesis-agent');
    expect(lineage[0]!.parentIds).toEqual([]);
  });

  it('upserts when same agentId is saved twice', () => {
    store.saveLineageEntry({
      agentId: 'a1', parentIds: [], generation: 0,
      architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't1',
    });
    store.saveLineageEntry({
      agentId: 'a1', parentIds: ['p1'], generation: 1,
      architecture: makeGenome(), fitnessAtBirth: 30, tournamentId: 't1',
    });

    const lineage = store.getLineage('a1');
    expect(lineage).toHaveLength(1);
    expect(lineage[0]!.generation).toBe(1);
  });

  it('returns empty array for unknown agentId', () => {
    expect(store.getLineage('no-such-agent')).toEqual([]);
  });

  // ── getLineageForTournament ───────────────────────────────────────────────

  it('returns all lineage entries for a tournament ordered by generation', () => {
    store.saveLineageEntry({ agentId: 'a3', parentIds: ['a1', 'a2'], generation: 2, architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't1' });
    store.saveLineageEntry({ agentId: 'a1', parentIds: [], generation: 0, architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't1' });
    store.saveLineageEntry({ agentId: 'a2', parentIds: [], generation: 0, architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't1' });
    store.saveLineageEntry({ agentId: 'b1', parentIds: [], generation: 0, architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't2' }); // different tournament

    const entries = store.getLineageForTournament('t1');
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.generation)).toEqual([0, 0, 2]);
  });

  it('returns empty array for unknown tournament', () => {
    expect(store.getLineageForTournament('no-such')).toEqual([]);
  });

  // ── updateFitnessAtBirth ──────────────────────────────────────────────────

  it('updates fitnessAtBirth for an existing lineage entry', () => {
    store.saveLineageEntry({
      agentId: 'a1', parentIds: [], generation: 0,
      architecture: makeGenome(), fitnessAtBirth: 0, tournamentId: 't1',
    });

    store.updateFitnessAtBirth('a1', 65.5);

    const lineage = store.getLineage('a1');
    expect(lineage[0]!.fitnessAtBirth).toBe(65.5);
  });

  it('updateFitnessAtBirth is a no-op for unknown agentId', () => {
    expect(() => store.updateFitnessAtBirth('ghost', 50)).not.toThrow();
  });

  // ── saveCheckpoint return value ───────────────────────────────────────────

  it('saveCheckpoint returns the persisted checkpoint', () => {
    const result = store.saveCheckpoint('t99', 5, ['x', 'y']);
    expect(result.tournamentId).toBe('t99');
    expect(result.generation).toBe(5);
    expect(result.population).toEqual(['x', 'y']);
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeTruthy();
  });
});
