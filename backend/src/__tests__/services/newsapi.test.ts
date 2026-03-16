import { NewsAPIService } from '../../services/newsapi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArticles(titles: string[]) {
  return {
    status: 'ok',
    totalResults: titles.length,
    articles: titles.map((title) => ({ title, description: '', url: '' })),
  };
}

function mockOkResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

function mockErrorResponse(status: number) {
  return { ok: false, status, json: jest.fn() } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewsAPIService', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  // 1.3.1 — Returns article titles as plain strings
  it('returns an array of headline strings', async () => {
    const titles = ['BTC hits 50k', 'Bitcoin ETF approved'];
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles(titles)));

    const service = new NewsAPIService('test-key');
    const headlines = await service.getHeadlines('BTC', 3);

    expect(headlines).toEqual(titles);
  });

  // 1.3.2 — Caps results at 20
  it('limits results to at most 20 articles', async () => {
    const titles = Array.from({ length: 30 }, (_, i) => `Headline ${i}`);
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles(titles)));

    const service = new NewsAPIService('test-key');
    const headlines = await service.getHeadlines('BTC', 3);

    expect(headlines).toHaveLength(20);
  });

  // 1.3.3 — Encodes the topic in the URL
  it('URL-encodes the search topic', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles([])));

    const service = new NewsAPIService('test-key');
    await service.getHeadlines('ETH Ethereum', 3);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('ETH%20Ethereum'),
      expect.anything()
    );
  });

  // 1.3.4 — Include a `from` date parameter
  it('includes a from date parameter derived from the days argument', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles([])));

    const service = new NewsAPIService('test-key');
    const days = 5;
    const expectedFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    await service.getHeadlines('BTC', days);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`from=${expectedFrom}`),
      expect.anything()
    );
  });

  // 1.3.5 — Returns [] on non-ok response
  it('returns [] when the API response is not ok', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(429));

    const service = new NewsAPIService('test-key');
    const headlines = await service.getHeadlines('BTC', 3);

    expect(headlines).toEqual([]);
  });

  // 1.3.6 — Returns [] on network error
  it('returns [] on network/fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new NewsAPIService('test-key');
    const headlines = await service.getHeadlines('BTC', 3);

    expect(headlines).toEqual([]);
  });

  // 1.3.7 — Returns [] when articles array is empty
  it('returns [] when the articles array is empty', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles([])));

    const service = new NewsAPIService('test-key');
    const headlines = await service.getHeadlines('BTC', 3);

    expect(headlines).toEqual([]);
  });

  // 1.3.8 — Constructor apiKey appears in the request URL
  it('includes the constructor-injected API key in the URL', async () => {
    const key = 'my-secret-key';
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles([])));

    const service = new NewsAPIService(key);
    await service.getHeadlines('BTC', 3);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(`apiKey=${key}`),
      expect.anything()
    );
  });

  // 1.3.9 — Constructor injection overrides process.env
  it('constructor apiKey takes precedence over process.env', async () => {
    process.env.NEWSAPI_API_KEY = 'env-key';
    mockFetch.mockResolvedValue(mockOkResponse(makeArticles([])));

    const service = new NewsAPIService('override-key');
    await service.getHeadlines('BTC', 3);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('apiKey=override-key'),
      expect.anything()
    );
    delete process.env.NEWSAPI_API_KEY;
  });
});
