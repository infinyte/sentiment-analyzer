import { SocialStorageService } from '../../../database/sqlite-social-store';
import type { ScoredSocialItem, TrendingTopicRecord } from '../../../types/social-media';
import { randomUUID } from 'crypto';

function makeItem(overrides: Partial<ScoredSocialItem> = {}): ScoredSocialItem {
  const id = randomUUID();
  return {
    id,
    source: 'reddit',
    source_id: id,
    content: 'Test content about Bitcoin BTC',
    title: 'Test title',
    engagement_likes:    100,
    engagement_shares:   20,
    engagement_comments: 10,
    content_created_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    url: 'https://reddit.com/r/test',
    coins_mentioned: ['BTC'],
    metadata: {},
    sentiment_score:     0.5,
    sentiment_confidence: 0.7,
    score_sentiment:  65,
    score_engagement: 45,
    score_recency:    80,
    score_authority:  40,
    score_composite:  57,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function makeTopic(overrides: Partial<TrendingTopicRecord> = {}): TrendingTopicRecord {
  return {
    id: randomUUID(),
    topic: 'BTC',
    topic_type: 'coin',
    coin_symbol: 'BTC',
    mention_count: 50,
    unique_sources: 3,
    signal_sentiment:  70,
    signal_engagement: 60,
    signal_recency:    80,
    signal_authority:  65,
    signal_composite:  69,
    velocity: 5.2,
    peak_time: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('SocialStorageService', () => {
  let store: SocialStorageService;

  beforeEach(() => {
    store = new SocialStorageService(':memory:');
    store.connect();
  });

  afterEach(() => {
    store.close();
  });

  // ── Items ────────────────────────────────────────────────────────────────────

  describe('upsertItem / getItem', () => {
    it('stores and retrieves an item by id', () => {
      const item = makeItem();
      store.upsertItem(item);
      const retrieved = store.getItem(item.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(item.id);
      expect(retrieved!.content).toBe(item.content);
      expect(retrieved!.coins_mentioned).toEqual(['BTC']);
    });

    it('upserts (updates) on conflict by source+source_id', () => {
      const item = makeItem();
      store.upsertItem(item);
      store.upsertItem({ ...item, score_composite: 99 });
      const rows = store.queryItems({ limit: 10 }).items;
      expect(rows).toHaveLength(1);
      expect(rows[0].score_composite).toBe(99);
    });

    it('returns undefined for unknown id', () => {
      expect(store.getItem('nonexistent')).toBeUndefined();
    });
  });

  describe('upsertItems (bulk)', () => {
    it('stores multiple items in one transaction', () => {
      const items = [makeItem(), makeItem(), makeItem()];
      const count = store.upsertItems(items);
      expect(count).toBe(3);
      expect(store.queryItems({}).total).toBe(3);
    });

    it('returns 0 for empty array', () => {
      expect(store.upsertItems([])).toBe(0);
    });
  });

  describe('queryItems', () => {
    beforeEach(() => {
      store.upsertItems([
        makeItem({ source_id: 'a', coins_mentioned: ['BTC'], score_composite: 80, source: 'twitter' }),
        makeItem({ source_id: 'b', coins_mentioned: ['ETH'], score_composite: 60, source: 'reddit' }),
        makeItem({ source_id: 'c', coins_mentioned: ['BTC'], score_composite: 70, source: 'rss' }),
      ]);
    });

    it('filters by coin', () => {
      const result = store.queryItems({ coin: 'BTC' });
      expect(result.total).toBe(2);
      result.items.forEach(i => expect(i.coins_mentioned).toContain('BTC'));
    });

    it('filters by source', () => {
      const result = store.queryItems({ source: 'reddit' });
      expect(result.total).toBe(1);
      expect(result.items[0].source).toBe('reddit');
    });

    it('sorts by composite score descending', () => {
      const result = store.queryItems({ sort: 'score' });
      expect(result.items[0].score_composite).toBe(80);
      expect(result.items[1].score_composite).toBe(70);
    });

    it('respects limit and offset', () => {
      const p1 = store.queryItems({ limit: 2, offset: 0 });
      const p2 = store.queryItems({ limit: 2, offset: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p2.items).toHaveLength(1);
      expect(p1.total).toBe(3);
    });

    it('filters by minScore', () => {
      const result = store.queryItems({ minScore: 75 });
      expect(result.total).toBe(1);
      expect(result.items[0].score_composite).toBe(80);
    });
  });

  describe('getItemsForCoin', () => {
    it('returns recent items mentioning the coin', () => {
      store.upsertItems([
        makeItem({ source_id: 'x1', coins_mentioned: ['BTC'] }),
        makeItem({ source_id: 'x2', coins_mentioned: ['ETH'] }),
      ]);
      const items = store.getItemsForCoin('BTC', 24);
      expect(items.length).toBeGreaterThanOrEqual(1);
      items.forEach(i => expect(i.coins_mentioned).toContain('BTC'));
    });
  });

  describe('pruneOldItems', () => {
    it('removes items older than retainDays', () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 3_600_000).toISOString();
      store.upsertItems([
        makeItem({ source_id: 'old1', fetched_at: oldDate, content_created_at: oldDate }),
        makeItem({ source_id: 'new1' }),
      ]);
      const pruned = store.pruneOldItems(30);
      expect(pruned).toBe(1);
      expect(store.queryItems({}).total).toBe(1);
    });
  });

  // ── Trending topics ────────────────────────────────────────────────────────

  describe('upsertTrendingTopic / getTrendingTopics', () => {
    it('stores and retrieves trending topics', () => {
      store.upsertTrendingTopic(makeTopic({ topic: 'BTC', signal_composite: 80 }));
      store.upsertTrendingTopic(makeTopic({ topic: 'ETH', coin_symbol: 'ETH', signal_composite: 60 }));

      const topics = store.getTrendingTopics(10);
      expect(topics).toHaveLength(2);
      expect(topics[0].topic).toBe('BTC'); // sorted by composite desc
    });

    it('updates on conflict by topic', () => {
      store.upsertTrendingTopic(makeTopic({ topic: 'BTC', signal_composite: 50 }));
      store.upsertTrendingTopic(makeTopic({ topic: 'BTC', signal_composite: 90 }));

      const topics = store.getTrendingTopics(10);
      expect(topics).toHaveLength(1);
      expect(topics[0].signal_composite).toBe(90);
    });

    it('filters by topic_type', () => {
      store.upsertTrendingTopic(makeTopic({ topic: 'BTC',      topic_type: 'coin' }));
      store.upsertTrendingTopic(makeTopic({ topic: '#bitcoin', topic_type: 'hashtag', coin_symbol: undefined }));

      expect(store.getTrendingTopics(10, 'coin')).toHaveLength(1);
      expect(store.getTrendingTopics(10, 'hashtag')).toHaveLength(1);
    });
  });

  // ── Historical snapshots ───────────────────────────────────────────────────

  describe('saveTrendingSnapshot / getHistoricalSignal', () => {
    it('stores and retrieves snapshots for a coin', () => {
      store.saveTrendingSnapshot('BTC', 72.5);
      store.saveTrendingSnapshot('BTC', 68.0);
      const history = store.getHistoricalSignal('BTC');
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history[0].signal_composite).toBeDefined();
    });

    it('returns empty array for unknown coin', () => {
      expect(store.getHistoricalSignal('ZZZZ')).toEqual([]);
    });
  });

  // ── Source metadata ────────────────────────────────────────────────────────

  describe('upsertSourceMeta / incrementFetchCount / recordSourceError', () => {
    it('stores and retrieves source metadata', () => {
      store.upsertSourceMeta({
        source: 'twitter',
        last_fetch_timestamp: new Date().toISOString(),
        items_fetched_today: 0,
        error_count: 0,
        status: 'healthy',
      });
      const meta = store.getSourceMeta('twitter');
      expect(meta).toBeDefined();
      expect(meta!.status).toBe('healthy');
    });

    it('increments fetch count', () => {
      store.upsertSourceMeta({
        source: 'reddit', last_fetch_timestamp: new Date().toISOString(),
        items_fetched_today: 10, error_count: 0, status: 'healthy',
      });
      store.incrementFetchCount('reddit', 5);
      const meta = store.getSourceMeta('reddit');
      expect(meta!.items_fetched_today).toBe(15);
    });

    it('records source error and sets status', () => {
      store.recordSourceError('twitter', 60);
      const meta = store.getSourceMeta('twitter');
      expect(meta!.status).toBe('error');
      expect(meta!.error_count).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct counts', () => {
      store.upsertItems([makeItem(), makeItem({ source_id: 'y2' })]);
      const stats = store.getStats();
      expect(stats.total_items).toBe(2);
      expect(stats.items_24h).toBe(2);
    });
  });

  // ── Health ────────────────────────────────────────────────────────────────

  describe('isHealthy', () => {
    it('returns true when connected', () => {
      expect(store.isHealthy()).toBe(true);
    });

    it('returns false when not connected', () => {
      const unconnected = new SocialStorageService(':memory:');
      expect(unconnected.isHealthy()).toBe(false);
    });
  });
});
