/**
 * MARL Competition Routes
 * Express router for the Multi-Agent Reinforcement Learning competition API.
 *
 * Endpoints:
 *   POST /api/marl/competition/start
 *   GET  /api/marl/competition/:competitionId/status
 *   GET  /api/marl/competition/:competitionId/results
 *   POST /api/marl/agents/compare
 *   GET  /api/marl/competitions
 *   GET  /api/marl/info
 */

import { NextFunction, Request, Response, Router } from 'express';
import { MarlCompetitionEngine } from '../services/marl-competition-engine.js';
import type { CompetitionConfig, CompetitionAgentSpec } from '../services/marl-competition-engine.js';
import logger from '../logger.js';

const router = Router();
const engine = new MarlCompetitionEngine();

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function readPositiveIntEnv(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    logger.warn('invalid marl rate limit env value', { name, raw, fallback });
    return fallback;
  }

  return parsed;
}

function createRateLimitMiddleware(bucket: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${bucket}:${clientId}`;
    const current = rateLimitStore.get(key);

    if (!current || current.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      logger.warn('marl rate limit exceeded', {
        bucket,
        clientId: String(clientId),
        path: req.path,
        method: req.method,
      });
      return res.status(429).json({
        error: 'Rate limit exceeded',
        bucket,
        retryAfterSeconds,
      });
    }

    current.count += 1;
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - current.count)));
    return next();
  };
}

const marlRateLimitWindowMs = readPositiveIntEnv('MARL_RATE_LIMIT_WINDOW_MS', 60_000, 1_000);

const competitionWriteRateLimit = createRateLimitMiddleware(
  'marl-competition-start',
  readPositiveIntEnv('MARL_START_RATE_LIMIT_MAX', 5),
  marlRateLimitWindowMs
);
const compareRateLimit = createRateLimitMiddleware(
  'marl-agents-compare',
  readPositiveIntEnv('MARL_COMPARE_RATE_LIMIT_MAX', 10),
  marlRateLimitWindowMs
);
const competitionReadRateLimit = createRateLimitMiddleware(
  'marl-competition-read',
  readPositiveIntEnv('MARL_READ_RATE_LIMIT_MAX', 120),
  marlRateLimitWindowMs
);

export function resetMarlRateLimitersForTests(): void {
  rateLimitStore.clear();
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_MODES = ['SINGLE', 'EVOLUTIONARY', 'CONTINUOUS'] as const;
const VALID_RISK_PROFILES = ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'] as const;

function isValidMode(m: unknown): m is CompetitionConfig['mode'] {
  return typeof m === 'string' && (VALID_MODES as readonly string[]).includes(m);
}

function isValidRiskProfile(r: unknown): r is CompetitionAgentSpec['riskProfile'] {
  return typeof r === 'string' && (VALID_RISK_PROFILES as readonly string[]).includes(r);
}

function sanitizeAgentId(id: string): string {
  // Prevent injection: only allow alphanumeric, underscore, hyphen (max 64 chars)
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

// ─── POST /api/marl/competition/start ─────────────────────────────────────────
/**
 * Start a new MARL competition tournament.
 * Fire-and-forget: returns immediately with competitionId.
 *
 * Body: {
 *   mode: "SINGLE" | "EVOLUTIONARY" | "CONTINUOUS",
 *   agents: [{ id: string, riskProfile: "CONSERVATIVE"|"AGGRESSIVE"|"SCALPING" }],
 *   symbols: string[],
 *   duration: number,
 *   refreshInterval: number,
 *   evolutionaryRounds?: number,
 *   learningEnabled: boolean
 * }
 *
 * Example:
 *   curl -X POST http://localhost:3000/api/marl/competition/start \
 *     -H "Content-Type: application/json" \
 *     -d '{"mode":"SINGLE","agents":[{"id":"bull","riskProfile":"AGGRESSIVE"},{"id":"bear","riskProfile":"CONSERVATIVE"}],"symbols":["BTC","ETH"],"duration":100,"refreshInterval":1000,"learningEnabled":true}'
 */
router.post('/api/marl/competition/start', competitionWriteRateLimit, (req, res) => {
  try {
    const body = req.body as {
      mode?: unknown;
      agents?: unknown;
      symbols?: unknown;
      duration?: unknown;
      refreshInterval?: unknown;
      evolutionaryRounds?: unknown;
      learningEnabled?: unknown;
    };

    if (!isValidMode(body.mode)) {
      return res.status(400).json({ error: `"mode" must be one of: ${VALID_MODES.join(', ')}` });
    }

    if (!Array.isArray(body.agents) || body.agents.length < 2) {
      return res.status(400).json({ error: '"agents" must be an array with at least 2 entries' });
    }

    if (body.agents.length > 20) {
      return res.status(400).json({ error: '"agents" array cannot exceed 20 entries' });
    }

    const agentSpecs: CompetitionAgentSpec[] = [];
    for (const a of body.agents) {
      if (typeof a !== 'object' || a === null) {
        return res.status(400).json({ error: 'Each agent must be an object' });
      }
      const agentObj = a as { id?: unknown; riskProfile?: unknown };
      if (typeof agentObj.id !== 'string' || !agentObj.id.trim()) {
        return res.status(400).json({ error: 'Each agent must have a non-empty "id" string' });
      }
      if (!isValidRiskProfile(agentObj.riskProfile)) {
        return res.status(400).json({
          error: `Each agent "riskProfile" must be one of: ${VALID_RISK_PROFILES.join(', ')}`,
        });
      }
      agentSpecs.push({
        id: sanitizeAgentId(agentObj.id),
        riskProfile: agentObj.riskProfile,
      });
    }

    if (!Array.isArray(body.symbols) || body.symbols.length === 0) {
      return res.status(400).json({ error: '"symbols" must be a non-empty array' });
    }

    const symbols: string[] = (body.symbols as unknown[])
      .filter(s => typeof s === 'string')
      .map(s => (s as string).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
      .slice(0, 20);

    if (symbols.length === 0) {
      return res.status(400).json({ error: 'No valid symbols provided' });
    }

    const duration = typeof body.duration === 'number' && body.duration > 0
      ? Math.min(Math.max(Math.floor(body.duration), 50), 100000)
      : 100;

    const refreshInterval = typeof body.refreshInterval === 'number' && body.refreshInterval > 0
      ? Math.min(Math.max(Math.floor(body.refreshInterval), 100), 60000)
      : 1000;

    const evolutionaryRounds = typeof body.evolutionaryRounds === 'number'
      ? Math.min(Math.max(Math.floor(body.evolutionaryRounds), 1), 10)
      : 3;

    const learningEnabled = body.learningEnabled !== false;

    const config: CompetitionConfig = {
      mode: body.mode,
      agents: agentSpecs,
      symbols,
      duration,
      refreshInterval,
      evolutionaryRounds,
      learningEnabled,
    };

    const competitionId = `comp_${Date.now()}`;

    // Register in store as RUNNING
    engine.storeRecord({
      competitionId,
      status: 'RUNNING',
      config,
      startedAt: new Date(),
      progress: 0,
    });

    // Fire-and-forget tournament
    engine
      .runCompetition(config, (progress) => {
        engine.updateRecord(competitionId, { progress });
      })
      .then(result => {
        engine.updateRecord(competitionId, {
          status: 'COMPLETED',
          completedAt: new Date(),
          result,
          progress: 100,
          topPerformerId: result.finalRankings[0]?.agentId,
        });
      })
      .catch(err => {
        logger.error('competition failed', { competitionId, error: String(err) });
        engine.updateRecord(competitionId, { status: 'FAILED', progress: 0 });
      });

    logger.info('competition started', {
      competitionId,
      mode: config.mode,
      agentCount: agentSpecs.length,
      symbols,
      duration,
    });

    return res.status(202).json({
      competitionId,
      status: 'STARTED',
      mode: config.mode,
      agentCount: agentSpecs.length,
      symbols,
      duration,
      learningEnabled,
      message: `Tournament started. Poll /api/marl/competition/${competitionId}/status for updates.`,
    });
  } catch (err) {
    logger.error('competition start error', { error: String(err) });
    return res.status(500).json({ error: 'Failed to start competition' });
  }
});

// ─── GET /api/marl/competition/:competitionId/status ──────────────────────────
/**
 * Poll competition status.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/competition/comp_1710644400000/status
 */
router.get('/api/marl/competition/:competitionId/status', competitionReadRateLimit, (req, res) => {
  const { competitionId } = req.params;
  const record = engine.getRecord(competitionId);

  if (!record) {
    return res.status(404).json({ error: 'Competition not found' });
  }

  if (record.status === 'RUNNING') {
    return res.json({
      competitionId,
      status: 'RUNNING',
      progress: record.progress,
      mode: record.config.mode,
      agentCount: record.config.agents.length,
      symbols: record.config.symbols,
      startedAt: record.startedAt,
      topPerformer: record.topPerformerId ?? null,
    });
  }

  if (record.status === 'FAILED') {
    return res.status(500).json({
      competitionId,
      status: 'FAILED',
      startedAt: record.startedAt,
    });
  }

  // COMPLETED
  const result = record.result!;
  return res.json({
    competitionId,
    status: 'COMPLETED',
    progress: 100,
    mode: record.config.mode,
    agentCount: record.config.agents.length,
    symbols: record.config.symbols,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    topPerformer: result.finalRankings[0]?.agentId ?? null,
    topReturn: result.finalRankings[0]
      ? `${(result.finalRankings[0].totalReturn * 100).toFixed(2)}%`
      : null,
  });
});

// ─── GET /api/marl/competition/:competitionId/results ────────────────────────
/**
 * Retrieve full competition results.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/competition/comp_1710644400000/results
 */
router.get('/api/marl/competition/:competitionId/results', competitionReadRateLimit, (req, res) => {
  const { competitionId } = req.params;
  const record = engine.getRecord(competitionId);

  if (!record) {
    return res.status(404).json({ error: 'Competition not found' });
  }
  if (record.status === 'RUNNING') {
    return res.status(202).json({
      error: 'Competition still running',
      competitionId,
      progress: record.progress,
    });
  }
  if (record.status === 'FAILED') {
    return res.status(500).json({ error: 'Competition failed', competitionId });
  }

  const result = record.result!;
  return res.json({
    ...result,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    finalRankings: result.finalRankings.map(r => ({
      ...r,
      totalReturn: parseFloat((r.totalReturn * 100).toFixed(2)), // return as percentage
      sharpeRatio: parseFloat(r.sharpeRatio.toFixed(3)),
      maxDrawdown: parseFloat((r.maxDrawdown * 100).toFixed(2)),
      winRate: parseFloat((r.winRate * 100).toFixed(1)),
    })),
    headToHeadMetrics: result.headToHeadMetrics.map(h => ({
      ...h,
      agent1Return: parseFloat((h.agent1Return * 100).toFixed(2)),
      agent2Return: parseFloat((h.agent2Return * 100).toFixed(2)),
    })),
    competitorImpact: result.competitorImpact.map(c => ({
      ...c,
      averageLiquidityImpact: parseFloat(c.averageLiquidityImpact.toFixed(4)),
    })),
  });
});

// ─── POST /api/marl/agents/compare ───────────────────────────────────────────
/**
 * Run N rounds comparing two agents and return averaged statistics.
 *
 * Body: {
 *   agent1: { id, riskProfile },
 *   agent2: { id, riskProfile },
 *   symbols: string[],
 *   duration: number,
 *   rounds: number
 * }
 *
 * Example:
 *   curl -X POST http://localhost:3000/api/marl/agents/compare \
 *     -H "Content-Type: application/json" \
 *     -d '{"agent1":{"id":"bull","riskProfile":"AGGRESSIVE"},"agent2":{"id":"bear","riskProfile":"CONSERVATIVE"},"symbols":["BTC"],"duration":100,"rounds":3}'
 */
router.post('/api/marl/agents/compare', compareRateLimit, async (req, res) => {
  try {
    const body = req.body as {
      agent1?: unknown;
      agent2?: unknown;
      symbols?: unknown;
      duration?: unknown;
      rounds?: unknown;
    };

    const a1 = body.agent1 as { id?: unknown; riskProfile?: unknown } | undefined;
    const a2 = body.agent2 as { id?: unknown; riskProfile?: unknown } | undefined;

    if (!a1 || !a2 || typeof a1.id !== 'string' || typeof a2.id !== 'string') {
      return res.status(400).json({ error: '"agent1" and "agent2" with string "id" are required' });
    }
    if (!isValidRiskProfile(a1.riskProfile) || !isValidRiskProfile(a2.riskProfile)) {
      return res.status(400).json({ error: 'Both agents need a valid riskProfile' });
    }

    const symbols: string[] = Array.isArray(body.symbols)
      ? (body.symbols as unknown[]).filter(s => typeof s === 'string').map(s => (s as string).toUpperCase().slice(0, 10)).slice(0, 10)
      : ['BTC'];

    const duration = typeof body.duration === 'number' ? Math.min(Math.max(body.duration, 50), 10000) : 100;
    const rounds = typeof body.rounds === 'number' ? Math.min(Math.max(Math.floor(body.rounds), 1), 10) : 3;

    const config: CompetitionConfig = {
      mode: 'SINGLE',
      agents: [
        { id: sanitizeAgentId(a1.id), riskProfile: a1.riskProfile },
        { id: sanitizeAgentId(a2.id), riskProfile: a2.riskProfile },
      ],
      symbols,
      duration,
      refreshInterval: 1000,
      learningEnabled: true,
    };

    const roundResults: { agent1Return: number; agent2Return: number; winner: string }[] = [];

    for (let r = 0; r < rounds; r++) {
      const result = await engine.runSingleTournament(config);
      const a1Rank = result.finalRankings.find(rk => rk.agentId === config.agents[0].id);
      const a2Rank = result.finalRankings.find(rk => rk.agentId === config.agents[1].id);
      roundResults.push({
        agent1Return: a1Rank?.totalReturn ?? 0,
        agent2Return: a2Rank?.totalReturn ?? 0,
        winner: (a1Rank?.totalReturn ?? 0) >= (a2Rank?.totalReturn ?? 0)
          ? config.agents[0].id
          : config.agents[1].id,
      });
    }

    const agent1Wins = roundResults.filter(r => r.winner === config.agents[0].id).length;
    const agent2Wins = rounds - agent1Wins;
    const avgA1Return = roundResults.reduce((s, r) => s + r.agent1Return, 0) / rounds;
    const avgA2Return = roundResults.reduce((s, r) => s + r.agent2Return, 0) / rounds;

    return res.json({
      agent1: config.agents[0].id,
      agent2: config.agents[1].id,
      rounds,
      agent1Wins,
      agent2Wins,
      agent1WinRate: parseFloat(((agent1Wins / rounds) * 100).toFixed(1)),
      agent2WinRate: parseFloat(((agent2Wins / rounds) * 100).toFixed(1)),
      avgAgent1Return: parseFloat((avgA1Return * 100).toFixed(2)),
      avgAgent2Return: parseFloat((avgA2Return * 100).toFixed(2)),
      overallWinner: agent1Wins >= agent2Wins ? config.agents[0].id : config.agents[1].id,
      roundDetails: roundResults.map((r, i) => ({
        round: i + 1,
        winner: r.winner,
        agent1Return: parseFloat((r.agent1Return * 100).toFixed(2)),
        agent2Return: parseFloat((r.agent2Return * 100).toFixed(2)),
      })),
    });
  } catch (err) {
    logger.error('agent compare error', { error: String(err) });
    return res.status(500).json({ error: 'Agent comparison failed' });
  }
});

// ─── GET /api/marl/competitions ───────────────────────────────────────────────
/**
 * List all competitions (running + completed), ordered by most recent.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/competitions
 */
router.get('/api/marl/competitions', competitionReadRateLimit, (_req, res) => {
  const all = engine.getAllRecords();
  return res.json({
    total: all.length,
    competitions: all.map(r => ({
      competitionId: r.competitionId,
      status: r.status,
      mode: r.config.mode,
      agentCount: r.config.agents.length,
      symbols: r.config.symbols,
      duration: r.config.duration,
      learningEnabled: r.config.learningEnabled,
      startedAt: r.startedAt,
      completedAt: r.completedAt ?? null,
      progress: r.progress,
      topPerformer: r.topPerformerId ?? null,
      topReturn: r.result?.finalRankings[0]
        ? `${(r.result.finalRankings[0].totalReturn * 100).toFixed(2)}%`
        : null,
    })),
  });
});

// ─── GET /api/marl/info ───────────────────────────────────────────────────────
/**
 * Documentation endpoint.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/info
 */
router.get('/api/marl/info', competitionReadRateLimit, (_req, res) => {
  return res.json({
    description: 'MARL Competitive Trading Framework — Phase 2',
    tournamentModes: {
      SINGLE: 'All agents trade simultaneously for a fixed number of steps. Rankings by total return.',
      EVOLUTIONARY: 'Multi-round elimination. Top 50% survive; bottom performers replaced with mutants.',
      CONTINUOUS: 'Hourly trade-then-learn cycles. Agents accumulate knowledge across rounds.',
    },
    riskProfiles: {
      CONSERVATIVE: { maxRiskPct: '1%', stopLoss: '2%', takeProfit: '5%', maxHoldDays: 5 },
      AGGRESSIVE:   { maxRiskPct: '5%', stopLoss: '8%', takeProfit: '20%', maxHoldDays: 14 },
      SCALPING:     { maxRiskPct: '3%', stopLoss: '1.5%', takeProfit: '3%', maxHoldDays: 2 },
    },
    learningAlgorithm: {
      type: 'Q-Learning + Policy Gradient',
      stateSpace: '50 features (price, portfolio, competitors, history, sentiment)',
      actionSpace: ['BUY', 'SELL', 'HOLD', 'CANCEL', 'WAIT'],
      policyNetwork: 'Feedforward: 50→64(ReLU)→32(ReLU)→5(Softmax)',
      explorationStrategy: 'Epsilon-greedy (ε decays 0.995 per step, min 0.01)',
      replayBuffer: 'Up to 1000 experiences, sampled randomly',
    },
    orderBook: {
      matching: 'Price-time priority FIFO',
      slippage: 'slippage_bps = min((order_size / market_depth) * 100, 50)',
      crossAgentTrading: 'Agents can fill each other\'s orders',
    },
    metrics: {
      sharpeRatio: 'Annualised (√252 × mean_return / std_dev)',
      maxDrawdown: '(peak − trough) / peak',
      headToHead: 'All pairwise return comparisons',
      competitorImpact: 'Avg slippage bps, times outbid/outsold',
    },
    endpoints: {
      'POST /api/marl/competition/start': 'Start a new tournament',
      'GET  /api/marl/competition/:id/status': 'Poll running competition',
      'GET  /api/marl/competition/:id/results': 'Fetch completed results',
      'POST /api/marl/agents/compare': 'Head-to-head multi-round comparison',
      'GET  /api/marl/competitions': 'List all competitions',
      'GET  /api/marl/info': 'This documentation',
    },
  });
});

export default router;
