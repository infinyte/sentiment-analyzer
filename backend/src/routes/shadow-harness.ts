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
 *
 * In-memory only — no DB schema, no new dependencies. (Live streaming UI is Phase 6.)
 */

import { Router } from 'express';
import type { ShadowHarness } from '../services/agent/shadow-harness.js';
import logger from '../logger.js';

export function createShadowHarnessRouter(harness: ShadowHarness): Router {
  const router = Router();

  // GET /api/shadow/status
  router.get('/api/shadow/status', (_req, res) => {
    res.json(harness.getStatus());
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
