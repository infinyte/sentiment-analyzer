/**
 * SelectionAlgorithm — Phase 3.2
 *
 * Determines which agents survive for breeding and which are candidates
 * for retirement.
 */

import { FitnessCalculator, type AgentStats } from './fitness-calculator.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelectionResult {
  survivors:            Array<AgentStats & { fitness: number }>;
  retirementCandidates: Array<AgentStats & { fitness: number }>;
  middleTier:           Array<AgentStats & { fitness: number }>;
}

// ── SelectionAlgorithm ────────────────────────────────────────────────────────

export class SelectionAlgorithm {
  private readonly calculator: FitnessCalculator;

  constructor(calculator: FitnessCalculator) {
    this.calculator = calculator;
  }

  /**
   * Partition agents into survivors, retirement candidates, and middle tier.
   *
   * - Top `survivalPercent`% → survivors (min 1)
   * - Bottom `survivalPercent`% → retirementCandidates (not overlapping survivors, min 0)
   * - Remaining → middleTier
   *
   * Special case: population of 1 yields 1 survivor, no retirement, no middle.
   */
  selectTopPercent(allStats: AgentStats[], survivalPercent: number): SelectionResult {
    const ranked = this.calculator.rankAgents(allStats);
    const n = ranked.length;

    if (n === 1) {
      return {
        survivors:            [ranked[0]!],
        retirementCandidates: [],
        middleTier:           [],
      };
    }

    const survivorCount    = Math.max(1, Math.floor(n * survivalPercent / 100));
    const retirementCount  = Math.max(0, Math.floor(n * survivalPercent / 100));

    // Ensure retirement candidates don't overlap with survivors
    const maxRetirement = Math.max(0, n - survivorCount);
    const actualRetirement = Math.min(retirementCount, maxRetirement);

    const survivors            = ranked.slice(0, survivorCount);
    const retirementCandidates = ranked.slice(n - actualRetirement);
    const middleTier           = ranked.slice(survivorCount, n - actualRetirement);

    return { survivors, retirementCandidates, middleTier };
  }

  /**
   * Run `count` tournaments; each picks `tournamentSize` random agents
   * and returns the winner (highest fitness).
   * May return duplicates if the same agent wins multiple rounds.
   */
  tournament(
    allStats: AgentStats[],
    tournamentSize: number,
    count: number,
  ): Array<AgentStats & { fitness: number }> {
    const ranked = this.calculator.rankAgents(allStats);
    const winners: Array<AgentStats & { fitness: number }> = [];

    for (let i = 0; i < count; i++) {
      // Pick `tournamentSize` random agents
      const shuffled = [...ranked].sort(() => Math.random() - 0.5);
      const contestants = shuffled.slice(0, Math.min(tournamentSize, ranked.length));

      // Winner = highest fitness (ranked[0] has highest, but after shuffle we compare)
      const winner = contestants.reduce((best, curr) =>
        curr.fitness > best.fitness ? curr : best,
      );
      winners.push(winner);
    }

    return winners;
  }

  /**
   * Roulette-wheel selection proportional to fitness.
   * If all fitness values are 0, falls back to uniform selection.
   * Returns `count` agents (with replacement).
   */
  roulette(allStats: AgentStats[], count: number): Array<AgentStats & { fitness: number }> {
    const ranked = this.calculator.rankAgents(allStats);
    const selected: Array<AgentStats & { fitness: number }> = [];

    const totalFitness = ranked.reduce((sum, a) => sum + a.fitness, 0);
    const useUniform = totalFitness === 0;

    for (let i = 0; i < count; i++) {
      if (useUniform) {
        const idx = Math.floor(Math.random() * ranked.length);
        selected.push(ranked[idx]!);
      } else {
        const spin = Math.random() * totalFitness;
        let cumulative = 0;
        let chosen = ranked[ranked.length - 1]!;
        for (const agent of ranked) {
          cumulative += agent.fitness;
          if (spin <= cumulative) {
            chosen = agent;
            break;
          }
        }
        selected.push(chosen);
      }
    }

    return selected;
  }
}
