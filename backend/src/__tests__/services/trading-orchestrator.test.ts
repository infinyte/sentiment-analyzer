import {
  TradingAgentOrchestrator,
  StaticSignalSource,
  SentimentSignalSource,
  type AgentSignal,
  type SentimentReader,
} from '../../services/agent/trading-orchestrator.js';
import { TradingService } from '../../services/exchange/trading-service.js';
import type {
  ExchangeInterface,
  Order,
  Balance,
  PlaceOrderParams,
} from '../../services/exchange/exchange-interface.js';
import type { Sentiment } from '../../types.js';

// ── Deterministic fake exchange (fixed prices, paper-style balance accounting) ──

class FakeExchange implements ExchangeInterface {
  private readonly balances = new Map<string, Balance>();
  private readonly orders: Order[] = [];
  private counter = 0;

  constructor(initialUsdt: number, private readonly prices: Record<string, number>) {
    this.balances.set('USDT', { symbol: 'USDT', available: initialUsdt, held: 0, total: initialUsdt });
  }

  async getExchangeName(): Promise<string> { return 'Fake'; }
  async isConnected(): Promise<boolean> { return true; }
  async getBalance(symbol: string): Promise<Balance> {
    return this.balances.get(symbol) ?? { symbol, available: 0, held: 0, total: 0 };
  }
  async getAllBalances(): Promise<Balance[]> {
    return [...this.balances.values()].filter(b => b.total > 0);
  }
  async getCurrentPrice(symbol: string): Promise<number> { return this.prices[symbol] ?? 0; }
  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    return new Map(symbols.map(s => [s, this.prices[s] ?? 0]));
  }
  async placeOrder(p: PlaceOrderParams): Promise<Order> {
    const price = p.price ?? this.prices[p.symbol] ?? 0;
    const value = price * p.size;
    const usdt = await this.getBalance('USDT');
    const asset = await this.getBalance(p.symbol);
    if (p.side === 'BUY') {
      this.balances.set('USDT', { ...usdt, available: usdt.available - value, total: usdt.total - value });
      this.balances.set(p.symbol, { ...asset, available: asset.available + p.size, total: asset.total + p.size });
    } else {
      this.balances.set('USDT', { ...usdt, available: usdt.available + value, total: usdt.total + value });
      this.balances.set(p.symbol, { ...asset, available: asset.available - p.size, total: asset.total - p.size });
    }
    const order: Order = {
      id: `fake_${++this.counter}`, symbol: p.symbol, type: p.side, quantity: p.size,
      price, status: 'FILLED', timestamp: new Date(),
    };
    this.orders.push(order);
    return order;
  }
  async cancelOrder(): Promise<boolean> { return false; }
  async getOpenOrders(): Promise<Order[]> { return []; }
  async getOrderStatus(id: string): Promise<Order> {
    const o = this.orders.find(x => x.id === id);
    if (!o) throw new Error('not found');
    return o;
  }
  async getOrderHistory(): Promise<Order[]> { return [...this.orders]; }

  orderCount(): number { return this.orders.length; }
}

function makeTradingService(exchange: ExchangeInterface, overrides = {}): TradingService {
  return new TradingService(exchange, {
    initialCapital:            10_000,
    maxLossPercentage:         5,
    maxPositionSizePercentage: 15,
    maxOpenPositions:          3,
    requireManualApproval:     false,
    ...overrides,
  });
}

const sig = (symbol: string, signal: AgentSignal['signal'], strength: number): AgentSignal =>
  ({ symbol, signal, strength });

// ── Decision policy + execution ───────────────────────────────────────────────

describe('TradingAgentOrchestrator — decisions', () => {
  it('executes a BUY when strength ≥ min and there is no position', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex),
      signalSource: new StaticSignalSource(), config: { tradeFractionOfCapital: 0.1, minStrength: 0.3 },
    });

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.8)] });

    const d = report.decisions[0]!;
    expect(d.action).toBe('BUY');
    expect(d.status).toBe('EXECUTED');
    expect(d.quantity).toBeCloseTo(10, 10);     // (10000 * 0.1) / 100
    expect(d.orderId).toBeDefined();
    expect(report.executedCount).toBe(1);
    expect(report.portfolio.cashUsdt).toBeCloseTo(9_000, 6);
    expect(report.portfolio.positions).toEqual([{ symbol: 'BTC', quantity: 10 }]);
  });

  it('holds on a BUY signal when already holding the asset (no pyramiding)', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: new StaticSignalSource(),
    });
    await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: 5, price: 100 }); // pre-existing position

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.9)] });

    expect(report.decisions[0]!.action).toBe('HOLD');
    expect(report.decisions[0]!.status).toBe('SKIPPED');
    expect(report.decisions[0]!.reason).toMatch(/already holding/i);
  });

  it('holds when BUY strength is below the minimum', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex),
      signalSource: new StaticSignalSource(), config: { minStrength: 0.5 },
    });

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.2)] });

    expect(report.decisions[0]!.action).toBe('HOLD');
    expect(report.decisions[0]!.reason).toMatch(/< min/);
    expect(report.executedCount).toBe(0);
  });

  it('closes the full position on a SELL when holding (regardless of strength)', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: new StaticSignalSource(),
    });
    await ex.placeOrder({ symbol: 'BTC', side: 'BUY', size: 7, price: 100 });

    const report = await orch.run({ signals: [sig('BTC', 'SELL', 0.01)] });

    const d = report.decisions[0]!;
    expect(d.action).toBe('SELL');
    expect(d.status).toBe('EXECUTED');
    expect(d.quantity).toBeCloseTo(7, 10);
    expect(report.portfolio.positions).toEqual([]); // fully closed
  });

  it('never shorts — a SELL with no position is a HOLD no-op', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: new StaticSignalSource(),
    });

    const report = await orch.run({ signals: [sig('BTC', 'SELL', 0.9)] });

    expect(report.decisions[0]!.action).toBe('HOLD');
    expect(report.decisions[0]!.reason).toMatch(/no open position/i);
    expect(ex.orderCount()).toBe(0);
  });

  it('treats a HOLD signal as a skip', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: new StaticSignalSource(),
    });
    const report = await orch.run({ signals: [sig('BTC', 'HOLD', 0.9)] });
    expect(report.decisions[0]!.status).toBe('SKIPPED');
    expect(ex.orderCount()).toBe(0);
  });

  it('dry run decides but places no order', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: new StaticSignalSource(),
    });

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.9)], dryRun: true });

    const d = report.decisions[0]!;
    expect(d.action).toBe('BUY');
    expect(d.status).toBe('SKIPPED');
    expect(d.reason).toMatch(/dry run/i);
    expect(d.quantity).toBeCloseTo(10, 10);  // what it *would* have traded
    expect(ex.orderCount()).toBe(0);         // but nothing was placed
    expect(report.dryRun).toBe(true);
  });

  it('reports BLOCKED with the guard reason when a safety guard rejects the order', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    // 50% of capital per trade exceeds the 15% position-size cap → POSITION_TOO_LARGE.
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex),
      signalSource: new StaticSignalSource(), config: { tradeFractionOfCapital: 0.5 },
    });

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.9)] });

    const d = report.decisions[0]!;
    expect(d.status).toBe('BLOCKED');
    expect(d.rejectReason).toBe('POSITION_TOO_LARGE');
    expect(ex.orderCount()).toBe(0);
  });

  it('sizes sequential BUYs from the cash remaining after earlier fills', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100, ETH: 50 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex),
      signalSource: new StaticSignalSource(), config: { tradeFractionOfCapital: 0.1 },
    });

    const report = await orch.run({ signals: [sig('BTC', 'BUY', 0.9), sig('ETH', 'BUY', 0.9)] });

    // BTC: 10000*0.1/100 = 10 → cash 9000. ETH: 9000*0.1/50 = 18.
    expect(report.decisions[0]!.quantity).toBeCloseTo(10, 10);
    expect(report.decisions[1]!.quantity).toBeCloseTo(18, 10);
    expect(report.executedCount).toBe(2);
  });

  it('falls back to HOLD when the signal source throws', async () => {
    const ex = new FakeExchange(10_000, { BTC: 100 });
    const throwing = { async getSignal(): Promise<AgentSignal> { throw new Error('boom'); } };
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex), signalSource: throwing,
    });

    const report = await orch.run({ symbols: ['BTC'] });

    expect(report.decisions[0]!.status).toBe('SKIPPED');
    expect(ex.orderCount()).toBe(0);
  });

  it('caps the number of symbols evaluated per cycle', async () => {
    const ex = new FakeExchange(10_000, { A: 1 });
    const orch = new TradingAgentOrchestrator({
      exchange: ex, tradingService: makeTradingService(ex),
      signalSource: new StaticSignalSource(), config: { maxSymbols: 2 },
    });
    const report = await orch.run({ symbols: ['A', 'B', 'C', 'D'] });
    expect(report.symbolsEvaluated).toBe(2);
  });
});

// ── Signal sources ─────────────────────────────────────────────────────────────

describe('StaticSignalSource', () => {
  it('returns HOLD for unknown symbols', async () => {
    const src = new StaticSignalSource([sig('BTC', 'BUY', 0.7)]);
    expect((await src.getSignal('ETH')).signal).toBe('HOLD');
    expect((await src.getSignal('btc')).signal).toBe('BUY'); // case-insensitive
  });
});

describe('SentimentSignalSource', () => {
  const reader = (s: Partial<Sentiment> | undefined): SentimentReader => ({
    getSentiment: () => (s ? ({ symbol: 'BTC', analysis_date: '', summary: '', key_catalysts: [], risk_factors: [], short_term_outlook: '', volatility_warning: false, trending_score: 0, sentiment_score: 'NEUTRAL', confidence: 0, ...s } as Sentiment) : undefined),
  });

  it('maps BULL → BUY, BEAR → SELL, NEUTRAL → HOLD', async () => {
    expect((await new SentimentSignalSource(reader({ sentiment_score: 'BULL', confidence: 0.7 })).getSignal('BTC')).signal).toBe('BUY');
    expect((await new SentimentSignalSource(reader({ sentiment_score: 'BEAR', confidence: 0.6 })).getSignal('BTC')).signal).toBe('SELL');
    expect((await new SentimentSignalSource(reader({ sentiment_score: 'NEUTRAL', confidence: 0.9 })).getSignal('BTC')).signal).toBe('HOLD');
  });

  it('normalizes a 0–100 confidence onto 0–1 strength', async () => {
    const s = await new SentimentSignalSource(reader({ sentiment_score: 'BULL', confidence: 80 })).getSignal('BTC');
    expect(s.strength).toBeCloseTo(0.8, 10);
  });

  it('returns HOLD when no cached sentiment exists', async () => {
    expect((await new SentimentSignalSource(reader(undefined)).getSignal('BTC')).signal).toBe('HOLD');
  });
});
