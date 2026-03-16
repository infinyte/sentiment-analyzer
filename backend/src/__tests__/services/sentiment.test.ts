import { SentimentService } from '../../services/sentiment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaudeResponse(analysis: object) {
  return {
    id: 'msg_test',
    type: 'message',
    content: [{ type: 'text', text: JSON.stringify(analysis) }],
    model: 'claude-opus-4-1-20250805',
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

const BULL_ANALYSIS = {
  sentiment_score: 'BULL',
  confidence: 0.85,
  summary: 'Strong upward momentum',
  key_catalysts: ['ETF approval', 'institutional buying'],
  risk_factors: ['regulatory uncertainty'],
  price_target_7d: 52_000,
  volatility_warning: false,
};

const BEAR_ANALYSIS = {
  sentiment_score: 'BEAR',
  confidence: 0.72,
  summary: 'Bearish pressure building',
  key_catalysts: ['market sell-off'],
  risk_factors: ['liquidity crunch', 'leverage unwind'],
  price_target_7d: 38_000,
  volatility_warning: true,
};

const NEUTRAL_ANALYSIS = {
  sentiment_score: 'NEUTRAL',
  confidence: 0.5,
  summary: 'No clear direction',
  key_catalysts: ['consolidation'],
  risk_factors: ['low volume'],
  price_target_7d: 45_000,
  volatility_warning: false,
};

function mockOkResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

function mockErrorResponse(status: number) {
  return { ok: false, status, json: jest.fn() } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SentimentService', () => {
  let service: SentimentService;
  let mockFetch: jest.Mock;

  const HEADLINES = ['BTC breaks 45k', 'ETF volume soars'];
  const PRICE_CHANGE = 3.5;
  const VOLATILITY = 4.44;

  beforeEach(() => {
    service = new SentimentService('test-claude-key');
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  // 1.4.1 — Returns BULL sentiment
  it('returns BULL sentiment when Claude responds with BULL', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BULL_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('BULL');
  });

  // 1.4.2 — Returns NEUTRAL sentiment
  it('returns NEUTRAL sentiment when Claude responds with NEUTRAL', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(NEUTRAL_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('NEUTRAL');
  });

  // 1.4.3 — Returns BEAR sentiment
  it('returns BEAR sentiment when Claude responds with BEAR', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BEAR_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('BEAR');
  });

  // 1.4.4 — Confidence is a number between 0 and 1
  it('confidence is a number between 0 and 1 inclusive', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BULL_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  // 1.4.5 — key_catalysts is an array
  it('key_catalysts is an array', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BULL_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(Array.isArray(result.key_catalysts)).toBe(true);
  });

  // 1.4.6 — risk_factors is an array
  it('risk_factors is an array', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BEAR_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(Array.isArray(result.risk_factors)).toBe(true);
  });

  // 1.4.7 — symbol in response matches the input
  it('symbol in the result matches the input symbol', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BULL_ANALYSIS)));

    const result = await service.analyzeSentiment('ETH', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.symbol).toBe('ETH');
  });

  // 1.4.8 — analysis_date is today's ISO date (YYYY-MM-DD)
  it('analysis_date is today in YYYY-MM-DD format', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(NEUTRAL_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);
    const today = new Date().toISOString().split('T')[0];

    expect(result.analysis_date).toBe(today);
  });

  // 1.4.9 — Returns NEUTRAL when Claude returns invalid JSON
  it('returns NEUTRAL sentiment when Claude response contains invalid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{ this is not valid json' }],
      }),
    } as unknown as Response);

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('NEUTRAL');
  });

  // 1.4.10 — Returns NEUTRAL when Claude API returns non-ok response
  it('returns NEUTRAL sentiment when the Claude API returns a non-ok status', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(500));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('NEUTRAL');
  });

  // 1.4.11 — Returns NEUTRAL on network error
  it('returns NEUTRAL sentiment on network/fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(result.sentiment_score).toBe('NEUTRAL');
  });

  // 1.4.12 — volatility_warning is a boolean
  it('volatility_warning is a boolean', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeClaudeResponse(BEAR_ANALYSIS)));

    const result = await service.analyzeSentiment('BTC', HEADLINES, PRICE_CHANGE, VOLATILITY);

    expect(typeof result.volatility_warning).toBe('boolean');
  });
});
