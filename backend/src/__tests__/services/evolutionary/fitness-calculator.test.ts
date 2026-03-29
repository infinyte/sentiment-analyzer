import { FitnessCalculator, type AgentStats } from '../../../services/evolutionary/fitness-calculator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    agentId:           'agent-1',
    winRatePct:        50,
    sharpeRatio:       1.5,
    totalPnl:          500,
    totalCompetitions: 10,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FitnessCalculator', () => {
  let calc: FitnessCalculator;

  beforeEach(() => {
    calc = new FitnessCalculator();
  });

  // ── Basic fitness calculation ─────────────────────────────────────────────

  it('returns a score between 0 and 100 for a normal agent', () => {
    const stats = makeStats();
    const score = calc.calculateFitness(stats, [stats]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns minimum score for an agent with all-zero stats (PnL percentile = 50 for single agent)', () => {
    const stats: AgentStats = { agentId: 'a', winRatePct: 0, sharpeRatio: -2, totalPnl: 0, totalCompetitions: 0 };
    const score = calc.calculateFitness(stats, [stats]);
    // winRate=0, sharpe normalized to 0, pnl percentile=50 (single agent)
    // 0 + 0 + 0.25 * 50 = 12.5
    expect(score).toBeCloseTo(12.5, 1);
  });

  it('higher winRatePct produces higher fitness (with equal PnL)', () => {
    // Give both agents equal pnl so PnL percentile doesn't interfere
    const low  = makeStats({ agentId: 'low',  winRatePct: 20, sharpeRatio: 0, totalPnl: 500 });
    const high = makeStats({ agentId: 'high', winRatePct: 80, sharpeRatio: 0, totalPnl: 500 });
    // Both in allStats — PnL percentile differs by sort stability but win rate dominates the 40% weight
    // Safe: compare each agent against itself to isolate winRate effect
    const lowScore  = calc.calculateFitness(low,  [low]);
    const highScore = calc.calculateFitness(high, [high]);
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('higher sharpeRatio produces higher fitness (all else equal)', () => {
    const low  = makeStats({ agentId: 'low',  sharpeRatio: -1 });
    const high = makeStats({ agentId: 'high', sharpeRatio:  3 });
    const all  = [low, high];
    expect(calc.calculateFitness(high, all)).toBeGreaterThan(calc.calculateFitness(low, all));
  });

  it('higher totalPnl produces higher fitness (all else equal)', () => {
    const low  = makeStats({ agentId: 'low',  winRatePct: 50, sharpeRatio: 1, totalPnl: -100 });
    const high = makeStats({ agentId: 'high', winRatePct: 50, sharpeRatio: 1, totalPnl:  900 });
    const all  = [low, high];
    expect(calc.calculateFitness(high, all)).toBeGreaterThan(calc.calculateFitness(low, all));
  });

  // ── Single agent edge case ────────────────────────────────────────────────

  it('returns 50th percentile for PnL when there is only one agent', () => {
    const stats = makeStats({ winRatePct: 0, sharpeRatio: -2, totalPnl: 999 });
    // winRate=0, sharpe=-2→0, pnl=50th percentile (12.5)
    const score = calc.calculateFitness(stats, [stats]);
    expect(score).toBeCloseTo(0 + 0 + 0.25 * 50, 1);
  });

  // ── rankAgents ────────────────────────────────────────────────────────────

  it('rankAgents returns agents sorted highest-first', () => {
    // Give distinct PnL so percentile order is predictable: a→low, b→high, c→mid
    const a = makeStats({ agentId: 'a', winRatePct: 10, sharpeRatio: 0, totalPnl: 100 });
    const b = makeStats({ agentId: 'b', winRatePct: 90, sharpeRatio: 4, totalPnl: 900 });
    const c = makeStats({ agentId: 'c', winRatePct: 50, sharpeRatio: 2, totalPnl: 500 });
    const ranked = calc.rankAgents([a, b, c]);
    // b has highest winRate + sharpe + pnl → ranks first; a has lowest → ranks last
    expect(ranked[0]!.agentId).toBe('b');
    expect(ranked[2]!.agentId).toBe('a');
  });

  // ── getTop ────────────────────────────────────────────────────────────────

  it('getTop returns the specified number of top agents', () => {
    const agents = [
      makeStats({ agentId: 'x', winRatePct: 10 }),
      makeStats({ agentId: 'y', winRatePct: 40 }),
      makeStats({ agentId: 'z', winRatePct: 70 }),
    ];
    const top2 = calc.getTop(agents, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0]!.agentId).toBe('z');
    expect(top2[1]!.agentId).toBe('y');
  });

  // ── Adversary inversion ───────────────────────────────────────────────────

  it('adversary fitness equals 100 minus its own raw score', () => {
    const agent: AgentStats = makeStats({ agentId: 'a', winRatePct: 70, sharpeRatio: 2 });
    const allStats = [agent];

    const rawScore      = calc.calculateFitness(agent, allStats);
    const adversaryScore = calc.calculateFitness({ ...agent, agentType: 'ADVERSARY' }, allStats);

    expect(adversaryScore).toBeCloseTo(100 - rawScore, 1);
  });

  it('adversary with zero stats receives high inverted fitness (~87.5)', () => {
    // winRate=0, sharpe=-2→0, pnl percentile=50 (single) → raw=12.5 → inverted=87.5
    const adversary: AgentStats = { agentId: 'adv', winRatePct: 0, sharpeRatio: -2, totalPnl: 0, totalCompetitions: 0, agentType: 'ADVERSARY' };
    const score = calc.calculateFitness(adversary, [adversary]);
    expect(score).toBeCloseTo(87.5, 1);
  });

  it('adversary with perfect stats receives low inverted fitness (~12.5)', () => {
    // winRate=100, sharpe=5, pnl percentile=50 (single) → raw=87.5 → inverted=12.5
    const adversary: AgentStats = { agentId: 'adv', winRatePct: 100, sharpeRatio: 5, totalPnl: 9999, totalCompetitions: 10, agentType: 'ADVERSARY' };
    const score = calc.calculateFitness(adversary, [adversary]);
    expect(score).toBeCloseTo(12.5, 1);
  });

  // ── beatsAdversary bonus ──────────────────────────────────────────────────

  it('applies +10% bonus for sentiment agents that beat an adversary', () => {
    // Use a single-element allStats so PnL percentile is the same (50) for both computations
    const base = makeStats({ agentId: 'a', winRatePct: 50, sharpeRatio: 1 });
    const allStats = [base];

    const baseScore    = calc.calculateFitness(base, allStats);
    const boostedScore = calc.calculateFitness({ ...base, beatsAdversary: true }, allStats);

    expect(boostedScore).toBeCloseTo(Math.min(100, baseScore * 1.1), 1);
    expect(boostedScore).toBeGreaterThan(baseScore);
  });

  it('bonus is capped at 100', () => {
    const boosted: AgentStats = { agentId: 'a', winRatePct: 100, sharpeRatio: 5, totalPnl: 9999, totalCompetitions: 10, beatsAdversary: true };
    const score = calc.calculateFitness(boosted, [boosted]);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('adversary flag takes precedence over beatsAdversary', () => {
    // An adversary with beatsAdversary=true should still be inverted, not boosted
    const base: AgentStats = { agentId: 'a', winRatePct: 70, sharpeRatio: 2, totalPnl: 500, totalCompetitions: 5 };
    const allStats = [base];

    const rawScore      = calc.calculateFitness(base, allStats);
    const adversaryScore = calc.calculateFitness({ ...base, agentType: 'ADVERSARY', beatsAdversary: true }, allStats);

    // Should be inverted (100 - raw), not boosted (raw * 1.1)
    expect(adversaryScore).toBeCloseTo(100 - rawScore, 1);
  });

  // ── getNormalizedScore ────────────────────────────────────────────────────

  it('getNormalizedScore maps [min,max] to [0,100]', () => {
    expect(calc.getNormalizedScore(0,   0, 100)).toBe(0);
    expect(calc.getNormalizedScore(100, 0, 100)).toBe(100);
    expect(calc.getNormalizedScore(50,  0, 100)).toBe(50);
  });

  it('getNormalizedScore clamps values outside range', () => {
    expect(calc.getNormalizedScore(-10, 0, 100)).toBe(0);
    expect(calc.getNormalizedScore(110, 0, 100)).toBe(100);
  });

  it('getNormalizedScore returns 50 when min === max', () => {
    expect(calc.getNormalizedScore(5, 5, 5)).toBe(50);
  });
});
