import { ShadowHarness } from '../../services/agent/shadow-harness.js';
import type {
  TradingAgentOrchestrator,
  OrchestrationReport,
} from '../../services/agent/trading-orchestrator.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeReport(over: Partial<OrchestrationReport> = {}): OrchestrationReport {
  return {
    generatedAt:      new Date(),
    dryRun:           false,
    symbolsEvaluated: 1,
    executedCount:    1,
    decisions:        [],
    portfolio:        { cashUsdt: 9_000, positions: [] },
    ...over,
  };
}

/** Minimal orchestrator stub exposing a controllable `run`. */
function stubOrchestrator(run: jest.Mock): TradingAgentOrchestrator {
  return { run, getConfig: () => ({ minStrength: 0.3, tradeFractionOfCapital: 0.1, maxSymbols: 25 }) } as unknown as TradingAgentOrchestrator;
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('ShadowHarness', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runOnce delegates to the orchestrator and records a cycle summary', async () => {
    const run = jest.fn().mockResolvedValue(makeReport({ executedCount: 2 }));
    const harness = new ShadowHarness(stubOrchestrator(run));

    const report = await harness.runOnce(['BTC']);

    expect(run).toHaveBeenCalledWith({ symbols: ['BTC'], dryRun: false });
    expect(report.executedCount).toBe(2);

    const status = harness.getStatus();
    expect(status.cycleCount).toBe(1);
    expect(status.recent).toHaveLength(1);
    expect(status.recent[0]!.executedCount).toBe(2);
  });

  it('start configures the loop, kicks an immediate cycle, and reports running', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const run = jest.fn().mockResolvedValue(makeReport());
    const harness = new ShadowHarness(stubOrchestrator(run));

    const status = harness.start({ symbols: ['BTC', 'eth'], intervalMs: 5_000 });
    expect(status.running).toBe(true);
    expect(status.symbols).toEqual(['BTC', 'ETH']);   // deduped + upper-cased
    expect(status.intervalMs).toBe(5_000);

    await flush();                                     // let the immediate tick settle
    expect(run).toHaveBeenCalledTimes(1);

    harness.stop();
    expect(harness.getStatus().running).toBe(false);
  });

  it('fires repeatedly on the interval and stops cleanly', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const run = jest.fn().mockResolvedValue(makeReport());
    const harness = new ShadowHarness(stubOrchestrator(run));

    harness.start({ symbols: ['BTC'], intervalMs: 1_000 });
    await flush();                       // immediate cycle → 1
    expect(run).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000); await flush();  // → 2
    jest.advanceTimersByTime(1_000); await flush();  // → 3
    expect(run).toHaveBeenCalledTimes(3);

    harness.stop();
    jest.advanceTimersByTime(5_000); await flush();  // no more cycles after stop
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('clamps interval below the 1s floor', () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const harness = new ShadowHarness(stubOrchestrator(jest.fn().mockResolvedValue(makeReport())));
    const status = harness.start({ symbols: ['BTC'], intervalMs: 10 });
    expect(status.intervalMs).toBe(1_000);
    harness.stop();
  });

  it('rejects start with no symbols', () => {
    const harness = new ShadowHarness(stubOrchestrator(jest.fn()));
    expect(() => harness.start({ symbols: [] })).toThrow(/at least one symbol/i);
  });

  it('skips overlapping ticks while a cycle is in flight', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const run = jest.fn().mockReturnValue(gate.then(() => makeReport()));
    const harness = new ShadowHarness(stubOrchestrator(run));

    harness.start({ symbols: ['BTC'], intervalMs: 1_000 });  // immediate tick starts, hangs on gate
    await flush();
    jest.advanceTimersByTime(1_000); await flush();          // second tick should be skipped
    expect(run).toHaveBeenCalledTimes(1);

    release();                                               // let the first cycle finish
    await flush();
    jest.advanceTimersByTime(1_000); await flush();          // now a fresh tick runs
    expect(run).toHaveBeenCalledTimes(2);

    harness.stop();
  });

  it('records errors and keeps the loop alive', async () => {
    const run = jest.fn()
      .mockResolvedValueOnce(makeReport())
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeReport());
    const harness = new ShadowHarness(stubOrchestrator(run));

    await harness.runOnce(['BTC']);                          // ok
    // drive a failing + a recovering tick through the private timer path
    harness.start({ symbols: ['BTC'], intervalMs: 60_000 }); // immediate tick → rejects
    await flush();

    const status = harness.getStatus();
    expect(status.errorCount).toBe(1);
    expect(status.lastError).toBe('boom');
    // newest-first: the error cycle is at the front
    expect(status.recent[0]!.error).toBe('boom');
    harness.stop();
  });

  it('bounds history to maxHistory (ring buffer, newest first)', async () => {
    const run = jest.fn().mockImplementation(async () => makeReport());
    const harness = new ShadowHarness(stubOrchestrator(run));
    harness.start({ symbols: ['BTC'], intervalMs: 60_000, maxHistory: 3 });
    // start already kicked one immediate cycle; add several more manual cycles
    for (let i = 0; i < 5; i++) await harness.runOnce(['BTC']);
    harness.stop();

    const status = harness.getStatus();
    expect(status.recent).toHaveLength(3);
    // cycleCount keeps counting even though history is capped
    expect(status.cycleCount).toBeGreaterThanOrEqual(5);
    // newest first → descending cycle numbers
    expect(status.recent[0]!.cycle).toBeGreaterThan(status.recent[2]!.cycle);
  });
});
