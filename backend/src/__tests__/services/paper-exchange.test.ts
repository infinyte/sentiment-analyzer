import { PaperExchange } from '../../services/exchange/paper-exchange.js';

const INITIAL_CAPITAL = 10_000;

describe('PaperExchange', () => {
  let exchange: PaperExchange;

  beforeEach(() => {
    exchange = new PaperExchange(INITIAL_CAPITAL);
  });

  // ── Identity ────────────────────────────────────────────────────────────────

  it('getExchangeName() returns a string containing "Paper"', async () => {
    const name = await exchange.getExchangeName();
    expect(typeof name).toBe('string');
    expect(name).toContain('Paper');
  });

  it('isConnected() always returns true', async () => {
    expect(await exchange.isConnected()).toBe(true);
  });

  // ── Balances ─────────────────────────────────────────────────────────────────

  it('getBalance("USDT") returns the starting balance', async () => {
    const bal = await exchange.getBalance('USDT');
    expect(bal.total).toBe(INITIAL_CAPITAL);
    expect(bal.available).toBe(INITIAL_CAPITAL);
  });

  it('getBalance("BTC") returns zero for an unknown asset', async () => {
    const bal = await exchange.getBalance('BTC');
    expect(bal.available).toBe(0);
    expect(bal.held).toBe(0);
    expect(bal.total).toBe(0);
  });

  it('constructor uses the supplied initial capital', async () => {
    const custom = new PaperExchange(25_000);
    expect((await custom.getBalance('USDT')).total).toBe(25_000);
  });

  it('getAllBalances() contains only entries with total > 0', async () => {
    const balances = await exchange.getAllBalances();
    expect(balances.length).toBeGreaterThan(0);
    for (const b of balances) {
      expect(b.total).toBeGreaterThan(0);
    }
  });

  it('getAllBalances() includes USDT initially', async () => {
    const balances = await exchange.getAllBalances();
    expect(balances.find(b => b.symbol === 'USDT')).toBeDefined();
  });

  // ── Prices ───────────────────────────────────────────────────────────────────

  it('getCurrentPrice("BTC") returns a positive number', async () => {
    const price = await exchange.getCurrentPrice('BTC');
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThan(0);
  });

  it('getPrices(["BTC","ETH"]) returns a Map with both symbols', async () => {
    const prices = await exchange.getPrices(['BTC', 'ETH']);
    expect(prices).toBeInstanceOf(Map);
    expect(prices.has('BTC')).toBe(true);
    expect(prices.has('ETH')).toBe(true);
    for (const p of prices.values()) {
      expect(p).toBeGreaterThan(0);
    }
  });

  // ── BUY order ────────────────────────────────────────────────────────────────

  describe('placeOrder() — BUY', () => {
    it('returns an Order with status FILLED', async () => {
      const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.1, price: 50_000 });
      expect(order.status).toBe('FILLED');
    });

    it('returned order has the expected shape', async () => {
      const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.1, price: 50_000 });
      expect(order.id).toBeDefined();
      expect(order.symbol).toBe('BTC');
      expect(order.type).toBe('BUY');
      expect(order.quantity).toBeCloseTo(0.1, 8);
      expect(order.price).toBe(50_000);
      expect(order.timestamp).toBeInstanceOf(Date);
    });

    it('reduces USDT balance by (size × price)', async () => {
      await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.1, price: 50_000 });
      const bal = await exchange.getBalance('USDT');
      expect(bal.total).toBeCloseTo(INITIAL_CAPITAL - 5_000, 8);
    });

    it('increases asset balance by the purchased size', async () => {
      await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.1, price: 50_000 });
      const bal = await exchange.getBalance('BTC');
      expect(bal.total).toBeCloseTo(0.1, 8);
    });
  });

  // ── SELL order ────────────────────────────────────────────────────────────────

  describe('placeOrder() — SELL (after a prior BUY)', () => {
    beforeEach(async () => {
      await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.1, price: 50_000 });
    });

    it('increases USDT balance by (size × price)', async () => {
      const before = (await exchange.getBalance('USDT')).total;
      await exchange.placeOrder({ symbol: 'BTC', side: 'SELL', size: 0.1, price: 50_000 });
      const after = (await exchange.getBalance('USDT')).total;
      expect(after).toBeCloseTo(before + 5_000, 8);
    });

    it('decreases asset balance by the sold size', async () => {
      await exchange.placeOrder({ symbol: 'BTC', side: 'SELL', size: 0.1, price: 50_000 });
      expect((await exchange.getBalance('BTC')).total).toBeCloseTo(0, 8);
    });
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────────

  it('cancelOrder() returns false for an unknown id', async () => {
    expect(await exchange.cancelOrder('nonexistent')).toBe(false);
  });

  it('cancelOrder() returns true for a tracked order id and marks it CANCELED', async () => {
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const result = await exchange.cancelOrder(order.id);
    expect(result).toBe(true);
    const updated = await exchange.getOrderStatus(order.id);
    expect(updated.status).toBe('CANCELED');
  });

  // ── Order queries ─────────────────────────────────────────────────────────────

  it('getOpenOrders() only returns PENDING orders', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const open = await exchange.getOpenOrders();
    for (const o of open) {
      expect(o.status).toBe('PENDING');
    }
  });

  it('getOrderStatus() returns the correct order for a known id', async () => {
    const placed = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    const fetched = await exchange.getOrderStatus(placed.id);
    expect(fetched.id).toBe(placed.id);
    expect(fetched.symbol).toBe('BTC');
  });

  it('getOrderStatus() throws for an unknown id', async () => {
    await expect(exchange.getOrderStatus('totally-unknown')).rejects.toThrow();
  });

  it('getOrderHistory() returns all placed orders', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await exchange.placeOrder({ symbol: 'ETH', side: 'BUY', size: 0.5,  price: 3_000  });
    const history = await exchange.getOrderHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('getOrderHistory(1) returns at most 1 order', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: 0.01, price: 50_000 });
    await exchange.placeOrder({ symbol: 'ETH', side: 'BUY', size: 0.5,  price: 3_000  });
    await exchange.placeOrder({ symbol: 'BTC', side: 'SELL', size: 0.01, price: 51_000 });
    const history = await exchange.getOrderHistory(1);
    expect(history.length).toBe(1);
  });
});
