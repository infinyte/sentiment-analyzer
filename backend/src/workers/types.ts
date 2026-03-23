/**
 * Shared message types for worker ↔ main-thread communication.
 *
 * IMPORTANT: all values must be serialisable via the Structured Clone
 * Algorithm (no functions, no class instances, no WeakRefs, etc.).
 * Date objects ARE preserved by structured clone.
 */

import type { CompetitionConfig, CompetitionResult } from '../services/marl-competition-engine.js';
import type { BacktestConfig, SimulationResult } from '../services/backtesting-engine.js';

// ── Task messages: main thread → worker (passed as workerData) ────────────────

export interface MarlTaskData {
  taskId:        string;
  type:          'MARL_SIMULATION';
  config:        CompetitionConfig;
  competitionId: string;
}

export interface BacktestTaskData {
  taskId: string;
  type:   'BACKTEST';
  config: BacktestConfig;
}

export type WorkerTaskData = MarlTaskData | BacktestTaskData;

// ── Response messages: worker → main thread (via parentPort.postMessage) ──────

export interface ProgressMessage {
  type:     'PROGRESS';
  taskId:   string;
  progress: number; // 0–100
}

export interface MarlResultMessage {
  type:   'RESULT';
  taskId: string;
  result: CompetitionResult;
}

export interface BacktestResultMessage {
  type:   'RESULT';
  taskId: string;
  result: SimulationResult;
}

export interface ErrorMessage {
  type:   'ERROR';
  taskId: string;
  error:  string;
}

export type WorkerOutMessage =
  | ProgressMessage
  | MarlResultMessage
  | BacktestResultMessage
  | ErrorMessage;
