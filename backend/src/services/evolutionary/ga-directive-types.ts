/**
 * ga-directive-types.ts
 *
 * Shared type definitions for Claude-driven genetic algorithm orchestration.
 *
 * After each generation completes, a PopulationReport is serialized and sent
 * to the Claude API.  Claude responds with a GenerationDirective that controls
 * how the next generation is bred, mutated, and sized.
 */

// ── GenerationDirective ───────────────────────────────────────────────────────

export interface GenerationDirective {
  /** Generation number this directive was produced for (the one that just ran). */
  generation: number;

  /** How aggressively to mutate offspring genes in the next generation. */
  mutationSeverity: 'LIGHT' | 'MEDIUM' | 'HEAVY';

  /**
   * Percentage of the ranked population kept as survivors (also sets the
   * retirement cutoff for bottom performers).  Valid range: 1–100.
   */
  survivalPercent: number;

  /** Crossover strategy applied when breeding survivors into offspring. */
  crossoverStrategy: 'UNIFORM' | 'BLENDED';

  /**
   * Optional population size override for the next generation's offspring
   * target.  When omitted, the tournament's original populationSize is used.
   */
  targetPopulationSize?: number;

  /**
   * Optional fitness threshold (0–100).  If any agent's fitness exceeds this
   * value the tournament stops early before running the next generation.
   * Omit to never stop early.
   */
  earlyStopIfFitnessAbove?: number;

  /**
   * When true, inject a cohort of fresh randomly-generated agents alongside
   * normal offspring to boost genetic diversity.
   */
  diversityBoost: boolean;

  /**
   * Claude's natural-language explanation of its decisions, referencing
   * observed population trends and the reasoning behind each parameter choice.
   */
  reasoning: string;
}

// ── PopulationReport ──────────────────────────────────────────────────────────

/** Per-agent metrics included in the report sent to Claude. */
export interface AgentMetric {
  agentId:  string;
  fitness:  number;  // 0–100 composite fitness score
  winRate:  number;  // 0–100
  sharpe:   number;  // raw Sharpe ratio (can be negative)
  pnl:      number;  // absolute dollar PnL
}

/** Population-level fitness statistics for the completed generation. */
export interface FitnessStats {
  mean:   number;
  stdDev: number;
  max:    number;
  min:    number;
  /** Change in mean fitness vs the previous generation (0 for generation 1). */
  trend:  number;
}

/**
 * Serialized snapshot of the population after a generation completes.
 * This is sent to Claude as context for producing the next GenerationDirective.
 */
export interface PopulationReport {
  /** The generation that just completed. */
  generation: number;

  /** Total number of generations configured for the tournament. */
  totalGenerations: number;

  /** Per-agent metrics sorted by fitness descending. */
  agents: AgentMetric[];

  /** Aggregate fitness statistics across the entire population. */
  fitnessStats: FitnessStats;
}
