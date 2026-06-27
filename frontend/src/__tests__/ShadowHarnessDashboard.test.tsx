import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { ShadowHarnessDashboard } from '../components/ShadowHarnessDashboard';

// ── Fake EventSource (jsdom has none) ──────────────────────────────────────────

type Listener = (ev: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ||= []).push(cb);
  }
  emit(type: string, data: unknown) {
    (this.listeners[type] || []).forEach(cb => cb({ data: JSON.stringify(data) }));
  }
  close() {}
}

const statsPayload = {
  closedTradeCount: 2, winRate: 0.5, expectancyPerTrade: 1.5, profitFactor: 2,
  totalNetPnl: 3, totalCommissionPaid: 0.4, feeDragPct: 0.001, maxDrawdownPct: 0.05,
  sharpe: 0.8, unrealized: { totalUnrealizedPnl: 0 },
};

describe('ShadowHarnessDashboard', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (typeof url === 'string' && url.includes('/api/paper/stats')
        ? statsPayload
        : { running: true, symbols: ['BTC'], cycleCount: 0, errorCount: 0 }),
      _url: url, _opts: opts,
    })) as unknown as typeof fetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the SSE stream and renders streamed cycles', async () => {
    render(<ShadowHarnessDashboard />);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe('/api/shadow/stream');

    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.emit('status', { running: true, startedAt: null, intervalMs: 10000, symbols: ['BTC'], dryRun: false, cycleCount: 0, errorCount: 0, lastError: null, lastCycleAt: null, recent: [] });
      source.emit('cycle', { cycle: 1, at: new Date().toISOString(), symbolsEvaluated: 1, executedCount: 1, decisions: [{ symbol: 'BTC', signal: 'BUY', action: 'BUY', status: 'EXECUTED', reason: 'ok' }] });
    });

    expect(await screen.findByText('Cycle #1')).toBeInTheDocument();
    expect(screen.getByText(/BTC BUY/)).toBeInTheDocument();
  });

  it('renders the net-of-fees expectancy snapshot from /api/paper/stats', async () => {
    render(<ShadowHarnessDashboard />);
    expect(await screen.findByText('Net P&L')).toBeInTheDocument();
    expect(screen.getByText('Win rate')).toBeInTheDocument();
  });

  it('starts the harness with the parsed symbols and interval', async () => {
    render(<ShadowHarnessDashboard />);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => {
      const startCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/shadow/start'));
      expect(startCall).toBeTruthy();
      const body = JSON.parse((startCall![1] as RequestInit).body as string);
      expect(body.symbols).toEqual(['BTC', 'ETH']);   // default "BTC,ETH"
      expect(body.intervalMs).toBe(10000);            // default 10s
    });
  });
});
