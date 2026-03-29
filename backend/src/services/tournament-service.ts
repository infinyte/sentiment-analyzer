/**
 * TournamentService
 *
 * Audit findings:
 *  - MarlCompetitionEngine is the existing tournament orchestrator; this service wraps it.
 *  - CompetitionRecord status: 'RUNNING' | 'COMPLETED' | 'FAILED'.
 *  - Engine reference is injected via setEngine() to avoid circular imports.
 *  - Worker Thread handles (TaskHandle) can be cancelled via handle.cancel().
 *  - BullMQ jobs tracked by competitionId (= jobId) in the tournament queue.
 *  - PAPER/LIVE stop/pause uses new engine.signalStop/Pause/Resume() methods.
 *
 * Created from scratch — no prior TournamentService existed.
 */

import EventEmitter from 'node:events';
import logger from '../logger.js';
import { isQueueAvailable } from '../queues/connection.js';
import { getTournamentQueue } from '../queues/tournament.queue.js';
import type { MarlCompetitionEngine } from './marl-competition-engine.js';
import type { TaskHandle } from './worker-pool.js';
import type { CompetitionResult } from './marl-competition-engine.js';

// ── Public types ──────────────────────────────────────────────────────────────

/** Lifecycle states for a tournament managed by TournamentService. */
export type TournamentStatus =
  | 'QUEUED'     // Created but not yet started
  | 'RUNNING'    // Actively executing
  | 'PAUSED'     // Execution halted; resumable (PAPER/LIVE only — best-effort for SIMULATED)
  | 'STOPPED'    // Manually terminated; not resumable
  | 'COMPLETED'  // Finished naturally
  | 'ERROR';     // Crashed with an error

/** Per-agent performance snapshot captured on each stats tick. */
export interface AgentSnapshot {
  agentId: string;
  /** Agent type: always 'HYBRID' as CompetitionAgentSpec does not expose this field. */
  agentType: string;
  riskProfile: string;
  portfolioValueUsd: number;
  initialCapitalUsd: number;
  pnlUsd: number;
  pnlPercent: number;
  /** TODO: wire from agent metrics when live agent state is exposed via engine. */
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  sharpeRatio: number | null;
  maxDrawdownPercent: number;
  currentSignal: 'BUY' | 'SELL' | 'HOLD' | null;
  currentSentiment: 'BULL' | 'BEAR' | 'NEUTRAL' | null;
  lastUpdatedAt: Date;
}

/** Full tournament record exposed by TournamentService. */
export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  /** Null if not an EVOLUTIONARY competition. */
  generationNumber: number | null;
  agents: AgentSnapshot[];
  startedAt: Date | null;
  pausedAt: Date | null;
  resumedAt: Date | null;
  stoppedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  coinsUnderAnalysis: string[];
  /** Accumulated run time in milliseconds, excluding paused intervals. */
  totalElapsedMs: number;
  progress: number;
}

/** Internal registration metadata for a tournament. */
interface TournamentMeta {
  type: 'SIMULATED_WORKER' | 'SIMULATED_BULLMQ' | 'PAPER_LIVE';
  workerHandle?: TaskHandle<CompetitionResult>;
  pausedAt?: Date;
  resumedAt?: Date;
  stoppedAt?: Date;
  /** Accumulated elapsed ms at the time the last pause started. */
  elapsedMsBeforePause: number;
  isPaused: boolean;
  isStopped: boolean;
}

// ── CompetitionRecord shape (kept local to avoid circular deps) ───────────────

interface CompetitionRecordLike {
  competitionId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  config: {
    agents: Array<{ id: string; riskProfile: string; initialCapital?: number }>;
    symbols: string[];
    mode: string;
  };
  startedAt: Date;
  completedAt?: Date;
  result?: {
    finalRankings: Array<{
      rank: number;
      agentId: string;
      finalCapital: number;
      totalReturn: number;
      sharpeRatio: number;
      maxDrawdown: number;
      tradesExecuted: number;
      winRate: number;
    }>;
  };
  progress: number;
}

// ── TournamentService ─────────────────────────────────────────────────────────

/**
 * TournamentService — wraps MarlCompetitionEngine to provide enhanced
 * tournament visibility and lifecycle control (pause / resume / stop).
 */
export class TournamentService extends EventEmitter {
  /** Lazy-set engine reference (avoids circular imports). */
  private engine: MarlCompetitionEngine | null = null;

  /** Metadata per competitionId: type, handles, pause/stop state. */
  private readonly meta = new Map<string, TournamentMeta>();

  /**
   * Inject the MarlCompetitionEngine singleton.
   * Must be called before any other method.
   */
  setEngine(engine: MarlCompetitionEngine): void {
    this.engine = engine;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a newly-started SIMULATED Worker Thread competition.
   * Stores the TaskHandle so it can be cancelled on stop.
   */
  registerWorkerCompetition(
    competitionId: string,
    handle: TaskHandle<CompetitionResult>,
  ): void {
    this.meta.set(competitionId, {
      type: 'SIMULATED_WORKER',
      workerHandle: handle,
      elapsedMsBeforePause: 0,
      isPaused: false,
      isStopped: false,
    });
    logger.info('[tournament-service] registered worker competition', { competitionId });
  }

  /**
   * Register a newly-started SIMULATED BullMQ competition.
   */
  registerBullMqCompetition(competitionId: string): void {
    this.meta.set(competitionId, {
      type: 'SIMULATED_BULLMQ',
      elapsedMsBeforePause: 0,
      isPaused: false,
      isStopped: false,
    });
    logger.info('[tournament-service] registered bullmq competition', { competitionId });
  }

  /**
   * Register a newly-started PAPER or LIVE competition running on the main thread.
   */
  registerPaperLiveCompetition(competitionId: string): void {
    this.meta.set(competitionId, {
      type: 'PAPER_LIVE',
      elapsedMsBeforePause: 0,
      isPaused: false,
      isStopped: false,
    });
    logger.info('[tournament-service] registered paper/live competition', { competitionId });
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** Returns all tournaments (all statuses), sorted newest-first. */
  getAllTournaments(): Tournament[] {
    if (!this.engine) return [];
    return this.engine.getAllRecords().map(r => this.toTournament(r as CompetitionRecordLike));
  }

  /** Returns only active tournaments (RUNNING or PAUSED). */
  getActiveTournaments(): Tournament[] {
    return this.getAllTournaments().filter(
      t => t.status === 'RUNNING' || t.status === 'PAUSED',
    );
  }

  /** Returns a single tournament by ID, or undefined if not found. */
  getTournamentById(id: string): Tournament | undefined {
    if (!this.engine) return undefined;
    const record = this.engine.getRecord(id);
    if (!record) return undefined;
    return this.toTournament(record as CompetitionRecordLike);
  }

  // ── Lifecycle control ───────────────────────────────────────────────────────

  /**
   * Pause a RUNNING tournament.
   *
   * - PAPER/LIVE: signals the engine tick loop to spin-wait.
   * - SIMULATED_WORKER: marks as paused in our state; actual CPU work continues
   *   in the Worker Thread (no shared memory). Use stop to halt it completely.
   * - SIMULATED_BULLMQ: marks as paused; actual execution continues in the worker
   *   process.
   *
   * Returns failure if not in RUNNING state.
   */
  async pauseTournament(id: string): Promise<{ success: boolean; message: string }> {
    const tournament = this.getTournamentById(id);
    if (!tournament) {
      return { success: false, message: `Tournament ${id} not found` };
    }
    if (tournament.status !== 'RUNNING') {
      return { success: false, message: `Tournament ${id} is not RUNNING (current: ${tournament.status})` };
    }

    const m = this.ensureMeta(id);
    m.isPaused = true;
    m.pausedAt = new Date();

    // Signal the engine (effective for PAPER/LIVE main-thread competitions)
    this.engine?.signalPause(id);

    logger.info('[tournament-service] tournament paused', { competitionId: id });
    this.emit('status', { tournamentId: id, status: 'PAUSED' });
    return { success: true, message: `Tournament ${id} paused` };
  }

  /**
   * Resume a PAUSED tournament.
   *
   * - PAPER/LIVE: clears the pause signal so the engine tick loop continues.
   * - SIMULATED_WORKER / SIMULATED_BULLMQ: clears our paused flag; the worker
   *   was never truly halted.
   */
  async resumeTournament(id: string): Promise<{ success: boolean; message: string }> {
    const tournament = this.getTournamentById(id);
    if (!tournament) {
      return { success: false, message: `Tournament ${id} not found` };
    }
    if (tournament.status !== 'PAUSED') {
      return { success: false, message: `Tournament ${id} is not PAUSED (current: ${tournament.status})` };
    }

    const m = this.ensureMeta(id);
    // Accumulate elapsed time
    if (m.pausedAt) {
      m.elapsedMsBeforePause += Date.now() - m.pausedAt.getTime();
    }
    m.isPaused = false;
    m.resumedAt = new Date();

    // Clear engine pause signal (effective for PAPER/LIVE)
    this.engine?.signalResume(id);

    logger.info('[tournament-service] tournament resumed', { competitionId: id });
    this.emit('status', { tournamentId: id, status: 'RUNNING' });
    return { success: true, message: `Tournament ${id} resumed` };
  }

  /**
   * Stop a tournament entirely (not resumable).
   *
   * - PAPER/LIVE: signals the engine to exit its tick loop.
   * - SIMULATED_WORKER: terminates the Worker Thread immediately.
   * - SIMULATED_BULLMQ: removes the job from the BullMQ queue (if still pending/active).
   */
  async stopTournament(id: string): Promise<{ success: boolean; message: string }> {
    const tournament = this.getTournamentById(id);
    if (!tournament) {
      return { success: false, message: `Tournament ${id} not found` };
    }
    if (
      tournament.status === 'STOPPED' ||
      tournament.status === 'COMPLETED' ||
      tournament.status === 'ERROR'
    ) {
      return {
        success: false,
        message: `Tournament ${id} is already in terminal state: ${tournament.status}`,
      };
    }

    const m = this.ensureMeta(id);
    m.isStopped = true;
    m.stoppedAt = new Date();

    // Signal engine (effective for PAPER/LIVE)
    this.engine?.signalStop(id);

    // Terminate Worker Thread if applicable
    if (m.type === 'SIMULATED_WORKER' && m.workerHandle) {
      m.workerHandle.cancel();
      m.workerHandle = undefined;
      logger.info('[tournament-service] worker thread terminated', { competitionId: id });
    }

    // Remove BullMQ job if applicable
    if (m.type === 'SIMULATED_BULLMQ' && isQueueAvailable()) {
      try {
        const queue = getTournamentQueue();
        const job = await queue.getJob(id);
        if (job) {
          await job.remove();
          logger.info('[tournament-service] bullmq job removed', { competitionId: id });
        }
      } catch (err) {
        logger.warn('[tournament-service] failed to remove bullmq job', {
          competitionId: id,
          error: String(err),
        });
      }
    }

    // Update the engine record to FAILED (closest terminal state available)
    this.engine?.updateRecord(id, { status: 'FAILED', completedAt: new Date() });

    logger.info('[tournament-service] tournament stopped', { competitionId: id });
    this.emit('status', { tournamentId: id, status: 'STOPPED' });
    return { success: true, message: `Tournament ${id} stopped` };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Convert a CompetitionRecord to the Tournament view model.
   * Merges engine record state with our local pause/stop metadata.
   */
  private toTournament(record: CompetitionRecordLike): Tournament {
    const id = record.competitionId;
    const m = this.meta.get(id);

    const status = this.deriveStatus(record.status, m);
    const agents = this.buildAgentSnapshots(id, record);
    const elapsed = this.computeElapsedMs(record, m);

    return {
      id,
      name: this.formatName(id, record.config.mode),
      status,
      generationNumber: null, // TODO: wire from evolutionary tournament records
      agents,
      startedAt: record.startedAt,
      pausedAt: m?.pausedAt ?? null,
      resumedAt: m?.resumedAt ?? null,
      stoppedAt: m?.stoppedAt ?? null,
      completedAt: record.completedAt ?? null,
      errorMessage: status === 'ERROR' ? 'Competition failed' : null,
      coinsUnderAnalysis: record.config.symbols ?? [],
      totalElapsedMs: elapsed,
      progress: record.progress,
    };
  }

  /**
   * Derive the TournamentStatus from the engine record status and our local metadata.
   */
  private deriveStatus(
    engineStatus: 'RUNNING' | 'COMPLETED' | 'FAILED',
    m: TournamentMeta | undefined,
  ): TournamentStatus {
    if (m?.isStopped) return 'STOPPED';
    if (engineStatus === 'COMPLETED') return 'COMPLETED';
    if (engineStatus === 'FAILED') return m?.isStopped ? 'STOPPED' : 'ERROR';
    if (m?.isPaused) return 'PAUSED';
    return 'RUNNING';
  }

  /**
   * Build AgentSnapshot array from competition record.
   * Uses finalRankings if completed; falls back to live equity snapshots when running.
   */
  private buildAgentSnapshots(
    competitionId: string,
    record: CompetitionRecordLike,
  ): AgentSnapshot[] {
    // Completed: use final rankings for rich metrics
    if (record.result?.finalRankings) {
      return record.result.finalRankings.map(r => {
        const spec = record.config.agents.find(a => a.id === r.agentId);
        const initialCapital = spec?.initialCapital ?? 10_000;
        return {
          agentId: r.agentId,
          agentType: 'HYBRID', // TODO: wire when CompetitionAgentSpec exposes agentType
          riskProfile: spec?.riskProfile ?? 'CONSERVATIVE',
          portfolioValueUsd: r.finalCapital,
          initialCapitalUsd: initialCapital,
          pnlUsd: r.finalCapital - initialCapital,
          pnlPercent: r.totalReturn,
          tradeCount: r.tradesExecuted,
          winCount: Math.round(r.tradesExecuted * r.winRate),
          lossCount: r.tradesExecuted - Math.round(r.tradesExecuted * r.winRate),
          winRate: r.winRate,
          sharpeRatio: r.sharpeRatio,
          maxDrawdownPercent: r.maxDrawdown,
          currentSignal: null,
          currentSentiment: null,
          lastUpdatedAt: record.completedAt ?? new Date(),
        };
      });
    }

    // Running: use the latest live equity snapshot from the engine
    const snapshots = this.engine?.getLiveEquitySnapshots(competitionId) ?? [];
    const latest = snapshots[snapshots.length - 1];

    if (!latest) {
      // Pre-snapshot phase: return scaffolding from config
      return record.config.agents.map(spec => ({
        agentId: spec.id,
        agentType: 'HYBRID',
        riskProfile: spec.riskProfile,
        portfolioValueUsd: spec.initialCapital ?? 10_000,
        initialCapitalUsd: spec.initialCapital ?? 10_000,
        pnlUsd: 0,
        pnlPercent: 0,
        tradeCount: 0, // TODO: wire from agent metrics
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        sharpeRatio: null,
        maxDrawdownPercent: 0,
        currentSignal: null,
        currentSentiment: null,
        lastUpdatedAt: new Date(),
      }));
    }

    return latest.agentEquities.map(ae => {
      const spec = record.config.agents.find(a => a.id === ae.agentId);
      const initialCapital = spec?.initialCapital ?? 10_000;
      const pnlUsd = ae.equity - initialCapital;
      const pnlPercent = initialCapital > 0 ? (pnlUsd / initialCapital) * 100 : 0;
      return {
        agentId: ae.agentId,
        agentType: 'HYBRID', // TODO: wire when exposed
        riskProfile: spec?.riskProfile ?? 'CONSERVATIVE',
        portfolioValueUsd: ae.equity,
        initialCapitalUsd: initialCapital,
        pnlUsd,
        pnlPercent,
        tradeCount: 0, // TODO: wire from agent metrics
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        sharpeRatio: null,
        maxDrawdownPercent: 0,
        currentSignal: null,
        currentSentiment: null,
        lastUpdatedAt: latest.timestamp,
      };
    });
  }

  /**
   * Compute accumulated elapsed milliseconds, excluding paused time.
   */
  private computeElapsedMs(
    record: { startedAt: Date; completedAt?: Date },
    m: TournamentMeta | undefined,
  ): number {
    const endTime = record.completedAt?.getTime() ?? Date.now();
    const raw = endTime - record.startedAt.getTime();
    const pausedMs =
      (m?.elapsedMsBeforePause ?? 0) +
      (m?.isPaused && m.pausedAt ? Date.now() - m.pausedAt.getTime() : 0);
    return Math.max(0, raw - pausedMs);
  }

  /**
   * Generate a human-readable tournament name from the competition ID and mode.
   */
  private formatName(competitionId: string, mode: string): string {
    // competitionId format: comp_<timestamp> or comp_real_<timestamp>
    const ts = competitionId.replace(/^comp(_real)?_/, '');
    const d = new Date(parseInt(ts, 10));
    const dateStr = isNaN(d.getTime())
      ? competitionId
      : d.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
    return `${mode} Tournament — ${dateStr}`;
  }

  /**
   * Get or create meta record for a competition.
   * Creates a default 'PAPER_LIVE' meta if the competition was started before the
   * service was initialized (e.g., pre-existing competitions on restart).
   */
  private ensureMeta(id: string): TournamentMeta {
    if (!this.meta.has(id)) {
      this.meta.set(id, {
        type: 'PAPER_LIVE',
        elapsedMsBeforePause: 0,
        isPaused: false,
        isStopped: false,
      });
    }
    return this.meta.get(id)!;
  }
}

/** Module-level singleton — shared across all route handlers. */
export const tournamentService = new TournamentService();
