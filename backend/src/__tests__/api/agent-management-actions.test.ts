/**
 * Integration tests for manual agent retirement and selective breeding actions.
 */

jest.mock('../../services/evolutionary/evolutionary-orchestrator.js', () => ({
  EvolutionaryOrchestrator: jest.fn().mockImplementation(() => ({
    startTournament: jest.fn(),
    listTournaments: jest.fn().mockReturnValue([]),
    getTournament: jest.fn().mockReturnValue(null),
  })),
}));

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createAgentStatsRouter } from '../../routes/agent-stats.js';
import { createEvolutionaryRouter } from '../../routes/evolutionary.js';
import { createDefaultGenome } from '../../services/evolutionary/agent-genome.js';
import { SQLiteAgentRepository } from '../../repositories/adapters/sqlite/sqlite-agent.repository.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE agent_registry (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      risk_profile TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      custom_name TEXT,
      emoji TEXT,
      color TEXT,
      biography TEXT,
      nickname TEXT,
      age_iterations INTEGER DEFAULT 0,
      generation_number INTEGER DEFAULT 0,
      parent_id_1 TEXT,
      parent_id_2 TEXT,
      personality_traits TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_statistics (
      agent_id TEXT PRIMARY KEY,
      total_competitions INTEGER NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      total_losses INTEGER NOT NULL DEFAULT 0,
      win_rate_percent REAL NOT NULL DEFAULT 0,
      total_pnl REAL NOT NULL DEFAULT 0,
      max_drawdown_percent REAL NOT NULL DEFAULT 0,
      sharpe_ratio REAL NOT NULL DEFAULT 0,
      roi_percent REAL NOT NULL DEFAULT 0,
      trades_executed INTEGER NOT NULL DEFAULT 0,
      consistency_score REAL NOT NULL DEFAULT 0,
      avg_trade_profit REAL NOT NULL DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_competitions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      competition_id TEXT NOT NULL,
      rank_position INTEGER,
      starting_capital REAL,
      ending_capital REAL,
      pnl REAL,
      trades_count INTEGER,
      win_trades INTEGER,
      loss_trades INTEGER,
      largest_win REAL,
      largest_loss REAL,
      sharpe_ratio REAL,
      completed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_genomes (
      agent_id TEXT PRIMARY KEY,
      genome TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_genealogy (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      parent_1_id TEXT,
      parent_2_id TEXT,
      breeding_date TEXT DEFAULT CURRENT_TIMESTAMP,
      breeding_generation INTEGER DEFAULT 0,
      inherited_genes TEXT,
      mutations_applied TEXT,
      mutation_severity REAL DEFAULT 0,
      offspring_count INTEGER DEFAULT 0
    );
  `);

  return db;
}

describe('agent lifecycle management routes', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();

    db.prepare(`
      INSERT INTO agent_registry (id, agent_type, risk_profile, status, custom_name, generation_number)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).run('agent-1', 'MOMENTUM', 'AGGRESSIVE', 'Signal Hunter', 3);

    db.prepare(`
      INSERT INTO agent_registry (id, agent_type, risk_profile, status, custom_name, generation_number)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).run('agent-2', 'MEAN_REVERSION', 'CONSERVATIVE', 'Mean Reverter', 3);

    db.prepare(`
      INSERT INTO agent_statistics (agent_id, total_competitions, total_wins, total_losses, win_rate_percent, total_pnl)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('agent-1', 12, 8, 4, 66.7, 1234.56);

    db.prepare(`
      INSERT INTO agent_statistics (agent_id, total_competitions, total_wins, total_losses, win_rate_percent, total_pnl)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('agent-2', 11, 6, 5, 54.5, 640.25);

    db.prepare('INSERT INTO agent_genomes (agent_id, genome) VALUES (?, ?)').run('agent-1', JSON.stringify(createDefaultGenome()));
    db.prepare('INSERT INTO agent_genomes (agent_id, genome) VALUES (?, ?)').run('agent-2', JSON.stringify(createDefaultGenome()));

    app = express();
    app.use(express.json());
    const agentRepo = new SQLiteAgentRepository(db);
    app.use(createAgentStatsRouter(agentRepo));
    app.use(createEvolutionaryRouter(db, agentRepo));
  });

  afterEach(() => {
    db.close();
  });

  it('retires an active agent and removes it from the active registry list', async () => {
    const retireResponse = await request(app)
      .post('/api/agents/agent-1/retire')
      .send({});

    expect(retireResponse.status).toBe(200);
    expect(retireResponse.body.retired).toBe(true);
    expect(retireResponse.body.agent.status).toBe('RETIRED');

    const agentsResponse = await request(app).get('/api/agents?limit=100');

    expect(agentsResponse.status).toBe(200);
    expect(agentsResponse.body.agents).toHaveLength(1);
    expect(agentsResponse.body.agents[0].id).toBe('agent-2');
  });

  it('breeds selected active parents into persisted child agents with stats rows', async () => {
    const response = await request(app)
      .post('/api/evolutionary/breed')
      .send({
        parentIds: ['agent-1', 'agent-2'],
        childCount: 2,
        crossoverStrategy: 'UNIFORM',
        mutationSeverity: 'MEDIUM',
      });

    expect(response.status).toBe(201);
    expect(response.body.childCount).toBe(2);
    expect(response.body.children).toHaveLength(2);

    for (const child of response.body.children as Array<{ id: string; generationNumber: number; status: string }>) {
      expect(child.status).toBe('ACTIVE');
      expect(child.generationNumber).toBe(4);

      const registryRow = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(child.id) as { parent_id_1: string; parent_id_2: string; status: string } | undefined;
      const statsRow = db.prepare('SELECT * FROM agent_statistics WHERE agent_id = ?').get(child.id) as { agent_id: string } | undefined;
      const genealogyRow = db.prepare('SELECT * FROM agent_genealogy WHERE agent_id = ?').get(child.id) as { agent_id: string } | undefined;
      const genomeRow = db.prepare('SELECT * FROM agent_genomes WHERE agent_id = ?').get(child.id) as { agent_id: string } | undefined;

      expect(registryRow).toBeDefined();
      expect(['agent-1', 'agent-2']).toContain(registryRow?.parent_id_1);
      expect(['agent-1', 'agent-2']).toContain(registryRow?.parent_id_2);
      expect(statsRow).toBeDefined();
      expect(genealogyRow).toBeDefined();
      expect(genomeRow).toBeDefined();
    }
  });
});
