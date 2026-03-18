/**
 * Tests for SentimentAnalyzerEngine async FinBERT-enhanced methods
 * (Enhancement #1).
 */
import { describe, it, expect, jest } from '@jest/globals';
import { SentimentAnalyzerEngine } from '../../services/sentiment-analyzer.js';
import type { MarketData, NewsData } from '../../services/sentiment-analyzer.js';
import type { FinBertService } from '../../services/finbert.js';
import type { OnChainMetrics } from '../../types.js';
import type { SentimentMomentum } from '../../types/social-media.js';

function makeMarket(overrides: Partial<MarketData> = {}): MarketData {
  return {
    symbol: 'BTC',
    price_usd: 50000,
    price_change_24h_percent: 3,
    price_change_7d_percent: 8,
    volatility_24h: 5,
    volatility_7d: 10,
    volume_24h_usd: 2_500_000_000,
    market_cap_usd: 50_000_000_000,
    market_rank: 1,
    ...overrides,
  };
}

function makeNews(headlines: string[] = [], overrides: Partial<NewsData> = {}): NewsData {
  return {
    headlines,
    sentiment_score: 'NEUTRAL',
    sentiment_confidence: 0,
    sentiment_summary: '',
    ...overrides,
  };
}

function makeFinBert(label: 'positive' | 'negative' | 'neutral', score: number): FinBertService {
  return {
    isAvailable: () => true,
    analyze: jest.fn<() => Promise<{ label: typeof label; score: number } | null>>()
      .mockResolvedValue({ label, score }),
    toSentimentScore: (_r: { label: string; score: number }) => {
      if (_r.label === 'positive') return _r.score;
      if (_r.label === 'negative') return -_r.score;
      return 0;
    },
  } as unknown as FinBertService;
}

function makeUnavailableFinBert(): FinBertService {
  return {
    isAvailable: () => false,
    analyze: jest.fn(),
    toSentimentScore: jest.fn(),
  } as unknown as FinBertService;
}

function makeOnChain(overrides: Partial<OnChainMetrics> = {}): OnChainMetrics {
  return {
    exchange_inflow: 1_000,
    exchange_outflow: 2_500,
    active_addresses_24h: 850_000,
    large_tx_count_24h: 500,
    ...overrides,
  };
}

function makeSentimentMomentum(overrides: Partial<SentimentMomentum> = {}): SentimentMomentum {
  return {
    h1_avg: 60,
    h6_avg: 58,
    h24_avg: 55,
    roc_1h: 8,
    roc_6h: 10,
    volume_interaction_24h: 1.5,
    ...overrides,
  };
}

const analyzer = new SentimentAnalyzerEngine();

// ── analyzeAdvancedSentimentAsync ─────────────────────────────────────────────

describe('analyzeAdvancedSentimentAsync', () => {
  it('returns valid AdvancedAnalysisResult shape', async () => {
    const result = await analyzer.analyzeAdvancedSentimentAsync(
      makeMarket(), makeNews(['Bitcoin hits new high'])
    );
    expect(result.symbol).toBe('BTC');
    expect(['BULL', 'NEUTRAL', 'BEAR']).toContain(result.sentiment);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.risk_level);
  });

  it('uses FinBERT score when available and result is not null', async () => {
    const finBert = makeFinBert('positive', 0.95);
    const result = await analyzer.analyzeAdvancedSentimentAsync(
      makeMarket(), makeNews(['Great news for crypto']), undefined, finBert
    );
    expect(finBert.analyze).toHaveBeenCalled();
    // Positive FinBERT score should lean BULL
    expect(result.sentiment).toBe('BULL');
  });

  it('falls back to keyword scoring when FinBERT is unavailable', async () => {
    const finBert = makeUnavailableFinBert();
    const result = await analyzer.analyzeAdvancedSentimentAsync(
      makeMarket(), makeNews(['Bitcoin rally breakout adoption']), undefined, finBert
    );
    expect(finBert.analyze).not.toHaveBeenCalled();
    expect(['BULL', 'NEUTRAL', 'BEAR']).toContain(result.sentiment);
  });

  it('falls back to keyword scoring per headline when FinBERT returns null', async () => {
    const finBert = {
      isAvailable: () => true,
      analyze: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      toSentimentScore: jest.fn(),
    } as unknown as FinBertService;

    const result = await analyzer.analyzeAdvancedSentimentAsync(
      makeMarket(), makeNews(['surge rally bullish']), undefined, finBert
    );
    expect(['BULL', 'NEUTRAL', 'BEAR']).toContain(result.sentiment);
  });

  it('produces same structure as sync version when FinBERT is unavailable', async () => {
    const market = makeMarket();
    const news = makeNews(['Bitcoin crash bearish sell-off']);
    const finBert = makeUnavailableFinBert();

    const syncResult  = analyzer.analyzeAdvancedSentiment(market, news);
    const asyncResult = await analyzer.analyzeAdvancedSentimentAsync(market, news, undefined, finBert);

    expect(asyncResult.symbol).toBe(syncResult.symbol);
    expect(asyncResult.risk_level).toBe(syncResult.risk_level);
    // Scores should be close (keyword path is identical)
    expect(asyncResult.news_score).toBeCloseTo(syncResult.news_score, 5);
  });

  it('processes multiple headlines in parallel', async () => {
    const finBert = makeFinBert('positive', 0.8);
    const headlines = ['headline one', 'headline two', 'headline three'];
    await analyzer.analyzeAdvancedSentimentAsync(makeMarket(), makeNews(headlines), undefined, finBert);
    expect(finBert.analyze).toHaveBeenCalledTimes(headlines.length);
  });

  it('incorporates positive on-chain metrics into ADVANCED mode', async () => {
    const market = makeMarket({
      price_change_24h_percent: 1,
      price_change_7d_percent: 2,
      volatility_24h: 0,
      volatility_7d: 0,
    });
    const news = makeNews([], {
      sentiment_score: 'BULL',
      sentiment_confidence: 0.1,
    });

    const withoutOnChain = await analyzer.analyzeAdvancedSentimentAsync(
      market,
      news,
      undefined,
      makeUnavailableFinBert()
    );
    const withOnChain = await analyzer.analyzeAdvancedSentimentAsync(
      market,
      news,
      undefined,
      makeUnavailableFinBert(),
      makeOnChain()
    );

    expect(withoutOnChain.sentiment).toBe('NEUTRAL');
    expect(withOnChain.confidence).toBeGreaterThan(withoutOnChain.confidence);
    expect(withOnChain.summary).toMatch(/On-chain activity is supportive/);
    expect(withOnChain.on_chain_score).toBeGreaterThan(0);
  });
});

// ── analyzeSmartSentimentAsync ────────────────────────────────────────────────

describe('analyzeSmartSentimentAsync', () => {
  it('returns valid SmartAnalysisResult shape', async () => {
    const result = await analyzer.analyzeSmartSentimentAsync(makeMarket(), makeNews());
    expect(result.symbol).toBe('BTC');
    expect(['BULL', 'NEUTRAL', 'BEAR']).toContain(result.sentiment);
    expect(result.composite_score).toBeGreaterThanOrEqual(-1);
    expect(result.composite_score).toBeLessThanOrEqual(1);
    const weightSum = Object.values(result.factor_weights).reduce((a, b) => a + b, 0);
    expect(weightSum).toBeCloseTo(1, 5);
  });

  it('uses FinBERT when available', async () => {
    const finBert = makeFinBert('negative', 0.9);
    const result = await analyzer.analyzeSmartSentimentAsync(
      makeMarket({ price_change_24h_percent: -8, price_change_7d_percent: -15 }),
      makeNews(['crash liquidation fear']),
      undefined,
      finBert
    );
    expect(finBert.analyze).toHaveBeenCalled();
    expect(result.sentiment).toBe('BEAR');
  });

  it('falls back gracefully when FinBERT is unavailable', async () => {
    const finBert = makeUnavailableFinBert();
    const result = await analyzer.analyzeSmartSentimentAsync(
      makeMarket(), makeNews(['Bitcoin surge record high adoption']), undefined, finBert
    );
    expect(finBert.analyze).not.toHaveBeenCalled();
    expect(typeof result.composite_score).toBe('number');
  });

  it('produces same factor_weights structure as sync version', async () => {
    const market = makeMarket();
    const news = makeNews([]);
    const syncResult  = analyzer.analyzeSmartSentiment(market, news);
    const asyncResult = await analyzer.analyzeSmartSentimentAsync(
      market, news, undefined, makeUnavailableFinBert()
    );
    expect(Object.keys(asyncResult.factor_weights)).toEqual(
      Object.keys(syncResult.factor_weights)
    );
  });

  it('incorporates bearish on-chain metrics into SMART mode', async () => {
    const market = makeMarket({
      price_change_24h_percent: 1,
      price_change_7d_percent: 2,
      volatility_24h: 0,
      volatility_7d: 0,
    });
    const news = makeNews([]);
    const bearishOnChain = makeOnChain({
      exchange_inflow: 4_000,
      exchange_outflow: 500,
      active_addresses_24h: 40_000,
      large_tx_count_24h: 20,
    });

    const baseline = await analyzer.analyzeSmartSentimentAsync(
      market,
      news,
      undefined,
      makeUnavailableFinBert()
    );
    const withOnChain = await analyzer.analyzeSmartSentimentAsync(
      market,
      news,
      undefined,
      makeUnavailableFinBert(),
      bearishOnChain
    );

    expect(withOnChain.factor_weights.on_chain).toBeGreaterThan(0);
    expect(withOnChain.on_chain_score).toBeLessThan(0);
    expect(withOnChain.composite_score).toBeLessThan(baseline.composite_score);
  });
});

// ── generateTradingSignalsAsync ───────────────────────────────────────────────

function makeSentiment(): import('../../types.js').Sentiment {
  return {
    symbol: 'BTC',
    analysis_date: '2026-03-18',
    sentiment_score: 'NEUTRAL',
    confidence: 0,
    summary: '',
    key_catalysts: [],
    risk_factors: [],
    short_term_outlook: '',
    volatility_warning: false,
    trending_score: 0,
  };
}

describe('generateTradingSignalsAsync', () => {
  it('returns valid TradingSignal shape', async () => {
    const result = await analyzer.generateTradingSignalsAsync(
      makeMarket(), makeNews(), makeSentiment()
    );
    expect(result.symbol).toBe('BTC');
    expect(['BUY', 'SELL', 'HOLD']).toContain(result.signal);
    expect(result.strength).toBeGreaterThanOrEqual(0);
    expect(result.strength).toBeLessThanOrEqual(1);
    expect(result.target_price_high).toBeGreaterThan(result.target_price_low);
    expect(typeof result.reasoning).toBe('string');
  });

  it('uses FinBERT when available and produces BUY signal on strong positive', async () => {
    const finBert = makeFinBert('positive', 0.99);
    const market = makeMarket({
      price_change_24h_percent: 10,
      price_change_7d_percent: 20,
    });
    // Provide BULL baseline so FinBERT + momentum pushes composite well above 0.25
    const news = makeNews(['record breakout adoption surge'], {
      sentiment_score: 'BULL',
      sentiment_confidence: 0.8,
    });
    const result = await analyzer.generateTradingSignalsAsync(
      market, news, makeSentiment(), undefined, finBert
    );
    expect(finBert.analyze).toHaveBeenCalled();
    expect(result.signal).toBe('BUY');
  });

  it('falls back to keyword scoring when FinBERT is unavailable', async () => {
    const finBert = makeUnavailableFinBert();
    const result = await analyzer.generateTradingSignalsAsync(
      makeMarket(), makeNews(['Bitcoin crash sell-off fear']), makeSentiment(), undefined, finBert
    );
    expect(finBert.analyze).not.toHaveBeenCalled();
    expect(['BUY', 'SELL', 'HOLD']).toContain(result.signal);
  });

  it('matches sync generateTradingSignals output when FinBERT is unavailable', async () => {
    const market = makeMarket();
    const news = makeNews(['rally surge breakout']);
    const sentiment = makeSentiment();
    const finBert = makeUnavailableFinBert();

    const syncResult  = analyzer.generateTradingSignals(market, news, sentiment);
    const asyncResult = await analyzer.generateTradingSignalsAsync(
      market, news, sentiment, undefined, finBert
    );

    expect(asyncResult.symbol).toBe(syncResult.symbol);
    expect(asyncResult.signal).toBe(syncResult.signal);
    expect(asyncResult.strength).toBeCloseTo(syncResult.strength, 5);
    expect(asyncResult.stop_loss).toBeCloseTo(syncResult.stop_loss, 5);
  });

  it('uses positive sentiment ROC as an additional TRADING_SIGNALS feature', async () => {
    const market = makeMarket({
      price_change_24h_percent: 0,
      price_change_7d_percent: 0,
      volatility_24h: 4,
      volatility_7d: 4,
    });
    const news = makeNews([]);
    const withoutMomentum = await analyzer.generateTradingSignalsAsync(
      market,
      news,
      makeSentiment(),
      undefined,
      makeUnavailableFinBert(),
      null,
      null
    );
    const withMomentum = await analyzer.generateTradingSignalsAsync(
      market,
      news,
      makeSentiment(),
      undefined,
      makeUnavailableFinBert(),
      null,
      makeSentimentMomentum({ roc_1h: 12, roc_6h: 14 })
    );

    expect(withMomentum.reasoning).toMatch(/Social sentiment momentum is improving/);
    expect(withMomentum.strength).toBeGreaterThan(withoutMomentum.strength);
    expect(['BUY', 'HOLD']).toContain(withMomentum.signal);
  });

  it('uses negative sentiment ROC as an additional TRADING_SIGNALS feature', async () => {
    const market = makeMarket({
      price_change_24h_percent: 0,
      price_change_7d_percent: 0,
      volatility_24h: 4,
      volatility_7d: 4,
    });
    const withoutMomentum = await analyzer.generateTradingSignalsAsync(
      market,
      makeNews([]),
      makeSentiment(),
      undefined,
      makeUnavailableFinBert(),
      null,
      null
    );
    const withMomentum = await analyzer.generateTradingSignalsAsync(
      market,
      makeNews([]),
      makeSentiment(),
      undefined,
      makeUnavailableFinBert(),
      null,
      makeSentimentMomentum({ roc_1h: -12, roc_6h: -14 })
    );

    expect(withMomentum.reasoning).toMatch(/Social sentiment momentum is deteriorating/);
    expect(withMomentum.strength).toBeGreaterThan(withoutMomentum.strength);
    expect(['SELL', 'HOLD']).toContain(withMomentum.signal);
  });
});
