/**
 * Integration tests — MARL Competition API endpoints
 *
 * MarlCompetitionEngine is mocked to avoid running actual Q-learning simulations
 * in tests. All other external dependencies are also mocked.
 */

// ── Mock all external dependencies before any imports ────────────────────────

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('../../storage.js', () => ({
  storage: {
    connect: jest.fn(),
    close: jest.fn(),
    pruneExpiredSentiment: jest.fn().mockReturnValue(0),
    getSentiment: jest.fn().mockReturnValue(null),
    saveSentiment: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
    saveBacktestResult: jest.fn(),
    getBacktestResult: jest.fn().mockReturnValue(null),
    listBacktestResults: jest.fn().mockReturnValue([]),
    deleteBacktestResult: jest.fn(),
  },
}));

jest.mock('../../services/coingecko.js', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getTopCoins: jest.fn().mockResolvedValue([]),
    getCoinHistory: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../services/newsapi.js', () => ({
  NewsAPIService: jest.fn().mockImplementation(() => ({
    getHeadlines: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../services/sentiment.js', () => ({
  SentimentService: jest.fn().mockImplementation(() => ({
    analyzeSentiment: jest.fn().mockResolvedValue({
      symbol: 'BTC', analysis_date: '2026-03-17',
      sentiment_score: 'NEUTRAL' as const, confidence: 0.5, summary: '',
      key_catalysts: [], risk_factors: [], short_term_outlook: '',
      volatility_warning: false, trending_score: 0,
    }),
  })),
}));

jest.mock('../../services/backtesting-engine.js', () => ({
  BacktestingEngine: jest.fn().mockImplementation(() => ({
    runSimulation: jest.fn().mockResolvedValue({}),
    getResult: jest.fn().mockReturnValue(null),
    listResults: jest.fn().mockReturnValue([]),
  })),
}));

// Mock the MARL engine to prevent real Q-learning simulations
const mockCompetitionResult = {
  competitionId: 'mock-comp-id',
  mode: 'SINGLE',
  duration: 100,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  finalRankings: [
    { rank: 1, agentId: 'alpha', finalCapital: 11000, totalReturn: 0.1, sharpeRatio: 1.5, maxDrawdown: 0.05, tradesExecuted: 10, winRate: 0.6 },
    { rank: 2, agentId: 'beta',  finalCapital: 9500,  totalReturn: -0.05, sharpeRatio: 0.8, maxDrawdown: 0.1, tradesExecuted: 8, winRate: 0.4 },
  ],
  headToHeadMetrics: [
    { agent1: 'alpha', agent2: 'beta', agent1Return: 0.1, agent2Return: -0.05, winner: 'alpha' },
  ],
  equityEvolution: [],
  competitorImpact: [
    { agentId: 'alpha', averageLiquidityImpact: 0.0025, timesOutbid: 2, timesOutsold: 1 },
    { agentId: 'beta',  averageLiquidityImpact: 0.0018, timesOutbid: 1, timesOutsold: 2 },
  ],
};

const mockCompletedRecord = {
  competitionId: 'mock-comp-123',
  status: 'COMPLETED' as const,
  config: {
    mode: 'SINGLE' as const,
    agents: [
      { id: 'alpha', riskProfile: 'AGGRESSIVE' as const },
      { id: 'beta',  riskProfile: 'CONSERVATIVE' as const },
    ],
    symbols: ['BTC'],
    duration: 100,
    refreshInterval: 1000,
    learningEnabled: true,
  },
  startedAt: new Date('2026-03-17'),
  completedAt: new Date('2026-03-17'),
  progress: 100,
  topPerformerId: 'alpha',
  result: mockCompetitionResult,
};

jest.mock('../../services/marl-competition-engine.js', () => ({
  MarlCompetitionEngine: jest.fn().mockImplementation(() => ({
    storeRecord:         jest.fn(),
    updateRecord:        jest.fn(),
    runCompetition:      jest.fn().mockResolvedValue(mockCompetitionResult),
    runSingleTournament: jest.fn().mockResolvedValue(mockCompetitionResult),
    getRecord:           jest.fn().mockReturnValue(null),
    getAllRecords:        jest.fn().mockReturnValue([]),
  })),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from 'supertest';
import app from '../../index.js';
import { MarlCompetitionEngine } from '../../services/marl-competition-engine.js';

// ── Shared engine instance captured once at module load ───────────────────────

let engine: ReturnType<typeof MarlCompetitionEngine['prototype']['constructor']> & {
  storeRecord: jest.Mock;
  updateRecord: jest.Mock;
  runCompetition: jest.Mock;
  runSingleTournament: jest.Mock;
  getRecord: jest.Mock;
  getAllRecords: jest.Mock;
};

beforeAll(() => {
  // The router creates `new MarlCompetitionEngine()` when the module loads.
  // Capture the mock instance so tests can configure per-call behaviour.
  engine = (MarlCompetitionEngine as jest.MockedClass<typeof MarlCompetitionEngine>)
    .mock.instances[0] as typeof engine;
});

beforeEach(() => {
  // Restore sensible defaults before each test (clearMocks wipes .calls but
  // NOT mockReturnValue — we reset here to avoid test-order dependencies).
  engine.getRecord.mockReturnValue(null);
  engine.getAllRecords.mockReturnValue([]);
  engine.runCompetition.mockResolvedValue(mockCompetitionResult);
  engine.runSingleTournament.mockResolvedValue(mockCompetitionResult);
});

// ── POST /api/marl/competition/start — validation ─────────────────────────────

describe('POST /api/marl/competition/start — validation', () => {
  const validBody = {
    mode: 'SINGLE',
    agents: [
      { id: 'alpha', riskProfile: 'AGGRESSIVE' },
      { id: 'beta',  riskProfile: 'CONSERVATIVE' },
    ],
    symbols: ['BTC', 'ETH'],
    duration: 200,
    refreshInterval: 1000,
    learningEnabled: true,
  };

  it('returns 400 for invalid mode', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...validBody, mode: 'INVALID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/i);
  });

  it('returns 400 when fewer than 2 agents are provided', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...validBody, agents: [{ id: 'solo', riskProfile: 'AGGRESSIVE' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agents/i);
  });

  it('returns 400 when more than 20 agents are provided', async () => {
    const agents = Array.from({ length: 21 }, (_, i) => ({ id: `agent${i}`, riskProfile: 'AGGRESSIVE' }));
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...validBody, agents });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20/);
  });

  it('returns 400 when an agent has an invalid riskProfile', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        ...validBody,
        agents: [
          { id: 'alpha', riskProfile: 'YOLO' },
          { id: 'beta',  riskProfile: 'CONSERVATIVE' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/riskProfile/i);
  });

  it('returns 400 when an agent id is missing', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        ...validBody,
        agents: [
          { id: '', riskProfile: 'AGGRESSIVE' },
          { id: 'beta', riskProfile: 'CONSERVATIVE' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 when symbols array is empty', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...validBody, symbols: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/symbols/i);
  });
});

// ── POST /api/marl/competition/start — success ────────────────────────────────

describe('POST /api/marl/competition/start — success', () => {
  it('returns 202 with competitionId and status STARTED', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        mode: 'SINGLE',
        agents: [
          { id: 'alpha', riskProfile: 'AGGRESSIVE' },
          { id: 'beta',  riskProfile: 'CONSERVATIVE' },
          { id: 'gamma', riskProfile: 'SCALPING' },
        ],
        symbols: ['BTC', 'ETH'],
        duration: 200,
        refreshInterval: 1000,
        learningEnabled: true,
      });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('STARTED');
    expect(typeof res.body.competitionId).toBe('string');
    expect(res.body.competitionId).toMatch(/^comp_/);
    expect(res.body.agentCount).toBe(3);
    expect(res.body.symbols).toContain('BTC');
  });

  it('calls engine.storeRecord with RUNNING status', async () => {
    await request(app)
      .post('/api/marl/competition/start')
      .send({
        mode: 'EVOLUTIONARY',
        agents: [
          { id: 'a1', riskProfile: 'CONSERVATIVE' },
          { id: 'a2', riskProfile: 'AGGRESSIVE' },
        ],
        symbols: ['ETH'],
        duration: 100,
        refreshInterval: 500,
        learningEnabled: false,
        evolutionaryRounds: 2,
      });
    expect(engine.storeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RUNNING' })
    );
  });

  it('sanitises agent ids (strips special characters)', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        mode: 'SINGLE',
        agents: [
          { id: 'agent!@#$%one', riskProfile: 'AGGRESSIVE' },
          { id: 'agent two',     riskProfile: 'CONSERVATIVE' },
        ],
        symbols: ['BTC'],
        duration: 100,
        refreshInterval: 1000,
        learningEnabled: true,
      });
    // sanitizeAgentId strips special chars — request should still succeed
    expect(res.status).toBe(202);
  });

  it('clamps duration to valid range [50, 100000]', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        mode: 'SINGLE',
        agents: [
          { id: 'a', riskProfile: 'AGGRESSIVE' },
          { id: 'b', riskProfile: 'CONSERVATIVE' },
        ],
        symbols: ['BTC'],
        duration: 5,    // below minimum of 50 — should be clamped to 50
        refreshInterval: 1000,
        learningEnabled: true,
      });
    expect(res.status).toBe(202);
    expect(res.body.duration).toBe(50);
  });
});

// ── GET /api/marl/competition/:id/status ──────────────────────────────────────

describe('GET /api/marl/competition/:id/status', () => {
  it('returns 404 for an unknown competition id', async () => {
    engine.getRecord.mockReturnValue(null);
    const res = await request(app).get('/api/marl/competition/nonexistent-id/status');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns RUNNING status with progress when competition is in progress', async () => {
    engine.getRecord.mockReturnValue({
      competitionId: 'running-id',
      status: 'RUNNING',
      progress: 42,
      config: mockCompletedRecord.config,
      startedAt: new Date('2026-03-17'),
      topPerformerId: null,
    });
    const res = await request(app).get('/api/marl/competition/running-id/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RUNNING');
    expect(res.body.progress).toBe(42);
    expect(res.body.topPerformer).toBeNull();
  });

  it('returns COMPLETED status with topPerformer and topReturn when done', async () => {
    engine.getRecord.mockReturnValue(mockCompletedRecord);
    const res = await request(app).get('/api/marl/competition/mock-comp-123/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.topPerformer).toBe('alpha');
    expect(typeof res.body.topReturn).toBe('string');
  });

  it('returns 500 for a FAILED competition', async () => {
    engine.getRecord.mockReturnValue({
      competitionId: 'failed-id',
      status: 'FAILED',
      config: mockCompletedRecord.config,
      startedAt: new Date(),
      progress: 0,
    });
    const res = await request(app).get('/api/marl/competition/failed-id/status');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('FAILED');
  });
});

// ── GET /api/marl/competition/:id/results ────────────────────────────────────

describe('GET /api/marl/competition/:id/results', () => {
  it('returns 404 for an unknown competition id', async () => {
    engine.getRecord.mockReturnValue(null);
    const res = await request(app).get('/api/marl/competition/nonexistent/results');
    expect(res.status).toBe(404);
  });

  it('returns 202 when competition is still RUNNING', async () => {
    engine.getRecord.mockReturnValue({
      competitionId: 'still-running',
      status: 'RUNNING',
      progress: 55,
      config: mockCompletedRecord.config,
      startedAt: new Date(),
    });
    const res = await request(app).get('/api/marl/competition/still-running/results');
    expect(res.status).toBe(202);
    expect(res.body.error).toMatch(/running/i);
  });

  it('returns 200 with full results for a COMPLETED competition', async () => {
    engine.getRecord.mockReturnValue(mockCompletedRecord);
    const res = await request(app).get('/api/marl/competition/mock-comp-123/results');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('finalRankings');
    expect(res.body).toHaveProperty('headToHeadMetrics');
    expect(res.body).toHaveProperty('equityEvolution');
    expect(res.body).toHaveProperty('competitorImpact');
    expect(res.body.finalRankings[0].agentId).toBe('alpha');
  });

  it('formats totalReturn as a percentage in the results', async () => {
    engine.getRecord.mockReturnValue(mockCompletedRecord);
    const res = await request(app).get('/api/marl/competition/mock-comp-123/results');
    expect(res.status).toBe(200);
    // totalReturn of 0.1 should become 10 (percent)
    expect(res.body.finalRankings[0].totalReturn).toBeCloseTo(10, 1);
  });
});

// ── POST /api/marl/agents/compare ────────────────────────────────────────────

describe('POST /api/marl/agents/compare', () => {
  const validCompare = {
    agent1: { id: 'alpha', riskProfile: 'AGGRESSIVE' },
    agent2: { id: 'beta',  riskProfile: 'CONSERVATIVE' },
    symbols: ['BTC'],
    rounds: 3,
    duration: 100,
  };

  it('returns 400 when agent1 is missing', async () => {
    const res = await request(app)
      .post('/api/marl/agents/compare')
      .send({ ...validCompare, agent1: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 when agent2 has an invalid riskProfile', async () => {
    const res = await request(app)
      .post('/api/marl/agents/compare')
      .send({ ...validCompare, agent2: { id: 'beta', riskProfile: 'INVALID' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/riskProfile/i);
  });

  it('returns 200 with comparison stats', async () => {
    const res = await request(app)
      .post('/api/marl/agents/compare')
      .send(validCompare);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agent1');
    expect(res.body).toHaveProperty('agent2');
    expect(res.body).toHaveProperty('rounds');
    expect(res.body).toHaveProperty('overallWinner');
    expect(res.body).toHaveProperty('roundDetails');
    expect(Array.isArray(res.body.roundDetails)).toBe(true);
    expect(res.body.roundDetails).toHaveLength(3);
  });

  it('win rates sum to 100%', async () => {
    const res = await request(app)
      .post('/api/marl/agents/compare')
      .send(validCompare);
    expect(res.status).toBe(200);
    expect(res.body.agent1WinRate + res.body.agent2WinRate).toBeCloseTo(100, 0);
  });

  it('clamps rounds to [1, 10]', async () => {
    const res = await request(app)
      .post('/api/marl/agents/compare')
      .send({ ...validCompare, rounds: 50 }); // above max of 10
    expect(res.status).toBe(200);
    expect(res.body.rounds).toBe(10);
  });
});

// ── GET /api/marl/competitions ────────────────────────────────────────────────

describe('GET /api/marl/competitions', () => {
  it('returns empty list when no competitions have been run', async () => {
    engine.getAllRecords.mockReturnValue([]);
    const res = await request(app).get('/api/marl/competitions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.competitions).toHaveLength(0);
  });

  it('returns competition summaries', async () => {
    engine.getAllRecords.mockReturnValue([mockCompletedRecord]);
    const res = await request(app).get('/api/marl/competitions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const comp = res.body.competitions[0];
    expect(comp.competitionId).toBe('mock-comp-123');
    expect(comp.status).toBe('COMPLETED');
    expect(comp.topPerformer).toBe('alpha');
    expect(typeof comp.topReturn).toBe('string');
  });
});

// ── GET /api/marl/info ────────────────────────────────────────────────────────

describe('GET /api/marl/info', () => {
  it('returns 200 with static documentation', async () => {
    const res = await request(app).get('/api/marl/info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tournamentModes');
    expect(res.body).toHaveProperty('riskProfiles');
    expect(res.body).toHaveProperty('learningAlgorithm');
    expect(res.body).toHaveProperty('orderBook');
    expect(res.body).toHaveProperty('endpoints');
  });

  it('documents all three tournament modes', async () => {
    const res = await request(app).get('/api/marl/info');
    expect(res.body.tournamentModes).toHaveProperty('SINGLE');
    expect(res.body.tournamentModes).toHaveProperty('EVOLUTIONARY');
    expect(res.body.tournamentModes).toHaveProperty('CONTINUOUS');
  });
});
