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
import type { IAgentRepository } from '../repositories/interfaces/agent.repository.js';

const EMOJI_PALETTE = ['🟢', '🔴', '🟡', '💎', '🔥', '⚡', '🌟', '🎯', '🚀', '🏆'];
const COLOR_PALETTE_RE = /^#[0-9A-Fa-f]{6}$/;

export function createAgentStatsRouter(agentRepo: IAgentRepository): Router {
  const router = Router();

  // GET /api/agents — list all active agents (joined with stats)
  router.get('/api/agents', async (req, res) => {
    try {
      const limit  = Math.min(parseInt(req.query.limit  as string) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      const result = await agentRepo.findAgentsPaginated('ACTIVE', limit, offset);
      res.json({ agents: result.agents, total: result.total, limit, offset });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/stats/leaderboard — MUST come before /api/agents/:id
  router.get('/api/agents/stats/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const leaderboard = await agentRepo.getTopAgents(limit);
      res.json(leaderboard);
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/:id — single agent detail
  router.get('/api/agents/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const agent = await agentRepo.findAgentById(id);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      const agentStats = await agentRepo.getStats(id).catch(() => null);

      res.json({ ...agent, stats: agentStats ?? {} });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/agents/:id/customize — update cosmetics
  router.put('/api/agents/:id/customize', async (req, res) => {
    try {
      const { id } = req.params;

      if (!await agentRepo.findAgentById(id)) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const { custom_name, emoji, color, biography, nickname } = req.body as Record<string, string>;

      // Validate inputs before applying
      if (custom_name !== undefined) {
        if (!custom_name || custom_name.length === 0) throw new Error('Name cannot be empty');
        if (custom_name.length > 255) throw new Error('Name too long (max 255 chars)');
        if (!/^[a-zA-Z0-9\s\-_]+$/.test(custom_name)) throw new Error('Invalid characters in name');
      }
      if (emoji !== undefined && !EMOJI_PALETTE.includes(emoji)) {
        throw new Error(`Invalid emoji. Choose from: ${EMOJI_PALETTE.join(' ')}`);
      }
      if (color !== undefined && !COLOR_PALETTE_RE.test(color)) {
        throw new Error('Invalid hex color format (use #RRGGBB)');
      }
      if (biography !== undefined && biography.length > 1000) {
        throw new Error('Biography too long (max 1000 chars)');
      }

      const patch: Record<string, string | undefined> = {};
      if (custom_name !== undefined) patch.custom_name = custom_name;
      if (emoji       !== undefined) patch.emoji       = emoji;
      if (color       !== undefined) patch.color       = color;
      if (biography   !== undefined) patch.biography   = biography;
      if (nickname    !== undefined) patch.nickname    = nickname;

      if (Object.keys(patch).length > 0) {
        await agentRepo.updateCosmetics(id, patch);
      }

      const updated = await agentRepo.findAgentById(id);
      res.json(updated);
    } catch (error: unknown) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/agents/:id/retire — manually remove an active agent from the pool
  router.post('/api/agents/:id/retire', async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await agentRepo.findAgentById(id);
      if (!existing) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      if (existing.status === 'RETIRED') {
        return res.status(400).json({ error: 'Agent is already retired' });
      }

      await agentRepo.updateAgentStatus(id, 'RETIRED');
      const updated = await agentRepo.findAgentById(id);

      res.json({ retired: true, agent: updated });
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/agents/:id/history — competition history
  router.get('/api/agents/:id/history', async (req, res) => {
    try {
      const { id } = req.params;
      const limit  = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const history = await agentRepo.getAgentCompetitions(id, limit);

      res.json(history);
    } catch (error: unknown) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
