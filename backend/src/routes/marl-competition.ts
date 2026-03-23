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
import type { CompetitionConfig, CompetitionAgentSpec, CompetitionResult, SymbolSelectionMode } from '../services/marl-competition-engine.js';
import { brokerRegistry } from '../services/brokers/broker-registry.js';
import type { ExchangeMode, RiskConfig } from '../types/broker.js';
import { workerPool } from '../services/worker-pool.js';
import { getPubSub, competitionChannel } from '../services/pubsub.js';
import type { CompetitionPubSubEvent } from '../services/pubsub.js';
import { configService } from '../services/config-service.js';
import { PreTrainer } from '../services/pre-trainer.js';
import type { RiskProfile } from '../services/pre-trainer.js';
import type { MarketRegime } from '../services/synthetic-market-generator.js';
import { getTournamentQueue } from '../queues/tournament.queue.js';
import { isQueueAvailable } from '../queues/connection.js';
import { appConfigService } from '../services/app-config-service.js';
import { QueueEvents } from 'bullmq';
import { createConnectionOptions } from '../queues/connection.js';
import logger from '../logger.js';

const router     = Router();
const engine     = new MarlCompetitionEngine();
const preTrainer = new PreTrainer();

// ── BullMQ QueueEvents bridge ─────────────────────────────────────────────────
// When tournaments run in a separate worker process via BullMQ, the API process
// must listen for job completion / failure events and update the in-memory
// competition registry accordingly.

let _queueEvents: QueueEvents | null = null;

function ensureQueueEventsListener(): void {
  if (_queueEvents || !isQueueAvailable()) return;

  _queueEvents = new QueueEvents('tournament', { connection: createConnectionOptions() });

  _queueEvents.on('progress', ({ jobId, data }) => {
    engine.updateRecord(jobId, { progress: data as number });
  });

  _queueEvents.on('completed', ({ jobId, returnvalue }) => {
    try {
      const result: CompetitionResult =
        typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
      engine.updateRecord(jobId, {
        status:         'COMPLETED',
        completedAt:    new Date(),
        result,
        progress:       100,
        topPerformerId: result.finalRankings?.[0]?.agentId,
      });
    } catch (err) {
      logger.error('queueEvents: failed to parse completed returnvalue', { jobId, error: String(err) });
      engine.updateRecord(jobId, { status: 'FAILED', progress: 0 });
    }
  });

  _queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('queueEvents: tournament job failed', { competitionId: jobId, reason: failedReason });
    engine.updateRecord(jobId, { status: 'FAILED', progress: 0 });
  });

  _queueEvents.on('error', (err) => {
    logger.error('queueEvents: connection error', { error: String(err) });
  });

  logger.info('marl-competition: BullMQ QueueEvents listener attached');
}

async function closeQueueEventsListener(): Promise<void> {
  if (!_queueEvents) return;
  try {
    await _queueEvents.close();
    logger.info('marl-competition: BullMQ QueueEvents listener closed');
  } catch (err) {
    logger.error('marl-competition: error closing QueueEvents listener', { error: String(err) });
  } finally {
    _queueEvents = null;
  }
}

export { closeQueueEventsListener };

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type MarlRateLimitConfig = {
  windowMs: number;
  startMax: number;
  compareMax: number;
  readMax: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function readPositiveIntConfig(
  env: NodeJS.ProcessEnv | undefined,
  name: string,
  fallback: number,
  minimum = 1
): number {
  const raw = env?.[name] ?? appConfigService.get(name);
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    logger.warn('invalid marl rate limit env value', { name, raw, fallback });
    return fallback;
  }

  return parsed;
}

export function resolveMarlRateLimitConfig(env?: NodeJS.ProcessEnv): MarlRateLimitConfig {
  return {
    windowMs: readPositiveIntConfig(env, 'MARL_RATE_LIMIT_WINDOW_MS', 60_000, 1_000),
    startMax: readPositiveIntConfig(env, 'MARL_START_RATE_LIMIT_MAX', 5),
    compareMax: readPositiveIntConfig(env, 'MARL_COMPARE_RATE_LIMIT_MAX', 10),
    readMax: readPositiveIntConfig(env, 'MARL_READ_RATE_LIMIT_MAX', 120),
  };
}

function getClientId(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string') {
    const firstForwarded = forwarded.split(',')[0]?.trim();
    if (firstForwarded) return firstForwarded;
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const firstForwarded = forwarded[0]?.split(',')[0]?.trim();
    if (firstForwarded) return firstForwarded;
  }

  return req.ip || 'unknown';
}

function createRateLimitMiddleware(bucket: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientId = getClientId(req);
    const key = `${bucket}:${clientId}`;
    const current = rateLimitStore.get(key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + windowMs;
      rateLimitStore.set(key, { count: 1, resetAt });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      res.setHeader('X-RateLimit-Reset', String(resetAt));
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(current.resetAt));
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
    res.setHeader('X-RateLimit-Reset', String(current.resetAt));
    return next();
  };
}

const marlRateLimitConfig = resolveMarlRateLimitConfig();

const competitionWriteRateLimit = createRateLimitMiddleware(
  'marl-competition-start',
  marlRateLimitConfig.startMax,
  marlRateLimitConfig.windowMs
);
const compareRateLimit = createRateLimitMiddleware(
  'marl-agents-compare',
  marlRateLimitConfig.compareMax,
  marlRateLimitConfig.windowMs
);
const competitionReadRateLimit = createRateLimitMiddleware(
  'marl-competition-read',
  marlRateLimitConfig.readMax,
  marlRateLimitConfig.windowMs
);

export function resetMarlRateLimitersForTests(): void {
  rateLimitStore.clear();
}

// ─── Validation helpers ───────────────────────────────────────────────────────

const VALID_MODES = ['SINGLE', 'EVOLUTIONARY', 'CONTINUOUS'] as const;
const VALID_RISK_PROFILES = ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'] as const;
const VALID_SELECTION_MODES = ['MANUAL', 'AUTO'] as const;

function isValidSelectionMode(m: unknown): m is SymbolSelectionMode {
  return typeof m === 'string' && (VALID_SELECTION_MODES as readonly string[]).includes(m);
}

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

function normalizeInitialCapital(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.min(Math.max(Math.floor(value), 100), 10_000_000);
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
      symbolSelectionMode?: unknown;
      autoUniverseSize?: unknown;
      autoCoinsPerAgent?: unknown;
      duration?: unknown;
      refreshInterval?: unknown;
      evolutionaryRounds?: unknown;
      learningEnabled?: unknown;
      enableSentimentFeatures?: unknown;
      exchangeMode?: unknown;
      brokerCredentialId?: unknown;
      riskConfig?: unknown;
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
      const agentObj = a as { id?: unknown; riskProfile?: unknown; initialCapital?: unknown };
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
        initialCapital: normalizeInitialCapital(agentObj.initialCapital),
      });
    }

    // ─── Symbol selection mode ─────────────────────────────────────────────
    const symbolSelectionMode: SymbolSelectionMode =
      body.symbolSelectionMode !== undefined
        ? isValidSelectionMode(body.symbolSelectionMode)
          ? body.symbolSelectionMode
          : (() => { res.status(400).json({ error: `"symbolSelectionMode" must be one of: ${VALID_SELECTION_MODES.join(', ')}` }); return null as unknown as SymbolSelectionMode; })()
        : 'MANUAL';

    if (!symbolSelectionMode) return;

    let symbols: string[] = [];
    if (symbolSelectionMode === 'MANUAL') {
      if (!Array.isArray(body.symbols) || body.symbols.length === 0) {
        return res.status(400).json({ error: '"symbols" must be a non-empty array when symbolSelectionMode is "MANUAL"' });
      }
      symbols = (body.symbols as unknown[])
        .filter(s => typeof s === 'string')
        .map(s => (s as string).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
        .slice(0, 20);
      if (symbols.length === 0) {
        return res.status(400).json({ error: 'No valid symbols provided' });
      }
    }

    const autoUniverseSize = typeof body.autoUniverseSize === 'number'
      ? Math.min(Math.max(Math.floor(body.autoUniverseSize), 10), 200)
      : 50;

    const autoCoinsPerAgent = typeof body.autoCoinsPerAgent === 'number'
      ? Math.min(Math.max(Math.floor(body.autoCoinsPerAgent), 1), 10)
      : 3;

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

    // When not explicitly set: enable sentiment features if a known NLP API key is configured
    const enableSentimentFeatures = typeof body.enableSentimentFeatures === 'boolean'
      ? body.enableSentimentFeatures
      : !!(appConfigService.get('FINBERT_API_URL') || appConfigService.get('LUNARCRUSH_API_KEY'));

    // ─── exchangeMode / broker validation ────────────────────────────────────
    const VALID_EXCHANGE_MODES = ['SIMULATED', 'PAPER', 'LIVE'] as const;
    let exchangeMode: ExchangeMode = 'SIMULATED';
    if (body.exchangeMode !== undefined) {
      if (
        typeof body.exchangeMode !== 'string' ||
        !(VALID_EXCHANGE_MODES as readonly string[]).includes(body.exchangeMode)
      ) {
        return res.status(400).json({ error: `"exchangeMode" must be one of: ${VALID_EXCHANGE_MODES.join(', ')}` });
      }
      exchangeMode = body.exchangeMode as ExchangeMode;
    }

    let brokerCredentialId: string | undefined;
    if (exchangeMode === 'PAPER' || exchangeMode === 'LIVE') {
      if (typeof body.brokerCredentialId !== 'string' || !body.brokerCredentialId.trim()) {
        return res.status(400).json({
          error: '"brokerCredentialId" is required when exchangeMode is PAPER or LIVE',
        });
      }
      // Sanitize: UUIDs contain hex digits and hyphens only, max 36 chars
      const sanitizedCredId = body.brokerCredentialId
        .replace(/[^a-zA-Z0-9-]/g, '')
        .slice(0, 36);
      if (!brokerRegistry.has(sanitizedCredId)) {
        return res.status(400).json({
          error: `Broker adapter for credentialId "${sanitizedCredId}" is not connected — call POST /api/marl/broker/connect/:id first`,
        });
      }
      brokerCredentialId = sanitizedCredId;
    }

    let riskConfig: RiskConfig | undefined;
    if (body.riskConfig !== undefined) {
      if (typeof body.riskConfig !== 'object' || body.riskConfig === null || Array.isArray(body.riskConfig)) {
        return res.status(400).json({ error: '"riskConfig" must be an object' });
      }
      const rc = body.riskConfig as Record<string, unknown>;

      const maxPositionPct     = typeof rc.maxPositionPct     === 'number' ? rc.maxPositionPct     : 0.10;
      const maxLossPerStepPct  = typeof rc.maxLossPerStepPct  === 'number' ? rc.maxLossPerStepPct  : 0.02;
      const maxDailyDrawdownPct= typeof rc.maxDailyDrawdownPct=== 'number' ? rc.maxDailyDrawdownPct: 0.10;

      if (maxPositionPct <= 0 || maxPositionPct > 1) {
        return res.status(400).json({ error: '"riskConfig.maxPositionPct" must be between 0 (exclusive) and 1 (inclusive)' });
      }
      if (maxLossPerStepPct <= 0 || maxLossPerStepPct > 1) {
        return res.status(400).json({ error: '"riskConfig.maxLossPerStepPct" must be between 0 (exclusive) and 1 (inclusive)' });
      }
      if (maxDailyDrawdownPct <= 0 || maxDailyDrawdownPct > 1) {
        return res.status(400).json({ error: '"riskConfig.maxDailyDrawdownPct" must be between 0 (exclusive) and 1 (inclusive)' });
      }

      const allowedSymbols = Array.isArray(rc.allowedSymbols)
        ? (rc.allowedSymbols as unknown[])
            .filter(s => typeof s === 'string')
            .map(s => (s as string).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))
        : [];

      riskConfig = {
        maxPositionPct,
        maxLossPerStepPct,
        maxDailyDrawdownPct,
        allowedSymbols,
        capitalIsolation: typeof rc.capitalIsolation === 'boolean' ? rc.capitalIsolation : true,
      };
    }

    const config: CompetitionConfig = {
      mode: body.mode,
      agents: agentSpecs,
      symbols,
      symbolSelectionMode,
      autoUniverseSize,
      autoCoinsPerAgent,
      duration,
      refreshInterval,
      evolutionaryRounds,
      learningEnabled,
      enableSentimentFeatures,
      exchangeMode,
      brokerCredentialId,
      riskConfig,
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

    // Fire-and-forget tournament.
    // CPU-bound SIMULATED competitions run on a Worker Thread so the main
    // event loop stays responsive. Real-money modes (PAPER/LIVE) keep the
    // existing main-thread path because they use setInterval + broker I/O.
    const isSimulated = exchangeMode === 'SIMULATED';

    const onSuccess = (result: Awaited<ReturnType<typeof engine.runCompetition>>) => {
      engine.updateRecord(competitionId, {
        status:          'COMPLETED',
        completedAt:     new Date(),
        result,
        progress:        100,
        topPerformerId:  result.finalRankings?.[0]?.agentId,
      });
    };
    const onFailure = (err: unknown) => {
      logger.error('competition failed', { competitionId, error: String(err) });
      engine.updateRecord(competitionId, { status: 'FAILED', progress: 0 });
    };

    if (isSimulated) {
      if (isQueueAvailable()) {
        // BullMQ path: enqueue job in Redis; a tournament-worker-process picks it up.
        // Use competitionId as the job ID so QueueEvents can map events back to records.
        ensureQueueEventsListener();
        getTournamentQueue()
          .add('tournament', { competitionId, config }, { jobId: competitionId })
          .catch((err: unknown) => {
            logger.error('failed to enqueue tournament job', { competitionId, error: String(err) });
            engine.updateRecord(competitionId, { status: 'FAILED', progress: 0 });
          });
      } else {
        // Fallback: Worker Thread (no Redis configured)
        const handle = workerPool.runMarlCompetition(
          competitionId,
          config,
          (progress) => engine.updateRecord(competitionId, { progress }),
        );
        handle.result.then(onSuccess).catch(onFailure);
      }
    } else {
      engine
        .runCompetition(config, (progress) => {
          engine.updateRecord(competitionId, { progress });
        }, competitionId)
        .then(onSuccess)
        .catch(onFailure);
    }

    logger.info('competition started', {
      competitionId,
      mode: config.mode,
      exchangeMode,
      agentCount: agentSpecs.length,
      symbols,
      duration,
    });

    return res.status(202).json({
      competitionId,
      status: 'STARTED',
      mode: config.mode,
      exchangeMode,
      symbolSelectionMode,
      agentCount: agentSpecs.length,
      symbols: symbolSelectionMode === 'AUTO' ? '(resolved at runtime)' : symbols,
      duration,
      learningEnabled,
      message: symbolSelectionMode === 'AUTO'
        ? `Tournament started with AUTO coin selection. Agents will choose from the top ${autoUniverseSize} coins (${autoCoinsPerAgent} per agent). Poll /api/marl/competition/${competitionId}/status for updates.`
        : `Tournament started. Poll /api/marl/competition/${competitionId}/status for updates.`,
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
    return res.status(200).json({
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

    const a1 = body.agent1 as { id?: unknown; riskProfile?: unknown; initialCapital?: unknown } | undefined;
    const a2 = body.agent2 as { id?: unknown; riskProfile?: unknown; initialCapital?: unknown } | undefined;

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
        {
          id: sanitizeAgentId(a1.id),
          riskProfile: a1.riskProfile,
          initialCapital: normalizeInitialCapital(a1.initialCapital),
        },
        {
          id: sanitizeAgentId(a2.id),
          riskProfile: a2.riskProfile,
          initialCapital: normalizeInitialCapital(a2.initialCapital),
        },
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

// ─── GET /api/marl/agents/learning ───────────────────────────────────────────
/**
 * List all agent learning states currently held in the process cache (and SQLite).
 *
 * Example:
 *   curl http://localhost:3000/api/marl/agents/learning
 */
router.get('/api/marl/agents/learning', competitionReadRateLimit, (_req, res) => {
  const states = engine.listLearningStates();
  return res.json({ count: states.length, agents: states });
});

// ─── DELETE /api/marl/agents/:agentId/learning ───────────────────────────────
/**
 * Reset (delete) learned Q-table + policy weights for a specific agent.
 * Requires the `x-api-key` header matching `API_SECRET_KEY`.
 * Pass `?riskProfile=AGGRESSIVE` to clear only one profile; omit to clear all three.
 *
 * Example:
 *   curl -X DELETE "http://localhost:3000/api/marl/agents/bull/learning?riskProfile=AGGRESSIVE" \
 *     -H "x-api-key: your-secret"
 */
router.delete('/api/marl/agents/:agentId/learning', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== appConfigService.get('API_SECRET_KEY')) {
    return res.status(401).json({ error: 'Unauthorized — x-api-key header required' });
  }

  const { agentId } = req.params;
  const { riskProfile } = req.query;

  if (riskProfile !== undefined && !isValidRiskProfile(riskProfile)) {
    return res.status(400).json({
      error: `riskProfile must be one of: ${VALID_RISK_PROFILES.join(', ')}`,
    });
  }

  const cleared = engine.clearAgentLearningState(
    agentId,
    typeof riskProfile === 'string' ? riskProfile : undefined
  );

  logger.info('agent learning state reset', { agentId, riskProfile: riskProfile ?? 'all', cleared });

  return res.json({
    agentId,
    riskProfile: riskProfile ?? 'all profiles',
    cleared,
    message: cleared > 0
      ? `Cleared learning state for ${cleared} profile(s). Agent will start fresh next competition.`
      : 'No persisted learning state found for this agent.',
  });
});

// ─── GET /api/marl/coin-universe ──────────────────────────────────────────────
/**
 * Preview the scored coin universe and per-agent selections for AUTO mode.
 * Useful for displaying which coins agents would pick before starting a competition.
 *
 * Query params:
 *   agents     - JSON array of { id, riskProfile } objects (required)
 *   universeSize  - number of top coins to score (default 50, max 200)
 *   coinsPerAgent - coins each agent picks (default 3, max 10)
 *
 * Example:
 *   curl "http://localhost:3000/api/marl/coin-universe?agents=[{\"id\":\"bull\",\"riskProfile\":\"AGGRESSIVE\"}]&universeSize=50&coinsPerAgent=3"
 */
router.get('/api/marl/coin-universe', competitionReadRateLimit, async (req, res) => {
  try {
    const agentsRaw = req.query.agents;
    if (typeof agentsRaw !== 'string') {
      return res.status(400).json({ error: '"agents" query param (JSON array) is required' });
    }

    let agentSpecs: CompetitionAgentSpec[];
    try {
      const parsed = JSON.parse(agentsRaw) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
      agentSpecs = (parsed as Array<{ id?: unknown; riskProfile?: unknown }>)
        .filter(a => typeof a.id === 'string' && isValidRiskProfile(a.riskProfile))
        .map(a => ({
          id: sanitizeAgentId(a.id as string),
          riskProfile: a.riskProfile as CompetitionAgentSpec['riskProfile'],
        }));
      if (agentSpecs.length === 0) throw new Error();
    } catch {
      return res.status(400).json({
        error: '"agents" must be a valid JSON array of { id, riskProfile } objects',
      });
    }

    const universeSize = typeof req.query.universeSize === 'string'
      ? Math.min(Math.max(parseInt(req.query.universeSize, 10) || 50, 10), 200)
      : 50;

    const coinsPerAgent = typeof req.query.coinsPerAgent === 'string'
      ? Math.min(Math.max(parseInt(req.query.coinsPerAgent, 10) || 3, 1), 10)
      : 3;

    const result = await engine.getCoinUniverse(agentSpecs, universeSize, coinsPerAgent);

    return res.json({
      universeSize: result.universe.length,
      coinsPerAgent,
      resolvedSymbols: result.resolvedSymbols,
      agentSelections: result.agentSelections,
      topCoins: result.universe.slice(0, 20),  // return top 20 scored coins for display
    });
  } catch (err) {
    logger.error('coin-universe error', { error: String(err) });
    return res.status(500).json({ error: 'Failed to compute coin universe' });
  }
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
      'POST   /api/marl/competition/start': 'Start a new tournament',
      'GET    /api/marl/competition/:id/status': 'Poll running competition',
      'GET    /api/marl/competition/:id/stream': 'SSE real-time progress stream (text/event-stream)',
      'GET    /api/marl/competition/:id/results': 'Fetch completed results',
      'POST   /api/marl/agents/compare': 'Head-to-head multi-round comparison',
      'GET    /api/marl/competitions': 'List all competitions',
      'GET    /api/marl/agents/learning': 'List all persisted agent learning states',
      'DELETE /api/marl/agents/:agentId/learning': 'Reset agent learning (requires x-api-key). Query: ?riskProfile=',
      'GET    /api/marl/coin-universe': 'Preview AUTO coin selection — scored universe + per-agent picks. Query: agents (JSON), universeSize, coinsPerAgent',
      'GET    /api/marl/info': 'This documentation',
    },
    coinSelection: {
      MANUAL: 'Default. Caller supplies symbols[] explicitly.',
      AUTO: 'Agents autonomously score and select coins from the live CoinGecko universe before the competition starts.',
      params: {
        symbolSelectionMode: '"MANUAL" | "AUTO"',
        autoUniverseSize: 'Number of top coins to consider (default 50, max 200)',
        autoCoinsPerAgent: 'Coins each agent picks from the universe (default 3, max 10)',
      },
      scoring: {
        CONSERVATIVE: 'Weights: sentiment×confidence 40%, market rank 30%, momentum 15%, volume 10%, penalises volatility 5%',
        AGGRESSIVE:   'Weights: sentiment×confidence 40%, momentum 30%, volatility bonus 15%, market rank 10%, volume 5%',
        SCALPING:     'Weights: volatility 40%, absolute momentum 25%, volume 20%, |sentiment|×confidence 15%',
      },
    },
    learningPersistence: {
      storage: 'SQLite agent_learning_states table — Q-table + policy weights + epsilon survive restarts',
      scope: 'Keyed by "{agentId}::{riskProfile}" — agents accumulate knowledge across separate competitions',
      reset: 'DELETE /api/marl/agents/:agentId/learning to clear one or all risk-profile snapshots',
    },
  });
});

// ─── POST /api/marl/agents/:agentId/pretrain ─────────────────────────────────
/**
 * Pre-train an agent on synthetic market data.
 *
 * Body (all optional):
 *   { episodes?: number, stepsPerEpisode?: number, riskProfile?: string, regimes?: string[] }
 *
 * Example:
 *   curl -X POST http://localhost:3000/api/marl/agents/bull/pretrain \
 *     -H "Content-Type: application/json" \
 *     -d '{"episodes":50,"riskProfile":"AGGRESSIVE"}'
 */
router.post('/api/marl/agents/:agentId/pretrain', competitionWriteRateLimit, async (req, res) => {
  const { agentId } = req.params;
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });

  const body = req.body as {
    episodes?:        unknown;
    stepsPerEpisode?: unknown;
    riskProfile?:     unknown;
    regimes?:         unknown;
  };

  const VALID_PROFILES: RiskProfile[] = ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'];
  const rawProfile = typeof body.riskProfile === 'string'
    ? body.riskProfile.toUpperCase()
    : 'AGGRESSIVE';

  if (!VALID_PROFILES.includes(rawProfile as RiskProfile)) {
    return res.status(400).json({
      error: `riskProfile must be one of: ${VALID_PROFILES.join(', ')}`,
    });
  }
  const riskProfile = rawProfile as RiskProfile;

  const episodes = typeof body.episodes === 'number' && body.episodes > 0
    ? Math.min(Math.floor(body.episodes), 500)
    : 100;

  const stepsPerEpisode = typeof body.stepsPerEpisode === 'number' && body.stepsPerEpisode > 0
    ? Math.min(Math.floor(body.stepsPerEpisode), 2000)
    : 1000;

  const VALID_REGIMES: MarketRegime[] = [
    'BULL_TREND', 'BEAR_TREND', 'SIDEWAYS', 'VOLATILE_CRASH', 'VOLATILE_PUMP',
  ];
  let regimes: MarketRegime[] | undefined;
  if (Array.isArray(body.regimes) && body.regimes.length > 0) {
    const filtered = (body.regimes as unknown[])
      .filter((r): r is MarketRegime => typeof r === 'string' && VALID_REGIMES.includes(r as MarketRegime));
    if (filtered.length > 0) regimes = filtered;
  }

  logger.info('marl pre-train request', { agentId, riskProfile, episodes, stepsPerEpisode });

  try {
    const result = await preTrainer.pretrain(agentId, riskProfile, engine, {
      episodes,
      stepsPerEpisode,
      regimes,
    });
    return res.json(result);
  } catch (err) {
    logger.error('pre-train failed', { agentId, error: String(err) });
    return res.status(500).json({ error: 'Pre-training failed', detail: String(err) });
  }
});

// ─── POST /api/marl/agents/:agentId/algorithm ────────────────────────────────
/**
 * Query or declare the learning algorithm for an agent.
 *
 * The engine currently supports Q_TABLE (Q-learning with a policy-gradient
 * network) and POLICY_GRADIENT (network-only).  DQN via TensorFlow is not
 * bundled; attempting to set it returns a 501.
 *
 * Body: { algorithm: 'Q_TABLE' | 'POLICY_GRADIENT' | 'DQN' }
 *
 * Example:
 *   curl -X POST http://localhost:3000/api/marl/agents/bull/algorithm \
 *     -H "Content-Type: application/json" \
 *     -d '{"algorithm":"Q_TABLE"}'
 */
router.post('/api/marl/agents/:agentId/algorithm', competitionReadRateLimit, (req, res) => {
  const { agentId } = req.params;
  const body = req.body as { algorithm?: unknown };
  const algo  = typeof body.algorithm === 'string' ? body.algorithm.toUpperCase() : '';

  const supported = ['Q_TABLE', 'POLICY_GRADIENT'];
  if (algo === 'DQN') {
    return res.status(501).json({
      error: 'DQN via TensorFlow is not bundled. Use Q_TABLE or POLICY_GRADIENT.',
      supported,
    });
  }
  if (!supported.includes(algo)) {
    return res.status(400).json({
      error: `algorithm must be one of: ${supported.join(', ')}`,
      supported,
    });
  }

  return res.json({
    agentId,
    algorithm: algo,
    note: 'Agent uses a combined Q-table + policy-gradient network by default. ' +
          'The algorithm selection is informational — all agents in this build use the hybrid.',
    policyNetwork: {
      architecture: 'Feedforward 50→128(ReLU)→64(ReLU)→5(Softmax)',
      updateRule:   'Advantage-weighted gradient-free nudge',
      replayBuffer: 'Up to 1 000 experiences',
    },
  });
});

// ─── GET /api/marl/competition/:competitionId/stream ─────────────────────────
/**
 * Server-Sent Events stream for a competition.
 * Sends progress (0-100), completed, and failed events in real time.
 * Falls back gracefully: if the competition is already done when you connect,
 * it emits one synthetic event and closes the stream.
 *
 * Example (curl):
 *   curl -N http://localhost:3000/api/marl/competition/comp_123/stream
 *
 * Example (browser):
 *   const es = new EventSource('/api/marl/competition/comp_123/stream');
 *   es.addEventListener('progress',  e => console.log(JSON.parse(e.data)));
 *   es.addEventListener('completed', e => console.log(JSON.parse(e.data)));
 *   es.addEventListener('failed',    e => console.log(JSON.parse(e.data)));
 */
router.get('/api/marl/competition/:competitionId/stream', (req: Request, res: Response) => {
  const { competitionId } = req.params;

  // ── SSE headers ──────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  // Disable nginx / express compression for SSE
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Helper: write a typed SSE frame
  const send = (event: CompetitionPubSubEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // ── Fast-path: already finished ──────────────────────────────────────────
  const record = engine.getRecord(competitionId);
  if (record?.status === 'COMPLETED') {
    send({
      type: 'completed',
      competitionId,
      topPerformerId: record.topPerformerId,
    });
    res.end();
    return;
  }
  if (record?.status === 'FAILED') {
    send({ type: 'failed', competitionId, error: 'Competition already failed' });
    res.end();
    return;
  }

  // ── Subscribe to pub/sub ─────────────────────────────────────────────────
  const channel    = competitionChannel(competitionId);
  const unsubscribe = getPubSub().subscribe(channel, (event) => {
    send(event);
    // Auto-close on terminal events so the client knows the stream is done
    if (event.type === 'completed' || event.type === 'failed') {
      cleanup();
      res.end();
    }
  });

  // ── Heartbeat keeps TCP alive through proxies / load-balancers ───────────
  const heartbeatMs = configService.get('sseHeartbeatIntervalMs');
  const heartbeat   = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, heartbeatMs);

  // ── Cleanup on client disconnect ─────────────────────────────────────────
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
});

// ─── GET /api/marl/competition/:competitionId/equity-curves ──────────────────
/**
 * Return time-series equity for all agents in a completed competition.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/competition/comp_123/equity-curves
 */
router.get('/api/marl/competition/:competitionId/equity-curves', competitionReadRateLimit, (req, res) => {
  const { competitionId } = req.params;
  const record = engine.getRecord(competitionId);

  if (!record) return res.status(404).json({ error: 'Competition not found' });

  if (record.status === 'RUNNING') {
    return res.status(202).json({
      competitionId,
      status: 'RUNNING',
      message: 'Equity curves are available after the competition completes.',
      progress: record.progress,
    });
  }

  if (record.status === 'FAILED') {
    return res.status(500).json({ error: 'Competition failed', competitionId });
  }

  const curves = record.result?.equityEvolution ?? [];
  return res.json({
    competitionId,
    status: 'COMPLETED',
    snapshotCount: curves.length,
    equityCurves:  curves.map(snap => ({
      timestamp:    snap.timestamp,
      agentEquities: snap.agentEquities,
    })),
  });
});

// ─── GET /api/marl/competition/:competitionId/trade-log ──────────────────────
/**
 * Return per-agent trade summary for a completed competition.
 * Note: the engine stores aggregate trade stats, not individual orders.
 * For a per-order audit trail use GET /api/marl/broker/orders/:competitionId.
 *
 * Example:
 *   curl http://localhost:3000/api/marl/competition/comp_123/trade-log
 */
router.get('/api/marl/competition/:competitionId/trade-log', competitionReadRateLimit, (req, res) => {
  const { competitionId } = req.params;
  const record = engine.getRecord(competitionId);

  if (!record) return res.status(404).json({ error: 'Competition not found' });

  if (record.status === 'RUNNING') {
    return res.status(202).json({
      competitionId,
      status:  'RUNNING',
      message: 'Trade log is available after the competition completes.',
    });
  }

  if (record.status === 'FAILED') {
    return res.status(500).json({ error: 'Competition failed', competitionId });
  }

  const rankings = record.result?.finalRankings ?? [];
  return res.json({
    competitionId,
    status: 'COMPLETED',
    note: 'Per-agent aggregate trade summary. For per-order details use GET /api/marl/broker/orders/:competitionId.',
    tradeLog: rankings.map(r => ({
      agentId:        r.agentId,
      rank:           r.rank,
      tradesExecuted: r.tradesExecuted,
      winRate:        parseFloat((r.winRate * 100).toFixed(1)),
      totalReturn:    parseFloat((r.totalReturn * 100).toFixed(2)),
      finalCapital:   parseFloat(r.finalCapital.toFixed(2)),
      sharpeRatio:    parseFloat(r.sharpeRatio.toFixed(3)),
      maxDrawdown:    parseFloat((r.maxDrawdown * 100).toFixed(2)),
    })),
  });
});

export default router;
