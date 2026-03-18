/**
 * AgentStatisticsManager unit tests
 *
 * Uses an in-memory SQLite database with agent_registry + agent_statistics +
 * agent_competitions tables.
 */

import Database from 'better-sqlite3';
import { AgentStatisticsManager } from '../../../services/evolutionary/agent-statistics-manager.js';
import type { CompetitionResultInput } from '../../../services/evolutionary/agent-statistics-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      color             TEXT,
      biography         TEXT,
      personality_traits TEXT,
      nickname          TEXT,
      age_iterations    INTEGER NOT NULL DEFAULT 0,
      generation_number INTEGER NOT NULL DEFAULT 0,
      parent_id_1       TEXT,
      parent_id_2       TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
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

function insertAgent(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(id);
}

function makeResult(overrides: Partial<CompetitionResultInput> = {}): CompetitionResultInput {
  return {
    competitionId:      'comp-001',
    rank:               1,
    agentCount:         3,
    startingCapital:    10_000,
    endingCapital:      11_000,
    tradesExecuted:     20,
    winTrades:          14,
    lossTrades:         6,
    largestWin:         500,
    largestLoss:        200,
    sharpeRatio:        1.2,
    maxDrawdownPercent: 5,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentStatisticsManager', () => {
  let db:  Database.Database;
  let mgr: AgentStatisticsManager;
  const agentId = 'agent-stats-001';

  beforeEach(() => {
    db  = makeDb();
    mgr = new AgentStatisticsManager(db);
    insertAgent(db, agentId);
  });

  afterEach(() => {
    db.close();
  });

  // ── initializeStats ──────────────────────────────────────────────────────────

  it('initializeStats creates a zeroed stats row', () => {
    mgr.initializeStats(agentId);
    const s = mgr.getStats(agentId);
    expect(s.agent_id).toBe(agentId);
    expect(s.total_competitions).toBe(0);
    expect(s.total_wins).toBe(0);
    expect(s.win_rate_percent).toBe(0);
  });

  it('initializeStats is idempotent', () => {
    mgr.initializeStats(agentId);
    expect(() => mgr.initializeStats(agentId)).not.toThrow();
    expect(mgr.getStats(agentId).total_competitions).toBe(0);
  });

  // ── recordCompetitionResult ───────────────────────────────────────────────────

  it('records a win and increments total_wins', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1 }));
    const s = mgr.getStats(agentId);
    expect(s.total_wins).toBe(1);
    expect(s.total_losses).toBe(0);
    expect(s.total_competitions).toBe(1);
  });

  it('records a loss and increments total_losses', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 2 }));
    const s = mgr.getStats(agentId);
    expect(s.total_wins).toBe(0);
    expect(s.total_losses).toBe(1);
  });

  it('calculates win_rate_percent = wins / competitions * 100', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 2, competitionId: 'c2' }));
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1, competitionId: 'c3' }));

    const s = mgr.getStats(agentId);
    expect(s.total_competitions).toBe(3);
    expect(s.total_wins).toBe(2);
    expect(s.win_rate_percent).toBeCloseTo(66.67, 1);
  });

  it('accumulates total_pnl across competitions', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ startingCapital: 10_000, endingCapital: 11_000, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ startingCapital: 10_000, endingCapital: 9_500,  competitionId: 'c2' }));

    const s = mgr.getStats(agentId);
    expect(s.total_pnl).toBeCloseTo(500, 5); // +1000 - 500
  });

  it('accumulates trades_executed', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ tradesExecuted: 10, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ tradesExecuted: 15, competitionId: 'c2' }));

    expect(mgr.getStats(agentId).trades_executed).toBe(25);
  });

  it('tracks max_drawdown_percent as running maximum', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ maxDrawdownPercent: 10, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ maxDrawdownPercent: 5,  competitionId: 'c2' }));
    mgr.recordCompetitionResult(agentId, makeResult({ maxDrawdownPercent: 15, competitionId: 'c3' }));

    expect(mgr.getStats(agentId).max_drawdown_percent).toBe(15);
  });

  it('averages sharpe_ratio across competitions', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ sharpeRatio: 2.0, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ sharpeRatio: 0.0, competitionId: 'c2' }));

    expect(mgr.getStats(agentId).sharpe_ratio).toBeCloseTo(1.0, 5);
  });

  it('inserts a row into agent_competitions per call', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ competitionId: 'c2' }));

    const count = (db.prepare('SELECT COUNT(*) AS n FROM agent_competitions WHERE agent_id = ?').get(agentId) as { n: number }).n;
    expect(count).toBe(2);
  });

  it('history row has correct rank_position and pnl', () => {
    mgr.recordCompetitionResult(agentId, makeResult({
      rank: 2,
      startingCapital: 10_000,
      endingCapital: 9_200,
      competitionId: 'c1',
    }));

    const row = db.prepare('SELECT * FROM agent_competitions WHERE agent_id = ?').get(agentId) as {
      rank_position: number; pnl: number;
    };
    expect(row.rank_position).toBe(2);
    expect(row.pnl).toBeCloseTo(-800, 5);
  });

  // ── getStats ──────────────────────────────────────────────────────────────────

  it('getStats throws for unknown agent', () => {
    expect(() => mgr.getStats('nonexistent')).toThrow('Stats not found');
  });

  // ── getAllStats ────────────────────────────────────────────────────────────────

  it('getAllStats returns all stats rows ordered by win_rate DESC', () => {
    const a2 = 'agent-stats-002';
    insertAgent(db, a2);

    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1, competitionId: 'c1' })); // 100% win rate
    mgr.recordCompetitionResult(a2,      makeResult({ rank: 2, competitionId: 'c1' })); // 0% win rate

    const all = mgr.getAllStats();
    expect(all.length).toBe(2);
    expect(all[0]!.agent_id).toBe(agentId); // higher win rate first
  });

  // ── getTopAgents ──────────────────────────────────────────────────────────────

  it('getTopAgents returns agents joined with registry cosmetics', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1 }));

    const top = mgr.getTopAgents(5);
    expect(top.length).toBe(1);
    expect(top[0]!).toHaveProperty('custom_name');
    expect(top[0]!).toHaveProperty('emoji');
  });

  it('getTopAgents respects the limit', () => {
    for (let i = 0; i < 5; i++) {
      const id = `agent-top-${i}`;
      insertAgent(db, id);
      mgr.recordCompetitionResult(id, makeResult({ rank: 1, competitionId: `c${i}` }));
    }

    expect(mgr.getTopAgents(3).length).toBe(3);
  });

  // ── Three competitions: verify accumulation ───────────────────────────────────

  it('correctly accumulates stats across 3 consecutive competitions', () => {
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1, startingCapital: 10_000, endingCapital: 11_000, competitionId: 'c1' }));
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 1, startingCapital: 10_000, endingCapital: 10_500, competitionId: 'c2' }));
    mgr.recordCompetitionResult(agentId, makeResult({ rank: 2, startingCapital: 10_000, endingCapital: 9_800,  competitionId: 'c3' }));

    const s = mgr.getStats(agentId);
    expect(s.total_competitions).toBe(3);
    expect(s.total_wins).toBe(2);
    expect(s.total_losses).toBe(1);
    expect(s.win_rate_percent).toBeCloseTo(66.67, 1);
    expect(s.total_pnl).toBeCloseTo(1300, 5); // 1000 + 500 - 200
  });
});
