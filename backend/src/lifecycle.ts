import cron from 'node-cron';
import type { Server } from 'node:http';
import app, {
  port,
  logOpenBrokerOrderWarning,
  runMidnightResetJob,
  runSentimentCronJob,
  runSocialCronJob,
  runTrendingCronJob,
} from './app.js';
import { initPubSub, closePubSub } from './services/pubsub.js';
import { configService } from './services/config-service.js';
import { appConfigService } from './services/app-config-service.js';
import { workerPool } from './services/worker-pool.js';
import { storage } from './storage.js';
import { socialStore } from './database/sqlite-social-store.js';
import { closeQueueEventsListener } from './routes/marl-competition.js';
import { brokerRegistry } from './services/brokers/broker-registry.js';
import { tournamentScheduler } from './services/tournament-scheduler.js';
import logger from './logger.js';

function getSentimentCronSchedule(): string {
  return appConfigService.get('SENTIMENT_JOB_CRON') ?? '0 2 * * *';
}

function getTrendingCronSchedule(): string {
  return appConfigService.get('TRENDING_JOB_CRON') ?? '*/30 * * * *';
}

function getSocialCronSchedule(): string {
  return appConfigService.get('SOCIAL_SCRAPE_CRON') ?? '0 * * * *';
}

let server: Server | null = null;
let shutdownInFlight: Promise<void> | null = null;
let signalHandlersRegistered = false;
let runtimeStarted = false;
let cronWatchersRegistered = false;
const scheduledTasks: cron.ScheduledTask[] = [];

function registerSignalHandlers(): void {
  if (signalHandlersRegistered) return;

  process.on('SIGTERM', () => {
    void shutdownRuntime({ exitProcess: true });
  });

  process.on('SIGINT', () => {
    void shutdownRuntime({ exitProcess: true });
  });

  signalHandlersRegistered = true;
}

function scheduleRecurringJobs(): void {
  const sentimentCronSchedule = getSentimentCronSchedule();
  const trendingCronSchedule = getTrendingCronSchedule();
  const socialCronSchedule = getSocialCronSchedule();

  scheduledTasks.push(cron.schedule(sentimentCronSchedule, () => {
    void runSentimentCronJob(sentimentCronSchedule);
  }));

  scheduledTasks.push(cron.schedule(trendingCronSchedule, () => {
    void runTrendingCronJob();
  }));

  scheduledTasks.push(cron.schedule(socialCronSchedule, () => {
    void runSocialCronJob();
  }));

  scheduledTasks.push(cron.schedule('0 0 * * *', () => {
    runMidnightResetJob();
  }));
}

function stopRecurringJobs(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks.splice(0, scheduledTasks.length);
}

function rescheduleRecurringJobs(changedKey: string): void {
  if (!runtimeStarted) return;
  stopRecurringJobs();
  scheduleRecurringJobs();
  logger.info('cron schedules reloaded from app config', {
    changedKey,
    sentiment: getSentimentCronSchedule(),
    trending: getTrendingCronSchedule(),
    social: getSocialCronSchedule(),
  });
}

function registerCronConfigWatchers(): void {
  if (cronWatchersRegistered) return;

  appConfigService.onChange('SENTIMENT_JOB_CRON', () => {
    rescheduleRecurringJobs('SENTIMENT_JOB_CRON');
  });
  appConfigService.onChange('TRENDING_JOB_CRON', () => {
    rescheduleRecurringJobs('TRENDING_JOB_CRON');
  });
  appConfigService.onChange('SOCIAL_SCRAPE_CRON', () => {
    rescheduleRecurringJobs('SOCIAL_SCRAPE_CRON');
  });

  cronWatchersRegistered = true;
}

export function startRuntime(): void {
  if (server) return;

  void initPubSub();
  void configService.init();
  logOpenBrokerOrderWarning();

  server = app.listen(port, () => {
    logger.info('server started', { port, env: process.env.NODE_ENV || 'development' });
  });

  scheduleRecurringJobs();
  registerCronConfigWatchers();
  registerSignalHandlers();

  if (storage.isHealthy()) {
    tournamentScheduler.start(storage.getDb());
  }

  runtimeStarted = true;
}

export async function shutdownRuntime(options: { exitProcess?: boolean } = {}): Promise<void> {
  const { exitProcess = false } = options;

  if (!runtimeStarted && !shutdownInFlight) {
    if (exitProcess) process.exit(0);
    return;
  }

  if (shutdownInFlight) {
    await shutdownInFlight;
    if (exitProcess) process.exit(0);
    return;
  }

  shutdownInFlight = (async () => {
    stopRecurringJobs();
    tournamentScheduler.stop();

    if (server) {
      await new Promise<void>(resolve => {
        server?.close(() => resolve());
      });
      server = null;
    }

    await Promise.allSettled([
      brokerRegistry.disconnectAll(),
      workerPool.terminateAll(),
      closePubSub(),
      closeQueueEventsListener(),
    ]);

    storage.close();
    socialStore.close();
    runtimeStarted = false;
  })();

  try {
    await shutdownInFlight;
  } finally {
    shutdownInFlight = null;
  }

  if (exitProcess) process.exit(0);
}
