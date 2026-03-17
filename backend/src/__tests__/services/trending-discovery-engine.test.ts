jest.mock('../../database/sqlite-social-store.js', () => ({
  socialStore: {
    queryItems: jest.fn(),
    upsertTrendingTopic: jest.fn(),
    saveTrendingSnapshot: jest.fn(),
  },
}));

import { socialStore } from '../../database/sqlite-social-store';
import { TrendingTopicDiscoveryEngine } from '../../services/social-media/trending/trending-discovery-engine';
import type { ScoredSocialItem } from '../../types/social-media';

function makeItem(): ScoredSocialItem {
  return {
    id: 'item-1',
    source: 'reddit',
    source_id: 'post-1',
    content: 'Bitcoin halving conversation is heating up #bitcoin',
    title: 'Bitcoin halving setup',
    author: 'trader',
    author_followers: 1000,
    engagement_likes: 25,
    engagement_shares: 4,
    engagement_comments: 10,
    content_created_at: '2026-03-17T11:30:00.000Z',
    fetched_at: '2026-03-17T11:45:00.000Z',
    url: 'https://example.com/post-1',
    coins_mentioned: ['BTC'],
    metadata: {},
    sentiment_score: 0.6,
    sentiment_confidence: 0.9,
    score_sentiment: 75,
    score_engagement: 65,
    score_recency: 88,
    score_authority: 55,
    score_composite: 81,
    last_updated: '2026-03-17T11:45:00.000Z',
  };
}

describe('TrendingTopicDiscoveryEngine', () => {
  const mockedStore = jest.mocked(socialStore);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedStore.queryItems.mockReturnValue({ items: [makeItem()], total: 1, limit: 5000, offset: 0 });
  });

  it('persists keyword topics and tags coin-related hashtags with a coin symbol', async () => {
    const engine = new TrendingTopicDiscoveryEngine();
    const topics = await engine.discoverTrends(24, 20, 1);

    expect(topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: 'BTC', topic_type: 'coin', coin_symbol: 'BTC' }),
        expect.objectContaining({ topic: '#bitcoin', topic_type: 'hashtag', coin_symbol: 'BTC' }),
        expect.objectContaining({ topic: 'halving', topic_type: 'keyword' }),
      ])
    );
    expect(mockedStore.upsertTrendingTopic).toHaveBeenCalled();
    expect(mockedStore.saveTrendingSnapshot).toHaveBeenCalledWith('BTC', expect.any(Number));
  });
});