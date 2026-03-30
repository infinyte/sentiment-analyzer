/**
 * architecture-params.ts
 *
 * Architecture-specific parameter spaces for agent genomes.
 * Each architecture type defines its own hyper-parameter block that controls
 * how agents process market signals inside the MARL competition engine.
 *
 *   LSTM        — sequence-length + hidden-unit + dropout configuration
 *   GAN         — adversarial pressure + discriminator/generator tuning
 *   TRANSFORMER — multi-head attention + embedding + feedforward dimensions
 *   HYBRID      — runs all three processing stages sequentially
 *
 * Parameter bounds and factory helpers (default / random) are co-located
 * so mutation and crossover routines have a single source of truth.
 */

// ── Model architecture type ────────────────────────────────────────────────────

export type ModelArchitecture = 'LSTM' | 'GAN' | 'TRANSFORMER' | 'HYBRID';

// ── Architecture parameter interfaces ─────────────────────────────────────────

/**
 * Parameters for the LSTM signal-processing mode.
 *
 *   sequenceLength : EMA window applied to equity-history features.  Range [3, 20] (int).
 *   hiddenUnits    : Conceptual hidden-unit count; used as a feature-scaling factor. Range [16, 128] (int).
 *   dropout        : Probability of zeroing a feature during exploration. Range [0, 0.5].
 */
export interface LSTMParams {
  sequenceLength: number;
  hiddenUnits:    number;
  dropout:        number;
}

/**
 * Parameters for the GAN signal-processing mode.
 *
 *   adversarialPressure : Magnitude of noise injected into all features. Range [0, 1].
 *   discriminatorWeight : Up-weighting multiplier applied to sentiment features. Range [0, 1].
 *   generatorLR         : Noise scaling factor (multiplied by adversarialPressure). Range [0.0001, 0.01].
 */
export interface GANParams {
  adversarialPressure: number;
  discriminatorWeight: number;
  generatorLR:         number;
}

/**
 * Parameters for the TRANSFORMER signal-processing mode.
 *
 *   attentionHeads : Number of feature groups (must be in {1, 2, 4, 8}). Range [1, 8] (int).
 *   embeddingDim   : Attention scaling factor; higher = stronger softmax weighting. Range [8, 64] (int).
 *   feedforwardDim : Post-attention feature amplification denominator. Range [16, 128] (int).
 */
export interface TransformerParams {
  attentionHeads: number;
  embeddingDim:   number;
  feedforwardDim: number;
}

/** Discriminated union of all architecture parameter blocks. */
export type ArchitectureParams = LSTMParams | GANParams | TransformerParams;

// ── Parameter bounds ──────────────────────────────────────────────────────────

export interface ArchParamBound {
  min:      number;
  max:      number;
  integer?: boolean;
}

export const LSTM_PARAM_BOUNDS: Record<keyof LSTMParams, ArchParamBound> = {
  sequenceLength: { min: 3,  max: 20,  integer: true },
  hiddenUnits:    { min: 16, max: 128, integer: true },
  dropout:        { min: 0,  max: 0.5 },
};

export const GAN_PARAM_BOUNDS: Record<keyof GANParams, ArchParamBound> = {
  adversarialPressure: { min: 0,      max: 1    },
  discriminatorWeight: { min: 0,      max: 1    },
  generatorLR:         { min: 0.0001, max: 0.01 },
};

export const TRANSFORMER_PARAM_BOUNDS: Record<keyof TransformerParams, ArchParamBound> = {
  attentionHeads: { min: 1,  max: 8,   integer: true },
  embeddingDim:   { min: 8,  max: 64,  integer: true },
  feedforwardDim: { min: 16, max: 128, integer: true },
};

/** Valid attention-head counts (must evenly divide the feature space). */
export const VALID_ATTENTION_HEADS = [1, 2, 4, 8] as const;

// ── Default parameter factories ───────────────────────────────────────────────

export function createDefaultLSTMParams(): LSTMParams {
  return { sequenceLength: 10, hiddenUnits: 64, dropout: 0.1 };
}

export function createDefaultGANParams(): GANParams {
  return { adversarialPressure: 0.3, discriminatorWeight: 0.5, generatorLR: 0.001 };
}

export function createDefaultTransformerParams(): TransformerParams {
  return { attentionHeads: 4, embeddingDim: 32, feedforwardDim: 64 };
}

/**
 * Return mid-range default params for the given architecture.
 * HYBRID uses LSTM params as its base (the first processing stage).
 */
export function createDefaultArchitectureParams(arch: ModelArchitecture): ArchitectureParams {
  switch (arch) {
    case 'LSTM':        return createDefaultLSTMParams();
    case 'GAN':         return createDefaultGANParams();
    case 'TRANSFORMER': return createDefaultTransformerParams();
    case 'HYBRID':      return createDefaultLSTMParams();
  }
}

// ── Random parameter factories ────────────────────────────────────────────────

export function createRandomLSTMParams(): LSTMParams {
  return {
    sequenceLength: Math.round(
      LSTM_PARAM_BOUNDS.sequenceLength.min +
      Math.random() * (LSTM_PARAM_BOUNDS.sequenceLength.max - LSTM_PARAM_BOUNDS.sequenceLength.min)
    ),
    hiddenUnits: Math.round(
      LSTM_PARAM_BOUNDS.hiddenUnits.min +
      Math.random() * (LSTM_PARAM_BOUNDS.hiddenUnits.max - LSTM_PARAM_BOUNDS.hiddenUnits.min)
    ),
    dropout: LSTM_PARAM_BOUNDS.dropout.min + Math.random() * (LSTM_PARAM_BOUNDS.dropout.max - LSTM_PARAM_BOUNDS.dropout.min),
  };
}

export function createRandomGANParams(): GANParams {
  return {
    adversarialPressure: Math.random(),
    discriminatorWeight: Math.random(),
    generatorLR:         GAN_PARAM_BOUNDS.generatorLR.min + Math.random() * (GAN_PARAM_BOUNDS.generatorLR.max - GAN_PARAM_BOUNDS.generatorLR.min),
  };
}

export function createRandomTransformerParams(): TransformerParams {
  return {
    attentionHeads: VALID_ATTENTION_HEADS[Math.floor(Math.random() * VALID_ATTENTION_HEADS.length)]!,
    embeddingDim:   Math.round(
      TRANSFORMER_PARAM_BOUNDS.embeddingDim.min +
      Math.random() * (TRANSFORMER_PARAM_BOUNDS.embeddingDim.max - TRANSFORMER_PARAM_BOUNDS.embeddingDim.min)
    ),
    feedforwardDim: Math.round(
      TRANSFORMER_PARAM_BOUNDS.feedforwardDim.min +
      Math.random() * (TRANSFORMER_PARAM_BOUNDS.feedforwardDim.max - TRANSFORMER_PARAM_BOUNDS.feedforwardDim.min)
    ),
  };
}

/**
 * Return uniformly-sampled random params for the given architecture.
 * HYBRID uses LSTM params as its base.
 */
export function createRandomArchitectureParams(arch: ModelArchitecture): ArchitectureParams {
  switch (arch) {
    case 'LSTM':        return createRandomLSTMParams();
    case 'GAN':         return createRandomGANParams();
    case 'TRANSFORMER': return createRandomTransformerParams();
    case 'HYBRID':      return createRandomLSTMParams();
  }
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isLSTMParams(p: ArchitectureParams): p is LSTMParams {
  return 'sequenceLength' in p;
}

export function isGANParams(p: ArchitectureParams): p is GANParams {
  return 'adversarialPressure' in p;
}

export function isTransformerParams(p: ArchitectureParams): p is TransformerParams {
  return 'attentionHeads' in p;
}
