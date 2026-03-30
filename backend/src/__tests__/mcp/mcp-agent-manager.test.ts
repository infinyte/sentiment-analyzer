/**
 * MCP Agent Manager — unit tests
 *
 * Tests the service-layer logic called by each mcp-agent-manager tool handler.
 */

import Database from 'better-sqlite3';
import { GenomeManager, createDefaultGenome } from '../../services/evolutionary/agent-genome.js';
import { AgentStatisticsManager } from '../../services/evolutionary/agent-statistics-manager.js';
import { FitnessCalculator } from '../../services/evolutionary/fitness-calculator.js';

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
      custom_name       TEXT,
      emoji             TEXT,
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
    CREATE TABLE agent_competitions (
      id               TEXT PRIMARY KEY,
      agent_id         TEXT NOT NULL REFERENCES agent_registry(id),
      competition_id   TEXT NOT NULL,
      rank_position    INTEGER NOT NULL,
      starting_capital REAL    NOT NULL,
      ending_capital   REAL    NOT NULL,
      pnl              REAL    NOT NULL DEFAULT 0,
      trades_count     INTEGER NOT NULL DEFAULT 0,
      win_trades       INTEGER NOT NULL DEFAULT 0,
      loss_trades      INTEGER NOT NULL DEFAULT 0,
      largest_win      REAL    NOT NULL DEFAULT 0,
      largest_loss     REAL    NOT NULL DEFAULT 0,
      sharpe_ratio     REAL    NOT NULL DEFAULT 0,
      completed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ── register_agent logic ──────────────────────────────────────────────────────

describe('register_agent tool logic', () => {
  let db:  Database.Database;
  let mgr: GenomeManager;

  beforeEach(() => {
    db  = makeDb();
    mgr = new GenomeManager(db);
  });

  afterEach(() => db.close());

  it('creates an agent with default genome', () => {
    const id = mgr.registerNewAgent();
    const genome = mgr.loadGenome(id);
    expect(genome).not.toBeNull();
    expect(typeof genome!.epsilon).toBe('number');
  });

  it('applies genome overrides', () => {
    const override = { ...createDefaultGenome(), epsilon: 0.42 };
    const id = mgr.registerNewAgent({ genome: override });
    const genome = mgr.loadGenome(id);
    expect(genome!.epsilon).toBeCloseTo(0.42, 5);
  });

  it('stores the specified risk profile', () => {
    const id = mgr.registerNewAgent({ riskProfile: 'AGGRESSIVE' });
    const row = db.prepare('SELECT risk_profile FROM agent_registry WHERE id = ?').get(id) as { risk_profile: string };
    expect(row.risk_profile).toBe('AGGRESSIVE');
  });

  it('links parent IDs in registry', () => {
    const p1 = mgr.registerNewAgent();
    const p2 = mgr.registerNewAgent();
    const child = mgr.registerNewAgent({ parentId1: p1, parentId2: p2, generationNumber: 1 });

    const row = db.prepare('SELECT parent_id_1, parent_id_2, generation_number FROM agent_registry WHERE id = ?').get(child) as {
      parent_id_1: string;
      parent_id_2: string;
      generation_number: number;
    };

    expect(row.parent_id_1).toBe(p1);
    expect(row.parent_id_2).toBe(p2);
    expect(row.generation_number).toBe(1);
  });
});

// ── get_agent_health logic ────────────────────────────────────────────────────

describe('get_agent_health tool logic', () => {
  let db:    Database.Database;
  let mgr:   GenomeManager;
  let stats: AgentStatisticsManager;

  beforeEach(() => {
    db    = makeDb();
    mgr   = new GenomeManager(db);
    stats = new AgentStatisticsManager(db);
  });

  afterEach(() => db.close());

  it('getStats returns zeroed stats for a new agent', () => {
    const id = mgr.registerNewAgent();
    stats.initializeStats(id);
    const s = stats.getStats(id);
    expect(s.total_competitions).toBe(0);
    expect(s.win_rate_percent).toBe(0);
    expect(s.total_pnl).toBe(0);
  });

  it('loadGenome returns the genome for a registered agent', () => {
    const id = mgr.registerNewAgent();
    const genome = mgr.loadGenome(id);
    expect(genome).not.toBeNull();
    expect(typeof genome!.learningRate).toBe('number');
  });

  it('fitness of a brand-new agent with zero stats is 12.5 (PnL percentile = 50 for single agent)', () => {
    const calc = new FitnessCalculator();
    const agentStat = { agentId: 'new', winRatePct: 0, sharpeRatio: -2, totalPnl: 0, totalCompetitions: 0 };
    const fitness = calc.calculateFitness(agentStat, [agentStat]);
    expect(fitness).toBeCloseTo(12.5, 1);
  });
});

// ── collect_results logic ─────────────────────────────────────────────────────

describe('collect_results tool logic', () => {
  let db:  Database.Database;
  let mgr: GenomeManager;

  beforeEach(() => {
    db  = makeDb();
    mgr = new GenomeManager(db);
  });

  afterEach(() => db.close());

  it('returns empty results for an agent with no competitions', () => {
    const id = mgr.registerNewAgent();
    const rows = db.prepare('SELECT * FROM agent_competitions WHERE agent_id = ?').all(id);
    expect(rows).toHaveLength(0);
  });

  it('returns competition records ordered most-recent-first', () => {
    const { randomUUID } = require('crypto');
    const id = mgr.registerNewAgent();

    // Insert two competition records
    for (let i = 0; i < 3; i++) {
      db.prepare(`
        INSERT INTO agent_competitions
          (id, agent_id, competition_id, rank_position, starting_capital, ending_capital,
           pnl, trades_count, win_trades, loss_trades, sharpe_ratio, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
      `).run(randomUUID(), id, `comp-${i}`, 1, 10000, 10500, 500, 10, 7, 3, 1.2, i);
    }

    const rows = db.prepare(`
      SELECT competition_id, completed_at FROM agent_competitions
      WHERE agent_id = ? ORDER BY completed_at DESC LIMIT 10
    `).all(id) as { competition_id: string; completed_at: string }[];

    expect(rows).toHaveLength(3);
    // Most recent first
    expect(rows[0]!.competition_id).toBe('comp-2');
  });
});

// ── get_pool_status logic ─────────────────────────────────────────────────────

describe('get_pool_status tool logic', () => {
  let db:  Database.Database;
  let mgr: GenomeManager;

  beforeEach(() => {
    db  = makeDb();
    mgr = new GenomeManager(db);
  });

  afterEach(() => db.close());

  it('lists all active agents', () => {
    mgr.registerNewAgent({ riskProfile: 'CONSERVATIVE' });
    mgr.registerNewAgent({ riskProfile: 'AGGRESSIVE' });
    mgr.registerNewAgent({ riskProfile: 'SCALPING' });

    const rows = db.prepare("SELECT id FROM agent_registry WHERE status = 'ACTIVE'").all();
    expect(rows).toHaveLength(3);
  });

  it('retired agents are excluded when status filter is ACTIVE', () => {
    const id1 = mgr.registerNewAgent();
    const id2 = mgr.registerNewAgent();
    db.prepare("UPDATE agent_registry SET status = 'RETIRED' WHERE id = ?").run(id1);

    const activeRows = db.prepare("SELECT id FROM agent_registry WHERE status = 'ACTIVE'").all() as { id: string }[];
    expect(activeRows.map(r => r.id)).not.toContain(id1);
    expect(activeRows.map(r => r.id)).toContain(id2);
  });

  it('agent type filter works correctly', () => {
    mgr.registerNewAgent({ agentType: 'ML_BASED' });
    mgr.registerNewAgent({ agentType: 'RULE_BASED' });
    mgr.registerNewAgent({ agentType: 'ML_BASED' });

    const mlRows = db.prepare("SELECT id FROM agent_registry WHERE agent_type = 'ML_BASED'").all();
    expect(mlRows).toHaveLength(2);

    const ruleRows = db.prepare("SELECT id FROM agent_registry WHERE agent_type = 'RULE_BASED'").all();
    expect(ruleRows).toHaveLength(1);
  });

  it('fitness scores are computed for all active agents', () => {
    const calc  = new FitnessCalculator();
    const stats = [
      { agentId: 'a1', winRatePct: 70, sharpeRatio: 2, totalPnl: 1000, totalCompetitions: 5 },
      { agentId: 'a2', winRatePct: 30, sharpeRatio: 0, totalPnl: -100, totalCompetitions: 5 },
    ];
    const ranked = calc.rankAgents(stats);
    expect(ranked[0]!.agentId).toBe('a1');
    expect(ranked[1]!.agentId).toBe('a2');
    expect(ranked[0]!.fitness).toBeGreaterThan(ranked[1]!.fitness);
  });
});
