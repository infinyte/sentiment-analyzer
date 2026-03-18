/// <reference types="jest" />

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
  },
}));

const socialStoreMock = {
  connect: jest.fn(),
  close: jest.fn(),
  pruneOldItems: jest.fn().mockReturnValue(0),
  resetDailyCounters: jest.fn(),
  getTrendingTopics: jest.fn(),
  queryItems: jest.fn(),
  getItem: jest.fn(),
  getStats: jest.fn().mockReturnValue({ total_items: 0, items_24h: 0, trending_topics: 0, sources: [] }),
};

jest.mock('../../database/sqlite-social-store.js', () => ({
  socialStore: socialStoreMock,
}));

jest.mock('../../services/coingecko.js', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getTopCoins: jest.fn().mockResolvedValue([]),
    getCoinHistory: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../services/content-signals.js', () => ({
  ContentSignalService: jest.fn().mockImplementation(() => ({
    collect: jest.fn().mockResolvedValue({
      items: [],
      aggregateScore: 0,
      sourceBreakdown: [],
      collectionStats: {
        total_items: 0,
        source_count: 0,
        weighted_frequency: 0,
        average_recency_score: 0,
        trending_score: 0,
        collected_at: '2026-03-17T00:00:00.000Z',
      },
    }),
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
      symbol: 'BTC',
      analysis_date: '2026-03-17',
      sentiment_score: 'NEUTRAL' as const,
      confidence: 0.5,
      summary: '',
      key_catalysts: [],
      risk_factors: [],
      short_term_outlook: '',
      volatility_warning: false,
      trending_score: 0,
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

jest.mock('../../services/social-scraper.js', () => ({
  SocialScraperService: jest.fn().mockImplementation(() => ({
    scrape: jest.fn().mockResolvedValue({ platforms: [] }),
    scrapeBatch: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../services/trending-topics.js', () => ({
  TrendingTopicsEngine: jest.fn().mockImplementation(() => ({
    ingestPosts: jest.fn(),
    getTrendingTopics: jest.fn().mockReturnValue({
      topics: [],
      total_posts_analyzed: 0,
      prior_window_posts: 0,
      computed_at: new Date().toISOString(),
      window_hours: 4,
    }),
    scrapeAndIngest: jest.fn().mockResolvedValue({ ingested: 0, symbols: 0 }),
    storedPostCount: 0,
  })),
}));

const discoveryEngineMock = {
  discoverTrends: jest.fn(),
};

jest.mock('../../services/social-media/trending/trending-discovery-engine.js', () => ({
  TrendingTopicDiscoveryEngine: jest.fn().mockImplementation(() => discoveryEngineMock),
}));

jest.mock('../../services/social-media/scraper/scraper-manager.js', () => ({
  SocialMediaScraperManager: jest.fn().mockImplementation(() => ({
    refreshRssAll: jest.fn().mockResolvedValue(0),
    refreshDiscordAll: jest.fn().mockResolvedValue(0),
    refreshTelegramAll: jest.fn().mockResolvedValue(0),
    fetchBatch: jest.fn().mockResolvedValue([]),
    scrapeAll: jest.fn().mockResolvedValue({
      rss_items: 0,
      discord_items: 0,
      telegram_items: 0,
      coin_results: [],
      total_items_scraped: 0,
      total_items_stored: 0,
      duration_ms: 0,
    }),
  })),
}));

jest.mock('../../services/social-media/trending/multi-source-calculator.js', () => ({
  MultiSourceTrendingScoreCalculator: jest.fn().mockImplementation(() => ({
    calculate: jest.fn().mockResolvedValue({
      symbol: 'BTC',
      signal_sentiment: 68,
      signal_engagement: 52,
      signal_recency: 61,
      signal_authority: 49,
      signal_composite: 63,
      trend_direction: 'BULLISH',
      trend_strength: 'MODERATE',
      velocity: 1.2,
      mention_count_24h: 12,
      unique_sources: 3,
      sentiment_momentum: {
        h1_avg: 66,
        h6_avg: 61,
        h24_avg: 55,
        roc_1h: 5,
        roc_6h: 8,
        volume_interaction_24h: 1.8,
      },
      sentiment_distribution: { BULL: 60, NEUTRAL: 25, BEAR: 15 },
      top_sources: [],
      top_hashtags: [],
      trending_keywords: [],
      recent_items: [],
      comparison: { score_24h_ago: 52, score_7d_ago: 40, trend_acceleration: 'accelerating' },
      computed_at: '2026-03-18T00:00:00.000Z',
    }),
  })),
}));

import { Router } from 'express';

jest.mock('../../routes/marl-competition.js', () => {
  return { __esModule: true, default: Router() };
});

import request from 'supertest';
import app from '../../index.js';

describe('Social Media API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    socialStoreMock.getTrendingTopics.mockReturnValue([
      {
        id: '1',
        topic: 'BTC',
        topic_type: 'coin',
        coin_symbol: 'BTC',
        mention_count: 5,
        unique_sources: 2,
        signal_sentiment: 72,
        signal_engagement: 60,
        signal_recency: 70,
        signal_authority: 55,
        signal_composite: 80,
        velocity: 1.5,
        peak_time: '2026-03-17T11:00:00.000Z',
        last_updated: new Date().toISOString(),
        created_at: '2026-03-17T10:00:00.000Z',
      },
      {
        id: '2',
        topic: '#bitcoin',
        topic_type: 'hashtag',
        coin_symbol: 'BTC',
        mention_count: 3,
        unique_sources: 1,
        signal_sentiment: 68,
        signal_engagement: 58,
        signal_recency: 66,
        signal_authority: 50,
        signal_composite: 74,
        velocity: 0.9,
        peak_time: '2026-03-17T10:30:00.000Z',
        last_updated: new Date().toISOString(),
        created_at: '2026-03-17T09:30:00.000Z',
      },
    ]);

    socialStoreMock.queryItems.mockReturnValue({
      items: [
        {
          id: 'item-1',
          source: 'reddit',
          source_id: 'post-1',
          content: 'BTC is trending',
          title: 'BTC is trending',
          author: 'trader',
          engagement_likes: 20,
          engagement_shares: 4,
          engagement_comments: 3,
          content_created_at: '2026-03-17T11:00:00.000Z',
          fetched_at: '2026-03-17T11:05:00.000Z',
          url: 'https://example.com/post-1',
          coins_mentioned: ['BTC'],
          metadata: {},
          sentiment_score: 0.5,
          sentiment_confidence: 0.9,
          score_sentiment: 70,
          score_engagement: 50,
          score_recency: 90,
          score_authority: 40,
          score_composite: 82,
          last_updated: '2026-03-17T11:05:00.000Z',
        },
      ],
      total: 1,
      limit: 1,
      offset: 0,
      nextCursor: 'opaque-cursor-token',
    });
  });

  it('clusters related trending topics in the response payload', async () => {
    const res = await request(app).get('/api/social-media/trending-topics?timeWindow=24&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.topics[0]).toMatchObject({
      topic: 'BTC',
      coin_symbol: 'BTC',
      cluster_size: 2,
      clustered_topics: ['#bitcoin', 'BTC'],
    });
  });

  it('returns next_cursor metadata for cursor pagination on items endpoint', async () => {
    const res = await request(app).get('/api/social-media/items?limit=1&sort=recency&cursor=opaque-input');

    expect(res.status).toBe(200);
    expect(socialStoreMock.queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        sort: 'recency',
        cursor: 'opaque-input',
      })
    );
    expect(res.body).toMatchObject({
      total: 1,
      limit: 1,
      offset: 0,
      next_cursor: 'opaque-cursor-token',
    });
    expect(res.body.items).toHaveLength(1);
  });

  it('returns sentiment_momentum on the trending-score endpoint', async () => {
    const res = await request(app).get('/api/trending-score/BTC');

    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe('BTC');
    expect(res.body.sentiment_momentum).toMatchObject({
      h1_avg: 66,
      h6_avg: 61,
      h24_avg: 55,
      roc_1h: 5,
      roc_6h: 8,
    });
  });
});
