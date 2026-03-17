/**
 * Integration tests — Core API endpoints
 *
 * All external services (CoinGecko, NewsAPI, Claude, SQLite, cron) are mocked.
 * Tests use supertest to exercise the full Express request/response cycle.
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

jest.mock('../../services/coingecko.js', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getTopCoins: jest.fn().mockResolvedValue([
      {
        id: 'bitcoin',
        symbol: 'BTC',
        name: 'Bitcoin',
        price_usd: 65000,
        market_cap_usd: 1_300_000_000_000,
        volume_24h_usd: 30_000_000_000,
        price_change_24h_percent: 2.5,
        price_change_7d_percent: 8.0,
        volatility_24h: 4.2,
        volatility_7d: 12.0,
        sentiment_score: 'NEUTRAL' as const,
        sentiment_confidence: 0,
        sentiment_summary: '',
        trending_score: 0,
        timestamp: new Date().toISOString(),
        market_rank: 1,
      },
    ]),
    getCoinHistory: jest.fn().mockResolvedValue([
      { timestamp: new Date(), open: 64000, high: 66000, low: 63000, close: 65000 },
    ]),
  })),
}));

jest.mock('../../services/newsapi.js', () => ({
  NewsAPIService: jest.fn().mockImplementation(() => ({
    getHeadlines: jest.fn().mockResolvedValue(['Bitcoin surges', 'BTC hits new high']),
  })),
}));

jest.mock('../../services/content-signals.js', () => ({
  ContentSignalService: jest.fn().mockImplementation(() => ({
    collect: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'news-1',
          source: 'newsapi',
          source_label: 'CoinDesk',
          title: 'Bitcoin surges',
          body: 'Bullish momentum builds',
          url: 'https://example.com/news-1',
          published_at: '2026-03-17T00:00:00.000Z',
          engagement_score: 0.1,
          recency_score: 0.95,
          relevance_score: 0.9,
          keyword_score: 0.75,
          sentiment_score: 0.7,
          weighted_score: 0.6,
          source_weight: 1,
        },
      ],
      aggregateScore: 0.6,
      sourceBreakdown: [
        {
          source: 'newsapi',
          source_label: 'CoinDesk',
          item_count: 1,
          average_sentiment_score: 0.7,
          average_weighted_score: 0.6,
          weighted_frequency: 0.95,
        },
      ],
      collectionStats: {
        total_items: 1,
        source_count: 1,
        weighted_frequency: 0.95,
        average_recency_score: 0.95,
        trending_score: 42,
        collected_at: '2026-03-17T00:00:00.000Z',
      },
    }),
  })),
}));

jest.mock('../../services/sentiment.js', () => ({
  SentimentService: jest.fn().mockImplementation(() => ({
    analyzeSentiment: jest.fn().mockResolvedValue({
      symbol: 'BTC',
      analysis_date: '2026-03-17',
      sentiment_score: 'BULL' as const,
      confidence: 0.8,
      summary: 'Bullish momentum with strong volume',
      key_catalysts: ['ETF approval'],
      risk_factors: ['macro uncertainty'],
      short_term_outlook: 'positive',
      volatility_warning: false,
      trending_score: 2,
    }),
  })),
}));

jest.mock('../../services/backtesting-engine.js', () => ({
  BacktestingEngine: jest.fn().mockImplementation(() => ({
    runSimulation: jest.fn().mockResolvedValue({
      testId: 'bt-mock-123',
      config: {},
      agentResults: [],
      topPerformer: 'agent-1',
      summary: { totalReturn: 0.08, sharpeRatio: 1.2 },
    }),
    getResult: jest.fn().mockReturnValue(null),
    listResults: jest.fn().mockReturnValue([]),
  })),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import request from 'supertest';
import app from '../../index.js';

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.API_SECRET_KEY = 'test-secret';
  process.env.CLAUDE_API_KEY = 'test-claude-key';
  process.env.NEWSAPI_API_KEY = 'test-newsapi-key';
});

// ── GET /api/health ───────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 healthy when all keys are set', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services.coingecko).toBe('ok');
    expect(res.body.services.sqlite).toBe('ok');
  });

  it('returns 503 degraded when CLAUDE_API_KEY is missing', async () => {
    const savedKey = process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_API_KEY;

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.claude_api).toBe('misconfigured');

    process.env.CLAUDE_API_KEY = savedKey;
  });

  it('includes uptime_seconds in response', async () => {
    const res = await request(app).get('/api/health');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });
});

// ── GET /api/coins ────────────────────────────────────────────────────────────

describe('GET /api/coins', () => {
  it('returns coin data with sentiment', async () => {
    const res = await request(app).get('/api/coins');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      sentiment_score: 'BULL',
    });
  });

  it('returns last_updated and count fields', async () => {
    const res = await request(app).get('/api/coins');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('last_updated');
    expect(typeof res.body.count).toBe('number');
  });

  it('accepts limit query param', async () => {
    const res = await request(app).get('/api/coins?limit=10');
    expect(res.status).toBe(200);
  });

  it('accepts sort_by=volatility', async () => {
    const res = await request(app).get('/api/coins?sort_by=volatility');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('accepts sort_by=sentiment', async () => {
    const res = await request(app).get('/api/coins?sort_by=sentiment');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── GET /api/coins/:symbol ────────────────────────────────────────────────────

describe('GET /api/coins/:symbol', () => {
  it('returns 200 with coin detail for a known symbol', async () => {
    const res = await request(app).get('/api/coins/BTC');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('coin');
    expect(res.body).toHaveProperty('price_history');
    expect(res.body).toHaveProperty('headlines');
    expect(res.body).toHaveProperty('scored_items');
    expect(res.body.coin.symbol).toBe('BTC');
    expect(res.body.sentiment_today.trending_score).toBe(42);
    expect(res.body.scored_items[0]).toMatchObject({
      source: 'newsapi',
      title: 'Bitcoin surges',
    });
  });

  it('returns 404 for an unknown symbol', async () => {
    const res = await request(app).get('/api/coins/FAKECOIN999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns price_history as an array', async () => {
    const res = await request(app).get('/api/coins/BTC');
    expect(Array.isArray(res.body.price_history)).toBe(true);
  });
});

// ── GET /api/sentiment/:symbol ────────────────────────────────────────────────

describe('GET /api/sentiment/:symbol', () => {
  it('returns 404 when no sentiment is cached for the symbol', async () => {
    const res = await request(app).get('/api/sentiment/UNCACHED');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/UNCACHED/i);
  });

  it('returns 200 with cached sentiment after coins are fetched', async () => {
    // Prime the sentiment cache by hitting /api/coins first
    await request(app).get('/api/coins');
    const res = await request(app).get('/api/sentiment/BTC');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sentiment_score');
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('scored_items');
    expect(res.body).toHaveProperty('collection_stats');
  });
});

// ── POST /api/refresh-sentiment ───────────────────────────────────────────────

describe('POST /api/refresh-sentiment', () => {
  it('returns 401 when x-api-key header is missing', async () => {
    const res = await request(app).post('/api/refresh-sentiment').send({});
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when x-api-key header is wrong', async () => {
    const res = await request(app)
      .post('/api/refresh-sentiment')
      .set('x-api-key', 'wrong-key')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 202 with correct x-api-key', async () => {
    const res = await request(app)
      .post('/api/refresh-sentiment')
      .set('x-api-key', 'test-secret')
      .send({});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('job_id');
    expect(res.body.status).toBe('processing');
  });

  it('returns 202 with symbols filter', async () => {
    const res = await request(app)
      .post('/api/refresh-sentiment')
      .set('x-api-key', 'test-secret')
      .send({ symbols: ['BTC', 'ETH'] });
    expect(res.status).toBe(202);
    expect(res.body.coins_to_process).toBe(2);
  });
});

// ── GET /api/info/modes ───────────────────────────────────────────────────────

describe('GET /api/info/modes', () => {
  it('returns static documentation with modes and agent types', async () => {
    const res = await request(app).get('/api/info/modes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('analysisMode');
    expect(res.body).toHaveProperty('agentTypes');
    expect(res.body).toHaveProperty('riskProfiles');
  });
});

// ── POST /api/sentiment/analyze ───────────────────────────────────────────────

describe('POST /api/sentiment/analyze', () => {
  it('returns 400 when symbols array is missing', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({ mode: 'BASIC' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/symbols/i);
  });

  it('returns 400 when symbols is empty', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({ symbols: [], mode: 'BASIC' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for ADVANCED mode without marketData', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({ symbols: ['BTC'], mode: 'ADVANCED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/marketData/i);
  });

  it('returns 200 for BASIC mode (no marketData required)', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({
        symbols: ['BTC'],
        mode: 'BASIC',
        headlines: { BTC: ['Bitcoin rises', 'BTC bullish'] },
      });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('BASIC');
    expect(res.body).toHaveProperty('results.BTC');
    expect(res.body.results.BTC).toHaveProperty('sentiment');
    expect(res.body.results.BTC).toHaveProperty('confidence');
  });

  it('returns 200 for ADVANCED mode with marketData', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({
        symbols: ['BTC'],
        mode: 'ADVANCED',
        marketData: {
          BTC: {
            symbol: 'BTC',
            price_usd: 65000,
            price_change_24h_percent: 2.5,
            price_change_7d_percent: 8.0,
            volatility_24h: 4.2,
            volatility_7d: 12.0,
            volume_24h_usd: 30_000_000_000,
            market_cap_usd: 1_300_000_000_000,
            market_rank: 1,
          },
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ADVANCED');
    expect(res.body).toHaveProperty('results.BTC');
  });

  it('defaults to BASIC mode when mode is omitted', async () => {
    const res = await request(app)
      .post('/api/sentiment/analyze')
      .send({ symbols: ['ETH'] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('BASIC');
    expect(res.body).toHaveProperty('results.ETH');
  });
});

// ── POST /api/agents/configure ────────────────────────────────────────────────

describe('POST /api/agents/configure', () => {
  it('returns 200 and registers agents', async () => {
    const res = await request(app)
      .post('/api/agents/configure')
      .send({
        agents: [
          { type: 'RULE_BASED', riskProfile: 'CONSERVATIVE', initialCapital: 10000 },
          { type: 'ML_BASED',   riskProfile: 'AGGRESSIVE',   initialCapital: 10000 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configured');
    expect(typeof res.body.configured).toBe('number');
    expect(res.body.configured).toBeGreaterThan(0);
  });

  it('returns 400 when agents array is missing', async () => {
    const res = await request(app)
      .post('/api/agents/configure')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── GET /api/rankings/top-coins ───────────────────────────────────────────────

describe('GET /api/rankings/top-coins', () => {
  it('returns a ranked list of coins', async () => {
    const res = await request(app).get('/api/rankings/top-coins');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('coins');
    expect(Array.isArray(res.body.coins)).toBe(true);
  });

  it('accepts limit query param', async () => {
    const res = await request(app).get('/api/rankings/top-coins?limit=5');
    expect(res.status).toBe(200);
  });
});

// ── GET /api/backtest/results/:testId ─────────────────────────────────────────

describe('GET /api/backtest/results/:testId', () => {
  it('returns 404 for an unknown testId', async () => {
    const res = await request(app).get('/api/backtest/results/nonexistent-test-id');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for undefined GET routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for undefined POST routes', async () => {
    const res = await request(app).post('/api/does-not-exist').send({});
    expect(res.status).toBe(404);
  });
});
