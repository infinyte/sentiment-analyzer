/**
 * ga-event-bus.ts
 *
 * Typed event bus for the genetic algorithm lifecycle.  Wraps Node.js
 * EventEmitter with strongly-typed event names and payload shapes so that
 * every emitter and listener is checked at compile time.
 *
 * Events:
 *   task:queued          — a tournament has been submitted and its initial
 *                          population created (emitted from startTournament)
 *   task:started         — a generation's competition run has begun
 *   task:progress        — competition progress tick (0–100 percent)
 *   task:completed       — competition finished, results recorded
 *   generation:complete  — full generation lifecycle done (select + breed + mutate)
 *   convergence:detected — early-stop threshold was met; tournament will halt
 */

import { EventEmitter } from 'node:events';
import type { GenerationSummary } from './evolutionary-orchestrator.js';

// ── Event payload shapes ──────────────────────────────────────────────────────

export interface GAEvents {
  /** Tournament queued: initial population created, background loop about to start. */
  'task:queued': {
    tournamentId: string;
    name: string;
    populationSize: number;
    maxGenerations: number;
  };

  /** A generation's competition simulation has started. */
  'task:started': {
    tournamentId: string;
    generation: number;
    populationSize: number;
    competitionId: string;
  };

  /** Incremental progress from the competition simulation (0–100). */
  'task:progress': {
    tournamentId: string;
    generation: number;
    competitionId: string;
    progress: number;
  };

  /** Competition run finished; results have been recorded in agent_statistics. */
  'task:completed': {
    tournamentId: string;
    generation: number;
    competitionId: string;
    topFitness: number;
    avgFitness: number;
  };

  /** Complete generation lifecycle finished (competition + selection + breeding). */
  'generation:complete': {
    tournamentId: string;
    generation: number;
    summary: GenerationSummary;
  };

  /** Early-stop threshold was exceeded; tournament will halt after this generation. */
  'convergence:detected': {
    tournamentId: string;
    generation: number;
    topFitness: number;
    threshold: number;
  };
}

export type GAEventName = keyof GAEvents;

// ── GAEventBus ────────────────────────────────────────────────────────────────

/**
 * Typed wrapper around Node.js EventEmitter.
 *
 * All `emit()`, `on()`, `once()`, and `off()` overloads are constrained to
 * the payload shapes declared in GAEvents, giving compile-time safety.
 */
export class GAEventBus {
  private readonly _emitter = new EventEmitter();

  /**
   * Emit an event with its typed payload.
   */
  emit<K extends GAEventName>(event: K, payload: GAEvents[K]): void {
    this._emitter.emit(event, payload);
  }

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function for easy cleanup.
   */
  on<K extends GAEventName>(
    event: K,
    listener: (payload: GAEvents[K]) => void,
  ): () => void {
    this._emitter.on(event, listener as (payload: unknown) => void);
    return () => this._emitter.off(event, listener as (payload: unknown) => void);
  }

  /**
   * Subscribe to the first occurrence of an event only.
   */
  once<K extends GAEventName>(
    event: K,
    listener: (payload: GAEvents[K]) => void,
  ): void {
    this._emitter.once(event, listener as (payload: unknown) => void);
  }

  /**
   * Unsubscribe a specific listener from an event.
   */
  off<K extends GAEventName>(
    event: K,
    listener: (payload: GAEvents[K]) => void,
  ): void {
    this._emitter.off(event, listener as (payload: unknown) => void);
  }

  /**
   * Remove all listeners for a specific event, or all listeners for all events
   * when called without an argument.
   */
  removeAllListeners(event?: GAEventName): void {
    if (event === undefined) {
      this._emitter.removeAllListeners();
    } else {
      this._emitter.removeAllListeners(event);
    }
  }

  /** Number of listeners currently registered for `event`. */
  listenerCount(event: GAEventName): number {
    return this._emitter.listenerCount(event);
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

/** Shared event bus for the entire evolutionary subsystem. */
export const gaEventBus = new GAEventBus();
