/**
 * FitnessCalculator — Phase 3.1
 *
 * fitness = (0.40 * win_rate_pct)
 *         + (0.35 * sharpe_normalized)   // map sharpe (-2 to +5) → (0 to 100)
 *         + (0.25 * pnl_normalized)      // map PnL to percentile among all agents
 *
 * All three components are 0–100, so the result is also 0–100.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentStats {
  agentId:           string;
  winRatePct:        number;  // 0–100
  sharpeRatio:       number;  // can be negative, typically -2 to +5
  totalPnl:          number;  // absolute dollar amount
  totalCompetitions: number;
}

// ── FitnessCalculator ─────────────────────────────────────────────────────────

export class FitnessCalculator {

  /**
   * Compute a 0–100 fitness score for a single agent given all agents' stats.
   */
  calculateFitness(stats: AgentStats, allStats: AgentStats[]): number {
    const winRateComponent  = 0.40 * stats.winRatePct;
    const sharpeComponent   = 0.35 * this.normalizeLinear(stats.sharpeRatio, -2, 5);
    const pnlComponent      = 0.25 * this.getPnlPercentile(stats, allStats);

    const raw = winRateComponent + sharpeComponent + pnlComponent;
    return Math.max(0, Math.min(100, raw));
  }

  /**
   * Rank all agents by fitness, highest first.
   */
  rankAgents(allStats: AgentStats[]): Array<AgentStats & { fitness: number }> {
    const withFitness = allStats.map(s => ({
      ...s,
      fitness: this.calculateFitness(s, allStats),
    }));
    return withFitness.sort((a, b) => b.fitness - a.fitness);
  }

  /**
   * Return the top `count` agents by fitness.
   */
  getTop(allStats: AgentStats[], count: number): Array<AgentStats & { fitness: number }> {
    return this.rankAgents(allStats).slice(0, count);
  }

  /**
   * Clamp and map `value` from [min, max] to [0, 100].
   * Values outside the range are clamped.
   */
  getNormalizedScore(value: number, min: number, max: number): number {
    return this.normalizeLinear(value, min, max);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Map `value` linearly from [min, max] → [0, 100], clamped.
   */
  private normalizeLinear(value: number, min: number, max: number): number {
    if (max === min) return 50;
    const normalized = ((value - min) / (max - min)) * 100;
    return Math.max(0, Math.min(100, normalized));
  }

  /**
   * Return the PnL percentile (0–100) of `stats` among `allStats`.
   * 0 = worst, 100 = best.
   * If there is only one agent, return 50.
   * Ties are broken by ordinal rank (first occurrence wins lower rank).
   */
  private getPnlPercentile(stats: AgentStats, allStats: AgentStats[]): number {
    const n = allStats.length;
    if (n <= 1) return 50;

    // Sort by PnL ascending so we can determine rank
    const sorted = [...allStats].sort((a, b) => a.totalPnl - b.totalPnl);

    // Find the ordinal index of this agent (by agentId)
    const index = sorted.findIndex(s => s.agentId === stats.agentId);
    if (index === -1) {
      // Agent not found in allStats — default to 50th percentile
      return 50;
    }

    // index 0 = worst (0), index n-1 = best (100)
    return (index / (n - 1)) * 100;
  }
}
