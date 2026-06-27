/**
 * Agent Orchestrator Routes
 *
 * Exposes the Phase 3 single-cycle agent: it reads signals, applies the decision
 * policy, and routes orders through the safety-guarded TradingService onto the
 * shared paper exchange (the same instance the trading + paper-analytics routers
 * use, so executed trades show up in /api/paper/stats).
 *
 * Endpoints (all under /api/agent/):
 *   GET  config        — current decision-policy config + trading mode
 *   POST run           — run one decision cycle; body { symbols?, signals?, dryRun? }
 *
 * Read-mostly: only POST /api/agent/run places orders, and only when dryRun is not
 * set. No DB schema, no new dependencies.
 */

import { Router } from 'express';
import {
  TradingAgentOrchestrator,
  type AgentSignal,
} from '../services/agent/trading-orchestrator.js';
import type { MarlPolicyFeeder } from '../services/agent/marl-policy-feeder.js';
import logger from '../logger.js';

export function createAgentOrchestratorRouter(
  orchestrator: TradingAgentOrchestrator,
  mode: string,
  marlFeeder?: MarlPolicyFeeder,
): Router {
  const router = Router();

  // GET /api/agent/config
  router.get('/api/agent/config', (_req, res) => {
    res.json({ mode, policy: orchestrator.getConfig() });
  });

  // ── Phase 7: MARL research feeder ──────────────────────────────────────────
  if (marlFeeder) {
    // GET /api/agent/marl-policy — the policy the best evolved genome recommends
    router.get('/api/agent/marl-policy', async (_req, res) => {
      try {
        const rec = await marlFeeder.recommend();
        if (!rec) { res.status(404).json({ error: 'no evolved agent available to derive a policy from' }); return; }
        res.json(rec);
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    // POST /api/agent/apply-marl-policy — apply that policy to the live orchestrator
    router.post('/api/agent/apply-marl-policy', async (_req, res) => {
      try {
        const rec = await marlFeeder.recommend();
        if (!rec) { res.status(404).json({ error: 'no evolved agent available to derive a policy from' }); return; }
        const config = orchestrator.setConfig(rec.params);
        logger.info('agent-orchestrator: applied MARL-fed policy', { agentId: rec.provenance.agentId, params: rec.params });
        res.json({ applied: true, config, provenance: rec.provenance });
      } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  // POST /api/agent/run
  router.post('/api/agent/run', async (req, res) => {
    const body = (req.body ?? {}) as { symbols?: unknown; signals?: unknown; dryRun?: unknown };

    const symbols = parseSymbols(body.symbols);
    const signals = parseSignals(body.signals);
    if (symbols === null) {
      res.status(400).json({ error: 'symbols, when provided, must be an array of strings' });
      return;
    }
    if (signals === null) {
      res.status(400).json({ error: 'signals, when provided, must be an array of { symbol, signal, strength }' });
      return;
    }
    if (symbols.length === 0 && signals.length === 0) {
      res.status(400).json({ error: 'provide at least one of: symbols[] or signals[]' });
      return;
    }

    try {
      const report = await orchestrator.run({
        symbols: symbols.length > 0 ? symbols : undefined,
        signals: signals.length > 0 ? signals : undefined,
        dryRun:  body.dryRun === true,
      });
      res.json(report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('agent-orchestrator: run failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

// ── Body parsing ────────────────────────────────────────────────────────────

/** Returns string[] (possibly empty) or null when the field is present but malformed. */
function parseSymbols(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every(s => typeof s === 'string')) return null;
  return raw as string[];
}

/** Returns AgentSignal[] (possibly empty) or null when present but malformed. */
function parseSignals(raw: unknown): AgentSignal[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const out: AgentSignal[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { symbol, signal, strength, reasoning } = item as Record<string, unknown>;
    if (typeof symbol !== 'string') return null;
    if (signal !== 'BUY' && signal !== 'SELL' && signal !== 'HOLD') return null;
    const strengthNum = typeof strength === 'number' ? strength : 0;
    out.push({
      symbol,
      signal,
      strength: Number.isFinite(strengthNum) ? Math.min(1, Math.max(0, strengthNum)) : 0,
      reasoning: typeof reasoning === 'string' ? reasoning : undefined,
    });
  }
  return out;
}
