/**
 * Integration tests — MARL broker credential routes
 *
 * Tests all 7 endpoints in /api/marl/broker/*.
 * All external dependencies (storage, brokerRegistry, broker-factory, crypto,
 * node-cron, social store, CoinGecko, etc.) are mocked.
 *
 * Endpoints under test:
 *   POST   /api/marl/broker/credentials
 *   GET    /api/marl/broker/credentials
 *   DELETE /api/marl/broker/credentials/:id
 *   POST   /api/marl/broker/connect/:id
 *   GET    /api/marl/broker/connected
 *   GET    /api/marl/broker/orders/:competitionId
 *   POST   /api/marl/broker/emergency-stop
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
    getDb: jest.fn().mockReturnValue({}),
    saveBacktestResult: jest.fn(),
    getBacktestResult: jest.fn().mockReturnValue(null),
    listBacktestResults: jest.fn().mockReturnValue([]),
    deleteBacktestResult: jest.fn(),
    saveBrokerCredential: jest.fn(),
    listBrokerCredentials: jest.fn().mockReturnValue([]),
    decryptBrokerCredential: jest.fn().mockReturnValue(undefined),
    deleteBrokerCredential: jest.fn().mockReturnValue(false),
    getBrokerOrders: jest.fn().mockReturnValue([]),
    insertBrokerOrder: jest.fn(),
    updateBrokerOrder: jest.fn(),
    getOpenBrokerOrders: jest.fn().mockReturnValue([]),
    getAllAgentLearningStates: jest.fn().mockReturnValue([]),
  },
}));

const mockAdapter = {
  provider:         'ALPACA' as const,
  mode:             'PAPER'  as const,
  credentialId:     'cred-paper-1',
  connect:          jest.fn().mockResolvedValue(undefined),
  disconnect:       jest.fn().mockResolvedValue(undefined),
  placeOrder:       jest.fn(),
  pollOrderStatus:  jest.fn(),
  cancelOrder:      jest.fn(),
  cancelAllOrders:  jest.fn().mockResolvedValue(3),
  validateSymbols:  jest.fn().mockResolvedValue([]),
  getAccount:       jest.fn().mockResolvedValue({ equity: 10000, cash: 10000, currency: 'USD' }),
  getPositions:     jest.fn().mockResolvedValue([]),
  onFill:           jest.fn(),
  offFill:          jest.fn(),
};

const mockRegistryStore = new Map<string, typeof mockAdapter>([[mockAdapter.credentialId, mockAdapter]]);

jest.mock('../../services/brokers/broker-registry.js', () => ({
  brokerRegistry: {
    register: jest.fn().mockResolvedValue(undefined),
    unregister: jest.fn().mockResolvedValue(undefined),
    get: jest.fn((id: string) => mockRegistryStore.get(id)),
    has: jest.fn((id: string) => mockRegistryStore.has(id)),
    listIds: jest.fn(() => Array.from(mockRegistryStore.keys())),
    disconnectAll: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/brokers/broker-factory.js', () => ({
  createBrokerAdapter: jest.fn().mockReturnValue(mockAdapter),
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

jest.mock('../../services/marl-competition-engine.js', () => ({
  MarlCompetitionEngine: jest.fn().mockImplementation(() => ({
    storeRecord: jest.fn(),
    updateRecord: jest.fn(),
    runCompetition: jest.fn().mockResolvedValue({}),
    getRecord: jest.fn().mockReturnValue(null),
    getAllRecords: jest.fn().mockReturnValue([]),
  })),
}));

jest.mock('../../services/social-scraper.js', () => ({
  SocialScraperService: jest.fn().mockImplementation(() => ({
    scrape: jest.fn().mockResolvedValue({ posts: [] }),
  })),
}));

jest.mock('../../services/trending-topics.js', () => ({
  TrendingTopicsEngine: jest.fn().mockImplementation(() => ({
    discoverTrends: jest.fn().mockResolvedValue([]),
    getTopTrends: jest.fn().mockReturnValue([]),
  })),
}));

jest.mock('../../database/sqlite-social-store.js', () => ({
  socialStore: {
    connect: jest.fn(),
    close: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
    getTrendingTopics: jest.fn().mockReturnValue([]),
    queryItems: jest.fn().mockReturnValue({ items: [], total: 0, limit: 50, offset: 0 }),
    getItem: jest.fn().mockReturnValue(undefined),
    getStats: jest.fn().mockReturnValue({ total_items: 0, items_24h: 0, trending_topics: 0, sources: [] }),
    getItemsForCoin: jest.fn().mockReturnValue([]),
    getHistoricalSignal: jest.fn().mockReturnValue([]),
    upsertItems: jest.fn().mockReturnValue(0),
    upsertTrendingTopic: jest.fn(),
    saveTrendingSnapshot: jest.fn(),
    incrementFetchCount: jest.fn(),
    pruneOldItems: jest.fn().mockReturnValue(0),
    resetDailyCounters: jest.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from 'supertest';
import app from '../../index.js';
import { storage } from '../../storage.js';
import { brokerRegistry } from '../../services/brokers/broker-registry.js';
import { createBrokerAdapter } from '../../services/brokers/broker-factory.js';
import { resetMarlRateLimitersForTests } from '../../routes/marl-competition.js';

const storageMock = storage as jest.Mocked<typeof storage>;
const registryMock = brokerRegistry as jest.Mocked<typeof brokerRegistry>;
const factoryMock  = createBrokerAdapter as jest.Mock;

const VALID_API_KEY = 'test-secret-key';

beforeEach(() => {
  process.env.API_SECRET_KEY    = VALID_API_KEY;
  process.env.BROKER_MASTER_KEY = 'aaaabbbbccccddddeeeeffffgggghhhh'; // 32-char hex for AES-256
  // Reset the competition-start rate limiter so this test suite starts fresh.
  resetMarlRateLimitersForTests();
  jest.clearAllMocks();
  storageMock.listBrokerCredentials.mockReturnValue([]);
  storageMock.decryptBrokerCredential.mockReturnValue(undefined);
  storageMock.deleteBrokerCredential.mockReturnValue(false);
  storageMock.getBrokerOrders.mockReturnValue([]);
  registryMock.get.mockImplementation((id: string) => mockRegistryStore.get(id) as never);
  registryMock.has.mockImplementation((id: string) => mockRegistryStore.has(id));
  registryMock.listIds.mockImplementation(() => Array.from(mockRegistryStore.keys()));
});

// ─── POST /api/marl/broker/credentials ────────────────────────────────────────

describe('POST /api/marl/broker/credentials', () => {
  const validBody = {
    label:     'My Alpaca Paper',
    provider:  'ALPACA',
    mode:      'PAPER',
    apiKey:    'PKTESTAPIKEY',
    apiSecret: 'supersecretvalue',
  };

  it('returns 401 without x-api-key', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong x-api-key', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', 'wrong-key')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when provider is missing', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send({ ...validBody, provider: undefined });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported provider', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send({ ...validBody, provider: 'BINANCE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported provider/i);
  });

  it('returns 400 for invalid mode', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send({ ...validBody, mode: 'SIMULATED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode must be PAPER or LIVE/i);
  });

  it('returns 503 when BROKER_MASTER_KEY env var is not set', async () => {
    delete process.env.BROKER_MASTER_KEY;
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/BROKER_MASTER_KEY/);
  });

  it('returns 201 with credential id and metadata (no secrets)', async () => {
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.provider).toBe('ALPACA');
    expect(res.body.mode).toBe('PAPER');
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.body).not.toHaveProperty('apiSecret');
    expect(storageMock.saveBrokerCredential).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ALPACA', mode: 'PAPER' })
    );
  });

  it('auto-generates label from provider/mode when omitted', async () => {
    const { label: _omit, ...noLabel } = validBody;
    const res = await request(app)
      .post('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY)
      .send(noLabel);
    expect(res.status).toBe(201);
    expect(res.body.label).toMatch(/ALPACA PAPER/i);
  });
});

// ─── GET /api/marl/broker/credentials ─────────────────────────────────────────

describe('GET /api/marl/broker/credentials', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app).get('/api/marl/broker/credentials');
    expect(res.status).toBe(401);
  });

  it('returns empty list when no credentials stored', async () => {
    const res = await request(app)
      .get('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  it('returns credential metadata without secrets, with connected flag', async () => {
    storageMock.listBrokerCredentials.mockReturnValue([
      {
        id:        'cred-paper-1',
        label:     'Test Paper',
        provider:  'ALPACA',
        mode:      'PAPER',
        encrypted: { iv: 'aa', authTag: 'bb', ciphertext: 'cc' },
        createdAt: '2026-03-17T00:00:00Z',
        lastUsed:  undefined,
      },
    ]);

    const res = await request(app)
      .get('/api/marl/broker/credentials')
      .set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    const cred = res.body.credentials[0];
    expect(cred.id).toBe('cred-paper-1');
    expect(cred.connected).toBe(true); // mockRegistryStore has 'cred-paper-1'
    expect(cred).not.toHaveProperty('encrypted');
    expect(cred).not.toHaveProperty('apiKey');
  });
});

// ─── DELETE /api/marl/broker/credentials/:id ──────────────────────────────────

describe('DELETE /api/marl/broker/credentials/:id', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app).delete('/api/marl/broker/credentials/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 404 when credential does not exist', async () => {
    storageMock.deleteBrokerCredential.mockReturnValue(false);
    const res = await request(app)
      .delete('/api/marl/broker/credentials/nonexistent')
      .set('x-api-key', VALID_API_KEY);
    expect(res.status).toBe(404);
  });

  it('disconnects adapter and deletes credential', async () => {
    storageMock.deleteBrokerCredential.mockReturnValue(true);
    const res = await request(app)
      .delete('/api/marl/broker/credentials/cred-paper-1')
      .set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(registryMock.unregister).toHaveBeenCalledWith('cred-paper-1');
    expect(storageMock.deleteBrokerCredential).toHaveBeenCalledWith('cred-paper-1');
  });
});

// ─── POST /api/marl/broker/connect/:id ────────────────────────────────────────

describe('POST /api/marl/broker/connect/:id', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app).post('/api/marl/broker/connect/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 503 when BROKER_MASTER_KEY is not set', async () => {
    delete process.env.BROKER_MASTER_KEY;
    const res = await request(app)
      .post('/api/marl/broker/connect/cred-paper-1')
      .set('x-api-key', VALID_API_KEY);
    expect(res.status).toBe(503);
  });

  it('returns 404 when the credential does not exist', async () => {
    storageMock.decryptBrokerCredential.mockReturnValue(undefined);
    const res = await request(app)
      .post('/api/marl/broker/connect/unknown-cred')
      .set('x-api-key', VALID_API_KEY);
    expect(res.status).toBe(404);
  });

  it('decrypts, creates adapter, registers, and returns 200', async () => {
    storageMock.decryptBrokerCredential.mockReturnValue({
      apiKey: 'PKTEST', apiSecret: 'secret',
    });
    storageMock.listBrokerCredentials.mockReturnValue([
      {
        id: 'cred-paper-1', label: 'Test', provider: 'ALPACA', mode: 'PAPER',
        encrypted: { iv: '', authTag: '', ciphertext: '' },
        createdAt: '2026-03-17T00:00:00Z',
      },
    ]);

    const res = await request(app)
      .post('/api/marl/broker/connect/cred-paper-1')
      .set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.id).toBe('cred-paper-1');
    expect(factoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ALPACA', mode: 'PAPER' })
    );
    expect(registryMock.register).toHaveBeenCalledWith(mockAdapter);
  });
});

// ─── GET /api/marl/broker/connected ───────────────────────────────────────────

describe('GET /api/marl/broker/connected', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app).get('/api/marl/broker/connected');
    expect(res.status).toBe(401);
  });

  it('returns list of connected adapter ids with metadata', async () => {
    storageMock.listBrokerCredentials.mockReturnValue([
      {
        id: 'cred-paper-1', label: 'Alpaca Paper', provider: 'ALPACA', mode: 'PAPER',
        encrypted: { iv: '', authTag: '', ciphertext: '' },
        createdAt: '2026-03-17T00:00:00Z',
      },
    ]);

    const res = await request(app)
      .get('/api/marl/broker/connected')
      .set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const entry = res.body.connected[0];
    expect(entry.id).toBe('cred-paper-1');
    expect(entry.provider).toBe('ALPACA');
    expect(entry.mode).toBe('PAPER');
  });
});

// ─── GET /api/marl/broker/orders/:competitionId ───────────────────────────────

describe('GET /api/marl/broker/orders/:competitionId', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app).get('/api/marl/broker/orders/comp-test');
    expect(res.status).toBe(401);
  });

  it('returns empty order list for a competition with no orders', async () => {
    storageMock.getBrokerOrders.mockReturnValue([]);
    const res = await request(app)
      .get('/api/marl/broker/orders/comp-test')
      .set('x-api-key', VALID_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(0);
    expect(res.body.competitionId).toBe('comp-test');
  });

  it('returns order list omitting brokerResponse', async () => {
    storageMock.getBrokerOrders.mockReturnValue([
      {
        id:             'ord-1',
        competitionId:  'comp-test',
        agentId:        'alpha',
        clientOrderId:  'uuid-1',
        brokerOrderId:  'alpaca-123',
        credentialId:   'cred-paper-1',
        provider:       'ALPACA',
        mode:           'PAPER',
        symbol:         'BTC',
        side:           'BUY',
        quantity:       0.5,
        limitPrice:     60000,
        status:         'FILLED',
        filledQuantity: 0.5,
        avgFillPrice:   60100,
        submittedAt:    '2026-03-17T00:00:00Z',
        updatedAt:      '2026-03-17T00:00:05Z',
        brokerResponse: { rawField: 'should not appear' },
      },
    ]);

    const res = await request(app)
      .get('/api/marl/broker/orders/comp-test')
      .set('x-api-key', VALID_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    const order = res.body.orders[0];
    expect(order.symbol).toBe('BTC');
    expect(order.status).toBe('FILLED');
    expect(order).not.toHaveProperty('brokerResponse');
    expect(order).not.toHaveProperty('id');
  });

  it('filters by agentId query param when provided', async () => {
    storageMock.getBrokerOrders.mockReturnValue([]);
    await request(app)
      .get('/api/marl/broker/orders/comp-test?agentId=alpha')
      .set('x-api-key', VALID_API_KEY);

    expect(storageMock.getBrokerOrders).toHaveBeenCalledWith('comp-test', 'alpha');
  });
});

// ─── POST /api/marl/broker/emergency-stop ─────────────────────────────────────

describe('POST /api/marl/broker/emergency-stop', () => {
  it('returns 401 without x-api-key', async () => {
    const res = await request(app)
      .post('/api/marl/broker/emergency-stop')
      .send({ competitionId: 'comp-x', credentialId: 'cred-paper-1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when missing required fields', async () => {
    const res = await request(app)
      .post('/api/marl/broker/emergency-stop')
      .set('x-api-key', VALID_API_KEY)
      .send({ competitionId: 'comp-x' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when adapter is not connected', async () => {
    registryMock.get.mockReturnValue(undefined as never);
    const res = await request(app)
      .post('/api/marl/broker/emergency-stop')
      .set('x-api-key', VALID_API_KEY)
      .send({ competitionId: 'comp-x', credentialId: 'not-connected' });
    expect(res.status).toBe(404);
  });

  it('calls cancelAllOrders and returns 200 with cancelled count', async () => {
    registryMock.get.mockReturnValue(mockAdapter as never);
    mockAdapter.cancelAllOrders.mockResolvedValue(5);

    const res = await request(app)
      .post('/api/marl/broker/emergency-stop')
      .set('x-api-key', VALID_API_KEY)
      .send({ competitionId: 'comp-test', credentialId: 'cred-paper-1' });

    expect(res.status).toBe(200);
    expect(res.body.emergencyStop).toBe(true);
    expect(res.body.cancelled).toBe(5);
    expect(mockAdapter.cancelAllOrders).toHaveBeenCalledWith('comp-test');
  });
});

// ─── POST /api/marl/competition/start — exchangeMode validation ───────────────
// These tests verify the new broker-param wiring in the competition start route.

describe('POST /api/marl/competition/start — exchangeMode and broker params', () => {
  const baseBody = {
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

  it('defaults to SIMULATED when exchangeMode is omitted', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send(baseBody);
    expect(res.status).toBe(202);
    expect(res.body.exchangeMode).toBe('SIMULATED');
  });

  it('returns 400 for an invalid exchangeMode value', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...baseBody, exchangeMode: 'FAKEMODE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exchangeMode/i);
  });

  it('returns 400 when PAPER mode is requested but brokerCredentialId is missing', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...baseBody, exchangeMode: 'PAPER' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brokerCredentialId/i);
  });

  it('returns 400 when LIVE mode is requested but brokerCredentialId is missing', async () => {
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...baseBody, exchangeMode: 'LIVE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brokerCredentialId/i);
  });

  it('returns 400 when credentialId is provided but adapter is not connected', async () => {
    registryMock.has.mockReturnValue(false);
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...baseBody, exchangeMode: 'PAPER', brokerCredentialId: 'not-connected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not connected/i);
  });

  it('returns 202 when PAPER mode with a connected credentialId is provided', async () => {
    registryMock.has.mockReturnValue(true);
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({ ...baseBody, exchangeMode: 'PAPER', brokerCredentialId: 'cred-paper-1' });
    expect(res.status).toBe(202);
    expect(res.body.exchangeMode).toBe('PAPER');
  });

  it('returns 400 for riskConfig with out-of-range maxPositionPct', async () => {
    registryMock.has.mockReturnValue(true);
    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        ...baseBody,
        exchangeMode: 'PAPER',
        brokerCredentialId: 'cred-paper-1',
        riskConfig: { maxPositionPct: 1.5 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maxPositionPct/i);
  });

  it('returns 202 with valid riskConfig and echoes exchangeMode in response', async () => {
    registryMock.has.mockReturnValue(true);

    const res = await request(app)
      .post('/api/marl/competition/start')
      .send({
        ...baseBody,
        exchangeMode: 'PAPER',
        brokerCredentialId: 'cred-paper-1',
        riskConfig: { maxPositionPct: 0.05, maxLossPerStepPct: 0.01, maxDailyDrawdownPct: 0.08 },
      });

    expect(res.status).toBe(202);
    expect(res.body.exchangeMode).toBe('PAPER');
    expect(res.body).toHaveProperty('competitionId');
  });
});
