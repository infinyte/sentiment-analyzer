/**
 * Tournament Worker Process
 *
 * Stand-alone Node.js process that consumes the `tournament` BullMQ queue and
 * executes MARL simulation competitions.  Run this separately from the API
 * server to move CPU-bound tournament work out of the main process.
 *
 * Only handles exchangeMode === 'SIMULATED' tournaments.  Real-money (PAPER /
 * LIVE) competitions stay on the main thread in the API process.
 *
 * Start (dev):   npx tsx src/workers/tournament-worker-process.ts
 * Start (prod):  node dist/workers/tournament-worker-process.js
 *
 * Required env vars:
 *   REDIS_URL          — Redis connection URL (shared with API process)
 *   DATABASE_PATH      — Path to SQLite file (shared with API process)
 */

import { Worker } from 'bullmq';
import { storage } from '../storage.js';
import { createRepositories } from '../repositories/factory.js';
import { MarlCompetitionEngine } from '../services/marl-competition-engine.js';
import { initPubSub, getPubSub, competitionChannel } from '../services/pubsub.js';
import type { TournamentJobData } from '../queues/tournament.queue.js';
import type { CompetitionResult } from '../services/marl-competition-engine.js';
import { createConnectionOptions } from '../queues/connection.js';
import logger from '../logger.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

logger.info('[tournament-worker] starting up');

storage.connect();
logger.info('[tournament-worker] SQLite connected');

await initPubSub();
logger.info('[tournament-worker] pubsub initialised');

// ── Worker ────────────────────────────────────────────────────────────────────

const worker = new Worker<TournamentJobData, CompetitionResult>(
  'tournament',
  async (job) => {
    const { competitionId, config } = job.data;

    // Guard: this worker must never handle real-money modes.
    if (config.exchangeMode === 'PAPER' || config.exchangeMode === 'LIVE') {
      throw new Error(
        `[tournament-worker] exchangeMode '${config.exchangeMode}' must run on the API main thread`
      );
    }

    logger.info('[tournament-worker] processing job', { jobId: job.id, competitionId });

    const repos  = createRepositories({ driver: 'sqlite', db: storage.getDb() });
    const engine = new MarlCompetitionEngine(repos.agents, repos.broker);
    const pubsub = getPubSub();
    const channel = competitionChannel(competitionId);

    const result = await engine.runCompetition(
      config,
      async (progress: number) => {
        // Report to BullMQ (enables QueueEvents 'progress' in the API process)
        await job.updateProgress(progress);
        // Publish to pubsub so SSE subscribers get live updates
        void pubsub.publish(channel, { type: 'progress', competitionId, progress });
      },
      competitionId,
    );

    // Signal completion via pubsub (SSE consumers don't poll QueueEvents)
    void pubsub.publish(channel, {
      type:            'completed',
      competitionId,
      topPerformerId:  result.finalRankings?.[0]?.agentId,
    });

    logger.info('[tournament-worker] job complete', {
      jobId: job.id,
      competitionId,
      topPerformerId: result.finalRankings?.[0]?.agentId,
    });

    return result;
  },
  {
    connection:  createConnectionOptions(),
    concurrency: parseInt(process.env['TOURNAMENT_WORKER_CONCURRENCY'] ?? '2', 10),
  },
);

// ── Error handling ────────────────────────────────────────────────────────────

worker.on('failed', (job, err) => {
  const competitionId = job?.data.competitionId;
  logger.error('[tournament-worker] job failed', {
    jobId:         job?.id,
    competitionId,
    error:         String(err),
  });

  // Notify SSE subscribers about the failure
  if (competitionId) {
    const pubsub  = getPubSub();
    const channel = competitionChannel(competitionId);
    void pubsub.publish(channel, {
      type:          'failed',
      competitionId,
      error:         err instanceof Error ? err.message : String(err),
    });
  }
});

worker.on('error', (err) => {
  logger.error('[tournament-worker] worker error', { error: String(err) });
});

logger.info('[tournament-worker] ready — waiting for jobs');

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info('[tournament-worker] received signal, shutting down', { signal });
  await worker.close();
  try { storage.close(); } catch { /* ignore */ }
  logger.info('[tournament-worker] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
