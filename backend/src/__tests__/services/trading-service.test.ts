/**
 * TradingService unit tests.
 * ExchangeInterface is manually mocked — no real exchange calls.
 */

import { TradingService } from '../../services/exchange/trading-service.js';
import type { ExchangeInterface, Order, Balance } from '../../services/exchange/exchange-interface.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockExchange(): jest.Mocked<ExchangeInterface> {
  return {
    getExchangeName:  jest.fn().mockResolvedValue('Mock'),
    isConnected:      jest.fn().mockResolvedValue(true),
    getBalance:       jest.fn(),
    getAllBalances:    jest.fn(),
    getCurrentPrice:  jest.fn().mockResolvedValue(50_000),
    getPrices:        jest.fn(),
    placeOrder:       jest.fn(),
    cancelOrder:      jest.fn(),
    getOpenOrders:    jest.fn().mockResolvedValue([]),
    getOrderStatus:   jest.fn(),
    getOrderHistory:  jest.fn(),
  } as jest.Mocked<ExchangeInterface>;
}

const BASE_CONFIG = {
  initialCapital:            10_000,
  maxLossPercentage:         10,      // $1 000 max loss
  maxPositionSizePercentage: 20,      // $2 000 max position
  maxOpenPositions:          3,
  requireManualApproval:     false,
};

const MOCK_ORDER: Order = {
  id:        'ord1',
  symbol:    'BTC',
  type:      'BUY',
  quantity:  0.01,
  price:     50_000,
  status:    'FILLED',
  timestamp: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TradingService', () => {
  let exchange: jest.Mocked<ExchangeInterface>;
  let service:  TradingService;

  beforeEach(() => {
    exchange = makeMockExchange();
    service  = new TradingService(exchange, BASE_CONFIG);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('executeOrder() returns success when all guards pass', async () => {
    exchange.placeOrder.mockResolvedValueOnce(MOCK_ORDER);
    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(result.success).toBe(true);
    expect(result.order?.id).toBe('ord1');
    expect(result.reason).toBe('EXECUTED');
  });

  // ── Kill switch ────────────────────────────────────────────────────────────

  it('rejects BUY when cumulative loss exceeds maxLossPercentage', async () => {
    // Simulate a 15 % loss by draining capital via updateCapital
    exchange.getAllBalances.mockResolvedValueOnce([
      { symbol: 'USDT', available: 8_500, held: 0, total: 8_500 } as Balance,
    ]);
    await service.updateCapital(); // sets currentCapital to 8 500 (loss > $1 000)

    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('KILL_SWITCH');
  });

  it('allows SELL even when kill switch is active', async () => {
    exchange.getAllBalances.mockResolvedValueOnce([
      { symbol: 'USDT', available: 8_500, held: 0, total: 8_500 } as Balance,
    ]);
    await service.updateCapital();

    exchange.placeOrder.mockResolvedValueOnce({ ...MOCK_ORDER, type: 'SELL' });
    const result = await service.executeOrder({ symbol: 'BTC', side: 'SELL', size: 0.01, price: 50_000 });
    expect(result.success).toBe(true);
  });

  // ── Max open positions ────────────────────────────────────────────────────

  it('rejects BUY when maxOpenPositions is reached', async () => {
    exchange.getOpenOrders.mockResolvedValueOnce([MOCK_ORDER, MOCK_ORDER, MOCK_ORDER]);
    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('MAX_POSITIONS');
  });

  // ── Position too large ─────────────────────────────────────────────────────

  it('rejects BUY when notional exceeds maxPositionSizePercentage', async () => {
    // 20 % of $10 000 = $2 000; 0.05 BTC × $50 000 = $2 500
    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.05, price: 50_000 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('POSITION_TOO_LARGE');
  });

  // ── Minimum order ─────────────────────────────────────────────────────────

  it('rejects orders with notional < $1', async () => {
    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.000001, price: 50_000 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('ORDER_TOO_SMALL');
  });

  // ── Execution error ───────────────────────────────────────────────────────

  it('returns EXECUTION_ERROR when exchange.placeOrder throws', async () => {
    exchange.placeOrder.mockRejectedValueOnce(new Error('exchange down'));
    const result = await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('EXECUTION_ERROR');
    expect(result.error).toMatch(/exchange down/);
  });

  // ── Capital tracking ──────────────────────────────────────────────────────

  it('updateCapital() reads USDT balance from exchange', async () => {
    exchange.getAllBalances.mockResolvedValueOnce([
      { symbol: 'USDT', available: 11_000, held: 0, total: 11_000 } as Balance,
    ]);
    const capital = await service.updateCapital();
    expect(capital).toBe(11_000);
  });

  it('updateCapital() does not throw when exchange fails', async () => {
    exchange.getAllBalances.mockRejectedValueOnce(new Error('network'));
    const capital = await service.updateCapital();
    expect(capital).toBe(BASE_CONFIG.initialCapital); // unchanged
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  it('getStats() returns accurate numbers after a successful trade', async () => {
    exchange.placeOrder.mockResolvedValueOnce(MOCK_ORDER);
    await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const stats = service.getStats();
    expect(stats.initialCapital).toBe(10_000);
    expect(stats.totalTrades).toBe(1);
    expect(stats.successfulTrades).toBe(1);
    expect(stats.maxLoss).toBe(1_000);
  });

  it('getStats() counts rejected orders in totalTrades but not successfulTrades', async () => {
    // Fill open positions to trigger MAX_POSITIONS
    exchange.getOpenOrders.mockResolvedValue([MOCK_ORDER, MOCK_ORDER, MOCK_ORDER]);
    await service.executeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const stats = service.getStats();
    expect(stats.totalTrades).toBe(1);
    expect(stats.successfulTrades).toBe(0);
  });
});
