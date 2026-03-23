import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { PreTrainer } from '../../services/pre-trainer.js';
import { MarlTradingAgent } from '../../services/marl-competition-engine.js';
import { SyntheticMarketGenerator } from '../../services/synthetic-market-generator.js';

describe('PreTrainer', () => {
  const generateSpy = jest.spyOn(SyntheticMarketGenerator.prototype, 'generate');
  const computeActionSpy = jest.spyOn(MarlTradingAgent.prototype, 'computeAction');

  beforeEach(() => {
    generateSpy.mockReturnValue({
      symbol: 'SYNTHETIC',
      regimeTransitions: [{ stepIndex: 0, regime: 'BULL_TREND' }],
      bars: [
        { stepIndex: 0, price: 100, prevPrice: 100, regime: 'BULL_TREND', sentimentSignal: 'BUY', sentimentStrength: 0.8 },
        { stepIndex: 1, price: 105, prevPrice: 100, regime: 'BULL_TREND', sentimentSignal: 'BUY', sentimentStrength: 0.8 },
        { stepIndex: 2, price: 110, prevPrice: 105, regime: 'BULL_TREND', sentimentSignal: 'BUY', sentimentStrength: 0.8 },
      ],
    });

    computeActionSpy.mockImplementation(observation => {
      const openPosition = observation.portfolio.find(position => position.symbol === observation.sentimentSignal.symbol && position.quantity > 0);
      if (openPosition) {
        return {
          type: 'SELL',
          symbol: openPosition.symbol,
          quantity: openPosition.quantity,
          price: observation.currentPrice,
          reason: 'close synthetic position',
        };
      }

      return {
        type: 'BUY',
        symbol: observation.sentimentSignal.symbol,
        quantity: 1,
        price: observation.currentPrice,
        reason: 'open synthetic position',
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists a pre-trained snapshot and returns a convergence curve', async () => {
    const trainer = new PreTrainer();
    const injectPretrainedState = jest.fn();
    const engine = {
      getAgentLearningState: jest.fn().mockReturnValue(undefined),
      injectPretrainedState,
    } as unknown as Parameters<PreTrainer['pretrain']>[2];

    const result = await trainer.pretrain('agent-1', 'AGGRESSIVE', engine, {
      episodes: 12,
      stepsPerEpisode: 20,
      initialCapital: 10_000,
      regimes: ['BULL_TREND'],
    });

    expect(result.status).toBe('completed');
    expect(result.episodes).toBe(12);
    expect(result.convergenceCurve).toHaveLength(2);
    expect(result.bestReturn).toBeGreaterThanOrEqual(result.avgReturn);
    expect(injectPretrainedState).toHaveBeenCalledTimes(1);
    expect(injectPretrainedState).toHaveBeenCalledWith(
      'agent-1',
      'AGGRESSIVE',
      expect.objectContaining({
        epsilon: expect.any(Number),
        qValues: expect.any(Array),
        policyWeights: expect.any(Object),
      }),
    );
  });

  it('loads prior learning state before continuing additive pre-training', async () => {
    const priorAgent = new MarlTradingAgent({
      agentId: 'agent-2',
      type: 'ML_BASED',
      riskProfile: 'SCALPING',
      initialCapital: 10_000,
    });
    priorAgent.qValues.set('seed-state', [1, 0, 0, 0, 0]);

    const priorSnapshot = priorAgent.exportLearningState();
    const injectPretrainedState = jest.fn();
    const engine = {
      getAgentLearningState: jest.fn().mockReturnValue(priorSnapshot),
      injectPretrainedState,
    } as unknown as Parameters<PreTrainer['pretrain']>[2];

    const trainer = new PreTrainer();
    await trainer.pretrain('agent-2', 'SCALPING', engine, {
      episodes: 3,
      stepsPerEpisode: 10,
      regimes: ['BULL_TREND'],
    });

    expect(engine.getAgentLearningState).toHaveBeenCalledWith('agent-2', 'SCALPING');

    const injectedSnapshot = injectPretrainedState.mock.calls[0]?.[2] as { qValues: Array<[string, number[]]> };
    expect(injectedSnapshot.qValues).toEqual(expect.arrayContaining([
      ['seed-state', [1, 0, 0, 0, 0]],
    ]));
  });
});