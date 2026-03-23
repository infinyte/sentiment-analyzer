// FRONTEND - App.tsx
// Main React component with dashboard, detail modal, and MARL competition view

import { useEffect, useState } from 'react';
import { AgentManagementDashboard } from './components/AgentManagementDashboard';
import { MarlCompetitionViewer } from './components/MarlCompetitionViewer';
import { SocialDashboard } from './components/SocialDashboard';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

// ============================================================================
// TYPES
// ============================================================================

interface TrendingSentiment {
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  composite_score: number;
  velocity: number;
  mention_count: number;
  unique_sources: number;
  signals: {
    sentiment: number;
    engagement: number;
    authority: number;
    recency: number;
  };
}

interface Coin {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  sentiment_summary: string;
  trending_score: number;
  trending_sentiment?: TrendingSentiment;
  market_rank: number;
}

interface ScoredSentimentItem {
  id: string;
  source: 'newsapi' | 'reddit' | 'x';
  source_label: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  published_at?: string;
  engagement_score: number;
  recency_score: number;
  relevance_score: number;
  keyword_score: number;
  sentiment_score: number;
  weighted_score: number;
  source_weight: number;
}

interface SentimentSourceBreakdown {
  source: 'newsapi' | 'reddit' | 'x';
  source_label: string;
  item_count: number;
  average_sentiment_score: number;
  average_weighted_score: number;
  weighted_frequency: number;
}

interface SentimentCollectionStats {
  total_items: number;
  source_count: number;
  weighted_frequency: number;
  average_recency_score: number;
  trending_score: number;
  collected_at: string;
}

interface CoinSentimentDetail {
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  key_catalysts: string[];
  risk_factors: string[];
  short_term_outlook: string;
  volatility_warning: boolean;
  trending_score: number;
  source_breakdown: SentimentSourceBreakdown[];
  collection_stats?: SentimentCollectionStats;
  trending_sentiment?: TrendingSentiment;
  feature_attribution?: Record<string, number>;
}

interface CoinDetail extends Coin {
  price_history: Array<{
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  headlines: string[];
  scored_items: ScoredSentimentItem[];
  sentiment_today?: CoinSentimentDetail;
}

type HealthState = 'healthy' | 'degraded' | 'down';

interface HealthPayload {
  status: 'healthy' | 'degraded';
  services: Record<string, string>;
  uptime_seconds: number;
}

const HEALTH_POLL_INTERVAL_MS = 30 * 1000;

type FrontendAgentType = 'RULE_BASED' | 'ML_BASED' | 'HYBRID';
type FrontendRiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
type BacktestSlippageModel = 'FIXED' | 'VOLUME_BASED' | 'MARKET_IMPACT';

interface BacktestAgentDraft {
  agentId: string;
  type: FrontendAgentType;
  riskProfile: FrontendRiskProfile;
  initialCapital: string;
}

interface ConfiguredBacktestAgent {
  agentId: string;
  type: FrontendAgentType;
  riskProfile: FrontendRiskProfile;
  initialCapital: number;
}

interface BacktestRunSummary {
  averageReturn: number;
  bestReturn: number;
  worstReturn: number;
  averageWinRate: number;
  narrative: string;
}

interface BacktestRunResultRow {
  agentId: string;
  agentType: string;
  riskProfile: string;
  totalReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
}

interface BacktestRunResponse {
  testId: string;
  status: 'COMPLETED';
  results: BacktestRunResultRow[];
  topPerformer: string;
  summary: BacktestRunSummary;
}

interface StoredBacktestResult {
  testId: string;
  config: {
    symbols: string[];
    startDate: string | Date;
    endDate: string | Date;
    slippageModel: BacktestSlippageModel;
    commissionPct: number;
    agentConfigs: ConfiguredBacktestAgent[];
  };
  agentResults: Array<{
    agentId: string;
    agentType: string;
    riskProfile: string;
    metrics: {
      totalTrades: number;
      winRate: number;
      profitFactor: number;
      totalReturnPct: number;
      maxDrawdown: number;
      sharpeRatio: number;
      equityCurve: Array<{ date: string | Date; capital: number }>;
    };
    trades: Array<{
      symbol: string;
      signal: 'BUY' | 'SELL';
      entryPrice: number;
      exitPrice: number;
      pnl: number;
      pnlPct: number;
      holdDays: number;
      exitReason: string;
    }>;
  }>;
  comparison: {
    topPerformerByReturn: string;
    averageReturn: number;
    bestReturn: number;
    worstReturn: number;
    averageWinRate: number;
    summary: string;
  };
  startedAt: string | Date;
  completedAt: string | Date;
}

interface TradingExchangeStatus {
  connected: boolean;
  name: string;
  mode: string;
  provider?: string;
}

interface TradingPriceResponse {
  symbol: string;
  price: number;
}

interface TradingBalance {
  symbol: string;
  available: number;
  held: number;
  total: number;
}

interface TradingStats {
  initialCapital: number;
  currentCapital: number;
  pnl: number;
  pnlPercent: number;
  totalTrades: number;
  successfulTrades: number;
  maxLoss: number;
  maxPosition: number;
}

interface TradingOrderResponse {
  success: boolean;
  error?: string;
  reason?: string;
  order?: {
    id: string;
    symbol: string;
    type: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    status: 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELED';
  };
}

const BACKTEST_AGENT_TYPE_OPTIONS: FrontendAgentType[] = ['RULE_BASED', 'ML_BASED', 'HYBRID'];
const BACKTEST_RISK_PROFILE_OPTIONS: FrontendRiskProfile[] = ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'];
const BACKTEST_SLIPPAGE_OPTIONS: BacktestSlippageModel[] = ['FIXED', 'VOLUME_BASED', 'MARKET_IMPACT'];
const BACKTEST_SESSION_TEST_ID_KEY = 'backtest:lastTestId';

function createDefaultBacktestAgent(index = 0): BacktestAgentDraft {
  return {
    agentId: `agent_${index + 1}`,
    type: 'RULE_BASED',
    riskProfile: 'CONSERVATIVE',
    initialCapital: '10000',
  };
}

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

function useCoins() {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCoins = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/coins?limit=50');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCoins(data.data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoins();
    const interval = setInterval(fetchCoins, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { coins, loading, error, lastUpdated };
}

function useCoinDetail(symbol: string | null) {
  const [detail, setDetail] = useState<CoinDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/coins/${symbol}?days=7`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setDetail({
          ...data.coin,
          price_history: data.price_history,
          headlines: data.headlines,
          scored_items: data.scored_items ?? [],
          sentiment_today: data.sentiment_today,
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [symbol]);

  return { detail, loading, error };
}

function useSystemHealth() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [status, setStatus] = useState<HealthState>('down');
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    let isActive = true;

    const fetchHealth = async () => {
      try {
        const response = await fetch('/api/health');
        const payload = await response.json().catch(() => null) as HealthPayload | null;

        if (!response.ok || !payload) {
          throw new Error(`Health check failed (${response.status}).`);
        }

        if (!isActive) return;

        setHealth(payload);
        setStatus(payload.status === 'healthy' ? 'healthy' : 'degraded');
        setError(null);
        setLastChecked(new Date());
      } catch (err) {
        if (!isActive) return;

        setStatus('down');
        setError(err instanceof Error ? err.message : 'Health check failed.');
        setLastChecked(new Date());
      }
    };

    fetchHealth();
    const intervalId = setInterval(fetchHealth, HEALTH_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, []);

  return { health, status, error, lastChecked };
}

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

interface SentimentBadgeProps {
  score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
}

function SentimentBadge({ score, confidence }: SentimentBadgeProps) {
  const config = {
    BULL: { color: '#10b981', emoji: '📈' },
    NEUTRAL: { color: '#f59e0b', emoji: '➡️' },
    BEAR: { color: '#ef4444', emoji: '📉' },
  };

  const cfg = config[score];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        backgroundColor: `${cfg.color}15`,
        border: `2px solid ${cfg.color}`,
        borderRadius: '0.375rem',
        width: 'fit-content',
      }}
    >
      <span style={{ fontSize: '1.2rem' }}>{cfg.emoji}</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: cfg.color }}>
          {score}
        </span>
        <span style={{ fontSize: '0.625rem', color: '#6b7280' }}>
          {(confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

interface PercentChangeProps {
  value: number;
  label: string;
}

function PercentChange({ value, label }: PercentChangeProps) {
  const isPositive = value >= 0;
  const color = isPositive ? '#10b981' : '#ef4444';
  const symbol = isPositive ? '▲' : '▼';

  return (
    <span style={{ color, fontWeight: '600', fontSize: '0.875rem' }}>
      {symbol} {Math.abs(value).toFixed(2)}% ({label})
    </span>
  );
}

// ============================================================================
// COIN CARD COMPONENT
// ============================================================================

type SortBy = 'market_cap' | 'volatility' | 'sentiment' | 'price_change';

interface CoinCardProps {
  coin: Coin;
  onSelect: (symbol: string) => void;
  sortBy: SortBy;
  sortRank: number;
}

const SORT_ACCENT: Record<SortBy, string> = {
  market_cap:   '#6366f1',
  volatility:   '#f59e0b',
  sentiment:    '#10b981',
  price_change: '#3b82f6',
};

function CoinCard({ coin, onSelect, sortBy, sortRank }: CoinCardProps) {
  const accent = SORT_ACCENT[sortBy];
  const isVolatilitySort  = sortBy === 'volatility';
  const isSentimentSort   = sortBy === 'sentiment';
  const isPriceChangeSort = sortBy === 'price_change';

  return (
    <div
      onClick={() => onSelect(coin.symbol)}
      style={{
        padding: '1rem',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        backgroundColor: 'var(--surface)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        borderTop: `3px solid ${accent}`,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 10px 15px rgba(0,0,0,0.1)';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = 'none';
        el.style.transform = 'translateY(0)';
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start',
          marginBottom: '0.75rem',
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.125rem', fontWeight: '700' }}>
            {coin.name}
          </h3>
          <span style={{ fontSize: '0.875rem', color: '#6b7280', fontWeight: '600' }}>
            {coin.symbol}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
          {/* Sort position badge */}
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: '700',
              backgroundColor: accent,
              color: '#fff',
              padding: '0.15rem 0.45rem',
              borderRadius: '0.25rem',
              letterSpacing: '0.02em',
            }}
          >
            #{sortRank}
          </span>
          {/* Market cap rank (always shown for reference) */}
          {sortBy !== 'market_cap' && (
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              cap #{coin.market_rank}
            </span>
          )}
        </div>
      </div>

      {/* Price */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.25rem' }}>
          ${coin.price_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
          <span style={{ color: isPriceChangeSort ? accent : undefined, fontWeight: isPriceChangeSort ? '700' : undefined }}>
            <PercentChange value={coin.price_change_24h_percent} label="24h" />
          </span>
          <PercentChange value={coin.price_change_7d_percent} label="7d" />
        </div>
      </div>

      {/* Sentiment */}
      <div
        style={{
          marginBottom: '0.75rem',
          outline: isSentimentSort ? `2px solid ${accent}` : undefined,
          borderRadius: isSentimentSort ? '0.375rem' : undefined,
          padding: isSentimentSort ? '0.25rem' : undefined,
        }}
      >
        <SentimentBadge
          score={coin.sentiment_score}
          confidence={coin.sentiment_confidence}
        />
        {coin.trending_sentiment && (
          <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: '#6b7280' }}>
            <span>&#128293; {coin.trending_sentiment.velocity.toFixed(1)}/hr</span>
            <span>{coin.trending_sentiment.mention_count} mentions</span>
            <span>{coin.trending_sentiment.unique_sources} sources</span>
          </div>
        )}
      </div>

      {/* Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        <div>
          <span style={{ fontWeight: '600' }}>Vol 24h:</span>
          <div>${(coin.volume_24h_usd / 1e9).toFixed(2)}B</div>
        </div>
        <div
          style={{
            backgroundColor: isVolatilitySort ? `${accent}15` : undefined,
            borderRadius: isVolatilitySort ? '0.25rem' : undefined,
            padding: isVolatilitySort ? '0.1rem 0.25rem' : undefined,
            outline: isVolatilitySort ? `1px solid ${accent}40` : undefined,
          }}
        >
          <span style={{ fontWeight: '600', color: isVolatilitySort ? accent : undefined }}>Volatility:</span>
          <div style={{ fontWeight: isVolatilitySort ? '700' : undefined, color: isVolatilitySort ? accent : undefined }}>
            {coin.volatility_24h.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Summary */}
      <p
        style={{
          margin: '0',
          fontSize: '0.875rem',
          lineHeight: '1.4',
          color: 'var(--text-strong)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {coin.sentiment_summary || 'Sentiment analysis pending...'}
      </p>
    </div>
  );
}

// ============================================================================
// DASHBOARD COMPONENT
// ============================================================================

interface DashboardProps {
  coins: Coin[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  onCoinSelect: (symbol: string) => void;
}

type SentimentMode = 'BASIC' | 'ADVANCED' | 'TRADING_SIGNALS' | 'SMART';
type SentimentLabTab = 'analyze' | 'lookup' | 'rankings' | 'modes';

interface SentimentAnalyzeResponse {
  mode: SentimentMode;
  results: Record<string, unknown>;
}

interface SentimentRankingCoin {
  rank: number;
  symbol: string;
  name: string;
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  compositeScore: number;
  price_usd: number;
  price_change_7d_percent: number;
}

interface SentimentRankingResponse {
  timeframe: string;
  sentimentMode: string;
  coins: SentimentRankingCoin[];
}

interface SentimentModesResponse {
  analysisMode: Record<string, string>;
  agentTypes: Record<string, string>;
  riskProfiles: Record<string, unknown>;
  slippageModels: Record<string, string>;
}

interface SentimentLookupResponse {
  symbol: string;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  short_term_outlook?: string;
  key_catalysts?: string[];
  risk_factors?: string[];
}

function Dashboard({ coins, loading, error, lastUpdated, onCoinSelect }: DashboardProps) {
  const [sortBy, setSortBy] = useState<SortBy>('market_cap');
  const [refreshApiKey, setRefreshApiKey] = useState(() => sessionStorage.getItem('sentimentRefreshApiKey') ?? '');
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshToast, setRefreshToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [analysisMode, setAnalysisMode] = useState<SentimentMode>('BASIC');
  const [analysisSymbolsInput, setAnalysisSymbolsInput] = useState('BTC, ETH');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzeSuccess, setAnalyzeSuccess] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<SentimentAnalyzeResponse | null>(null);

  const [lookupSymbol, setLookupSymbol] = useState('BTC');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupSuccess, setLookupSuccess] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<SentimentLookupResponse | null>(null);

  const [rankingTimeframe, setRankingTimeframe] = useState('1d');
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [rankingSuccess, setRankingSuccess] = useState<string | null>(null);
  const [rankingResult, setRankingResult] = useState<SentimentRankingResponse | null>(null);
  const [labTab, setLabTab] = useState<SentimentLabTab>('analyze');

  const [modesOpen, setModesOpen] = useState(false);
  const [modesLoading, setModesLoading] = useState(false);
  const [modesError, setModesError] = useState<string | null>(null);
  const [modesData, setModesData] = useState<SentimentModesResponse | null>(null);

  if (error) {
    return (
      <div
        style={{
          padding: '2rem',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '0.5rem',
          marginBottom: '1rem',
          border: '1px solid #fca5a5',
        }}
      >
        Error: {error}
      </div>
    );
  }

  const sentimentOrder: Record<'BULL' | 'NEUTRAL' | 'BEAR', number> = { BULL: 0, NEUTRAL: 1, BEAR: 2 };
  const safeNum = (v: number | undefined | null) => (typeof v === 'number' && isFinite(v) ? v : 0);

  const displayCoins = (() => {
    const arr = [...coins];
    if (sortBy === 'volatility')
      return arr.sort((a, b) => safeNum(b.volatility_24h) - safeNum(a.volatility_24h));
    if (sortBy === 'sentiment')
      return arr.sort((a, b) => {
        const d = sentimentOrder[a.sentiment_score] - sentimentOrder[b.sentiment_score];
        return d !== 0 ? d : safeNum(b.sentiment_confidence) - safeNum(a.sentiment_confidence);
      });
    if (sortBy === 'price_change')
      return arr.sort((a, b) => safeNum(b.price_change_24h_percent) - safeNum(a.price_change_24h_percent));
    // market_cap: sort explicitly by market_rank ascending (rank 1 = largest cap)
    return arr.sort((a, b) => safeNum(a.market_rank) - safeNum(b.market_rank));
  })();

  const parseSymbols = () =>
    analysisSymbolsInput
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);

  const runAnalyze = async () => {
    const symbols = parseSymbols();
    if (symbols.length === 0) {
      setAnalyzeError('Provide at least one symbol (comma-separated).');
      setAnalyzeSuccess(null);
      return;
    }

    setAnalyzeLoading(true);
    setAnalyzeError(null);
    setAnalyzeSuccess(null);

    try {
      const marketData = symbols.reduce<Record<string, {
        symbol: string;
        price_usd: number;
        price_change_24h_percent: number;
        price_change_7d_percent: number;
        volatility_24h: number;
        volume_24h_usd: number;
      }>>((acc, sym) => {
        const coin = coins.find(c => c.symbol.toUpperCase() === sym);
        if (!coin) return acc;

        acc[sym] = {
          symbol: sym,
          price_usd: coin.price_usd,
          price_change_24h_percent: coin.price_change_24h_percent,
          price_change_7d_percent: coin.price_change_7d_percent,
          volatility_24h: coin.volatility_24h,
          volume_24h_usd: coin.volume_24h_usd,
        };
        return acc;
      }, {});

      const response = await fetch('/api/sentiment/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, mode: analysisMode, marketData }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      setAnalyzeResult(payload as SentimentAnalyzeResponse);
      setAnalyzeSuccess(`Analyzed ${symbols.length} symbol(s) in ${analysisMode} mode.`);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const runLookup = async () => {
    const symbol = lookupSymbol.trim().toUpperCase();
    if (!symbol) {
      setLookupError('Enter a symbol to look up.');
      setLookupSuccess(null);
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setLookupSuccess(null);

    try {
      const response = await fetch(`/api/sentiment/${symbol}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      setLookupResult(payload as SentimentLookupResponse);
      setLookupSuccess(`Loaded sentiment for ${symbol}.`);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
      setLookupResult(null);
    } finally {
      setLookupLoading(false);
    }
  };

  const loadRankings = async () => {
    setRankingLoading(true);
    setRankingError(null);
    setRankingSuccess(null);

    try {
      const response = await fetch(`/api/rankings/top-coins?timeframe=${encodeURIComponent(rankingTimeframe)}&limit=10`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      setRankingResult(payload as SentimentRankingResponse);
      setRankingSuccess(`Loaded top ${payload.coins?.length ?? 0} ranked coins.`);
    } catch (err) {
      setRankingError(err instanceof Error ? err.message : 'Ranking fetch failed');
      setRankingResult(null);
    } finally {
      setRankingLoading(false);
    }
  };

  const toggleModes = async () => {
    const nextOpen = !modesOpen;
    setModesOpen(nextOpen);

    if (!nextOpen || modesData) return;

    setModesLoading(true);
    setModesError(null);

    try {
      const response = await fetch('/api/info/modes');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      setModesData(payload as SentimentModesResponse);
    } catch (err) {
      setModesError(err instanceof Error ? err.message : 'Failed to load mode reference');
    } finally {
      setModesLoading(false);
    }
  };

  useEffect(() => {
    if (labTab === 'modes' && !modesData && !modesLoading && !modesError) {
      void toggleModes();
    }
  }, [labTab, modesData, modesLoading, modesError]);

  useEffect(() => {
    if (!refreshToast) return;
    const timer = setTimeout(() => setRefreshToast(null), 3500);
    return () => clearTimeout(timer);
  }, [refreshToast]);

  const triggerSentimentRefresh = async () => {
    const apiKey = refreshApiKey.trim();
    if (!apiKey) {
      setRefreshError('API key is required to refresh sentiment.');
      return;
    }

    setRefreshPending(true);
    setRefreshError(null);

    try {
      const response = await fetch('/api/refresh-sentiment', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
        },
      });

      const payload = await response.json().catch(() => ({}));

      if (response.status !== 202) {
        throw new Error(
          payload.error ??
          `Request failed (${response.status}). Verify your API key and try again.`,
        );
      }

      sessionStorage.setItem('sentimentRefreshApiKey', apiKey);
      const jobId = typeof payload.job_id === 'string' ? payload.job_id : null;
      setRefreshToast({
        type: 'success',
        message: jobId
          ? `Sentiment refresh queued (job ${jobId}).`
          : 'Sentiment refresh queued successfully.',
      });
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Refresh failed. Verify API key and try again.';
      setRefreshError(message);
      setRefreshToast({ type: 'error', message });
    } finally {
      setRefreshPending(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'grid', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', fontWeight: '700' }}>
              Sentiment Analyzer
            </h1>
            <p style={{ margin: '0', color: 'var(--text-muted)' }}>
              Real-time cryptocurrency sentiment analysis
            </p>
          </div>

          <div style={{
            border: '1px solid var(--border)',
            borderRadius: '0.5rem',
            padding: '0.6rem',
            backgroundColor: 'var(--surface)',
            minWidth: '270px',
            maxWidth: '420px',
            width: '100%',
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-subtle)', marginBottom: '0.35rem' }}>
              Refresh Sentiment Cache
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="password"
                value={refreshApiKey}
                onChange={e => {
                  setRefreshApiKey(e.target.value);
                  if (refreshError) setRefreshError(null);
                }}
                placeholder="API key"
                aria-label="Sentiment refresh API key"
                style={{
                  flex: 1,
                  minWidth: '160px',
                  padding: '0.45rem',
                  borderRadius: '0.375rem',
                  border: '1px solid var(--border-input)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <button
                onClick={triggerSentimentRefresh}
                disabled={refreshPending}
                style={{
                  padding: '0.45rem 0.7rem',
                  border: 'none',
                  borderRadius: '0.375rem',
                  backgroundColor: refreshPending ? '#93c5fd' : '#2563eb',
                  color: '#fff',
                  cursor: refreshPending ? 'wait' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {refreshPending ? 'Queuing...' : 'Refresh'}
              </button>
            </div>
            {refreshError && (
              <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#b91c1c' }}>
                {refreshError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: `2px solid ${SORT_ACCENT[sortBy]}`,
            backgroundColor: 'var(--surface)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: SORT_ACCENT[sortBy],
          }}
        >
          <option value="market_cap">Sort: Market Cap</option>
          <option value="volatility">Sort: Volatility</option>
          <option value="sentiment">Sort: Sentiment</option>
          <option value="price_change">Sort: Price Change 24h</option>
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          {loading ? (
            <>
              <span
                style={{
                  width: '0.5rem',
                  height: '0.5rem',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                }}
              />
              Updating...
            </>
          ) : (
            <>
              <span
                style={{
                  width: '0.5rem',
                  height: '0.5rem',
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                }}
              />
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Ready'}
            </>
          )}
        </div>
      </div>

      <section
        style={{
          marginBottom: '1.5rem',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          backgroundColor: 'var(--surface)',
          padding: '1rem',
        }}
      >
        <div style={{ marginBottom: '0.875rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700 }}>Sentiment Lab</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Analyze symbols, fetch cached sentiment, load ranked coins, and inspect analysis modes.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
          {([
            ['analyze', 'Analyze'],
            ['lookup', 'Lookup'],
            ['rankings', 'Rankings'],
            ['modes', 'Modes'],
          ] as Array<[SentimentLabTab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setLabTab(id)}
              aria-pressed={labTab === id}
              style={{
                padding: '0.4rem 0.7rem',
                borderRadius: '999px',
                border: `1px solid ${labTab === id ? '#2563eb' : 'var(--border)'}`,
                backgroundColor: labTab === id ? '#dbeafe' : 'var(--surface)',
                color: labTab === id ? '#1d4ed8' : 'var(--text-subtle)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.82rem',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.85rem' }}>
          {labTab === 'analyze' && (
            <>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Analyze Request</h3>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Mode
              </label>
              <select
                value={analysisMode}
                onChange={e => setAnalysisMode(e.target.value as SentimentMode)}
                style={{ width: '100%', marginBottom: '0.5rem', padding: '0.45rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              >
                <option value="BASIC">BASIC</option>
                <option value="ADVANCED">ADVANCED</option>
                <option value="TRADING_SIGNALS">TRADING_SIGNALS</option>
                <option value="SMART">SMART</option>
              </select>

              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Symbols (comma-separated)
              </label>
              <input
                value={analysisSymbolsInput}
                onChange={e => setAnalysisSymbolsInput(e.target.value)}
                placeholder="BTC, ETH"
                style={{ width: '100%', marginBottom: '0.5rem', padding: '0.45rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              />
              <button
                onClick={runAnalyze}
                disabled={analyzeLoading}
                style={{ padding: '0.45rem 0.7rem', border: 'none', borderRadius: '0.375rem', backgroundColor: analyzeLoading ? '#93c5fd' : '#2563eb', color: '#fff', cursor: analyzeLoading ? 'wait' : 'pointer', fontWeight: 600 }}
              >
                {analyzeLoading ? 'Analyzing...' : 'Run Analysis'}
              </button>
              {analyzeSuccess && <div style={{ marginTop: '0.5rem', color: '#047857', fontSize: '0.8rem' }}>{analyzeSuccess}</div>}
              {analyzeError && <div style={{ marginTop: '0.5rem', color: '#b91c1c', fontSize: '0.8rem' }}>{analyzeError}</div>}
              {analyzeResult && (
                <pre style={{ marginTop: '0.5rem', fontSize: '0.72rem', maxHeight: '140px', overflow: 'auto', backgroundColor: 'var(--surface-2)', padding: '0.5rem', borderRadius: '0.375rem' }}>
                  {JSON.stringify(analyzeResult.results, null, 2)}
                </pre>
              )}
            </>
          )}

          {labTab === 'lookup' && (
            <>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Symbol Lookup</h3>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                Symbol
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  value={lookupSymbol}
                  onChange={e => setLookupSymbol(e.target.value)}
                  placeholder="BTC"
                  style={{ flex: 1, minWidth: '180px', padding: '0.45rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                />
                <button
                  onClick={runLookup}
                  disabled={lookupLoading}
                  style={{ padding: '0.45rem 0.7rem', border: 'none', borderRadius: '0.375rem', backgroundColor: lookupLoading ? '#93c5fd' : '#2563eb', color: '#fff', cursor: lookupLoading ? 'wait' : 'pointer', fontWeight: 600 }}
                >
                  {lookupLoading ? 'Loading...' : 'Fetch'}
                </button>
              </div>
              {lookupSuccess && <div style={{ color: '#047857', fontSize: '0.8rem' }}>{lookupSuccess}</div>}
              {lookupError && <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{lookupError}</div>}
              {lookupResult && (
                <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.5rem', backgroundColor: 'var(--surface-2)' }}>
                  <div style={{ fontWeight: 700 }}>{lookupResult.symbol}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{lookupResult.sentiment_score} ({(lookupResult.confidence * 100).toFixed(0)}%)</div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>{lookupResult.summary}</div>
                </div>
              )}
            </>
          )}

          {labTab === 'rankings' && (
            <>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Top Rankings</h3>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <select
                  value={rankingTimeframe}
                  onChange={e => setRankingTimeframe(e.target.value)}
                  style={{ flex: 1, minWidth: '180px', padding: '0.45rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                >
                  <option value="1d">1d</option>
                  <option value="7d">7d</option>
                  <option value="30d">30d</option>
                </select>
                <button
                  onClick={loadRankings}
                  disabled={rankingLoading}
                  style={{ padding: '0.45rem 0.7rem', border: 'none', borderRadius: '0.375rem', backgroundColor: rankingLoading ? '#93c5fd' : '#2563eb', color: '#fff', cursor: rankingLoading ? 'wait' : 'pointer', fontWeight: 600 }}
                >
                  {rankingLoading ? 'Loading...' : 'Load'}
                </button>
              </div>
              {rankingSuccess && <div style={{ color: '#047857', fontSize: '0.8rem' }}>{rankingSuccess}</div>}
              {rankingError && <div style={{ color: '#b91c1c', fontSize: '0.8rem' }}>{rankingError}</div>}
              {rankingResult?.coins?.length ? (
                <div style={{ marginTop: '0.5rem', maxHeight: '200px', overflow: 'auto', fontSize: '0.75rem' }}>
                  {rankingResult.coins.map(coin => (
                    <div key={coin.symbol} style={{ display: 'grid', gridTemplateColumns: '1.75rem 1fr auto', gap: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>#{coin.rank}</span>
                      <span>{coin.symbol} - {coin.sentiment}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{coin.compositeScore.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {labTab === 'modes' && (
            <>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Mode Reference</h3>
              {modesLoading && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading mode details...</div>}
              {modesError && <div style={{ marginTop: '0.5rem', color: '#b91c1c', fontSize: '0.8rem' }}>{modesError}</div>}
              {modesData && (
                <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: '0.375rem', padding: '0.5rem', backgroundColor: 'var(--surface-2)' }}>
                  {Object.entries(modesData.analysisMode).map(([mode, desc]) => (
                    <div key={mode} style={{ marginBottom: '0.45rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.78rem' }}>{mode}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>{desc}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        {displayCoins.map((coin, index) => (
          <CoinCard key={coin.id} coin={coin} onSelect={onCoinSelect} sortBy={sortBy} sortRank={index + 1} />
        ))}
      </div>

      {refreshToast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            right: '1rem',
            bottom: '1rem',
            zIndex: 1200,
            maxWidth: '320px',
            padding: '0.75rem 0.875rem',
            borderRadius: '0.5rem',
            border: `1px solid ${refreshToast.type === 'success' ? '#86efac' : '#fca5a5'}`,
            backgroundColor: refreshToast.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: refreshToast.type === 'success' ? '#166534' : '#991b1b',
            fontSize: '0.85rem',
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)',
          }}
        >
          {refreshToast.message}
        </div>
      )}
    </div>
  );
}

function BacktestingWorkspace() {
  const [agentDrafts, setAgentDrafts] = useState<BacktestAgentDraft[]>([createDefaultBacktestAgent(0)]);
  const [configuredAgents, setConfiguredAgents] = useState<ConfiguredBacktestAgent[]>([]);
  const [configurePending, setConfigurePending] = useState(false);
  const [configureMessage, setConfigureMessage] = useState<string | null>(null);
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [agentValidationError, setAgentValidationError] = useState<string | null>(null);

  const [symbolsInput, setSymbolsInput] = useState('BTC, ETH');
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-06-30');
  const [slippageModel, setSlippageModel] = useState<BacktestSlippageModel>('FIXED');
  const [commissionPct, setCommissionPct] = useState('0.001');
  const [runPending, setRunPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runValidationError, setRunValidationError] = useState<string | null>(null);
  const [runResponse, setRunResponse] = useState<BacktestRunResponse | null>(null);
  const [testIdInput, setTestIdInput] = useState(() => sessionStorage.getItem(BACKTEST_SESSION_TEST_ID_KEY) ?? '');
  const [loadPending, setLoadPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<StoredBacktestResult | null>(null);

  const normalizeAgentPayload = () => agentDrafts.map(draft => ({
    agentId: draft.agentId.trim() || undefined,
    type: draft.type,
    riskProfile: draft.riskProfile,
    initialCapital: Number(draft.initialCapital),
  }));

  const validateAgentDrafts = () => {
    if (agentDrafts.length === 0) return 'Add at least one agent.';

    for (const [index, draft] of agentDrafts.entries()) {
      if (!draft.agentId.trim()) return `Agent ${index + 1} requires an id.`;
      const initialCapital = Number(draft.initialCapital);
      if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
        return `Agent ${index + 1} needs a positive initial capital.`;
      }
    }

    return null;
  };

  const validateRunInputs = () => {
    const agentError = validateAgentDrafts();
    if (agentError) return agentError;

    const symbols = symbolsInput.split(',').map(symbol => symbol.trim()).filter(Boolean);
    if (symbols.length === 0) return 'At least one symbol is required.';
    if (!startDate || !endDate) return 'Start date and end date are required.';

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);
    if (Number.isNaN(parsedStartDate.getTime()) || Number.isNaN(parsedEndDate.getTime()) || parsedStartDate >= parsedEndDate) {
      return 'Enter a valid date range where the start date is before the end date.';
    }

    const parsedCommission = Number(commissionPct);
    if (!Number.isFinite(parsedCommission) || parsedCommission < 0) {
      return 'Commission must be zero or a positive decimal value.';
    }

    return null;
  };

  const updateAgentDraft = (index: number, field: keyof BacktestAgentDraft, value: string) => {
    setAgentDrafts(current => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, [field]: value } : draft
    )));
    setAgentValidationError(null);
    setConfigureError(null);
    setRunValidationError(null);
  };

  const loadBacktestResult = async (candidateId?: string) => {
    const testId = (candidateId ?? testIdInput).trim();
    if (!testId) {
      setLoadError('Enter a test id to load stored results.');
      return;
    }

    setLoadPending(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/backtest/results/${encodeURIComponent(testId)}`);
      const payload = await response.json().catch(() => ({})) as StoredBacktestResult & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to load backtest result (${response.status}).`);
      }

      setResult(payload);
      setTestIdInput(testId);
      sessionStorage.setItem(BACKTEST_SESSION_TEST_ID_KEY, testId);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load backtest result.');
    } finally {
      setLoadPending(false);
    }
  };

  const handleConfigureAgents = async () => {
    const validationError = validateAgentDrafts();
    if (validationError) {
      setAgentValidationError(validationError);
      return;
    }

    setConfigurePending(true);
    setConfigureError(null);
    setConfigureMessage(null);
    setAgentValidationError(null);

    try {
      const response = await fetch('/api/agents/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: normalizeAgentPayload() }),
      });

      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        configured?: number;
        agents?: ConfiguredBacktestAgent[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to configure agents (${response.status}).`);
      }

      setConfiguredAgents(payload.agents ?? []);
      setConfigureMessage(`Configured ${payload.configured ?? payload.agents?.length ?? agentDrafts.length} agent(s) for backtesting.`);
    } catch (err) {
      setConfigureError(err instanceof Error ? err.message : 'Failed to configure agents.');
    } finally {
      setConfigurePending(false);
    }
  };

  const handleRunBacktest = async () => {
    const validationError = validateRunInputs();
    if (validationError) {
      setRunValidationError(validationError);
      return;
    }

    const symbols = symbolsInput.split(',').map(symbol => symbol.trim().toUpperCase()).filter(Boolean);

    setRunPending(true);
    setRunError(null);
    setRunValidationError(null);

    try {
      const response = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          startDate,
          endDate,
          agents: normalizeAgentPayload(),
          slippageModel,
          commissionPct: Number(commissionPct),
        }),
      });

      const payload = await response.json().catch(() => ({})) as BacktestRunResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? `Backtest run failed (${response.status}).`);
      }

      setRunResponse(payload);
      setTestIdInput(payload.testId);
      sessionStorage.setItem(BACKTEST_SESSION_TEST_ID_KEY, payload.testId);
      await loadBacktestResult(payload.testId);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Backtest run failed.');
    } finally {
      setRunPending(false);
    }
  };

  const chartLabels = result?.agentResults[0]?.metrics.equityCurve.map(point => {
    const date = new Date(point.date);
    return Number.isNaN(date.getTime()) ? String(point.date) : date.toLocaleDateString();
  }) ?? [];

  const chartColors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  const equityChartData = result ? {
    labels: chartLabels,
    datasets: result.agentResults.map((agent, index) => ({
      label: agent.agentId,
      data: agent.metrics.equityCurve.map(point => point.capital),
      borderColor: chartColors[index % chartColors.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
    })),
  } : null;

  const summaryCards = result ? [
    { label: 'Top Performer', value: result.comparison.topPerformerByReturn },
    { label: 'Average Return', value: `${(result.comparison.averageReturn * 100).toFixed(2)}%` },
    { label: 'Best Return', value: `${(result.comparison.bestReturn * 100).toFixed(2)}%` },
    { label: 'Average Win Rate', value: `${(result.comparison.averageWinRate * 100).toFixed(1)}%` },
  ] : runResponse ? [
    { label: 'Top Performer', value: runResponse.topPerformer },
    { label: 'Average Return', value: `${runResponse.summary.averageReturn.toFixed(2)}%` },
    { label: 'Best Return', value: `${runResponse.summary.bestReturn.toFixed(2)}%` },
    { label: 'Average Win Rate', value: `${runResponse.summary.averageWinRate.toFixed(1)}%` },
  ] : [];

  return (
    <div style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <section style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem', backgroundColor: 'var(--surface)' }}>
        <div style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700 }}>Backtesting Workspace</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Configure agents, run historical backtests, and reload saved simulations by test id.
          </p>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {agentDrafts.map((draft, index) => (
            <div key={`${draft.agentId}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Agent ID
                <input
                  value={draft.agentId}
                  onChange={event => updateAgentDraft(index, 'agentId', event.target.value)}
                  placeholder="agent_alpha"
                  style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Type
                <select
                  value={draft.type}
                  onChange={event => updateAgentDraft(index, 'type', event.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                >
                  {BACKTEST_AGENT_TYPE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Risk Profile
                <select
                  value={draft.riskProfile}
                  onChange={event => updateAgentDraft(index, 'riskProfile', event.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                >
                  {BACKTEST_RISK_PROFILE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Initial Capital
                <input
                  type="number"
                  min="1"
                  value={draft.initialCapital}
                  onChange={event => updateAgentDraft(index, 'initialCapital', event.target.value)}
                  style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
                />
              </label>
              <button
                type="button"
                onClick={() => setAgentDrafts(current => current.length === 1 ? current : current.filter((_, draftIndex) => draftIndex !== index))}
                disabled={agentDrafts.length === 1}
                style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', cursor: agentDrafts.length === 1 ? 'not-allowed' : 'pointer', color: 'var(--text)' }}
              >
                Remove
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setAgentDrafts(current => [...current, createDefaultBacktestAgent(current.length)])}
              style={{ padding: '0.55rem 0.85rem', borderRadius: '0.375rem', border: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', cursor: 'pointer', color: 'var(--text)', fontWeight: 600 }}
            >
              Add Agent
            </button>
            <button
              type="button"
              onClick={handleConfigureAgents}
              disabled={configurePending}
              style={{ padding: '0.55rem 0.85rem', borderRadius: '0.375rem', border: 'none', backgroundColor: configurePending ? '#93c5fd' : '#2563eb', color: '#fff', cursor: configurePending ? 'wait' : 'pointer', fontWeight: 600 }}
            >
              {configurePending ? 'Configuring...' : 'Configure Agents'}
            </button>
          </div>

          {agentValidationError && <div style={{ fontSize: '0.82rem', color: '#b91c1c' }}>{agentValidationError}</div>}
          {configureError && <div style={{ fontSize: '0.82rem', color: '#b91c1c' }}>{configureError}</div>}
          {configureMessage && <div style={{ fontSize: '0.82rem', color: '#047857' }}>{configureMessage}</div>}
          {configuredAgents.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Ready agents: {configuredAgents.map(agent => `${agent.agentId} (${agent.type}/${agent.riskProfile})`).join(', ')}
            </div>
          )}
        </div>
      </section>

      <section style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem', backgroundColor: 'var(--surface)' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Run Backtest</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Symbols
            <input
              value={symbolsInput}
              onChange={event => {
                setSymbolsInput(event.target.value);
                setRunValidationError(null);
              }}
              placeholder="BTC, ETH"
              style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Start Date
            <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            End Date
            <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }} />
          </label>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Slippage
            <select value={slippageModel} onChange={event => setSlippageModel(event.target.value as BacktestSlippageModel)} style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}>
              {BACKTEST_SLIPPAGE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Commission %
            <input type="number" min="0" step="0.0001" value={commissionPct} onChange={event => setCommissionPct(event.target.value)} style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }} />
          </label>
          <button
            type="button"
            onClick={handleRunBacktest}
            disabled={runPending}
            style={{ padding: '0.55rem 0.95rem', borderRadius: '0.375rem', border: 'none', backgroundColor: runPending ? '#93c5fd' : '#2563eb', color: '#fff', cursor: runPending ? 'wait' : 'pointer', fontWeight: 600 }}
          >
            {runPending ? 'Running...' : 'Run Backtest'}
          </button>
        </div>
        {runValidationError && <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: '#b91c1c' }}>{runValidationError}</div>}
        {runError && <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: '#b91c1c' }}>{runError}</div>}
        {runResponse && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: '#047857' }}>
            Backtest {runResponse.testId} completed. Stored test id is ready for reload.
          </div>
        )}
      </section>

      <section style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem', backgroundColor: 'var(--surface)' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Results</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '18rem' }}>
            Test ID
            <input
              value={testIdInput}
              onChange={event => {
                setTestIdInput(event.target.value);
                setLoadError(null);
              }}
              placeholder="backtest_123456"
              style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
            />
          </label>
          <button
            type="button"
            onClick={() => void loadBacktestResult()}
            disabled={loadPending}
            style={{ padding: '0.55rem 0.95rem', borderRadius: '0.375rem', border: 'none', backgroundColor: loadPending ? '#93c5fd' : '#2563eb', color: '#fff', cursor: loadPending ? 'wait' : 'pointer', fontWeight: 600 }}
          >
            {loadPending ? 'Loading...' : 'Load Results'}
          </button>
        </div>
        {loadError && <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: '#b91c1c' }}>{loadError}</div>}

        {summaryCards.length > 0 && (
          <div style={{ marginTop: '0.9rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {summaryCards.map(card => (
              <div key={card.label} style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', padding: '0.75rem', backgroundColor: 'var(--surface-2)' }}>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{card.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {(result?.comparison.summary || runResponse?.summary.narrative) && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '0.625rem', backgroundColor: 'var(--surface-2)', color: 'var(--text-subtle)', fontSize: '0.86rem' }}>
            {result?.comparison.summary ?? runResponse?.summary.narrative}
          </div>
        )}

        {result && equityChartData && (
          <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700 }}>Equity Curve</h3>
              <Line
                data={equityChartData}
                options={{
                  responsive: true,
                  plugins: { tooltip: { mode: 'index', intersect: false } },
                  scales: {
                    x: { grid: { display: false } },
                    y: { ticks: { callback: value => `$${Number(value).toLocaleString()}` } },
                  },
                }}
              />
            </div>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {result.agentResults.map(agent => (
                <div key={agent.agentId} style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', padding: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 700 }}>{agent.agentId}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{agent.agentType} / {agent.riskProfile}</div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {agent.trades.length} trade(s)
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', fontSize: '0.82rem' }}>
                    <div><strong>Return:</strong> {(agent.metrics.totalReturnPct * 100).toFixed(2)}%</div>
                    <div><strong>Win rate:</strong> {(agent.metrics.winRate * 100).toFixed(1)}%</div>
                    <div><strong>Sharpe:</strong> {agent.metrics.sharpeRatio.toFixed(2)}</div>
                    <div><strong>Drawdown:</strong> {(agent.metrics.maxDrawdown * 100).toFixed(2)}%</div>
                    <div><strong>Profit factor:</strong> {agent.metrics.profitFactor.toFixed(2)}</div>
                    <div><strong>Total trades:</strong> {agent.metrics.totalTrades}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TradingWorkspace() {
  const [statusData, setStatusData] = useState<TradingExchangeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [quoteSymbol, setQuoteSymbol] = useState('BTC');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteData, setQuoteData] = useState<TradingPriceResponse | null>(null);

  const [balancesData, setBalancesData] = useState<TradingBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  const [statsData, setStatsData] = useState<TradingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [orderSymbol, setOrderSymbol] = useState('BTC');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderSize, setOrderSize] = useState('0.001');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('LIMIT');
  const [orderPrice, setOrderPrice] = useState('');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderValidationError, setOrderValidationError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  const formatCurrency = (value: number) => value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

  const loadExchangeStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await fetch('/api/trading/exchange-status');
      const payload = await response.json() as TradingExchangeStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Failed to load exchange status (${response.status}).`);
      setStatusData(payload);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to load exchange status.');
      setStatusData(null);
    } finally {
      setStatusLoading(false);
    }
  };

  const loadBalances = async () => {
    setBalancesLoading(true);
    setBalancesError(null);
    try {
      const response = await fetch('/api/trading/balances');
      const payload = await response.json() as TradingBalance[] & { error?: string };
      if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Failed to load balances (${response.status}).`);
      const list = Array.isArray(payload) ? payload : [];
      setBalancesData(list);
    } catch (err) {
      setBalancesError(err instanceof Error ? err.message : 'Failed to load balances.');
      setBalancesData([]);
    } finally {
      setBalancesLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const response = await fetch('/api/trading/stats');
      const payload = await response.json() as TradingStats & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Failed to load stats (${response.status}).`);
      setStatsData(payload);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Failed to load stats.');
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadQuote = async () => {
    const symbol = quoteSymbol.trim().toUpperCase();
    if (!symbol) {
      setQuoteError('Enter a symbol to fetch a quote.');
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const response = await fetch(`/api/trading/price/${encodeURIComponent(symbol)}`);
      const payload = await response.json() as TradingPriceResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Failed to fetch quote (${response.status}).`);
      setQuoteData(payload);
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'Failed to fetch quote.');
      setQuoteData(null);
    } finally {
      setQuoteLoading(false);
    }
  };

  const validateOrder = () => {
    const symbol = orderSymbol.trim().toUpperCase();
    const size = Number(orderSize);
    const price = Number(orderPrice);

    if (!symbol) return 'Order symbol is required.';
    if (!Number.isFinite(size) || size <= 0) return 'Order size must be a positive number.';
    if (orderType === 'LIMIT' && (!Number.isFinite(price) || price <= 0)) {
      return 'Limit order price must be a positive number.';
    }
    return null;
  };

  const submitOrder = async () => {
    const validationError = validateOrder();
    if (validationError) {
      setOrderValidationError(validationError);
      setOrderError(null);
      setOrderSuccess(null);
      return;
    }

    setOrderSubmitting(true);
    setOrderValidationError(null);
    setOrderError(null);
    setOrderSuccess(null);

    try {
      const payload = {
        symbol: orderSymbol.trim().toUpperCase(),
        side: orderSide,
        size: Number(orderSize),
        orderType,
        ...(orderType === 'LIMIT' ? { price: Number(orderPrice) } : {}),
      };

      const response = await fetch('/api/trading/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json() as TradingOrderResponse & { error?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? result.reason ?? `Order failed (${response.status}).`);
      }

      const orderId = result.order?.id ? `Order ${result.order.id}` : 'Order';
      const orderPriceText = typeof result.order?.price === 'number' ? ` at ${formatCurrency(result.order.price)}` : '';
      setOrderSuccess(`${orderId} placed: ${result.order?.type ?? orderSide} ${result.order?.quantity ?? Number(orderSize)} ${result.order?.symbol ?? orderSymbol.trim().toUpperCase()}${orderPriceText}.`);
      await Promise.all([loadStats(), loadBalances()]);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Failed to submit order.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadExchangeStatus(), loadBalances(), loadStats()]);
    const interval = window.setInterval(() => {
      void loadExchangeStatus();
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <section style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1rem', backgroundColor: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 700 }}>Trading Workspace</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Monitor exchange connectivity, fetch quotes, review balances and stats, and execute guarded orders.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void Promise.all([loadExchangeStatus(), loadBalances(), loadStats()]);
            }}
            style={{ padding: '0.5rem 0.8rem', borderRadius: '0.375rem', border: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600 }}
          >
            Refresh Trading Data
          </button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', backgroundColor: 'var(--surface)', padding: '0.85rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Exchange Status</div>
          {statusLoading ? (
            <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading exchange status...</div>
          ) : statusError ? (
            <div role="alert" style={{ marginTop: '0.5rem', color: '#b91c1c', fontSize: '0.85rem' }}>{statusError}</div>
          ) : statusData ? (
            <>
              <div style={{ marginTop: '0.45rem', fontWeight: 700 }}>{statusData.name}</div>
              <div style={{ marginTop: '0.25rem', color: statusData.connected ? '#166534' : '#991b1b', fontWeight: 700 }}>
                {statusData.connected ? 'Connected' : 'Disconnected'}
              </div>
              <div style={{ marginTop: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Mode: {statusData.mode} · Provider: {statusData.provider ?? 'default'}
              </div>
            </>
          ) : null}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', backgroundColor: 'var(--surface)', padding: '0.85rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Capital</div>
          <div style={{ marginTop: '0.45rem', fontSize: '1.25rem', fontWeight: 700 }}>{formatCurrency(statsData?.currentCapital ?? 0)}</div>
          <div style={{ marginTop: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Initial: {formatCurrency(statsData?.initialCapital ?? 0)}</div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', backgroundColor: 'var(--surface)', padding: '0.85rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PnL</div>
          <div style={{ marginTop: '0.45rem', fontSize: '1.25rem', fontWeight: 700, color: (statsData?.pnl ?? 0) >= 0 ? '#166534' : '#991b1b' }}>
            {formatCurrency(statsData?.pnl ?? 0)}
          </div>
          <div style={{ marginTop: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{(statsData?.pnlPercent ?? 0).toFixed(2)}%</div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', backgroundColor: 'var(--surface)', padding: '0.85rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Trades</div>
          <div style={{ marginTop: '0.45rem', fontSize: '1.25rem', fontWeight: 700 }}>{statsData?.totalTrades ?? 0}</div>
          <div style={{ marginTop: '0.2rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Successful: {statsData?.successfulTrades ?? 0}</div>
        </div>
      </section>

      {statsError && (
        <div role="alert" style={{ color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.625rem', padding: '0.75rem' }}>
          {statsError}
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(340px, 1.2fr)', gap: '1rem' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', backgroundColor: 'var(--surface)', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Quote Lookup</h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              value={quoteSymbol}
              onChange={event => {
                setQuoteSymbol(event.target.value);
                setQuoteError(null);
              }}
              placeholder="BTC"
              aria-label="Trading quote symbol"
              style={{ flex: 1, minWidth: '140px', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
            />
            <button
              type="button"
              onClick={() => void loadQuote()}
              disabled={quoteLoading}
              style={{ padding: '0.5rem 0.8rem', borderRadius: '0.375rem', border: 'none', backgroundColor: quoteLoading ? '#93c5fd' : '#2563eb', color: '#fff', cursor: quoteLoading ? 'wait' : 'pointer', fontWeight: 600 }}
            >
              {quoteLoading ? 'Fetching...' : 'Get Quote'}
            </button>
          </div>
          {quoteError && <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{quoteError}</div>}
          {quoteData && (
            <div style={{ border: '1px solid var(--border)', borderRadius: '0.625rem', padding: '0.75rem', backgroundColor: 'var(--surface-2)' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Latest quote</div>
              <div style={{ marginTop: '0.3rem', fontSize: '1.2rem', fontWeight: 700 }}>{quoteData.symbol.toUpperCase()}</div>
              <div style={{ marginTop: '0.2rem', fontSize: '1rem', color: '#1d4ed8', fontWeight: 700 }}>{formatCurrency(quoteData.price)}</div>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>Balances</h4>
            {balancesLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading balances...</div>
            ) : balancesError ? (
              <div role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{balancesError}</div>
            ) : balancesData.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No balances returned.</div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto' }}>
                {balancesData.map(balance => (
                  <div key={balance.symbol} style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.6rem', backgroundColor: 'var(--surface-2)', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{balance.symbol}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Available {balance.available.toFixed(4)}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total {balance.total.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', backgroundColor: 'var(--surface)', padding: '1rem', display: 'grid', gap: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Order Ticket</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem' }}>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Symbol
              <input
                value={orderSymbol}
                onChange={event => {
                  setOrderSymbol(event.target.value);
                  setOrderValidationError(null);
                }}
                aria-label="Order symbol"
                placeholder="BTC"
                style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Side
              <select
                value={orderSide}
                onChange={event => setOrderSide(event.target.value as 'BUY' | 'SELL')}
                aria-label="Order side"
                style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Size
              <input
                type="number"
                min="0"
                step="0.000001"
                value={orderSize}
                onChange={event => {
                  setOrderSize(event.target.value);
                  setOrderValidationError(null);
                }}
                aria-label="Order size"
                style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Type
              <select
                value={orderType}
                onChange={event => {
                  setOrderType(event.target.value as 'MARKET' | 'LIMIT');
                  setOrderValidationError(null);
                }}
                aria-label="Order type"
                style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
              </select>
            </label>
          </div>
          {orderType === 'LIMIT' && (
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Limit Price
              <input
                type="number"
                min="0"
                step="0.0001"
                value={orderPrice}
                onChange={event => {
                  setOrderPrice(event.target.value);
                  setOrderValidationError(null);
                }}
                aria-label="Order price"
                style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid var(--border-input)', backgroundColor: 'var(--surface)' }}
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => void submitOrder()}
            disabled={orderSubmitting}
            style={{ padding: '0.55rem 0.95rem', borderRadius: '0.375rem', border: 'none', backgroundColor: orderSubmitting ? '#93c5fd' : '#2563eb', color: '#fff', cursor: orderSubmitting ? 'wait' : 'pointer', fontWeight: 700 }}
          >
            {orderSubmitting ? 'Submitting...' : 'Place Order'}
          </button>

          {orderValidationError && (
            <div role="alert" style={{ color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.6rem', fontSize: '0.85rem' }}>
              {orderValidationError}
            </div>
          )}
          {orderError && (
            <div role="alert" style={{ color: '#991b1b', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '0.5rem', padding: '0.6rem', fontSize: '0.85rem', fontWeight: 600 }}>
              Guardrail: {orderError}
            </div>
          )}
          {orderSuccess && (
            <div style={{ color: '#166534', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.5rem', padding: '0.6rem', fontSize: '0.85rem', fontWeight: 600 }}>
              {orderSuccess}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// DETAIL MODAL COMPONENT
// ============================================================================

interface DetailModalProps {
  symbol: string | null;
  onClose: () => void;
}

function DetailModal({ symbol, onClose }: DetailModalProps) {
  const { detail, loading, error } = useCoinDetail(symbol);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!symbol) return null;

  const scoreColor = (value: number) => {
    if (value > 0.1) return '#10b981';
    if (value < -0.1) return '#ef4444';
    return '#6b7280';
  };

  const scoreLabel = (value: number) => {
    if (value > 0.1) return 'Positive';
    if (value < -0.1) return 'Negative';
    return 'Mixed';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--surface)',
          borderRadius: '0.5rem',
          maxWidth: '900px',
          maxHeight: '90vh',
          overflow: 'auto',
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '0.25rem',
            padding: '0.5rem',
            cursor: 'pointer',
            fontSize: '1.5rem',
            zIndex: 1001,
            color: 'var(--text)',
          }}
        >
          ✕
        </button>

        {/* Content */}
        <div style={{ padding: '2rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              Loading {symbol}...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#b91c1c' }}>
              Failed to load detail: {error}
            </div>
          ) : detail ? (
            <>
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'start',
                  marginBottom: '1.5rem',
                }}
              >
                <div>
                  <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.875rem', fontWeight: '700' }}>
                    {detail.name}
                  </h2>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#3b82f6' }}>
                    ${detail.price_usd.toLocaleString()}
                  </div>
                </div>
                <SentimentBadge
                  score={detail.sentiment_score}
                  confidence={detail.sentiment_confidence}
                />
              </div>

              {/* Sentiment Summary */}
              <div style={{ backgroundColor: 'var(--surface-2)', padding: '1rem', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: '600', color: 'var(--text)' }}>
                  Sentiment Analysis
                </h3>
                <p style={{ margin: '0', color: 'var(--text-strong)' }}>
                  {detail.sentiment_summary}
                </p>
                {detail.sentiment_today?.short_term_outlook && (
                  <p style={{ margin: '0.75rem 0 0 0', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
                    {detail.sentiment_today.short_term_outlook}
                  </p>
                )}
              </div>

              {/* Score Attribution */}
              {detail.sentiment_today?.feature_attribution &&
               Object.keys(detail.sentiment_today.feature_attribution).length > 0 && (() => {
                const fa = detail.sentiment_today!.feature_attribution!;
                const total = Object.values(fa).reduce((s, v) => s + Math.abs(v), 0);
                const entries = Object.entries(fa);
                return (
                  <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--surface-3)', borderRadius: '0.5rem', borderLeft: '4px solid #8b5cf6' }}>
                    <h3 style={{ margin: '0 0 0.875rem 0', fontSize: '1rem', fontWeight: '700', color: 'var(--text)' }}>Score Attribution</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem' }}>
                      {entries.map(([key, value]) => {
                        const barPct = total > 0 ? Math.abs(value) / total * 100 : 0;
                        const barColor = value >= 0 ? '#3b82f6' : '#ef4444';
                        const label = key.charAt(0).toUpperCase() + key.slice(1);
                        return (
                          <div key={key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-subtle)', marginBottom: '0.2rem' }}>
                              <span>{label}</span>
                              <span style={{ fontWeight: '700', color: value >= 0 ? '#3b82f6' : '#ef4444' }}>
                                {(value >= 0 ? '+' : '') + value.toFixed(3)}
                              </span>
                            </div>
                            <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(barPct, 100)}%`, backgroundColor: barColor, borderRadius: '3px' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Multi-Source Trending Signal */}
              {detail.sentiment_today?.trending_sentiment && (() => {
                const ts = detail.sentiment_today!.trending_sentiment!;
                const dirColor = ts.sentiment === 'BULL' ? '#10b981' : ts.sentiment === 'BEAR' ? '#ef4444' : '#f59e0b';
                const signals = [
                  { label: 'Sentiment', value: ts.signals.sentiment },
                  { label: 'Engagement', value: ts.signals.engagement },
                  { label: 'Authority', value: ts.signals.authority },
                  { label: 'Recency', value: ts.signals.recency },
                ];
                return (
                  <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--surface-3)', borderRadius: '0.5rem', borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', color: 'var(--text)' }}>Multi-Source Trending Signal</h3>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: '700', backgroundColor: `${dirColor}18`, color: dirColor }}>
                        {ts.sentiment}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{ts.composite_score.toFixed(0)}/100 composite</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem', marginBottom: '0.875rem' }}>
                      {signals.map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-subtle)', marginBottom: '0.2rem' }}>
                            <span>{label}</span><span style={{ fontWeight: '700' }}>{value.toFixed(0)}</span>
                          </div>
                          <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, backgroundColor: '#3b82f6', borderRadius: '3px' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>&#128293; {ts.velocity.toFixed(1)} mentions/hr</span>
                      <span>{ts.mention_count} mentions (24h)</span>
                      <span>{ts.unique_sources} sources</span>
                    </div>
                  </div>
                );
              })()}

              {(detail.sentiment_today?.collection_stats || detail.sentiment_today?.source_breakdown?.length) && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600' }}>
                    Signal Overview
                  </h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '0.75rem',
                      marginBottom: '1rem',
                    }}
                  >
                    <div style={{ padding: '0.875rem', border: '1px solid var(--border)', borderRadius: '0.5rem', backgroundColor: 'var(--surface)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Trending Score
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)' }}>
                        {(detail.sentiment_today?.collection_stats?.trending_score ?? detail.trending_score).toFixed(1)}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid var(--border)', borderRadius: '0.5rem', backgroundColor: 'var(--surface)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Items Collected
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)' }}>
                        {detail.sentiment_today?.collection_stats?.total_items ?? detail.scored_items.length}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid var(--border)', borderRadius: '0.5rem', backgroundColor: 'var(--surface)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Sources Active
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)' }}>
                        {detail.sentiment_today?.collection_stats?.source_count ?? detail.sentiment_today?.source_breakdown?.length ?? 0}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid var(--border)', borderRadius: '0.5rem', backgroundColor: 'var(--surface)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Avg Recency
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)' }}>
                        {((detail.sentiment_today?.collection_stats?.average_recency_score ?? 0) * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {detail.sentiment_today?.source_breakdown && detail.sentiment_today.source_breakdown.length > 0 && (
                    <div>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', fontWeight: '600' }}>
                        Source Breakdown
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                        {detail.sentiment_today.source_breakdown.map(source => (
                          <div
                            key={source.source}
                            style={{
                              padding: '0.875rem',
                              border: '1px solid var(--border)',
                              borderRadius: '0.5rem',
                              backgroundColor: 'var(--surface)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <span style={{ fontWeight: '700', color: 'var(--text)' }}>{source.source_label}</span>
                              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{source.item_count} items</span>
                            </div>
                            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                              <span>Sentiment: <strong style={{ color: scoreColor(source.average_sentiment_score) }}>{source.average_sentiment_score.toFixed(2)}</strong></span>
                              <span>Weighted: <strong style={{ color: scoreColor(source.average_weighted_score) }}>{source.average_weighted_score.toFixed(2)}</strong></span>
                              <span>Frequency: <strong>{source.weighted_frequency.toFixed(2)}</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {detail.scored_items && detail.scored_items.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600' }}>
                    Scored Market Signals
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {detail.scored_items.slice(0, 6).map(item => (
                      <div
                        key={item.id}
                        style={{
                          padding: '1rem',
                          border: '1px solid var(--border)',
                          borderRadius: '0.5rem',
                          backgroundColor: 'var(--surface)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'start', marginBottom: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {item.source_label}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                {item.published_at ? new Date(item.published_at).toLocaleString() : 'Timestamp unavailable'}
                              </span>
                            </div>
                            <div style={{ fontWeight: '700', color: 'var(--text)', marginBottom: '0.35rem' }}>
                              {item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#111827', textDecoration: 'none' }}>
                                  {item.title}
                                </a>
                              ) : item.title}
                            </div>
                            {item.body && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                                {item.body}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              minWidth: '110px',
                              textAlign: 'right',
                              padding: '0.5rem 0.65rem',
                              borderRadius: '0.5rem',
                              backgroundColor: `${scoreColor(item.weighted_score)}15`,
                              color: scoreColor(item.weighted_score),
                            }}
                          >
                            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {scoreLabel(item.weighted_score)}
                            </div>
                            <div style={{ fontSize: '1.125rem', fontWeight: '700' }}>
                              {item.weighted_score.toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span>Sentiment: <strong style={{ color: scoreColor(item.sentiment_score) }}>{item.sentiment_score.toFixed(2)}</strong></span>
                          <span>Relevance: <strong>{item.relevance_score.toFixed(2)}</strong></span>
                          <span>Recency: <strong>{item.recency_score.toFixed(2)}</strong></span>
                          <span>Engagement: <strong>{item.engagement_score.toFixed(2)}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Price History Chart */}
              {detail.price_history && detail.price_history.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: '600' }}>
                    Price History (7d)
                  </h3>
                  <Line
                    data={{
                      labels: detail.price_history.map(p =>
                        new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      ),
                      datasets: [{
                        label: `${detail.symbol} Price (USD)`,
                        data: detail.price_history.map(p => p.close),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.3,
                      }],
                    }}
                    options={{
                      responsive: true,
                      plugins: { tooltip: { mode: 'index', intersect: false } },
                      scales: {
                        x: { grid: { display: false } },
                        y: { ticks: { callback: v => `$${Number(v).toLocaleString()}` } },
                      },
                    }}
                  />
                </div>
              )}

              {/* Headlines */}
              <div>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600' }}>
                  Recent Headlines
                </h3>
                {detail.headlines && detail.headlines.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {detail.headlines.slice(0, 5).map((headline, i) => (
                      <div
                        key={i}
                        style={{
                          padding: '0.75rem',
                          border: '1px solid var(--border)',
                          borderRadius: '0.375rem',
                          fontSize: '0.875rem',
                          color: 'var(--text)',
                        }}
                      >
                        {headline}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '0.375rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No headlines available. Configure NEWSAPI_API_KEY or Reddit credentials to enable news collection.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              Failed to load detail
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

type ActiveView = 'dashboard' | 'agents' | 'marl' | 'social' | 'backtesting' | 'trading';

export default function App() {
  const { coins, loading, error, lastUpdated } = useCoins();
  const { health, status: healthStatus, error: healthError, lastChecked } = useSystemHealth();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const [healthExpanded, setHealthExpanded] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const handleTickerSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedQuery = searchQuery.trim().toUpperCase();
    if (!normalizedQuery) {
      setSearchFeedback('Enter a ticker symbol to search.');
      return;
    }

    const matchedCoin = coins.find(coin => coin.symbol.toUpperCase() === normalizedQuery)
      ?? coins.find(coin => coin.symbol.toUpperCase().includes(normalizedQuery));

    if (!matchedCoin) {
      setSearchFeedback(`No coin found for ticker ${normalizedQuery}.`);
      return;
    }

    setActiveView('dashboard');
    setSelectedSymbol(matchedCoin.symbol);
    setSearchQuery(matchedCoin.symbol);
    setSearchFeedback(null);
  };

  const navTabStyle = (view: ActiveView): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    border: 'none',
    borderBottom: activeView === view ? '2px solid #3b82f6' : '2px solid transparent',
    backgroundColor: 'transparent',
    color: activeView === view ? '#3b82f6' : 'var(--text-muted)',
    fontWeight: activeView === view ? '600' : '400',
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  });

  const healthConfig: Record<HealthState, { label: string; background: string; border: string; color: string; dot: string }> = {
    healthy: {
      label: 'Healthy',
      background: '#ecfdf5',
      border: '#86efac',
      color: '#166534',
      dot: '#16a34a',
    },
    degraded: {
      label: 'Degraded',
      background: '#fffbeb',
      border: '#fcd34d',
      color: '#92400e',
      dot: '#d97706',
    },
    down: {
      label: 'Down',
      background: '#fef2f2',
      border: '#fca5a5',
      color: '#991b1b',
      dot: '#dc2626',
    },
  };

  const currentHealth = healthConfig[healthStatus];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', fontFamily: 'system-ui, sans-serif', color: 'var(--text)' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
        :root {
          --bg: #f9fafb;
          --surface: #ffffff;
          --surface-2: #f3f4f6;
          --surface-3: #f9fafb;
          --border: #e5e7eb;
          --border-input: #d1d5db;
          --text: #111827;
          --text-strong: #1f2937;
          --text-muted: #6b7280;
          --text-subtle: #4b5563;
        }
        [data-theme="dark"] {
          --bg: #0f172a;
          --surface: #1e293b;
          --surface-2: #334155;
          --surface-3: #1e293b;
          --border: #334155;
          --border-input: #475569;
          --text: #f1f5f9;
          --text-strong: #e2e8f0;
          --text-muted: #94a3b8;
          --text-subtle: #cbd5e1;
        }
        select option { background-color: var(--surface); color: var(--text); }
        input, select { color-scheme: light dark; }
      `}</style>

      {/* Nav */}
      <nav
        style={{
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '0 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: '0', fontSize: '1.25rem', fontWeight: '700', padding: '1rem 0', color: 'var(--text)' }}>
          Sentiment Analyzer
        </h1>
        <div style={{ display: 'flex', gap: '0.25rem', height: '100%' }}>
          <button style={navTabStyle('dashboard')} onClick={() => setActiveView('dashboard')}>
            Dashboard
          </button>
          <button style={navTabStyle('agents')} onClick={() => setActiveView('agents')}>
            Agents
          </button>
          <button style={navTabStyle('marl')} onClick={() => setActiveView('marl')}>
            MARL Competition
          </button>
          <button style={navTabStyle('social')} onClick={() => setActiveView('social')}>
            Social Intel
          </button>
          <button style={navTabStyle('backtesting')} onClick={() => setActiveView('backtesting')}>
            Backtesting
          </button>
          <button style={navTabStyle('trading')} onClick={() => setActiveView('trading')}>
            Trading
          </button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem 0' }}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-expanded={healthExpanded}
              onClick={() => setHealthExpanded(open => !open)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                borderRadius: '999px',
                border: `1px solid ${currentHealth.border}`,
                backgroundColor: currentHealth.background,
                color: currentHealth.color,
                padding: '0.45rem 0.75rem',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '0.55rem',
                  height: '0.55rem',
                  borderRadius: '50%',
                  backgroundColor: currentHealth.dot,
                  boxShadow: `0 0 0 3px ${currentHealth.background}`,
                }}
              />
              System {currentHealth.label}
            </button>

            {healthExpanded && (
              <div
                role="dialog"
                aria-label="System health details"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 0.5rem)',
                  right: 0,
                  width: 'min(22rem, calc(100vw - 3rem))',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)',
                  padding: '0.9rem',
                  zIndex: 1100,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>System Health</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Polls every {Math.round(HEALTH_POLL_INTERVAL_MS / 1000)}s
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: currentHealth.color }}>
                    {currentHealth.label}
                  </span>
                </div>

                {health?.services ? (
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {Object.entries(health.services).map(([service, serviceStatus]) => {
                      const isServiceHealthy = serviceStatus === 'ok';
                      return (
                        <div
                          key={service}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            padding: '0.45rem 0.55rem',
                            borderRadius: '0.5rem',
                            backgroundColor: isServiceHealthy ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.12)',
                          }}
                        >
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-strong)', textTransform: 'capitalize' }}>
                            {service.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isServiceHealthy ? '#166534' : '#92400e' }}>
                            {serviceStatus}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Service breakdown is unavailable while the health endpoint is down.
                  </div>
                )}

                <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {typeof health?.uptime_seconds === 'number' && (
                    <span>Uptime: {Math.floor(health.uptime_seconds)}s</span>
                  )}
                  {lastChecked && (
                    <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
                  )}
                  {healthError && (
                    <span style={{ color: '#b91c1c' }}>{healthError}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleTickerSearch}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <label htmlFor="coin-ticker-search" style={{ fontSize: '0.8125rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
              Search ticker
            </label>
            <input
              id="coin-ticker-search"
              type="search"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                if (searchFeedback) setSearchFeedback(null);
              }}
              placeholder="BTC"
              aria-label="Search ticker"
              style={{
                width: '10rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid var(--border-input)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '0.875rem',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.5rem 0.9rem',
                borderRadius: '0.375rem',
                border: 'none',
                backgroundColor: loading ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              Open
            </button>
            {searchFeedback && (
              <span style={{ fontSize: '0.8125rem', color: '#b91c1c' }} role="status">
                {searchFeedback}
              </span>
            )}
          </form>

          <button
            onClick={() => setIsDark(d => !d)}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontSize: '1.1rem',
              padding: '0.35rem 0.55rem',
              color: 'var(--text-muted)',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </nav>

      {/* Main */}
      <main>
        {activeView === 'dashboard' && (
          <Dashboard
            coins={coins}
            loading={loading}
            error={error}
            lastUpdated={lastUpdated}
            onCoinSelect={setSelectedSymbol}
          />
        )}
        {activeView === 'agents' && (
          <AgentManagementDashboard />
        )}
        {activeView === 'marl' && (
          <MarlCompetitionViewer />
        )}
        {activeView === 'social' && (
          <SocialDashboard />
        )}
        {activeView === 'backtesting' && (
          <BacktestingWorkspace />
        )}
        {activeView === 'trading' && (
          <TradingWorkspace />
        )}
      </main>

      {/* Modal (only relevant on dashboard view) */}
      {activeView === 'dashboard' && (
        <DetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
      )}
    </div>
  );
}
