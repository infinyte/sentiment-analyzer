/**
 * CryptoComClient unit tests.
 * All HTTP is intercepted via axios mock — no real network traffic.
 */

import axios from 'axios';
import { CryptoComClient } from '../../services/exchange/crypto-com-client.js';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

const mockInstance = { get: jest.fn(), post: jest.fn() };
mockAxios.create.mockReturnValue(mockInstance as unknown as ReturnType<typeof axios.create>);

// Also mock top-level axios.get used by ping() / getTicker()
mockAxios.get = jest.fn();

function makeClient(): CryptoComClient {
  return new CryptoComClient({
    apiKey:    'test-key',
    apiSecret: 'test-secret',
    baseUrl:   'https://uat.crypto.com/exchange/v1',
    sandbox:   true,
  });
}

const TICKER_RESPONSE = {
  data: {
    code: 'SUCCESS',
    result: {
      data: [{ i: 'BTC_USDT', a: '51000', b: '50990', k: '50995' }],
    },
  },
};

const ACCOUNT_RESPONSE = {
  data: {
    code: 'SUCCESS',
    result: {
      account_list: [{
        balance: [
          { currency: 'USDT', available: '9500', reserved: '500', total: '10000' },
          { currency: 'BTC',  available: '0',    reserved: '0',   total: '0' },
        ],
      }],
    },
  },
};

const ORDER_RESPONSE = {
  data: {
    code: 'SUCCESS',
    result: {
      order_id:        'ord123',
      instrument_name: 'BTC_USDT',
      side:            'BUY',
      type:            'LIMIT',
      price:           '50000',
      quantity:        '0.01',
      status:          'PENDING',
      filled_quantity: '0',
      filled_price:    '0',
      average_price:   '0',
      fee:             '0',
      fee_currency:    'USDT',
      create_time:     1_700_000_000_000,
      update_time:     1_700_000_000_000,
    },
  },
};

describe('CryptoComClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.create.mockReturnValue(mockInstance as unknown as ReturnType<typeof axios.create>);
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  it('calls axios.create during construction', () => {
    makeClient();
    expect(mockAxios.create).toHaveBeenCalled();
  });

  // ── ping ──────────────────────────────────────────────────────────────────

  it('ping() returns true when the public endpoint responds', async () => {
    mockInstance.get.mockResolvedValueOnce({ data: { code: 'SUCCESS' } });
    expect(await makeClient().ping()).toBe(true);
  });

  it('ping() returns true even when the call throws (treats any response as alive)', async () => {
    mockInstance.get.mockRejectedValueOnce(new Error('timeout'));
    expect(await makeClient().ping()).toBe(true);
  });

  // ── getTicker ─────────────────────────────────────────────────────────────

  it('getTicker() returns price, bid, ask', async () => {
    mockInstance.get.mockResolvedValueOnce(TICKER_RESPONSE);
    const t = await makeClient().getTicker('BTC_USDT');
    expect(t.price).toBe(50_995);
    expect(t.bid).toBe(50_990);
    expect(t.ask).toBe(51_000);
  });

  // ── getBalance ────────────────────────────────────────────────────────────

  it('getBalance("USDT") returns correct available/reserved/total', async () => {
    mockInstance.post.mockResolvedValueOnce(ACCOUNT_RESPONSE);
    const b = await makeClient().getBalance('USDT');
    expect(b.available).toBe(9500);
    expect(b.reserved).toBe(500);
    expect(b.total).toBe(10_000);
  });

  it('getBalance("BTC") returns zeros for a zero-balance asset', async () => {
    mockInstance.post.mockResolvedValueOnce(ACCOUNT_RESPONSE);
    const b = await makeClient().getBalance('BTC');
    expect(b.available).toBe(0);
    expect(b.total).toBe(0);
  });

  it('getBalance() returns zeros for an unknown asset', async () => {
    mockInstance.post.mockResolvedValueOnce(ACCOUNT_RESPONSE);
    const b = await makeClient().getBalance('SOL');
    expect(b.total).toBe(0);
  });

  // ── getAllBalances ─────────────────────────────────────────────────────────

  it('getAllBalances() returns all entries', async () => {
    mockInstance.post.mockResolvedValueOnce(ACCOUNT_RESPONSE);
    const all = await makeClient().getAllBalances();
    expect(all.length).toBe(2);
    const usdt = all.find(b => b.currency === 'USDT');
    expect(usdt?.total).toBe(10_000);
  });

  // ── createOrder ───────────────────────────────────────────────────────────

  it('createOrder() returns a parsed CryptoComOrder', async () => {
    mockInstance.post.mockResolvedValueOnce(ORDER_RESPONSE);
    const o = await makeClient().createOrder({
      pair: 'BTC_USDT', side: 'BUY', type: 'LIMIT', quantity: 0.01, price: 50_000,
    });
    expect(o.order_id).toBe('ord123');
    expect(o.side).toBe('BUY');
    expect(o.quantity).toBe(0.01);
    expect(o.price).toBe(50_000);
    expect(o.status).toBe('PENDING');
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────

  it('cancelOrder() returns true on success', async () => {
    mockInstance.post.mockResolvedValueOnce({ data: { code: 'SUCCESS' } });
    expect(await makeClient().cancelOrder('ord123', 'BTC_USDT')).toBe(true);
  });

  it('cancelOrder() returns false on error', async () => {
    mockInstance.post.mockRejectedValueOnce(new Error('not found'));
    expect(await makeClient().cancelOrder('unknown', 'BTC_USDT')).toBe(false);
  });

  // ── getOpenOrders ─────────────────────────────────────────────────────────

  it('getOpenOrders() returns an array of orders', async () => {
    mockInstance.post.mockResolvedValueOnce({
      data: {
        code: 'SUCCESS',
        result: { order_list: [ORDER_RESPONSE.data.result] },
      },
    });
    const orders = await makeClient().getOpenOrders('BTC_USDT');
    expect(orders.length).toBe(1);
    expect(orders[0]!.order_id).toBe('ord123');
  });

  // ── getOrderHistory ───────────────────────────────────────────────────────

  it('getOrderHistory() respects limit and returns orders', async () => {
    mockInstance.post.mockResolvedValueOnce({
      data: {
        code: 'SUCCESS',
        result: { order_list: [ORDER_RESPONSE.data.result] },
      },
    });
    const history = await makeClient().getOrderHistory('BTC_USDT', 50);
    expect(history.length).toBe(1);
    const call = mockInstance.post.mock.calls[0]![1] as { page_size: number };
    expect(call.page_size).toBe(50);
  });
});
