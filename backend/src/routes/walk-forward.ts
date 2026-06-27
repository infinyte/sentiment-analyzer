/**
 * Walk-Forward Validation Routes
 *
 * Read-only, stateless. Runs walk-forward analysis of the agent's decision policy
 * over a supplied time series and returns the report. Optimises policy params on
 * in-sample windows, scores them on the unseen out-of-sample windows, all measured
 * net-of-fees with the Phase 2 expectancy math.
 *
 * Endpoint:
 *   POST /api/walk-forward/run
 *     body: {
 *       symbol?: string,
 *       bars?:   Bar[],            // explicit price+signal series, OR
 *       prices?: number[],         // a bare price series → momentum signals derived
 *       candidates?: PolicyParams[],   // grid to optimise (default 3×3 grid)
 *       inSampleSize: number,
 *       outOfSampleSize: number,
 *       anchored?: boolean,
 *       objective?: 'netPnl'|'expectancy'|'profitFactor'|'sharpe',
 *       initialCapital?, feePreset?, slippagePct?, momentum?: { lookback?, band? }
 *     }
 *
 * No DB schema, no new dependencies.
 */

import { Router } from 'express';
import {
  runWalkForward,
  deriveMomentumSignals,
  type Bar,
  type PolicyParams,
  type ObjectiveName,
} from '../services/analytics/walk-forward.js';
import { FEE_PRESETS, type FeePreset } from '../services/exchange/realistic-paper-exchange.js';
import logger from '../logger.js';

/** Default parameter grid when the caller doesn't supply one (3 × 3 = 9 candidates). */
const DEFAULT_CANDIDATES: PolicyParams[] = [0.2, 0.4, 0.6].flatMap(minStrength =>
  [0.05, 0.1, 0.2].map(tradeFractionOfCapital => ({ minStrength, tradeFractionOfCapital })),
);

const OBJECTIVES: ObjectiveName[] = ['netPnl', 'expectancy', 'profitFactor', 'sharpe'];

export interface WalkForwardRouterOptions {
  /** Fee preset name; coerced to a valid FeePreset (default 'binance-us') if unknown. */
  feePreset?: string;
}

function coerceFeePreset(raw: string | undefined): FeePreset {
  return raw !== undefined && raw in FEE_PRESETS ? (raw as FeePreset) : 'binance-us';
}

export function createWalkForwardRouter(options: WalkForwardRouterOptions = {}): Router {
  const router = Router();

  router.post('/api/walk-forward/run', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Resolve the bar series: explicit bars, else derive momentum signals from prices.
    let bars: Bar[];
    const parsedBars = parseBars(body.bars);
    if (parsedBars === null) {
      res.status(400).json({ error: 'bars, when provided, must be an array of { timestamp, price, signal, strength }' });
      return;
    }
    if (parsedBars.length > 0) {
      bars = parsedBars;
    } else {
      const prices = parsePrices(body.prices);
      if (prices === null) {
        res.status(400).json({ error: 'provide bars[] or a numeric prices[] array' });
        return;
      }
      const momentum = (body.momentum ?? {}) as { lookback?: unknown; band?: unknown };
      bars = deriveMomentumSignals(prices, {
        lookback: typeof momentum.lookback === 'number' ? momentum.lookback : undefined,
        band:     typeof momentum.band === 'number' ? momentum.band : undefined,
      });
    }

    const inSampleSize    = toInt(body.inSampleSize);
    const outOfSampleSize = toInt(body.outOfSampleSize);
    if (inSampleSize === null || outOfSampleSize === null || inSampleSize <= 0 || outOfSampleSize <= 0) {
      res.status(400).json({ error: 'inSampleSize and outOfSampleSize must be positive integers' });
      return;
    }

    const candidates = parseCandidates(body.candidates);
    if (candidates === null) {
      res.status(400).json({ error: 'candidates, when provided, must be an array of { minStrength, tradeFractionOfCapital }' });
      return;
    }

    const objective = typeof body.objective === 'string' && OBJECTIVES.includes(body.objective as ObjectiveName)
      ? (body.objective as ObjectiveName)
      : undefined;

    try {
      const report = runWalkForward({
        symbol:          typeof body.symbol === 'string' ? body.symbol : 'ASSET',
        bars,
        candidates:      candidates.length > 0 ? candidates : DEFAULT_CANDIDATES,
        inSampleSize,
        outOfSampleSize,
        anchored:        body.anchored === true,
        objective,
        initialCapital:  typeof body.initialCapital === 'number' ? body.initialCapital : undefined,
        feePreset:       coerceFeePreset(typeof body.feePreset === 'string' ? body.feePreset : options.feePreset),
        slippagePct:     typeof body.slippagePct === 'number' ? body.slippagePct : undefined,
      });
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('walk-forward: run failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

// ── Body parsing ────────────────────────────────────────────────────────────

function parseBars(raw: unknown): Bar[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: Bar[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { timestamp, price, signal, strength } = item as Record<string, unknown>;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    if (signal !== 'BUY' && signal !== 'SELL' && signal !== 'HOLD') return null;
    const ts = typeof timestamp === 'string' || typeof timestamp === 'number' ? new Date(timestamp) : new Date(0);
    out.push({
      timestamp: ts,
      price,
      signal,
      strength: typeof strength === 'number' && Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0,
    });
  }
  return out;
}

function parsePrices(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (!raw.every(p => typeof p === 'number' && Number.isFinite(p) && p > 0)) return null;
  return raw as number[];
}

function parseCandidates(raw: unknown): PolicyParams[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: PolicyParams[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { minStrength, tradeFractionOfCapital } = item as Record<string, unknown>;
    if (typeof minStrength !== 'number' || typeof tradeFractionOfCapital !== 'number') return null;
    out.push({ minStrength, tradeFractionOfCapital });
  }
  return out;
}

function toInt(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.floor(raw);
}
