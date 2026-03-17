import { ContentSignalService } from '../../services/content-signals';
import { NewsAPIService } from '../../services/newsapi';

function mockOkResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

describe('ContentSignalService', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    delete process.env.X_BEARER_TOKEN;
    delete process.env.TWITTER_BEARER_TOKEN;
  });

  it('normalizes per-item scores and source breakdown across adapters', async () => {
    const now = Date.now();
    const recentIso = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const olderIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({
          articles: [
            {
              title: 'Bitcoin rally continues after major adoption news',
              description: 'Bullish momentum remains intact.',
              url: 'https://example.com/news',
              source: { name: 'CoinDesk' },
              publishedAt: recentIso,
            },
          ],
        }));
      }

      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({
          data: {
            children: [
              {
                data: {
                  id: 'abc123',
                  title: 'BTC breakout discussion',
                  selftext: 'Traders expect more upside after strong flows.',
                  permalink: '/r/crypto/comments/abc123/btc_breakout_discussion/',
                  author: 'satoshi',
                  created_utc: Math.floor(new Date(olderIso).getTime() / 1000),
                  score: 120,
                  num_comments: 45,
                },
              },
            ],
          },
        }));
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Bitcoin', 'BTC', 7);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      title: expect.stringMatching(/Bitcoin|BTC/),
      source: expect.stringMatching(/newsapi|reddit/),
    });
    expect(result.items.every(item => typeof item.sentiment_score === 'number')).toBe(true);
    expect(result.sourceBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'newsapi', item_count: 1 }),
        expect.objectContaining({ source: 'reddit', item_count: 1 }),
      ])
    );
    expect(result.collectionStats.total_items).toBe(2);
    expect(result.collectionStats.source_count).toBe(2);
    expect(result.collectionStats.trending_score).toBeGreaterThan(0);
    expect(result.aggregateScore).toBeGreaterThan(0);
  });

  it('returns empty signals cleanly when every source is unavailable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: jest.fn() } as unknown as Response);

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Bitcoin', 'BTC', 7);

    expect(result.items).toEqual([]);
    expect(result.sourceBreakdown).toEqual([]);
    expect(result.aggregateScore).toBe(0);
    expect(result.collectionStats).toMatchObject({
      total_items: 0,
      source_count: 0,
      trending_score: 0,
    });
  });
});