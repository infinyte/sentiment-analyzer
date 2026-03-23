import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from 'react';
import { Line } from 'react-chartjs-2';
import { useMarlCompetition } from '../hooks/useMarlCompetition';
import type {
  CompetitionConfig,
  CompetitionAgent as CompetitionAgentSpec,
  SymbolSelectionMode,
  ExchangeMode,
  CoinUniverseResponse,
  ScoredCoinEntry,
} from '../types/marl';

type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
type CompetitionMode = 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';

interface MarlInfoResponse {
  description: string;
  tournamentModes: Record<string, string>;
  riskProfiles: Record<string, Record<string, string | number>>;
  learningAlgorithm: {
    type: string;
    stateSpace: string;
    actionSpace: string[];
    policyNetwork: string;
    explorationStrategy: string;
    replayBuffer: string;
  };
  endpoints: Record<string, string>;
}

interface EquityCurvesResponse {
  competitionId: string;
  status: 'RUNNING' | 'COMPLETED';
  message?: string;
  progress?: number;
  snapshotCount?: number;
  equityCurves?: Array<{
    timestamp: string;
    agentEquities: Array<{ agentId: string; equity: number }>;
  }>;
}

// ─── Style constants ─────────────────────────────────────────────────────────

const card: CSSProperties = {
  backgroundColor: 'var(--surface)',
  borderRadius: '0.75rem',
  padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  marginBottom: '1rem',
};

const label: CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: '600',
  color: 'var(--text-muted)',
  marginBottom: '0.25rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const input: CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--border-input)',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  boxSizing: 'border-box',
  backgroundColor: 'var(--surface)',
  color: 'var(--text)',
};

const btn = (color = '#2563eb'): CSSProperties => ({
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
      <input
        type="number"
        style={{ ...input, flex: 1.1 }}
        value={agent.initialCapital ?? 10000}
        min={100}
        step={100}
        placeholder="Starting Capital"
        onChange={e => onChange({ ...agent, initialCapital: Number(e.target.value) })}
      />
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
    error, liveEquitySnapshots, liveTradeFeed, isStreamConnected, transport,
    startCompetition, compareAgents, loadList, reset,
  } = useMarlCompetition();

  // ── Form state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CompetitionMode>('SINGLE');
  const [agents, setAgents] = useState<CompetitionAgentSpec[]>([
    { id: 'bull', riskProfile: 'AGGRESSIVE', initialCapital: 10000 },
    { id: 'bear', riskProfile: 'CONSERVATIVE', initialCapital: 10000 },
  ]);
  const [symbolInput, setSymbolInput] = useState('BTC,ETH');
  const [symbolSelectionMode, setSymbolSelectionMode] = useState<SymbolSelectionMode>('MANUAL');
  const [autoUniverseSize, setAutoUniverseSize] = useState(50);
  const [autoCoinsPerAgent, setAutoCoinsPerAgent] = useState(3);
  const [coinUniverse, setCoinUniverse] = useState<CoinUniverseResponse | null>(null);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [duration, setDuration] = useState(200);
  const [evolutionaryRounds, setEvolutionaryRounds] = useState(3);
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [exchangeMode, setExchangeMode] = useState<ExchangeMode>('SIMULATED');
  const [brokerCredentialId, setBrokerCredentialId] = useState('');
  const [availableCredentials, setAvailableCredentials] = useState<Array<{ id: string; label: string; provider: string; mode: string }>>([]);

  // ── Add-credential modal state ────────────────────────────────────────────
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [newCredLabel, setNewCredLabel] = useState('');
  const [newCredApiKey, setNewCredApiKey] = useState('');
  const [newCredApiSecret, setNewCredApiSecret] = useState('');
  const [newCredAdminKey, setNewCredAdminKey] = useState('');
  const [newCredSaving, setNewCredSaving] = useState(false);
  const [newCredError, setNewCredError] = useState<string | null>(null);

  // ── Trade log state ───────────────────────────────────────────────────────
  const [tradeLog, setTradeLog] = useState<Array<{ agentId: string; tradesExecuted: number; finalCapital: number; totalReturn: number; winRate: number }> | null>(null);
  const [tradeLogOpen, setTradeLogOpen] = useState(false);

  // ── Compare form state ────────────────────────────────────────────────────
  const [showCompare, setShowCompare] = useState(false);
  const [cmpA, setCmpA] = useState<CompetitionAgentSpec>({ id: 'aggressive', riskProfile: 'AGGRESSIVE', initialCapital: 10000 });
  const [cmpB, setCmpB] = useState<CompetitionAgentSpec>({ id: 'conservative', riskProfile: 'CONSERVATIVE', initialCapital: 10000 });
  const [cmpRounds, setCmpRounds] = useState(3);
  const [cmpDuration, setCmpDuration] = useState(100);

  // ── Info and equity reload state ────────────────────────────────────────
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoData, setInfoData] = useState<MarlInfoResponse | null>(null);
  const [equityReloadId, setEquityReloadId] = useState('');
  const [equityReloadLoading, setEquityReloadLoading] = useState(false);
  const [equityReloadError, setEquityReloadError] = useState<string | null>(null);
  const [equityReloadMessage, setEquityReloadMessage] = useState<string | null>(null);
  const [reloadedEquityCurves, setReloadedEquityCurves] = useState<EquityCurvesResponse['equityCurves'] | null>(null);

  // ── Broker Admin state ───────────────────────────────────────────────────────
  const [brokerAdminOpen, setBrokerAdminOpen] = useState(false);
  const [brokerAdminLoading, setBrokerAdminLoading] = useState(false);
  const [brokerAdminError, setBrokerAdminError] = useState<string | null>(null);
  const [brokerAdminKey, setBrokerAdminKey] = useState('');
  const [brokerCredentialsList, setBrokerCredentialsList] = useState<Array<{
    id: string; label: string; provider: string; mode: string; createdAt: string; lastUsed?: string; connected: boolean;
  }> | null>(null);
  const [connectedCredentials, setConnectedCredentials] = useState<Array<{
    id: string; label?: string; provider?: string; mode?: string;
  }> | null>(null);
  const [brokerAdminActionLoading, setBrokerAdminActionLoading] = useState<string | null>(null);
  const [brokerAdminActionError, setBrokerAdminActionError] = useState<string | null>(null);
  const [showConnectConfirm, setShowConnectConfirm] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // ── Broker order audit + emergency stop state ─────────────────────────────
  const [brokerOrdersCompetitionId, setBrokerOrdersCompetitionId] = useState('');
  const [brokerOrdersAgentId, setBrokerOrdersAgentId] = useState('');
  const [brokerOrdersLoading, setBrokerOrdersLoading] = useState(false);
  const [brokerOrdersError, setBrokerOrdersError] = useState<string | null>(null);
  const [brokerOrders, setBrokerOrders] = useState<Array<{
    clientOrderId: string;
    brokerOrderId?: string;
    agentId: string;
    symbol: string;
    side: string;
    quantity: number;
    limitPrice?: number;
    status: string;
    filledQuantity?: number;
    avgFillPrice?: number;
    submittedAt: string;
    updatedAt: string;
  }> | null>(null);
  const [emergencyCompetitionId, setEmergencyCompetitionId] = useState('');
  const [emergencyCredentialId, setEmergencyCredentialId] = useState('');
  const [emergencyStopLoading, setEmergencyStopLoading] = useState(false);
  const [emergencyStopError, setEmergencyStopError] = useState<string | null>(null);
  const [emergencyStopSuccess, setEmergencyStopSuccess] = useState<string | null>(null);
  const [showEmergencyStopConfirm, setShowEmergencyStopConfirm] = useState(false);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (results?.competitionId) {
      setEquityReloadId(results.competitionId);
      setBrokerOrdersCompetitionId(results.competitionId);
      setEmergencyCompetitionId(results.competitionId);
      setReloadedEquityCurves(null);
      setEquityReloadError(null);
      setEquityReloadMessage(null);
    }
  }, [results?.competitionId]);

  useEffect(() => {
    if (!results?.competitionId) {
      setTradeLog(null);
      setTradeLogOpen(false);
      return;
    }
    fetch(`/api/marl/competition/${results.competitionId}/trade-log`)
      .then(r => r.ok ? r.json() as Promise<{ agentTradeSummaries: Array<{ agentId: string; tradesExecuted: number; finalCapital: number; totalReturn: number; winRate: number }> }> : Promise.reject())
      .then(data => setTradeLog(data.agentTradeSummaries ?? null))
      .catch(() => setTradeLog(null));
  }, [results?.competitionId]);

  // Fetch available broker credentials when switching to PAPER or LIVE mode
  useEffect(() => {
    if (exchangeMode === 'SIMULATED') {
      setAvailableCredentials([]);
      setBrokerCredentialId('');
      return;
    }
    fetch('/api/marl/broker/credentials/picker')
      .then(r => r.ok ? r.json() as Promise<{ credentials: Array<{ id: string; label: string; provider: string; mode: string }> }> : Promise.reject())
      .then(data => {
        const matching = data.credentials.filter(c => c.mode === exchangeMode);
        setAvailableCredentials(matching);
        // Auto-select if exactly one credential matches
        if (matching.length === 1) setBrokerCredentialId(matching[0]!.id);
        else setBrokerCredentialId('');
      })
      .catch(() => {
        setAvailableCredentials([]);
        setBrokerCredentialId('');
      });
  }, [exchangeMode]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const symbols = symbolSelectionMode === 'MANUAL'
      ? symbolInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    const config: CompetitionConfig = {
      mode,
      agents,
      symbols,
      symbolSelectionMode,
      autoUniverseSize: symbolSelectionMode === 'AUTO' ? autoUniverseSize : undefined,
      autoCoinsPerAgent: symbolSelectionMode === 'AUTO' ? autoCoinsPerAgent : undefined,
      duration,
      refreshInterval: 1000,
      evolutionaryRounds: mode === 'EVOLUTIONARY' ? evolutionaryRounds : undefined,
      learningEnabled,
      exchangeMode,
      brokerCredentialId: exchangeMode !== 'SIMULATED' ? brokerCredentialId.trim() || undefined : undefined,
    };
    startCompetition(config);
  };

  const previewUniverse = useCallback(async () => {
    setUniverseLoading(true);
    setCoinUniverse(null);
    try {
      const agentsParam = JSON.stringify(agents.map(a => ({ id: a.id, riskProfile: a.riskProfile })));
      const url = `/api/marl/coin-universe?agents=${encodeURIComponent(agentsParam)}&universeSize=${autoUniverseSize}&coinsPerAgent=${autoCoinsPerAgent}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load coin universe');
      setCoinUniverse(await res.json() as CoinUniverseResponse);
    } catch {
      // non-fatal — preview is optional
    } finally {
      setUniverseLoading(false);
    }
  }, [agents, autoUniverseSize, autoCoinsPerAgent]);

  const handleCompare = (e: FormEvent) => {
    e.preventDefault();
    const symbols = symbolInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    compareAgents(cmpA, cmpB, symbols, cmpRounds, cmpDuration);
  };

  const handleSaveCredential = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setNewCredSaving(true);
    setNewCredError(null);
    try {
      const res = await fetch('/api/marl/broker/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': newCredAdminKey.trim(),
        },
        body: JSON.stringify({
          label: newCredLabel.trim() || undefined,
          provider: 'ALPACA',
          mode: exchangeMode,
          apiKey: newCredApiKey.trim(),
          apiSecret: newCredApiSecret.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const created = await res.json() as { id: string };
      setNewCredLabel('');
      setNewCredApiKey('');
      setNewCredApiSecret('');
      setCredModalOpen(false);
      // Refresh the picker and auto-select the newly created credential
      const pickerRes = await fetch('/api/marl/broker/credentials/picker');
      if (pickerRes.ok) {
        const pickerData = await pickerRes.json() as { credentials: Array<{ id: string; label: string; provider: string; mode: string }> };
        const matching = pickerData.credentials.filter(c => c.mode === exchangeMode);
        setAvailableCredentials(matching);
        setBrokerCredentialId(created.id);
      }
    } catch (err) {
      setNewCredError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setNewCredSaving(false);
    }
  }, [newCredAdminKey, newCredLabel, newCredApiKey, newCredApiSecret, exchangeMode]);

  const addAgent = () => {
    if (agents.length < 10) {
      setAgents([...agents, { id: `agent_${agents.length + 1}`, riskProfile: 'CONSERVATIVE', initialCapital: 10000 }]);
    }
  };

  const loadInfoPanel = useCallback(async () => {
    if (infoLoading) return;
    if (infoData) {
      setInfoOpen(open => !open);
      return;
    }

    setInfoOpen(true);
    setInfoLoading(true);
    setInfoError(null);
    try {
      const res = await fetch('/api/marl/info');
      const payload = await res.json().catch(() => ({})) as MarlInfoResponse & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to load MARL info (${res.status})`);
      }
      setInfoData(payload);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Failed to load MARL info');
    } finally {
      setInfoLoading(false);
    }
  }, [infoData, infoLoading]);

  const fetchBrokerAdminData = useCallback(async () => {
    if (!brokerAdminKey.trim()) {
      setBrokerAdminError('Enter your API secret key (x-api-key) to access broker admin controls.');
      setBrokerCredentialsList(null);
      setConnectedCredentials(null);
      return;
    }

    setBrokerAdminLoading(true);
    setBrokerAdminError(null);
    setBrokerAdminActionError(null);
    try {
      // Fetch credentials
      const credRes = await fetch('/api/marl/broker/credentials', {
        headers: { 'x-api-key': brokerAdminKey.trim() },
      });
      if (!credRes.ok) throw new Error(`HTTP ${credRes.status}: Failed to load credentials`);
      const credData = await credRes.json() as { credentials: typeof brokerCredentialsList };
      setBrokerCredentialsList(credData.credentials ?? []);

      // Fetch connected adapters
      const connRes = await fetch('/api/marl/broker/connected', {
        headers: { 'x-api-key': brokerAdminKey.trim() },
      });
      if (!connRes.ok) throw new Error(`HTTP ${connRes.status}: Failed to load connected adapters`);
      const connData = await connRes.json() as { connected: Array<{ id: string; label?: string; provider?: string; mode?: string }> };
      setConnectedCredentials(connData.connected ?? []);
    } catch (err) {
      setBrokerAdminError(err instanceof Error ? err.message : 'Failed to load broker admin data');
      setBrokerCredentialsList(null);
      setConnectedCredentials(null);
    } finally {
      setBrokerAdminLoading(false);
    }
  }, [brokerAdminKey]);

  const handleFetchBrokerOrders = useCallback(async () => {
    if (!brokerAdminKey.trim()) {
      setBrokerOrdersError('Admin API key is required.');
      return;
    }

    const competitionId = brokerOrdersCompetitionId.trim();
    if (!competitionId) {
      setBrokerOrdersError('Competition ID is required to audit broker orders.');
      return;
    }

    setBrokerOrdersLoading(true);
    setBrokerOrdersError(null);
    try {
      const query = brokerOrdersAgentId.trim() ? `?agentId=${encodeURIComponent(brokerOrdersAgentId.trim())}` : '';
      const res = await fetch(`/api/marl/broker/orders/${encodeURIComponent(competitionId)}${query}`, {
        headers: { 'x-api-key': brokerAdminKey.trim() },
      });
      const payload = await res.json().catch(() => ({})) as {
        orders?: Array<{
          clientOrderId: string;
          brokerOrderId?: string;
          agentId: string;
          symbol: string;
          side: string;
          quantity: number;
          limitPrice?: number;
          status: string;
          filledQuantity?: number;
          avgFillPrice?: number;
          submittedAt: string;
          updatedAt: string;
        }>;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? `Failed to load broker orders (${res.status})`);
      setBrokerOrders(payload.orders ?? []);
    } catch (err) {
      setBrokerOrdersError(err instanceof Error ? err.message : 'Failed to load broker orders.');
      setBrokerOrders(null);
    } finally {
      setBrokerOrdersLoading(false);
    }
  }, [brokerAdminKey, brokerOrdersCompetitionId, brokerOrdersAgentId]);

  const handleEmergencyStop = useCallback(async () => {
    if (!brokerAdminKey.trim()) {
      setEmergencyStopError('Admin API key is required.');
      return;
    }

    const competitionId = emergencyCompetitionId.trim();
    const credentialId = emergencyCredentialId.trim();
    if (!competitionId || !credentialId) {
      setEmergencyStopError('competitionId and credentialId are required.');
      return;
    }

    setEmergencyStopLoading(true);
    setEmergencyStopError(null);
    setEmergencyStopSuccess(null);
    try {
      const res = await fetch('/api/marl/broker/emergency-stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': brokerAdminKey.trim(),
        },
        body: JSON.stringify({ competitionId, credentialId }),
      });
      const payload = await res.json().catch(() => ({})) as { emergencyStop?: boolean; cancelled?: number; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Emergency stop failed (${res.status})`);
      setEmergencyStopSuccess(`Emergency stop executed for ${competitionId}. Cancelled ${payload.cancelled ?? 0} open order(s).`);
      setShowEmergencyStopConfirm(false);
      await handleFetchBrokerOrders();
    } catch (err) {
      setEmergencyStopError(err instanceof Error ? err.message : 'Emergency stop failed.');
    } finally {
      setEmergencyStopLoading(false);
    }
  }, [brokerAdminKey, emergencyCompetitionId, emergencyCredentialId, handleFetchBrokerOrders]);

  useEffect(() => {
    if (!connectedCredentials || connectedCredentials.length === 0) {
      setEmergencyCredentialId('');
      return;
    }
    setEmergencyCredentialId(current => current || connectedCredentials[0]!.id);
  }, [connectedCredentials]);

  const handleConnectCredential = useCallback(async (credentialId: string) => {
    setBrokerAdminActionLoading(credentialId);
    setBrokerAdminActionError(null);
    try {
      const res = await fetch(`/api/marl/broker/connect/${encodeURIComponent(credentialId)}`, {
        method: 'POST',
        headers: { 'x-api-key': brokerAdminKey.trim() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // Refresh the panel data
      await fetchBrokerAdminData();
      setShowConnectConfirm(null);
    } catch (err) {
      setBrokerAdminActionError(err instanceof Error ? err.message : 'Failed to connect credential');
    } finally {
      setBrokerAdminActionLoading(null);
    }
  }, [brokerAdminKey, fetchBrokerAdminData]);

  const handleDeleteCredential = useCallback(async (credentialId: string) => {
    setBrokerAdminActionLoading(credentialId);
    setBrokerAdminActionError(null);
    try {
      const res = await fetch(`/api/marl/broker/credentials/${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
        headers: { 'x-api-key': brokerAdminKey.trim() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // Refresh the panel data
      await fetchBrokerAdminData();
      setShowDeleteConfirm(null);
    } catch (err) {
      setBrokerAdminActionError(err instanceof Error ? err.message : 'Failed to delete credential');
    } finally {
      setBrokerAdminActionLoading(null);
    }
  }, [brokerAdminKey, fetchBrokerAdminData]);

  const reloadEquityCurves = useCallback(async () => {
    const targetId = equityReloadId.trim();
    if (!targetId) {
      setEquityReloadError('Enter a competition id to reload equity curves.');
      return;
    }

    setEquityReloadLoading(true);
    setEquityReloadError(null);
    setEquityReloadMessage(null);
    try {
      const res = await fetch(`/api/marl/competition/${encodeURIComponent(targetId)}/equity-curves`);
      const payload = await res.json().catch(() => ({})) as EquityCurvesResponse & { error?: string };

      if (res.status === 202) {
        setReloadedEquityCurves(null);
        setEquityReloadMessage(payload.message ?? `Competition ${targetId} is still running.`);
        return;
      }

      if (!res.ok) {
        throw new Error(payload.error ?? `Unable to reload equity curves (${res.status})`);
      }

      if (!payload.equityCurves || payload.equityCurves.length === 0) {
        setReloadedEquityCurves([]);
        setEquityReloadMessage(`No equity curve data is available for ${targetId}.`);
        return;
      }

      setReloadedEquityCurves(payload.equityCurves);
      setEquityReloadMessage(`Loaded ${payload.snapshotCount ?? payload.equityCurves.length} equity snapshots for ${payload.competitionId}.`);
    } catch (err) {
      setReloadedEquityCurves(null);
      setEquityReloadError(err instanceof Error ? err.message : 'Unable to reload equity curves.');
    } finally {
      setEquityReloadLoading(false);
    }
  }, [equityReloadId]);

  const isLiveMonitorActive = loading && status?.status === 'RUNNING';

  const liveChartData = liveEquitySnapshots.length
    ? (() => {
        const agentIds = liveEquitySnapshots[0].agentEquities.map(ae => ae.agentId);
        const labels = liveEquitySnapshots.map((snap, i) => {
          const stamp = new Date(snap.timestamp);
          return Number.isNaN(stamp.getTime()) ? `Step ${i + 1}` : stamp.toLocaleTimeString();
        });
        return {
          labels,
          datasets: agentIds.map((id, i) => ({
            label: id,
            data: liveEquitySnapshots.map(snap =>
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

  // ── Equity evolution chart ────────────────────────────────────────────────
  const equitySeries = reloadedEquityCurves ?? results?.equityEvolution ?? [];
  const chartData = equitySeries.length
    ? (() => {
        const agentIds = equitySeries[0].agentEquities.map(ae => ae.agentId);
        const labels = equitySeries.map((snap, i) => {
          const stamp = new Date(snap.timestamp);
          return Number.isNaN(stamp.getTime()) ? `Step ${i + 1}` : stamp.toLocaleTimeString();
        });
        return {
          labels,
          datasets: agentIds.map((id, i) => ({
            label: id,
            data: equitySeries.map(snap =>
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

      <div style={{ ...card, padding: '1rem' }}>
        <button
          type="button"
          onClick={() => void loadInfoPanel()}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#111827' }}>MARL Info Panel</div>
            <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Load endpoint documentation, tournament modes, and learning metadata.</div>
          </div>
          <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>{infoOpen ? '▲ hide' : '▼ show'}</span>
        </button>

        {infoOpen && (
          <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.9rem' }}>
            {infoLoading && <div style={{ fontSize: '0.82rem', color: '#6b7280' }}>Loading MARL info…</div>}
            {infoError && <div style={{ fontSize: '0.82rem', color: '#dc2626' }}>{infoError}</div>}
            {infoData && (
              <>
                <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '0.5rem', fontSize: '0.82rem', color: '#475569' }}>
                  {infoData.description}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', fontWeight: '700', color: '#374151' }}>Tournament Modes</h4>
                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                      {Object.entries(infoData.tournamentModes).map(([modeName, description]) => (
                        <div key={modeName}>
                          <div style={{ fontSize: '0.76rem', fontWeight: '700', color: '#111827' }}>{modeName}</div>
                          <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{description}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
                    <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', fontWeight: '700', color: '#374151' }}>Learning Algorithm</h4>
                    <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.78rem', color: '#6b7280' }}>
                      <div><strong style={{ color: '#111827' }}>Type:</strong> {infoData.learningAlgorithm.type}</div>
                      <div><strong style={{ color: '#111827' }}>State Space:</strong> {infoData.learningAlgorithm.stateSpace}</div>
                      <div><strong style={{ color: '#111827' }}>Policy:</strong> {infoData.learningAlgorithm.policyNetwork}</div>
                      <div><strong style={{ color: '#111827' }}>Actions:</strong> {infoData.learningAlgorithm.actionSpace.join(', ')}</div>
                    </div>
                  </div>
                </div>

                <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.85rem', fontWeight: '700', color: '#374151' }}>API Endpoints</h4>
                  <div style={{ display: 'grid', gap: '0.35rem' }}>
                    {Object.entries(infoData.endpoints).map(([endpoint, description]) => (
                      <div key={endpoint} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: '0.75rem', fontSize: '0.78rem' }}>
                        <code style={{ color: '#1d4ed8' }}>{endpoint}</code>
                        <span style={{ color: '#6b7280' }}>{description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Broker Admin Panel ───────────────────────────────────────────────── */}
      <div style={{ ...card, padding: '1rem' }}>
        <button
          type="button"
          onClick={() => setBrokerAdminOpen(open => !open)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#111827' }}>Broker Admin</div>
            <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Manage credentials, connections, and orders (admin only).</div>
          </div>
          <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>{brokerAdminOpen ? '▲ hide' : '▼ show'}</span>
        </button>

        {brokerAdminOpen && (
          <div style={{ marginTop: '0.9rem', display: 'grid', gap: '0.9rem' }}>
            {/* Admin key input */}
            <div>
              <label style={label}>Admin API Key (x-api-key)</label>
              <input
                type="password"
                style={input}
                value={brokerAdminKey}
                onChange={e => { setBrokerAdminKey(e.target.value); setBrokerAdminError(null); setBrokerCredentialsList(null); }}
                placeholder="API_SECRET_KEY value"
                autoComplete="new-password"
              />
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: '#9ca3af' }}>
                Your admin key is never sent to external services and only used for authorization headers.
              </p>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => void fetchBrokerAdminData()}
                  disabled={brokerAdminLoading}
                  style={{ ...btn('#2563eb'), fontSize: '0.75rem', padding: '0.35rem 0.75rem', opacity: brokerAdminLoading ? 0.7 : 1 }}
                >
                  {brokerAdminLoading ? 'Loading…' : 'Load Broker Admin Data'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void Promise.all([
                      fetchBrokerAdminData(),
                      brokerOrdersCompetitionId.trim() ? handleFetchBrokerOrders() : Promise.resolve(),
                    ]);
                  }}
                  disabled={brokerAdminLoading || brokerOrdersLoading}
                  style={{ ...btn('#6b7280'), fontSize: '0.75rem', padding: '0.35rem 0.75rem', opacity: brokerAdminLoading || brokerOrdersLoading ? 0.7 : 1 }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {brokerAdminError && (
              <div style={{ fontSize: '0.82rem', color: '#dc2626', padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.375rem', border: '1px solid #fecaca' }}>
                {brokerAdminError}
              </div>
            )}

            {brokerAdminLoading && (
              <div style={{ fontSize: '0.82rem', color: '#6b7280' }}>Loading broker admin data…</div>
            )}

            {brokerCredentialsList && connectedCredentials && (
              <>
                {/* Connected credentials summary */}
                {connectedCredentials.length > 0 && (
                  <div style={{ padding: '0.75rem', backgroundColor: '#f0fdf4', borderRadius: '0.5rem', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#166534', marginBottom: '0.4rem' }}>
                      ✓ {connectedCredentials.length} connected
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {connectedCredentials.map(c => (
                        <span key={c.id} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', backgroundColor: '#86efac', color: '#15803d', borderRadius: '0.25rem', fontWeight: '500' }}>
                          {c.label} ({c.mode})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Credentials list */}
                {brokerCredentialsList.length > 0 ? (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', overflow: 'hidden' }}>
                    {brokerCredentialsList.map((cred, idx) => {
                      const isConnected = cred.connected;
                      const isLoading = brokerAdminActionLoading === cred.id;
                      return (
                        <div
                          key={cred.id}
                          style={{
                            padding: '0.75rem',
                            borderBottom: idx < brokerCredentialsList.length - 1 ? '1px solid #f3f4f6' : 'none',
                            backgroundColor: isConnected ? '#f0fdf4' : 'transparent',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: '#111827' }}>
                                {cred.label}
                                {isConnected && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#16a34a', fontWeight: '700' }}>✓ CONNECTED</span>}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' }}>
                                {cred.provider} • {cred.mode} • Created {new Date(cred.createdAt).toLocaleDateString()}
                              </div>
                              {cred.lastUsed && (
                                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                                  Last used: {new Date(cred.lastUsed).toLocaleString()}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              {!isConnected && (
                                <button
                                  type="button"
                                  onClick={() => setShowConnectConfirm(cred.id)}
                                  disabled={isLoading}
                                  style={{ ...btn('#059669'), fontSize: '0.7rem', padding: '0.3rem 0.6rem', opacity: isLoading ? 0.6 : 1 }}
                                >
                                  {isLoading ? '…' : 'Connect'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(cred.id)}
                                disabled={isLoading}
                                style={{ ...btn('#dc2626'), fontSize: '0.7rem', padding: '0.3rem 0.6rem', opacity: isLoading ? 0.6 : 1 }}
                              >
                                {isLoading ? '…' : 'Delete'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#6b7280', padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                    No broker credentials stored. Add one in the tournament configuration above.
                  </div>
                )}

                {brokerAdminActionError && (
                  <div style={{ fontSize: '0.82rem', color: '#dc2626', padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.375rem', border: '1px solid #fecaca' }}>
                    {brokerAdminActionError}
                  </div>
                )}

                {/* Order audit */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>Order Audit</div>
                    <div style={{ fontSize: '0.76rem', color: '#6b7280' }}>Load per-order broker audit records by competition id.</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: '0.55rem', alignItems: 'end' }}>
                    <div>
                      <label style={label}>Competition ID</label>
                      <input
                        style={input}
                        value={brokerOrdersCompetitionId}
                        onChange={e => {
                          setBrokerOrdersCompetitionId(e.target.value);
                          setBrokerOrdersError(null);
                        }}
                        placeholder="competition id"
                        aria-label="Broker order audit competition id"
                      />
                    </div>
                    <div>
                      <label style={label}>Agent filter (optional)</label>
                      <input
                        style={input}
                        value={brokerOrdersAgentId}
                        onChange={e => {
                          setBrokerOrdersAgentId(e.target.value);
                          setBrokerOrdersError(null);
                        }}
                        placeholder="agent id"
                        aria-label="Broker order audit agent filter"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleFetchBrokerOrders()}
                      disabled={brokerOrdersLoading}
                      style={{ ...btn('#2563eb'), fontSize: '0.75rem', padding: '0.45rem 0.75rem', opacity: brokerOrdersLoading ? 0.7 : 1 }}
                    >
                      {brokerOrdersLoading ? 'Loading…' : 'Load Orders'}
                    </button>
                  </div>

                  {brokerOrdersError && (
                    <div role="alert" style={{ marginTop: '0.55rem', fontSize: '0.8rem', color: '#dc2626', padding: '0.45rem 0.6rem', backgroundColor: '#fef2f2', borderRadius: '0.375rem', border: '1px solid #fecaca' }}>
                      {brokerOrdersError}
                    </div>
                  )}

                  {brokerOrders && (
                    <div style={{ marginTop: '0.65rem' }}>
                      {brokerOrders.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>No broker orders found for this query.</div>
                      ) : (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                            <thead>
                              <tr style={{ backgroundColor: '#f9fafb' }}>
                                {['Client Order', 'Broker Order', 'Agent', 'Symbol', 'Side', 'Qty', 'Status', 'Limit', 'Filled', 'Avg Fill', 'Submitted'].map(header => (
                                  <th key={header} style={{ padding: '0.35rem 0.5rem', textAlign: 'left', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{header}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {brokerOrders.map(order => (
                                <tr key={order.clientOrderId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <td style={{ padding: '0.35rem 0.5rem', fontFamily: 'monospace' }}>{order.clientOrderId}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', fontFamily: 'monospace' }}>{order.brokerOrderId ?? '—'}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', fontWeight: 600 }}>{order.agentId}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.symbol}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.side}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.quantity}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.status}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.limitPrice ?? '—'}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.filledQuantity ?? '—'}</td>
                                  <td style={{ padding: '0.35rem 0.5rem' }}>{order.avgFillPrice ?? '—'}</td>
                                  <td style={{ padding: '0.35rem 0.5rem', color: '#6b7280' }}>{new Date(order.submittedAt).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Emergency stop */}
                <div style={{ border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.75rem', backgroundColor: '#fef2f2' }}>
                  <div style={{ marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#991b1b' }}>Emergency Stop</div>
                    <div style={{ fontSize: '0.76rem', color: '#b91c1c' }}>Cancel all open broker orders for a competition.</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: '0.55rem', alignItems: 'end' }}>
                    <div>
                      <label style={label}>Competition ID</label>
                      <input
                        style={input}
                        value={emergencyCompetitionId}
                        onChange={e => {
                          setEmergencyCompetitionId(e.target.value);
                          setEmergencyStopError(null);
                        }}
                        placeholder="competition id"
                        aria-label="Emergency stop competition id"
                      />
                    </div>
                    <div>
                      <label style={label}>Connected credential</label>
                      <select
                        style={input}
                        value={emergencyCredentialId}
                        onChange={e => {
                          setEmergencyCredentialId(e.target.value);
                          setEmergencyStopError(null);
                        }}
                        aria-label="Emergency stop credential"
                      >
                        <option value="">— select credential —</option>
                        {connectedCredentials.map(c => (
                          <option key={c.id} value={c.id}>{c.label ?? c.id}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!emergencyCompetitionId.trim() || !emergencyCredentialId.trim()) {
                          setEmergencyStopError('competitionId and credentialId are required.');
                          return;
                        }
                        setEmergencyStopError(null);
                        setShowEmergencyStopConfirm(true);
                      }}
                      disabled={emergencyStopLoading}
                      style={{ ...btn('#dc2626'), fontSize: '0.75rem', padding: '0.45rem 0.75rem', opacity: emergencyStopLoading ? 0.7 : 1 }}
                    >
                      {emergencyStopLoading ? 'Stopping…' : 'Emergency Stop'}
                    </button>
                  </div>
                  {emergencyStopError && (
                    <div role="alert" style={{ marginTop: '0.55rem', fontSize: '0.8rem', color: '#b91c1c', padding: '0.45rem 0.6rem', backgroundColor: '#fee2e2', borderRadius: '0.375rem', border: '1px solid #fca5a5' }}>
                      {emergencyStopError}
                    </div>
                  )}
                  {emergencyStopSuccess && (
                    <div style={{ marginTop: '0.55rem', fontSize: '0.8rem', color: '#166534', padding: '0.45rem 0.6rem', backgroundColor: '#dcfce7', borderRadius: '0.375rem', border: '1px solid #86efac', fontWeight: 600 }}>
                      {emergencyStopSuccess}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
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

      {isLiveMonitorActive && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '700', color: '#374151' }}>Live Tournament Monitor</h4>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: isStreamConnected ? '#16a34a' : '#d97706', fontWeight: '600' }}>
                {isStreamConnected ? 'Stream connected' : 'Stream unavailable'}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#6b7280', padding: '0.12rem 0.45rem', border: '1px solid #e5e7eb', borderRadius: '9999px' }}>
                Source: {transport}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            {liveChartData ? (
              <Line
                data={liveChartData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
                  scales: {
                    x: { display: true, grid: { display: false } },
                    y: { display: true, ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
                  },
                }}
              />
            ) : (
              <div style={{ padding: '0.85rem', borderRadius: '0.5rem', backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.8rem' }}>
                Waiting for live equity snapshots...
              </div>
            )}
          </div>

          <div>
            <h5 style={{ margin: '0 0 0.55rem', fontSize: '0.82rem', fontWeight: '700', color: '#374151' }}>
              Live Trade Feed
            </h5>
            {liveTradeFeed.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left' }}>
                      {['Agent', 'Symbol', 'Side', 'Quantity', 'Price', 'Time'].map(h => (
                        <th key={h} style={{ padding: '0.35rem 0.55rem', fontWeight: '600', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {liveTradeFeed.slice(0, 12).map((trade, idx) => (
                      <tr key={`${trade.agentId}-${trade.timestamp}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.35rem 0.55rem', fontWeight: '600' }}>{trade.agentId}</td>
                        <td style={{ padding: '0.35rem 0.55rem' }}>{trade.symbol}</td>
                        <td style={{ padding: '0.35rem 0.55rem', color: trade.side === 'BUY' ? '#16a34a' : '#dc2626', fontWeight: '700' }}>{trade.side}</td>
                        <td style={{ padding: '0.35rem 0.55rem' }}>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td style={{ padding: '0.35rem 0.55rem' }}>${trade.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td style={{ padding: '0.35rem 0.55rem', color: '#6b7280' }}>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '0.65rem', borderRadius: '0.5rem', backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.78rem' }}>
                Waiting for trade execution events...
              </div>
            )}
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
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Coin Selection Mode</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  {(['MANUAL', 'AUTO'] as SymbolSelectionMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setSymbolSelectionMode(m); setCoinUniverse(null); }}
                      style={{
                        ...btn(symbolSelectionMode === m ? '#2563eb' : '#e5e7eb'),
                        color: symbolSelectionMode === m ? '#fff' : '#374151',
                        fontSize: '0.8rem',
                        padding: '0.35rem 1rem',
                      }}
                    >
                      {m === 'MANUAL' ? 'Manual' : 'Auto (Agent-Driven)'}
                    </button>
                  ))}
                </div>

                {symbolSelectionMode === 'MANUAL' ? (
                  <div>
                    <label style={label}>Symbols (comma-separated)</label>
                    <input style={input} value={symbolInput} onChange={e => setSymbolInput(e.target.value)} placeholder="BTC,ETH,SOL" />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                    <div>
                      <label style={label}>Universe Size (top N coins)</label>
                      <input
                        type="number" style={input}
                        value={autoUniverseSize} min={10} max={200} step={10}
                        onChange={e => setAutoUniverseSize(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label style={label}>Coins Per Agent</label>
                      <input
                        type="number" style={input}
                        value={autoCoinsPerAgent} min={1} max={10}
                        onChange={e => setAutoCoinsPerAgent(Number(e.target.value))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={previewUniverse}
                      disabled={universeLoading}
                      style={{ ...btn('#7c3aed'), opacity: universeLoading ? 0.6 : 1 }}
                    >
                      {universeLoading ? 'Loading…' : 'Preview'}
                    </button>
                  </div>
                )}
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

              {/* Exchange mode */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={label}>Trading Mode</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {(['SIMULATED', 'PAPER', 'LIVE'] as ExchangeMode[]).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExchangeMode(m)}
                      style={{
                        ...btn(exchangeMode === m
                          ? m === 'LIVE' ? '#dc2626' : m === 'PAPER' ? '#d97706' : '#2563eb'
                          : '#e5e7eb'),
                        color: exchangeMode === m ? '#fff' : '#374151',
                        fontSize: '0.8rem',
                        padding: '0.35rem 1rem',
                      }}
                    >
                      {m === 'SIMULATED' ? 'Simulated' : m === 'PAPER' ? 'Paper Trading' : 'Live Trading'}
                    </button>
                  ))}
                </div>
                {exchangeMode !== 'SIMULATED' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <label style={{ ...label, marginBottom: 0 }}>Broker Credential</label>
                      <button
                        type="button"
                        onClick={() => { setNewCredError(null); setCredModalOpen(true); }}
                        style={{ ...btn('#4f46e5'), fontSize: '0.7rem', padding: '0.2rem 0.65rem' }}
                      >
                        + Add Credential
                      </button>
                    </div>
                    {availableCredentials.length > 0 ? (
                      <select
                        style={{ ...input, marginTop: '0.35rem' }}
                        value={brokerCredentialId}
                        onChange={e => setBrokerCredentialId(e.target.value)}
                        required
                      >
                        <option value="">— select a credential —</option>
                        {availableCredentials.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.label} ({c.provider})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#6b7280', padding: '0.5rem 0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem', border: '1px solid #e5e7eb' }}>
                        No credentials stored for {exchangeMode} mode. Click &ldquo;+ Add Credential&rdquo; above.
                      </p>
                    )}
                    {exchangeMode === 'LIVE' && (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#dc2626' }}>
                        Live mode places real orders. Ensure your risk limits are configured before starting.
                      </p>
                    )}
                  </div>
                )}
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
                  <select style={{ ...input, marginBottom: '0.5rem' }} value={val.riskProfile}
                    onChange={e => set({ ...val, riskProfile: e.target.value as RiskProfile })}>
                    <option value="CONSERVATIVE">Conservative</option>
                    <option value="AGGRESSIVE">Aggressive</option>
                    <option value="SCALPING">Scalping</option>
                  </select>
                  <input
                    type="number"
                    style={input}
                    value={val.initialCapital ?? 10000}
                    min={100}
                    step={100}
                    onChange={e => set({ ...val, initialCapital: Number(e.target.value) })}
                    placeholder="Starting Capital"
                  />
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

      {/* ── AUTO coin universe preview ───────────────────────────────────── */}
      {symbolSelectionMode === 'AUTO' && coinUniverse && !loading && !results && (
        <div style={{ ...card, backgroundColor: '#f8f5ff', border: '1px solid #ddd6fe' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', fontWeight: '700', color: '#5b21b6' }}>
            Agent Coin Selections Preview
          </h4>

          {/* Per-agent picks */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            {coinUniverse.agentSelections.map(sel => (
              <div
                key={sel.agentId}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  padding: '0.6rem 0.9rem',
                  minWidth: '160px',
                }}
              >
                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#374151', marginBottom: '0.3rem' }}>
                  {sel.agentId}
                  <span style={{
                    marginLeft: '0.4rem',
                    fontSize: '0.65rem',
                    padding: '0.1rem 0.35rem',
                    borderRadius: '9999px',
                    backgroundColor:
                      sel.riskProfile === 'AGGRESSIVE' ? '#fef2f2' :
                      sel.riskProfile === 'CONSERVATIVE' ? '#f0fdf4' : '#fffbeb',
                    color:
                      sel.riskProfile === 'AGGRESSIVE' ? '#dc2626' :
                      sel.riskProfile === 'CONSERVATIVE' ? '#16a34a' : '#d97706',
                  }}>
                    {sel.riskProfile}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {sel.selectedSymbols.map(sym => (
                    <span key={sym} style={{
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      padding: '0.15rem 0.4rem',
                      background: '#ede9fe',
                      color: '#5b21b6',
                      borderRadius: '0.25rem',
                    }}>
                      {sym}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Resolved union */}
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem' }}>
            <span style={{ fontWeight: '600', color: '#374151' }}>Competition symbols: </span>
            {coinUniverse.resolvedSymbols.join(', ')}
          </div>

          {/* Top 10 scored coins table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#ede9fe', textAlign: 'left' }}>
                  {['#', 'Symbol', 'Name', '7d %', 'Vol 24h %', 'Sentiment', 'Conservative', 'Aggressive', 'Scalping'].map(h => (
                    <th key={h} style={{ padding: '0.4rem 0.6rem', fontWeight: '600', color: '#5b21b6' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coinUniverse.topCoins.slice(0, 10).map((c: ScoredCoinEntry) => (
                  <tr key={c.symbol} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.35rem 0.6rem', color: '#9ca3af' }}>{c.market_rank}</td>
                    <td style={{ padding: '0.35rem 0.6rem', fontWeight: '700' }}>{c.symbol}</td>
                    <td style={{ padding: '0.35rem 0.6rem', color: '#6b7280' }}>{c.name}</td>
                    <td style={{ padding: '0.35rem 0.6rem', color: c.price_change_7d_percent >= 0 ? '#16a34a' : '#dc2626' }}>
                      {c.price_change_7d_percent >= 0 ? '+' : ''}{c.price_change_7d_percent.toFixed(1)}%
                    </td>
                    <td style={{ padding: '0.35rem 0.6rem' }}>{c.volatility_24h.toFixed(1)}%</td>
                    <td style={{ padding: '0.35rem 0.6rem' }}>
                      <span style={{
                        fontSize: '0.65rem',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '9999px',
                        fontWeight: '600',
                        backgroundColor:
                          c.sentiment_score === 'BULL' ? '#f0fdf4' :
                          c.sentiment_score === 'BEAR' ? '#fef2f2' : '#f9fafb',
                        color:
                          c.sentiment_score === 'BULL' ? '#16a34a' :
                          c.sentiment_score === 'BEAR' ? '#dc2626' : '#6b7280',
                      }}>
                        {c.sentiment_score}
                      </span>
                    </td>
                    <td style={{ padding: '0.35rem 0.6rem' }}>{c.scores.CONSERVATIVE.toFixed(3)}</td>
                    <td style={{ padding: '0.35rem 0.6rem' }}>{c.scores.AGGRESSIVE.toFixed(3)}</td>
                    <td style={{ padding: '0.35rem 0.6rem' }}>{c.scores.SCALPING.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          {(chartData || results || equityReloadMessage || equityReloadError) && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
                  Equity Evolution
                </h4>
                {!isLiveMonitorActive && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      value={equityReloadId}
                      onChange={e => {
                        setEquityReloadId(e.target.value);
                        setEquityReloadError(null);
                        setEquityReloadMessage(null);
                      }}
                      placeholder="Competition ID"
                      aria-label="Competition ID"
                      style={{ ...input, width: '15rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => void reloadEquityCurves()}
                      disabled={equityReloadLoading}
                      style={{ ...btn('#2563eb'), opacity: equityReloadLoading ? 0.6 : 1 }}
                    >
                      {equityReloadLoading ? 'Loading…' : 'Reload Curves'}
                    </button>
                  </div>
                )}
              </div>

              {equityReloadMessage && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>{equityReloadMessage}</div>
              )}
              {equityReloadError && (
                <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#dc2626' }}>{equityReloadError}</div>
              )}

              {chartData ? (
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
              ) : (
                <div style={{ padding: '1rem', borderRadius: '0.5rem', backgroundColor: '#f9fafb', color: '#6b7280', fontSize: '0.82rem' }}>
                  No equity data available yet. Reload a completed competition id to populate the chart.
                </div>
              )}
            </div>
          )}

          {/* Trade summary */}
          {tradeLog && (
            <div style={card}>
              <button
                onClick={() => setTradeLogOpen(open => !open)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: '700', color: '#374151' }}>
                  Trade Summary ({tradeLog.length} agents)
                </h4>
                <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>{tradeLogOpen ? '▲ hide' : '▼ show'}</span>
              </button>

              {tradeLogOpen && (
                <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        {['Agent', 'Trades', 'Final Capital', 'Return', 'Win Rate'].map(h => (
                          <th key={h} style={{ padding: '0.4rem 0.75rem', fontWeight: '600', textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#374151' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tradeLog.map(entry => (
                        <tr key={entry.agentId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '0.4rem 0.75rem', fontWeight: '500' }}>{entry.agentId}</td>
                          <td style={{ padding: '0.4rem 0.75rem' }}>{entry.tradesExecuted}</td>
                          <td style={{ padding: '0.4rem 0.75rem' }}>${entry.finalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td style={{ padding: '0.4rem 0.75rem', color: entry.totalReturn >= 0 ? '#16a34a' : '#dc2626', fontWeight: '600' }}>{pct(entry.totalReturn)}</td>
                          <td style={{ padding: '0.4rem 0.75rem' }}>{fmt(entry.winRate, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ margin: '0.5rem 0 0', color: '#9ca3af', fontSize: '0.75rem' }}>
                    Aggregate per agent. For per-order detail use <code>/api/marl/broker/orders/:id</code>.
                  </p>
                </div>
              )}
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

      {/* ── Add Broker Credential Modal ──────────────────────────────────────── */}
      {credModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) setCredModalOpen(false); }}
        >
          <div style={{
            backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem',
            width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700' }}>Add Broker Credential</h3>
              <button
                type="button"
                onClick={() => setCredModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#6b7280' }}
              >✕</button>
            </div>

            <form onSubmit={handleSaveCredential}>
              {/* Mode — read-only, derived from the current exchange mode selection */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.875rem' }}>
                <div>
                  <label style={label}>Mode</label>
                  <div style={{
                    padding: '0.5rem 0.75rem', backgroundColor: '#f3f4f6', borderRadius: '0.375rem',
                    fontSize: '0.875rem', fontWeight: '700',
                    color: exchangeMode === 'LIVE' ? '#dc2626' : '#d97706',
                  }}>
                    {exchangeMode}
                  </div>
                </div>
                <div>
                  <label style={label}>Provider</label>
                  <div style={{
                    padding: '0.5rem 0.75rem', backgroundColor: '#f3f4f6', borderRadius: '0.375rem',
                    fontSize: '0.875rem', fontWeight: '700', color: '#374151',
                  }}>
                    ALPACA
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '0.875rem' }}>
                <label style={label}>Label <span style={{ fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <input
                  type="text"
                  style={input}
                  value={newCredLabel}
                  onChange={e => setNewCredLabel(e.target.value)}
                  placeholder="e.g. My Alpaca Paper Account"
                />
              </div>

              <div style={{ marginBottom: '0.875rem' }}>
                <label style={label}>API Key</label>
                <input
                  type="password"
                  style={input}
                  value={newCredApiKey}
                  onChange={e => setNewCredApiKey(e.target.value)}
                  placeholder="Alpaca API Key"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div style={{ marginBottom: '0.875rem' }}>
                <label style={label}>API Secret</label>
                <input
                  type="password"
                  style={input}
                  value={newCredApiSecret}
                  onChange={e => setNewCredApiSecret(e.target.value)}
                  placeholder="Alpaca API Secret"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={label}>Admin Key</label>
                <input
                  type="password"
                  style={input}
                  value={newCredAdminKey}
                  onChange={e => setNewCredAdminKey(e.target.value)}
                  placeholder="API_SECRET_KEY value (x-api-key header)"
                  required
                  autoComplete="new-password"
                />
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.7rem', color: '#9ca3af' }}>
                  Credentials are encrypted with AES-256-GCM before being stored.
                </p>
              </div>

              {newCredError && (
                <p style={{
                  margin: '0 0 0.875rem', fontSize: '0.8rem', color: '#dc2626',
                  padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2',
                  borderRadius: '0.375rem', border: '1px solid #fecaca',
                }}>
                  {newCredError}
                </p>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setCredModalOpen(false)}
                  style={{ ...btn('#6b7280'), fontSize: '0.875rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newCredSaving}
                  style={{ ...btn('#4f46e5'), fontSize: '0.875rem', opacity: newCredSaving ? 0.7 : 1 }}
                >
                  {newCredSaving ? 'Saving…' : 'Save Credential'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Connect Credential Confirmation ──────────────────────────────────── */}
      {showConnectConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowConnectConfirm(null); }}
        >
          <div style={{
            backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem',
            width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: '700', color: '#111827' }}>
              Connect Credential?
            </h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#6b7280' }}>
              This broker credential will be activated and available for real trading competitions.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowConnectConfirm(null)}
                style={{ ...btn('#6b7280'), fontSize: '0.875rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConnectCredential(showConnectConfirm)}
                disabled={brokerAdminActionLoading === showConnectConfirm}
                style={{ ...btn('#059669'), fontSize: '0.875rem', opacity: brokerAdminActionLoading === showConnectConfirm ? 0.7 : 1 }}
              >
                {brokerAdminActionLoading === showConnectConfirm ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Credential Confirmation ──────────────────────────────────── */}
      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(null); }}
        >
          <div style={{
            backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem',
            width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: '700', color: '#dc2626' }}>
              Delete Credential?
            </h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#6b7280' }}>
              This action is <strong>irreversible</strong>. The credential will be permanently deleted, and any active connection will be closed.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                style={{ ...btn('#6b7280'), fontSize: '0.875rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteCredential(showDeleteConfirm)}
                disabled={brokerAdminActionLoading === showDeleteConfirm}
                style={{ ...btn('#dc2626'), fontSize: '0.875rem', opacity: brokerAdminActionLoading === showDeleteConfirm ? 0.7 : 1 }}
              >
                {brokerAdminActionLoading === showDeleteConfirm ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Emergency Stop Confirmation ──────────────────────────────────── */}
      {showEmergencyStopConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Emergency stop confirmation"
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowEmergencyStopConfirm(false); }}
        >
          <div style={{
            backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem',
            width: '100%', maxWidth: '430px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: '700', color: '#991b1b' }}>
              Confirm Emergency Stop
            </h3>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
              This will cancel all open orders for competition <strong>{emergencyCompetitionId}</strong> using credential <strong>{emergencyCredentialId}</strong>.
            </p>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.84rem', color: '#b91c1c', fontWeight: 600 }}>
              This is a high-impact action intended only for incident response.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowEmergencyStopConfirm(false)}
                style={{ ...btn('#6b7280'), fontSize: '0.875rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleEmergencyStop()}
                disabled={emergencyStopLoading}
                style={{ ...btn('#dc2626'), fontSize: '0.875rem', opacity: emergencyStopLoading ? 0.7 : 1 }}
              >
                {emergencyStopLoading ? 'Executing…' : 'Confirm Emergency Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
