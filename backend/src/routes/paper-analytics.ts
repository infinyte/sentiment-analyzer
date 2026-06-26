/**
 * Paper Analytics Routes
 *
 * Read-only, net-of-fees expectancy analytics over the active paper exchange's
 * fill history. Reconstructs round-trip trades from the flat `getOrderHistory()`
 * stream (FIFO-matching SELLs against prior BUYs) and exposes the resulting
 * metrics — see services/analytics/expectancy.ts for the math.
 *
 * Endpoints (all under /api/paper/):
 *   GET  stats          — full ExpectancyReport (net-of-fees)
 *   GET  trades?limit=N — most recent N reconstructed closed round trips
 *   GET  export         — writes the report + closed trades to a timestamped JSON file
 *
 * Stateless: nothing is persisted to the database. The optional export writes a
 * plain JSON file under the data directory — no schema, no table.
 */

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ExchangeInterface } from '../services/exchange/exchange-interface.js';
import {
  computeExpectancyReport,
  reconstructClosedTrades,
  type ExpectancyOptions,
} from '../services/analytics/expectancy.js';
import logger from '../logger.js';

export interface PaperAnalyticsOptions extends ExpectancyOptions {
  /** Directory for the optional JSON export. Default: <cwd>/data. */
  dataDir?: string;
}

export function createPaperAnalyticsRouter(
  exchange: ExchangeInterface,
  options: PaperAnalyticsOptions = {},
): Router {
  const router = Router();
  const dataDir = options.dataDir ?? path.join(process.cwd(), 'data');

  // GET /api/paper/stats — full net-of-fees expectancy report
  router.get('/api/paper/stats', async (_req, res) => {
    try {
      const report = await computeExpectancyReport(exchange, options);
      res.json(report);
    } catch (err: unknown) {
      logger.error('paper-analytics: stats failed', { error: errMsg(err) });
      res.status(500).json({ error: errMsg(err) });
    }
  });

  // GET /api/paper/trades?limit=N — most recent N reconstructed closed round trips
  router.get('/api/paper/trades', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit, 100);
      const orders = await exchange.getOrderHistory(options.limit ?? 100_000);
      const closed = reconstructClosedTrades(orders);
      // Closed trades are produced in fill (chronological) order; take the newest N.
      res.json(closed.slice(-limit));
    } catch (err: unknown) {
      logger.error('paper-analytics: trades failed', { error: errMsg(err) });
      res.status(500).json({ error: errMsg(err) });
    }
  });

  // GET /api/paper/export — persist the report + closed trades to a timestamped JSON file
  router.get('/api/paper/export', async (_req, res) => {
    try {
      const orders = await exchange.getOrderHistory(options.limit ?? 100_000);
      const report = await computeExpectancyReport(exchange, options);
      const closedTrades = reconstructClosedTrades(orders);

      fs.mkdirSync(dataDir, { recursive: true });
      // Colons are illegal in filenames on some platforms — strip them from the ISO stamp.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(dataDir, `paper-expectancy-${stamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify({ report, closedTrades }, null, 2), 'utf8');

      logger.info('paper-analytics: report exported', { filePath });
      res.json({ exported: true, path: filePath, closedTradeCount: closedTrades.length });
    } catch (err: unknown) {
      logger.error('paper-analytics: export failed', { error: errMsg(err) });
      res.status(500).json({ error: errMsg(err) });
    }
  });

  return router;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse a positive integer ?limit=, clamped to [1, 1000]; fall back to the default. */
function parseLimit(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 1000);
}
