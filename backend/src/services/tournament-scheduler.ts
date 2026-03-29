/**
 * TournamentSchedulerService
 *
 * Persists tournament schedules in SQLite and fires them at the right time.
 *
 * Schedule types:
 *   - Recurring: cron_expression set, run_at null  → node-cron ScheduledTask
 *   - One-shot:  run_at set, cron_expression null  → setTimeout; auto-disabled after run
 *
 * Lifecycle:
 *   start(db) — called from lifecycle.ts on server boot; loads all enabled schedules
 *   stop()    — called from lifecycle.ts on shutdown; cancels all tasks/timeouts
 */

import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CompetitionConfig } from './marl-competition-engine.js';
import { tournamentService } from './tournament-service.js';
import { workerPool } from './worker-pool.js';
import { isQueueAvailable } from '../queues/connection.js';
import { getTournamentQueue } from '../queues/tournament.queue.js';
import { engine } from '../routes/marl-competition.js';
import logger from '../logger.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface TournamentSchedule {
  id: string;
  name: string;
  cronExpression: string | null;
  runAt: string | null;
  config: CompetitionConfig;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  name: string;
  cronExpression?: string;
  runAt?: string;
  config: CompetitionConfig;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  /** Pass null to clear an existing cron expression. */
  cronExpression?: string | null;
  /** Pass null to clear an existing run_at. */
  runAt?: string | null;
  config?: CompetitionConfig;
  enabled?: boolean;
}

// ── Internal DB row shape ─────────────────────────────────────────────────────

interface ScheduleRow {
  id: string;
  name: string;
  cron_expression: string | null;
  run_at: string | null;
  config: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSchedule(row: ScheduleRow): TournamentSchedule {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    runAt: row.run_at,
    config: JSON.parse(row.config) as CompetitionConfig,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TournamentSchedulerService {
  private db: Database.Database | null = null;
  private readonly cronTasks = new Map<string, cron.ScheduledTask>();
  private readonly oneShots = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(db: Database.Database): void {
    if (this.started) return;
    this.db = db;
    this.started = true;

    const all = this.listSchedules();
    let queued = 0;
    for (const s of all) {
      if (s.enabled) {
        this.scheduleOne(s);
        queued++;
      }
    }
    logger.info('[tournament-scheduler] started', { total: all.length, queued });
  }

  stop(): void {
    if (!this.started) return;

    for (const task of this.cronTasks.values()) task.stop();
    this.cronTasks.clear();

    for (const timeout of this.oneShots.values()) clearTimeout(timeout);
    this.oneShots.clear();

    this.started = false;
    logger.info('[tournament-scheduler] stopped');
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  createSchedule(input: CreateScheduleInput): TournamentSchedule {
    const db = this.requireDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    // next_run_at is informational: use run_at for one-shot, null for cron (managed internally)
    const nextRunAt = input.cronExpression ? null : (input.runAt ?? null);

    db.prepare(`
      INSERT INTO tournament_schedules
        (id, name, cron_expression, run_at, config, enabled, next_run_at, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.cronExpression ?? null,
      input.runAt ?? null,
      JSON.stringify(input.config),
      (input.enabled ?? true) ? 1 : 0,
      nextRunAt,
      now,
      now,
    );

    const schedule = this.getSchedule(id)!;
    if (this.started && schedule.enabled) this.scheduleOne(schedule);
    return schedule;
  }

  listSchedules(): TournamentSchedule[] {
    const rows = this.requireDb()
      .prepare(`SELECT * FROM tournament_schedules ORDER BY created_at DESC`)
      .all() as ScheduleRow[];
    return rows.map(rowToSchedule);
  }

  getSchedule(id: string): TournamentSchedule | null {
    const row = this.requireDb()
      .prepare(`SELECT * FROM tournament_schedules WHERE id = ?`)
      .get(id) as ScheduleRow | undefined;
    return row ? rowToSchedule(row) : null;
  }

  updateSchedule(id: string, input: UpdateScheduleInput): TournamentSchedule | null {
    const db = this.requireDb();
    const existing = this.getSchedule(id);
    if (!existing) return null;

    // Cancel existing scheduling before re-wiring
    this.cancelScheduled(id);

    const now = new Date().toISOString();

    // Resolve final values — explicit null in input clears the field
    const newCron  = 'cronExpression' in input ? input.cronExpression  : existing.cronExpression;
    const newRunAt = 'runAt'          in input ? input.runAt           : existing.runAt;
    const newName  = input.name    !== undefined ? input.name    : existing.name;
    const newConfig = input.config !== undefined ? input.config : existing.config;
    const newEnabled = input.enabled !== undefined ? input.enabled : existing.enabled;
    const nextRunAt = newCron ? null : (newRunAt ?? null);

    db.prepare(`
      UPDATE tournament_schedules
      SET name            = ?,
          cron_expression = ?,
          run_at          = ?,
          config          = ?,
          enabled         = ?,
          next_run_at     = ?,
          updated_at      = ?
      WHERE id = ?
    `).run(
      newName,
      newCron ?? null,
      newRunAt ?? null,
      JSON.stringify(newConfig),
      newEnabled ? 1 : 0,
      nextRunAt,
      now,
      id,
    );

    const updated = this.getSchedule(id)!;
    if (this.started && updated.enabled) this.scheduleOne(updated);
    return updated;
  }

  deleteSchedule(id: string): boolean {
    this.cancelScheduled(id);
    const result = this.requireDb()
      .prepare(`DELETE FROM tournament_schedules WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  // ── Run-now ─────────────────────────────────────────────────────────────────

  async runNow(id: string): Promise<{ competitionId: string }> {
    const schedule = this.getSchedule(id);
    if (!schedule) throw new Error(`Schedule ${id} not found`);
    return this.executeSchedule(schedule);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private scheduleOne(schedule: TournamentSchedule): void {
    if (schedule.cronExpression) {
      if (!cron.validate(schedule.cronExpression)) {
        logger.warn('[tournament-scheduler] invalid cron, skipping', { id: schedule.id, expr: schedule.cronExpression });
        return;
      }
      const task = cron.schedule(schedule.cronExpression, () => {
        void this.executeSchedule(schedule).catch(err => {
          logger.error('[tournament-scheduler] cron execution failed', { id: schedule.id, error: String(err) });
        });
      });
      this.cronTasks.set(schedule.id, task);
      logger.info('[tournament-scheduler] cron scheduled', { id: schedule.id, expr: schedule.cronExpression });
    } else if (schedule.runAt) {
      const delay = new Date(schedule.runAt).getTime() - Date.now();
      if (delay <= 0) {
        logger.info('[tournament-scheduler] one-shot is in the past, skipping', { id: schedule.id, runAt: schedule.runAt });
        return;
      }
      const timeout = setTimeout(() => {
        void this.executeSchedule(schedule).catch(err => {
          logger.error('[tournament-scheduler] one-shot execution failed', { id: schedule.id, error: String(err) });
        });
      }, delay);
      this.oneShots.set(schedule.id, timeout);
      logger.info('[tournament-scheduler] one-shot scheduled', { id: schedule.id, runAt: schedule.runAt, delayMs: delay });
    }
  }

  private cancelScheduled(id: string): void {
    const task = this.cronTasks.get(id);
    if (task) { task.stop(); this.cronTasks.delete(id); }
    const timeout = this.oneShots.get(id);
    if (timeout) { clearTimeout(timeout); this.oneShots.delete(id); }
  }

  private async executeSchedule(schedule: TournamentSchedule): Promise<{ competitionId: string }> {
    const competitionId = `comp_sched_${Date.now()}`;
    const config = schedule.config;
    const exchangeMode: string = ((config as unknown) as Record<string, unknown>)['exchangeMode'] as string ?? 'SIMULATED';
    const isSimulated = exchangeMode === 'SIMULATED';

    engine.storeRecord({
      competitionId,
      status: 'RUNNING',
      config,
      startedAt: new Date(),
      progress: 0,
    });

    const onSuccess = (result: Awaited<ReturnType<typeof engine.runCompetition>>) => {
      engine.updateRecord(competitionId, {
        status: 'COMPLETED',
        completedAt: new Date(),
        result,
        progress: 100,
        topPerformerId: result.finalRankings?.[0]?.agentId,
      });
    };
    const onFailure = (err: unknown) => {
      logger.error('[tournament-scheduler] competition failed', { competitionId, error: String(err) });
      engine.updateRecord(competitionId, { status: 'FAILED', progress: 0 });
    };

    if (isSimulated) {
      if (isQueueAvailable()) {
        await getTournamentQueue().add('tournament', { competitionId, config }, { jobId: competitionId });
        tournamentService.registerBullMqCompetition(competitionId);
      } else {
        const handle = workerPool.runMarlCompetition(
          competitionId,
          config,
          (progress) => engine.updateRecord(competitionId, { progress }),
        );
        tournamentService.registerWorkerCompetition(competitionId, handle);
        handle.result.then(onSuccess).catch(onFailure);
      }
    } else {
      engine
        .runCompetition(
          config,
          (progress) => engine.updateRecord(competitionId, { progress }),
          competitionId,
        )
        .then(onSuccess)
        .catch(onFailure);
      tournamentService.registerPaperLiveCompetition(competitionId);
    }

    // Persist execution timestamps
    const now = new Date().toISOString();
    try {
      this.requireDb().prepare(`
        UPDATE tournament_schedules
        SET last_run_at = ?, next_run_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, now, schedule.id);

      // Auto-disable one-shot schedules after they fire
      if (!schedule.cronExpression && schedule.runAt) {
        this.requireDb().prepare(`UPDATE tournament_schedules SET enabled = 0 WHERE id = ?`).run(schedule.id);
        this.cancelScheduled(schedule.id);
      }
    } catch (err) {
      logger.warn('[tournament-scheduler] failed to update last_run_at', { id: schedule.id, error: String(err) });
    }

    logger.info('[tournament-scheduler] launched competition', {
      scheduleId: schedule.id,
      competitionId,
      mode: config.mode,
      exchangeMode,
    });

    return { competitionId };
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('[tournament-scheduler] not started — call start(db) first');
    return this.db;
  }
}

export const tournamentScheduler = new TournamentSchedulerService();
