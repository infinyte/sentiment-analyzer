/**
 * Tournament BullMQ queue.
 *
 * Producers (API process) call `getTournamentQueue()` to enqueue a competition.
 * Consumers (tournament-worker-process) create a `Worker` against the same
 * queue name.
 *
 * Job ID === competitionId so `QueueEvents` listeners can map completions back
 * to the in-memory competition registry in the API process.
 */

import { Queue } from 'bullmq';
import type { CompetitionConfig } from '../services/marl-competition-engine.js';
import { createConnectionOptions } from './connection.js';

// ── Job payload ───────────────────────────────────────────────────────────────

export interface TournamentJobData {
  competitionId: string;
  config:        CompetitionConfig;
}

// ── Queue singleton ───────────────────────────────────────────────────────────

let _queue: Queue<TournamentJobData> | null = null;

export function getTournamentQueue(): Queue<TournamentJobData> {
  if (!_queue) {
    _queue = new Queue<TournamentJobData>('tournament', {
      connection: createConnectionOptions(),
      defaultJobOptions: {
        attempts:         1,   // tournaments are not retried on failure
        removeOnComplete: 100,
        removeOnFail:     100,
      },
    });
  }
  return _queue;
}

export async function closeTournamentQueue(): Promise<void> {
  if (_queue) {
    const q = _queue;
    _queue = null;
    await q.close();
  }
}
