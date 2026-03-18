// ── Mock dependencies ─────────────────────────────────────────────────────────

const mockGetTopCoins = jest.fn().mockResolvedValue([
  {
    symbol:                   'BTC',
    price_usd:                50000,
    price_change_24h_percent: 3,
    price_change_7d_percent:  8,
    volatility_24h:           4,
    volatility_7d:            6,
    volume_24h_usd:           30_000_000_000,
    market_cap_usd:           1_000_000_000_000,
    market_rank:              1,
    sentiment_score:          0.6,
    sentiment_confidence:     0.8,
    sentiment_summary:        'Bullish momentum',
  },
  { symbol: 'ETH', price_usd: 3000, price_change_24h_percent: 1, price_change_7d_percent: 2,
    volatility_24h: 3, volatility_7d: 5, volume_24h_usd: 15_000_000_000, market_cap_usd: 400_000_000_000,
    market_rank: 2, sentiment_score: 0.3, sentiment_confidence: 0.5, sentiment_summary: '' },
]);

const mockAnalyzeAdvanced = jest.fn().mockReturnValue({
  sentiment:        'BULLISH',
  confidence:       0.75,
  risk_level:       'MEDIUM',
  news_score:       0.6,
  momentum_score:   0.5,
  volatility_score: 0.2,
  volume_score:     0.4,
  rsi_score:        0.3,
});

jest.mock('../../storage.js', () => ({
  storage: {
    saveAgentLearningState: jest.fn(),
    getAgentLearningState:  jest.fn().mockReturnValue(null),
    getAllAgentLearningStates: jest.fn().mockReturnValue([]),
    deleteAgentLearningState: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('../../services/coingecko', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getTopCoins:    mockGetTopCoins,
    getCoinHistory: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../services/sentiment-analyzer', () => ({
  SentimentAnalyzerEngine: jest.fn().mockImplementation(() => ({
    analyzeAdvancedSentiment: mockAnalyzeAdvanced,
  })),
}));

import {
  MarlCompetitionEngine,
  MarlTradingAgent,
  SharedOrderBook,
  type AgentObservation,
  type CompetitionConfig,
} from '../../services/marl-competition-engine';

function createObservation(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    currentPrice: 50000,
    bidAsk: { bid: 49950, ask: 50050 },
    spreadBps: 20,
    portfolio: [],
    cash: 10000,
    equity: 10000,
    equityHistory: [10000, 10050, 10100],
    sentimentSignal: {
      symbol: 'BTC',
      signal: 'BUY',
      strength: 0.8,
      target_price_high: 52000,
      target_price_low: 49000,
      stop_loss: 48500,
      reasoning: 'test signal',
      risk_reward_ratio: 2.5,
    },
    competitorOrders: [],
    ...overrides,
  };
}

describe('MarlTradingAgent', () => {
  it('updates the Q-value for the action actually taken', () => {
    const agent = new MarlTradingAgent({
      agentId: 'alpha',
      type: 'ML_BASED',
      riskProfile: 'AGGRESSIVE',
      initialCapital: 10000,
    });
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const policyNetwork = (agent as unknown as { policyNetwork: { forward: (input: number[]) => number[] } }).policyNetwork;
    jest.spyOn(policyNetwork, 'forward').mockReturnValue([1, 0, 0, 0, 0]);

    const observation = createObservation();
    const action = agent.computeAction(observation);
    agent.learn(10, createObservation({ currentPrice: 50500, equity: 10010 }));

    randomSpy.mockRestore();

    expect(action.type).toBe('BUY');
    const qRow = agent.qValues.values().next().value as number[];
    expect(qRow[0]).toBeGreaterThan(0);
    expect(qRow[2]).toBe(0);
  });

  it('can export and import learning state for evolutionary carry-over', () => {
    const source = new MarlTradingAgent({
      agentId: 'source',
      type: 'ML_BASED',
      riskProfile: 'SCALPING',
      initialCapital: 10000,
    });
    source.qValues.set('P:50000|S:20|E:10000|SIG:BUY', [0.25, -0.1, 0.05, 0, 0]);

    const snapshot = source.exportLearningState();
    const clone = new MarlTradingAgent({
      agentId: 'clone',
      type: 'ML_BASED',
      riskProfile: 'SCALPING',
      initialCapital: 10000,
    });

    clone.importLearningState(snapshot);

    expect(clone.qValues.get('P:50000|S:20|E:10000|SIG:BUY')).toEqual([0.25, -0.1, 0.05, 0, 0]);
    expect(clone.epsilon).toBe(source.epsilon);
  });

  it('appends sentiment feature fields when enableSentimentFeatures is true', () => {
    const agent = new MarlTradingAgent({
      agentId: 'sentiment-on',
      type: 'ML_BASED',
      riskProfile: 'AGGRESSIVE',
      initialCapital: 10000,
    }, true);

    const features = agent.extractFeatures(createObservation({
      sentimentFeatures: {
        sentiment_score: 0.6,
        sentiment_momentum_1h: 0.25,
        funding_rate: 0.01,
        on_chain_netflow: -0.2,
      },
    }));

    expect(features).toHaveLength(54);
    expect(features.slice(47, 51)).toEqual([0.6, 0.25, 0.01, -0.2]);
    expect(features.slice(51)).toEqual([0, 0, 0]);
  });

  it('omits sentiment feature fields when enableSentimentFeatures is false', () => {
    const agent = new MarlTradingAgent({
      agentId: 'sentiment-off',
      type: 'ML_BASED',
      riskProfile: 'AGGRESSIVE',
      initialCapital: 10000,
    }, false);

    const features = agent.extractFeatures(createObservation({
      sentimentFeatures: {
        sentiment_score: 0.6,
        sentiment_momentum_1h: 0.25,
        funding_rate: 0.01,
        on_chain_netflow: -0.2,
      },
    }));

    expect(features).toHaveLength(50);
  });
});

describe('SharedOrderBook', () => {
  it('matches equal-price resting orders in FIFO order', () => {
    const book = new SharedOrderBook();

    book.placeOrder('ask-1', 'seller-1', 'BTC', 'ASK', 100, 1);
    book.placeOrder('ask-2', 'seller-2', 'BTC', 'ASK', 100, 1);
    const fill = book.placeOrder('bid-1', 'buyer-1', 'BTC', 'BID', 100, 1);

    expect(fill.filled).toBe(1);
    const marketState = book.getMarketState('BTC');
    expect(marketState.askBook).toHaveLength(1);
    expect(marketState.askBook[0].orderId).toBe('ask-2');
  });
});

describe('MarlCompetitionEngine', () => {
  beforeEach(() => {
    (MarlCompetitionEngine as unknown as { basePriceCache: unknown }).basePriceCache = null;
    (MarlCompetitionEngine as unknown as { learningStateCache: Map<string, unknown> }).learningStateCache = new Map();
  });

  it('preserves the caller-provided competition ID in the result payload', async () => {
    const engine = new MarlCompetitionEngine();
    const config: CompetitionConfig = {
      mode: 'SINGLE',
      agents: [
        { id: 'alpha', riskProfile: 'AGGRESSIVE' },
        { id: 'beta', riskProfile: 'CONSERVATIVE' },
      ],
      symbols: ['BTC'],
      duration: 60,
      refreshInterval: 1000,
      learningEnabled: true,
    };

    const result = await engine.runCompetition(config, undefined, 'comp_test_fixed_id');

    expect(result.competitionId).toBe('comp_test_fixed_id');
    expect(result.finalRankings).toHaveLength(2);
  });

  it('reuses cached base prices when CoinGecko rate limits subsequent runs', async () => {
    const engine = new MarlCompetitionEngine() as unknown as {
      coinGecko: { getTopCoins: jest.Mock };
      fetchBasePrices: (symbols: string[]) => Promise<Map<string, number>>;
    };

    engine.coinGecko.getTopCoins
      .mockResolvedValueOnce([
        { symbol: 'BTC', price_usd: 50000 },
        { symbol: 'ETH', price_usd: 3000 },
      ])
      .mockRejectedValueOnce(new Error('CoinGecko API error: 429'));

    const first = await engine.fetchBasePrices(['BTC', 'ETH']);
    const second = await engine.fetchBasePrices(['BTC', 'ETH']);

    expect(first.get('BTC')).toBe(50000);
    expect(second.get('BTC')).toBe(50000);
    expect(second.get('ETH')).toBe(3000);
  });

  it('computes trade reward from the next price step instead of same-step fills', () => {
    const engine = new MarlCompetitionEngine() as unknown as {
      createAgentState: (
        spec: { id: string; riskProfile: 'AGGRESSIVE'; initialCapital: number },
        capital: number
      ) => {
        agent: MarlTradingAgent;
        cash: number;
        portfolio: Map<string, { symbol: string; quantity: number; avgPrice: number }>;
        orderCounter: number;
        impactStats: { timesOutbid: number; timesOutsold: number; liquidityImpacts: number[] };
      };
      executeAction: (
        state: ReturnType<typeof engine.createAgentState>,
        action: { type: 'BUY'; symbol: string; quantity: number },
        prices: Map<string, number>,
        nextPrices: Map<string, number>,
        orderBook: SharedOrderBook,
        competitors: unknown[]
      ) => { reward: number; tradeExecuted: boolean; realizedPnl: number };
    };

    const state = engine.createAgentState(
      { id: 'alpha', riskProfile: 'AGGRESSIVE', initialCapital: 10000 },
      10000
    );
    const orderBook = new SharedOrderBook();
    orderBook.placeOrder('mm-ask', '_mm_', 'BTC', 'ASK', 100, 1_000_000);
    orderBook.placeOrder('mm-bid', '_mm_', 'BTC', 'BID', 100, 1_000_000);

    const result = engine.executeAction(
      state,
      { type: 'BUY', symbol: 'BTC', quantity: 1 },
      new Map([['BTC', 100]]),
      new Map([['BTC', 110]]),
      orderBook,
      []
    );

    expect(result.tradeExecuted).toBe(true);
    expect(result.reward).toBeGreaterThan(0);
    expect(result.realizedPnl).toBe(0);
  });

  it('uses bounded scale-invariant state keys instead of raw absolute price buckets', () => {
    const agent = new MarlTradingAgent({
      agentId: 'alpha',
      type: 'ML_BASED',
      riskProfile: 'AGGRESSIVE',
      initialCapital: 10000,
    }) as unknown as { discretizeState: (obs: AgentObservation) => string };

    const lowPriceKey = agent.discretizeState(createObservation({ currentPrice: 50000, cash: 10000, equity: 10000 }));
    const highPriceKey = agent.discretizeState(createObservation({ currentPrice: 75000, cash: 10000, equity: 10000 }));

    expect(lowPriceKey).toBe('POS:0|GAIN:0|CASH:100|SIG:BUY');
    expect(highPriceKey).toBe(lowPriceKey);
  });

  it('replays experiences during single-tournament learning runs', async () => {
    const replaySpy = jest.spyOn(MarlTradingAgent.prototype, 'replayExperiences');
    const engine = new MarlCompetitionEngine();

    await engine.runSingleTournament({
      mode: 'SINGLE',
      agents: [
        { id: 'alpha', riskProfile: 'AGGRESSIVE' },
        { id: 'beta', riskProfile: 'CONSERVATIVE' },
      ],
      symbols: ['BTC'],
      duration: 100,
      refreshInterval: 1000,
      learningEnabled: true,
    });

    expect(replaySpy).toHaveBeenCalled();
    replaySpy.mockRestore();
  });

  it('executes non-zero trades during a full single tournament when agents emit actionable orders', async () => {
    const computeActionSpy = jest.spyOn(MarlTradingAgent.prototype, 'computeAction').mockImplementation(function (observation) {
      const openPosition = observation.portfolio.find(position => position.symbol === observation.sentimentSignal.symbol && position.quantity > 0);

      if (openPosition) {
        return {
          type: 'SELL',
          symbol: openPosition.symbol,
          quantity: openPosition.quantity,
          price: observation.currentPrice,
          reason: 'test close position',
        };
      }

      return {
        type: 'BUY',
        symbol: observation.sentimentSignal.symbol,
        quantity: 0.01,
        price: observation.currentPrice,
        reason: 'test open position',
      };
    });

    const engine = new MarlCompetitionEngine();
    const result = await engine.runSingleTournament({
      mode: 'SINGLE',
      agents: [
        { id: 'alpha', riskProfile: 'AGGRESSIVE' },
        { id: 'beta', riskProfile: 'CONSERVATIVE' },
      ],
      symbols: ['BTC'],
      duration: 100,
      refreshInterval: 1000,
      learningEnabled: true,
    });

    expect(result.finalRankings.some(ranking => ranking.tradesExecuted > 0)).toBe(true);
    expect(result.finalRankings.reduce((sum, ranking) => sum + ranking.tradesExecuted, 0)).toBeGreaterThan(0);
    expect(result.equityEvolution.length).toBeGreaterThan(0);

    computeActionSpy.mockRestore();
  });

  it('persists learned state between competition runs for the same agent id', () => {
    const engine = new MarlCompetitionEngine() as unknown as {
      createAgentState: (
        spec: { id: string; riskProfile: 'AGGRESSIVE'; initialCapital: number },
        capital: number
      ) => { agent: MarlTradingAgent; agentId: string };
      persistLearningStates: (states: Array<{ agent: MarlTradingAgent; agentId: string }>) => void;
    };

    const first = engine.createAgentState({ id: 'alpha', riskProfile: 'AGGRESSIVE', initialCapital: 10000 }, 10000);
    first.agent.qValues.set('POS:0|GAIN:0|CASH:100|SIG:BUY', [0.5, 0, 0, 0, 0]);
    engine.persistLearningStates([first]);

    const second = engine.createAgentState({ id: 'alpha', riskProfile: 'AGGRESSIVE', initialCapital: 10000 }, 10000);

    expect(second.agent.qValues.get('POS:0|GAIN:0|CASH:100|SIG:BUY')).toEqual([0.5, 0, 0, 0, 0]);
  });
});

// ─── computeLiveSignal + holdSignal ───────────────────────────────────────────

describe('MarlCompetitionEngine — computeLiveSignal and holdSignal', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type PrivateEngine = {
    computeLiveSignal: (symbol: string, livePrice: number) => Promise<any>;
    holdSignal:        (symbol: string, price: number)    => any;
  };

  beforeEach(() => {
    mockGetTopCoins.mockClear();
    mockAnalyzeAdvanced.mockClear();
  });

  it('returns a BUY signal when composite score exceeds +0.25', async () => {
    // Default mockAnalyzeAdvanced returns scores that yield a positive composite:
    // 0.30*0.6 + 0.25*0.5 - 0.10*0.2 + 0.20*0.4 + 0.15*0.3 = 0.18+0.125-0.02+0.08+0.045 = 0.41 → BUY
    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('BTC', 50000);

    expect(signal.symbol).toBe('BTC');
    expect(signal.signal).toBe('BUY');
    expect(signal.strength).toBeGreaterThan(0);
    expect(signal.strength).toBeLessThanOrEqual(1);
    expect(signal.target_price_high).toBeGreaterThan(50000);
    expect(signal.stop_loss).toBeLessThan(50000);
    expect(signal.reasoning).toMatch(/Advanced:/);
    expect(mockAnalyzeAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTC', price_usd: 50000 }),
      expect.objectContaining({ sentiment_score: 0.6 }),
    );
  });

  it('targets the live price over the cached CoinGecko price', async () => {
    // BTC CoinGecko price is 50000 in the mock; supply a different live price.
    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const livePrice = 62000;
    const signal = await engine.computeLiveSignal('BTC', livePrice);

    // MarketData passed to analyzeAdvancedSentiment must use livePrice
    expect(mockAnalyzeAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({ price_usd: livePrice }),
      expect.anything(),
    );
    expect(signal.target_price_high).toBeGreaterThan(livePrice);
    expect(signal.stop_loss).toBeLessThan(livePrice);
  });

  it('returns a SELL signal when composite score is below -0.25', async () => {
    mockAnalyzeAdvanced.mockReturnValueOnce({
      sentiment:        'BEARISH',
      confidence:       0.7,
      risk_level:       'HIGH',
      news_score:      -0.6,
      momentum_score:  -0.5,
      volatility_score: 0.5,
      volume_score:    -0.3,
      rsi_score:       -0.4,
      // composite: 0.30*(-0.6) + 0.25*(-0.5) - 0.10*0.5 + 0.20*(-0.3) + 0.15*(-0.4)
      //          = -0.18 - 0.125 - 0.05 - 0.06 - 0.06 = -0.475 → SELL
    });

    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('BTC', 50000);

    expect(signal.signal).toBe('SELL');
    expect(signal.strength).toBeGreaterThan(0);
  });

  it('returns a HOLD signal when composite score is between -0.25 and +0.25', async () => {
    mockAnalyzeAdvanced.mockReturnValueOnce({
      sentiment:        'NEUTRAL',
      confidence:       0.5,
      risk_level:       'LOW',
      news_score:       0.1,
      momentum_score:   0.0,
      volatility_score: 0.1,
      volume_score:     0.0,
      rsi_score:        0.0,
      // composite: 0.30*0.1 + 0 - 0.01 + 0 + 0 = 0.02 → HOLD
    });

    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('BTC', 50000);

    expect(signal.signal).toBe('HOLD');
  });

  it('falls back to HOLD signal when the symbol is not in the CoinGecko top-50', async () => {
    // Only ETH and BTC in the mock; request an unknown symbol
    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('DOGE', 0.12);

    expect(signal.signal).toBe('HOLD');
    expect(signal.reasoning).toMatch(/no market data/i);
    expect(mockAnalyzeAdvanced).not.toHaveBeenCalled();
  });

  it('falls back to HOLD signal when CoinGecko throws', async () => {
    mockGetTopCoins.mockRejectedValueOnce(new Error('rate limited'));

    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('BTC', 50000);

    expect(signal.signal).toBe('HOLD');
    expect(signal.reasoning).toMatch(/no market data/i);
  });

  it('holdSignal returns correct shape with neutral targets around the price', () => {
    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const price  = 3000;
    const signal = engine.holdSignal('ETH', price);

    expect(signal.symbol).toBe('ETH');
    expect(signal.signal).toBe('HOLD');
    expect(signal.strength).toBe(0);
    expect(signal.target_price_high).toBeCloseTo(price * 1.05, 2);
    expect(signal.target_price_low).toBeCloseTo(price * 0.97, 2);
    expect(signal.stop_loss).toBeCloseTo(price * 0.95, 2);
    expect(signal.reasoning).toMatch(/no market data/i);
    expect(signal.risk_reward_ratio).toBeGreaterThan(0);
  });

  it('strength is capped at 1 even for very high composite scores', async () => {
    mockAnalyzeAdvanced.mockReturnValueOnce({
      sentiment: 'BULLISH', confidence: 1, risk_level: 'LOW',
      news_score: 1, momentum_score: 1, volatility_score: 0,
      volume_score: 1, rsi_score: 1,
      // composite ≈ 0.30 + 0.25 + 0 + 0.20 + 0.15 = 0.90 → strength = min(0.90*2,1) = 1
    });

    const engine = new MarlCompetitionEngine() as unknown as PrivateEngine;
    const signal = await engine.computeLiveSignal('BTC', 50000);

    expect(signal.strength).toBe(1);
  });
});