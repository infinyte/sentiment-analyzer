import { CoinGeckoService } from '../../services/coingecko';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeCoinRaw = (overrides: Record<string, unknown> = {}) => ({
  id: 'bitcoin',
  symbol: 'btc',
  name: 'Bitcoin',
  current_price: 45_000,
  market_cap: 850_000_000_000,
  total_volume: 25_000_000_000,
  price_change_percentage_24h: 2.5,
  price_change_percentage_7d: -3.2,
  high_24h: 46_000,
  low_24h: 44_000,
  market_cap_rank: 1,
  ...overrides,
});

// OHLCV data: [timestamp, open, high, low, close]
const makeOhlcvRaw = () => [
  [1_710_000_000_000, 44_000, 45_500, 43_500, 45_000],
  [1_710_086_400_000, 45_000, 46_200, 44_800, 45_800],
];

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function mockErrorResponse(status: number) {
  return { ok: false, status, json: jest.fn() } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoinGeckoService', () => {
  let service: CoinGeckoService;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    service = new CoinGeckoService();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  // ── getTopCoins ──────────────────────────────────────────────────────────

  // 1.2.1 — Returns correctly mapped Coin objects
  it('getTopCoins: maps raw API data to Coin objects', async () => {
    mockFetch.mockResolvedValue(mockOkResponse([makeCoinRaw()]));

    const coins = await service.getTopCoins();

    expect(coins).toHaveLength(1);
    const coin = coins[0];
    expect(coin.id).toBe('bitcoin');
    expect(coin.name).toBe('Bitcoin');
    expect(coin.price_usd).toBe(45_000);
    expect(coin.market_cap_usd).toBe(850_000_000_000);
    expect(coin.volume_24h_usd).toBe(25_000_000_000);
    expect(coin.price_change_24h_percent).toBe(2.5);
    expect(coin.price_change_7d_percent).toBe(-3.2);
    expect(coin.market_rank).toBe(1);
  });

  // 1.2.2 — Limit parameter is forwarded in the request URL
  it('getTopCoins: passes the limit as per_page in the URL', async () => {
    mockFetch.mockResolvedValue(mockOkResponse([makeCoinRaw()]));

    await service.getTopCoins(10);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('per_page=10'),
      expect.anything()
    );
  });

  // 1.2.3 — Symbol is always uppercase
  it('getTopCoins: uppercases coin symbols', async () => {
    mockFetch.mockResolvedValue(mockOkResponse([makeCoinRaw({ symbol: 'btc' })]));

    const [coin] = await service.getTopCoins();

    expect(coin.symbol).toBe('BTC');
  });

  // 1.2.4 — Volatility calculated from high/low
  it('getTopCoins: calculates volatility_24h from high_24h and low_24h', async () => {
    // (46000 - 44000) / 45000 * 100 ≈ 4.44%
    mockFetch.mockResolvedValue(
      mockOkResponse([makeCoinRaw({ high_24h: 46_000, low_24h: 44_000, current_price: 45_000 })])
    );

    const [coin] = await service.getTopCoins();

    expect(coin.volatility_24h).toBeCloseTo(4.44, 1);
  });

  // 1.2.5 — Volatility is 0 when current_price is null/zero
  it('getTopCoins: sets volatility_24h to 0 when current_price is falsy', async () => {
    mockFetch.mockResolvedValue(
      mockOkResponse([makeCoinRaw({ current_price: 0, high_24h: 100, low_24h: 90 })])
    );

    const [coin] = await service.getTopCoins();

    expect(coin.volatility_24h).toBe(0);
  });

  // 1.2.6 — Falls back to current_price for missing high_24h / low_24h
  it('getTopCoins: volatility is 0 when high/low are absent (equal to price)', async () => {
    mockFetch.mockResolvedValue(
      mockOkResponse([makeCoinRaw({ high_24h: null, low_24h: null, current_price: 45_000 })])
    );

    const [coin] = await service.getTopCoins();

    // high = price, low = price → (0 / price) * 100 = 0
    expect(coin.volatility_24h).toBe(0);
  });

  // 1.2.7 — Default sentiment is NEUTRAL with zero confidence
  it('getTopCoins: default sentiment_score is NEUTRAL', async () => {
    mockFetch.mockResolvedValue(mockOkResponse([makeCoinRaw()]));

    const [coin] = await service.getTopCoins();

    expect(coin.sentiment_score).toBe('NEUTRAL');
    expect(coin.sentiment_confidence).toBe(0);
    expect(coin.sentiment_summary).toBe('');
  });

  // 1.2.8 — market_rank falls back to 999 when absent
  it('getTopCoins: falls back to market_rank 999 when missing', async () => {
    mockFetch.mockResolvedValue(
      mockOkResponse([makeCoinRaw({ market_cap_rank: null })])
    );

    const [coin] = await service.getTopCoins();

    expect(coin.market_rank).toBe(999);
  });

  // 1.2.9 — HTTP error response throws
  it('getTopCoins: throws when the API returns a non-ok status', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(429));

    await expect(service.getTopCoins()).rejects.toThrow('CoinGecko API error: 429');
  });

  // 1.2.10 — Network error propagates
  it('getTopCoins: throws on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await expect(service.getTopCoins()).rejects.toThrow('Network failure');
  });

  // ── getCoinHistory ───────────────────────────────────────────────────────

  // 1.2.11 — Maps OHLCV array to structured objects
  it('getCoinHistory: maps raw OHLCV tuples to structured objects', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeOhlcvRaw()));

    const history = await service.getCoinHistory('bitcoin', 7);

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      open: 44_000,
      high: 45_500,
      low: 43_500,
      close: 45_000,
    });
    expect(history[0].timestamp).toBeInstanceOf(Date);
  });

  // 1.2.12 — Default days parameter is 7
  it('getCoinHistory: uses days=7 in the URL by default', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeOhlcvRaw()));

    await service.getCoinHistory('bitcoin');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('days=7'),
      expect.anything()
    );
  });

  // 1.2.13 — Returns empty array on error instead of throwing
  it('getCoinHistory: returns [] on non-ok response without throwing', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const history = await service.getCoinHistory('bitcoin', 7);

    expect(history).toEqual([]);
  });
});
