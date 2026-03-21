/**
 * SyntheticMarketGenerator — configurable synthetic OHLCV-style price series
 * for agent pre-training without requiring live market data.
 *
 * Regimes:
 *   BULL_TREND     — gentle upward drift with Gaussian noise
 *   BEAR_TREND     — gentle downward drift with Gaussian noise
 *   SIDEWAYS       — mean-reverting noise, no net trend
 *   VOLATILE_CRASH — sudden -10% to -30% drop then partial recovery
 *   VOLATILE_PUMP  — sudden +10% to +30% spike then correction
 *
 * Each generated series is a sequence of `SyntheticBar` values covering
 * `steps` time steps.  Regime transitions occur randomly within the
 * configured segment-length bounds.  A synthetic sentiment signal is attached
 * to every bar; it matches the true price direction with `sentimentAccuracy`
 * probability (default 70%) to simulate realistic noise.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'BULL_TREND'
  | 'BEAR_TREND'
  | 'SIDEWAYS'
  | 'VOLATILE_CRASH'
  | 'VOLATILE_PUMP';

/** One generated time step. */
export interface SyntheticBar {
  stepIndex:         number;
  price:             number;
  prevPrice:         number;
  regime:            MarketRegime;
  /** Synthetic sentiment signal (may be noisy). */
  sentimentSignal:   'BUY' | 'SELL' | 'HOLD';
  /** Normalised signal strength in [0, 1]. */
  sentimentStrength: number;
}

/** Configuration for a single `generate()` call. */
export interface GeneratorConfig {
  /** Starting price.  Default: 100. */
  startPrice?:        number;
  /** Total steps to generate.  Clamped to [500, 2000].  Default: 1000. */
  steps?:             number;
  /** Regimes to include.  Default: all five. */
  regimes?:           MarketRegime[];
  /** Minimum steps per regime segment.  Default: 50. */
  minSegmentLength?:  number;
  /** Maximum steps per regime segment.  Default: 300. */
  maxSegmentLength?:  number;
  /**
   * Probability that the sentiment signal matches the true price direction.
   * 1.0 = perfect; 0.5 = random.  Default: 0.70.
   */
  sentimentAccuracy?: number;
}

/** Full output of one `generate()` call. */
export interface GeneratedSeries {
  symbol:             string;
  bars:               SyntheticBar[];
  /** Step index of every regime transition for diagnostics. */
  regimeTransitions:  { stepIndex: number; regime: MarketRegime }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Gaussian sample via Box-Muller transform. */
function gaussianNoise(mean: number, std: number): number {
  const u1 = Math.random() + 1e-10;
  const u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

/** Random element from a non-empty array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** Inclusive integer in [lo, hi]. */
function randInt(lo: number, hi: number): number {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Clamp a value to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── SyntheticMarketGenerator ──────────────────────────────────────────────────

/** Produces synthetic price series for use by the pre-trainer and unit tests. */
export class SyntheticMarketGenerator {
  /**
   * Generate a price series for `symbol` with the given configuration.
   * Regime segments are randomly ordered and sized.  Price is always ≥ 1.
   */
  generate(symbol: string, config: GeneratorConfig = {}): GeneratedSeries {
    const {
      startPrice       = 100,
      regimes          = ['BULL_TREND', 'BEAR_TREND', 'SIDEWAYS', 'VOLATILE_CRASH', 'VOLATILE_PUMP'],
      minSegmentLength = 50,
      maxSegmentLength = 300,
      sentimentAccuracy = 0.70,
    } = config;

    const totalSteps = clamp(config.steps ?? 1000, 500, 2000);
    const bars: SyntheticBar[]                                  = [];
    const regimeTransitions: { stepIndex: number; regime: MarketRegime }[] = [];

    let price     = startPrice;
    let stepIndex = 0;

    while (stepIndex < totalSteps) {
      const regime  = pick(regimes);
      const segLen  = clamp(
        randInt(minSegmentLength, maxSegmentLength),
        1,
        totalSteps - stepIndex,
      );

      regimeTransitions.push({ stepIndex, regime });

      // Pre-compute event targets for volatile regimes once per segment.
      let crashTarget   = 0;
      let pumpTarget    = 0;
      let recoveryPrice = price;

      if (regime === 'VOLATILE_CRASH') {
        const dropPct  = 0.10 + Math.random() * 0.20;
        crashTarget    = price * (1 - dropPct);
        recoveryPrice  = price;
      } else if (regime === 'VOLATILE_PUMP') {
        const spikePct = 0.10 + Math.random() * 0.20;
        pumpTarget     = price * (1 + spikePct);
        recoveryPrice  = price;
      }

      for (let s = 0; s < segLen && stepIndex < totalSteps; s++, stepIndex++) {
        const prevPrice = price;
        const t         = s / Math.max(segLen - 1, 1); // 0 → 1 progress through segment

        switch (regime) {
          case 'BULL_TREND': {
            const drift = 0.001 + Math.random() * 0.004;
            price      *= 1 + drift + gaussianNoise(0, 0.003);
            break;
          }
          case 'BEAR_TREND': {
            const drift = 0.001 + Math.random() * 0.004;
            price      *= 1 - drift + gaussianNoise(0, 0.003);
            break;
          }
          case 'SIDEWAYS': {
            price += gaussianNoise(0, price * 0.002);
            break;
          }
          case 'VOLATILE_CRASH': {
            // First half crashes to target; second half recovers.
            const target = t < 0.5 ? crashTarget : recoveryPrice;
            price       += (target - price) * 0.15 + gaussianNoise(0, price * 0.008);
            break;
          }
          case 'VOLATILE_PUMP': {
            const target = t < 0.5 ? pumpTarget : recoveryPrice;
            price       += (target - price) * 0.15 + gaussianNoise(0, price * 0.008);
            break;
          }
        }

        price = Math.max(price, 1); // price floor

        // True direction from price change.
        const pctChange    = prevPrice > 0 ? (price - prevPrice) / prevPrice : 0;
        const trueDir: 'BUY' | 'SELL' | 'HOLD' =
          pctChange >  0.001 ? 'BUY' :
          pctChange < -0.001 ? 'SELL' : 'HOLD';

        // Inject sentiment noise.
        let sentimentSignal: 'BUY' | 'SELL' | 'HOLD';
        if (Math.random() < sentimentAccuracy) {
          sentimentSignal = trueDir;
        } else {
          const others = (['BUY', 'SELL', 'HOLD'] as const).filter(d => d !== trueDir);
          sentimentSignal = pick(others);
        }

        const sentimentStrength = clamp(Math.abs(pctChange) * 50, 0.05, 1.0);

        bars.push({ stepIndex, price, prevPrice, regime, sentimentSignal, sentimentStrength });
      }
    }

    return { symbol, bars, regimeTransitions };
  }
}
