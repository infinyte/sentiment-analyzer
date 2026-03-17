import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import { useMarlCompetition } from '../hooks/useMarlCompetition';
import type { CompetitionConfig, CompetitionAgent as CompetitionAgentSpec } from '../types/marl';

type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
type CompetitionMode = 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';

// ─── Style constants ─────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: '0.75rem',
  padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: '1rem',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: '600',
  color: '#6b7280',
  marginBottom: '0.25rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
};

const btn = (color = '#2563eb'): React.CSSProperties => ({
  padding: '0.5rem 1.25rem',
  backgroundColor: color,
  color: '#fff',
  border: 'none',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: '600',
  cursor: 'pointer',
});

const RISK_COLORS: Record<RiskProfile, string> = {
  CONSERVATIVE: '#16a34a',
  AGGRESSIVE:   '#dc2626',
  SCALPING:     '#d97706',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AGENT_CHART_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#6366f1',
];

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmt(n)}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentRow({
  agent,
  index,
  onRemove,
  onChange,
}: {
  agent: CompetitionAgentSpec;
  index: number;
  onRemove: () => void;
  onChange: (updated: CompetitionAgentSpec) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
      <input
        style={{ ...input, flex: 2 }}
        value={agent.id}
        placeholder="Agent ID"
        onChange={e => onChange({ ...agent, id: e.target.value })}
      />
      <select
        style={{ ...input, flex: 1 }}
        value={agent.riskProfile}
        onChange={e => onChange({ ...agent, riskProfile: e.target.value as RiskProfile })}
      >
        <option value="CONSERVATIVE">Conservative</option>
        <option value="AGGRESSIVE">Aggressive</option>
        <option value="SCALPING">Scalping</option>
      </select>
      {index > 1 && (
        <button onClick={onRemove} style={{ ...btn('#6b7280'), padding: '0.5rem 0.75rem' }}>
          ✕
        </button>
      )}
    </div>
  );
}

function RankingsTable({ rankings }: { rankings: import('../types/marl').FinalRanking[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ backgroundColor: '#f9fafb', textAlign: 'left' }}>
            {['Rank', 'Agent', 'Final Capital', 'Return', 'Sharpe', 'Max DD', 'Trades', 'Win Rate'].map(h => (
              <th key={h} style={{ padding: '0.5rem 0.75rem', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rankings.map(r => (
            <tr key={r.agentId} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.5rem 0.75rem', fontWeight: '700', color: r.rank === 1 ? '#d97706' : '#374151' }}>#{r.rank}</td>
              <td style={{ padding: '0.5rem 0.75rem', fontWeight: '500' }}>{r.agentId}</td>
              <td style={{ padding: '0.5rem 0.75rem' }}>${r.finalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
              <td style={{ padding: '0.5rem 0.75rem', color: r.totalReturn >= 0 ? '#16a34a' : '#dc2626', fontWeight: '600' }}>{pct(r.totalReturn)}</td>
              <td style={{ padding: '0.5rem 0.75rem' }}>{fmt(r.sharpeRatio, 3)}</td>
              <td style={{ padding: '0.5rem 0.75rem', color: '#dc2626' }}>{fmt(r.maxDrawdown)}%</td>
              <td style={{ padding: '0.5rem 0.75rem' }}>{r.tradesExecuted}</td>
              <td style={{ padding: '0.5rem 0.75rem' }}>{fmt(r.winRate, 1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MarlCompetitionViewer() {
  const {
    loading, competitionId, status, results, compareResult, list,
    error, startCompetition, compareAgents, loadList, reset,
  } = useMarlCompetition();

  // ── Form state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CompetitionMode>('SINGLE');
  const [agents, setAgents] = useState<CompetitionAgentSpec[]>([
    { id: 'bull', riskProfile: 'AGGRESSIVE' },
    { id: 'bear', riskProfile: 'CONSERVATIVE' },
  ]);
  const [symbolInput, setSymbolInput] = useState('BTC,ETH');
  const [duration, setDuration] = useState(200);
  const [evolutionaryRounds, setEvolutionaryRounds] = useState(3);
  const [learningEnabled, setLearningEnabled] = useState(true);

  // ── Compare form state ────────────────────────────────────────────────────
  const [showCompare, setShowCompare] = useState(false);
  const [cmpA, setCmpA] = useState<CompetitionAgentSpec>({ id: 'aggressive', riskProfile: 'AGGRESSIVE' });
  const [cmpB, setCmpB] = useState<CompetitionAgentSpec>({ id: 'conservative', riskProfile: 'CONSERVATIVE' });
  const [cmpRounds, setCmpRounds] = useState(3);
  const [cmpDuration, setCmpDuration] = useState(100);

  useEffect(() => { loadList(); }, [loadList]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const symbols = symbolInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const config: CompetitionConfig = {
      mode,
      agents,
      symbols,
      duration,
      refreshInterval: 1000,
      evolutionaryRounds: mode === 'EVOLUTIONARY' ? evolutionaryRounds : undefined,
      learningEnabled,
    };
    startCompetition(config);
  };

  const handleCompare = (e: React.FormEvent) => {
    e.preventDefault();
    const symbols = symbolInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    compareAgents(cmpA, cmpB, symbols, cmpRounds, cmpDuration);
  };

  const addAgent = () => {
    if (agents.length < 10) {
      setAgents([...agents, { id: `agent_${agents.length + 1}`, riskProfile: 'CONSERVATIVE' }]);
    }
  };

  // ── Equity evolution chart ────────────────────────────────────────────────
  const chartData = results?.equityEvolution.length
    ? (() => {
        const agentIds = results.equityEvolution[0].agentEquities.map(ae => ae.agentId);
        const labels = results.equityEvolution.map((_, i) => `Step ${i + 1}`);
        return {
          labels,
          datasets: agentIds.map((id, i) => ({
            label: id,
            data: results.equityEvolution.map(snap =>
              snap.agentEquities.find(ae => ae.agentId === id)?.equity ?? 0
            ),
            borderColor: AGENT_CHART_COLORS[i % AGENT_CHART_COLORS.length],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
          })),
        };
      })()
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', fontWeight: '700' }}>
          MARL Competition
        </h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          Multi-Agent Reinforcement Learning competitive trading tournament
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ ...card, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
          {error}
          <button onClick={reset} style={{ marginLeft: '1rem', ...btn('#dc2626'), padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Running status */}
      {loading && status?.status === 'RUNNING' && (
        <div style={{ ...card, backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: '600', color: '#1d4ed8' }}>Competition running…</span>
            <code style={{ fontSize: '0.75rem', color: '#6b7280' }}>{competitionId}</code>
          </div>
          <div style={{ background: '#dbeafe', borderRadius: '0.25rem', height: '8px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${status.progress}%`,
                backgroundColor: '#2563eb',
                transition: 'width 0.5s ease',
                borderRadius: '0.25rem',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
            <span>{status.progress}% complete</span>
            {status.topPerformer && <span>Leading: {status.topPerformer}</span>}
          </div>
        </div>
      )}

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '2px solid #e5e7eb', paddingBottom: '0' }}>
        {[['Tournament', false], ['Head-to-Head', true]].map(([label, isCompare]) => (
          <button
            key={String(label)}
            onClick={() => setShowCompare(isCompare as boolean)}
            style={{
              padding: '0.5rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: showCompare === isCompare ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              color: showCompare === isCompare ? '#2563eb' : '#6b7280',
              fontWeight: showCompare === isCompare ? '700' : '400',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tournament form ────────────────────────────────────────────────── */}
      {!showCompare && !loading && !results && (
        <form onSubmit={handleSubmit}>
          <div style={card}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Configure Tournament</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={label}>Mode</label>
                <select style={input} value={mode} onChange={e => setMode(e.target.value as CompetitionMode)}>
                  <option value="SINGLE">Single Tournament</option>
                  <option value="EVOLUTIONARY">Evolutionary (Multi-Round)</option>
                  <option value="CONTINUOUS">Continuous Learning</option>
                </select>
              </div>
              <div>
                <label style={label}>Symbols (comma-separated)</label>
                <input style={input} value={symbolInput} onChange={e => setSymbolInput(e.target.value)} placeholder="BTC,ETH,SOL" />
              </div>
              <div>
                <label style={label}>Duration (steps)</label>
                <input type="number" style={input} value={duration} min={50} max={100000}
                  onChange={e => setDuration(Number(e.target.value))} />
              </div>
              {mode === 'EVOLUTIONARY' && (
                <div>
                  <label style={label}>Evolutionary Rounds</label>
                  <input type="number" style={input} value={evolutionaryRounds} min={1} max={10}
                    onChange={e => setEvolutionaryRounds(Number(e.target.value))} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="learning" checked={learningEnabled}
                  onChange={e => setLearningEnabled(e.target.checked)} />
                <label htmlFor="learning" style={{ ...label, marginBottom: 0 }}>Q-Learning Enabled</label>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={label}>Agents ({agents.length})</label>
                <button type="button" onClick={addAgent} style={{ ...btn('#6b7280'), fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>
                  + Add Agent
                </button>
              </div>
              {agents.map((agent, i) => (
                <AgentRow
                  key={i}
                  agent={agent}
                  index={i}
                  onRemove={() => setAgents(agents.filter((_, j) => j !== i))}
                  onChange={updated => setAgents(agents.map((a, j) => j === i ? updated : a))}
                />
              ))}
            </div>

            {/* Risk profile legend */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#6b7280' }}>
              {(Object.entries(RISK_COLORS) as [RiskProfile, string][]).map(([p, c]) => (
                <span key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: c, display: 'inline-block' }} />
                  {p}
                </span>
              ))}
            </div>

            <button type="submit" style={btn()}>
              Start Tournament
            </button>
          </div>
        </form>
      )}

      {/* ── Head-to-Head compare form ─────────────────────────────────────── */}
      {showCompare && !loading && !compareResult && (
        <form onSubmit={handleCompare}>
          <div style={card}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Head-to-Head Comparison</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              {([['Agent A', cmpA, setCmpA], ['Agent B', cmpB, setCmpB]] as const).map(([title, val, set]) => (
                <div key={title}>
                  <label style={label}>{title}</label>
                  <input style={{ ...input, marginBottom: '0.5rem' }} value={val.id}
                    onChange={e => set({ ...val, id: e.target.value })} placeholder="Agent ID" />
                  <select style={input} value={val.riskProfile}
                    onChange={e => set({ ...val, riskProfile: e.target.value as RiskProfile })}>
                    <option value="CONSERVATIVE">Conservative</option>
                    <option value="AGGRESSIVE">Aggressive</option>
                    <option value="SCALPING">Scalping</option>
                  </select>
                </div>
              ))}
              <div>
                <label style={label}>Rounds</label>
                <input type="number" style={input} value={cmpRounds} min={1} max={10}
                  onChange={e => setCmpRounds(Number(e.target.value))} />
              </div>
              <div>
                <label style={label}>Duration per Round (steps)</label>
                <input type="number" style={input} value={cmpDuration} min={50} max={10000}
                  onChange={e => setCmpDuration(Number(e.target.value))} />
              </div>
              <div>
                <label style={label}>Symbols</label>
                <input style={input} value={symbolInput} onChange={e => setSymbolInput(e.target.value)} />
              </div>
            </div>
            <button type="submit" style={btn()}>Compare Agents</button>
          </div>
        </form>
      )}

      {/* ── Compare results ───────────────────────────────────────────────── */}
      {compareResult && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Comparison: {compareResult.agent1} vs {compareResult.agent2}</h3>
            <button onClick={() => { reset(); }} style={btn('#6b7280')}>
              New Comparison
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            {[
              { title: 'Overall Winner', value: compareResult.overallWinner, big: true },
              { title: `${compareResult.agent1} Win Rate`, value: `${compareResult.agent1WinRate}%` },
              { title: `${compareResult.agent2} Win Rate`, value: `${compareResult.agent2WinRate}%` },
              { title: `${compareResult.agent1} Avg Return`, value: pct(compareResult.avgAgent1Return), color: compareResult.avgAgent1Return >= 0 ? '#16a34a' : '#dc2626' },
              { title: `${compareResult.agent2} Avg Return`, value: pct(compareResult.avgAgent2Return), color: compareResult.avgAgent2Return >= 0 ? '#16a34a' : '#dc2626' },
              { title: 'Rounds', value: String(compareResult.rounds) },
            ].map(m => (
              <div key={m.title} style={{ padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: '600', textTransform: 'uppercase' }}>{m.title}</div>
                <div style={{ fontSize: m.big ? '1.25rem' : '1rem', fontWeight: '700', color: m.color ?? '#111827', marginTop: '0.25rem' }}>{m.value}</div>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                {['Round', 'Winner', `${compareResult.agent1} Return`, `${compareResult.agent2} Return`].map(h => (
                  <th key={h} style={{ padding: '0.4rem 0.75rem', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compareResult.roundDetails.map(rd => (
                <tr key={rd.round} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.4rem 0.75rem' }}>{rd.round}</td>
                  <td style={{ padding: '0.4rem 0.75rem', fontWeight: '600' }}>{rd.winner}</td>
                  <td style={{ padding: '0.4rem 0.75rem', color: rd.agent1Return >= 0 ? '#16a34a' : '#dc2626' }}>{pct(rd.agent1Return)}</td>
                  <td style={{ padding: '0.4rem 0.75rem', color: rd.agent2Return >= 0 ? '#16a34a' : '#dc2626' }}>{pct(rd.agent2Return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tournament results ────────────────────────────────────────────── */}
      {results && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.25rem' }}>Tournament Results</h3>
              <code style={{ fontSize: '0.75rem', color: '#6b7280' }}>{results.competitionId}</code>
            </div>
            <button onClick={reset} style={btn('#6b7280')}>New Tournament</button>
          </div>

          {/* Rankings */}
          <div style={card}>
            <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
              Final Rankings
            </h4>
            <RankingsTable rankings={results.finalRankings} />
          </div>

          {/* Head-to-head */}
          {results.headToHeadMetrics.length > 0 && (
            <div style={card}>
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
                Head-to-Head
              </h4>
              {results.headToHeadMetrics.map(h => (
                <div key={`${h.agent1}-${h.agent2}`}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', borderBottom: '1px solid #f3f4f6', fontSize: '0.875rem' }}>
                  <span style={{ fontWeight: '500', color: h.winner === h.agent1 ? '#16a34a' : '#6b7280' }}>
                    {h.agent1} {pct(h.agent1Return)}
                  </span>
                  <span style={{ color: '#d97706', fontWeight: '700', fontSize: '0.75rem', alignSelf: 'center' }}>vs</span>
                  <span style={{ fontWeight: '500', color: h.winner === h.agent2 ? '#16a34a' : '#6b7280' }}>
                    {pct(h.agent2Return)} {h.agent2}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Competitor impact */}
          {results.competitorImpact.length > 0 && (
            <div style={card}>
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
                Market Impact
              </h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    {['Agent', 'Avg Slippage (bps)', 'Times Outbid', 'Times Outsold'].map(h => (
                      <th key={h} style={{ padding: '0.4rem 0.75rem', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.competitorImpact.map(c => (
                    <tr key={c.agentId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.4rem 0.75rem' }}>{c.agentId}</td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>{(c.averageLiquidityImpact * 10000).toFixed(1)}</td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>{c.timesOutbid}</td>
                      <td style={{ padding: '0.4rem 0.75rem' }}>{c.timesOutsold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Equity evolution chart */}
          {chartData && (
            <div style={card}>
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
                Equity Evolution
              </h4>
              <Line
                data={chartData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
                  scales: {
                    x: { display: true, grid: { display: false } },
                    y: { display: true, ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
                  },
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Past competitions ─────────────────────────────────────────────── */}
      {list && list.total > 0 && !results && !loading && (
        <div style={{ ...card, marginTop: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
            Past Competitions ({list.total})
          </h4>
          {list.competitions.slice(0, 5).map(c => (
            <div key={c.competitionId}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #f3f4f6', fontSize: '0.8125rem' }}>
              <div>
                <span style={{ fontWeight: '500' }}>{c.mode}</span>
                <span style={{ color: '#9ca3af', marginLeft: '0.5rem' }}>{c.symbols.join(', ')}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{
                  padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: '600',
                  backgroundColor: c.status === 'COMPLETED' ? '#dcfce7' : c.status === 'RUNNING' ? '#dbeafe' : '#fee2e2',
                  color: c.status === 'COMPLETED' ? '#16a34a' : c.status === 'RUNNING' ? '#2563eb' : '#dc2626',
                }}>
                  {c.status}
                </span>
                {c.topReturn && <span style={{ fontWeight: '600', color: '#16a34a' }}>{c.topReturn}</span>}
                <code style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{c.competitionId.slice(5, 18)}</code>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
