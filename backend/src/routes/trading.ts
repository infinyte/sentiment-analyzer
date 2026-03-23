/**
 * Trading Routes
 *
 * Exposes the active exchange (paper / sandbox / live) and the safety-guarded
 * TradingService through a simple REST API.
 *
 * Endpoints (all under /api/trading/):
 *   GET  exchange-status   — connection state, exchange name, current mode
 *   GET  price/:symbol     — latest price from the active exchange
 *   GET  balances          — all non-zero balances
 *   POST order             — place an order through TradingService safety guards
 *   GET  stats             — capital, PnL, trade counts
 */

import { Router } from 'express';
import { ExchangeFactory, getTradingConfig } from '../services/exchange/exchange-factory.js';
import { TradingService } from '../services/exchange/trading-service.js';
import logger from '../logger.js';

export function createTradingRouter(): Router {
  const router = Router();
  let config: ReturnType<typeof getTradingConfig>;
  let exchange: ReturnType<typeof ExchangeFactory.create>;
  let tradingService: TradingService;
  let startupError: string | null = null;

  try {
    config = getTradingConfig();
    exchange = ExchangeFactory.create(config);
    tradingService = new TradingService(exchange, {
      initialCapital:            config.initialCapital,
      maxLossPercentage:         config.maxLossPercentage,
      maxPositionSizePercentage: config.maxPositionSizePercentage,
      maxOpenPositions:          config.maxOpenPositions,
      requireManualApproval:     config.requireManualApproval,
    });
  } catch (err: unknown) {
    startupError = err instanceof Error ? err.message : String(err);
    logger.error('trading router disabled due to configuration error', {
      error: startupError,
      mode: process.env.TRADING_MODE ?? 'paper',
      provider: process.env.TRADING_PROVIDER ?? 'crypto-com',
    });
  }

  if (startupError) {
    router.use((_req, res) => {
      res.status(503).json({
        error: 'Trading service unavailable due to configuration error.',
        details: startupError,
        mode: process.env.TRADING_MODE ?? 'paper',
        provider: process.env.TRADING_PROVIDER ?? 'crypto-com',
      });
    });

    return router;
  }

  // Defensive fallback: initialization guarantees these are set.
  const safeConfig = config!;
  const safeExchange = exchange!;
  const safeTradingService = tradingService!;

  // GET /api/trading/exchange-status
  router.get('/exchange-status', async (_req, res) => {
    try {
      const [connected, name] = await Promise.all([
        safeExchange.isConnected(),
        safeExchange.getExchangeName(),
      ]);
      res.json({ connected, name, mode: safeConfig.mode, provider: safeConfig.provider ?? 'crypto-com' });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/trading/price/:symbol
  router.get('/price/:symbol', async (req, res) => {
    try {
      const price = await safeExchange.getCurrentPrice(req.params.symbol!);
      res.json({ symbol: req.params.symbol, price });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/trading/balances
  router.get('/balances', async (_req, res) => {
    try {
      const balances = await safeExchange.getAllBalances();
      res.json(balances);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/trading/order
  router.post('/order', async (req, res) => {
    const { symbol, side, size, price, orderType } = req.body as {
      symbol: string;
      side: 'BUY' | 'SELL';
      size: number;
      price?: number;
      orderType?: 'MARKET' | 'LIMIT';
    };

    if (!symbol || !side || size === undefined) {
      res.status(400).json({ error: 'symbol, side, and size are required' });
      return;
    }
    if (side !== 'BUY' && side !== 'SELL') {
      res.status(400).json({ error: 'side must be BUY or SELL' });
      return;
    }

    try {
      const result = await safeTradingService.executeOrder({ symbol, side, size, price, orderType });
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/trading/stats
  router.get('/stats', async (_req, res) => {
    try {
      await safeTradingService.updateCapital();
      res.json(safeTradingService.getStats());
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
