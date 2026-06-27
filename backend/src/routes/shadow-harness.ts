/**
 * Shadow Harness Routes
 *
 * Start/stop/observe the Phase 4 continuous shadow-mode runner. The harness
 * drives the shared agent orchestrator on an interval, so trades it places flow
 * through the safety guards and are measured by /api/paper/*.
 *
 * Endpoints (all under /api/shadow/):
 *   GET  status   — current run state + recent cycle summaries
 *   POST start    — begin the loop; body { symbols[], intervalMs?, dryRun?, maxHistory? }
 *   POST stop     — stop the loop
 *   POST tick     — run one cycle immediately; body { symbols?, dryRun? } → OrchestrationReport
 *   GET  stream   — Server-Sent Events: initial status snapshot, then one event per cycle (Phase 6)
 *
 * In-memory only — no DB schema, no new dependencies. SSE (not WebSockets) for the
 * live feed, per the project constraint.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ShadowHarness } from '../services/agent/shadow-harness.js';
import logger from '../logger.js';

// Heartbeat keeps proxies/load balancers from idling the SSE connection shut.
const SSE_HEARTBEAT_MS = 15_000;

export function createShadowHarnessRouter(harness: ShadowHarness): Router {
  const router = Router();

  // GET /api/shadow/status
  router.get('/api/shadow/status', (_req, res) => {
    res.json(harness.getStatus());
  });

  // GET /api/shadow/stream — Server-Sent Events live feed
  router.get('/api/shadow/stream', (req, res) => {
    streamShadowEvents(harness, req, res);
  });

  // POST /api/shadow/start
  router.post('/api/shadow/start', (req, res) => {
    const body = (req.body ?? {}) as {
      symbols?: unknown; intervalMs?: unknown; dryRun?: unknown; maxHistory?: unknown;
    };

    const symbols = parseSymbols(body.symbols);
    if (symbols === null || symbols.length === 0) {
      res.status(400).json({ error: 'symbols must be a non-empty array of strings' });
      return;
    }
    const intervalMs = parsePositiveInt(body.intervalMs);
    const maxHistory = parsePositiveInt(body.maxHistory);

    try {
      const status = harness.start({
        symbols,
        intervalMs,
        dryRun:     body.dryRun === true,
        maxHistory,
      });
      res.json(status);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/shadow/stop
  router.post('/api/shadow/stop', (_req, res) => {
    res.json(harness.stop());
  });

  // POST /api/shadow/tick — run one cycle now
  router.post('/api/shadow/tick', async (req, res) => {
    const body = (req.body ?? {}) as { symbols?: unknown; dryRun?: unknown };
    const symbols = parseSymbols(body.symbols);
    if (symbols === null) {
      res.status(400).json({ error: 'symbols, when provided, must be an array of strings' });
      return;
    }
    try {
      const report = await harness.runOnce(
        symbols.length > 0 ? symbols : undefined,
        body.dryRun === true ? true : undefined,
      );
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('shadow-harness: manual tick failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

// ── SSE streaming ──────────────────────────────────────────────────────────────

/** Write one named SSE event. */
function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stream shadow-harness activity to one client as Server-Sent Events:
 *   • an immediate `status` event with the current snapshot,
 *   • a `cycle` event each time the harness completes a cycle,
 *   • `: heartbeat` comments to keep the connection open.
 * Cleans up the subscription + heartbeat when the client disconnects.
 *
 * Exported for unit testing with mock req/res.
 */
export function streamShadowEvents(harness: ShadowHarness, req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    Connection:          'keep-alive',
    'X-Accel-Buffering': 'no',   // disable proxy buffering so events flush immediately
  });

  // Initial snapshot so a fresh client renders immediately, not after the first cycle.
  sendEvent(res, 'status', harness.getStatus());

  const unsubscribe = harness.onCycle(summary => sendEvent(res, 'cycle', summary));

  const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, SSE_HEARTBEAT_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    logger.debug('shadow-harness: SSE client disconnected');
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// ── Body parsing ────────────────────────────────────────────────────────────

/** string[] (possibly empty) or null when present-but-malformed. */
function parseSymbols(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every(s => typeof s === 'string')) return null;
  return raw as string[];
}

/** Positive integer or undefined (let the service apply its default/clamp). */
function parsePositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.floor(raw);
}
