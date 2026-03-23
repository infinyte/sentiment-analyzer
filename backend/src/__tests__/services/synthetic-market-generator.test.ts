import { describe, it, expect } from '@jest/globals';
import { SyntheticMarketGenerator } from '../../services/synthetic-market-generator.js';

describe('SyntheticMarketGenerator', () => {
  it('clamps requested steps to the supported minimum and preserves bar invariants', () => {
    const generator = new SyntheticMarketGenerator();

    const series = generator.generate('BTC', {
      steps: 100,
      regimes: ['BULL_TREND', 'SIDEWAYS'],
      minSegmentLength: 5,
      maxSegmentLength: 12,
      sentimentAccuracy: 0.8,
    });

    expect(series.symbol).toBe('BTC');
    expect(series.bars).toHaveLength(500);
    expect(series.regimeTransitions[0]).toEqual({ stepIndex: 0, regime: expect.any(String) });

    for (const [index, bar] of series.bars.entries()) {
      expect(bar.stepIndex).toBe(index);
      expect(bar.price).toBeGreaterThanOrEqual(1);
      expect(bar.prevPrice).toBeGreaterThan(0);
      expect(['BULL_TREND', 'SIDEWAYS']).toContain(bar.regime);
      expect(['BUY', 'SELL', 'HOLD']).toContain(bar.sentimentSignal);
      expect(bar.sentimentStrength).toBeGreaterThanOrEqual(0.05);
      expect(bar.sentimentStrength).toBeLessThanOrEqual(1);
    }
  });

  it('clamps requested steps to the supported maximum and only emits configured volatile regimes', () => {
    const generator = new SyntheticMarketGenerator();

    const series = generator.generate('ETH', {
      steps: 2500,
      regimes: ['VOLATILE_CRASH', 'VOLATILE_PUMP'],
      minSegmentLength: 8,
      maxSegmentLength: 20,
    });

    expect(series.bars).toHaveLength(2000);
    expect(series.regimeTransitions.length).toBeGreaterThan(0);
    expect(series.regimeTransitions.every(transition => ['VOLATILE_CRASH', 'VOLATILE_PUMP'].includes(transition.regime))).toBe(true);
    expect(series.bars.every(bar => ['VOLATILE_CRASH', 'VOLATILE_PUMP'].includes(bar.regime))).toBe(true);
  });
});