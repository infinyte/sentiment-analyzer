/**
 * Architecture-params unit tests (Issue 4)
 */

import {
  createDefaultLSTMParams,
  createDefaultGANParams,
  createDefaultTransformerParams,
  createDefaultArchitectureParams,
  createRandomLSTMParams,
  createRandomGANParams,
  createRandomTransformerParams,
  isLSTMParams,
  isGANParams,
  isTransformerParams,
  LSTM_PARAM_BOUNDS,
  GAN_PARAM_BOUNDS,
  TRANSFORMER_PARAM_BOUNDS,
  VALID_ATTENTION_HEADS,
  type ModelArchitecture,
} from '../../../services/evolutionary/architecture-params.js';

// ── Default factory tests ─────────────────────────────────────────────────────

describe('createDefaultLSTMParams', () => {
  it('returns params within LSTM bounds', () => {
    const p = createDefaultLSTMParams();
    expect(p.sequenceLength).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.min);
    expect(p.sequenceLength).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.max);
    expect(p.hiddenUnits).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.min);
    expect(p.hiddenUnits).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.max);
    expect(p.dropout).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.dropout.min);
    expect(p.dropout).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.dropout.max);
  });

  it('returns integer values for integer params', () => {
    const p = createDefaultLSTMParams();
    expect(Number.isInteger(p.sequenceLength)).toBe(true);
    expect(Number.isInteger(p.hiddenUnits)).toBe(true);
  });
});

describe('createDefaultGANParams', () => {
  it('returns params within GAN bounds', () => {
    const p = createDefaultGANParams();
    expect(p.adversarialPressure).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.min);
    expect(p.adversarialPressure).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.max);
    expect(p.discriminatorWeight).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.min);
    expect(p.discriminatorWeight).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.max);
    expect(p.generatorLR).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.min);
    expect(p.generatorLR).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.max);
  });
});

describe('createDefaultTransformerParams', () => {
  it('returns params within TRANSFORMER bounds', () => {
    const p = createDefaultTransformerParams();
    expect(VALID_ATTENTION_HEADS).toContain(p.attentionHeads as typeof VALID_ATTENTION_HEADS[number]);
    expect(p.embeddingDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.min);
    expect(p.embeddingDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.max);
    expect(p.feedforwardDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.min);
    expect(p.feedforwardDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.max);
  });
});

describe('createDefaultArchitectureParams', () => {
  const cases: ModelArchitecture[] = ['LSTM', 'GAN', 'TRANSFORMER', 'HYBRID'];

  for (const arch of cases) {
    it(`returns valid params for ${arch}`, () => {
      const p = createDefaultArchitectureParams(arch);
      expect(p).toBeDefined();
      if (arch === 'LSTM' || arch === 'HYBRID') expect(isLSTMParams(p)).toBe(true);
      if (arch === 'GAN') expect(isGANParams(p)).toBe(true);
      if (arch === 'TRANSFORMER') expect(isTransformerParams(p)).toBe(true);
    });
  }
});

// ── Random factory tests ──────────────────────────────────────────────────────

describe('createRandomLSTMParams', () => {
  it('always returns values within bounds (50 samples)', () => {
    for (let i = 0; i < 50; i++) {
      const p = createRandomLSTMParams();
      expect(p.sequenceLength).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.min);
      expect(p.sequenceLength).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.sequenceLength.max);
      expect(p.hiddenUnits).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.min);
      expect(p.hiddenUnits).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.hiddenUnits.max);
      expect(p.dropout).toBeGreaterThanOrEqual(LSTM_PARAM_BOUNDS.dropout.min);
      expect(p.dropout).toBeLessThanOrEqual(LSTM_PARAM_BOUNDS.dropout.max);
      expect(Number.isInteger(p.sequenceLength)).toBe(true);
      expect(Number.isInteger(p.hiddenUnits)).toBe(true);
    }
  });
});

describe('createRandomGANParams', () => {
  it('always returns values within bounds (50 samples)', () => {
    for (let i = 0; i < 50; i++) {
      const p = createRandomGANParams();
      expect(p.adversarialPressure).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.min);
      expect(p.adversarialPressure).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.adversarialPressure.max);
      expect(p.discriminatorWeight).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.min);
      expect(p.discriminatorWeight).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.discriminatorWeight.max);
      expect(p.generatorLR).toBeGreaterThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.min);
      expect(p.generatorLR).toBeLessThanOrEqual(GAN_PARAM_BOUNDS.generatorLR.max);
    }
  });
});

describe('createRandomTransformerParams', () => {
  it('always returns valid attention heads (50 samples)', () => {
    for (let i = 0; i < 50; i++) {
      const p = createRandomTransformerParams();
      expect(VALID_ATTENTION_HEADS).toContain(p.attentionHeads as typeof VALID_ATTENTION_HEADS[number]);
      expect(p.embeddingDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.min);
      expect(p.embeddingDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.embeddingDim.max);
      expect(p.feedforwardDim).toBeGreaterThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.min);
      expect(p.feedforwardDim).toBeLessThanOrEqual(TRANSFORMER_PARAM_BOUNDS.feedforwardDim.max);
      expect(Number.isInteger(p.embeddingDim)).toBe(true);
      expect(Number.isInteger(p.feedforwardDim)).toBe(true);
    }
  });
});

// ── Type guard tests ──────────────────────────────────────────────────────────

describe('type guards', () => {
  it('isLSTMParams identifies LSTM params', () => {
    expect(isLSTMParams(createDefaultLSTMParams())).toBe(true);
    expect(isLSTMParams(createDefaultGANParams())).toBe(false);
    expect(isLSTMParams(createDefaultTransformerParams())).toBe(false);
  });

  it('isGANParams identifies GAN params', () => {
    expect(isGANParams(createDefaultGANParams())).toBe(true);
    expect(isGANParams(createDefaultLSTMParams())).toBe(false);
    expect(isGANParams(createDefaultTransformerParams())).toBe(false);
  });

  it('isTransformerParams identifies Transformer params', () => {
    expect(isTransformerParams(createDefaultTransformerParams())).toBe(true);
    expect(isTransformerParams(createDefaultLSTMParams())).toBe(false);
    expect(isTransformerParams(createDefaultGANParams())).toBe(false);
  });
});
