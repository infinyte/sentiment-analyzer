/**
 * MultiSourceTrendingScoreCalculator tests
 */

import { randomUUID } from 'crypto';
import type { ScoredSocialItem } from '../../../types/social-media';

// ── Mock store ────────────────────────────────────────────────────────────────

const mockGetItemsForCoin   = jest.fn();
const mockGetHistoricalSignal = jest.fn();

jest.mock('../../../database/sqlite-social-store', () => ({
  socialStore: {
    getItemsForCoin:       mockGetItemsForCoin,
    getHistoricalSignal:   mockGetHistoricalSignal,
  },
}));

import { MultiSourceTrendingScoreCalculator } from '../../../services/social-media/trending/multi-source-calculator';

// ── Helper ────────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ScoredSocialItem> = {}): ScoredSocialItem {
  return {
    id: randomUUID(),
    source: 'twitter',
    source_id: randomUUID(),
    content: 'BTC to the moon',
    engagement_likes: 500,
    engagement_shares: 100,
    engagement_comments: 50,
    content_created_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    url: 'https://x.com/status/1',
    coins_mentioned: ['BTC'],
    metadata: {},
    sentiment_score: 0.8,
    sentiment_confidence: 0.75,
    score_sentiment:  80,
    score_engagement: 65,
    score_recency:    90,
    score_authority:  50,
    score_composite:  72,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MultiSourceTrendingScoreCalculator', () => {
  let calc: MultiSourceTrendingScoreCalculator;

  beforeEach(() => {
    calc = new MultiSourceTrendingScoreCalculator();
    mockGetItemsForCoin.mockReset();
    mockGetHistoricalSignal.mockReset().mockReturnValue([]);
  });

  // ── Empty / no data ────────────────────────────────────────────────────────

  it('returns a valid empty report when no items exist', async () => {
    mockGetItemsForCoin.mockReturnValue([]);
    const report = await calc.calculate('BTC', 24);

    expect(report.symbol).toBe('BTC');
    expect(report.mention_count_24h).toBe(0);
    expect(report.trend_direction).toBe('NEUTRAL');
    expect(report.trend_strength).toBe('WEAK');
    expect(report.signal_composite).toBe(0);
  });

  // ── Signal computation ─────────────────────────────────────────────────────

  it('computes signal averages from items', async () => {
    const items = [
      makeItem({ score_sentiment: 80, score_engagement: 60, score_authority: 50, score_recency: 90 }),
      makeItem({ score_sentiment: 70, score_engagement: 70, score_authority: 60, score_recency: 85 }),
    ];
    mockGetItemsForCoin.mockReturnValue(items);
    const report = await calc.calculate('BTC', 24);

    expect(report.signal_sentiment).toBeCloseTo(75, 0);
    expect(report.signal_engagement).toBeCloseTo(65, 0);
    expect(report.mention_count_24h).toBe(2);
  });

  // ── Trend direction ────────────────────────────────────────────────────────

  it('classifies BULLISH when sentiment > 65', async () => {
    mockGetItemsForCoin.mockReturnValue([makeItem({ score_sentiment: 80 })]);
    const report = await calc.calculate('ETH', 24);
    expect(report.trend_direction).toBe('BULLISH');
  });

  it('classifies BEARISH when sentiment < 40', async () => {
    mockGetItemsForCoin.mockReturnValue([makeItem({ score_sentiment: 20 })]);
    const report = await calc.calculate('ETH', 24);
    expect(report.trend_direction).toBe('BEARISH');
  });

  it('classifies NEUTRAL when sentiment is between 40 and 65', async () => {
    mockGetItemsForCoin.mockReturnValue([makeItem({ score_sentiment: 52 })]);
    const report = await calc.calculate('ETH', 24);
    expect(report.trend_direction).toBe('NEUTRAL');
  });

  // ── Trend strength ─────────────────────────────────────────────────────────

  it('classifies STRONG when composite > 75', async () => {
    const items = Array.from({ length: 20 }, () =>
      makeItem({ score_sentiment: 90, score_engagement: 85, score_authority: 70, score_recency: 95 })
    );
    mockGetItemsForCoin.mockReturnValue(items);
    const report = await calc.calculate('BTC', 24);
    expect(['STRONG', 'MODERATE']).toContain(report.trend_strength);
  });

  it('classifies WEAK when composite ≤ 50', async () => {
    mockGetItemsForCoin.mockReturnValue([
      makeItem({ score_sentiment: 50, score_engagement: 10, score_authority: 20, score_recency: 15 }),
    ]);
    const report = await calc.calculate('BTC', 24);
    expect(report.trend_strength).toBe('WEAK');
  });

  // ── Velocity ──────────────────────────────────────────────────────────────

  it('calculates velocity as mentions/hour', async () => {
    const items = Array.from({ length: 48 }, () => makeItem()); // 48 items, 24h window
    mockGetItemsForCoin.mockReturnValue(items);
    const report = await calc.calculate('BTC', 24);
    expect(report.velocity).toBeCloseTo(2, 1); // 48 / 24 = 2 per hour
  });

  // ── Source breakdown ──────────────────────────────────────────────────────

  it('builds correct source breakdown', async () => {
    mockGetItemsForCoin.mockReturnValue([
      makeItem({ source: 'twitter' }),
      makeItem({ source: 'twitter' }),
      makeItem({ source: 'reddit' }),
    ]);
    const report = await calc.calculate('BTC', 24);

    const twitterBreakdown = report.top_sources.find(s => s.source === 'twitter');
    const redditBreakdown  = report.top_sources.find(s => s.source === 'reddit');
    expect(twitterBreakdown!.mentions).toBe(2);
    expect(redditBreakdown!.mentions).toBe(1);
    expect(report.unique_sources).toBe(2);
  });

  // ── Sentiment distribution ────────────────────────────────────────────────

  it('computes sentiment distribution correctly', async () => {
    mockGetItemsForCoin.mockReturnValue([
      makeItem({ score_sentiment: 80 }), // BULL
      makeItem({ score_sentiment: 80 }), // BULL
      makeItem({ score_sentiment: 50 }), // NEUTRAL
      makeItem({ score_sentiment: 20 }), // BEAR
    ]);
    const report = await calc.calculate('BTC', 24);
    expect(report.sentiment_distribution.BULL).toBe(50);
    expect(report.sentiment_distribution.NEUTRAL).toBe(25);
    expect(report.sentiment_distribution.BEAR).toBe(25);
  });

  // ── Historical comparison ─────────────────────────────────────────────────

  it('sets acceleration to accelerating when current > 24h-ago by more than 5', async () => {
    mockGetItemsForCoin.mockReturnValue(
      Array.from({ length: 5 }, () => makeItem({ score_sentiment: 80, score_engagement: 80, score_authority: 70, score_recency: 90 }))
    );
    // Snapshot from ~25 hours ago with a much lower score
    const oldTime = new Date(Date.now() - 25 * 3_600_000).toISOString();
    mockGetHistoricalSignal.mockReturnValue([{ snapshot_time: oldTime, signal_composite: 30 }]);

    const report = await calc.calculate('BTC', 24);
    expect(report.comparison.score_24h_ago).toBe(30);
    expect(report.comparison.trend_acceleration).toBe('accelerating');
  });

  it('sets acceleration to decelerating when score dropped by more than 5', async () => {
    mockGetItemsForCoin.mockReturnValue([
      makeItem({ score_sentiment: 30, score_engagement: 10, score_authority: 20, score_recency: 10 }),
    ]);
    const oldTime = new Date(Date.now() - 25 * 3_600_000).toISOString();
    mockGetHistoricalSignal.mockReturnValue([{ snapshot_time: oldTime, signal_composite: 80 }]);

    const report = await calc.calculate('BTC', 24);
    expect(report.comparison.trend_acceleration).toBe('decelerating');
  });

  // ── Top items ─────────────────────────────────────────────────────────────

  it('returns at most 5 recent_items', async () => {
    const items = Array.from({ length: 10 }, () => makeItem());
    mockGetItemsForCoin.mockReturnValue(items);
    const report = await calc.calculate('BTC', 24);
    expect(report.recent_items.length).toBeLessThanOrEqual(5);
  });

  it('truncates item content to 200 chars in recent_items', async () => {
    const longContent = 'X'.repeat(500);
    mockGetItemsForCoin.mockReturnValue([makeItem({ content: longContent })]);
    const report = await calc.calculate('BTC', 24);
    report.recent_items.forEach(i => expect(i.content.length).toBeLessThanOrEqual(200));
  });

  // ── Symbol normalisation ──────────────────────────────────────────────────

  it('uppercases the symbol in the report', async () => {
    mockGetItemsForCoin.mockReturnValue([]);
    const report = await calc.calculate('btc', 24);
    expect(report.symbol).toBe('BTC');
  });
});
