jest.mock('../../services/coingecko', () => ({
  CoinGeckoService: jest.fn().mockImplementation(() => ({
    getTopCoins: jest.fn().mockResolvedValue([
      { symbol: 'BTC', price_usd: 50000 },
      { symbol: 'ETH', price_usd: 3000 },
    ]),
    getCoinHistory: jest.fn().mockResolvedValue([]),
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