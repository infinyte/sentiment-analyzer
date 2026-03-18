/**
 * TrendingTopicDiscoveryEngine tests
 *
 * The engine reads from socialStore, so we mock the store and control
 * exactly what items are returned for the current/prior windows.
 */

import { randomUUID } from 'crypto';
import type { ScoredSocialItem } from '../../../types/social-media';

// ── Mock socialStore before importing the engine ──────────────────────────────

const mockQueryItems = jest.fn();
const mockUpsertTrendingTopic = jest.fn();
const mockSaveTrendingSnapshot = jest.fn();

jest.mock('../../../database/sqlite-social-store', () => ({
  socialStore: {
    queryItems:            mockQueryItems,
    upsertTrendingTopic:   mockUpsertTrendingTopic,
    saveTrendingSnapshot:  mockSaveTrendingSnapshot,
  },
}));

import { TrendingTopicDiscoveryEngine } from '../../../services/social-media/trending/trending-discovery-engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ScoredSocialItem> = {}): ScoredSocialItem {
  return {
    id: randomUUID(),
    source: 'twitter',
    source_id: randomUUID(),
    content: 'BTC bitcoin is going to the moon',
    title: '',
    engagement_likes:    100,
    engagement_shares:   20,
    engagement_comments: 10,
    content_created_at: new Date().toISOString(),
    fetched_at:          new Date().toISOString(),
    url: 'https://x.com/status/1',
    coins_mentioned: ['BTC'],
    metadata: {},
    sentiment_score:      0.5,
    sentiment_confidence: 0.7,
    score_sentiment:  70,
    score_engagement: 50,
    score_recency:    85,
    score_authority:  45,
    score_composite:  62,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrendingTopicDiscoveryEngine', () => {
  let engine: TrendingTopicDiscoveryEngine;

  beforeEach(() => {
    engine = new TrendingTopicDiscoveryEngine();
    mockQueryItems.mockReset();
    mockUpsertTrendingTopic.mockReset();
    mockSaveTrendingSnapshot.mockReset();
  });

  it('returns empty array when no items are in the store', async () => {
    mockQueryItems.mockReturnValue({ items: [] });
    const topics = await engine.discoverTrends(24, 20, 1);
    expect(topics).toEqual([]);
  });

  it('produces a trending topic for a coin mentioned in multiple items', async () => {
    const items = Array.from({ length: 5 }, () => makeItem({ coins_mentioned: ['BTC'] }));
    mockQueryItems.mockReturnValue({ items });

    const topics = await engine.discoverTrends(24, 20, 2);

    expect(topics.length).toBeGreaterThan(0);
    const btcTopic = topics.find(t => t.topic === 'BTC');
    expect(btcTopic).toBeDefined();
    expect(btcTopic!.topic_type).toBe('coin');
    expect(btcTopic!.coin_symbol).toBe('BTC');
    expect(btcTopic!.mention_count).toBe(5);
  });

  it('persists each discovered topic to the store', async () => {
    const items = Array.from({ length: 4 }, () => makeItem({ coins_mentioned: ['ETH'] }));
    mockQueryItems.mockReturnValue({ items });

    await engine.discoverTrends(24, 20, 2);

    expect(mockUpsertTrendingTopic).toHaveBeenCalled();
    const call = mockUpsertTrendingTopic.mock.calls[0][0];
    expect(call.topic).toBe('ETH');
  });

  it('saves historical snapshots for coin topics', async () => {
    const items = Array.from({ length: 3 }, () => makeItem({ coins_mentioned: ['SOL'] }));
    mockQueryItems.mockReturnValue({ items });

    await engine.discoverTrends(24, 20, 1);

    expect(mockSaveTrendingSnapshot).toHaveBeenCalledWith('SOL', expect.any(Number), expect.any(Number));
  });

  it('filters out topics below minMentions threshold', async () => {
    const items = [makeItem({ coins_mentioned: ['DOGE'] })]; // only 1 mention
    mockQueryItems.mockReturnValue({ items });

    const topics = await engine.discoverTrends(24, 20, 2); // min = 2

    const dogeTopic = topics.find(t => t.topic === 'DOGE');
    expect(dogeTopic).toBeUndefined();
  });

  it('ranks topics by signal_composite descending', async () => {
    const btcItems = Array.from({ length: 10 }, () => makeItem({ coins_mentioned: ['BTC'], score_composite: 80 }));
    const ethItems = Array.from({ length: 3  }, () => makeItem({ coins_mentioned: ['ETH'], score_composite: 40, source: 'reddit' }));
    mockQueryItems.mockReturnValue({ items: [...btcItems, ...ethItems] });

    const topics = await engine.discoverTrends(24, 20, 2);

    if (topics.length >= 2) {
      expect(topics[0].signal_composite).toBeGreaterThanOrEqual(topics[1].signal_composite);
    }
  });

  it('extracts hashtags from item content', async () => {
    const items = Array.from({ length: 3 }, () =>
      makeItem({ content: '#bitcoin is trending right now', coins_mentioned: [] })
    );
    mockQueryItems.mockReturnValue({ items });

    const topics = await engine.discoverTrends(24, 20, 2);

    const hashtagTopic = topics.find(t => t.topic_type === 'hashtag');
    expect(hashtagTopic).toBeDefined();
  });

  it('computes velocity as mentions/hour', async () => {
    const items = Array.from({ length: 12 }, () => makeItem({ coins_mentioned: ['ADA'] }));
    mockQueryItems.mockReturnValue({ items });

    const topics = await engine.discoverTrends(4, 20, 1); // 4-hour window

    const topic = topics.find(t => t.topic === 'ADA');
    expect(topic).toBeDefined();
    // 12 items / 4 hours = 3 mentions/hour
    expect(topic!.velocity).toBeCloseTo(3, 1);
  });

  it('respects topN limit', async () => {
    // Create many coins with ≥2 mentions each
    const coins = ['BTC','ETH','SOL','ADA','DOGE','LINK','DOT','AVAX','MATIC','LTC','UNI','ATOM'];
    const items = coins.flatMap(c =>
      Array.from({ length: 3 }, () => makeItem({ coins_mentioned: [c] }))
    );
    mockQueryItems.mockReturnValue({ items });

    const topics = await engine.discoverTrends(24, 5, 2);
    expect(topics.length).toBeLessThanOrEqual(5);
  });
});
