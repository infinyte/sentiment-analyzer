import { useEffect, useRef, useState } from 'react';

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

type BreedStrategy = 'UNIFORM' | 'BLENDED';
type BreedMutationSeverity = 'LIGHT' | 'MEDIUM' | 'HEAVY';

interface BreedResultChild {
  id: string;
  agentType: string;
  riskProfile: string;
  generationNumber: number;
  status: string;
  parent1Id: string | null;
  parent2Id: string | null;
  mutationsApplied: unknown[];
  mutationSeverity: BreedMutationSeverity;
}

interface BreedResponse {
  parentIds: string[];
  childCount: number;
  crossoverStrategy: BreedStrategy;
  mutationSeverity: BreedMutationSeverity;
  children: BreedResultChild[];
}

interface EvolutionaryTournamentSummary {
  tournamentId: string;
  name: string;
  status: string;
  currentGeneration: number;
  maxGenerations: number;
  populationSize: number;
  symbols: string[];
  startedAt: string;
  completedAt?: string;
  generationCount: number;
  latestTopFitness: number;
  latestAvgFitness: number;
  latestAvgPnl: number;
  latestSurvivalRate: number;
}

interface EvolutionaryTimelineEntry {
  generation: number;
  topFitness: number;
  avgFitness: number;
  avgPnl: number;
  survivalRate: number;
  populationCount: number;
  survivorCount: number;
  offspringCount: number;
  retiredCount: number;
  completedAt: string;
}

interface EvolutionarySummaryResponse {
  totals: {
    totalTournaments: number;
    completedTournaments: number;
    runningTournaments: number;
    failedTournaments: number;
    totalGenerations: number;
    averageTopFitness: number;
    averageGenerationFitness: number;
  };
  crossTournament: {
    bestTournament: {
      tournamentId: string;
      name: string;
      status: string;
      completedAt?: string;
      symbols: string[];
      generationCount: number;
      latestTopFitness: number;
      latestAvgFitness: number;
      latestAvgPnl: number;
      latestSurvivalRate: number;
    } | null;
    latestVsPrevious: {
      latestTournamentId: string;
      previousTournamentId: string;
      topFitnessDelta: number;
      avgFitnessDelta: number;
      generationCountDelta: number;
    } | null;
    recentPerformance: Array<{
      tournamentId: string;
      name: string;
      status: string;
      completedAt?: string;
      symbols: string[];
      generationCount: number;
      latestTopFitness: number;
      latestAvgFitness: number;
      latestAvgPnl: number;
      latestSurvivalRate: number;
    }>;
  };
  recentTournaments: EvolutionaryTournamentSummary[];
  latestTournament: (EvolutionaryTournamentSummary & {
    generationTimeline: EvolutionaryTimelineEntry[];
  }) | null;
}

interface TournamentDetailResponse {
  tournamentId: string;
  name: string;
  status: string;
  currentGeneration: number;
  startedAt: string;
  completedAt?: string;
  config: {
    populationSize: number;
    maxGenerations: number;
    symbols: string[];
  };
  generations: Array<{
    generation: number;
    competitionId: string;
    population: string[];
    survivors: string[];
    offspring: string[];
    retired: string[];
    topAgentId: string;
    topFitness: number;
    avgFitness: number;
    completedAt: string;
  }>;
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

interface GenerationTrend {
  generation: number;
  agentCount: number;
  averageWinRate: number;
  averagePnl: number;
  averageRoi: number;
}

function summarizeGenerationTrends(agentList: AgentSummary[]): GenerationTrend[] {
  const grouped = new Map<number, AgentSummary[]>();

  for (const agent of agentList) {
    const generation = agent.generation_number ?? 0;
    const bucket = grouped.get(generation);
    if (bucket) bucket.push(agent);
    else grouped.set(generation, [agent]);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([generation, generationAgents]) => ({
      generation,
      agentCount: generationAgents.length,
      averageWinRate: generationAgents.reduce((sum, agent) => sum + agent.win_rate_percent, 0) / generationAgents.length,
      averagePnl: generationAgents.reduce((sum, agent) => sum + agent.total_pnl, 0) / generationAgents.length,
      averageRoi: generationAgents.reduce((sum, agent) => sum + agent.roi_percent, 0) / generationAgents.length,
    }));
}

function buildSparklinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `M 0 ${height / 2} L ${width} ${height / 2}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : 'N/A';
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(maxLength - 1, 1))}…` : value;
}

function summarizeMutationsApplied(mutationsApplied: unknown[]): string {
  if (!Array.isArray(mutationsApplied) || mutationsApplied.length === 0) {
    return 'No mutations';
  }

  const parts = mutationsApplied.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      try {
        const serialized = JSON.stringify(item);
        return serialized.length > 48 ? `${serialized.slice(0, 47)}…` : serialized;
      } catch {
        return 'mutation';
      }
    }

    return String(item);
  });

  return parts.join(', ');
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function matchesTournamentFilters(
  tournament: Pick<EvolutionaryTournamentSummary, 'status' | 'symbols'>,
  statusFilter: string,
  symbolFilter: string,
): boolean {
  const statusMatches = statusFilter === 'ALL' || tournament.status === statusFilter;
  const symbolMatches = symbolFilter === 'ALL' || tournament.symbols.includes(symbolFilter);
  return statusMatches && symbolMatches;
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

interface RetireConfirmationModalProps {
  agent: AgentDetail;
  retiring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
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

function RetireConfirmationModal({ agent, retiring, onCancel, onConfirm }: RetireConfirmationModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Confirm retirement for ${displayName(agent)}`}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        zIndex: 60,
      }}
    >
      <div style={{ ...panelStyle, width: '100%', maxWidth: '32rem', padding: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#7f1d1d' }}>Confirm Agent Retirement</h3>
        <p style={{ margin: '0.9rem 0 0', color: '#334155', lineHeight: 1.6 }}>
          {displayName(agent)} will be removed from the active agent pool and will no longer appear in future breeding or competition selections.
        </p>
        <p style={{ margin: '0.75rem 0 0', color: '#991b1b', fontWeight: 700 }}>
          This action is intended for culling poor performers.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button
            onClick={onCancel}
            disabled={retiring}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              cursor: retiring ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={retiring}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              border: 'none',
              backgroundColor: retiring ? '#fca5a5' : '#dc2626',
              color: '#ffffff',
              fontWeight: 700,
              cursor: retiring ? 'not-allowed' : 'pointer',
            }}
          >
            {retiring ? 'Retiring...' : 'Confirm Kill Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GenerationTrendsPanel({ agents }: { agents: AgentSummary[] }) {
  const generationTrends = summarizeGenerationTrends(agents);
  const maxPopulation = generationTrends.reduce((max, trend) => Math.max(max, trend.agentCount), 1);
  const maxAbsolutePnl = generationTrends.reduce((max, trend) => Math.max(max, Math.abs(trend.averagePnl)), 1);
  const winRatePath = buildSparklinePath(generationTrends.map(trend => trend.averageWinRate), 220, 56);

  return (
    <div style={{ ...panelStyle, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Generation Trends</h3>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>Population by generation using live registry and leaderboard metrics.</p>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{generationTrends.length} generations tracked</div>
      </div>

      {generationTrends.length === 0 ? (
        <div style={{ marginTop: '1rem', color: '#64748b' }}>No generation data available.</div>
      ) : (
        <>
          <div style={{ marginTop: '1rem', padding: '0.85rem 0.95rem', borderRadius: '0.9rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <div style={{ color: '#1d4ed8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Population win-rate curve</div>
            <svg viewBox="0 0 220 56" style={{ width: '100%', height: '4rem', marginTop: '0.45rem' }} aria-label="Population win-rate curve">
              <path d={winRatePath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            {generationTrends.map(trend => {
              const pnlWidth = `${Math.max((Math.abs(trend.averagePnl) / maxAbsolutePnl) * 100, 8)}%`;

              return (
                <div key={trend.generation} style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ color: '#0f172a' }}>Generation {trend.generation}</strong>
                    <span style={{ color: '#475569', fontSize: '0.85rem' }}>{trend.agentCount} active agents</span>
                  </div>

                  <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.55rem' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.83rem', color: '#475569' }}>
                        <span>Population share</span>
                        <span>{trend.agentCount}</span>
                      </div>
                      <div style={{ marginTop: '0.25rem', height: '0.55rem', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ width: `${(trend.agentCount / maxPopulation) * 100}%`, height: '100%', backgroundColor: '#0f766e' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.83rem', color: '#475569' }}>
                        <span>Average win rate</span>
                        <span>{formatPercent(trend.averageWinRate)}</span>
                      </div>
                      <div style={{ marginTop: '0.25rem', height: '0.55rem', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(Math.min(trend.averageWinRate, 100), 0)}%`, height: '100%', backgroundColor: '#2563eb' }} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.75rem', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: '#475569', fontSize: '0.83rem' }}>Average PnL</div>
                        <div style={{ marginTop: '0.25rem', height: '0.55rem', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: pnlWidth, height: '100%', backgroundColor: trend.averagePnl >= 0 ? '#16a34a' : '#dc2626' }} />
                        </div>
                      </div>
                      <div style={{ color: trend.averagePnl >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{formatCurrency(trend.averagePnl)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: '0.75rem', color: '#64748b', fontSize: '0.82rem' }}>Average ROI {formatPercent(trend.averageRoi)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function EvolutionTournamentHistoryPanel({
  summary,
  selectedTournamentId,
  onSelectTournament,
  statusFilter,
  symbolFilter,
  onStatusFilterChange,
  onSymbolFilterChange,
}: {
  summary: EvolutionarySummaryResponse | null;
  selectedTournamentId: string | null;
  onSelectTournament: (tournamentId: string) => void;
  statusFilter: string;
  symbolFilter: string;
  onStatusFilterChange: (value: string) => void;
  onSymbolFilterChange: (value: string) => void;
}) {
  if (!summary) {
    return (
      <div style={{ ...panelStyle, padding: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Tournament History</h3>
        <div style={{ marginTop: '0.9rem', color: '#64748b' }}>No tournament summary available yet.</div>
      </div>
    );
  }

  const fitnessTimeline = summary.latestTournament?.generationTimeline ?? [];
  const latestVsPrevious = summary.crossTournament.latestVsPrevious;
  const availableStatuses = ['ALL', ...new Set(summary.recentTournaments.map(item => item.status))];
  const availableSymbols = ['ALL', ...new Set(summary.recentTournaments.flatMap(item => item.symbols))];
  const filteredTournaments = summary.recentTournaments.filter(tournament => matchesTournamentFilters(tournament, statusFilter, symbolFilter));
  const fitnessPath = buildSparklinePath(summary.crossTournament.recentPerformance.map(item => item.latestTopFitness), 220, 56);
  const pnlPath = buildSparklinePath(summary.crossTournament.recentPerformance.map(item => item.latestAvgPnl), 220, 56);
  const survivalPath = buildSparklinePath(summary.crossTournament.recentPerformance.map(item => item.latestSurvivalRate), 220, 56);

  return (
    <div style={{ ...panelStyle, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Tournament History</h3>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>Recent evolutionary runs and per-generation fitness from persisted tournament records.</p>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{summary.totals.totalTournaments} tournaments</div>
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Completed', value: String(summary.totals.completedTournaments), accent: '#15803d' },
          { label: 'Running', value: String(summary.totals.runningTournaments), accent: '#2563eb' },
          { label: 'Avg top fitness', value: summary.totals.averageTopFitness.toFixed(1), accent: '#7c3aed' },
          { label: 'Avg generation fitness', value: summary.totals.averageGenerationFitness.toFixed(1), accent: '#b45309' },
        ].map(item => (
          <div key={item.label} style={{ border: '1px solid #e2e8f0', borderTop: `4px solid ${item.accent}`, borderRadius: '0.9rem', padding: '0.85rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
            <div style={{ marginTop: '0.4rem', color: '#0f172a', fontSize: '1.2rem', fontWeight: 800 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
          Status filter
          <select
            value={statusFilter}
            onChange={event => onStatusFilterChange(event.target.value)}
            aria-label="Filter tournaments by status"
            style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
          >
            {availableStatuses.map(option => (
              <option key={option} value={option}>{option === 'ALL' ? 'All statuses' : option}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
          Symbol filter
          <select
            value={symbolFilter}
            onChange={event => onSymbolFilterChange(event.target.value)}
            aria-label="Filter tournaments by symbol"
            style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
          >
            {availableSymbols.map(option => (
              <option key={option} value={option}>{option === 'ALL' ? 'All symbols' : option}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
        <h4 style={{ margin: 0, color: '#0f172a' }}>Cross-Tournament Comparison</h4>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.84rem' }}>Compare how the latest runs are moving across tournaments, not just within one tournament.</p>

        <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Best tournament</div>
            <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{summary.crossTournament.bestTournament?.name ?? 'N/A'}</div>
            <div style={{ marginTop: '0.25rem', color: '#475569', fontSize: '0.82rem' }}>Top fitness {summary.crossTournament.bestTournament?.latestTopFitness.toFixed(1) ?? '0.0'}</div>
            <div style={{ marginTop: '0.25rem', color: '#475569', fontSize: '0.82rem' }}>Avg PnL {formatCurrency(summary.crossTournament.bestTournament?.latestAvgPnl ?? 0)}</div>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Latest vs previous</div>
            <div style={{ marginTop: '0.35rem', color: latestVsPrevious && latestVsPrevious.topFitnessDelta >= 0 ? '#15803d' : '#b91c1c', fontWeight: 700 }}>
              {latestVsPrevious ? `${latestVsPrevious.topFitnessDelta >= 0 ? '+' : ''}${latestVsPrevious.topFitnessDelta.toFixed(1)} top fitness` : 'N/A'}
            </div>
            <div style={{ marginTop: '0.25rem', color: '#475569', fontSize: '0.82rem' }}>
              {latestVsPrevious ? `${latestVsPrevious.avgFitnessDelta >= 0 ? '+' : ''}${latestVsPrevious.avgFitnessDelta.toFixed(1)} avg fitness` : 'Need 2 tournaments'}
            </div>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent signals</div>
            <div style={{ marginTop: '0.45rem', display: 'grid', gap: '0.55rem' }}>
              {[
                { label: 'Top fitness curve', path: fitnessPath, stroke: '#7c3aed' },
                { label: 'PnL curve', path: pnlPath, stroke: '#16a34a' },
                { label: 'Survival curve', path: survivalPath, stroke: '#ea580c' },
              ].map(metric => (
                <div key={metric.label}>
                  <div style={{ color: '#475569', fontSize: '0.8rem' }}>{metric.label}</div>
                  <svg viewBox="0 0 220 56" style={{ width: '100%', height: '3.25rem', marginTop: '0.2rem' }} aria-label={metric.label}>
                    <path d={metric.path} fill="none" stroke={metric.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
        {filteredTournaments.length === 0 ? (
          <div style={{ color: '#64748b' }}>No tournaments match the current filters.</div>
        ) : filteredTournaments.map(tournament => (
          <button
            key={tournament.tournamentId}
            onClick={() => onSelectTournament(tournament.tournamentId)}
            style={{
              textAlign: 'left',
              border: selectedTournamentId === tournament.tournamentId ? '2px solid #2563eb' : '1px solid #e2e8f0',
              borderRadius: '0.9rem',
              padding: '0.9rem',
              backgroundColor: '#ffffff',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ color: '#0f172a' }}>{tournament.name}</strong>
              <span style={{ color: tournament.status === 'COMPLETED' ? '#15803d' : '#2563eb', fontSize: '0.82rem', fontWeight: 700 }}>{tournament.status}</span>
            </div>
            <div style={{ marginTop: '0.45rem', color: '#64748b', fontSize: '0.84rem' }}>
              {tournament.generationCount} generations · Population {tournament.populationSize} · {tournament.symbols.join(', ')}
            </div>
            <div style={{ marginTop: '0.3rem', color: '#475569', fontSize: '0.84rem' }}>
              Top fitness {tournament.latestTopFitness.toFixed(1)} · Avg PnL {formatCurrency(tournament.latestAvgPnl)} · Survival {formatPercent(tournament.latestSurvivalRate)}
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
        <h4 style={{ margin: 0, color: '#0f172a' }}>Latest Tournament Fitness Distribution</h4>
        <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.84rem' }}>
          Top and average fitness per generation for the most recent persisted tournament.
        </p>

        {fitnessTimeline.length === 0 ? (
          <div style={{ marginTop: '0.9rem', color: '#64748b' }}>No generation timeline is available yet.</div>
        ) : (
          <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.8rem' }}>
            {fitnessTimeline.map(entry => (
              <div key={entry.generation} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ color: '#0f172a' }}>Generation {entry.generation}</strong>
                  <span style={{ color: '#64748b', fontSize: '0.82rem' }}>{entry.populationCount} agents · {entry.offspringCount} offspring</span>
                </div>

                <div style={{ marginTop: '0.65rem', display: 'grid', gap: '0.55rem' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: '#475569', fontSize: '0.82rem' }}>
                      <span>Top fitness</span>
                      <span>{entry.topFitness.toFixed(1)}</span>
                    </div>
                    <div style={{ marginTop: '0.25rem', height: '0.55rem', borderRadius: '999px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(Math.min(entry.topFitness, 100), 0)}%`, height: '100%', backgroundColor: '#7c3aed' }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: '#475569', fontSize: '0.82rem' }}>
                      <span>Average fitness</span>
                      <span>{entry.avgFitness.toFixed(1)}</span>
                    </div>
                    <div style={{ marginTop: '0.25rem', height: '0.55rem', borderRadius: '999px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(Math.min(entry.avgFitness, 100), 0)}%`, height: '100%', backgroundColor: '#f59e0b' }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', color: '#475569', fontSize: '0.82rem' }}>
                      <span>Average PnL</span>
                      <span>{formatCurrency(entry.avgPnl)}</span>
                    </div>
                    <div style={{ marginTop: '0.25rem', height: '0.55rem', borderRadius: '999px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(Math.min(Math.abs(entry.avgPnl), 100), 8)}%`, height: '100%', backgroundColor: entry.avgPnl >= 0 ? '#16a34a' : '#dc2626' }} />
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '0.55rem', color: '#64748b', fontSize: '0.81rem' }}>
                  Survivors {entry.survivorCount} · Survival {formatPercent(entry.survivalRate)} · Retired {entry.retiredCount} · {formatDate(entry.completedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TournamentDetailPanel({
  tournament,
  loading,
  statusFilter,
  symbolFilter,
  generationRange,
  onGenerationRangeChange,
}: {
  tournament: TournamentDetailResponse | null;
  loading: boolean;
  statusFilter: string;
  symbolFilter: string;
  generationRange: { start: number; end: number };
  onGenerationRangeChange: (range: { start: number; end: number }) => void;
}) {
  const maxGeneration = tournament ? Math.max(...tournament.generations.map(generation => generation.generation), 1) : 1;
  const startGeneration = clampNumber(generationRange.start, 1, maxGeneration);
  const endGeneration = clampNumber(Math.max(generationRange.end, startGeneration), startGeneration, maxGeneration);
  const matchesFilters = tournament
    ? matchesTournamentFilters({ status: tournament.status, symbols: tournament.config.symbols }, statusFilter, symbolFilter)
    : true;
  const filteredGenerations = tournament
    ? tournament.generations.filter(generation => generation.generation >= startGeneration && generation.generation <= endGeneration)
    : [];

  return (
    <div style={{ ...panelStyle, padding: '1rem' }}>
      <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Tournament Detail</h3>
      <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>Detailed generation-by-generation drill-down from the selected persisted tournament.</p>

      {loading ? (
        <div style={{ marginTop: '1rem', color: '#64748b' }}>Loading tournament detail...</div>
      ) : !tournament ? (
        <div style={{ marginTop: '1rem', color: '#64748b' }}>Select a tournament to inspect generation outcomes.</div>
      ) : !matchesFilters ? (
        <div style={{ marginTop: '1rem', color: '#64748b' }}>The selected tournament is excluded by the current status or symbol filters.</div>
      ) : (
        <>
          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tournament</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{tournament.name}</div>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Symbols</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{tournament.config.symbols.join(', ')}</div>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Progress</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{tournament.currentGeneration}/{tournament.config.maxGenerations}</div>
            </div>
          </div>

          <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
            <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
              Generation start
              <input
                type="number"
                min={1}
                max={maxGeneration}
                value={startGeneration}
                aria-label="Filter generations from"
                onChange={event => {
                  const nextStart = clampNumber(Number(event.target.value) || 1, 1, maxGeneration);
                  onGenerationRangeChange({ start: nextStart, end: Math.max(nextStart, endGeneration) });
                }}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
              Generation end
              <input
                type="number"
                min={startGeneration}
                max={maxGeneration}
                value={endGeneration}
                aria-label="Filter generations to"
                onChange={event => {
                  const nextEnd = clampNumber(Number(event.target.value) || maxGeneration, startGeneration, maxGeneration);
                  onGenerationRangeChange({ start: startGeneration, end: nextEnd });
                }}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
            </label>
          </div>

          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
            {filteredGenerations.map(generation => (
              <div key={generation.generation} style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ color: '#0f172a' }}>Generation {generation.generation}</strong>
                  <span style={{ color: '#64748b', fontSize: '0.82rem' }}>{generation.competitionId}</span>
                </div>
                <div style={{ marginTop: '0.65rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.6rem' }}>
                  {[
                    { label: 'Top agent', value: shortId(generation.topAgentId) },
                    { label: 'Top fitness', value: generation.topFitness.toFixed(1) },
                    { label: 'Avg fitness', value: generation.avgFitness.toFixed(1) },
                    { label: 'Survivors', value: String(generation.survivors.length) },
                    { label: 'Offspring', value: String(generation.offspring.length) },
                    { label: 'Retired', value: String(generation.retired.length) },
                  ].map(item => (
                    <div key={item.label} style={{ border: '1px solid #e2e8f0', borderRadius: '0.8rem', padding: '0.7rem' }}>
                      <div style={{ color: '#64748b', fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</div>
                      <div style={{ marginTop: '0.3rem', color: '#0f172a', fontWeight: 700 }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '0.6rem', color: '#64748b', fontSize: '0.81rem' }}>{formatDate(generation.completedAt)}</div>
              </div>
            ))}

            {filteredGenerations.length === 0 && (
              <div style={{ color: '#64748b' }}>No generations fall within the selected range.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function GenealogyTreePanel({
  agent,
  genealogy,
  onNavigateToAgent,
}: {
  agent: AgentDetail;
  genealogy: AgentGenealogyEntry[];
  onNavigateToAgent: (agentId: string) => void;
}) {
  const [selectedGenealogyId, setSelectedGenealogyId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedGenealogyId(genealogy[genealogy.length - 1]?.id ?? null);
  }, [genealogy, agent.id]);

  const selectedEvent = genealogy.find(entry => entry.id === selectedGenealogyId) ?? genealogy[genealogy.length - 1] ?? null;
  const graphWidth = Math.max(320, genealogy.length * 220);
  const graphHeight = 250;

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
      <h4 style={{ margin: 0, color: '#0f172a' }}>Genealogy Tree</h4>
      <p style={{ margin: '0.4rem 0 0', color: '#64748b', fontSize: '0.85rem', lineHeight: 1.5 }}>
        Inspect the ancestry as a node-link graph, jump to parent agents, and review inherited genes and mutations.
      </p>

      {selectedEvent ? (
        <>
          <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '0.95rem', background: 'linear-gradient(180deg, #f8fafc, #eef2ff)', border: '1px solid #dbeafe', overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${graphWidth} ${graphHeight}`} style={{ width: '100%', minWidth: `${graphWidth}px`, height: '14rem' }} aria-label="Agent lineage graph">
              {genealogy.map((entry, index) => {
                const centerX = 110 + index * 220;
                const parentY = 46;
                const childY = 165;
                const parentOffset = 62;
                const isSelected = entry.id === selectedEvent.id;
                const childLabel = entry.agentId === agent.id ? displayName(agent) : shortId(entry.agentId);
                const mutationSummary = summarizeMutationsApplied(entry.mutationsApplied);
                const mutationLabel = truncateLabel(mutationSummary, 18);

                return (
                  <g key={entry.id}>
                    {[entry.parent1Id, entry.parent2Id].map((parentId, parentIndex) => {
                      const parentX = centerX + (parentIndex === 0 ? -parentOffset : parentOffset);

                      return (
                        <g key={`${entry.id}-${parentIndex}`}>
                          <line x1={parentX} y1={parentY + 22} x2={centerX} y2={childY - 26} stroke={isSelected ? '#2563eb' : '#94a3b8'} strokeWidth={isSelected ? 3 : 2} />
                          <g
                            role={parentId ? 'button' : undefined}
                            tabIndex={parentId ? 0 : -1}
                            onClick={() => parentId && onNavigateToAgent(parentId)}
                            onKeyDown={event => {
                              if (parentId && (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault();
                                onNavigateToAgent(parentId);
                              }
                            }}
                            aria-label={parentId ? `Navigate to parent ${parentIndex + 1}` : undefined}
                            style={{ cursor: parentId ? 'pointer' : 'default' }}
                          >
                            <title>{parentId ? `Parent ${parentIndex + 1}: ${parentId}` : `Parent ${parentIndex + 1}: unavailable`}</title>
                            <circle cx={parentX} cy={parentY} r={22} fill={parentId ? '#ffffff' : '#e2e8f0'} stroke={isSelected ? '#2563eb' : '#94a3b8'} strokeWidth={2} />
                            <text x={parentX} y={parentY + 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f172a">{shortId(parentId)}</text>
                          </g>
                        </g>
                      );
                    })}

                    <g role="button" tabIndex={0} onClick={() => setSelectedGenealogyId(entry.id)} onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedGenealogyId(entry.id);
                      }
                    }} aria-label={`Select genealogy event generation ${entry.breedingGeneration}`} style={{ cursor: 'pointer' }}>
                      <title>{`${childLabel}\n${mutationSummary}\n${formatDate(entry.breedingDate)}`}</title>
                      <rect x={centerX - 56} y={childY - 26} width={112} height={54} rx={14} fill={isSelected ? '#0f172a' : '#ffffff'} stroke={isSelected ? '#0f172a' : '#94a3b8'} strokeWidth={2.5} />
                      <text x={centerX} y={childY - 2} textAnchor="middle" fontSize="11" fontWeight="800" fill={isSelected ? '#f8fafc' : '#0f172a'}>{childLabel.slice(0, 16)}</text>
                      <text x={centerX} y={childY + 14} textAnchor="middle" fontSize="10" fill={isSelected ? '#cbd5f5' : '#475569'}>Gen {entry.breedingGeneration}</text>
                      <text x={centerX} y={childY + 38} textAnchor="middle" fontSize="10" fill="#475569">{mutationLabel}</text>
                    </g>
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Latest mutation</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>Severity {selectedEvent.mutationSeverity}</div>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Breeding date</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{formatDate(selectedEvent.breedingDate)}</div>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.8rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Offspring count</div>
              <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700 }}>{selectedEvent.offspringCount}</div>
            </div>
          </div>

          <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.75rem' }}>
            {[selectedEvent.parent1Id, selectedEvent.parent2Id].map((parentId, index) => (
              <button
                key={`${parentId ?? 'unknown'}-${index}`}
                onClick={() => parentId && onNavigateToAgent(parentId)}
                disabled={!parentId}
                style={{
                  padding: '0.85rem',
                  borderRadius: '0.85rem',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  textAlign: 'center',
                  cursor: parentId ? 'pointer' : 'not-allowed',
                }}
              >
                <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Parent {index + 1}</div>
                <div style={{ marginTop: '0.4rem', color: '#0f172a', fontWeight: 700 }}>{shortId(parentId)}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '0.75rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Inherited genes</div>
              <pre style={{ margin: '0.55rem 0 0', whiteSpace: 'pre-wrap', color: '#0f172a', fontSize: '0.8rem', lineHeight: 1.5 }}>{JSON.stringify(selectedEvent.inheritedGenes ?? {}, null, 2)}</pre>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
              <div style={{ color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mutation log</div>
              <pre style={{ margin: '0.55rem 0 0', whiteSpace: 'pre-wrap', color: '#0f172a', fontSize: '0.8rem', lineHeight: 1.5 }}>{JSON.stringify(selectedEvent.mutationsApplied ?? [], null, 2)}</pre>
            </div>
          </div>

          <div style={{ marginTop: '1rem', display: 'grid', gap: '0.7rem' }}>
            {genealogy.map(entry => (
              <button
                key={entry.id}
                onClick={() => setSelectedGenealogyId(entry.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '0.75rem',
                  alignItems: 'start',
                  border: selectedGenealogyId === entry.id ? '2px solid #2563eb' : '1px solid transparent',
                  borderRadius: '0.85rem',
                  padding: '0.35rem',
                  backgroundColor: '#ffffff',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: '4.75rem', padding: '0.55rem 0.65rem', borderRadius: '999px', backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: '0.78rem', fontWeight: 700, textAlign: 'center' }}>
                  Gen {entry.breedingGeneration}
                </div>
                <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#0f172a', fontWeight: 700 }}>Parents {shortId(entry.parent1Id)} / {shortId(entry.parent2Id)}</div>
                  <div style={{ marginTop: '0.25rem', color: '#64748b', fontSize: '0.84rem' }}>{formatDate(entry.breedingDate)}</div>
                  <div style={{ marginTop: '0.3rem', color: '#475569', fontSize: '0.84rem' }}>Mutations applied: {entry.mutationsApplied.length}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div style={{ marginTop: '0.9rem', color: '#64748b' }}>No genealogy records available.</div>
      )}
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
  const [evolutionSummary, setEvolutionSummary] = useState<EvolutionarySummaryResponse | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<TournamentDetailResponse | null>(null);
  const [tournamentStatusFilter, setTournamentStatusFilter] = useState('ALL');
  const [tournamentSymbolFilter, setTournamentSymbolFilter] = useState('ALL');
  const [generationRange, setGenerationRange] = useState({ start: 1, end: 1 });
  const [loadingTournamentDetail, setLoadingTournamentDetail] = useState(false);
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
  const formInitializedForRef = useRef<string | null>(null);
  const [breedingPoolIds, setBreedingPoolIds] = useState<string[]>([]);
  const [breedChildCount, setBreedChildCount] = useState(2);
  const [breedStrategy, setBreedStrategy] = useState<BreedStrategy>('UNIFORM');
  const [breedMutationSeverity, setBreedMutationSeverity] = useState<BreedMutationSeverity>('MEDIUM');
  const [breedError, setBreedError] = useState<string | null>(null);
  const [breedSuccess, setBreedSuccess] = useState<string | null>(null);
  const [breeding, setBreeding] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [retireConfirmOpen, setRetireConfirmOpen] = useState(false);

  // Keep dashboard data moving during ongoing competitions without manual refresh.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setRefreshNonce(value => value + 1);
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        setLoadingOverview(true);
        setOverviewError(null);

        const [agentsResponse, leaderboardResponse, summaryResponse] = await Promise.all([
          fetch('/api/agents?limit=100'),
          fetch('/api/agents/stats/leaderboard?limit=10'),
          fetch('/api/evolutionary/summary'),
        ]);

        if (!agentsResponse.ok) throw new Error(`Failed to load agents: HTTP ${agentsResponse.status}`);
        if (!leaderboardResponse.ok) throw new Error(`Failed to load leaderboard: HTTP ${leaderboardResponse.status}`);

        const agentsData = await agentsResponse.json() as AgentListResponse;
        const leaderboardData = await leaderboardResponse.json() as Array<Record<string, unknown>>;

        const normalizedAgents = (agentsData.agents ?? []).map(normalizeAgentSummary);
        const normalizedLeaderboard = leaderboardData.map(normalizeAgentSummary);

        setAgents(normalizedAgents);
        setLeaderboard(normalizedLeaderboard);
        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json() as EvolutionarySummaryResponse;
          setEvolutionSummary(summaryData);
          setSelectedTournamentId(current => current ?? summaryData.latestTournament?.tournamentId ?? null);
        } else {
          setEvolutionSummary(null);
        }
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
        const normalizedDetail = normalizeAgentDetail(detailData);
        setSelectedAgent(normalizedDetail);
        if (formInitializedForRef.current !== selectedAgentId) {
          formInitializedForRef.current = selectedAgentId;
          setCustomizationForm(buildCustomizationForm(normalizedDetail));
        }

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
  }, [selectedAgentId, refreshNonce]);

  useEffect(() => {
    if (!selectedTournamentId) {
      setSelectedTournament(null);
      return;
    }

    const loadTournament = async () => {
      try {
        setLoadingTournamentDetail(true);
        const response = await fetch(`/api/evolutionary/tournament/${selectedTournamentId}`);
        if (!response.ok) throw new Error(`Failed to load tournament: HTTP ${response.status}`);
        setSelectedTournament(await response.json() as TournamentDetailResponse);
      } catch {
        setSelectedTournament(null);
      } finally {
        setLoadingTournamentDetail(false);
      }
    };

    void loadTournament();
  }, [selectedTournamentId, refreshNonce]);

  useEffect(() => {
    if (!selectedTournament) return;

    const maxGeneration = Math.max(...selectedTournament.generations.map(generation => generation.generation), 1);
    setGenerationRange({ start: 1, end: maxGeneration });
  }, [selectedTournament?.tournamentId]);

  useEffect(() => {
    if (!selectedAgent || selectedAgent.status !== 'ACTIVE') {
      setRetireConfirmOpen(false);
    }
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
  const filteredRecentTournamentIds = evolutionSummary
    ? evolutionSummary.recentTournaments
      .filter(tournament => matchesTournamentFilters(tournament, tournamentStatusFilter, tournamentSymbolFilter))
      .map(tournament => tournament.tournamentId)
    : [];

  useEffect(() => {
    if (!evolutionSummary) return;

    if (filteredRecentTournamentIds.length === 0) {
      setSelectedTournamentId(null);
      return;
    }

    if (!selectedTournamentId || !filteredRecentTournamentIds.includes(selectedTournamentId)) {
      setSelectedTournamentId(filteredRecentTournamentIds[0] ?? null);
    }
  }, [evolutionSummary, selectedTournamentId, filteredRecentTournamentIds.join('|')]);

  const totalAgents = agents.length;
  const averageWinRate = totalAgents > 0 ? agents.reduce((sum, agent) => sum + agent.win_rate_percent, 0) / totalAgents : 0;
  const averageRoi = totalAgents > 0 ? agents.reduce((sum, agent) => sum + agent.roi_percent, 0) / totalAgents : 0;
  const totalPnl = agents.reduce((sum, agent) => sum + agent.total_pnl, 0);
  const topSharpe = agents.reduce((max, agent) => Math.max(max, agent.sharpe_ratio), 0);
  const breedingPoolAgents = breedingPoolIds
    .map(id => agents.find(agent => agent.id === id) ?? (selectedAgent?.id === id ? normalizeAgentSummary({
      id: selectedAgent.id,
      agent_type: selectedAgent.agent_type,
      risk_profile: selectedAgent.risk_profile,
      status: selectedAgent.status,
      custom_name: selectedAgent.custom_name,
      emoji: selectedAgent.emoji,
      color: selectedAgent.color,
      biography: selectedAgent.biography,
      nickname: selectedAgent.nickname,
      age_iterations: selectedAgent.age_iterations,
      generation_number: selectedAgent.generation_number,
      created_at: selectedAgent.created_at,
      total_competitions: selectedAgent.stats.total_competitions,
      total_wins: selectedAgent.stats.total_wins,
      total_losses: selectedAgent.stats.total_losses,
      win_rate_percent: selectedAgent.stats.win_rate_percent,
      total_pnl: selectedAgent.stats.total_pnl,
      sharpe_ratio: selectedAgent.stats.sharpe_ratio,
      roi_percent: selectedAgent.stats.roi_percent,
    }) : null))
    .filter((agent): agent is AgentSummary => !!agent);

  const handleRefresh = () => {
    setRefreshNonce(value => value + 1);
  };

  const openCustomization = () => {
    if (!selectedAgent) return;
    setCustomizationError(null);
    setCustomizationForm(buildCustomizationForm(selectedAgent));
    setCustomizing(true);
  };

  const toggleBreedingPool = (agentId: string) => {
    setBreedError(null);
    setBreedSuccess(null);
    setBreedingPoolIds(current => current.includes(agentId)
      ? current.filter(id => id !== agentId)
      : [...current, agentId]);
  };

  const retireSelectedAgent = async () => {
    if (!selectedAgent) return;

    try {
      setRetiring(true);
      setRetireError(null);
      setBreedSuccess(null);

      const response = await fetch(`/api/agents/${selectedAgent.id}/retire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(typeof errorData.error === 'string' ? errorData.error : `HTTP ${response.status}`);
      }

      setBreedingPoolIds(current => current.filter(id => id !== selectedAgent.id));
      setSelectedAgentId(null);
      setRetireConfirmOpen(false);
      setBreedSuccess(`${displayName(selectedAgent)} retired from the active pool.`);
      setRefreshNonce(value => value + 1);
    } catch (error) {
      setRetireError(error instanceof Error ? error.message : 'Failed to retire agent');
    } finally {
      setRetiring(false);
    }
  };

  const breedSelectedAgents = async () => {
    try {
      setBreeding(true);
      setBreedError(null);
      setBreedSuccess(null);

      const response = await fetch('/api/evolutionary/breed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentIds: breedingPoolIds,
          childCount: breedChildCount,
          crossoverStrategy: breedStrategy,
          mutationSeverity: breedMutationSeverity,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(typeof errorData.error === 'string' ? errorData.error : `HTTP ${response.status}`);
      }

      const data = await response.json() as BreedResponse;
      const firstChildId = data.children[0]?.id ?? null;
      setBreedSuccess(`Created ${data.childCount} child agents from ${data.parentIds.length} selected parents.`);
      setBreedingPoolIds([]);
      setSelectedAgentId(firstChildId);
      setRefreshNonce(value => value + 1);
    } catch (error) {
      setBreedError(error instanceof Error ? error.message : 'Failed to breed selected agents');
    } finally {
      setBreeding(false);
    }
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Breeding Pool</h3>
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{breedingPoolIds.length} selected</span>
            </div>

            <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
              {breedingPoolAgents.length === 0 ? (
                <div style={{ color: '#64748b' }}>Select agents in the detail panel to mark them ready for evolution.</div>
              ) : breedingPoolAgents.map(agent => (
                <div key={agent.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.75rem' }}>
                  <div>
                    <div style={{ color: '#0f172a', fontWeight: 700 }}>{displayName(agent)}</div>
                    <div style={{ marginTop: '0.2rem', color: '#64748b', fontSize: '0.85rem' }}>{agent.agent_type} · Gen {agent.generation_number ?? 0}</div>
                  </div>
                  <button
                    onClick={() => toggleBreedingPool(agent.id)}
                    style={{ padding: '0.55rem 0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
                Children
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={breedChildCount}
                  onChange={event => setBreedChildCount(Math.min(Math.max(Number(event.target.value) || 1, 1), 20))}
                  style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
                Crossover
                <select
                  value={breedStrategy}
                  onChange={event => setBreedStrategy(event.target.value as BreedStrategy)}
                  style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                >
                  <option value="UNIFORM">Uniform</option>
                  <option value="BLENDED">Blended</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.35rem', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
                Mutation
                <select
                  value={breedMutationSeverity}
                  onChange={event => setBreedMutationSeverity(event.target.value as BreedMutationSeverity)}
                  style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                >
                  <option value="LIGHT">Light</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HEAVY">Heavy</option>
                </select>
              </label>
            </div>

            {breedError && (
              <div role="alert" style={{ marginTop: '1rem', color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem' }}>
                {breedError}
              </div>
            )}

            {breedSuccess && (
              <div style={{ marginTop: '1rem', color: '#166534', backgroundColor: '#dcfce7', padding: '0.75rem', borderRadius: '0.75rem' }}>
                {breedSuccess}
              </div>
            )}

            <button
              onClick={breedSelectedAgents}
              disabled={breeding || breedingPoolIds.length < 2}
              style={{
                marginTop: '1rem',
                padding: '0.8rem 1rem',
                borderRadius: '0.85rem',
                border: 'none',
                backgroundColor: breeding || breedingPoolIds.length < 2 ? '#94a3b8' : '#2563eb',
                color: '#ffffff',
                fontWeight: 700,
                cursor: breeding || breedingPoolIds.length < 2 ? 'not-allowed' : 'pointer',
              }}
            >
              {breeding ? 'Breeding...' : 'Create Mutated Children'}
            </button>
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

          <GenerationTrendsPanel agents={agents} />

          <EvolutionTournamentHistoryPanel
            summary={evolutionSummary}
            selectedTournamentId={selectedTournamentId}
            onSelectTournament={setSelectedTournamentId}
            statusFilter={tournamentStatusFilter}
            symbolFilter={tournamentSymbolFilter}
            onStatusFilterChange={setTournamentStatusFilter}
            onSymbolFilterChange={setTournamentSymbolFilter}
          />

          <TournamentDetailPanel
            tournament={selectedTournament}
            loading={loadingTournamentDetail}
            statusFilter={tournamentStatusFilter}
            symbolFilter={tournamentSymbolFilter}
            generationRange={generationRange}
            onGenerationRangeChange={setGenerationRange}
          />
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
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleBreedingPool(selectedAgent.id)}
                    disabled={selectedAgent.status !== 'ACTIVE'}
                    style={{
                      alignSelf: 'start',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.85rem',
                      border: '1px solid #cbd5e1',
                      backgroundColor: breedingPoolIds.includes(selectedAgent.id) ? '#dbeafe' : '#ffffff',
                      color: '#0f172a',
                      fontWeight: 700,
                      cursor: selectedAgent.status !== 'ACTIVE' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {breedingPoolIds.includes(selectedAgent.id) ? 'Remove From Breeding Pool' : 'Mark Ready To Evolve'}
                  </button>
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
                  <button
                    onClick={() => setRetireConfirmOpen(true)}
                    disabled={retiring || selectedAgent.status !== 'ACTIVE'}
                    style={{
                      alignSelf: 'start',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.85rem',
                      border: 'none',
                      backgroundColor: retiring || selectedAgent.status !== 'ACTIVE' ? '#fca5a5' : '#dc2626',
                      color: '#ffffff',
                      fontWeight: 700,
                      cursor: retiring || selectedAgent.status !== 'ACTIVE' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {retiring ? 'Retiring...' : 'Kill Agent'}
                  </button>
                </div>
              </div>

              {retireError && (
                <div role="alert" style={{ color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem' }}>
                  {retireError}
                </div>
              )}

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
                <GenealogyTreePanel
                  agent={selectedAgent}
                  genealogy={genealogy}
                  onNavigateToAgent={setSelectedAgentId}
                />
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

      {retireConfirmOpen && selectedAgent && (
        <RetireConfirmationModal
          agent={selectedAgent}
          retiring={retiring}
          onCancel={() => setRetireConfirmOpen(false)}
          onConfirm={retireSelectedAgent}
        />
      )}
    </section>
  );
}