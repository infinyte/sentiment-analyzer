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

  // ── ABSA: targetCoin context window (Issue #3) ──────────────────────────────

  it('sets context_window_used=true on items that mention the targetCoin', async () => {
    const now = Date.now();
    const recentIso = new Date(now - 1 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({
          articles: [
            {
              title: 'BTC rallies while ETH faces regulatory uncertainty',
              description: 'Bitcoin adoption drives price up as Ethereum struggles with new rules.',
              url: 'https://example.com/multi-coin',
              source: { name: 'CoinDesk' },
              publishedAt: recentIso,
            },
          ],
        }));
      }
      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({ data: { children: [] } }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    // Pass 'BTC' as targetCoin — the article mentions BTC so ABSA window should activate
    const result = await service.collect('Bitcoin', 'BTC', 7, 'BTC');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].context_window_used).toBe(true);
  });

  it('sets context_window_used=false when targetCoin not mentioned in item', async () => {
    const now = Date.now();
    const recentIso = new Date(now - 1 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({
          articles: [
            {
              title: 'General market outlook is uncertain',
              description: 'Analysts provide a broad overview without mentioning specific coins.',
              url: 'https://example.com/general',
              source: { name: 'CryptoNews' },
              publishedAt: recentIso,
            },
          ],
        }));
      }
      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({ data: { children: [] } }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Solana', 'SOL', 7, 'SOL');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].context_window_used).toBe(false);
  });

  // Long article: BTC in the first 50 tokens (positive), ETH after token 70 (negative).
  // The ±50 window for BTC should not capture the ETH-negative section, yielding a
  // positive score for BTC and a negative score for ETH on the same article.
  const LONG_ARTICLE_DESCRIPTION =
    'btc breakout continues with growth accumulated by institutional investors ' +
    'the market price action in crypto space has been observed through careful analysis ' +
    'during recent trading sessions by participants in the crypto market ' +
    'the current market environment indicates several factors at play while volatility remains ' +
    'moderate and participants await clarity market observers note that conditions differ ' +
    'significantly across different assets as price discovery continues throughout the ' +
    'quarter leading up to developments eth drop decline bearish ban liquidation outflow';

  it('BTC-targeted window isolates positive BTC context from negative ETH section', async () => {
    const recentIso = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({
          articles: [{
            title: 'BTC rally surge bullish adoption record high gains',
            description: LONG_ARTICLE_DESCRIPTION,
            url: 'https://example.com/long-btc',
            source: { name: 'CoinDesk' },
            publishedAt: recentIso,
          }],
        }));
      }
      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({ data: { children: [] } }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Bitcoin', 'BTC', 7, 'BTC');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].context_window_used).toBe(true);
    // BTC window (tokens 0–50) contains only positive terms; ETH crash section is out of range.
    expect(result.items[0].sentiment_score).toBeGreaterThan(0);
  });

  it('ETH-targeted window isolates negative ETH context from positive BTC section', async () => {
    const recentIso = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({
          articles: [{
            title: 'BTC rally surge bullish adoption record high gains',
            description: LONG_ARTICLE_DESCRIPTION,
            url: 'https://example.com/long-eth',
            source: { name: 'CoinDesk' },
            publishedAt: recentIso,
          }],
        }));
      }
      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({ data: { children: [] } }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Ethereum', 'ETH', 7, 'ETH');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].context_window_used).toBe(true);
    // ETH window (tokens 28–84) contains only negative terms; the BTC positive section is cut off.
    expect(result.items[0].sentiment_score).toBeLessThan(0);
  });

  it('Reddit multi-coin post activates context window for the requested target coin', async () => {
    const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('newsapi.org')) {
        return Promise.resolve(mockOkResponse({ articles: [] }));
      }
      if (url.includes('reddit.com')) {
        return Promise.resolve(mockOkResponse({
          data: {
            children: [{
              data: {
                id: 'multi001',
                title: 'BTC surge rally while ETH faces bearish pressure',
                selftext: 'Bullish on BTC adoption, but ETH drop is concerning to many traders.',
                permalink: '/r/crypto/comments/multi001/',
                author: 'trader99',
                created_utc: Math.floor(new Date(recentIso).getTime() / 1000),
                score: 50,
                num_comments: 10,
              },
            }],
          },
        }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new ContentSignalService(new NewsAPIService('test-key'));
    const result = await service.collect('Bitcoin', 'BTC', 7, 'BTC');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe('reddit');
    // BTC is mentioned in the Reddit post title, so the ABSA window fires.
    expect(result.items[0].context_window_used).toBe(true);
  });
});