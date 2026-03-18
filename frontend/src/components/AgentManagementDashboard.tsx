import { useEffect, useState } from 'react';

type AgentSortKey = 'winRate' | 'pnl' | 'generation' | 'competitions';

interface AgentSummary {
  id: string;
  agent_type: string;
  risk_profile: string;
  status: string;
  custom_name: string | null;
  emoji: string | null;
  color: string | null;
  biography: string | null;
  nickname: string | null;
  age_iterations: number | null;
  generation_number: number | null;
  created_at: string | null;
  total_competitions: number;
  total_wins: number;
  total_losses: number;
  win_rate_percent: number;
  total_pnl: number;
  sharpe_ratio: number;
  roi_percent: number;
}

interface AgentStats {
  total_competitions: number;
  total_wins: number;
  total_losses: number;
  win_rate_percent: number;
  total_pnl: number;
  max_drawdown_percent: number;
  sharpe_ratio: number;
  roi_percent: number;
  trades_executed: number;
  consistency_score: number;
  avg_trade_profit: number;
}

interface AgentDetail extends Omit<AgentSummary, 'total_competitions' | 'total_wins' | 'total_losses' | 'win_rate_percent' | 'total_pnl' | 'sharpe_ratio' | 'roi_percent'> {
  stats: Partial<AgentStats>;
}

interface AgentHistoryEntry {
  competition_id: string;
  rank_position: number;
  starting_capital: number;
  ending_capital: number;
  pnl: number;
  trades_count: number;
  win_trades: number;
  loss_trades: number;
  largest_win: number;
  largest_loss: number;
  sharpe_ratio: number;
  completed_at: string;
}

interface AgentGenealogyEntry {
  id: string;
  agentId: string;
  parent1Id: string | null;
  parent2Id: string | null;
  breedingDate: string;
  breedingGeneration: number;
  inheritedGenes: unknown;
  mutationsApplied: unknown[];
  mutationSeverity: number;
  offspringCount: number;
}

interface AgentGenomeResponse {
  agentId: string;
  genome: unknown;
}

interface AgentGenealogyResponse {
  agentId: string;
  genealogy: AgentGenealogyEntry[];
}

interface AgentListResponse {
  agents: Array<Record<string, unknown>>;
}

interface CustomizationFormState {
  custom_name: string;
  emoji: string;
  color: string;
  biography: string;
  nickname: string;
}

const EMOJI_OPTIONS = ['🟢', '🔴', '🟡', '💎', '🔥', '⚡', '🌟', '🎯', '🚀', '🏆'];
const COLOR_OPTIONS = ['#00FF00', '#FF0000', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#800080', '#0099FF'];

const panelStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '1rem',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.06)',
};

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeAgentSummary(raw: Record<string, unknown>): AgentSummary {
  return {
    id: String(raw.id ?? ''),
    agent_type: String(raw.agent_type ?? 'UNKNOWN'),
    risk_profile: String(raw.risk_profile ?? 'UNKNOWN'),
    status: String(raw.status ?? 'UNKNOWN'),
    custom_name: toText(raw.custom_name),
    emoji: toText(raw.emoji),
    color: toText(raw.color),
    biography: toText(raw.biography),
    nickname: toText(raw.nickname),
    age_iterations: typeof raw.age_iterations === 'number' ? raw.age_iterations : null,
    generation_number: typeof raw.generation_number === 'number' ? raw.generation_number : null,
    created_at: toText(raw.created_at),
    total_competitions: toNumber(raw.total_competitions),
    total_wins: toNumber(raw.total_wins),
    total_losses: toNumber(raw.total_losses),
    win_rate_percent: toNumber(raw.win_rate_percent),
    total_pnl: toNumber(raw.total_pnl),
    sharpe_ratio: toNumber(raw.sharpe_ratio),
    roi_percent: toNumber(raw.roi_percent),
  };
}

function normalizeAgentDetail(raw: Record<string, unknown>): AgentDetail {
  const stats = typeof raw.stats === 'object' && raw.stats !== null ? raw.stats as Record<string, unknown> : {};

  return {
    id: String(raw.id ?? ''),
    agent_type: String(raw.agent_type ?? 'UNKNOWN'),
    risk_profile: String(raw.risk_profile ?? 'UNKNOWN'),
    status: String(raw.status ?? 'UNKNOWN'),
    custom_name: toText(raw.custom_name),
    emoji: toText(raw.emoji),
    color: toText(raw.color),
    biography: toText(raw.biography),
    nickname: toText(raw.nickname),
    age_iterations: typeof raw.age_iterations === 'number' ? raw.age_iterations : null,
    generation_number: typeof raw.generation_number === 'number' ? raw.generation_number : null,
    created_at: toText(raw.created_at),
    stats: {
      total_competitions: toNumber(stats.total_competitions),
      total_wins: toNumber(stats.total_wins),
      total_losses: toNumber(stats.total_losses),
      win_rate_percent: toNumber(stats.win_rate_percent),
      total_pnl: toNumber(stats.total_pnl),
      max_drawdown_percent: toNumber(stats.max_drawdown_percent),
      sharpe_ratio: toNumber(stats.sharpe_ratio),
      roi_percent: toNumber(stats.roi_percent),
      trades_executed: toNumber(stats.trades_executed),
      consistency_score: toNumber(stats.consistency_score),
      avg_trade_profit: toNumber(stats.avg_trade_profit),
    },
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return 'N/A';

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayName(agent: Pick<AgentSummary, 'emoji' | 'custom_name' | 'nickname' | 'id'> | Pick<AgentDetail, 'emoji' | 'custom_name' | 'nickname' | 'id'>): string {
  if (agent.custom_name) return `${agent.emoji ? `${agent.emoji} ` : ''}${agent.custom_name}`;
  if (agent.nickname) return `${agent.emoji ? `${agent.emoji} ` : ''}${agent.nickname}`;
  return `${agent.emoji ? `${agent.emoji} ` : ''}${agent.id.slice(0, 8)}`;
}

function buildCustomizationForm(agent: AgentDetail | null): CustomizationFormState {
  return {
    custom_name: agent?.custom_name ?? '',
    emoji: agent?.emoji ?? EMOJI_OPTIONS[0]!,
    color: agent?.color ?? COLOR_OPTIONS[0]!,
    biography: agent?.biography ?? '',
    nickname: agent?.nickname ?? '',
  };
}

interface CustomizationModalProps {
  agent: AgentDetail;
  formState: CustomizationFormState;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (patch: Partial<CustomizationFormState>) => void;
  onSave: () => void;
}

function CustomizationModal({ agent, formState, saving, error, onClose, onChange, onSave }: CustomizationModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${displayName(agent)}`}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        zIndex: 50,
      }}
    >
      <div style={{ ...panelStyle, width: '100%', maxWidth: '42rem', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>Customize Agent</h3>
            <p style={{ margin: '0.5rem 0 0', color: '#475569', fontSize: '0.95rem' }}>{displayName(agent)}</p>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: '1.5rem', cursor: 'pointer' }}
            aria-label="Close customization dialog"
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.25rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
            Custom name
            <input
              value={formState.custom_name}
              onChange={event => onChange({ custom_name: event.target.value })}
              style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
            Nickname
            <input
              value={formState.nickname}
              onChange={event => onChange({ nickname: event.target.value })}
              style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1rem' }}>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
              Emoji
              <select
                value={formState.emoji}
                onChange={event => onChange({ emoji: event.target.value })}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              >
                {EMOJI_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
              Accent color
              <select
                value={formState.color}
                onChange={event => onChange({ color: event.target.value })}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              >
                {COLOR_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
            Biography
            <textarea
              rows={5}
              value={formState.biography}
              onChange={event => onChange({ biography: event.target.value })}
              style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem', resize: 'vertical' }}
            />
          </label>

          {error && (
            <div role="alert" style={{ color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              style={{ padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '0.75rem',
                border: 'none',
                backgroundColor: saving ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                cursor: saving ? 'wait' : 'pointer',
                fontWeight: 700,
              }}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentManagementDashboard() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [leaderboard, setLeaderboard] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null);
  const [history, setHistory] = useState<AgentHistoryEntry[]>([]);
  const [genome, setGenome] = useState<AgentGenomeResponse | null>(null);
  const [genealogy, setGenealogy] = useState<AgentGenealogyEntry[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<AgentSortKey>('winRate');
  const [customizing, setCustomizing] = useState(false);
  const [customizationError, setCustomizationError] = useState<string | null>(null);
  const [customizationSaving, setCustomizationSaving] = useState(false);
  const [customizationForm, setCustomizationForm] = useState<CustomizationFormState>(buildCustomizationForm(null));
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        setLoadingOverview(true);
        setOverviewError(null);

        const [agentsResponse, leaderboardResponse] = await Promise.all([
          fetch('/api/agents?limit=100'),
          fetch('/api/agents/stats/leaderboard?limit=10'),
        ]);

        if (!agentsResponse.ok) throw new Error(`Failed to load agents: HTTP ${agentsResponse.status}`);
        if (!leaderboardResponse.ok) throw new Error(`Failed to load leaderboard: HTTP ${leaderboardResponse.status}`);

        const agentsData = await agentsResponse.json() as AgentListResponse;
        const leaderboardData = await leaderboardResponse.json() as Array<Record<string, unknown>>;

        const normalizedAgents = (agentsData.agents ?? []).map(normalizeAgentSummary);
        const normalizedLeaderboard = leaderboardData.map(normalizeAgentSummary);

        setAgents(normalizedAgents);
        setLeaderboard(normalizedLeaderboard);
        setSelectedAgentId(current => current ?? normalizedAgents[0]?.id ?? null);
      } catch (error) {
        setOverviewError(error instanceof Error ? error.message : 'Failed to load agent data');
      } finally {
        setLoadingOverview(false);
      }
    };

    void loadOverview();
  }, [refreshNonce]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSelectedAgent(null);
      setHistory([]);
      setGenome(null);
      setGenealogy([]);
      return;
    }

    const loadDetail = async () => {
      try {
        setLoadingDetail(true);
        setDetailError(null);

        const [detailResponse, historyResponse, genomeResponse, genealogyResponse] = await Promise.all([
          fetch(`/api/agents/${selectedAgentId}`),
          fetch(`/api/agents/${selectedAgentId}/history?limit=12`),
          fetch(`/api/agents/${selectedAgentId}/genome`),
          fetch(`/api/agents/${selectedAgentId}/genealogy`),
        ]);

        if (!detailResponse.ok) throw new Error(`Failed to load agent: HTTP ${detailResponse.status}`);

        const detailData = await detailResponse.json() as Record<string, unknown>;
        setSelectedAgent(normalizeAgentDetail(detailData));

        if (historyResponse.ok) {
          setHistory(await historyResponse.json() as AgentHistoryEntry[]);
        } else {
          setHistory([]);
        }

        if (genomeResponse.ok) {
          setGenome(await genomeResponse.json() as AgentGenomeResponse);
        } else {
          setGenome(null);
        }

        if (genealogyResponse.ok) {
          const genealogyData = await genealogyResponse.json() as AgentGenealogyResponse;
          setGenealogy(genealogyData.genealogy ?? []);
        } else {
          setGenealogy([]);
        }
      } catch (error) {
        setDetailError(error instanceof Error ? error.message : 'Failed to load agent detail');
      } finally {
        setLoadingDetail(false);
      }
    };

    void loadDetail();
  }, [selectedAgentId]);

  useEffect(() => {
    setCustomizationForm(buildCustomizationForm(selectedAgent));
  }, [selectedAgent]);

  const filteredAgents = [...agents]
    .filter(agent => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return true;

      const text = [
        agent.id,
        agent.custom_name ?? '',
        agent.nickname ?? '',
        agent.agent_type,
        agent.risk_profile,
      ].join(' ').toLowerCase();

      return text.includes(normalizedQuery);
    })
    .sort((left, right) => {
      if (sortKey === 'pnl') return right.total_pnl - left.total_pnl;
      if (sortKey === 'generation') return (right.generation_number ?? 0) - (left.generation_number ?? 0);
      if (sortKey === 'competitions') return right.total_competitions - left.total_competitions;
      return right.win_rate_percent - left.win_rate_percent;
    });

  const totalAgents = agents.length;
  const averageWinRate = totalAgents > 0 ? agents.reduce((sum, agent) => sum + agent.win_rate_percent, 0) / totalAgents : 0;
  const averageRoi = totalAgents > 0 ? agents.reduce((sum, agent) => sum + agent.roi_percent, 0) / totalAgents : 0;
  const totalPnl = agents.reduce((sum, agent) => sum + agent.total_pnl, 0);
  const topSharpe = agents.reduce((max, agent) => Math.max(max, agent.sharpe_ratio), 0);

  const handleRefresh = () => {
    setRefreshNonce(value => value + 1);
  };

  const openCustomization = () => {
    if (!selectedAgent) return;
    setCustomizationError(null);
    setCustomizationForm(buildCustomizationForm(selectedAgent));
    setCustomizing(true);
  };

  const saveCustomization = async () => {
    if (!selectedAgent) return;

    try {
      setCustomizationSaving(true);
      setCustomizationError(null);

      const response = await fetch(`/api/agents/${selectedAgent.id}/customize`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customizationForm),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(typeof errorData.error === 'string' ? errorData.error : `HTTP ${response.status}`);
      }

      setCustomizing(false);
      setRefreshNonce(value => value + 1);
      setSelectedAgentId(selectedAgent.id);
    } catch (error) {
      setCustomizationError(error instanceof Error ? error.message : 'Failed to save customization');
    } finally {
      setCustomizationSaving(false);
    }
  };

  return (
    <section style={{ padding: '1.5rem' }}>
      <style>{`
        .agent-dashboard-grid {
          display: grid;
          grid-template-columns: minmax(20rem, 28rem) minmax(0, 1fr);
          gap: 1.5rem;
          align-items: start;
        }

        .agent-overview-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
        }

        @media (max-width: 1100px) {
          .agent-dashboard-grid {
            grid-template-columns: 1fr;
          }

          .agent-overview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .agent-overview-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.75rem', color: '#0f172a' }}>Agent Management</h2>
          <p style={{ margin: '0.5rem 0 0', color: '#475569', maxWidth: '48rem', lineHeight: 1.6 }}>
            Monitor active evolutionary agents, compare performance, inspect genomes, and update cosmetics from the existing agent registry APIs.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.875rem',
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#0f172a',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Refresh data
        </button>
      </div>

      <div className="agent-overview-grid" style={{ marginTop: '1.5rem' }}>
        {[
          { label: 'Active agents', value: String(totalAgents), accent: '#0f766e' },
          { label: 'Average win rate', value: formatPercent(averageWinRate), accent: '#1d4ed8' },
          { label: 'Average ROI', value: formatPercent(averageRoi), accent: '#7c3aed' },
          { label: 'Population PnL', value: formatCurrency(totalPnl), accent: totalPnl >= 0 ? '#15803d' : '#b91c1c' },
        ].map(card => (
          <div key={card.label} style={{ ...panelStyle, padding: '1.1rem 1.2rem', borderTop: `4px solid ${card.accent}` }}>
            <div style={{ color: '#64748b', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{card.label}</div>
            <div style={{ marginTop: '0.55rem', fontSize: '1.7rem', fontWeight: 800, color: '#0f172a' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {overviewError && (
        <div role="alert" style={{ ...panelStyle, marginTop: '1rem', padding: '1rem', backgroundColor: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}>
          {overviewError}
        </div>
      )}

      <div className="agent-dashboard-grid" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ ...panelStyle, padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Agent Registry</h3>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{filteredAgents.length} visible</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 10rem', gap: '0.75rem', marginTop: '1rem' }}>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search agent, id, type, or profile"
                aria-label="Search agents"
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
              <select
                value={sortKey}
                onChange={event => setSortKey(event.target.value as AgentSortKey)}
                aria-label="Sort agents"
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              >
                <option value="winRate">Sort: win rate</option>
                <option value="pnl">Sort: pnl</option>
                <option value="generation">Sort: generation</option>
                <option value="competitions">Sort: competitions</option>
              </select>
            </div>

            <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem', maxHeight: '42rem', overflowY: 'auto' }}>
              {loadingOverview ? (
                <div style={{ color: '#64748b', padding: '0.75rem 0' }}>Loading agents...</div>
              ) : filteredAgents.length === 0 ? (
                <div style={{ color: '#64748b', padding: '0.75rem 0' }}>No active agents match the current filter.</div>
              ) : (
                filteredAgents.map(agent => {
                  const selected = agent.id === selectedAgentId;
                  const accent = agent.color ?? '#2563eb';

                  return (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      style={{
                        textAlign: 'left',
                        width: '100%',
                        padding: '0.95rem',
                        borderRadius: '0.95rem',
                        border: selected ? `2px solid ${accent}` : '1px solid #e2e8f0',
                        background: selected ? 'linear-gradient(135deg, rgba(219, 234, 254, 0.95), rgba(255, 255, 255, 1))' : '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem' }}>{displayName(agent)}</div>
                          <div style={{ marginTop: '0.25rem', color: '#64748b', fontSize: '0.85rem' }}>{agent.agent_type} · {agent.risk_profile}</div>
                        </div>
                        <span style={{ color: accent, fontWeight: 800 }}>{formatPercent(agent.win_rate_percent)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem', color: '#334155', fontSize: '0.85rem' }}>
                        <span>{agent.total_competitions} comps</span>
                        <span>{formatCurrency(agent.total_pnl)} pnl</span>
                        <span>Gen {agent.generation_number ?? 0}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={{ ...panelStyle, padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Leaderboard</h3>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Top by win rate</span>
            </div>
            <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
              {leaderboard.map((agent, index) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  style={{
                    textAlign: 'left',
                    width: '100%',
                    padding: '0.85rem 0.95rem',
                    borderRadius: '0.9rem',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>#{index + 1} {displayName(agent)}</div>
                    <div style={{ color: '#1d4ed8', fontWeight: 800 }}>{formatPercent(agent.win_rate_percent)}</div>
                  </div>
                  <div style={{ marginTop: '0.4rem', color: '#64748b', fontSize: '0.85rem' }}>
                    {formatCurrency(agent.total_pnl)} pnl · Sharpe {agent.sharpe_ratio.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ ...panelStyle, padding: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Population Signals</h3>
            <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.75rem', color: '#334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>Best sharpe ratio</span>
                <strong>{topSharpe.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>Positive PnL agents</span>
                <strong>{agents.filter(agent => agent.total_pnl > 0).length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>High-activity agents</span>
                <strong>{agents.filter(agent => agent.total_competitions >= 10).length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>Latest generation</span>
                <strong>{agents.reduce((max, agent) => Math.max(max, agent.generation_number ?? 0), 0)}</strong>
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...panelStyle, padding: '1.25rem' }}>
          {!selectedAgentId ? (
            <div style={{ color: '#64748b' }}>Select an agent to inspect its performance and genetics.</div>
          ) : loadingDetail && !selectedAgent ? (
            <div style={{ color: '#64748b' }}>Loading agent detail...</div>
          ) : detailError ? (
            <div role="alert" style={{ color: '#b91c1c' }}>{detailError}</div>
          ) : selectedAgent ? (
            <div style={{ display: 'grid', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>{displayName(selectedAgent)}</h3>
                    <span
                      style={{
                        padding: '0.3rem 0.6rem',
                        borderRadius: '999px',
                        backgroundColor: '#e0f2fe',
                        color: '#075985',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                      }}
                    >
                      {selectedAgent.status}
                    </span>
                  </div>
                  <p style={{ margin: '0.5rem 0 0', color: '#475569', lineHeight: 1.6 }}>
                    {selectedAgent.biography || 'No biography set for this agent.'}
                  </p>
                </div>
                <button
                  onClick={openCustomization}
                  style={{
                    alignSelf: 'start',
                    padding: '0.75rem 1rem',
                    borderRadius: '0.85rem',
                    border: 'none',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Customize
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.9rem' }}>
                {[
                  { label: 'Win rate', value: formatPercent(selectedAgent.stats.win_rate_percent ?? 0) },
                  { label: 'ROI', value: formatPercent(selectedAgent.stats.roi_percent ?? 0) },
                  { label: 'Sharpe', value: (selectedAgent.stats.sharpe_ratio ?? 0).toFixed(2) },
                  { label: 'Total PnL', value: formatCurrency(selectedAgent.stats.total_pnl ?? 0) },
                  { label: 'Drawdown', value: formatPercent(selectedAgent.stats.max_drawdown_percent ?? 0) },
                  { label: 'Trades', value: String(selectedAgent.stats.trades_executed ?? 0) },
                ].map(item => (
                  <div key={item.label} style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.95rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
                    <div style={{ marginTop: '0.45rem', color: '#0f172a', fontSize: '1.25rem', fontWeight: 800 }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.9rem' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.95rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Profile</div>
                  <div style={{ marginTop: '0.45rem', color: '#0f172a', fontWeight: 700 }}>{selectedAgent.agent_type}</div>
                  <div style={{ marginTop: '0.25rem', color: '#475569' }}>{selectedAgent.risk_profile}</div>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.95rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Lineage</div>
                  <div style={{ marginTop: '0.45rem', color: '#0f172a', fontWeight: 700 }}>Generation {selectedAgent.generation_number ?? 0}</div>
                  <div style={{ marginTop: '0.25rem', color: '#475569' }}>Age iterations: {selectedAgent.age_iterations ?? 0}</div>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.95rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Created</div>
                  <div style={{ marginTop: '0.45rem', color: '#0f172a', fontWeight: 700 }}>{formatDate(selectedAgent.created_at)}</div>
                  <div style={{ marginTop: '0.25rem', color: '#475569' }}>Nickname: {selectedAgent.nickname || 'N/A'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: '1rem' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
                  <h4 style={{ margin: 0, color: '#0f172a' }}>Recent Competition History</h4>
                  <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.75rem' }}>
                    {history.length === 0 ? (
                      <div style={{ color: '#64748b' }}>No competition history available.</div>
                    ) : history.map(entry => (
                      <div key={`${entry.competition_id}-${entry.completed_at}`} style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                          <strong style={{ color: '#0f172a' }}>#{entry.rank_position} · {entry.competition_id}</strong>
                          <span style={{ color: entry.pnl >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{formatCurrency(entry.pnl)}</span>
                        </div>
                        <div style={{ marginTop: '0.35rem', color: '#64748b', fontSize: '0.85rem' }}>
                          {entry.trades_count} trades · Sharpe {entry.sharpe_ratio.toFixed(2)} · {formatDate(entry.completed_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
                  <h4 style={{ margin: 0, color: '#0f172a' }}>Genealogy</h4>
                  <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.75rem' }}>
                    {genealogy.length === 0 ? (
                      <div style={{ color: '#64748b' }}>No genealogy records available.</div>
                    ) : genealogy.map(entry => (
                      <div key={entry.id} style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                        <div style={{ color: '#0f172a', fontWeight: 700 }}>Generation {entry.breedingGeneration}</div>
                        <div style={{ marginTop: '0.3rem', color: '#475569', fontSize: '0.9rem' }}>
                          Parents: {entry.parent1Id?.slice(0, 8) || 'N/A'} / {entry.parent2Id?.slice(0, 8) || 'N/A'}
                        </div>
                        <div style={{ marginTop: '0.3rem', color: '#64748b', fontSize: '0.85rem' }}>
                          Severity {entry.mutationSeverity} · Offspring {entry.offspringCount}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
                <h4 style={{ margin: 0, color: '#0f172a' }}>Genome Snapshot</h4>
                <pre
                  style={{
                    margin: '0.9rem 0 0',
                    padding: '1rem',
                    borderRadius: '0.9rem',
                    backgroundColor: '#0f172a',
                    color: '#e2e8f0',
                    overflowX: 'auto',
                    fontSize: '0.85rem',
                    lineHeight: 1.55,
                  }}
                >
                  {JSON.stringify(genome?.genome ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {customizing && selectedAgent && (
        <CustomizationModal
          agent={selectedAgent}
          formState={customizationForm}
          saving={customizationSaving}
          error={customizationError}
          onClose={() => setCustomizing(false)}
          onChange={patch => setCustomizationForm(current => ({ ...current, ...patch }))}
          onSave={saveCustomization}
        />
      )}
    </section>
  );
}