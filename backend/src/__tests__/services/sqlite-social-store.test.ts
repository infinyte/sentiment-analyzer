import { SocialStorageService } from '../../database/sqlite-social-store';
import type { ScoredSocialItem } from '../../types/social-media';

function makeItem(overrides: Partial<ScoredSocialItem> = {}): ScoredSocialItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: overrides.source ?? 'reddit',
    source_id: overrides.source_id ?? `src-${Math.random()}`,
    content: overrides.content ?? 'Bitcoin discussion',
    title: overrides.title,
    author: overrides.author,
    author_followers: overrides.author_followers,
    engagement_likes: overrides.engagement_likes ?? 10,
    engagement_shares: overrides.engagement_shares ?? 2,
    engagement_comments: overrides.engagement_comments ?? 3,
    engagement_views: overrides.engagement_views,
    content_created_at: overrides.content_created_at ?? new Date().toISOString(),
    fetched_at: overrides.fetched_at ?? new Date().toISOString(),
    url: overrides.url ?? 'https://example.com/item',
    coins_mentioned: overrides.coins_mentioned ?? ['BTC'],
    metadata: overrides.metadata ?? {},
    sentiment_score: overrides.sentiment_score ?? 0.5,
    sentiment_confidence: overrides.sentiment_confidence ?? 0.8,
    score_sentiment: overrides.score_sentiment ?? 70,
    score_engagement: overrides.score_engagement ?? 55,
    score_recency: overrides.score_recency ?? 90,
    score_authority: overrides.score_authority ?? 45,
    score_composite: overrides.score_composite ?? 80,
    last_updated: overrides.last_updated ?? new Date().toISOString(),
  };
}

describe('SocialStorageService queryItems', () => {
  let store: SocialStorageService;

  beforeEach(() => {
    store = new SocialStorageService(':memory:');
    store.connect();
  });

  afterEach(() => {
    store.close();
  });

  it('supports keyset cursor pagination for high-volume item queries', () => {
    // Timestamps must be relative to "now": queryItems filters on
    // `fetched_at >= datetime('now', '-sinceHours hours')`, so fixed past dates
    // drift out of the window as the wall clock advances (and the test flakes).
    // Only the recency ordering (a newest → c oldest) matters here.
    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
    store.upsertItems([
      makeItem({ id: 'a', source_id: 'a', fetched_at: hoursAgo(0), content_created_at: hoursAgo(0), score_composite: 95 }),
      makeItem({ id: 'b', source_id: 'b', fetched_at: hoursAgo(1), content_created_at: hoursAgo(1), score_composite: 90 }),
      makeItem({ id: 'c', source_id: 'c', fetched_at: hoursAgo(2), content_created_at: hoursAgo(2), score_composite: 85 }),
    ]);

    const firstPage = store.queryItems({ sort: 'recency', limit: 2, sinceHours: 999 });

    expect(firstPage.items.map(item => item.id)).toEqual(['a', 'b']);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = store.queryItems({ sort: 'recency', limit: 2, sinceHours: 999, cursor: firstPage.nextCursor });

    expect(secondPage.items.map(item => item.id)).toEqual(['c']);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});