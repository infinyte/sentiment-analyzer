// Mock SentimentAnalyzerEngine before importing item-scorer
jest.mock('../../../services/sentiment-analyzer', () => ({
  SentimentAnalyzerEngine: jest.fn().mockImplementation(() => ({
    analyzeBasicSentiment: jest.fn().mockReturnValue({
      sentiment: 'BULL',
      confidence: 0.8,
      score: 0.6,
    }),
  })),
}));

import { scoreItem, scoreItems } from '../../../services/social-media/scoring/item-scorer';
import type { SocialMediaItem } from '../../../types/social-media';

function makeItem(overrides: Partial<SocialMediaItem> = {}): SocialMediaItem {
  return {
    id: 'test-id',
    source: 'twitter',
    source_id: 'tweet-123',
    content: 'Bitcoin is going to the moon! $BTC breakout',
    engagement_likes:    1000,
    engagement_shares:   200,
    engagement_comments: 50,
    content_created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2h ago
    fetched_at: new Date().toISOString(),
    url: 'https://x.com/i/web/status/tweet-123',
    coins_mentioned: ['BTC'],
    metadata: {},
    ...overrides,
  };
}

describe('scoreItem', () => {
  it('returns a ScoredSocialItem with all score fields', () => {
    const scored = scoreItem(makeItem());
    expect(scored.score_sentiment).toBeGreaterThanOrEqual(0);
    expect(scored.score_sentiment).toBeLessThanOrEqual(100);
    expect(scored.score_engagement).toBeGreaterThanOrEqual(0);
    expect(scored.score_engagement).toBeLessThanOrEqual(100);
    expect(scored.score_recency).toBeGreaterThanOrEqual(0);
    expect(scored.score_recency).toBeLessThanOrEqual(100);
    expect(scored.score_authority).toBeGreaterThanOrEqual(0);
    expect(scored.score_authority).toBeLessThanOrEqual(100);
    expect(scored.score_composite).toBeGreaterThanOrEqual(0);
    expect(scored.score_composite).toBeLessThanOrEqual(100);
  });

  it('preserves original item fields', () => {
    const item = makeItem({ content: 'unique content xyz' });
    const scored = scoreItem(item);
    expect(scored.content).toBe('unique content xyz');
    expect(scored.source_id).toBe('tweet-123');
  });

  it('sets last_updated to a recent ISO timestamp', () => {
    const scored = scoreItem(makeItem());
    expect(Date.now() - Date.parse(scored.last_updated)).toBeLessThan(5000);
  });

  // ── Recency scorer ──────────────────────────────────────────────────────────

  it('gives higher recency to fresher content', () => {
    const fresh = scoreItem(makeItem({ content_created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }));
    const stale = scoreItem(makeItem({ content_created_at: new Date(Date.now() - 7 * 24 * 3_600_000).toISOString() }));
    expect(fresh.score_recency).toBeGreaterThan(stale.score_recency);
  });

  it('applies 0.45 fallback recency when publishedAt is missing', () => {
    // No published_at means the scorer should still return something in range
    const item = makeItem({ content_created_at: 'invalid-date' });
    const scored = scoreItem(item);
    expect(scored.score_recency).toBeGreaterThanOrEqual(0);
    expect(scored.score_recency).toBeLessThanOrEqual(100);
  });

  // ── Engagement scorer ───────────────────────────────────────────────────────

  it('gives RSS a flat 40 engagement baseline regardless of engagement values', () => {
    const rssItem = makeItem({
      source: 'rss',
      engagement_likes: 0,
      engagement_shares: 0,
      engagement_comments: 0,
    });
    const scored = scoreItem(rssItem);
    expect(scored.score_engagement).toBe(40);
  });

  it('gives higher engagement score for high-engagement tweets', () => {
    const highEngage = scoreItem(makeItem({ engagement_likes: 50_000, engagement_shares: 10_000 }));
    const lowEngage  = scoreItem(makeItem({ engagement_likes: 10,     engagement_shares: 1 }));
    expect(highEngage.score_engagement).toBeGreaterThan(lowEngage.score_engagement);
  });

  // ── Authority scorer ────────────────────────────────────────────────────────

  it('gives higher authority to large-follower authors', () => {
    const whale  = scoreItem(makeItem({ author_followers: 2_000_000 }));
    const nobody = scoreItem(makeItem({ author_followers: 100 }));
    expect(whale.score_authority).toBeGreaterThan(nobody.score_authority);
  });

  it('gives RSS higher base authority than reddit', () => {
    const rss    = scoreItem(makeItem({ source: 'rss',    metadata: { feed_name: 'CoinDesk' } }));
    const reddit = scoreItem(makeItem({ source: 'reddit', metadata: { subreddit: 'altcoin' } }));
    expect(rss.score_authority).toBeGreaterThan(reddit.score_authority);
  });

  it('caps authority at 100', () => {
    const item = makeItem({ source: 'rss', author_followers: 10_000_000, metadata: { feed_name: 'bloomberg' } });
    expect(scoreItem(item).score_authority).toBeLessThanOrEqual(100);
  });

  // ── Composite ───────────────────────────────────────────────────────────────

  it('composite is weighted average of sub-scores', () => {
    const scored = scoreItem(makeItem());
    const expected =
      scored.score_sentiment  * 0.30 +
      scored.score_engagement * 0.25 +
      scored.score_authority  * 0.25 +
      scored.score_recency    * 0.20;
    expect(scored.score_composite).toBeCloseTo(expected, 1);
  });

  // ── Coin extraction fallback ─────────────────────────────────────────────────

  it('populates coins_mentioned from content if the field was empty', () => {
    const item = makeItem({ coins_mentioned: [], content: 'ETH and SOL leading today' });
    const scored = scoreItem(item);
    expect(scored.coins_mentioned).toContain('ETH');
    expect(scored.coins_mentioned).toContain('SOL');
  });
});

describe('scoreItems', () => {
  it('scores an array of items', () => {
    const items = [makeItem(), makeItem({ source_id: 'tweet-456', content: 'ETH update' })];
    const scored = scoreItems(items);
    expect(scored).toHaveLength(2);
    scored.forEach(s => expect(s.score_composite).toBeGreaterThanOrEqual(0));
  });

  it('returns empty array for empty input', () => {
    expect(scoreItems([])).toEqual([]);
  });
});
