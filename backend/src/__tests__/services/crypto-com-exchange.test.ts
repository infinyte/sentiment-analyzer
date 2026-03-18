/**
 * CryptoComExchange unit tests.
 * CryptoComClient is manually mocked so no network traffic is produced.
 */

import { CryptoComExchange } from '../../services/exchange/crypto-com-exchange.js';
import type { CryptoComClient } from '../../services/exchange/crypto-com-client.js';

// ── Mock CryptoComClient ───────────────────────────────────────────────────────

function makeMockClient(): jest.Mocked<CryptoComClient> {
  return {
    ping:            jest.fn(),
    getTicker:       jest.fn(),
    getInstruments:  jest.fn(),
    getBalance:      jest.fn(),
    getAllBalances:   jest.fn(),
    createOrder:     jest.fn(),
    cancelOrder:     jest.fn(),
    getOpenOrders:   jest.fn(),
    getOrderStatus:  jest.fn(),
    getOrderHistory: jest.fn(),
  } as unknown as jest.Mocked<CryptoComClient>;
}

const BTC_ORDER = {
  order_id:        'ord1',
  pair:            'BTC_USDT',
  side:            'BUY'  as const,
  type:            'LIMIT' as const,
  price:           50_000,
  quantity:        0.01,
  status:          'PENDING' as const,
  filled_quantity: 0,
  filled_price:    0,
  average_price:   0,
  fee:             0,
  fee_currency:    'USDT',
  create_time:     1_700_000_000_000,
  update_time:     1_700_000_000_000,
};

describe('CryptoComExchange', () => {
  let client: jest.Mocked<CryptoComClient>;
  let exchange: CryptoComExchange;

  beforeEach(() => {
    client   = makeMockClient();
    exchange = new CryptoComExchange(client, { defaultPair: 'BTC_USDT' });
    jest.clearAllMocks();
    client   = makeMockClient();
    exchange = new CryptoComExchange(client, { defaultPair: 'BTC_USDT' });
  });

  // ── Identity ───────────────────────────────────────────────────────────────

  it('getExchangeName() returns "Crypto.com Exchange"', async () => {
    expect(await exchange.getExchangeName()).toBe('Crypto.com Exchange');
  });

  it('isConnected() delegates to client.ping()', async () => {
    client.ping.mockResolvedValueOnce(true);
    expect(await exchange.isConnected()).toBe(true);
  });

  // ── Balances ───────────────────────────────────────────────────────────────

  it('getBalance("USDT") maps reserved to held', async () => {
    client.getBalance.mockResolvedValueOnce({ available: 9500, reserved: 500, total: 10_000 });
    const b = await exchange.getBalance('USDT');
    expect(b.available).toBe(9500);
    expect(b.held).toBe(500);
    expect(b.total).toBe(10_000);
    expect(b.symbol).toBe('USDT');
  });

  it('getAllBalances() filters out zero-balance entries', async () => {
    client.getAllBalances.mockResolvedValueOnce([
      { currency: 'USDT', available: 9500, reserved: 500,  total: 10_000 },
      { currency: 'BTC',  available: 0,    reserved: 0,    total: 0 },
    ]);
    const bals = await exchange.getAllBalances();
    expect(bals.find(b => b.symbol === 'BTC')).toBeUndefined();
    expect(bals.find(b => b.symbol === 'USDT')).toBeDefined();
  });

  // ── Price ──────────────────────────────────────────────────────────────────

  it('getCurrentPrice("BTC") returns the ticker price', async () => {
    client.getTicker.mockResolvedValueOnce({ price: 50_000, bid: 49_990, ask: 50_010 });
    expect(await exchange.getCurrentPrice('BTC')).toBe(50_000);
    expect(client.getTicker).toHaveBeenCalledWith('BTC_USDT');
  });

  it('getPrices(["BTC","ETH"]) returns a Map with both symbols', async () => {
    client.getTicker
      .mockResolvedValueOnce({ price: 50_000, bid: 49_990, ask: 50_010 })
      .mockResolvedValueOnce({ price:  2_300, bid:  2_290, ask:  2_310 });
    const prices = await exchange.getPrices(['BTC', 'ETH']);
    expect(prices.get('BTC')).toBe(50_000);
    expect(prices.get('ETH')).toBe(2_300);
  });

  // ── placeOrder ─────────────────────────────────────────────────────────────

  it('placeOrder() returns a correctly shaped Order', async () => {
    client.createOrder.mockResolvedValueOnce(BTC_ORDER);
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(order.id).toBe('ord1');
    expect(order.symbol).toBe('BTC');
    expect(order.type).toBe('BUY');
    expect(order.quantity).toBe(0.01);
    expect(order.price).toBe(50_000);
    expect(order.status).toBe('PENDING');
    expect(order.timestamp).toBeInstanceOf(Date);
  });

  it('placeOrder() throws when notional < $1', async () => {
    client.getTicker.mockResolvedValueOnce({ price: 50_000, bid: 49_990, ask: 50_010 });
    await expect(
      exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.000001 })
    ).rejects.toThrow(/minimum is \$1/i);
  });

  it('placeOrder() converts symbol to pair (BTC → BTC_USDT)', async () => {
    client.createOrder.mockResolvedValueOnce(BTC_ORDER);
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(client.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ pair: 'BTC_USDT' })
    );
  });

  // ── cancelOrder ────────────────────────────────────────────────────────────

  it('cancelOrder() returns true for a tracked order', async () => {
    client.createOrder.mockResolvedValueOnce(BTC_ORDER);
    client.cancelOrder.mockResolvedValueOnce(true);
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(await exchange.cancelOrder(order.id)).toBe(true);
  });

  it('cancelOrder() for an untracked order falls back to defaultPair', async () => {
    client.cancelOrder.mockResolvedValueOnce(false);
    expect(await exchange.cancelOrder('unknown-id')).toBe(false);
    expect(client.cancelOrder).toHaveBeenCalledWith('unknown-id', 'BTC_USDT');
  });

  // ── getOrderStatus ─────────────────────────────────────────────────────────

  it('getOrderStatus() throws for an untracked orderId', async () => {
    await expect(exchange.getOrderStatus('no-such-id')).rejects.toThrow(/symbol not found/i);
  });

  it('getOrderStatus() returns the order for a tracked id', async () => {
    client.createOrder.mockResolvedValueOnce(BTC_ORDER);
    client.getOrderStatus.mockResolvedValueOnce({ ...BTC_ORDER, status: 'FILLED' as const });
    const placed = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const status = await exchange.getOrderStatus(placed.id);
    expect(status.status).toBe('FILLED');
  });

  // ── getOpenOrders ──────────────────────────────────────────────────────────

  it('getOpenOrders() returns a mapped Order array', async () => {
    client.getOpenOrders.mockResolvedValueOnce([BTC_ORDER]);
    const open = await exchange.getOpenOrders();
    expect(open.length).toBe(1);
    expect(open[0]!.symbol).toBe('BTC');
  });
});
