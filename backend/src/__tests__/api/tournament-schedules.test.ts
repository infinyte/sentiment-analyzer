import express from 'express';
import request from 'supertest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockScheduler = {
  createSchedule: jest.fn(),
  listSchedules: jest.fn(),
  getSchedule: jest.fn(),
  updateSchedule: jest.fn(),
  deleteSchedule: jest.fn(),
  runNow: jest.fn(),
};

jest.mock('../../services/tournament-scheduler.js', () => ({
  tournamentScheduler: mockScheduler,
}));

jest.mock('../../logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// node-cron validate must be deterministic in tests
jest.mock('node-cron', () => ({
  validate: jest.fn((expr: string) => /^(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)\s+(\*|[0-9,-/]+)$/.test(expr)),
  schedule: jest.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CONFIG = {
  mode: 'SINGLE',
  agents: [
    { id: 'alpha', riskProfile: 'AGGRESSIVE' },
    { id: 'beta',  riskProfile: 'CONSERVATIVE' },
  ],
  symbols: ['BTC', 'ETH'],
};

const CRON_SCHEDULE = {
  id: 'sched-1',
  name: 'Daily MARL',
  cronExpression: '0 9 * * 1',
  runAt: null,
  config: VALID_CONFIG,
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
};

const ONESHOT_SCHEDULE = {
  ...CRON_SCHEDULE,
  id: 'sched-2',
  name: 'One-off run',
  cronExpression: null,
  runAt: new Date(Date.now() + 60_000).toISOString(),
};

// ── App factory ───────────────────────────────────────────────────────────────

async function buildApp() {
  const mod = await import('../../routes/tournament-schedules.js');
  const router = mod.default;
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tournament-schedules routes', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── POST /api/tournaments/schedules ────────────────────────────────────────

  describe('POST /api/tournaments/schedules', () => {
    it('creates a recurring schedule successfully', async () => {
      mockScheduler.createSchedule.mockReturnValue(CRON_SCHEDULE);
      const app = await buildApp();

      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Daily MARL', cronExpression: '0 9 * * 1', config: VALID_CONFIG });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('sched-1');
      expect(mockScheduler.createSchedule).toHaveBeenCalledTimes(1);
    });

    it('creates a one-shot schedule successfully', async () => {
      mockScheduler.createSchedule.mockReturnValue(ONESHOT_SCHEDULE);
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const app = await buildApp();

      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'One-off run', runAt: futureDate, config: VALID_CONFIG });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    // ── Validation errors ────────────────────────────────────────────────────

    it('returns 400 when name is missing', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ cronExpression: '0 9 * * 1', config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 400 when name exceeds 100 chars', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'x'.repeat(101), cronExpression: '0 9 * * 1', config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/100/);
    });

    it('returns 400 when neither cronExpression nor runAt is provided', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Missing timing', config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cronExpression.*runAt|runAt.*cronExpression/i);
    });

    it('returns 400 when both cronExpression and runAt are provided', async () => {
      const futureDate = new Date(Date.now() + 60_000).toISOString();
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Both timing', cronExpression: '0 9 * * 1', runAt: futureDate, config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mutually exclusive/i);
    });

    it('returns 400 for invalid cron expression', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Bad cron', cronExpression: 'not-a-cron', config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cron/i);
    });

    it('returns 400 for runAt in the past', async () => {
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Past schedule', runAt: pastDate, config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/future/i);
    });

    it('returns 400 for invalid ISO runAt string', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({ name: 'Bad date', runAt: 'not-a-date', config: VALID_CONFIG });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/ISO/i);
    });

    it('returns 400 when config.mode is invalid', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({
          name: 'Bad mode',
          cronExpression: '0 9 * * 1',
          config: { ...VALID_CONFIG, mode: 'INVALID' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mode/i);
    });

    it('returns 400 when config.agents has fewer than 2 entries', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({
          name: 'Too few agents',
          cronExpression: '0 9 * * 1',
          config: { ...VALID_CONFIG, agents: [{ id: 'solo', riskProfile: 'AGGRESSIVE' }] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/agents/i);
    });

    it('returns 400 when an agent has an invalid riskProfile', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({
          name: 'Bad profile',
          cronExpression: '0 9 * * 1',
          config: { ...VALID_CONFIG, agents: [{ id: 'a', riskProfile: 'YOLO' }, { id: 'b', riskProfile: 'CONSERVATIVE' }] },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/riskProfile/i);
    });

    it('returns 400 when config.symbols is missing and symbolSelectionMode is not AUTO', async () => {
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({
          name: 'No symbols',
          cronExpression: '0 9 * * 1',
          config: { mode: 'SINGLE', agents: VALID_CONFIG.agents },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/symbols/i);
    });

    it('accepts config with symbolSelectionMode AUTO (no symbols required)', async () => {
      mockScheduler.createSchedule.mockReturnValue(CRON_SCHEDULE);
      const app = await buildApp();
      const res = await request(app)
        .post('/api/tournaments/schedules')
        .send({
          name: 'Auto symbols',
          cronExpression: '0 9 * * 1',
          config: { mode: 'SINGLE', agents: VALID_CONFIG.agents, symbolSelectionMode: 'AUTO' },
        });

      expect(res.status).toBe(201);
    });
  });

  // ── GET /api/tournaments/schedules ─────────────────────────────────────────

  describe('GET /api/tournaments/schedules', () => {
    it('returns all schedules', async () => {
      mockScheduler.listSchedules.mockReturnValue([CRON_SCHEDULE, ONESHOT_SCHEDULE]);
      const app = await buildApp();

      const res = await request(app).get('/api/tournaments/schedules');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('returns empty array when no schedules exist', async () => {
      mockScheduler.listSchedules.mockReturnValue([]);
      const app = await buildApp();

      const res = await request(app).get('/api/tournaments/schedules');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  // ── GET /api/tournaments/schedules/:id ─────────────────────────────────────

  describe('GET /api/tournaments/schedules/:id', () => {
    it('returns a schedule when found', async () => {
      mockScheduler.getSchedule.mockReturnValue(CRON_SCHEDULE);
      const app = await buildApp();

      const res = await request(app).get('/api/tournaments/schedules/sched-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('sched-1');
    });

    it('returns 404 when schedule not found', async () => {
      mockScheduler.getSchedule.mockReturnValue(null);
      const app = await buildApp();

      const res = await request(app).get('/api/tournaments/schedules/missing');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ── PUT /api/tournaments/schedules/:id ─────────────────────────────────────

  describe('PUT /api/tournaments/schedules/:id', () => {
    it('updates a schedule successfully', async () => {
      const updated = { ...CRON_SCHEDULE, name: 'Updated Name' };
      mockScheduler.updateSchedule.mockReturnValue(updated);
      const app = await buildApp();

      const res = await request(app)
        .put('/api/tournaments/schedules/sched-1')
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('returns 404 when schedule not found', async () => {
      mockScheduler.updateSchedule.mockReturnValue(null);
      const app = await buildApp();

      const res = await request(app)
        .put('/api/tournaments/schedules/missing')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid update body (bad cron)', async () => {
      const app = await buildApp();
      const res = await request(app)
        .put('/api/tournaments/schedules/sched-1')
        .send({ cronExpression: 'bad-expr' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cron/i);
    });

    it('returns 400 when updating enabled to a non-boolean', async () => {
      const app = await buildApp();
      const res = await request(app)
        .put('/api/tournaments/schedules/sched-1')
        .send({ enabled: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/enabled/i);
    });
  });

  // ── DELETE /api/tournaments/schedules/:id ──────────────────────────────────

  describe('DELETE /api/tournaments/schedules/:id', () => {
    it('deletes a schedule successfully', async () => {
      mockScheduler.deleteSchedule.mockReturnValue(true);
      const app = await buildApp();

      const res = await request(app).delete('/api/tournaments/schedules/sched-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 when schedule not found', async () => {
      mockScheduler.deleteSchedule.mockReturnValue(false);
      const app = await buildApp();

      const res = await request(app).delete('/api/tournaments/schedules/missing');

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/tournaments/schedules/:id/run-now ────────────────────────────

  describe('POST /api/tournaments/schedules/:id/run-now', () => {
    it('triggers a tournament and returns 202 with competitionId', async () => {
      mockScheduler.runNow.mockResolvedValue({ competitionId: 'comp_sched_123' });
      const app = await buildApp();

      const res = await request(app).post('/api/tournaments/schedules/sched-1/run-now');

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.competitionId).toBe('comp_sched_123');
    });

    it('returns 404 when schedule not found', async () => {
      mockScheduler.runNow.mockRejectedValue(new Error('Schedule missing not found'));
      const app = await buildApp();

      const res = await request(app).post('/api/tournaments/schedules/missing/run-now');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 500 on unexpected execution error', async () => {
      mockScheduler.runNow.mockRejectedValue(new Error('Engine crashed'));
      const app = await buildApp();

      const res = await request(app).post('/api/tournaments/schedules/sched-1/run-now');

      expect(res.status).toBe(500);
    });
  });
});
