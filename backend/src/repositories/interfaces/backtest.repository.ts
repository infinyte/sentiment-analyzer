import type { SimulationResult } from '../../services/backtesting-engine.js';

export type { SimulationResult };

// ── Lightweight summary returned by list() ────────────────────────────────────

export interface BacktestSummary {
  testId: string;
  symbols: string[];
  agentCount: number;
  topPerformer: string;
  createdAt: string;
}

// ── Repository interface ──────────────────────────────────────────────────────

export interface IBacktestRepository {
  /** Upsert a simulation result (keyed on result.testId). */
  save(result: SimulationResult): Promise<void>;
  /** Load full result payload, or null if not found. */
  findById(testId: string): Promise<SimulationResult | null>;
  /** List lightweight summaries ordered by creation time descending. */
  list(): Promise<BacktestSummary[]>;
  delete(testId: string): Promise<void>;
}
