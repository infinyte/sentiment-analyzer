import express from 'express';
import request from 'supertest';

const mockAppConfigService = {
  getAll: jest.fn(),
  getCatalog: jest.fn(),
  set: jest.fn(),
  clear: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../services/app-config-service.js', () => ({
  appConfigService: mockAppConfigService,
}));

jest.mock('../../logger.js', () => ({
  __esModule: true,
  default: mockLogger,
}));

describe('admin-config routes', () => {
  const originalPassword = process.env.CONFIG_ADMIN_PASSWORD;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONFIG_ADMIN_PASSWORD = 'admin-pass';

    mockAppConfigService.getCatalog.mockReturnValue([
      { key: 'CLAUDE_API_KEY' },
      { key: 'SENTIMENT_BATCH_SIZE' },
    ]);
    mockAppConfigService.getAll.mockReturnValue([
      {
        key: 'CLAUDE_API_KEY',
        value: '***',
        category: 'AI',
        description: 'Anthropic Claude API key',
        isSecret: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        key: 'SENTIMENT_BATCH_SIZE',
        value: '50',
        category: 'Scheduler',
        description: 'Batch size',
        isSecret: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  afterAll(() => {
    process.env.CONFIG_ADMIN_PASSWORD = originalPassword;
  });

  async function buildApp() {
    const { createAdminConfigRouter } = await import('../../routes/admin-config.js');
    const app = express();
    app.use(express.json());
    app.use('/api/admin/config', createAdminConfigRouter());
    return app;
  }

  it('returns 503 if CONFIG_ADMIN_PASSWORD is missing', async () => {
    delete process.env.CONFIG_ADMIN_PASSWORD;
    const app = await buildApp();

    const res = await request(app).get('/api/admin/config');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not enabled/i);
  });

  it('rejects unauthorized GET requests', async () => {
    const app = await buildApp();

    const res = await request(app).get('/api/admin/config');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('returns config for authorized GET requests', async () => {
    const app = await buildApp();

    const res = await request(app)
      .get('/api/admin/config')
      .set('Authorization', 'Bearer admin-pass');

    expect(res.status).toBe(200);
    expect(res.body.config).toHaveLength(2);
    expect(res.body.config[0].value).toBe('***');
    expect(mockAppConfigService.getAll).toHaveBeenCalledTimes(1);
  });

  it('blocks writes to protected keys', async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/admin/config/CONFIG_ADMIN_PASSWORD')
      .set('Authorization', 'Bearer admin-pass')
      .send({ value: 'new-value' });

    expect(res.status).toBe(403);
    expect(mockAppConfigService.set).not.toHaveBeenCalled();
  });

  it('validates PATCH payload type', async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/admin/config/SENTIMENT_BATCH_SIZE')
      .set('Authorization', 'Bearer admin-pass')
      .send({ value: 100 });

    expect(res.status).toBe(400);
    expect(mockAppConfigService.set).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown keys', async () => {
    mockAppConfigService.getCatalog.mockReturnValue([{ key: 'KNOWN' }]);
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/admin/config/UNKNOWN')
      .set('Authorization', 'Bearer admin-pass')
      .send({ value: 'x' });

    expect(res.status).toBe(404);
    expect(mockAppConfigService.set).not.toHaveBeenCalled();
  });

  it('updates known keys and returns masked row', async () => {
    const app = await buildApp();

    const res = await request(app)
      .patch('/api/admin/config/CLAUDE_API_KEY')
      .set('Authorization', 'Bearer admin-pass')
      .send({ value: 'new-secret' });

    expect(res.status).toBe(200);
    expect(mockAppConfigService.set).toHaveBeenCalledWith('CLAUDE_API_KEY', 'new-secret');
    expect(res.body.config.key).toBe('CLAUDE_API_KEY');
    expect(res.body.config.value).toBe('***');
  });

  it('clears known keys via DELETE', async () => {
    const app = await buildApp();

    const res = await request(app)
      .delete('/api/admin/config/SENTIMENT_BATCH_SIZE')
      .set('Authorization', 'Bearer admin-pass');

    expect(res.status).toBe(200);
    expect(mockAppConfigService.clear).toHaveBeenCalledWith('SENTIMENT_BATCH_SIZE');
    expect(res.body.message).toMatch(/cleared/i);
  });
});
