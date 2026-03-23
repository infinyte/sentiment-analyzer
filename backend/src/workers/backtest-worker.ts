/**
 * Backtest Worker
 *
 * Runs BacktestingEngine.runSimulation() on a dedicated OS thread so that
 * the synchronous day-by-day simulation loop never blocks the main event loop.
 * The HTTP route can `await` the worker result and the server stays responsive.
 *
 * Date fields in BacktestConfig are preserved by the Structured Clone Algorithm,
 * so no manual serialisation/deserialisation is required.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { BacktestingEngine } from '../services/backtesting-engine.js';
import type { BacktestTaskData } from './types.js';

const { taskId, config } = workerData as BacktestTaskData;

try {
  const engine = new BacktestingEngine();
  // runSimulation is declared async; any synchronous CPU work inside still
  // executes on this worker's thread, leaving the main event loop free.
  const result = await engine.runSimulation(config);

  parentPort!.postMessage({ type: 'RESULT', taskId, result });
} catch (err) {
  parentPort!.postMessage({
    type:  'ERROR',
    taskId,
    error: err instanceof Error ? err.message : String(err),
  });
}
