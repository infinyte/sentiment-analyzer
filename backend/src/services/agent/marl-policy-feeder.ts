/**
 * MarlPolicyFeeder — Phase 7: MARL/evolution as a research feeder.
 *
 * The evolutionary MARL system runs tournaments that breed and select trading
 * agents, persisting each agent's genome and fitness. This feeder closes the loop
 * back to the *live* agent: it takes the best evolved genome and maps its
 * behavioural genes onto the live decision policy (`PolicyParams`) that the Phase 3
 * orchestrator and Phase 4 shadow harness run — so evolution does the research and
 * its winner tunes production. Phase 5 walk-forward can then validate the fed
 * parameters before they are trusted.
 *
 * The mapping is direct and semantic, not a heuristic:
 *   • genome.entryThreshold  ("min signal strength to open", 0–100 scale) → minStrength
 *   • genome.positionSizePct ("max position as % of capital")             → tradeFractionOfCapital
 *
 * Pure mapping + a decoupled provider interface, so it is fully unit-testable
 * without the GA stack. No DB schema, no new dependencies.
 */

import type { AgentGenome } from '../evolutionary/agent-genome.js';
import type { PolicyParams } from '../analytics/walk-forward.js';

// ── Provider seam ──────────────────────────────────────────────────────────────

/** The winning evolved agent the feeder draws from. */
export interface BestEvolvedAgent {
  agentId:      string;
  genome:       AgentGenome;
  fitnessScore?: number | null;
  generation?:   number | null;
  source?:       string;
}

/**
 * Supplies the current best evolved agent. Implemented in app wiring over the
 * agents repository (leaderboard + genome); injected here so the feeder stays
 * decoupled from the GA persistence layer.
 */
export interface BestAgentProvider {
  getBestAgent(): Promise<BestEvolvedAgent | null>;
}

// ── Recommendation ────────────────────────────────────────────────────────────

export interface PolicyRecommendation {
  params: PolicyParams;
  provenance: {
    agentId:        string;
    fitnessScore:   number | null;
    generation:     number | null;
    entryThreshold:  number;   // raw gene that became minStrength
    positionSizePct: number;   // raw gene that became tradeFractionOfCapital
    source:         string;
  };
}

// Safety rails so a degenerate genome can't produce a reckless live policy.
const MIN_STRENGTH_FLOOR = 0.05;
const MIN_STRENGTH_CEIL  = 0.95;
const TRADE_FRACTION_FLOOR = 0.01;
const TRADE_FRACTION_CEIL  = 0.50;

// Sensible fallbacks (match the orchestrator defaults) when a gene is non-finite.
const FALLBACK_MIN_STRENGTH = 0.3;
const FALLBACK_TRADE_FRACTION = 0.1;

/**
 * Map an evolved genome to live decision-policy parameters.
 *   minStrength            = clamp(entryThreshold / 100,  0.05 … 0.95)
 *   tradeFractionOfCapital = clamp(positionSizePct / 100, 0.01 … 0.50)
 */
export function genomeToPolicyParams(genome: AgentGenome): PolicyParams {
  const minStrength = Number.isFinite(genome.entryThreshold)
    ? clamp(genome.entryThreshold / 100, MIN_STRENGTH_FLOOR, MIN_STRENGTH_CEIL)
    : FALLBACK_MIN_STRENGTH;

  const tradeFractionOfCapital = Number.isFinite(genome.positionSizePct)
    ? clamp(genome.positionSizePct / 100, TRADE_FRACTION_FLOOR, TRADE_FRACTION_CEIL)
    : FALLBACK_TRADE_FRACTION;

  return { minStrength, tradeFractionOfCapital };
}

// ── Feeder ──────────────────────────────────────────────────────────────────────

export class MarlPolicyFeeder {
  constructor(private readonly provider: BestAgentProvider) {}

  /** Best-evolved-genome → live policy recommendation, or null when none exists yet. */
  async recommend(): Promise<PolicyRecommendation | null> {
    const best = await this.provider.getBestAgent();
    if (!best) return null;

    const params = genomeToPolicyParams(best.genome);
    return {
      params,
      provenance: {
        agentId:         best.agentId,
        fitnessScore:    best.fitnessScore ?? null,
        generation:      best.generation ?? null,
        entryThreshold:  best.genome.entryThreshold,
        positionSizePct: best.genome.positionSizePct,
        source:          best.source ?? 'best-evolved-agent',
      },
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
