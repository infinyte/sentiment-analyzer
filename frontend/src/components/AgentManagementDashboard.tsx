import { useEffect, useRef, useState } from 'react';
import { AgentAvatar } from './AgentAvatar';

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

type MarketRegime = 'BULL_TREND' | 'BEAR_TREND' | 'SIDEWAYS' | 'VOLATILE_CRASH' | 'VOLATILE_PUMP';

interface PretrainResult {
  agentId: string;
  riskProfile: string;
  episodes: number;
  avgReturn: number;
  bestReturn: number;
  convergenceCurve: number[];
  finalEpsilon: number;
  status: 'completed';
}

interface BestGenomeResponse {
  agentId: string;
  fitnessScore: number;
  tournamentId: string;
  generation: number;
  foundAt: string;
  genome: unknown;
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
    claudeOrchestrated?: boolean;
    adversarialTraining?: boolean;
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
    claudeDirective?: {
      generation: number;
      mutationSeverity: string;
      survivalPercent: number;
      crossoverStrategy: string;
      diversityBoost: boolean;
      reasoning: string;
    };
    adversarialSummary?: {
      sentimentAgentsCount: number;
      adversaryAgentsCount: number;
      sentimentWinRate: number;
      beatingAgentIds: string[];
      matchups: Array<{
        sentimentAgentId: string;
        adversaryAgentId: string;
        sentimentFitness: number;
        adversaryFitness: number;
        sentimentWon: boolean;
      }>;
    };
  }>;
}

const EMOJI_OPTIONS = ['🟢', '🔴', '🟡', '💎', '🔥', '⚡', '🌟', '🎯', '🚀', '🏆'];
const COLOR_OPTIONS = ['#00FF00', '#FF0000', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#800080', '#0099FF'];

interface LearningState {
  cacheKey: string;
  agentId: string;
  riskProfile: string;
}

interface LearningStatesResponse {
  count: number;
  agents: LearningState[];
}

type AgentAlgorithm = 'Q_TABLE' | 'POLICY_GRADIENT' | 'DQN';

interface AgentAlgorithmResponse {
  agentId: string;
  algorithm: AgentAlgorithm | string;
  note: string;
  policyNetwork: {
    architecture: string;
    updateRule: string;
    replayBuffer: string;
  };
}

const ALGORITHM_OPTIONS: Array<{
  value: AgentAlgorithm;
  label: string;
  description: string;
}> = [
  {
    value: 'Q_TABLE',
    label: 'Q_TABLE',
    description: 'Hybrid Q-table with policy-network guidance.',
  },
  {
    value: 'POLICY_GRADIENT',
    label: 'POLICY_GRADIENT',
    description: 'Network-first policy updates without TensorFlow DQN.',
  },
  {
    value: 'DQN',
    label: 'DQN',
    description: 'Experimental option exposed for API compatibility checks.',
  },
];

const DEFAULT_AGENT_ALGORITHM: AgentAlgorithm = 'Q_TABLE';

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
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

interface ResetLearningConfirmationModalProps {
  agent: AgentDetail;
  riskProfile?: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ResetLearningConfirmationModal({ agent, riskProfile, loading, onCancel, onConfirm }: ResetLearningConfirmationModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reset learning state confirmation"
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
      <div style={{ ...panelStyle, width: '100%', maxWidth: '36rem', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#7c3aed' }}>⚠️ Reset Learning State</h3>
            <p style={{ margin: '0.5rem 0 0', color: '#475569', fontSize: '0.95rem' }}>{displayName(agent)}</p>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: '1.5rem', cursor: loading ? 'not-allowed' : 'pointer' }}
            aria-label="Close confirmation dialog"
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fef3c7', borderRadius: '0.75rem', borderLeft: '4px solid #d97706' }}>
          <p style={{ margin: 0, color: '#92400e', fontSize: '0.9rem', lineHeight: 1.5 }}>
            This action will <strong>permanently clear</strong> the {riskProfile ? 'learning state for the ' + riskProfile + ' profile' : 'learning state for ALL risk profiles'}. The agent will start fresh without previously learned behavior in the next competition.
          </p>
        </div>

        <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.85rem',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#0f172a',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '0.85rem',
              border: 'none',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Resetting...' : 'Confirm Reset'}
          </button>
        </div>
      </div>
    </div>
  );
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

const ALL_REGIMES: MarketRegime[] = ['BULL_TREND', 'BEAR_TREND', 'SIDEWAYS', 'VOLATILE_CRASH', 'VOLATILE_PUMP'];

interface PretrainModalProps {
  agent: AgentDetail;
  pretraining: boolean;
  result: PretrainResult | null;
  error: string | null;
  episodes: number;
  steps: number;
  regimes: MarketRegime[];
  onClose: () => void;
  onEpisodesChange: (v: number) => void;
  onStepsChange: (v: number) => void;
  onRegimesChange: (v: MarketRegime[]) => void;
  onRun: () => void;
}

function PretrainModal({
  agent, pretraining, result, error,
  episodes, steps, regimes,
  onClose, onEpisodesChange, onStepsChange, onRegimesChange, onRun,
}: PretrainModalProps) {
  const convergencePath = result ? buildSparklinePath(result.convergenceCurve, 320, 64) : '';

  const toggleRegime = (regime: MarketRegime) => {
    onRegimesChange(regimes.includes(regime) ? regimes.filter(r => r !== regime) : [...regimes, regime]);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pre-train ${displayName(agent)}`}
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
      <div style={{ ...panelStyle, width: '100%', maxWidth: '42rem', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>Pre-Train Agent</h3>
            <p style={{ margin: '0.5rem 0 0', color: '#475569', fontSize: '0.95rem' }}>{displayName(agent)} · {agent.risk_profile}</p>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: '1.5rem', cursor: 'pointer' }}
            aria-label="Close pre-train dialog"
          >
            ×
          </button>
        </div>

        <p style={{ margin: '1rem 0 0', color: '#475569', fontSize: '0.9rem', lineHeight: 1.6 }}>
          Run the agent through synthetic market episodes before live competitions. Pre-training is additive — subsequent calls build on prior state.
        </p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
              Episodes (max 500)
              <input
                type="number"
                min={10}
                max={500}
                value={episodes}
                onChange={event => onEpisodesChange(Math.min(500, Math.max(10, Number(event.target.value) || 50)))}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 600 }}>
              Steps / episode (max 2000)
              <input
                type="number"
                min={100}
                max={2000}
                value={steps}
                onChange={event => onStepsChange(Math.min(2000, Math.max(100, Number(event.target.value) || 500)))}
                style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
              />
            </label>
          </div>

          <div>
            <div style={{ color: '#334155', fontWeight: 600, marginBottom: '0.6rem' }}>Market regimes</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {ALL_REGIMES.map(regime => (
                <button
                  key={regime}
                  type="button"
                  onClick={() => toggleRegime(regime)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    borderRadius: '999px',
                    border: '1px solid',
                    borderColor: regimes.includes(regime) ? '#2563eb' : '#cbd5e1',
                    backgroundColor: regimes.includes(regime) ? '#dbeafe' : '#ffffff',
                    color: regimes.includes(regime) ? '#1d4ed8' : '#475569',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {regime.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div role="alert" style={{ color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem' }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '1rem' }}>
              <div style={{ color: '#15803d', fontWeight: 700, marginBottom: '0.75rem' }}>Pre-training completed</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.6rem', marginBottom: '0.9rem' }}>
                {[
                  { label: 'Episodes', value: String(result.episodes) },
                  { label: 'Avg return', value: `${(result.avgReturn * 100).toFixed(2)}%` },
                  { label: 'Best return', value: `${(result.bestReturn * 100).toFixed(2)}%` },
                  { label: 'Final ε', value: result.finalEpsilon.toFixed(4) },
                ].map(item => (
                  <div key={item.label} style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.6rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</div>
                    <div style={{ marginTop: '0.3rem', color: '#0f172a', fontWeight: 700 }}>{item.value}</div>
                  </div>
                ))}
              </div>
              {convergencePath && (
                <div style={{ backgroundColor: '#f0fdf4', borderRadius: '0.75rem', padding: '0.75rem' }}>
                  <div style={{ color: '#15803d', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Convergence curve</div>
                  <svg viewBox="0 0 320 64" style={{ width: '100%', height: '4rem', marginTop: '0.4rem' }} aria-label="Pre-training convergence curve">
                    <path d={convergencePath} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.76rem', marginTop: '0.2rem' }}>
                    <span>Block 1</span>
                    <span>Block {result.convergenceCurve.length}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              style={{ padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', cursor: 'pointer' }}
            >
              Close
            </button>
            <button
              onClick={onRun}
              disabled={pretraining || regimes.length === 0}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '0.75rem',
                border: 'none',
                backgroundColor: pretraining || regimes.length === 0 ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                cursor: pretraining || regimes.length === 0 ? 'wait' : 'pointer',
                fontWeight: 700,
              }}
            >
              {pretraining ? 'Training...' : result ? 'Run again' : 'Start pre-training'}
            </button>
          </div>
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
  onRestoreCheckpoint,
  rollbackLoadingGeneration,
  rollbackError,
  rollbackSuccess,
}: {
  tournament: TournamentDetailResponse | null;
  loading: boolean;
  statusFilter: string;
  symbolFilter: string;
  generationRange: { start: number; end: number };
  onGenerationRangeChange: (range: { start: number; end: number }) => void;
  onRestoreCheckpoint: (generation: number) => Promise<void>;
  rollbackLoadingGeneration: number | null;
  rollbackError: string | null;
  rollbackSuccess: number | null;
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

          {/* AC7 — orchestration & adversarial mode badges */}
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700,
              backgroundColor: tournament.config.claudeOrchestrated ? '#ede9fe' : '#f1f5f9',
              color: tournament.config.claudeOrchestrated ? '#5b21b6' : '#475569',
              border: `1px solid ${tournament.config.claudeOrchestrated ? '#c4b5fd' : '#cbd5e1'}`,
            }}>
              {tournament.config.claudeOrchestrated ? 'Claude-orchestrated' : 'Heuristic'}
            </span>
            {tournament.config.adversarialTraining && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700,
                backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24',
              }}>
                Adversarial Training
              </span>
            )}
            <span style={{
              padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700,
              backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #86efac',
            }}>
              Pop {tournament.config.populationSize}
            </span>
          </div>

          {rollbackError && (
            <div role="alert" style={{ marginTop: '0.75rem', padding: '0.65rem 0.9rem', borderRadius: '0.8rem', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '0.85rem' }}>
              {rollbackError}
            </div>
          )}
          {rollbackSuccess !== null && (
            <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.9rem', borderRadius: '0.8rem', backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #86efac', fontSize: '0.85rem' }}>
              Checkpoint for generation {rollbackSuccess} restored successfully.
            </div>
          )}

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
            {filteredGenerations.map((generation, idx) => {
              // AC5 — compute trend vs previous generation in the filtered set
              const prev = filteredGenerations[idx - 1];
              const avgTrend = prev !== undefined ? generation.avgFitness - prev.avgFitness : null;

              return (
              <div key={generation.generation} style={{ border: '1px solid #e2e8f0', borderRadius: '0.9rem', padding: '0.9rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ color: '#0f172a' }}>Generation {generation.generation}</strong>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* AC5 — trend badge */}
                    {avgTrend !== null && (
                      <span style={{
                        fontSize: '0.78rem', fontWeight: 700, padding: '0.2rem 0.55rem',
                        borderRadius: '999px',
                        backgroundColor: avgTrend >= 0 ? '#f0fdf4' : '#fef2f2',
                        color: avgTrend >= 0 ? '#15803d' : '#b91c1c',
                        border: `1px solid ${avgTrend >= 0 ? '#86efac' : '#fecaca'}`,
                      }}>
                        {avgTrend >= 0 ? '+' : ''}{avgTrend.toFixed(1)} avg
                      </span>
                    )}
                    <span style={{ color: '#64748b', fontSize: '0.82rem' }}>{generation.competitionId}</span>
                  </div>
                </div>
                <div style={{ marginTop: '0.65rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.6rem' }}>
                  {[
                    { label: 'Top agent', value: shortId(generation.topAgentId) },
                    { label: 'Max fitness', value: generation.topFitness.toFixed(1) },
                    { label: 'Mean fitness', value: generation.avgFitness.toFixed(1) },
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

                {/* AC3 — full adversarial matchup table */}
                {generation.adversarialSummary && (
                  <div style={{ marginTop: '0.65rem', borderRadius: '0.8rem', border: '1px solid #fbbf24', overflow: 'hidden' }}>
                    <div style={{ padding: '0.6rem 0.9rem', background: '#fef3c7', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: '#92400e', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Adversarial Round</span>
                      <span style={{ color: '#78350f', fontSize: '0.82rem' }}>
                        {generation.adversarialSummary.sentimentAgentsCount} sentiment vs {generation.adversarialSummary.adversaryAgentsCount} adversar{generation.adversarialSummary.adversaryAgentsCount === 1 ? 'y' : 'ies'}
                      </span>
                      <span style={{ color: '#78350f', fontSize: '0.82rem' }}>
                        Win rate: <strong>{generation.adversarialSummary.sentimentWinRate.toFixed(1)}%</strong>
                      </span>
                      <span style={{ color: '#78350f', fontSize: '0.82rem' }}>
                        Bonus agents: <strong>{generation.adversarialSummary.beatingAgentIds.length}</strong>
                      </span>
                    </div>
                    {generation.adversarialSummary.matchups.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#fffbeb' }}>
                              <th style={{ padding: '0.45rem 0.75rem', textAlign: 'left', color: '#78350f', fontWeight: 700, borderBottom: '1px solid #fde68a' }}>Sentiment agent</th>
                              <th style={{ padding: '0.45rem 0.75rem', textAlign: 'left', color: '#78350f', fontWeight: 700, borderBottom: '1px solid #fde68a' }}>Adversary</th>
                              <th style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#78350f', fontWeight: 700, borderBottom: '1px solid #fde68a' }}>S. fitness</th>
                              <th style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#78350f', fontWeight: 700, borderBottom: '1px solid #fde68a' }}>A. fitness</th>
                              <th style={{ padding: '0.45rem 0.75rem', textAlign: 'center', color: '#78350f', fontWeight: 700, borderBottom: '1px solid #fde68a' }}>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {generation.adversarialSummary.matchups.map((matchup, matchupIdx) => (
                              <tr key={matchupIdx} style={{ borderBottom: '1px solid #fef3c7' }}>
                                <td style={{ padding: '0.4rem 0.75rem', color: '#0f172a', fontFamily: 'monospace' }}>{shortId(matchup.sentimentAgentId)}</td>
                                <td style={{ padding: '0.4rem 0.75rem', color: '#b91c1c', fontFamily: 'monospace' }}>{shortId(matchup.adversaryAgentId)}</td>
                                <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#0f172a' }}>{matchup.sentimentFitness.toFixed(1)}</td>
                                <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#b91c1c' }}>{matchup.adversaryFitness.toFixed(1)}</td>
                                <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>
                                  <span style={{
                                    padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.73rem', fontWeight: 700,
                                    backgroundColor: matchup.sentimentWon ? '#f0fdf4' : '#fef2f2',
                                    color: matchup.sentimentWon ? '#15803d' : '#b91c1c',
                                  }}>
                                    {matchup.sentimentWon ? 'WIN' : 'LOSS'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* AC4 — Claude directive reasoning */}
                {generation.claudeDirective && (
                  <div style={{ marginTop: '0.65rem', borderRadius: '0.8rem', border: '1px solid #c4b5fd', overflow: 'hidden' }}>
                    <div style={{ padding: '0.6rem 0.9rem', backgroundColor: '#ede9fe', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: '#5b21b6', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Claude Directive</span>
                      <span style={{ color: '#6d28d9', fontSize: '0.82rem' }}>Mutation: <strong>{generation.claudeDirective.mutationSeverity}</strong></span>
                      <span style={{ color: '#6d28d9', fontSize: '0.82rem' }}>Crossover: <strong>{generation.claudeDirective.crossoverStrategy}</strong></span>
                      <span style={{ color: '#6d28d9', fontSize: '0.82rem' }}>Survival: <strong>{generation.claudeDirective.survivalPercent}%</strong></span>
                      {generation.claudeDirective.diversityBoost && (
                        <span style={{ color: '#7c3aed', fontSize: '0.82rem', fontWeight: 700 }}>+Diversity boost</span>
                      )}
                    </div>
                    {generation.claudeDirective.reasoning && (
                      <div style={{ padding: '0.65rem 0.9rem', backgroundColor: '#faf5ff', color: '#4c1d95', fontSize: '0.82rem', lineHeight: 1.55 }}>
                        {generation.claudeDirective.reasoning}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ color: '#64748b', fontSize: '0.81rem' }}>{formatDate(generation.completedAt)}</span>
                  {/* AC6 — checkpoint restore */}
                  <button
                    onClick={() => void onRestoreCheckpoint(generation.generation)}
                    disabled={rollbackLoadingGeneration !== null}
                    style={{
                      padding: '0.35rem 0.8rem', borderRadius: '0.65rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      border: '1px solid #cbd5e1', backgroundColor: rollbackLoadingGeneration === generation.generation ? '#f1f5f9' : '#ffffff',
                      color: '#475569',
                    }}
                  >
                    {rollbackLoadingGeneration === generation.generation ? 'Restoring...' : 'Restore checkpoint'}
                  </button>
                </div>
              </div>
              );
            })}

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
  const [pretrainOpen, setPretrainOpen] = useState(false);
  const [pretraining, setPretraining] = useState(false);
  const [pretrainResult, setPretrainResult] = useState<PretrainResult | null>(null);
  const [pretrainError, setPretrainError] = useState<string | null>(null);
  const [pretrainEpisodes, setPretrainEpisodes] = useState(50);
  const [pretrainSteps, setPretrainSteps] = useState(500);
  const [pretrainRegimes, setPretrainRegimes] = useState<MarketRegime[]>([...ALL_REGIMES]);
  const [bestGenome, setBestGenome] = useState<BestGenomeResponse | null>(null);
  const [allLearningStates, setAllLearningStates] = useState<LearningState[]>([]);
  const [learningStatesLoading, setLearningStatesLoading] = useState(false);
  const [learningStatesError, setLearningStatesError] = useState<string | null>(null);
  const [resetLearningLoading, setResetLearningLoading] = useState(false);
  const [resetLearningError, setResetLearningError] = useState<string | null>(null);
  const [resetLearningSuccess, setResetLearningSuccess] = useState<string | null>(null);
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const [resetConfirmData, setResetConfirmData] = useState<{ agentId: string; riskProfile?: string } | null>(null);
  const [learningAdminKey, setLearningAdminKey] = useState('');
  const [algorithmSelection, setAlgorithmSelection] = useState<AgentAlgorithm>(DEFAULT_AGENT_ALGORITHM);
  const [algorithmStateByAgent, setAlgorithmStateByAgent] = useState<Record<string, AgentAlgorithmResponse>>({});
  const [algorithmLoading, setAlgorithmLoading] = useState(false);
  const [algorithmError, setAlgorithmError] = useState<string | null>(null);
  const [algorithmSuccess, setAlgorithmSuccess] = useState<string | null>(null);
  const [rollbackLoadingGeneration, setRollbackLoadingGeneration] = useState<number | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackSuccess, setRollbackSuccess] = useState<number | null>(null);

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
        // Only show the loading spinner on the very first fetch (no data yet).
        // Background refreshes (refreshNonce ticks) update silently so the UI
        // doesn't blank out every 5 seconds and cause visible flickering.
        if (agents.length === 0) setLoadingOverview(true);
        setOverviewError(null);

        const [agentsResponse, leaderboardResponse, summaryResponse, bestGenomeResponse] = await Promise.all([
          fetch('/api/agents?limit=100'),
          fetch('/api/agents/stats/leaderboard?limit=10'),
          fetch('/api/evolutionary/summary'),
          fetch('/api/marl/evolution/best-genome'),
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
        if (bestGenomeResponse.ok) {
          setBestGenome(await bestGenomeResponse.json() as BestGenomeResponse);
        } else {
          setBestGenome(null);
        }
        setSelectedAgentId(current => current ?? normalizedAgents[0]?.id ?? null);
      } catch (error) {
        setOverviewError(error instanceof Error ? error.message : 'Failed to load agent data');
      } finally {
        setLoadingOverview(false);
      }
    };

    void loadOverview();
    // agents.length is read only to decide whether to show the first-load spinner; including it would refetch every time agents changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  useEffect(() => {
    const loadLearningStates = async () => {
      try {
        setLearningStatesLoading(true);
        setLearningStatesError(null);
        const response = await fetch('/api/marl/agents/learning');
        if (!response.ok) throw new Error(`Failed to load learning states: HTTP ${response.status}`);
        const data = await response.json() as LearningStatesResponse;
        setAllLearningStates(data.agents ?? []);
      } catch (error) {
        setLearningStatesError(error instanceof Error ? error.message : 'Failed to load learning states');
      } finally {
        setLearningStatesLoading(false);
      }
    };

    void loadLearningStates();
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
        // Only show loading state when the agent selection has changed; background
        // refreshes via refreshNonce should update silently without clearing the panel.
        if (selectedAgent?.id !== selectedAgentId) setLoadingDetail(true);
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
    // selectedAgent?.id is read only to decide whether to flash the loading spinner; including it would cause an extra fetch right after selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId, refreshNonce]);

  useEffect(() => {
    if (!selectedTournamentId) {
      setSelectedTournament(null);
      return;
    }

    const loadTournament = async () => {
      try {
        // Only show loading state when switching to a different tournament;
        // background refreshes update silently.
        if (selectedTournament?.tournamentId !== selectedTournamentId) setLoadingTournamentDetail(true);
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
    // selectedTournament?.tournamentId is read only to decide whether to flash the loading spinner; including it would cause re-fetches on every load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournamentId, refreshNonce]);

  useEffect(() => {
    if (!selectedTournament) return;

    const maxGeneration = Math.max(...selectedTournament.generations.map(generation => generation.generation), 1);
    setGenerationRange({ start: 1, end: maxGeneration });
    // Resetting the slider when the tournament identity changes is the intent; generations content updates should not reset user-selected range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournament?.tournamentId]);

  useEffect(() => {
    if (!selectedAgent || selectedAgent.status !== 'ACTIVE') {
      setRetireConfirmOpen(false);
      setShowResetConfirmation(false);
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAlgorithmSelection(DEFAULT_AGENT_ALGORITHM);
      setAlgorithmError(null);
      setAlgorithmSuccess(null);
      return;
    }

    const storedAlgorithm = algorithmStateByAgent[selectedAgentId]?.algorithm;
    setAlgorithmSelection(storedAlgorithm === 'POLICY_GRADIENT' || storedAlgorithm === 'DQN' ? storedAlgorithm : DEFAULT_AGENT_ALGORITHM);
    setAlgorithmError(null);
    setAlgorithmSuccess(null);
    // algorithmStateByAgent is read to seed the selection at agent-switch time only; including it would reset user edits on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

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
  const filteredRecentTournamentIdsKey = filteredRecentTournamentIds.join('|');

  useEffect(() => {
    if (!evolutionSummary) return;

    if (filteredRecentTournamentIds.length === 0) {
      setSelectedTournamentId(null);
      return;
    }

    if (!selectedTournamentId || !filteredRecentTournamentIds.includes(selectedTournamentId)) {
      setSelectedTournamentId(filteredRecentTournamentIds[0] ?? null);
    }
    // filteredRecentTournamentIds is referentially fresh each render; the joined key tracks its contents and avoids infinite loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolutionSummary, selectedTournamentId, filteredRecentTournamentIdsKey]);

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

  const agentLearningStates = allLearningStates.filter(state => state.agentId === selectedAgentId);
  const currentAlgorithmState = selectedAgentId ? algorithmStateByAgent[selectedAgentId] ?? null : null;

  const updateAlgorithmState = async (
    agentId: string,
    algorithm: AgentAlgorithm,
    successMessage?: string,
  ) => {
    try {
      setAlgorithmLoading(true);
      setAlgorithmError(null);
      setAlgorithmSuccess(null);

      const response = await fetch(`/api/marl/agents/${agentId}/algorithm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ algorithm }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || `Failed to update algorithm: HTTP ${response.status}`);
      }

      const result = await response.json() as AgentAlgorithmResponse;
      setAlgorithmStateByAgent(current => ({ ...current, [agentId]: result }));
      setAlgorithmSelection(result.algorithm === 'POLICY_GRADIENT' || result.algorithm === 'DQN' ? result.algorithm : DEFAULT_AGENT_ALGORITHM);
      if (successMessage) {
        setAlgorithmSuccess(successMessage);
      }
    } catch (error) {
      setAlgorithmError(error instanceof Error ? error.message : 'Failed to update algorithm state');
    } finally {
      setAlgorithmLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedAgentId || algorithmStateByAgent[selectedAgentId]) return;

    void updateAlgorithmState(selectedAgentId, DEFAULT_AGENT_ALGORITHM);
  }, [selectedAgentId, algorithmStateByAgent]);

  const restoreCheckpoint = async (generation: number) => {
    if (!selectedTournamentId) return;
    try {
      setRollbackLoadingGeneration(generation);
      setRollbackError(null);
      setRollbackSuccess(null);
      const response = await fetch(`/api/evolutionary/tournament/${selectedTournamentId}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
        throw new Error(errorData.error ?? `HTTP ${response.status}`);
      }
      setRollbackSuccess(generation);
      setRefreshNonce(value => value + 1);
    } catch (error) {
      setRollbackError(error instanceof Error ? error.message : 'Failed to restore checkpoint');
    } finally {
      setRollbackLoadingGeneration(null);
    }
  };

  const resetLearningState = async (agentId: string, riskProfile?: string) => {
    try {
      setResetLearningError(null);
      setResetLearningSuccess(null);

      if (!learningAdminKey.trim()) {
        throw new Error('Admin API key is required to reset learning state.');
      }

      setResetLearningLoading(true);

      const url = new URL(`${window.location.origin}/api/marl/agents/${agentId}/learning`);
      if (riskProfile) {
        url.searchParams.set('riskProfile', riskProfile);
      }

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          'x-api-key': learningAdminKey.trim(),
        },
      });

      if (response.status === 401) {
        throw new Error('Unauthorized — API key required or invalid');
      }
      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || `Failed to reset learning: HTTP ${response.status}`);
      }

      const result = await response.json() as { message: string; cleared: number };
      setResetLearningSuccess(result.message);
      setShowResetConfirmation(false);
      setResetConfirmData(null);
      setRefreshNonce(value => value + 1);
    } catch (error) {
      setResetLearningError(error instanceof Error ? error.message : 'Failed to reset learning state');
    } finally {
      setResetLearningLoading(false);
    }
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

  const openPretrain = () => {
    setPretrainResult(null);
    setPretrainError(null);
    setPretrainOpen(true);
  };

  const runPretrain = async () => {
    if (!selectedAgent) return;

    try {
      setPretraining(true);
      setPretrainError(null);
      setPretrainResult(null);

      const response = await fetch(`/api/marl/agents/${selectedAgent.id}/pretrain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: pretrainEpisodes,
          stepsPerEpisode: pretrainSteps,
          riskProfile: selectedAgent.risk_profile,
          regimes: pretrainRegimes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(typeof errorData.error === 'string' ? errorData.error : `HTTP ${response.status}`);
      }

      setPretrainResult(await response.json() as PretrainResult);
    } catch (error) {
      setPretrainError(error instanceof Error ? error.message : 'Pre-training failed');
    } finally {
      setPretraining(false);
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
                  const isAdversary = agent.agent_type === 'ADVERSARY';
                  const accent = isAdversary ? '#dc2626' : (agent.color ?? '#2563eb');

                  return (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      style={{
                        textAlign: 'left',
                        width: '100%',
                        padding: '0.95rem',
                        borderRadius: '0.95rem',
                        border: selected
                          ? `2px solid ${accent}`
                          : isAdversary
                          ? '1px solid #fecaca'
                          : '1px solid #e2e8f0',
                        background: selected
                          ? isAdversary
                            ? 'linear-gradient(135deg, rgba(254, 226, 226, 0.95), rgba(255, 255, 255, 1))'
                            : 'linear-gradient(135deg, rgba(219, 234, 254, 0.95), rgba(255, 255, 255, 1))'
                          : isAdversary
                          ? '#fff5f5'
                          : '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
                          <AgentAvatar seed={agent.id} color={agent.color} size={44} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '1rem' }}>{displayName(agent)}</span>
                              {isAdversary && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '999px', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                                  ADVERSARY
                                </span>
                              )}
                            </div>
                            <div style={{ marginTop: '0.25rem', color: '#64748b', fontSize: '0.85rem' }}>{agent.agent_type} · {agent.risk_profile}</div>
                          </div>
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
              {leaderboard.map((agent, index) => {
                const isAdversary = agent.agent_type === 'ADVERSARY';
                return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  style={{
                    textAlign: 'left',
                    width: '100%',
                    padding: '0.85rem 0.95rem',
                    borderRadius: '0.9rem',
                    border: isAdversary ? '1px solid #fecaca' : '1px solid #e2e8f0',
                    backgroundColor: isAdversary ? '#fff5f5' : '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                      <AgentAvatar seed={agent.id} color={agent.color} size={32} />
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>#{index + 1} {displayName(agent)}</span>
                      {isAdversary && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.45rem', borderRadius: '999px', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                          ADV
                        </span>
                      )}
                    </div>
                    <div style={{ color: isAdversary ? '#b91c1c' : '#1d4ed8', fontWeight: 800 }}>{formatPercent(agent.win_rate_percent)}</div>
                  </div>
                  <div style={{ marginTop: '0.4rem', color: '#64748b', fontSize: '0.85rem' }}>
                    {formatCurrency(agent.total_pnl)} pnl · Sharpe {agent.sharpe_ratio.toFixed(2)}
                  </div>
                </button>
                );
              })}
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
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', minWidth: 0 }}>
                    <AgentAvatar seed={agent.id} color={agent.color} size={36} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#0f172a', fontWeight: 700 }}>{displayName(agent)}</div>
                      <div style={{ marginTop: '0.2rem', color: '#64748b', fontSize: '0.85rem' }}>{agent.agent_type} · Gen {agent.generation_number ?? 0}</div>
                    </div>
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

          {bestGenome && (
            <div style={{ ...panelStyle, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>Best Genome Ever</h3>
                <span style={{ padding: '0.25rem 0.6rem', borderRadius: '999px', backgroundColor: '#f0fdf4', color: '#15803d', fontSize: '0.8rem', fontWeight: 700 }}>
                  Fitness {bestGenome.fitnessScore.toFixed(1)}
                </span>
              </div>
              <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.65rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Agent</div>
                  <div style={{ marginTop: '0.3rem', color: '#0f172a', fontWeight: 700, fontSize: '0.88rem' }}>{bestGenome.agentId.slice(0, 12)}</div>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.75rem', padding: '0.65rem' }}>
                  <div style={{ color: '#64748b', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Generation</div>
                  <div style={{ marginTop: '0.3rem', color: '#0f172a', fontWeight: 700, fontSize: '0.88rem' }}>{bestGenome.generation}</div>
                </div>
              </div>
              <pre
                style={{
                  marginTop: '0.85rem',
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  overflowX: 'auto',
                  fontSize: '0.78rem',
                  lineHeight: 1.5,
                  maxHeight: '12rem',
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(bestGenome.genome ?? {}, null, 2)}
              </pre>
              <div style={{ marginTop: '0.6rem', color: '#64748b', fontSize: '0.8rem' }}>
                Tournament {bestGenome.tournamentId.slice(0, 12)} · {formatDate(bestGenome.foundAt)}
              </div>
            </div>
          )}

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
            onRestoreCheckpoint={restoreCheckpoint}
            rollbackLoadingGeneration={rollbackLoadingGeneration}
            rollbackError={rollbackError}
            rollbackSuccess={rollbackSuccess}
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
                    <AgentAvatar seed={selectedAgent.id} color={selectedAgent.color} size={56} label={`Avatar for ${displayName(selectedAgent)}`} />
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
                    onClick={openPretrain}
                    style={{
                      alignSelf: 'start',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.85rem',
                      border: '1px solid #a5b4fc',
                      backgroundColor: '#eef2ff',
                      color: '#4338ca',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Pre-Train
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

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0, color: '#0f172a' }}>Learning States</h4>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{agentLearningStates.length} profile(s)</span>
                </div>
                <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.35rem' }}>
                  <label style={{ color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
                    Admin API key
                  </label>
                  <input
                    type="password"
                    value={learningAdminKey}
                    onChange={event => setLearningAdminKey(event.target.value)}
                    placeholder="Required for reset operations"
                    aria-label="Admin API key for learning state reset"
                    style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem' }}
                  />
                  <div style={{ color: '#64748b', fontSize: '0.82rem' }}>
                    Listing is read-only. Reset actions require the server API secret key.
                  </div>
                </div>
                {learningStatesError && (
                  <div role="alert" style={{ marginTop: '0.75rem', color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.9rem' }}>
                    {learningStatesError}
                  </div>
                )}
                {resetLearningError && (
                  <div role="alert" style={{ marginTop: '0.75rem', color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.9rem' }}>
                    {resetLearningError}
                  </div>
                )}
                {resetLearningSuccess && (
                  <div style={{ marginTop: '0.75rem', color: '#166534', backgroundColor: '#dcfce7', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.9rem' }}>
                    {resetLearningSuccess}
                  </div>
                )}
                <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.7rem' }}>
                  {learningStatesLoading ? (
                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading learning states...</div>
                  ) : agentLearningStates.length === 0 ? (
                    <div style={{ color: '#64748b', fontSize: '0.9rem' }}>No learning state stored for this agent.</div>
                  ) : (
                    <>
                      {agentLearningStates.map(state => (
                        <div key={state.cacheKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.8rem', padding: '0.75rem' }}>
                          <div>
                            <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.9rem' }}>{state.riskProfile}</div>
                            <div style={{ marginTop: '0.2rem', color: '#64748b', fontSize: '0.8rem' }}>Risk profile learning state</div>
                          </div>
                          <button
                            onClick={() => {
                              setResetConfirmData({ agentId: state.agentId, riskProfile: state.riskProfile });
                              setShowResetConfirmation(true);
                            }}
                            disabled={resetLearningLoading}
                            style={{
                              padding: '0.5rem 0.85rem',
                              borderRadius: '0.7rem',
                              border: '1px solid #dc2626',
                              backgroundColor: '#fef2f2',
                              color: '#b91c1c',
                              fontWeight: 600,
                              cursor: resetLearningLoading ? 'not-allowed' : 'pointer',
                              fontSize: '0.85rem',
                              opacity: resetLearningLoading ? 0.6 : 1,
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          setResetConfirmData({ agentId: selectedAgentId || '', riskProfile: undefined });
                          setShowResetConfirmation(true);
                        }}
                        disabled={resetLearningLoading || agentLearningStates.length === 0}
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.6rem 0.85rem',
                          borderRadius: '0.7rem',
                          border: '1px solid #dc2626',
                          backgroundColor: '#dc2626',
                          color: '#ffffff',
                          fontWeight: 700,
                          cursor: resetLearningLoading || agentLearningStates.length === 0 ? 'not-allowed' : 'pointer',
                          fontSize: '0.85rem',
                          opacity: resetLearningLoading || agentLearningStates.length === 0 ? 0.6 : 1,
                        }}
                      >
                        {resetLearningLoading ? 'Resetting...' : 'Reset All Profiles'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.95rem', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0, color: '#0f172a' }}>Algorithm</h4>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>No full page reload required</span>
                </div>
                <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.9rem' }}>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem', backgroundColor: '#f8fafc' }}>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current algorithm</div>
                    <div style={{ marginTop: '0.45rem', color: '#0f172a', fontSize: '1.15rem', fontWeight: 800 }}>
                      {currentAlgorithmState?.algorithm ?? DEFAULT_AGENT_ALGORITHM}
                    </div>
                    <div style={{ marginTop: '0.35rem', color: '#475569', fontSize: '0.88rem', lineHeight: 1.5 }}>
                      {currentAlgorithmState?.note ?? 'Loading algorithm metadata for this agent.'}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
                    <label htmlFor="agent-algorithm-select" style={{ display: 'block', color: '#334155', fontSize: '0.9rem', fontWeight: 600 }}>
                      Select algorithm
                    </label>
                    <select
                      id="agent-algorithm-select"
                      value={algorithmSelection}
                      onChange={event => setAlgorithmSelection(event.target.value as AgentAlgorithm)}
                      aria-label="Select algorithm"
                      disabled={algorithmLoading}
                      style={{ marginTop: '0.55rem', width: '100%', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1', fontSize: '0.95rem', backgroundColor: '#ffffff' }}
                    >
                      {ALGORITHM_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div style={{ marginTop: '0.45rem', color: '#64748b', fontSize: '0.82rem' }}>
                      {ALGORITHM_OPTIONS.find(option => option.value === algorithmSelection)?.description}
                    </div>
                    <div style={{ marginTop: '0.8rem', display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => {
                          if (!selectedAgentId) return;
                          void updateAlgorithmState(selectedAgentId, algorithmSelection, `Algorithm updated to ${algorithmSelection}.`);
                        }}
                        disabled={algorithmLoading || !selectedAgentId}
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderRadius: '0.75rem',
                          border: 'none',
                          backgroundColor: '#0f766e',
                          color: '#ffffff',
                          fontWeight: 700,
                          cursor: algorithmLoading || !selectedAgentId ? 'not-allowed' : 'pointer',
                          opacity: algorithmLoading || !selectedAgentId ? 0.6 : 1,
                        }}
                      >
                        {algorithmLoading ? 'Applying...' : 'Apply Algorithm'}
                      </button>
                      <button
                        onClick={() => {
                          if (!selectedAgentId) return;
                          void updateAlgorithmState(selectedAgentId, algorithmSelection);
                        }}
                        disabled={algorithmLoading || !selectedAgentId}
                        style={{
                          padding: '0.65rem 0.9rem',
                          borderRadius: '0.75rem',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#ffffff',
                          color: '#0f172a',
                          fontWeight: 700,
                          cursor: algorithmLoading || !selectedAgentId ? 'not-allowed' : 'pointer',
                          opacity: algorithmLoading || !selectedAgentId ? 0.6 : 1,
                        }}
                      >
                        Refresh State
                      </button>
                    </div>
                  </div>
                </div>
                {algorithmError && (
                  <div role="alert" style={{ marginTop: '0.75rem', color: '#b91c1c', backgroundColor: '#fee2e2', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.9rem' }}>
                    {algorithmError}
                  </div>
                )}
                {algorithmSuccess && (
                  <div style={{ marginTop: '0.75rem', color: '#166534', backgroundColor: '#dcfce7', padding: '0.75rem', borderRadius: '0.75rem', fontSize: '0.9rem' }}>
                    {algorithmSuccess}
                  </div>
                )}
                <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.75rem' }}>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Architecture</div>
                    <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700, fontSize: '0.9rem' }}>
                      {currentAlgorithmState?.policyNetwork.architecture ?? 'Loading...'}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Update rule</div>
                    <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700, fontSize: '0.9rem' }}>
                      {currentAlgorithmState?.policyNetwork.updateRule ?? 'Loading...'}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.85rem', padding: '0.85rem' }}>
                    <div style={{ color: '#64748b', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Replay buffer</div>
                    <div style={{ marginTop: '0.35rem', color: '#0f172a', fontWeight: 700, fontSize: '0.9rem' }}>
                      {currentAlgorithmState?.policyNetwork.replayBuffer ?? 'Loading...'}
                    </div>
                  </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h4 style={{ margin: 0, color: '#0f172a' }}>Genome Snapshot</h4>
                  {/* AC2 — model architecture badge */}
                  {genome && Boolean((genome.genome as Record<string, unknown>).modelArchitecture) && (
                    <span style={{
                      padding: '0.25rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                      backgroundColor: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd',
                    }}>
                      {String((genome.genome as Record<string, unknown>).modelArchitecture)}
                    </span>
                  )}
                </div>
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

      {showResetConfirmation && selectedAgent && resetConfirmData && (
        <ResetLearningConfirmationModal
          agent={selectedAgent}
          riskProfile={resetConfirmData.riskProfile}
          loading={resetLearningLoading}
          onCancel={() => setShowResetConfirmation(false)}
          onConfirm={() => resetLearningState(resetConfirmData.agentId, resetConfirmData.riskProfile)}
        />
      )}

      {pretrainOpen && selectedAgent && (
        <PretrainModal
          agent={selectedAgent}
          pretraining={pretraining}
          result={pretrainResult}
          error={pretrainError}
          episodes={pretrainEpisodes}
          steps={pretrainSteps}
          regimes={pretrainRegimes}
          onClose={() => setPretrainOpen(false)}
          onEpisodesChange={setPretrainEpisodes}
          onStepsChange={setPretrainSteps}
          onRegimesChange={setPretrainRegimes}
          onRun={runPretrain}
        />
      )}
    </section>
  );
}