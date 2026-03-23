/**
 * Jest manual mock for worker-pool.ts
 *
 * worker-pool.ts uses import.meta.url which is ESM-only and cannot be compiled
 * in the CommonJS mode that ts-jest uses. This mock provides the same public
 * interface without needing worker threads or ESM-specific features.
 */

const makeHandle = () => ({
  taskId: 'mock-task-id',
  result: Promise.resolve({} as never),
  cancel: jest.fn(),
});

export class WorkerPool {
  runMarlCompetition = jest.fn().mockReturnValue(makeHandle());
  runBacktest        = jest.fn().mockReturnValue(makeHandle());

  get activeCount(): number {
    return 0;
  }

  terminateAll = jest.fn().mockResolvedValue(undefined);
}

export const workerPool = new WorkerPool();
