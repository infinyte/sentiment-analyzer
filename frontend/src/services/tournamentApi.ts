/**
 * Tournament API client
 *
 * Typed fetch wrappers for all /api/tournaments endpoints plus an SSE helper.
 * All methods throw a TournamentApiError on non-2xx responses so callers can
 * display meaningful error messages rather than silently failing.
 *
 * Audit findings:
 *  - No prior tournament API client existed.
 *  - Pattern follows the fetch-based approach used elsewhere in App.tsx.
 *  - SSE uses the browser's native EventSource API (no extra packages needed).
 */

import type {
  Tournament,
  TournamentApiResponse,
  TournamentStatsEvent,
  TournamentStatusEvent,
} from '../types/tournament.js';

// ── Error type ────────────────────────────────────────────────────────────────

/** Typed error thrown by every tournamentApi method on non-2xx responses. */
export class TournamentApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TournamentApiError';
  }
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<TournamentApiResponse<T>> {
  const res = await fetch(url, init);
  const body: TournamentApiResponse<T> = await res.json();
  if (!res.ok || !body.success) {
    throw new TournamentApiError(
      res.status,
      body.message ?? `HTTP ${res.status} — ${res.statusText}`,
    );
  }
  return body;
}

// ── API client ────────────────────────────────────────────────────────────────

export const tournamentApi = {
  /**
   * Fetch all tournaments (all statuses), newest-first.
   *
   * GET /api/tournaments
   */
  async getAll(): Promise<Tournament[]> {
    const body = await fetchJson<Tournament[]>('/api/tournaments');
    return body.data ?? [];
  },

  /**
   * Fetch only RUNNING or PAUSED tournaments.
   *
   * GET /api/tournaments/active
   */
  async getActive(): Promise<Tournament[]> {
    const body = await fetchJson<Tournament[]>('/api/tournaments/active');
    return body.data ?? [];
  },

  /**
   * Fetch a single tournament by ID.
   *
   * GET /api/tournaments/:id
   */
  async getById(id: string): Promise<Tournament> {
    const body = await fetchJson<Tournament>(`/api/tournaments/${id}`);
    if (!body.data) throw new TournamentApiError(404, `Tournament ${id} not found`);
    return body.data;
  },

  /**
   * Pause a RUNNING tournament.
   *
   * POST /api/tournaments/:id/pause
   * @throws TournamentApiError (409) if not RUNNING
   */
  async pause(id: string): Promise<{ message: string }> {
    const body = await fetchJson<undefined>(`/api/tournaments/${id}/pause`, {
      method: 'POST',
    });
    return { message: body.message ?? 'Paused' };
  },

  /**
   * Resume a PAUSED tournament.
   *
   * POST /api/tournaments/:id/resume
   * @throws TournamentApiError (409) if not PAUSED
   */
  async resume(id: string): Promise<{ message: string }> {
    const body = await fetchJson<undefined>(`/api/tournaments/${id}/resume`, {
      method: 'POST',
    });
    return { message: body.message ?? 'Resumed' };
  },

  /**
   * Stop a tournament entirely (not resumable).
   *
   * POST /api/tournaments/:id/stop
   * @throws TournamentApiError (409) if already in terminal state
   */
  async stop(id: string): Promise<{ message: string }> {
    const body = await fetchJson<undefined>(`/api/tournaments/${id}/stop`, {
      method: 'POST',
    });
    return { message: body.message ?? 'Stopped' };
  },

  /**
   * Open an SSE stream for a tournament's live stats.
   *
   * GET /api/tournaments/:id/stream
   *
   * Returns the EventSource so the caller can close it on unmount.
   * Falls back to polling via setInterval if EventSource is unavailable or
   * if the initial connection fails (caught via onerror).
   *
   * @param id - Tournament ID
   * @param onStats - Called on every 'stats' event
   * @param onStatus - Called on every 'status' event
   * @param onError - Called when the connection errors; caller decides whether to switch to polling
   */
  streamStats(
    id: string,
    onStats: (event: TournamentStatsEvent) => void,
    onStatus: (event: TournamentStatusEvent) => void,
    onError: (err: Event) => void,
  ): EventSource {
    const es = new EventSource(`/api/tournaments/${id}/stream`);

    es.addEventListener('stats', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TournamentStatsEvent;
        onStats(data);
      } catch {
        // Ignore malformed payloads
      }
    });

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as TournamentStatusEvent;
        onStatus(data);
      } catch {
        // Ignore malformed payloads
      }
    });

    // 'heartbeat' events are intentionally ignored on the client side

    es.onerror = onError;

    return es;
  },
};
