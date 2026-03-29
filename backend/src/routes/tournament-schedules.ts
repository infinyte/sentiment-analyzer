/**
 * Tournament Schedule Routes
 *
 * CRUD management and immediate execution of tournament schedules.
 *
 * Routes:
 *   POST   /api/tournaments/schedules           — create a new schedule
 *   GET    /api/tournaments/schedules           — list all schedules
 *   GET    /api/tournaments/schedules/:id       — get single schedule
 *   PUT    /api/tournaments/schedules/:id       — update a schedule
 *   DELETE /api/tournaments/schedules/:id       — delete a schedule
 *   POST   /api/tournaments/schedules/:id/run-now — execute immediately
 *
 * Validation rules:
 *   - name: required string, 1–100 chars
 *   - Exactly one of cronExpression or runAt must be provided (not both, not neither)
 *   - cronExpression: must pass cron.validate()
 *   - runAt: must be a valid ISO date in the future
 *   - config.mode: SINGLE | EVOLUTIONARY | CONTINUOUS
 *   - config.agents: array of ≥2 entries, each { id: string, riskProfile: CONSERVATIVE|AGGRESSIVE|SCALPING }
 *   - config.symbols or config.symbolSelectionMode === 'AUTO' required
 */

import { Router } from 'express';
import cron from 'node-cron';
import { tournamentScheduler } from '../services/tournament-scheduler.js';
import type { CreateScheduleInput, UpdateScheduleInput } from '../services/tournament-scheduler.js';
import type { CompetitionConfig } from '../services/marl-competition-engine.js';
import logger from '../logger.js';

const router = Router();

const VALID_MODES    = ['SINGLE', 'EVOLUTIONARY', 'CONTINUOUS'] as const;
const VALID_PROFILES = ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'] as const;

// ── Validation helpers ────────────────────────────────────────────────────────

function validateConfig(config: unknown): string | null {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return '"config" must be an object';
  }
  const c = config as Record<string, unknown>;

  if (!VALID_MODES.includes(c['mode'] as never)) {
    return `"config.mode" must be one of: ${VALID_MODES.join(', ')}`;
  }

  if (!Array.isArray(c['agents']) || (c['agents'] as unknown[]).length < 2) {
    return '"config.agents" must be an array with at least 2 entries';
  }
  for (const a of c['agents'] as unknown[]) {
    if (typeof a !== 'object' || a === null) return 'each agent must be an object';
    const ag = a as Record<string, unknown>;
    if (typeof ag['id'] !== 'string' || !ag['id'].trim()) return 'each agent must have a non-empty "id"';
    if (!VALID_PROFILES.includes(ag['riskProfile'] as never)) {
      return `each agent "riskProfile" must be one of: ${VALID_PROFILES.join(', ')}`;
    }
  }

  const selMode = c['symbolSelectionMode'];
  const symbols = c['symbols'];
  if (selMode !== 'AUTO') {
    if (!Array.isArray(symbols) || (symbols as unknown[]).length === 0) {
      return '"config.symbols" must be a non-empty array when symbolSelectionMode is not AUTO';
    }
    for (const s of symbols as unknown[]) {
      if (typeof s !== 'string') return 'each symbol must be a string';
    }
  }

  return null;
}

function validateCreateBody(body: unknown): { error: string } | { input: CreateScheduleInput } {
  if (typeof body !== 'object' || body === null) return { error: 'Request body must be a JSON object' };
  const b = body as Record<string, unknown>;

  // name
  if (typeof b['name'] !== 'string' || !b['name'].trim()) return { error: '"name" is required' };
  if (b['name'].length > 100) return { error: '"name" must be 100 characters or fewer' };

  // cronExpression XOR runAt
  const hasCron  = b['cronExpression'] !== undefined && b['cronExpression'] !== null;
  const hasRunAt = b['runAt']          !== undefined && b['runAt']          !== null;
  if (!hasCron && !hasRunAt) return { error: 'Either "cronExpression" or "runAt" is required' };
  if (hasCron && hasRunAt)   return { error: '"cronExpression" and "runAt" are mutually exclusive' };

  if (hasCron) {
    if (typeof b['cronExpression'] !== 'string') return { error: '"cronExpression" must be a string' };
    if (!cron.validate(b['cronExpression'] as string)) {
      return { error: '"cronExpression" is not a valid cron expression' };
    }
  }

  if (hasRunAt) {
    if (typeof b['runAt'] !== 'string') return { error: '"runAt" must be a string' };
    const ts = new Date(b['runAt'] as string);
    if (isNaN(ts.getTime())) return { error: '"runAt" must be a valid ISO 8601 date string' };
    if (ts.getTime() <= Date.now()) return { error: '"runAt" must be a future date' };
  }

  // config
  const configErr = validateConfig(b['config']);
  if (configErr) return { error: configErr };

  return {
    input: {
      name: (b['name'] as string).trim(),
      cronExpression: hasCron ? (b['cronExpression'] as string) : undefined,
      runAt: hasRunAt ? (b['runAt'] as string) : undefined,
      config: b['config'] as CompetitionConfig,
      enabled: b['enabled'] !== false,
    },
  };
}

function validateUpdateBody(body: unknown): { error: string } | { input: UpdateScheduleInput } {
  if (typeof body !== 'object' || body === null) return { error: 'Request body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const input: UpdateScheduleInput = {};

  if (b['name'] !== undefined) {
    if (typeof b['name'] !== 'string' || !b['name'].trim()) return { error: '"name" must be a non-empty string' };
    if (b['name'].length > 100) return { error: '"name" must be 100 characters or fewer' };
    input.name = (b['name'] as string).trim();
  }

  if (b['cronExpression'] !== undefined) {
    if (b['cronExpression'] !== null) {
      if (typeof b['cronExpression'] !== 'string') return { error: '"cronExpression" must be a string or null' };
      if (!cron.validate(b['cronExpression'] as string)) {
        return { error: '"cronExpression" is not a valid cron expression' };
      }
    }
    input.cronExpression = b['cronExpression'] as string | null;
  }

  if (b['runAt'] !== undefined) {
    if (b['runAt'] !== null) {
      if (typeof b['runAt'] !== 'string') return { error: '"runAt" must be a string or null' };
      const ts = new Date(b['runAt'] as string);
      if (isNaN(ts.getTime())) return { error: '"runAt" must be a valid ISO 8601 date string' };
      if (ts.getTime() <= Date.now()) return { error: '"runAt" must be a future date' };
    }
    input.runAt = b['runAt'] as string | null;
  }

  // After patching, must still have exactly one of cron/runAt if both come through
  if (input.cronExpression !== undefined && input.cronExpression !== null &&
      input.runAt          !== undefined && input.runAt          !== null) {
    return { error: '"cronExpression" and "runAt" are mutually exclusive' };
  }

  if (b['config'] !== undefined) {
    const configErr = validateConfig(b['config']);
    if (configErr) return { error: configErr };
    input.config = b['config'] as CompetitionConfig;
  }

  if (b['enabled'] !== undefined) {
    if (typeof b['enabled'] !== 'boolean') return { error: '"enabled" must be a boolean' };
    input.enabled = b['enabled'] as boolean;
  }

  return { input };
}

// ── POST /api/tournaments/schedules ──────────────────────────────────────────

router.post('/api/tournaments/schedules', (req, res) => {
  const validated = validateCreateBody(req.body);
  if ('error' in validated) {
    return res.status(400).json({ success: false, error: validated.error });
  }
  try {
    const schedule = tournamentScheduler.createSchedule(validated.input);
    logger.info('[schedules] created', { id: schedule.id, name: schedule.name });
    return res.status(201).json({ success: true, data: schedule });
  } catch (err) {
    logger.error('[schedules] create failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to create schedule' });
  }
});

// ── GET /api/tournaments/schedules ───────────────────────────────────────────

router.get('/api/tournaments/schedules', (_req, res) => {
  try {
    const schedules = tournamentScheduler.listSchedules();
    return res.json({ success: true, data: schedules, total: schedules.length });
  } catch (err) {
    logger.error('[schedules] list failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to list schedules' });
  }
});

// ── GET /api/tournaments/schedules/:id ───────────────────────────────────────

router.get('/api/tournaments/schedules/:id', (req, res) => {
  const { id } = req.params;
  try {
    const schedule = tournamentScheduler.getSchedule(id);
    if (!schedule) {
      return res.status(404).json({ success: false, error: `Schedule ${id} not found` });
    }
    return res.json({ success: true, data: schedule });
  } catch (err) {
    logger.error('[schedules] get failed', { id, error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to retrieve schedule' });
  }
});

// ── PUT /api/tournaments/schedules/:id ───────────────────────────────────────

router.put('/api/tournaments/schedules/:id', (req, res) => {
  const { id } = req.params;
  const validated = validateUpdateBody(req.body);
  if ('error' in validated) {
    return res.status(400).json({ success: false, error: validated.error });
  }
  try {
    const updated = tournamentScheduler.updateSchedule(id, validated.input);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Schedule ${id} not found` });
    }
    logger.info('[schedules] updated', { id });
    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('[schedules] update failed', { id, error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to update schedule' });
  }
});

// ── DELETE /api/tournaments/schedules/:id ────────────────────────────────────

router.delete('/api/tournaments/schedules/:id', (req, res) => {
  const { id } = req.params;
  try {
    const deleted = tournamentScheduler.deleteSchedule(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Schedule ${id} not found` });
    }
    logger.info('[schedules] deleted', { id });
    return res.json({ success: true, message: `Schedule ${id} deleted` });
  } catch (err) {
    logger.error('[schedules] delete failed', { id, error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to delete schedule' });
  }
});

// ── POST /api/tournaments/schedules/:id/run-now ──────────────────────────────

router.post('/api/tournaments/schedules/:id/run-now', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await tournamentScheduler.runNow(id);
    logger.info('[schedules] run-now triggered', { id, competitionId: result.competitionId });
    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return res.status(404).json({ success: false, error: `Schedule ${id} not found` });
    }
    logger.error('[schedules] run-now failed', { id, error: msg });
    return res.status(500).json({ success: false, error: 'Failed to run schedule' });
  }
});

export default router;
export const tournamentSchedulesRoutes = router;
