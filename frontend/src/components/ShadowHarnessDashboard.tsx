/**
 * ShadowHarnessDashboard — Phase 6 live view for the shadow-mode agent harness.
 *
 * Streams the harness's cycles in real time over Server-Sent Events
 * (`GET /api/shadow/stream`) and exposes start/stop/tick controls plus the latest
 * net-of-fees expectancy snapshot (`GET /api/paper/stats`). SSE, not WebSockets,
 * per the project constraint — the browser's native `EventSource` reconnects on
 * its own, so there is no socket lifecycle to manage.
 */

import { useEffect, useRef, useState } from 'react';

// ── Types (mirror the backend payloads we consume) ─────────────────────────────

interface AgentDecision {
  symbol:    string;
  signal:    'BUY' | 'SELL' | 'HOLD';
  action:    'BUY' | 'SELL' | 'HOLD';
  status:    'EXECUTED' | 'SKIPPED' | 'BLOCKED' | 'ERROR';
  reason:    string;
  price?:    number;
  quantity?: number;
}

interface CycleSummary {
  cycle:            number;
  at:               string;
  symbolsEvaluated: number;
  executedCount:    number;
  decisions:        AgentDecision[];
  error?:           string;
}

interface ShadowStatus {
  running:     boolean;
  startedAt:   string | null;
  intervalMs:  number;
  symbols:     string[];
  dryRun:      boolean;
  cycleCount:  number;
  errorCount:  number;
  lastError:   string | null;
  lastCycleAt: string | null;
  recent:      CycleSummary[];
}

interface ExpectancyReport {
  closedTradeCount:   number;
  winRate:            number;
  expectancyPerTrade: number;
  profitFactor:       number;
  totalNetPnl:        number;
  totalCommissionPaid: number;
  feeDragPct:         number;
  maxDrawdownPct:     number;
  sharpe:             number;
  unrealized:         { totalUnrealizedPnl: number };
}

const MAX_FEED = 50;

// ── Component ───────────────────────────────────────────────────────────────────

export function ShadowHarnessDashboard() {
  const [status, setStatus] = useState<ShadowStatus | null>(null);
  const [feed, setFeed] = useState<CycleSummary[]>([]);
  const [stats, setStats] = useState<ExpectancyReport | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state
  const [symbolsInput, setSymbolsInput] = useState('BTC,ETH');
  const [intervalSec, setIntervalSec] = useState(10);
  const [dryRun, setDryRun] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);

  const refreshStats = async () => {
    try {
      const res = await fetch('/api/paper/stats');
      if (res.ok) setStats(await res.json() as ExpectancyReport);
    } catch {
      // analytics are best-effort in the live view
    }
  };

  // Open the SSE stream once on mount; close it on unmount.
  useEffect(() => {
    void refreshStats();

    const source = new EventSource('/api/shadow/stream');
    sourceRef.current = source;

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('status', (ev: MessageEvent) => {
      try { setStatus(JSON.parse(ev.data) as ShadowStatus); } catch { /* ignore malformed frame */ }
    });
    source.addEventListener('cycle', (ev: MessageEvent) => {
      try {
        const summary = JSON.parse(ev.data) as CycleSummary;
        setFeed(prev => [summary, ...prev].slice(0, MAX_FEED));
        setStatus(prev => prev ? { ...prev, cycleCount: summary.cycle, lastCycleAt: summary.at, lastError: summary.error ?? prev.lastError, errorCount: summary.error ? prev.errorCount + 1 : prev.errorCount } : prev);
        void refreshStats();
      } catch { /* ignore malformed frame */ }
    });
    source.onerror = () => setConnected(false);   // EventSource auto-reconnects

    return () => { source.close(); sourceRef.current = null; };
  }, []);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? `Request failed (${res.status})`); return null; }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const parsedSymbols = symbolsInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const onStart = async () => {
    if (parsedSymbols.length === 0) { setError('Enter at least one symbol'); return; }
    const data = await post('/api/shadow/start', {
      symbols:    parsedSymbols,
      intervalMs: Math.max(1, intervalSec) * 1000,
      dryRun,
    });
    if (data) setStatus(data as ShadowStatus);
  };

  const onStop = async () => {
    const data = await post('/api/shadow/stop');
    if (data) setStatus(data as ShadowStatus);
  };

  const onTick = async () => {
    await post('/api/shadow/tick', { symbols: parsedSymbols, dryRun });
    void refreshStats();
  };

  const running = status?.running ?? false;

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text)' }}>Shadow Harness — Live</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Continuous agent cycles streamed over SSE, measured net-of-fees by paper analytics.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Pill ok={connected} on="stream connected" off="stream offline" />
          <Pill ok={running} on="running" off="stopped" />
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '0.6rem', padding: '0.6rem 0.85rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Controls */}
      <div style={card}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={field}>
            <span style={fieldLabel}>Symbols (comma-separated)</span>
            <input value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} style={input} placeholder="BTC,ETH" />
          </label>
          <label style={{ ...field, maxWidth: '8rem' }}>
            <span style={fieldLabel}>Interval (sec)</span>
            <input type="number" min={1} value={intervalSec} onChange={e => setIntervalSec(Math.max(1, Number(e.target.value) || 1))} style={input} />
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text)', fontSize: '0.9rem', paddingBottom: '0.5rem' }}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            Dry run (decide, don&apos;t trade)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button onClick={onStart} disabled={busy || running} style={btn('#16a34a', busy || running)}>Start</button>
            <button onClick={onStop} disabled={busy || !running} style={btn('#dc2626', busy || !running)}>Stop</button>
            <button onClick={onTick} disabled={busy} style={btn('#2563eb', busy)}>Run one cycle</button>
          </div>
        </div>
        {status && (
          <div style={{ marginTop: '0.85rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <span>Cycles: <b style={{ color: 'var(--text)' }}>{status.cycleCount}</b></span>
            <span>Errors: <b style={{ color: status.errorCount > 0 ? '#dc2626' : 'var(--text)' }}>{status.errorCount}</b></span>
            <span>Symbols: <b style={{ color: 'var(--text)' }}>{status.symbols.join(', ') || '—'}</b></span>
            {status.lastError && <span style={{ color: '#dc2626' }}>Last error: {status.lastError}</span>}
          </div>
        )}
      </div>

      {/* Net-of-fees expectancy snapshot */}
      <div style={card}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', color: 'var(--text)' }}>Net-of-fees performance</h3>
        {stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.75rem' }}>
            <Stat label="Net P&L" value={fmtUsd(stats.totalNetPnl)} positive={stats.totalNetPnl >= 0} />
            <Stat label="Closed trades" value={String(stats.closedTradeCount)} />
            <Stat label="Win rate" value={fmtPct(stats.winRate)} />
            <Stat label="Expectancy / trade" value={fmtUsd(stats.expectancyPerTrade)} positive={stats.expectancyPerTrade >= 0} />
            <Stat label="Profit factor" value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} />
            <Stat label="Max drawdown" value={fmtPct(stats.maxDrawdownPct)} />
            <Stat label="Fees paid" value={fmtUsd(stats.totalCommissionPaid)} />
            <Stat label="Unrealized" value={fmtUsd(stats.unrealized.totalUnrealizedPnl)} positive={stats.unrealized.totalUnrealizedPnl >= 0} />
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>No trades yet — start the harness or run a cycle.</p>
        )}
      </div>

      {/* Live cycle feed */}
      <div style={card}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', color: 'var(--text)' }}>Live cycle feed</h3>
        {feed.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>Waiting for cycles…</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {feed.map(cycle => (
              <div key={`${cycle.cycle}-${cycle.at}`} style={{ border: '1px solid var(--border)', borderRadius: '0.6rem', padding: '0.6rem 0.75rem', background: cycle.error ? '#fff5f5' : 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>Cycle #{cycle.cycle}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{fmtTime(cycle.at)}</span>
                </div>
                {cycle.error ? (
                  <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.3rem' }}>Error: {cycle.error}</div>
                ) : (
                  <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{cycle.executedCount}/{cycle.symbolsEvaluated} executed</span>
                    {cycle.decisions.map((d, i) => (
                      <span key={i} title={d.reason} style={decisionChip(d)}>
                        {d.symbol} {d.action}{d.status !== 'EXECUTED' ? ` · ${d.status.toLowerCase()}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────────

function Pill({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <span style={{
      fontSize: '0.72rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '999px',
      background: ok ? '#dcfce7' : '#f1f5f9', color: ok ? '#166534' : '#64748b',
      border: `1px solid ${ok ? '#bbf7d0' : '#e2e8f0'}`,
    }}>
      ● {ok ? on : off}
    </span>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '0.6rem', padding: '0.6rem 0.75rem' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem', color: positive === undefined ? 'var(--text)' : positive ? '#16a34a' : '#dc2626' }}>{value}</div>
    </div>
  );
}

function decisionChip(d: AgentDecision): React.CSSProperties {
  const palette = d.status === 'EXECUTED'
    ? { bg: '#dbeafe', fg: '#1d4ed8', bd: '#bfdbfe' }
    : d.status === 'BLOCKED' || d.status === 'ERROR'
    ? { bg: '#fee2e2', fg: '#b91c1c', bd: '#fecaca' }
    : { bg: '#f1f5f9', fg: '#64748b', bd: '#e2e8f0' };
  return { fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.45rem', borderRadius: '0.4rem', background: palette.bg, color: palette.fg, border: `1px solid ${palette.bd}` };
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem' };
const field: React.CSSProperties = { display: 'grid', gap: '0.3rem', flex: 1, minWidth: '12rem' };
const fieldLabel: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 };
const input: React.CSSProperties = { padding: '0.5rem 0.65rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem' };
const btn = (color: string, disabled: boolean): React.CSSProperties => ({
  padding: '0.55rem 0.9rem', borderRadius: '0.5rem', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
  background: disabled ? '#94a3b8' : color, color: '#fff', fontWeight: 600, fontSize: '0.85rem',
});

const fmtUsd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtPct = (frac: number): string => `${(frac * 100).toFixed(1)}%`;
const fmtTime = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(); };

export default ShadowHarnessDashboard;
