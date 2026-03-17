import { clusterTrendingTopicsForResponse } from '../../routes/social-media';
import type { TrendingTopicRecord } from '../../types/social-media';

describe('clusterTrendingTopicsForResponse', () => {
  it('clusters related topics that share the same coin symbol', () => {
    const topics: TrendingTopicRecord[] = [
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
        last_updated: '2026-03-17T12:00:00.000Z',
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
        last_updated: '2026-03-17T12:05:00.000Z',
        created_at: '2026-03-17T09:30:00.000Z',
      },
    ];

    const clustered = clusterTrendingTopicsForResponse(topics);

    expect(clustered).toHaveLength(1);
    expect(clustered[0]).toMatchObject({
      topic: 'BTC',
      coin_symbol: 'BTC',
      mention_count: 8,
      cluster_size: 2,
      clustered_topics: ['#bitcoin', 'BTC'],
    });
  });
});