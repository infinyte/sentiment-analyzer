import request from 'supertest';
import express from 'express';

jest.mock('../../services/exchange/exchange-factory.js', () => ({
  getTradingConfig: jest.fn().mockReturnValue({
    mode: 'sandbox',
    provider: 'alpaca',
    initialCapital: 10_000,
    maxLossPercentage: 5,
    maxPositionSizePercentage: 15,
    maxOpenPositions: 3,
    requireManualApproval: false,
  }),
  ExchangeFactory: {
    create: jest.fn(() => {
      throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET must be set for alpaca mode.');
    }),
  },
}));

describe('trading router resilience', () => {
  it('returns 503 instead of crashing when provider credentials are missing', async () => {
    const { createTradingRouter } = await import('../../routes/trading.js');

    const app = express();
    app.use(express.json());
    app.use('/api/trading', createTradingRouter());

    const res = await request(app).get('/api/trading/exchange-status');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Trading service unavailable/i);
    expect(res.body.details).toMatch(/ALPACA_API_KEY/i);
    expect(typeof res.body.provider).toBe('string');
  });
});
