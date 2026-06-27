import {
  genomeToPolicyParams,
  MarlPolicyFeeder,
  type BestAgentProvider,
  type BestEvolvedAgent,
} from '../../services/agent/marl-policy-feeder.js';
import { createDefaultGenome, type AgentGenome } from '../../services/evolutionary/agent-genome.js';

function genome(over: Partial<AgentGenome> = {}): AgentGenome {
  return { ...createDefaultGenome(), ...over };
}

// ── Pure mapping ────────────────────────────────────────────────────────────

describe('genomeToPolicyParams', () => {
  it('maps entryThreshold → minStrength and positionSizePct → tradeFractionOfCapital', () => {
    const params = genomeToPolicyParams(genome({ entryThreshold: 55, positionSizePct: 15 }));
    expect(params.minStrength).toBeCloseTo(0.55, 10);
    expect(params.tradeFractionOfCapital).toBeCloseTo(0.15, 10);
  });

  it('maps the gene-bound extremes within safe rails', () => {
    const low  = genomeToPolicyParams(genome({ entryThreshold: 30, positionSizePct: 5 }));
    expect(low.minStrength).toBeCloseTo(0.30, 10);
    expect(low.tradeFractionOfCapital).toBeCloseTo(0.05, 10);

    const high = genomeToPolicyParams(genome({ entryThreshold: 80, positionSizePct: 30 }));
    expect(high.minStrength).toBeCloseTo(0.80, 10);
    expect(high.tradeFractionOfCapital).toBeCloseTo(0.30, 10);
  });

  it('clamps degenerate genes to the safety rails', () => {
    const params = genomeToPolicyParams(genome({ entryThreshold: 200, positionSizePct: 90 }));
    expect(params.minStrength).toBe(0.95);              // ceil
    expect(params.tradeFractionOfCapital).toBe(0.50);   // ceil
  });

  it('falls back to orchestrator defaults for non-finite genes', () => {
    const params = genomeToPolicyParams(genome({ entryThreshold: NaN, positionSizePct: NaN }));
    expect(params.minStrength).toBe(0.3);
    expect(params.tradeFractionOfCapital).toBe(0.1);
  });
});

// ── Feeder ──────────────────────────────────────────────────────────────────

const provider = (agent: BestEvolvedAgent | null): BestAgentProvider => ({
  getBestAgent: async () => agent,
});

describe('MarlPolicyFeeder', () => {
  it('recommends params + provenance from the best evolved agent', async () => {
    const feeder = new MarlPolicyFeeder(provider({
      agentId: 'agent-7',
      genome: genome({ entryThreshold: 60, positionSizePct: 20 }),
      fitnessScore: 88.5,
      generation: 4,
      source: 'leaderboard-top',
    }));

    const rec = await feeder.recommend();
    expect(rec).not.toBeNull();
    expect(rec!.params).toEqual({ minStrength: 0.60, tradeFractionOfCapital: 0.20 });
    expect(rec!.provenance).toMatchObject({
      agentId: 'agent-7',
      fitnessScore: 88.5,
      generation: 4,
      entryThreshold: 60,
      positionSizePct: 20,
      source: 'leaderboard-top',
    });
  });

  it('returns null when there is no evolved agent yet', async () => {
    expect(await new MarlPolicyFeeder(provider(null)).recommend()).toBeNull();
  });

  it('defaults provenance fields when the provider omits them', async () => {
    const feeder = new MarlPolicyFeeder(provider({ agentId: 'a1', genome: genome() }));
    const rec = await feeder.recommend();
    expect(rec!.provenance.fitnessScore).toBeNull();
    expect(rec!.provenance.generation).toBeNull();
    expect(rec!.provenance.source).toBe('best-evolved-agent');
  });
});
