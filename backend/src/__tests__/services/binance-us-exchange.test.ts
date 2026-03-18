/**
 * BinanceUSExchange unit tests.
 *
 * All HTTP calls are intercepted by mocking the axios instance that the
 * constructor creates, so no real network traffic is produced.
 */

import axios from 'axios';
import { BinanceUSExchange } from '../../services/exchange/binance-us-exchange.js';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

// axios.create() is called in the constructor; we return a shared mock instance.
const mockInstance = {
  request: jest.fn(),
};
mockAxios.create.mockReturnValue(mockInstance as unknown as ReturnType<typeof axios.create>);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACCOUNT_RESPONSE = {
  balances: [
    { asset: 'USDT', free: '9000', locked: '1000' },
    { asset: 'BTC',  free: '0',    locked: '0'    },
  ],
};

const ORDER_RESPONSE = {
  orderId:      12345,
  symbol:       'BTCUSDT',
  side:         'BUY',
  origQty:      '0.01',
  price:        '50000',
  status:       'NEW',
  transactTime: 1_700_000_000_000,
  fills:        [],
};

const ORDER_HISTORY_ITEM = {
  orderId:    12345,
  symbol:     'BTCUSDT',
  side:       'BUY',
  origQty:    '0.01',
  price:      '50000',
  status:     'FILLED',
  updateTime: 1_700_000_000_000,
};

const OPEN_ORDER_ITEM = { ...ORDER_HISTORY_ITEM, status: 'NEW', time: 1_700_000_000_000 };

function makeExchange(useTestnet = false): BinanceUSExchange {
  return new BinanceUSExchange({ apiKey: 'test-key', apiSecret: 'test-secret', useTestnet });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BinanceUSExchange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.create.mockReturnValue(mockInstance as unknown as ReturnType<typeof axios.create>);
  });

  // ── Constructor ───────────────────────────────────────────────────────────────

  it('calls axios.create during construction', () => {
    makeExchange();
    expect(mockAxios.create).toHaveBeenCalled();
  });

  // ── getExchangeName ───────────────────────────────────────────────────────────

  it('getExchangeName() returns "Binance.US Live" when useTestnet=false', async () => {
    expect(await makeExchange(false).getExchangeName()).toBe('Binance.US Live');
  });

  it('getExchangeName() returns "Binance.US Testnet" when useTestnet=true', async () => {
    expect(await makeExchange(true).getExchangeName()).toBe('Binance.US Testnet');
  });

  // ── isConnected ───────────────────────────────────────────────────────────────

  it('isConnected() returns true when /ping succeeds', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: {} });
    expect(await makeExchange().isConnected()).toBe(true);
  });

  it('isConnected() returns false when /ping throws', async () => {
    mockInstance.request.mockRejectedValueOnce(new Error('Network error'));
    expect(await makeExchange().isConnected()).toBe(false);
  });

  // ── getBalance ────────────────────────────────────────────────────────────────

  it('getBalance("USDT") parses free and locked correctly', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: ACCOUNT_RESPONSE });
    const bal = await makeExchange().getBalance('USDT');
    expect(bal.available).toBe(9000);
    expect(bal.held).toBe(1000);
    expect(bal.total).toBe(10_000);
  });

  it('getBalance("BTC") returns zeros when BTC entry is all-zero', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: ACCOUNT_RESPONSE });
    const bal = await makeExchange().getBalance('BTC');
    expect(bal.available).toBe(0);
    expect(bal.held).toBe(0);
    expect(bal.total).toBe(0);
  });

  it('getBalance() returns zeros for a symbol not in the response', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: { balances: [] } });
    const bal = await makeExchange().getBalance('SOL');
    expect(bal.available).toBe(0);
    expect(bal.total).toBe(0);
  });

  // ── getAllBalances ─────────────────────────────────────────────────────────────

  it('getAllBalances() filters out zero-balance entries', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: ACCOUNT_RESPONSE });
    const bals = await makeExchange().getAllBalances();
    // BTC has free=0 and locked=0 — must not appear
    expect(bals.find(b => b.symbol === 'BTC')).toBeUndefined();
    // USDT has total > 0 — must appear
    expect(bals.find(b => b.symbol === 'USDT')).toBeDefined();
    for (const b of bals) {
      expect(b.total).toBeGreaterThan(0);
    }
  });

  // ── getCurrentPrice ───────────────────────────────────────────────────────────

  it('getCurrentPrice("BTC") returns a parsed float from the ticker', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: { symbol: 'BTCUSDT', price: '50000.50' } });
    const price = await makeExchange().getCurrentPrice('BTC');
    expect(price).toBe(50_000.5);
  });

  // ── placeOrder ────────────────────────────────────────────────────────────────

  it('placeOrder() returns an Order with correct fields', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: ORDER_RESPONSE });
    const order = await makeExchange().placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    expect(order.id).toBeDefined();
    expect(order.symbol).toBe('BTC');
    expect(order.type).toBe('BUY');
    expect(order.quantity).toBe(0.01);
    expect(order.price).toBe(50_000);
    expect(order.status).toBeDefined();
    expect(order.timestamp).toBeInstanceOf(Date);
  });

  it('placeOrder() tracks the orderId so cancelOrder can resolve the symbol', async () => {
    mockInstance.request
      .mockResolvedValueOnce({ data: ORDER_RESPONSE })
      .mockResolvedValueOnce({ data: { ...ORDER_RESPONSE, status: 'CANCELED' } });

    const exchange = makeExchange();
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await expect(exchange.cancelOrder(order.id)).resolves.not.toThrow();
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────────

  it('cancelOrder() makes DELETE /api/v3/order with correct symbol and orderId', async () => {
    mockInstance.request
      .mockResolvedValueOnce({ data: ORDER_RESPONSE })                              // placeOrder
      .mockResolvedValueOnce({ data: { ...ORDER_RESPONSE, status: 'CANCELED' } }); // cancelOrder

    const exchange = makeExchange();
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await exchange.cancelOrder(order.id);

    const deleteCall = mockInstance.request.mock.calls.find(
      ([cfg]: [{ method: string; url: string }]) => cfg.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
    const cfg = deleteCall![0] as { params: { symbol: string; orderId: string } };
    expect(cfg.params.symbol).toBe('BTCUSDT');
    expect(String(cfg.params.orderId)).toBe(String(order.id));
  });

  it('cancelOrder() throws when the orderId was never tracked', async () => {
    await expect(makeExchange().cancelOrder('unknown-id')).rejects.toThrow(/symbol/i);
  });

  // ── getOrderStatus ────────────────────────────────────────────────────────────

  it('getOrderStatus() makes GET /api/v3/order with correct symbol and orderId', async () => {
    mockInstance.request
      .mockResolvedValueOnce({ data: ORDER_RESPONSE })        // placeOrder
      .mockResolvedValueOnce({ data: ORDER_HISTORY_ITEM });   // getOrderStatus

    const exchange = makeExchange();
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await exchange.getOrderStatus(order.id);

    const getCall = mockInstance.request.mock.calls.find(
      ([cfg]: [{ method: string; url: string }]) => cfg.method === 'GET' && cfg.url?.includes('/api/v3/order'),
    );
    expect(getCall).toBeDefined();
    const cfg = getCall![0] as { params: { symbol: string; orderId: string } };
    expect(cfg.params.symbol).toBe('BTCUSDT');
    expect(String(cfg.params.orderId)).toBe(String(order.id));
  });

  it('getOrderStatus() throws when the orderId was never tracked', async () => {
    await expect(makeExchange().getOrderStatus('unknown-id')).rejects.toThrow(/symbol/i);
  });

  // ── getOpenOrders ─────────────────────────────────────────────────────────────

  it('getOpenOrders() calls /api/v3/openOrders without symbol when no arg given', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: [OPEN_ORDER_ITEM] });
    await makeExchange().getOpenOrders();
    const call = mockInstance.request.mock.calls[0]![0] as { params?: { symbol?: string } };
    expect(call.params?.symbol).toBeUndefined();
  });

  it('getOpenOrders("BTC") includes symbol=BTCUSDT in the request', async () => {
    mockInstance.request.mockResolvedValueOnce({ data: [OPEN_ORDER_ITEM] });
    await makeExchange().getOpenOrders('BTC');
    const call = mockInstance.request.mock.calls[0]![0] as { params: { symbol: string } };
    expect(call.params.symbol).toBe('BTCUSDT');
  });

  // ── getOrderHistory ───────────────────────────────────────────────────────────

  it('getOrderHistory() fans out one /api/v3/allOrders call per tracked symbol', async () => {
    const exchange = makeExchange();

    // Track BTC and ETH via placeOrder
    mockInstance.request
      .mockResolvedValueOnce({ data: ORDER_RESPONSE })
      .mockResolvedValueOnce({ data: { ...ORDER_RESPONSE, symbol: 'ETHUSDT', orderId: 67890 } })
      .mockResolvedValueOnce({ data: [ORDER_HISTORY_ITEM] })   // allOrders for BTC
      .mockResolvedValueOnce({ data: [ORDER_HISTORY_ITEM] });  // allOrders for ETH

    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await exchange.placeOrder({ symbol: 'ETH', side: 'BUY', size: 0.1,  price: 3_000  });
    await exchange.getOrderHistory();

    const allOrdersCalls = mockInstance.request.mock.calls.filter(
      ([cfg]: [{ url?: string }]) => typeof cfg.url === 'string' && cfg.url.includes('/api/v3/allOrders'),
    );
    expect(allOrdersCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('getOrderHistory() returns an empty array when no orders have been placed', async () => {
    const history = await makeExchange().getOrderHistory();
    expect(history).toEqual([]);
  });
});
