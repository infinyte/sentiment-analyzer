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
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        backgroundColor: '#ffffff',
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
            <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>
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
          color: '#6b7280',
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
          color: '#1f2937',
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

function Dashboard({ coins, loading, error, lastUpdated, onCoinSelect }: DashboardProps) {
  const [sortBy, setSortBy] = useState<SortBy>('market_cap');

  if (error) {
    return (
      <div
        style={{
          padding: '2rem',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '0.5rem',
          marginBottom: '1rem',
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

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', fontWeight: '700' }}>
          Sentiment Analyzer
        </h1>
        <p style={{ margin: '0', color: '#6b7280' }}>
          Real-time cryptocurrency sentiment analysis
        </p>
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
            backgroundColor: '#ffffff',
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

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
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

      {/* Grid */}
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
          backgroundColor: '#ffffff',
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
            backgroundColor: '#f3f4f6',
            border: 'none',
            borderRadius: '0.25rem',
            padding: '0.5rem',
            cursor: 'pointer',
            fontSize: '1.5rem',
            zIndex: 1001,
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
              <div style={{ backgroundColor: '#f3f4f6', padding: '1rem', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: '600' }}>
                  Sentiment Analysis
                </h3>
                <p style={{ margin: '0', color: '#1f2937' }}>
                  {detail.sentiment_summary}
                </p>
                {detail.sentiment_today?.short_term_outlook && (
                  <p style={{ margin: '0.75rem 0 0 0', color: '#4b5563', fontSize: '0.875rem' }}>
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
                  <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', borderLeft: '4px solid #8b5cf6' }}>
                    <h3 style={{ margin: '0 0 0.875rem 0', fontSize: '1rem', fontWeight: '700' }}>Score Attribution</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem' }}>
                      {entries.map(([key, value]) => {
                        const barPct = total > 0 ? Math.abs(value) / total * 100 : 0;
                        const barColor = value >= 0 ? '#3b82f6' : '#ef4444';
                        const label = key.charAt(0).toUpperCase() + key.slice(1);
                        return (
                          <div key={key}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.2rem' }}>
                              <span>{label}</span>
                              <span style={{ fontWeight: '700', color: value >= 0 ? '#3b82f6' : '#ef4444' }}>
                                {(value >= 0 ? '+' : '') + value.toFixed(3)}
                              </span>
                            </div>
                            <div style={{ height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
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
                  <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700' }}>Multi-Source Trending Signal</h3>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: '700', backgroundColor: `${dirColor}18`, color: dirColor }}>
                        {ts.sentiment}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{ts.composite_score.toFixed(0)}/100 composite</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem', marginBottom: '0.875rem' }}>
                      {signals.map(({ label, value }) => (
                        <div key={label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.2rem' }}>
                            <span>{label}</span><span style={{ fontWeight: '700' }}>{value.toFixed(0)}</span>
                          </div>
                          <div style={{ height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, backgroundColor: '#3b82f6', borderRadius: '3px' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.8rem', color: '#6b7280' }}>
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
                    <div style={{ padding: '0.875rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', backgroundColor: '#ffffff' }}>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Trending Score
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>
                        {(detail.sentiment_today?.collection_stats?.trending_score ?? detail.trending_score).toFixed(1)}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', backgroundColor: '#ffffff' }}>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Items Collected
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>
                        {detail.sentiment_today?.collection_stats?.total_items ?? detail.scored_items.length}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', backgroundColor: '#ffffff' }}>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Sources Active
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>
                        {detail.sentiment_today?.collection_stats?.source_count ?? detail.sentiment_today?.source_breakdown?.length ?? 0}
                      </div>
                    </div>
                    <div style={{ padding: '0.875rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem', backgroundColor: '#ffffff' }}>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Avg Recency
                      </div>
                      <div style={{ marginTop: '0.35rem', fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>
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
                              border: '1px solid #e5e7eb',
                              borderRadius: '0.5rem',
                              backgroundColor: '#ffffff',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <span style={{ fontWeight: '700', color: '#111827' }}>{source.source_label}</span>
                              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{source.item_count} items</span>
                            </div>
                            <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.8125rem', color: '#4b5563' }}>
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
                          border: '1px solid #e5e7eb',
                          borderRadius: '0.5rem',
                          backgroundColor: '#ffffff',
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
                            <div style={{ fontWeight: '700', color: '#111827', marginBottom: '0.35rem' }}>
                              {item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" style={{ color: '#111827', textDecoration: 'none' }}>
                                  {item.title}
                                </a>
                              ) : item.title}
                            </div>
                            {item.body && (
                              <div style={{ fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.5 }}>
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
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
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
                          border: '1px solid #e5e7eb',
                          borderRadius: '0.375rem',
                          fontSize: '0.875rem',
                        }}
                      >
                        {headline}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', color: '#6b7280', fontSize: '0.875rem' }}>
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

type ActiveView = 'dashboard' | 'agents' | 'marl' | 'social';

export default function App() {
  const { coins, loading, error, lastUpdated } = useCoins();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

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
    color: activeView === view ? '#3b82f6' : '#6b7280',
    fontWeight: activeView === view ? '600' : '400',
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
      `}</style>

      {/* Nav */}
      <nav
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
        }}
      >
        <h1 style={{ margin: '0', fontSize: '1.25rem', fontWeight: '700', padding: '1rem 0' }}>
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
        </div>
        <form
          onSubmit={handleTickerSearch}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.75rem 0' }}
        >
          <label htmlFor="coin-ticker-search" style={{ fontSize: '0.8125rem', color: '#4b5563', fontWeight: 600 }}>
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
              border: '1px solid #d1d5db',
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
      </main>

      {/* Modal (only relevant on dashboard view) */}
      {activeView === 'dashboard' && (
        <DetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
      )}
    </div>
  );
}
