/**
 * RealisticPaperExchange — unit tests
 *
 * Covers:
 *   • Provider fee presets (AC3)
 *   • Custom fee override (AC3)
 *   • Side-specific slippage (AC4)
 *   • Commission deducted from balance + returned in order (AC5)
 *   • FallbackQuoteSource success path (AC2)
 *   • FallbackQuoteSource fallback when primary throws (AC2)
 *   • Exchange interface contract (AC1)
 */

import {
  RealisticPaperExchange,
  FallbackQuoteSource,
  FEE_PRESETS,
  type QuoteSource,
} from '../../services/exchange/realistic-paper-exchange.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** QuoteSource that always returns a fixed price. */
function fixedQuote(price: number): QuoteSource {
  return { getPrice: async () => price };
}

/** QuoteSource that always throws. */
function brokenQuote(): QuoteSource {
  return { getPrice: async () => { throw new Error('network down'); } };
}

const PRICE = 50_000;
const SIZE  = 0.1;

// ── ExchangeInterface contract ────────────────────────────────────────────────

describe('RealisticPaperExchange — exchange interface', () => {
  let exchange: RealisticPaperExchange;

  beforeEach(() => {
    exchange = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: 0,
      feeMaker: 0,
    });
  });

  it('getExchangeName() returns "Realistic Paper Exchange"', async () => {
    expect(await exchange.getExchangeName()).toBe('Realistic Paper Exchange');
  });

  it('isConnected() returns true', async () => {
    expect(await exchange.isConnected()).toBe(true);
  });

  it('getBalance("USDT") returns 10 000 by default', async () => {
    const bal = await exchange.getBalance('USDT');
    expect(bal.total).toBe(10_000);
    expect(bal.available).toBe(10_000);
  });

  it('constructor respects initialCapital', async () => {
    const ex = new RealisticPaperExchange({ initialCapital: 25_000, quoteSource: fixedQuote(PRICE) });
    expect((await ex.getBalance('USDT')).total).toBe(25_000);
  });

  it('getCurrentPrice() delegates to the injected quoteSource', async () => {
    expect(await exchange.getCurrentPrice('BTC')).toBe(PRICE);
  });

  it('getPrices() returns a Map with all requested symbols', async () => {
    const prices = await exchange.getPrices(['BTC', 'ETH']);
    expect(prices.get('BTC')).toBe(PRICE);
    expect(prices.get('ETH')).toBe(PRICE);
  });

  it('placeOrder() returns FILLED status', async () => {
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.status).toBe('FILLED');
  });

  it('cancelOrder() returns false for unknown id', async () => {
    expect(await exchange.cancelOrder('unknown')).toBe(false);
  });

  it('cancelOrder() marks order CANCELED', async () => {
    const order = await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(await exchange.cancelOrder(order.id)).toBe(true);
    expect((await exchange.getOrderStatus(order.id)).status).toBe('CANCELED');
  });

  it('getOrderStatus() throws for unknown id', async () => {
    await expect(exchange.getOrderStatus('nope')).rejects.toThrow();
  });

  it('getOpenOrders() returns only PENDING orders', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const open = await exchange.getOpenOrders();
    for (const o of open) expect(o.status).toBe('PENDING');
  });

  it('getOrderHistory() returns placed orders', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    await exchange.placeOrder({ symbol: 'ETH', side: 'BUY', size: 1,    price: PRICE });
    expect((await exchange.getOrderHistory()).length).toBeGreaterThanOrEqual(2);
  });

  it('getOrderHistory(1) returns at most 1 order', async () => {
    await exchange.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    await exchange.placeOrder({ symbol: 'ETH', side: 'BUY', size: 1,    price: PRICE });
    expect((await exchange.getOrderHistory(1)).length).toBe(1);
  });

  it('getAllBalances() excludes zero-balance entries', async () => {
    const bals = await exchange.getAllBalances();
    for (const b of bals) expect(b.total).toBeGreaterThan(0);
  });
});

// ── Fee presets ───────────────────────────────────────────────────────────────

describe('RealisticPaperExchange — fee presets (AC3)', () => {
  it('FEE_PRESETS contains all four providers', () => {
    expect(FEE_PRESETS['crypto-com']).toBeDefined();
    expect(FEE_PRESETS['binance-us']).toBeDefined();
    expect(FEE_PRESETS['coinbase']).toBeDefined();
    expect(FEE_PRESETS['alpaca']).toBeDefined();
  });

  it('crypto-com preset: taker 0.50 %', () => {
    expect(FEE_PRESETS['crypto-com'].taker).toBeCloseTo(0.005, 6);
  });

  it('binance-us preset: maker 0 % / taker 0.02 % (entry tier)', () => {
    expect(FEE_PRESETS['binance-us'].maker).toBeCloseTo(0.0000, 6);
    expect(FEE_PRESETS['binance-us'].taker).toBeCloseTo(0.0002, 6);
  });

  it('coinbase preset: taker 1.20 %', () => {
    expect(FEE_PRESETS['coinbase'].taker).toBeCloseTo(0.012, 6);
  });

  it('alpaca preset: taker 0.25 %', () => {
    expect(FEE_PRESETS['alpaca'].taker).toBeCloseTo(0.0025, 6);
  });

  it('default (no preset) uses binance-us fees', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const expectedCommission = PRICE * SIZE * FEE_PRESETS['binance-us'].taker;
    expect(order.commission).toBeCloseTo(expectedCommission, 8);
  });

  it('coinbase preset applies higher taker fee', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feePreset: 'coinbase',
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const expected = PRICE * SIZE * FEE_PRESETS['coinbase'].taker;
    expect(order.commission).toBeCloseTo(expected, 8);
  });

  it('custom feeTaker overrides the preset', async () => {
    const customTaker = 0.002;
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feePreset: 'coinbase',
      feeTaker: customTaker,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.commission).toBeCloseTo(PRICE * SIZE * customTaker, 8);
  });

  it('feeTaker = 0 results in zero commission', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.commission).toBe(0);
  });
});

// ── Slippage ──────────────────────────────────────────────────────────────────

describe('RealisticPaperExchange — slippage by side (AC4)', () => {
  const slippage = 0.005; // 0.5%

  it('BUY execution price = basePrice × (1 + slippageBuyPct)', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: slippage,
      slippageSellPct: 0,
      feeTaker: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.price).toBeCloseTo(PRICE * (1 + slippage), 8);
  });

  it('SELL execution price = basePrice × (1 - slippageSellPct)', async () => {
    const ex = new RealisticPaperExchange({
      initialCapital: 0,
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: slippage,
      feeTaker: 0,
    });
    // Seed asset balance directly via a BUY at zero cost first
    const setup = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: slippage,
      feeTaker: 0,
    });
    await setup.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const order = await setup.placeOrder({ symbol: 'BTC', side: 'SELL', size: SIZE, price: PRICE });
    expect(order.price).toBeCloseTo(PRICE * (1 - slippage), 8);
  });

  it('slippage = 0 on both sides: execution price equals base price', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.price).toBeCloseTo(PRICE, 8);
  });

  it('default slippage (0.1 %) is applied when not specified', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      feeTaker: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.price).toBeCloseTo(PRICE * 1.001, 8);
  });

  it('BUY order uses the quote source price when no price is supplied', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      feeTaker: 0,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE });
    expect(order.price).toBeCloseTo(PRICE, 8);
  });
});

// ── Balance accounting (fees deducted) ───────────────────────────────────────

describe('RealisticPaperExchange — balance accounting with fees (AC5)', () => {
  const taker      = 0.005;  // 0.5 %
  const buySlip    = 0;
  const sellSlip   = 0;

  it('BUY: USDT deducted = grossValue + commission', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: buySlip,
      slippageSellPct: sellSlip,
      feeTaker: taker,
    });
    await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });

    const grossValue = PRICE * SIZE;
    const commission = grossValue * taker;
    const expectedUSDT = 10_000 - grossValue - commission;
    const usdt = await ex.getBalance('USDT');
    expect(usdt.total).toBeCloseTo(expectedUSDT, 6);
  });

  it('BUY: asset balance increases by SIZE', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: buySlip,
      feeTaker: taker,
    });
    await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect((await ex.getBalance('BTC')).total).toBeCloseTo(SIZE, 8);
  });

  it('SELL: USDT credited = grossValue - commission', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: buySlip,
      slippageSellPct: sellSlip,
      feeTaker: taker,
    });
    // BUY first (no fee so we can track sell proceeds precisely)
    const exNoFee = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: 0,
    });
    await exNoFee.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const usdtAfterBuy = (await exNoFee.getBalance('USDT')).total;

    // Now place SELL with fee
    const exSell = new RealisticPaperExchange({
      initialCapital: 0,
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: taker,
    });
    // Directly build the scenario: start with SIZE BTC, no USDT
    // Use a simple exchange that lets us control conditions
    const ex2 = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: sellSlip,
      feeTaker: taker,
    });
    // BUY with no fee to get asset
    const buyOrder = await ex2.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const usdtBeforeSell = (await ex2.getBalance('USDT')).total;
    // BUY order commission was already deducted; now SELL
    const sellOrder = await ex2.placeOrder({ symbol: 'BTC', side: 'SELL', size: SIZE, price: PRICE });

    const grossSell  = PRICE * SIZE;
    const commission = grossSell * taker;
    const expectedUSDTIncrease = grossSell - commission;
    const usdtAfterSell = (await ex2.getBalance('USDT')).total;
    expect(usdtAfterSell - usdtBeforeSell).toBeCloseTo(expectedUSDTIncrease, 5);

    // order.commission is set
    expect(sellOrder.commission).toBeCloseTo(commission, 5);
    // buyOrder.commission is also set
    expect(buyOrder.commission).toBeCloseTo(PRICE * SIZE * taker, 5);
  });

  it('order.commission is returned on BUY', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      feeTaker: taker,
    });
    const order = await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    expect(order.commission).toBeCloseTo(PRICE * SIZE * taker, 8);
  });

  it('order.commission is returned on SELL', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(PRICE),
      slippageBuyPct: 0,
      slippageSellPct: 0,
      feeTaker: taker,
    });
    await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: SIZE, price: PRICE });
    const sellOrder = await ex.placeOrder({ symbol: 'BTC', side: 'SELL', size: SIZE, price: PRICE });
    expect(sellOrder.commission).toBeCloseTo(PRICE * SIZE * taker, 8);
  });
});

// ── FallbackQuoteSource ───────────────────────────────────────────────────────

describe('FallbackQuoteSource — live quote with fallback (AC2)', () => {
  it('returns price from primary when it resolves', async () => {
    const src = new FallbackQuoteSource(fixedQuote(42_000));
    expect(await src.getPrice('BTC')).toBe(42_000);
  });

  it('falls back to random-walk price when primary throws', async () => {
    const src = new FallbackQuoteSource(brokenQuote());
    const price = await src.getPrice('BTC');
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThan(0);
  });

  it('random-walk fallback returns a positive price for unknown symbol', async () => {
    const src = new FallbackQuoteSource(); // no primary
    const price = await src.getPrice('UNKNOWN_COIN');
    expect(price).toBeGreaterThan(0);
  });

  it('uses seeded random walk when no primary is supplied', async () => {
    const src = new FallbackQuoteSource();
    const price = await src.getPrice('BTC');
    // Should be near 73 000 (seed) with ±1% drift
    expect(price).toBeGreaterThan(50_000);
    expect(price).toBeLessThan(100_000);
  });

  it('RealisticPaperExchange uses injected quote source', async () => {
    const ex = new RealisticPaperExchange({
      quoteSource: fixedQuote(99_999),
      feeTaker: 0,
      slippageBuyPct: 0,
    });
    expect(await ex.getCurrentPrice('BTC')).toBe(99_999);
  });

  it('RealisticPaperExchange falls back when primary source fails', async () => {
    const fallback = new FallbackQuoteSource(brokenQuote());
    const ex = new RealisticPaperExchange({ quoteSource: fallback, feeTaker: 0, slippageBuyPct: 0 });
    const price = await ex.getCurrentPrice('BTC');
    expect(price).toBeGreaterThan(0);
  });
});
