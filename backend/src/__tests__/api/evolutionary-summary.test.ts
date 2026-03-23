const listTournamentsMock = jest.fn();

jest.mock('../../services/evolutionary/evolutionary-orchestrator.js', () => ({
  EvolutionaryOrchestrator: jest.fn().mockImplementation(() => ({
    startTournament: jest.fn(),
    listTournaments: listTournamentsMock,
    getTournament: jest.fn(),
  })),
}));

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createEvolutionaryRouter } from '../../routes/evolutionary.js';
import { SQLiteAgentRepository } from '../../repositories/adapters/sqlite/sqlite-agent.repository.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_registry (
      id TEXT PRIMARY KEY,
      agent_type TEXT,
      risk_profile TEXT,
      status TEXT,
      generation_number INTEGER,
      parent_id_1 TEXT,
      parent_id_2 TEXT
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

    CREATE TABLE agent_statistics (
      agent_id TEXT PRIMARY KEY,
      total_competitions INTEGER DEFAULT 0,
      total_wins INTEGER DEFAULT 0,
      total_losses INTEGER DEFAULT 0,
      win_rate_percent REAL DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      max_drawdown_percent REAL DEFAULT 0,
      sharpe_ratio REAL DEFAULT 0,
      roi_percent REAL DEFAULT 0,
      trades_executed INTEGER DEFAULT 0,
      consistency_score REAL DEFAULT 0,
      avg_trade_profit REAL DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE evolutionary_tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      started_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);

  return db;
}

describe('GET /api/evolutionary/summary', () => {
  let app: express.Express;
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    listTournamentsMock.mockReset();

    listTournamentsMock.mockReturnValue([
      {
        tournamentId: 'evo-2',
        name: 'March Finals',
        status: 'COMPLETED',
        currentGeneration: 2,
        currentPopulation: ['agent-a', 'agent-b', 'agent-c', 'agent-d'],
        config: {
          populationSize: 4,
          maxGenerations: 2,
          symbols: ['BTC'],
        },
        startedAt: '2026-03-18T10:00:00.000Z',
        completedAt: '2026-03-18T10:15:00.000Z',
        generations: [
          {
            generation: 1,
            competitionId: 'comp-1',
            population: ['agent-a', 'agent-b', 'agent-c', 'agent-d'],
            survivors: ['agent-a', 'agent-b'],
            offspring: ['agent-e', 'agent-f'],
            retired: ['agent-c', 'agent-d'],
            topAgentId: 'agent-a',
            topFitness: 88,
            avgFitness: 63,
            completedAt: '2026-03-18T10:05:00.000Z',
          },
          {
            generation: 2,
            competitionId: 'comp-2',
            population: ['agent-a', 'agent-b', 'agent-e', 'agent-f'],
            survivors: ['agent-a', 'agent-e'],
            offspring: ['agent-g', 'agent-h'],
            retired: ['agent-b', 'agent-f'],
            topAgentId: 'agent-a',
            topFitness: 92,
            avgFitness: 71,
            completedAt: '2026-03-18T10:15:00.000Z',
          },
        ],
      },
      {
        tournamentId: 'evo-1',
        name: 'March Warmup',
        status: 'FAILED',
        currentGeneration: 1,
        currentPopulation: ['agent-1', 'agent-2', 'agent-3', 'agent-4'],
        config: {
          populationSize: 4,
          maxGenerations: 3,
          symbols: ['ETH'],
        },
        startedAt: '2026-03-17T10:00:00.000Z',
        completedAt: '2026-03-17T10:07:00.000Z',
        generations: [
          {
            generation: 1,
            competitionId: 'comp-old',
            population: ['agent-1', 'agent-2', 'agent-3', 'agent-4'],
            survivors: ['agent-1', 'agent-2'],
            offspring: ['agent-5'],
            retired: ['agent-3'],
            topAgentId: 'agent-1',
            topFitness: 77,
            avgFitness: 58,
            completedAt: '2026-03-17T10:07:00.000Z',
          },
        ],
      },
    ]);

    app = express();
    app.use(createEvolutionaryRouter(db, new SQLiteAgentRepository(db)));
  });

  afterEach(() => {
    db.close();
  });

  it('returns tournament aggregates and the latest generation timeline', async () => {
    const response = await request(app).get('/api/evolutionary/summary');

    expect(response.status).toBe(200);
    expect(response.body.totals.totalTournaments).toBe(2);
    expect(response.body.totals.completedTournaments).toBe(1);
    expect(response.body.totals.failedTournaments).toBe(1);
    expect(response.body.totals.totalGenerations).toBe(3);
    expect(response.body.crossTournament.bestTournament).toMatchObject({
      tournamentId: 'evo-2',
      latestTopFitness: 92,
      latestAvgFitness: 71,
    });
    expect(response.body.crossTournament.latestVsPrevious).toMatchObject({
      latestTournamentId: 'evo-2',
      previousTournamentId: 'evo-1',
      topFitnessDelta: 15,
      avgFitnessDelta: 13,
      generationCountDelta: 1,
    });
    expect(response.body.crossTournament.recentPerformance).toHaveLength(2);
    expect(response.body.recentTournaments[0]).toMatchObject({
      tournamentId: 'evo-2',
      latestTopFitness: 92,
      latestAvgFitness: 71,
      generationCount: 2,
    });
    expect(response.body.latestTournament.tournamentId).toBe('evo-2');
    expect(response.body.latestTournament.generationTimeline).toHaveLength(2);
    expect(response.body.latestTournament.generationTimeline[0]).toMatchObject({
      generation: 1,
      topFitness: 88,
      avgFitness: 63,
      survivorCount: 2,
      offspringCount: 2,
      retiredCount: 2,
    });
  });
});