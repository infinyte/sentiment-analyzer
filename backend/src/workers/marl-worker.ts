/**
 * MARL Simulation Worker
 *
 * Handles CPU-bound MARL tournaments (SINGLE and EVOLUTIONARY modes with
 * exchangeMode === 'SIMULATED'). Real-money and continuous-learning modes
 * are NOT routed here — they require the main-thread event loop for
 * setInterval-based wall-clock ticking and real broker I/O.
 *
 * Lifecycle:
 *   1. Receives task via workerData (structured-clone, no class instances).
 *   2. Connects the SQLite storage singleton (fresh connection in this thread).
 *   3. Creates MarlCompetitionEngine (constructor loads learning states from DB).
 *   4. Runs the competition, streaming PROGRESS messages back to the main thread.
 *   5. Posts RESULT or ERROR, then the worker process exits.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { storage } from '../storage.js';
import { createRepositories } from '../repositories/factory.js';
import { MarlCompetitionEngine } from '../services/marl-competition-engine.js';
import type { MarlTaskData } from './types.js';

const { taskId, config, competitionId } = workerData as MarlTaskData;

// Guard: this worker must never handle real-money modes.
if (config.exchangeMode === 'PAPER' || config.exchangeMode === 'LIVE') {
  parentPort!.postMessage({
    type:  'ERROR',
    taskId,
    error: `[marl-worker] exchangeMode '${config.exchangeMode}' must run on the main thread — refusing`,
  });
  process.exit(1);
}

// Open a fresh SQLite connection for this worker thread.
// WAL mode (set by the main-thread connection) allows concurrent reads/writes.
storage.connect();
const repos = createRepositories({ driver: 'sqlite', db: storage.getDb() });

try {
  const engine = new MarlCompetitionEngine(repos.agents, repos.broker);

  const result = await engine.runCompetition(
    config,
    (progress: number) => {
      parentPort!.postMessage({ type: 'PROGRESS', taskId, progress });
    },
    competitionId,
  );

  parentPort!.postMessage({ type: 'RESULT', taskId, result });
} catch (err) {
  parentPort!.postMessage({
    type:  'ERROR',
    taskId,
    error: err instanceof Error ? err.message : String(err),
  });
} finally {
  // Close our worker-owned DB connection cleanly before the thread exits.
  try { storage.close(); } catch { /* ignore */ }
}
