import Database from 'better-sqlite3';
import { AdversarialTrainer } from '../../../services/evolutionary/adversarial-trainer.js';
import { ADVERSARY_GENE_BOUNDS, GENE_BOUNDS, type AgentGenome } from '../../../services/evolutionary/agent-genome.js';
import { GenomeManager, createDefaultGenome } from '../../../services/evolutionary/agent-genome.js';
import { AgentStatisticsManager } from '../../../services/evolutionary/agent-statistics-manager.js';
import type { CompetitionResult, CompetitionConfig } from '../../../services/marl-competition-engine.js';
import { runMigration003 } from '../../../database/migrations/003-agent-identity.js';

// ── In-memory DB setup ─────────────────────────────────────────────────────────

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
      id                  TEXT PRIMARY KEY,
      agent_id            TEXT NOT NULL REFERENCES agent_registry(id),
      parent_1_id         TEXT REFERENCES agent_registry(id),
      parent_2_id         TEXT REFERENCES agent_registry(id),
      breeding_date       TEXT NOT NULL DEFAULT (datetime('now')),
      breeding_generation INTEGER NOT NULL DEFAULT 0,
      inherited_genes     TEXT,
      mutations_applied   TEXT,
      mutation_severity   REAL NOT NULL DEFAULT 0,
      offspring_count     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS agent_genomes (
      agent_id   TEXT PRIMARY KEY REFERENCES agent_registry(id),
      genome     TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/** Register an active sentiment agent and return its ID. */
function registerSentimentAgent(db: Database.Database, genome: AgentGenome = createDefaultGenome()): string {
  const gm     = new GenomeManager(db);
  const stats  = new AgentStatisticsManager(db);
  const id     = gm.registerNewAgent({ genome, generationNumber: 0 });
  stats.initializeStats(id);
  return id;
}

/** Build the mock CompetitionResult returned by a mocked marlEngine. */
function makeMockResult(agentIds: string[], competitionId = 'mock_comp'): CompetitionResult {
  return {
    competitionId,
    mode: 'SINGLE',
    duration: 100,
    finalRankings: agentIds.map((id, index) => ({
      rank: index + 1,
      agentId: id,
      finalCapital: 10_000 + (agentIds.length - index) * 200,
      totalReturn: ((agentIds.length - index) * 200) / 10_000,
      sharpeRatio: 1.2 - index * 0.1,
      maxDrawdown: 0.03 + index * 0.01,
      tradesExecuted: 5 + index,
      winRate: 0.6 - index * 0.04,
    })),
    headToHeadMetrics: [],
    equityEvolution:   [],
    competitorImpact:  [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdversarialTrainer', () => {
  let db: Database.Database;
  let trainer: AdversarialTrainer;

  beforeEach(() => {
    db      = makeDb();
    trainer = new AdversarialTrainer(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── buildAdversaryGenome ───────────────────────────────────────────────────

  describe('buildAdversaryGenome', () => {
    it('sets agentType to ADVERSARY', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.agentType).toBe('ADVERSARY');
    });

    it('entryThreshold is within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.entryThreshold).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.entryThreshold.min);
      expect(adversary.entryThreshold).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.entryThreshold.max);
    });

    it('exitThreshold is within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.exitThreshold).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.exitThreshold.min);
      expect(adversary.exitThreshold).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.exitThreshold.max);
    });

    it('stopLossPct is within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.stopLossPct).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.stopLossPct.min);
      expect(adversary.stopLossPct).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.stopLossPct.max);
    });

    it('takeProfitPct is within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.takeProfitPct).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.takeProfitPct.min);
      expect(adversary.takeProfitPct).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.takeProfitPct.max);
    });

    it('positionSizePct is within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.positionSizePct).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.positionSizePct.min);
      expect(adversary.positionSizePct).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.positionSizePct.max);
    });

    it('holdDurationMax is an integer within ADVERSARY_GENE_BOUNDS', () => {
      const adversary = trainer.buildAdversaryGenome(createDefaultGenome());
      expect(adversary.holdDurationMax).toBeGreaterThanOrEqual(ADVERSARY_GENE_BOUNDS.holdDurationMax.min);
      expect(adversary.holdDurationMax).toBeLessThanOrEqual(ADVERSARY_GENE_BOUNDS.holdDurationMax.max);
      expect(Number.isInteger(adversary.holdDurationMax)).toBe(true);
    });

    it('inherits learning hyperparameters unchanged', () => {
      const base = createDefaultGenome();
      const adversary = trainer.buildAdversaryGenome(base);
      expect(adversary.epsilon).toBe(base.epsilon);
      expect(adversary.learningRate).toBe(base.learningRate);
      expect(adversary.gamma).toBe(base.gamma);
      expect(adversary.explorationDecayRate).toBe(base.explorationDecayRate);
    });

    it('high-entry-threshold target → low adversary entry (inversion)', () => {
      const highEntry = { ...createDefaultGenome(), entryThreshold: GENE_BOUNDS.entryThreshold.max }; // 80
      const adversary = trainer.buildAdversaryGenome(highEntry);
      // Should map to ADVERSARY_GENE_BOUNDS.entryThreshold.min (20)
      expect(adversary.entryThreshold).toBeCloseTo(ADVERSARY_GENE_BOUNDS.entryThreshold.min, 0);
    });

    it('low-entry-threshold target → high adversary entry (inversion)', () => {
      const lowEntry = { ...createDefaultGenome(), entryThreshold: GENE_BOUNDS.entryThreshold.min }; // 30
      const adversary = trainer.buildAdversaryGenome(lowEntry);
      // Should map to ADVERSARY_GENE_BOUNDS.entryThreshold.max (50)
      expect(adversary.entryThreshold).toBeCloseTo(ADVERSARY_GENE_BOUNDS.entryThreshold.max, 0);
    });

    it('does not mutate the input genome', () => {
      const original = createDefaultGenome();
      const originalEntry = original.entryThreshold;
      trainer.buildAdversaryGenome(original);
      expect(original.entryThreshold).toBe(originalEntry);
      expect(original.agentType).toBeUndefined();
    });
  });

  // ── runAdversarialRound ────────────────────────────────────────────────────

  describe('runAdversarialRound', () => {
    const cfg = { symbols: ['BTC'], initialCapital: 10_000, duration: 100, adversaryPopulationSize: 2 };

    function mockMarlEngine(trainerInstance: AdversarialTrainer, result?: Partial<CompetitionResult>) {
      const internal = trainerInstance as unknown as {
        marlEngine: { runCompetition: jest.Mock };
      };
      internal.marlEngine.runCompetition = jest.fn(async (config: CompetitionConfig, _onProgress: unknown, competitionId: string) => ({
        ...makeMockResult(config.agents.map(a => a.id), competitionId),
        ...result,
      }));
      return internal.marlEngine.runCompetition;
    }

    it('returns summary with correct sentimentAgentsCount', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db), registerSentimentAgent(db)];
      const mockRun = mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 1, ids, allStats, cfg);
      expect(summary.sentimentAgentsCount).toBe(3);
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('creates at most adversaryPopulationSize adversaries', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 1, ids, allStats, { ...cfg, adversaryPopulationSize: 5 });
      // Only 2 sentiment agents exist so at most 2 adversaries
      expect(summary.adversaryAgentsCount).toBeLessThanOrEqual(2);
    });

    it('returns one matchup per adversary created', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 1, ids, allStats, cfg);
      expect(summary.matchups).toHaveLength(summary.adversaryAgentsCount);
    });

    it('retires adversary agents after the round', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      await trainer.runAdversarialRound('t1', 1, ids, allStats, cfg);

      const activeAdversaries = db.prepare(
        `SELECT id FROM agent_registry WHERE agent_type = 'ADVERSARY' AND status = 'ACTIVE'`
      ).all();
      expect(activeAdversaries).toHaveLength(0);
    });

    it('sentimentWinRate is between 0 and 100', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 1, ids, allStats, cfg);
      expect(summary.sentimentWinRate).toBeGreaterThanOrEqual(0);
      expect(summary.sentimentWinRate).toBeLessThanOrEqual(100);
    });

    it('beatingAgentIds only contains sentiment agent IDs', async () => {
      const ids = [registerSentimentAgent(db), registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 1, ids, allStats, cfg);
      for (const beatingId of summary.beatingAgentIds) {
        expect(ids).toContain(beatingId);
      }
    });

    it('returns empty summary when population has no genomes', async () => {
      // Register agent but deliberately skip saving genome
      const agentId = 'no-genome-agent';
      db.prepare(`INSERT INTO agent_registry (id) VALUES (?)`).run(agentId);

      mockMarlEngine(trainer);
      const allStats = [{ agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 }];

      const summary = await trainer.runAdversarialRound('t1', 1, [agentId], allStats, cfg);
      // No adversaries could be created (genome missing) → empty round
      expect(summary.adversaryAgentsCount).toBe(0);
      expect(summary.matchups).toHaveLength(0);
      expect(summary.sentimentWinRate).toBe(100);
    });

    it('matchup sentimentWon is true when sentiment fitness ≥ adversary fitness', async () => {
      const sentimentId = registerSentimentAgent(db);
      mockMarlEngine(trainer, {
        finalRankings: [
          { rank: 1, agentId: sentimentId, finalCapital: 12_000, totalReturn: 0.2, sharpeRatio: 1.5, maxDrawdown: 0.02, tradesExecuted: 8, winRate: 0.7 },
          // adversary agent ID unknown at this point — we use wildcard via mock below
        ],
      });

      // Override mock to put sentiment first (higher fitness = sentiment wins)
      const internal = trainer as unknown as { marlEngine: { runCompetition: jest.Mock } };
      internal.marlEngine.runCompetition = jest.fn(async (config: CompetitionConfig, _: unknown, competitionId: string) => {
        const [s, a] = config.agents.map(ag => ag.id);
        return makeMockResult([s!, a!], competitionId);  // sentiment ranked first
      });

      const allStats = [{ agentId: sentimentId, winRatePct: 70, sharpeRatio: 1.5, totalPnl: 200, totalCompetitions: 5 }];
      const summary = await trainer.runAdversarialRound('t1', 1, [sentimentId], allStats, { ...cfg, adversaryPopulationSize: 1 });

      // sentiment is rank 1 → higher fitness → sentimentWon
      expect(summary.matchups[0]!.sentimentWon).toBe(true);
    });

    it('generation field matches the passed generation number', async () => {
      const ids = [registerSentimentAgent(db)];
      mockMarlEngine(trainer);
      const allStats = ids.map(id => ({ agentId: id, winRatePct: 50, sharpeRatio: 1, totalPnl: 0, totalCompetitions: 1 }));

      const summary = await trainer.runAdversarialRound('t1', 7, ids, allStats, { ...cfg, adversaryPopulationSize: 1 });
      expect(summary.generation).toBe(7);
    });
  });
});
