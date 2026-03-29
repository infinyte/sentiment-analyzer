import Database from 'better-sqlite3';
import { EvolutionaryOrchestrator } from '../../../services/evolutionary/evolutionary-orchestrator.js';
import { runMigration003 } from '../../../database/migrations/003-agent-identity.js';
import type { CompetitionResult, CompetitionConfig } from '../../../services/marl-competition-engine.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      id                 TEXT PRIMARY KEY,
      agent_type         TEXT NOT NULL DEFAULT 'ML_BASED',
      risk_profile       TEXT NOT NULL DEFAULT 'CONSERVATIVE',
      status             TEXT NOT NULL DEFAULT 'ACTIVE',
      custom_name        TEXT,
      emoji              TEXT,
      color              TEXT,
      biography          TEXT,
      personality_traits TEXT,
      nickname           TEXT,
      age_iterations     INTEGER NOT NULL DEFAULT 0,
      generation_number  INTEGER NOT NULL DEFAULT 0,
      parent_id_1        TEXT REFERENCES agent_registry(id),
      parent_id_2        TEXT REFERENCES agent_registry(id),
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  runMigration003(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_genealogy (
      id                 TEXT PRIMARY KEY,
      agent_id           TEXT NOT NULL REFERENCES agent_registry(id),
      parent_1_id        TEXT REFERENCES agent_registry(id),
      parent_2_id        TEXT REFERENCES agent_registry(id),
      breeding_date      TEXT NOT NULL DEFAULT (datetime('now')),
      breeding_generation INTEGER NOT NULL DEFAULT 0,
      inherited_genes    TEXT,
      mutations_applied  TEXT,
      mutation_severity  REAL NOT NULL DEFAULT 0,
      offspring_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_genomes (
      agent_id   TEXT PRIMARY KEY REFERENCES agent_registry(id),
      genome     TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS evolutionary_tournaments (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      started_at       TEXT NOT NULL,
      payload          TEXT NOT NULL,
      claude_directive TEXT
    );

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

async function waitForTournamentCompletion(
  orchestrator: EvolutionaryOrchestrator,
  tournamentId: string,
): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const record = orchestrator.getTournament(tournamentId);
    if (record?.status === 'COMPLETED') {
      return;
    }

    if (record?.status === 'FAILED') {
      throw new Error(`Tournament failed: ${record.error ?? 'unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for tournament completion');
}

describe('EvolutionaryOrchestrator', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it('persists agent statistics and competition history after a completed tournament', async () => {
    const orchestrator = new EvolutionaryOrchestrator(db);
    const orchestratorInternals = orchestrator as unknown as {
      marlEngine: {
        runCompetition: jest.Mock<Promise<CompetitionResult>, [CompetitionConfig, ((progress: number) => void) | undefined, string | undefined]>;
      };
    };

    orchestratorInternals.marlEngine.runCompetition = jest.fn(async (config, _onProgress, competitionId) => ({
      competitionId: competitionId ?? 'mock_competition',
      mode: config.mode,
      duration: config.duration,
      finalRankings: config.agents.map((agent, index) => ({
        rank: index + 1,
        agentId: agent.id,
        finalCapital: 10_000 + (config.agents.length - index) * 250,
        totalReturn: ((config.agents.length - index) * 250) / 10_000,
        sharpeRatio: 1.2 - index * 0.1,
        maxDrawdown: 0.04 + index * 0.01,
        tradesExecuted: 6 + index,
        winRate: 0.65 - index * 0.05,
      })),
      headToHeadMetrics: [],
      equityEvolution: [],
      competitorImpact: [],
    }));

    const tournamentId = await orchestrator.startTournament({
      name: 'Persistence validation',
      populationSize: 4,
      maxGenerations: 1,
      symbols: ['BTC'],
      competitionDuration: 100,
    });

    await waitForTournamentCompletion(orchestrator as unknown as EvolutionaryOrchestrator, tournamentId);

    const statsRows = db.prepare(`
      SELECT total_competitions, trades_executed, total_wins, total_losses
      FROM agent_statistics
      ORDER BY trades_executed DESC
    `).all() as Array<{
      total_competitions: number;
      trades_executed: number;
      total_wins: number;
      total_losses: number;
    }>;

    const historyCount = (db.prepare('SELECT COUNT(*) AS count FROM agent_competitions').get() as { count: number }).count;
    const completedCompetitionRows = statsRows.filter(row => row.total_competitions === 1);

    expect(orchestratorInternals.marlEngine.runCompetition).toHaveBeenCalledTimes(1);
    expect(statsRows.length).toBeGreaterThanOrEqual(4);
    expect(completedCompetitionRows).toHaveLength(4);
    expect(completedCompetitionRows.some(row => row.trades_executed > 0)).toBe(true);
    expect(completedCompetitionRows.some(row => row.total_wins === 1)).toBe(true);
    expect(completedCompetitionRows.some(row => row.total_losses === 1)).toBe(true);
    expect(historyCount).toBe(4);
  });
});