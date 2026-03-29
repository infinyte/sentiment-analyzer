/**
 * TournamentMonitor
 *
 * Audit findings:
 *  - No prior tournament monitoring component existed.
 *  - Styling follows the inline-styles pattern used throughout MarlCompetitionViewer.tsx
 *    and SocialDashboard.tsx — no new CSS libraries introduced.
 *  - Tab navigation pattern: state-based conditional rendering in App.tsx.
 *  - SSE live updates with polling fallback (detected via EventSource onerror).
 *
 * Layout: two-panel (35% list / 65% detail), collapses to single-column < 768px.
 * Created from scratch — no prior component to extend.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { tournamentApi, TournamentApiError } from '../services/tournamentApi.js';
import type {
  AgentSnapshot,
  Tournament,
  TournamentStatus,
  TournamentStatsEvent,
  TournamentStatusEvent,
} from '../types/tournament.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const LIST_REFRESH_MS  = 5_000;

// ── Colour helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<TournamentStatus, { bg: string; text: string; border: string }> = {
  RUNNING:   { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  PAUSED:    { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  QUEUED:    { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  STOPPED:   { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  COMPLETED: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  ERROR:     { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
};

const DARK_STATUS_COLORS: Record<TournamentStatus, { bg: string; text: string; border: string }> = {
  RUNNING:   { bg: '#14532d', text: '#86efac', border: '#166534' },
  PAUSED:    { bg: '#713f12', text: '#fde047', border: '#854d0e' },
  QUEUED:    { bg: '#1e3a5f', text: '#93c5fd', border: '#1e40af' },
  STOPPED:   { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' },
  COMPLETED: { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
  ERROR:     { bg: '#450a0a', text: '#fca5a5', border: '#991b1b' },
};

function statusColors(status: TournamentStatus, isDark: boolean) {
  return isDark ? DARK_STATUS_COLORS[status] : STATUS_COLORS[status];
}

function formatElapsed(ms: number): string {
  if (ms < 0) return '0s';
  const secs  = Math.floor(ms / 1_000);
  const mins  = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins  > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function formatPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function isTerminal(s: TournamentStatus): boolean {
  return s === 'STOPPED' || s === 'COMPLETED' || s === 'ERROR';
}

function isControllable(s: TournamentStatus): boolean {
  return !isTerminal(s);
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Pulsing green dot for RUNNING status indicator. */
function PulseDot({ isDark }: { isDark: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.5rem',
        height: '0.5rem',
        borderRadius: '50%',
        backgroundColor: isDark ? '#4ade80' : '#16a34a',
        boxShadow: `0 0 0 2px ${isDark ? '#14532d' : '#dcfce7'}`,
        animation: 'pulse-dot 1.4s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
  );
}

/** Status badge pill. */
function StatusBadge({
  status,
  isDark,
}: {
  status: TournamentStatus;
  isDark: boolean;
}) {
  const c = statusColors(status, isDark);
  const label = status === 'ERROR' ? '⚠ ERROR' : status;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        backgroundColor: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {status === 'RUNNING' && <PulseDot isDark={isDark} />}
      {label}
    </span>
  );
}

/** Skeleton loader bar. */
function SkeletonBar({ width = '100%', height = '1rem' }: { width?: string; height?: string }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: '0.25rem',
        background: 'var(--skeleton-bg, #e2e8f0)',
        animation: 'skeleton-pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

/** Coin pill badge. */
function CoinPill({ symbol, isDark }: { symbol: string; isDark: boolean }) {
  return (
    <span
      style={{
        padding: '0.1rem 0.5rem',
        borderRadius: '0.25rem',
        fontSize: '0.7rem',
        fontWeight: 600,
        backgroundColor: isDark ? '#1e293b' : '#f1f5f9',
        color: isDark ? '#94a3b8' : '#475569',
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      }}
    >
      {symbol}
    </span>
  );
}

// ── Agent Leaderboard ─────────────────────────────────────────────────────────

function AgentLeaderboard({
  agents,
  isDark,
}: {
  agents: AgentSnapshot[];
  isDark: boolean;
}) {
  const sorted = [...agents].sort((a, b) => b.pnlPercent - a.pnlPercent);

  const th: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    textAlign: 'left' as const,
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
    position: 'sticky' as const,
    top: 0,
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
  };

  function tdStyle(align: 'left' | 'right' = 'left'): React.CSSProperties {
    return {
      padding: '0.5rem 0.75rem',
      fontSize: '0.8rem',
      textAlign: align,
      whiteSpace: 'nowrap',
      borderBottom: `1px solid ${isDark ? '#1e293b' : '#f1f5f9'}`,
      transition: 'background-color 0.3s ease',
    };
  }

  function pnlColor(val: number) {
    if (val > 0) return isDark ? '#4ade80' : '#16a34a';
    if (val < 0) return isDark ? '#f87171' : '#dc2626';
    return 'var(--text-muted)';
  }

  function signalStyle(sig: AgentSnapshot['currentSignal']): React.CSSProperties {
    const colors: Record<string, string> = {
      BUY:  isDark ? '#4ade80' : '#16a34a',
      SELL: isDark ? '#f87171' : '#dc2626',
      HOLD: 'var(--text-muted)',
    };
    return {
      padding: '0.1rem 0.45rem',
      borderRadius: '0.25rem',
      fontSize: '0.7rem',
      fontWeight: 700,
      color: sig ? colors[sig] : 'var(--text-muted)',
      backgroundColor: sig ? `${colors[sig]}18` : 'transparent',
    };
  }

  function sentimentStyle(s: AgentSnapshot['currentSentiment']): React.CSSProperties {
    const colors: Record<string, string> = {
      BULL:    isDark ? '#4ade80' : '#16a34a',
      BEAR:    isDark ? '#f87171' : '#dc2626',
      NEUTRAL: 'var(--text-muted)',
    };
    return {
      fontSize: '0.78rem',
      fontWeight: 600,
      color: s ? colors[s] : 'var(--text-muted)',
    };
  }

  if (sorted.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>
        No agent data yet. Waiting for first snapshot...
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Agent</th>
            <th style={th}>Type</th>
            <th style={th}>Risk</th>
            <th style={{ ...th, textAlign: 'right' }}>Portfolio</th>
            <th style={{ ...th, textAlign: 'right' }}>P&amp;L</th>
            <th style={{ ...th, textAlign: 'right' }}>Win%</th>
            <th style={{ ...th, textAlign: 'right' }}>Sharpe</th>
            <th style={{ ...th, textAlign: 'right' }}>Max DD</th>
            <th style={th}>Signal</th>
            <th style={th}>Sentiment</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.agentId} style={{ transition: 'all 0.3s ease' }}>
              <td style={tdStyle()}>{i + 1}</td>
              <td style={tdStyle()}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {a.agentId.slice(0, 12)}…
                </span>
              </td>
              <td style={tdStyle()}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.agentType}</span>
              </td>
              <td style={tdStyle()}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{a.riskProfile}</span>
              </td>
              <td style={tdStyle('right')}>{formatUsd(a.portfolioValueUsd)}</td>
              <td style={{ ...tdStyle('right'), color: pnlColor(a.pnlPercent) }}>
                <div>{formatPct(a.pnlPercent)}</div>
                <div style={{ fontSize: '0.7rem', color: pnlColor(a.pnlUsd) }}>
                  {formatUsd(a.pnlUsd)}
                </div>
              </td>
              <td style={{ ...tdStyle('right'), color: pnlColor(a.winRate * 100 - 50) }}>
                {a.tradeCount > 0 ? `${(a.winRate * 100).toFixed(1)}%` : '—'}
              </td>
              <td style={{ ...tdStyle('right'), color: 'var(--text-muted)' }}>
                {a.sharpeRatio !== null ? a.sharpeRatio.toFixed(2) : '—'}
              </td>
              <td style={{ ...tdStyle('right'), color: a.maxDrawdownPercent > 0 ? (isDark ? '#f87171' : '#dc2626') : 'var(--text-muted)' }}>
                {a.maxDrawdownPercent > 0 ? `${a.maxDrawdownPercent.toFixed(1)}%` : '—'}
              </td>
              <td style={tdStyle()}>
                <span style={signalStyle(a.currentSignal)}>
                  {a.currentSignal ?? '—'}
                </span>
              </td>
              <td style={tdStyle()}>
                <span style={sentimentStyle(a.currentSentiment)}>
                  {a.currentSentiment ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Elapsed live clock ────────────────────────────────────────────────────────

function ElapsedClock({ tournament }: { tournament: Tournament }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (tournament.status !== 'RUNNING') return;
    const id = setInterval(() => setTick(t => t + 1), 1_000);
    return () => clearInterval(id);
  }, [tournament.status]);

  const base = tournament.totalElapsedMs;
  const live  = tournament.status === 'RUNNING' && tournament.startedAt
    ? base + (Date.now() - new Date(tournament.startedAt).getTime()) - base
    : base;

  void tick; // trigger re-render on tick

  return <span>{formatElapsed(tournament.status === 'RUNNING' ? (Date.now() - new Date(tournament.startedAt!).getTime()) : base)}</span>;
}

// ── Tournament List Item ──────────────────────────────────────────────────────

function TournamentListItem({
  tournament,
  isSelected,
  isDark,
  onClick,
}: {
  tournament: Tournament;
  isSelected: boolean;
  isDark: boolean;
  onClick: () => void;
}) {
  const c = statusColors(tournament.status, isDark);

  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '0.75rem 1rem',
        border: 'none',
        borderBottom: `1px solid ${isDark ? '#1e293b' : '#f1f5f9'}`,
        borderLeft: isSelected
          ? `3px solid ${isDark ? '#60a5fa' : '#3b82f6'}`
          : `3px solid transparent`,
        backgroundColor: isSelected
          ? (isDark ? '#1e293b' : '#eff6ff')
          : 'transparent',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
    >
      {/* Name + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <span
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={tournament.name}
        >
          {tournament.name}
        </span>
        <span
          style={{
            padding: '0.1rem 0.45rem',
            borderRadius: '999px',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            backgroundColor: c.bg,
            color: c.text,
            border: `1px solid ${c.border}`,
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          {tournament.status === 'RUNNING' && <PulseDot isDark={isDark} />}
          {tournament.status}
        </span>
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span>{tournament.agents.length} agent{tournament.agents.length !== 1 ? 's' : ''}</span>
        <span>
          <ElapsedClock tournament={tournament} />
        </span>
        {tournament.generationNumber !== null && (
          <span>Gen {tournament.generationNumber}</span>
        )}
        {tournament.progress > 0 && tournament.status === 'RUNNING' && (
          <span>{tournament.progress}%</span>
        )}
      </div>
    </button>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function TournamentDetail({
  tournament,
  isDark,
  onRefresh,
}: {
  tournament: Tournament;
  isDark: boolean;
  onRefresh: () => void;
}) {
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'stop' | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  /** Live indicator: SSE connected. */
  const [sseConnected, setSseConnected] = useState(false);
  /** Fall back to polling when SSE fails. */
  const [usingPollFallback, setUsingPollFallback] = useState(false);
  const [localAgents, setLocalAgents] = useState<AgentSnapshot[]>(tournament.agents);
  const [localStatus, setLocalStatus] = useState<TournamentStatus>(tournament.status);
  const [localProgress, setLocalProgress] = useState(tournament.progress);

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep local state in sync when parent tournament changes (list selection switch)
  useEffect(() => {
    setLocalAgents(tournament.agents);
    setLocalStatus(tournament.status);
    setLocalProgress(tournament.progress);
    setActionMsg(null);
    setShowStopConfirm(false);
  }, [tournament.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SSE / polling wiring ──────────────────────────────────────────────────

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const t = await tournamentApi.getById(tournament.id);
        setLocalAgents(t.agents);
        setLocalStatus(t.status);
        setLocalProgress(t.progress);
        if (isTerminal(t.status)) {
          stopPoll();
          onRefresh();
        }
      } catch {
        // Ignore transient poll failures
      }
    }, POLL_INTERVAL_MS);
  }, [tournament.id, stopPoll, onRefresh]);

  const stopSse = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setSseConnected(false);
    }
  }, []);

  useEffect(() => {
    if (isTerminal(localStatus)) {
      stopSse();
      stopPoll();
      return;
    }

    // Open SSE stream
    const es = tournamentApi.streamStats(
      tournament.id,
      (evt: TournamentStatsEvent) => {
        setSseConnected(true);
        setUsingPollFallback(false);
        setLocalAgents(evt.agents);
        setLocalStatus(evt.status);
        setLocalProgress(evt.progress);
        if (isTerminal(evt.status)) {
          stopSse();
          stopPoll();
          onRefresh();
        }
      },
      (evt: TournamentStatusEvent) => {
        setLocalStatus(evt.status);
        if (isTerminal(evt.status)) {
          stopSse();
          stopPoll();
          onRefresh();
        }
      },
      () => {
        // SSE connection failed — fall back to polling
        setSseConnected(false);
        setUsingPollFallback(true);
        stopSse();
        startPoll();
      },
    );

    esRef.current = es;

    return () => {
      stopSse();
      stopPoll();
    };
  }, [tournament.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Control actions ───────────────────────────────────────────────────────

  async function handleAction(action: 'pause' | 'resume' | 'stop') {
    if (pendingAction) return;
    setPendingAction(action);
    setActionMsg(null);
    try {
      let result: { message: string };
      if (action === 'pause')  result = await tournamentApi.pause(tournament.id);
      else if (action === 'resume') result = await tournamentApi.resume(tournament.id);
      else result = await tournamentApi.stop(tournament.id);

      setActionMsg({ ok: true, text: result.message });
      onRefresh();
    } catch (err) {
      const msg = err instanceof TournamentApiError ? err.message : String(err);
      setActionMsg({ ok: false, text: msg });
    } finally {
      setPendingAction(null);
      setShowStopConfirm(false);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    borderRadius: '0.5rem',
    border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
    padding: '1.25rem',
    marginBottom: '1rem',
  };

  const btnBase: React.CSSProperties = {
    padding: '0.45rem 1rem',
    borderRadius: '0.375rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: pendingAction ? 'not-allowed' : 'pointer',
    opacity: pendingAction ? 0.6 : 1,
    border: 'none',
    transition: 'opacity 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    whiteSpace: 'nowrap' as const,
  };

  const liveIndicator = usingPollFallback
    ? { color: isDark ? '#94a3b8' : '#64748b', label: '○ Polling' }
    : sseConnected
      ? { color: isDark ? '#4ade80' : '#16a34a', label: '● LIVE' }
      : { color: isDark ? '#94a3b8' : '#64748b', label: '○ Connecting…' };

  const merged: Tournament = { ...tournament, agents: localAgents, status: localStatus, progress: localProgress };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '1rem' }}>
      {/* Header card */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.35rem', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
              {tournament.name}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <StatusBadge status={localStatus} isDark={isDark} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <ElapsedClock tournament={merged} />
              </span>
              {localProgress > 0 && localStatus === 'RUNNING' && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {localProgress}% complete
                </span>
              )}
              {tournament.generationNumber !== null && (
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Generation {tournament.generationNumber}
                </span>
              )}
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: liveIndicator.color }}>
                {liveIndicator.label}
              </span>
            </div>
          </div>
        </div>

        {/* Coins */}
        {tournament.coinsUnderAnalysis.length > 0 && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {tournament.coinsUnderAnalysis.map(s => (
              <CoinPill key={s} symbol={s} isDark={isDark} />
            ))}
          </div>
        )}

        {/* Progress bar */}
        {localStatus === 'RUNNING' && localProgress > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{
              height: '4px',
              borderRadius: '2px',
              backgroundColor: isDark ? '#1e293b' : '#e2e8f0',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${localProgress}%`,
                height: '100%',
                backgroundColor: isDark ? '#60a5fa' : '#3b82f6',
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      {isControllable(localStatus) && (
        <div style={{ ...card, padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {localStatus === 'RUNNING' && (
              <button
                style={{ ...btnBase, backgroundColor: isDark ? '#713f12' : '#fef3c7', color: isDark ? '#fde047' : '#92400e' }}
                onClick={() => handleAction('pause')}
                disabled={!!pendingAction}
              >
                {pendingAction === 'pause' ? '⏳' : '⏸'} Pause
              </button>
            )}

            {localStatus === 'PAUSED' && (
              <button
                style={{ ...btnBase, backgroundColor: isDark ? '#14532d' : '#dcfce7', color: isDark ? '#4ade80' : '#166534' }}
                onClick={() => handleAction('resume')}
                disabled={!!pendingAction}
              >
                {pendingAction === 'resume' ? '⏳' : '▶'} Resume
              </button>
            )}

            {(localStatus === 'RUNNING' || localStatus === 'PAUSED') && (
              <>
                {showStopConfirm ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: isDark ? '#f87171' : '#dc2626', fontWeight: 600 }}>
                      Are you sure? This cannot be undone.
                    </span>
                    <button
                      style={{ ...btnBase, backgroundColor: isDark ? '#450a0a' : '#fee2e2', color: isDark ? '#f87171' : '#dc2626' }}
                      onClick={() => handleAction('stop')}
                      disabled={!!pendingAction}
                    >
                      {pendingAction === 'stop' ? '⏳' : '⏹'} Confirm Stop
                    </button>
                    <button
                      style={{ ...btnBase, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: 'var(--text-muted)' }}
                      onClick={() => setShowStopConfirm(false)}
                      disabled={!!pendingAction}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    style={{ ...btnBase, backgroundColor: isDark ? '#450a0a' : '#fee2e2', color: isDark ? '#f87171' : '#dc2626' }}
                    onClick={() => setShowStopConfirm(true)}
                    disabled={!!pendingAction}
                  >
                    ⏹ Stop
                  </button>
                )}
              </>
            )}

            {localStatus === 'QUEUED' && (
              <>
                {showStopConfirm ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', color: isDark ? '#f87171' : '#dc2626', fontWeight: 600 }}>
                      Are you sure? This cannot be undone.
                    </span>
                    <button
                      style={{ ...btnBase, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: 'var(--text-muted)' }}
                      onClick={() => handleAction('stop')}
                      disabled={!!pendingAction}
                    >
                      {pendingAction === 'stop' ? '⏳' : '✕'} Confirm Cancel
                    </button>
                    <button
                      style={{ ...btnBase, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: 'var(--text-muted)' }}
                      onClick={() => setShowStopConfirm(false)}
                      disabled={!!pendingAction}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    style={{ ...btnBase, backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: 'var(--text-muted)' }}
                    onClick={() => setShowStopConfirm(true)}
                    disabled={!!pendingAction}
                  >
                    ✕ Cancel
                  </button>
                )}
              </>
            )}
          </div>

          {actionMsg && (
            <div style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '0.375rem',
              fontSize: '0.78rem',
              fontWeight: 500,
              backgroundColor: actionMsg.ok
                ? (isDark ? '#14532d' : '#dcfce7')
                : (isDark ? '#450a0a' : '#fee2e2'),
              color: actionMsg.ok
                ? (isDark ? '#86efac' : '#166534')
                : (isDark ? '#fca5a5' : '#dc2626'),
            }}>
              {actionMsg.text}
            </div>
          )}
        </div>
      )}

      {/* Agent leaderboard */}
      <div style={card}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
          Agent Leaderboard
        </h3>
        <AgentLeaderboard agents={localAgents} isDark={isDark} />
      </div>

      {/* Error message */}
      {tournament.errorMessage && (
        <div style={{
          ...card,
          backgroundColor: isDark ? '#450a0a' : '#fee2e2',
          border: `1px solid ${isDark ? '#991b1b' : '#fca5a5'}`,
          color: isDark ? '#fca5a5' : '#dc2626',
          fontSize: '0.85rem',
        }}>
          <strong>Error:</strong> {tournament.errorMessage}
        </div>
      )}
    </div>
  );
}

// ── Skeleton list ─────────────────────────────────────────────────────────────

function TournamentListSkeleton() {
  return (
    <div style={{ padding: '0.75rem 1rem' }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ marginBottom: '1rem' }}>
          <SkeletonBar width="80%" height="0.85rem" />
          <div style={{ marginTop: '0.35rem', display: 'flex', gap: '0.5rem' }}>
            <SkeletonBar width="4rem" height="0.7rem" />
            <SkeletonBar width="3rem" height="0.7rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Skeleton detail ───────────────────────────────────────────────────────────

function TournamentDetailSkeleton({ isDark }: { isDark: boolean }) {
  const card: React.CSSProperties = {
    borderRadius: '0.5rem',
    border: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
    padding: '1.25rem',
    marginBottom: '1rem',
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
  };
  return (
    <div style={{ padding: '1rem' }}>
      <div style={card}>
        <SkeletonBar width="60%" height="1rem" />
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
          <SkeletonBar width="5rem" height="0.7rem" />
          <SkeletonBar width="4rem" height="0.7rem" />
        </div>
      </div>
      <div style={card}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ marginBottom: '0.75rem', display: 'flex', gap: '1rem' }}>
            <SkeletonBar width="20%" height="0.75rem" />
            <SkeletonBar width="15%" height="0.75rem" />
            <SkeletonBar width="15%" height="0.75rem" />
            <SkeletonBar width="15%" height="0.75rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sort order ────────────────────────────────────────────────────────────────

function sortOrder(s: TournamentStatus): number {
  const order: Record<TournamentStatus, number> = {
    RUNNING: 0, PAUSED: 1, QUEUED: 2, COMPLETED: 3, STOPPED: 4, ERROR: 5,
  };
  return order[s] ?? 99;
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * TournamentMonitor — two-panel tab showing all tournaments with live stats
 * and lifecycle controls (pause / resume / stop).
 *
 * @param isDark - Passed from App so colours stay consistent with the global theme.
 */
export default function TournamentMonitor({ isDark }: { isDark: boolean }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Responsive breakpoint ───────────────────────────────────────────────

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Data loading ────────────────────────────────────────────────────────

  const fetchTournaments = useCallback(async () => {
    try {
      const data = await tournamentApi.getAll();
      const sorted = [...data].sort((a, b) => sortOrder(a.status) - sortOrder(b.status));
      setTournaments(sorted);
      setListError(null);
    } catch (err) {
      setListError(err instanceof TournamentApiError ? err.message : 'Failed to load tournaments');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + periodic list refresh
  useEffect(() => {
    fetchTournaments();
    refreshRef.current = setInterval(fetchTournaments, LIST_REFRESH_MS);
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [fetchTournaments]);

  // Auto-select first tournament when list loads
  useEffect(() => {
    if (!selectedId && tournaments.length > 0) {
      setSelectedId(tournaments[0].id);
    }
  }, [tournaments, selectedId]);

  const selectedTournament = tournaments.find(t => t.id === selectedId) ?? null;

  // ── Styles ──────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    height: isMobile ? 'auto' : 'calc(100vh - 3.5rem)',
    overflow: 'hidden',
    backgroundColor: isDark ? '#0a0f1e' : '#f8fafc',
  };

  const listPanelStyle: React.CSSProperties = {
    width: isMobile ? '100%' : '35%',
    minWidth: isMobile ? 'auto' : '240px',
    maxWidth: isMobile ? 'none' : '380px',
    borderRight: isMobile ? 'none' : `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
    borderBottom: isMobile ? `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}` : 'none',
    overflowY: isMobile ? 'visible' : 'auto',
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
    flexShrink: 0,
  };

  const detailPanelStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    backgroundColor: isDark ? '#0a0f1e' : '#f8fafc',
    minHeight: isMobile ? '60vh' : 'auto',
  };

  const listHeaderStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${isDark ? '#1e293b' : '#e2e8f0'}`,
    fontSize: '0.8rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    position: 'sticky' as const,
    top: 0,
    backgroundColor: isDark ? '#0f172a' : '#ffffff',
    zIndex: 1,
  };

  return (
    <>
      {/* Injected CSS for animations */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .tournament-list-item:hover {
          background-color: ${isDark ? '#1e293b' : '#f8fafc'} !important;
        }
      `}</style>

      <div style={containerStyle}>
        {/* ── Left panel: tournament list ────────────────────────────────── */}
        <div style={listPanelStyle}>
          <div style={listHeaderStyle}>
            Tournaments
            {!loading && (
              <span style={{ marginLeft: '0.5rem', fontWeight: 400, fontSize: '0.72rem' }}>
                ({tournaments.length})
              </span>
            )}
          </div>

          {loading && <TournamentListSkeleton />}

          {!loading && listError && (
            <div style={{ padding: '1rem', color: isDark ? '#f87171' : '#dc2626', fontSize: '0.82rem' }}>
              {listError}
            </div>
          )}

          {!loading && !listError && tournaments.length === 0 && (
            <div style={{ padding: '1.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.5 }}>
              No tournaments found.<br />
              Start a competition from the <strong>MARL Competition</strong> tab.
            </div>
          )}

          {!loading && tournaments.map(t => (
            <TournamentListItem
              key={t.id}
              tournament={t}
              isSelected={t.id === selectedId}
              isDark={isDark}
              onClick={() => setSelectedId(t.id)}
            />
          ))}
        </div>

        {/* ── Right panel: tournament detail ─────────────────────────────── */}
        <div style={detailPanelStyle}>
          {loading && !selectedTournament && (
            <TournamentDetailSkeleton isDark={isDark} />
          )}

          {!loading && !selectedTournament && tournaments.length > 0 && (
            <div style={{ padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Select a tournament from the list.
            </div>
          )}

          {selectedTournament && (
            <TournamentDetail
              key={selectedTournament.id}
              tournament={selectedTournament}
              isDark={isDark}
              onRefresh={fetchTournaments}
            />
          )}
        </div>
      </div>
    </>
  );
}
