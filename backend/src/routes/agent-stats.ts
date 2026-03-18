/**
 * Agent Stats Routes — Phase 1 of the Evolutionary Agent System
 *
 * Endpoints:
 *   GET  /api/agents                      - paginated list of all active agents
 *   GET  /api/agents/stats/leaderboard    - top agents by win rate
 *   GET  /api/agents/:id                  - single agent with stats
 *   PUT  /api/agents/:id/customize        - update cosmetics
 *   POST /api/agents/:id/retire           - manually retire an underperforming agent
 *   GET  /api/agents/:id/history          - competition history for one agent
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import { AgentCosmeticsManager } from '../services/evolutionary/agent-cosmetics-manager.js';
import { AgentStatisticsManager } from '../services/evolutionary/agent-statistics-manager.js';

export function createAgentStatsRouter(db: Database.Database): Router {
  const router = Router();
  const cosmetics = new AgentCosmeticsManager(db);
  const stats     = new AgentStatisticsManager(db);

  // GET /api/agents — list all active agents (joined with stats)
  router.get('/api/agents', (req, res) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit  as string) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const agents = db.prepare(`
        SELECT
          r.id, r.agent_type, r.risk_profile, r.status,
          r.custom_name, r.emoji, r.color, r.biography, r.nickname,
          r.age_iterations, r.generation_number, r.created_at,
          s.total_competitions, s.total_wins, s.total_losses,
          s.win_rate_percent, s.total_pnl, s.sharpe_ratio, s.roi_percent
        FROM agent_registry r
        LEFT JOIN agent_statistics s ON r.id = s.agent_id
        WHERE r.status = 'ACTIVE'
        ORDER BY COALESCE(s.win_rate_percent, 0) DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const total = (db.prepare(
        "SELECT COUNT(*) AS count FROM agent_registry WHERE status = 'ACTIVE'"
      ).get() as { count: number }).count;

      res.json({ agents, total, limit, offset });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/stats/leaderboard — MUST come before /api/agents/:id
  router.get('/api/agents/stats/leaderboard', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const leaderboard = stats.getTopAgents(limit);
      res.json(leaderboard);
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/:id — single agent detail
  router.get('/api/agents/:id', (req, res) => {
    try {
      const { id } = req.params;

      const agent = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      let agentStats = null;
      try { agentStats = stats.getStats(id); } catch { /* no stats yet */ }

      res.json({ ...agent, stats: agentStats ?? {} });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/agents/:id/customize — update cosmetics
  router.put('/api/agents/:id/customize', (req, res) => {
    try {
      const { id } = req.params;

      if (!db.prepare('SELECT id FROM agent_registry WHERE id = ?').get(id)) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const { custom_name, emoji, color, biography, nickname } = req.body as Record<string, string>;

      if (custom_name !== undefined) cosmetics.setCustomName(id, custom_name);
      if (emoji       !== undefined) cosmetics.setEmoji(id, emoji);
      if (color       !== undefined) cosmetics.setColor(id, color);
      if (biography   !== undefined) cosmetics.setBiography(id, biography);
      if (nickname    !== undefined) cosmetics.setNickname(id, nickname);

      const updated = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id);
      res.json(updated);
    } catch (error: unknown) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/agents/:id/retire — manually remove an active agent from the pool
  router.post('/api/agents/:id/retire', (req, res) => {
    try {
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id) as { status?: string } | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (existing.status === 'RETIRED') {
        return res.status(400).json({ error: 'Agent is already retired' });
      }

      db.prepare("UPDATE agent_registry SET status = 'RETIRED' WHERE id = ?").run(id);
      const updated = db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id);

      res.json({ retired: true, agent: updated });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/:id/history — competition history
  router.get('/api/agents/:id/history', (req, res) => {
    try {
      const { id } = req.params;
      const limit  = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const history = db.prepare(`
        SELECT
          competition_id, rank_position, starting_capital, ending_capital,
          pnl, trades_count, win_trades, loss_trades,
          largest_win, largest_loss, sharpe_ratio, completed_at
        FROM agent_competitions
        WHERE agent_id = ?
        ORDER BY completed_at DESC
        LIMIT ?
      `).all(id, limit);

      res.json(history);
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
