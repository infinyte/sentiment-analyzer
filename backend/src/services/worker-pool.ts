/**
 * WorkerPool
 *
 * Spawns Node.js Worker Threads for CPU-bound tasks (MARL simulations and
 * backtesting) so that the main Express event loop remains responsive during
 * long-running computations.
 *
 * Each call to runMarlCompetition() / runBacktest() spawns a fresh Worker for
 * the task. The startup cost (~100 ms) is negligible compared to the minutes
 * that tournament and backtest runs take.
 *
 * Worker file resolution:
 *   • Development (NODE_ENV !== 'production'): loads the .ts file directly
 *     with tsx registered as an ES-module loader.
 *   • Production (NODE_ENV === 'production'): loads the compiled .js file from
 *     the same relative position under dist/.
 */

import { Worker }         from 'node:worker_threads';
import { fileURLToPath }  from 'node:url';
import { dirname, join }  from 'node:path';
import type { CompetitionConfig, CompetitionResult } from './marl-competition-engine.js';
import type { BacktestConfig, SimulationResult }    from './backtesting-engine.js';
import type { WorkerOutMessage }                     from '../workers/types.js';
import { getPubSub, competitionChannel }             from './pubsub.js';
import logger                                        from '../logger.js';

// ── Path helpers ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect if we're running from compiled dist/ output or from source.
// When running from dist/, always use .js files regardless of NODE_ENV.
// When running from src/, use .ts with tsx loader in development, .js otherwise.
const IS_COMPILED = __dirname.includes('dist');
const IS_DEV      = process.env['NODE_ENV'] !== 'production' && !IS_COMPILED;
const EXT         = IS_DEV ? 'ts' : 'js';
// tsx v4: --import tsx (works for both CJS and ESM graphs)
const EXEC_ARGV: string[] = IS_DEV ? ['--import', 'tsx'] : [];

function workerPath(name: string): string {
  return join(__dirname, '..', 'workers', `${name}.${EXT}`);
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface TaskHandle<T> {
  taskId:  string;
  result:  Promise<T>;
  /** Terminate the underlying Worker and reject the result promise. */
  cancel(): void;
}

// ── WorkerPool ─────────────────────────────────────────────────────────────────

export class WorkerPool {
  private readonly activeWorkers = new Map<string, Worker>();

  /**
   * Run a MARL competition on a Worker Thread.
   *
   * Only valid for exchangeMode === 'SIMULATED' (the default).
   * PAPER / LIVE modes use real broker I/O and must stay on the main thread.
   */
  runMarlCompetition(
    competitionId: string,
    config:        CompetitionConfig,
    onProgress?:   (progress: number) => void,
  ): TaskHandle<CompetitionResult> {
    logger.info('[worker-pool] spawning MARL simulation worker', { competitionId });

    const channel  = competitionChannel(competitionId);
    const pubsub   = getPubSub();

    const progressHandler = (progress: number) => {
      onProgress?.(progress);
      void pubsub.publish(channel, { type: 'progress', competitionId, progress });
    };

    const handle = this.spawn<CompetitionResult>(
      workerPath('marl-worker'),
      { taskId: competitionId, type: 'MARL_SIMULATION', config, competitionId },
      progressHandler,
    );

    // Publish completion / failure events so SSE subscribers don't have to poll.
    handle.result
      .then((result) => {
        void pubsub.publish(channel, {
          type: 'completed',
          competitionId,
          topPerformerId: result.finalRankings?.[0]?.agentId,
        });
      })
      .catch((err: unknown) => {
        void pubsub.publish(channel, {
          type: 'failed',
          competitionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return handle;
  }

  /**
   * Run a backtest on a Worker Thread.
   * The caller can `await handle.result` without blocking the event loop.
   */
  runBacktest(
    taskId: string,
    config: BacktestConfig,
  ): TaskHandle<SimulationResult> {
    logger.info('[worker-pool] spawning backtest worker', { taskId });
    return this.spawn<SimulationResult>(
      workerPath('backtest-worker'),
      { taskId, type: 'BACKTEST', config },
    );
  }

  /** Number of workers currently running. */
  get activeCount(): number {
    return this.activeWorkers.size;
  }

  /** Terminate all running workers — call during server shutdown. */
  async terminateAll(): Promise<void> {
    const workers = [...this.activeWorkers.values()];
    this.activeWorkers.clear();
    await Promise.allSettled(workers.map(w => w.terminate()));
    logger.info('[worker-pool] all workers terminated');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private spawn<T>(
    path:        string,
    taskData:    { taskId: string; [k: string]: unknown },
    onProgress?: (progress: number) => void,
  ): TaskHandle<T> {
    const { taskId } = taskData;

    const worker = new Worker(path, {
      workerData: taskData,
      execArgv:   EXEC_ARGV,
    });

    this.activeWorkers.set(taskId, worker);

    let resolve!: (v: T) => void;
    let reject!:  (e: Error) => void;
    const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });

    worker.on('message', (msg: WorkerOutMessage) => {
      if (msg.taskId !== taskId) return;

      switch (msg.type) {
        case 'PROGRESS':
          onProgress?.(msg.progress);
          break;

        case 'RESULT':
          this.activeWorkers.delete(taskId);
          resolve(msg.result as T);
          break;

        case 'ERROR':
          this.activeWorkers.delete(taskId);
          logger.error('[worker-pool] worker task failed', { taskId, error: msg.error });
          reject(new Error(msg.error));
          break;
      }
    });

    worker.on('error', (err: Error) => {
      this.activeWorkers.delete(taskId);
      logger.error('[worker-pool] worker threw unhandled error', { taskId, error: err.message });
      reject(err);
    });

    worker.on('exit', (code: number) => {
      if (this.activeWorkers.has(taskId)) {
        this.activeWorkers.delete(taskId);
        reject(new Error(`[worker-pool] worker exited unexpectedly with code ${code}`));
      }
    });

    return {
      taskId,
      result,
      cancel: () => {
        this.activeWorkers.delete(taskId);
        void worker.terminate();
        reject(new Error('[worker-pool] task cancelled by caller'));
      },
    };
  }
}

// Module-level singleton — shared across all route handlers.
export const workerPool = new WorkerPool();
