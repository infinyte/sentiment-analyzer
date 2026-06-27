/**
 * ShadowHarness — Phase 4 continuous shadow-mode runner.
 *
 * Drives the Phase 3 `TradingAgentOrchestrator` on a fixed interval so a track
 * record builds up over time without a human in the loop. Every cycle places
 * (paper) orders through the same safety-guarded path the orchestrator uses, so
 * the Phase 2 expectancy analytics (`/api/paper/*`) measure the harness's trades.
 *
 * "Shadow" = run the agent live against the realistic paper exchange and observe
 * its edge before risking anything real. Intended to be paired with
 * `SHADOW_MODE=true` (which makes the shared exchange REALISTIC_PAPER), but it
 * runs against whatever exchange the orchestrator was given.
 *
 * Design notes:
 *   • Process-lifetime, in-memory only — no DB schema, no new dependencies.
 *   • Uses a plain `setInterval`; the timer is `unref()`d so it never keeps the
 *     process alive on its own.
 *   • Overlap guard: if a cycle is still in flight when the timer fires, the tick
 *     is skipped rather than run concurrently.
 *   • Per-cycle errors are caught and recorded; the loop keeps going.
 *
 * Out of scope here (Phase 6): any SSE/WebSocket streaming UI. This exposes plain
 * REST status that a future live view can poll or stream from.
 */

import type {
  TradingAgentOrchestrator,
  AgentDecision,
  OrchestrationReport,
} from './trading-orchestrator.js';
import logger from '../../logger.js';

// ── Config / status types ───────────────────────────────────────────────────

export interface ShadowHarnessConfig {
  /** Symbols evaluated every cycle. */
  symbols:     string[];
  /** Milliseconds between cycles. Clamped to a 1s floor. Default 60_000. */
  intervalMs?: number;
  /** Decide but place no orders. Default false. */
  dryRun?:     boolean;
  /** Max cycle summaries retained in memory (ring buffer). Default 100. */
  maxHistory?: number;
}

/** Compact record of one completed cycle. */
export interface CycleSummary {
  cycle:            number;
  at:               Date;
  symbolsEvaluated: number;
  executedCount:    number;
  decisions:        AgentDecision[];
  error?:           string;
}

export interface ShadowHarnessStatus {
  running:     boolean;
  startedAt:   Date | null;
  intervalMs:  number;
  symbols:     string[];
  dryRun:      boolean;
  cycleCount:  number;
  errorCount:  number;
  lastError:   string | null;
  lastCycleAt: Date | null;
  /** Recent cycle summaries, newest first. */
  recent:      CycleSummary[];
}

const INTERVAL_FLOOR_MS = 1_000;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_HISTORY = 100;

// ── ShadowHarness ─────────────────────────────────────────────────────────────

export class ShadowHarness {
  private timer:       ReturnType<typeof setInterval> | null = null;
  private running     = false;
  private inFlight    = false;
  private startedAt:   Date | null = null;
  private cycleCount  = 0;
  private errorCount  = 0;
  private lastError:   string | null = null;
  private lastCycleAt: Date | null = null;

  private symbols:    string[] = [];
  private intervalMs  = DEFAULT_INTERVAL_MS;
  private dryRun      = false;
  private maxHistory  = DEFAULT_MAX_HISTORY;
  private readonly history: CycleSummary[] = [];

  // Live subscribers (the SSE stream). A Set keeps subscribe/unsubscribe O(1).
  private readonly cycleListeners = new Set<(summary: CycleSummary) => void>();

  constructor(private readonly orchestrator: TradingAgentOrchestrator) {}

  /**
   * Subscribe to completed cycles (success and error). Returns an unsubscribe
   * function. Used by the SSE stream to push each cycle to connected clients.
   */
  onCycle(listener: (summary: CycleSummary) => void): () => void {
    this.cycleListeners.add(listener);
    return () => { this.cycleListeners.delete(listener); };
  }

  // ── Control ────────────────────────────────────────────────────────────────

  /** Start (or restart) the loop. Kicks an immediate first cycle, then every intervalMs. */
  start(config: ShadowHarnessConfig): ShadowHarnessStatus {
    if (this.running) this.stop();   // clean restart

    this.symbols    = dedupeUpper(config.symbols);
    this.intervalMs = Math.max(INTERVAL_FLOOR_MS, config.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.dryRun     = config.dryRun ?? false;
    this.maxHistory = Math.max(1, config.maxHistory ?? DEFAULT_MAX_HISTORY);

    if (this.symbols.length === 0) {
      throw new Error('ShadowHarness.start: at least one symbol is required');
    }

    this.running   = true;
    this.startedAt = new Date();

    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    // Never let the loop alone keep the process alive.
    if (typeof this.timer.unref === 'function') this.timer.unref();

    logger.info('shadow-harness started', { symbols: this.symbols, intervalMs: this.intervalMs, dryRun: this.dryRun });

    // Immediate first cycle so callers see activity without waiting a full interval.
    void this.tick();

    return this.getStatus();
  }

  /** Stop the loop. Idempotent. */
  stop(): ShadowHarnessStatus {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.running) logger.info('shadow-harness stopped', { cycleCount: this.cycleCount });
    this.running = false;
    return this.getStatus();
  }

  // ── Cycles ───────────────────────────────────────────────────────────────────

  /**
   * Run one cycle now and return the full report. Records a summary in history.
   * Used by the timer (via `tick`) and by the manual trigger endpoint. Symbols /
   * dryRun fall back to the running configuration when not overridden.
   */
  async runOnce(symbolsOverride?: string[], dryRunOverride?: boolean): Promise<OrchestrationReport> {
    const symbols = symbolsOverride && symbolsOverride.length > 0 ? dedupeUpper(symbolsOverride) : this.symbols;
    const dryRun  = dryRunOverride ?? this.dryRun;

    const report = await this.orchestrator.run({ symbols, dryRun });

    this.cycleCount  += 1;
    this.lastCycleAt  = report.generatedAt;
    this.record({
      cycle:            this.cycleCount,
      at:               report.generatedAt,
      symbolsEvaluated: report.symbolsEvaluated,
      executedCount:    report.executedCount,
      decisions:        report.decisions,
    });
    return report;
  }

  /** Timer-driven guarded cycle: skips if one is already in flight; never throws. */
  private async tick(): Promise<void> {
    if (this.inFlight) {
      logger.debug('shadow-harness: tick skipped (previous cycle still running)');
      return;
    }
    this.inFlight = true;
    try {
      await this.runOnce();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.cycleCount += 1;
      this.errorCount += 1;
      this.lastError   = msg;
      this.lastCycleAt = new Date();
      this.record({
        cycle:            this.cycleCount,
        at:               this.lastCycleAt,
        symbolsEvaluated: 0,
        executedCount:    0,
        decisions:        [],
        error:            msg,
      });
      logger.error('shadow-harness: cycle failed', { error: msg });
    } finally {
      this.inFlight = false;
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  getStatus(): ShadowHarnessStatus {
    return {
      running:     this.running,
      startedAt:   this.startedAt,
      intervalMs:  this.intervalMs,
      symbols:     [...this.symbols],
      dryRun:      this.dryRun,
      cycleCount:  this.cycleCount,
      errorCount:  this.errorCount,
      lastError:   this.lastError,
      lastCycleAt: this.lastCycleAt,
      recent:      [...this.history].reverse(),   // newest first
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────────

  private record(summary: CycleSummary): void {
    this.history.push(summary);
    // Bound memory: drop oldest beyond maxHistory.
    while (this.history.length > this.maxHistory) this.history.shift();
    // Notify live subscribers; a misbehaving listener must not break the loop.
    for (const listener of this.cycleListeners) {
      try {
        listener(summary);
      } catch (err: unknown) {
        logger.warn('shadow-harness: cycle listener threw', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedupeUpper(symbols: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of symbols) {
    const u = s.toUpperCase();
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}
