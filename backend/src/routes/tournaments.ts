/**
 * Tournament Monitor Routes
 *
 * Audit findings:
 *  - No prior /api/tournaments routes existed.
 *  - Existing tournament data is held in MarlCompetitionEngine (marl-competition.ts).
 *  - TournamentService wraps that engine and adds pause/stop/resume.
 *  - Logger: Winston (import logger from '../logger.js').
 *  - Pattern: plain Router, no factory function needed (no DB deps).
 *
 * All routes return: { success: boolean, data?: unknown, message?: string }
 */

import { Router } from 'express';
import { tournamentService } from '../services/tournament-service.js';
import type { TournamentStatus } from '../services/tournament-service.js';
import logger from '../logger.js';

const router = Router();

// ── GET /api/tournaments ───────────────────────────────────────────────────────
/**
 * List all tournaments (all statuses), newest first.
 *
 * Response: { success: true, data: Tournament[] }
 */
router.get('/api/tournaments', (_req, res) => {
  try {
    const data = tournamentService.getAllTournaments();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[tournaments] GET /api/tournaments failed', { error: String(err) });
    return res.status(500).json({ success: false, message: 'Failed to retrieve tournaments' });
  }
});

// ── GET /api/tournaments/active ───────────────────────────────────────────────
/**
 * List only RUNNING or PAUSED tournaments.
 *
 * Response: { success: true, data: Tournament[] }
 */
router.get('/api/tournaments/active', (_req, res) => {
  try {
    const data = tournamentService.getActiveTournaments();
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[tournaments] GET /api/tournaments/active failed', { error: String(err) });
    return res.status(500).json({ success: false, message: 'Failed to retrieve active tournaments' });
  }
});

// ── GET /api/tournaments/:id ──────────────────────────────────────────────────
/**
 * Get a single tournament by ID.
 *
 * Response: { success: true, data: Tournament } | 404
 */
router.get('/api/tournaments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = tournamentService.getTournamentById(id);
    if (!data) {
      return res.status(404).json({ success: false, message: `Tournament ${id} not found` });
    }
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('[tournaments] GET /api/tournaments/:id failed', {
      id: req.params['id'],
      error: String(err),
    });
    return res.status(500).json({ success: false, message: 'Failed to retrieve tournament' });
  }
});

// ── POST /api/tournaments/:id/pause ───────────────────────────────────────────
/**
 * Pause a RUNNING tournament.
 *
 * Returns 409 if tournament is not RUNNING.
 * Response: { success: boolean, message: string }
 */
router.post('/api/tournaments/:id/pause', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await tournamentService.pauseTournament(id);
    if (!result.success) {
      // Distinguish not-found from conflict
      const tournament = tournamentService.getTournamentById(id);
      const statusCode = !tournament ? 404 : 409;
      return res.status(statusCode).json(result);
    }
    logger.info('[tournaments] tournament paused via API', { id });
    return res.json(result);
  } catch (err) {
    logger.error('[tournaments] POST /api/tournaments/:id/pause failed', {
      id,
      error: String(err),
    });
    return res.status(500).json({ success: false, message: 'Failed to pause tournament' });
  }
});

// ── POST /api/tournaments/:id/resume ──────────────────────────────────────────
/**
 * Resume a PAUSED tournament.
 *
 * Returns 409 if tournament is not PAUSED.
 * Response: { success: boolean, message: string }
 */
router.post('/api/tournaments/:id/resume', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await tournamentService.resumeTournament(id);
    if (!result.success) {
      const tournament = tournamentService.getTournamentById(id);
      const statusCode = !tournament ? 404 : 409;
      return res.status(statusCode).json(result);
    }
    logger.info('[tournaments] tournament resumed via API', { id });
    return res.json(result);
  } catch (err) {
    logger.error('[tournaments] POST /api/tournaments/:id/resume failed', {
      id,
      error: String(err),
    });
    return res.status(500).json({ success: false, message: 'Failed to resume tournament' });
  }
});

// ── POST /api/tournaments/:id/stop ────────────────────────────────────────────
/**
 * Stop a tournament entirely (not resumable).
 *
 * Returns 409 if tournament is already in a terminal state.
 * Response: { success: boolean, message: string }
 */
router.post('/api/tournaments/:id/stop', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await tournamentService.stopTournament(id);
    if (!result.success) {
      const tournament = tournamentService.getTournamentById(id);
      const statusCode = !tournament ? 404 : 409;
      return res.status(statusCode).json(result);
    }
    logger.info('[tournaments] tournament stopped via API', { id });
    return res.json(result);
  } catch (err) {
    logger.error('[tournaments] POST /api/tournaments/:id/stop failed', {
      id,
      error: String(err),
    });
    return res.status(500).json({ success: false, message: 'Failed to stop tournament' });
  }
});

// ── GET /api/tournaments/:id/stream ───────────────────────────────────────────
/**
 * Server-Sent Events stream for real-time tournament stats.
 *
 * Events emitted:
 *   stats     — agent snapshots, every TOURNAMENT_STATS_INTERVAL_MS (default 5s)
 *   status    — when status changes (PAUSED, RUNNING, STOPPED, COMPLETED, ERROR)
 *   heartbeat — every 30s to keep connection alive
 *
 * Stream closes when tournament reaches a terminal state (STOPPED, COMPLETED, ERROR).
 *
 * Request:  GET /api/tournaments/:id/stream
 * Response: text/event-stream
 */
router.get('/api/tournaments/:id/stream', (req, res) => {
  const { id } = req.params;
  const STATS_INTERVAL_MS = parseInt(
    process.env['TOURNAMENT_STATS_INTERVAL_MS'] ?? '5000',
    10,
  );
  const HEARTBEAT_INTERVAL_MS = 30_000;

  // Verify tournament exists
  const initial = tournamentService.getTournamentById(id);
  if (!initial) {
    return res.status(404).json({ success: false, message: `Tournament ${id} not found` });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  /** Helper: write an SSE event to the response. */
  function sendEvent(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Send initial state immediately
  sendEvent('stats', {
    type: 'stats',
    tournamentId: id,
    agents: initial.agents,
    status: initial.status,
    progress: initial.progress,
    timestamp: new Date().toISOString(),
  });

  /** True once the stream has been closed (prevents double-close). */
  let closed = false;

  function closeStream(): void {
    if (closed) return;
    closed = true;
    clearInterval(statsInterval);
    clearInterval(heartbeatInterval);
    tournamentService.removeListener('status', onStatusChange);
    res.end();
  }

  // ── Stats tick ────────────────────────────────────────────────────────────

  const statsInterval = setInterval(() => {
    if (closed) return;
    const t = tournamentService.getTournamentById(id);
    if (!t) {
      closeStream();
      return;
    }

    sendEvent('stats', {
      type: 'stats',
      tournamentId: id,
      agents: t.agents,
      status: t.status,
      progress: t.progress,
      timestamp: new Date().toISOString(),
    });

    // Close stream on terminal state
    if (isTerminal(t.status)) {
      closeStream();
    }
  }, STATS_INTERVAL_MS);

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  const heartbeatInterval = setInterval(() => {
    if (closed) return;
    sendEvent('heartbeat', { type: 'heartbeat', timestamp: new Date().toISOString() });
  }, HEARTBEAT_INTERVAL_MS);

  // ── Status change listener ─────────────────────────────────────────────────

  const onStatusChange = (payload: { tournamentId: string; status: TournamentStatus }) => {
    if (payload.tournamentId !== id || closed) return;
    sendEvent('status', {
      type: 'status',
      tournamentId: id,
      status: payload.status,
      timestamp: new Date().toISOString(),
    });
    if (isTerminal(payload.status)) {
      closeStream();
    }
  };

  tournamentService.on('status', onStatusChange);

  // ── Client disconnect ──────────────────────────────────────────────────────

  req.on('close', () => closeStream());
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTerminal(status: TournamentStatus): boolean {
  return status === 'STOPPED' || status === 'COMPLETED' || status === 'ERROR';
}

export default router;
export const tournamentRoutes = router;
