// FRONTEND - App.tsx
// Main React component with dashboard and detail modal

import React, { useEffect, useState } from 'react';

// ============================================================================
// TYPES
// ============================================================================

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
  market_rank: number;
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
        setDetail(data.coin);
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

interface CoinCardProps {
  coin: Coin;
  onSelect: (symbol: string) => void;
}

function CoinCard({ coin, onSelect }: CoinCardProps) {
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
        <span
          style={{
            fontSize: '0.75rem',
            backgroundColor: '#f3f4f6',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
          }}
        >
          #{coin.market_rank}
        </span>
      </div>

      {/* Price */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.25rem' }}>
          ${coin.price_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
          <PercentChange value={coin.price_change_24h_percent} label="24h" />
          <PercentChange value={coin.price_change_7d_percent} label="7d" />
        </div>
      </div>

      {/* Sentiment */}
      <div style={{ marginBottom: '0.75rem' }}>
        <SentimentBadge
          score={coin.sentiment_score}
          confidence={coin.sentiment_confidence}
        />
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
        <div>
          <span style={{ fontWeight: '600' }}>Volatility:</span>
          <div>{coin.volatility_24h.toFixed(2)}%</div>
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
          WebkitLineClamp: 2,
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
  onCoinSelect: (symbol: string) => void;
}

function Dashboard({ onCoinSelect }: DashboardProps) {
  const [sortBy, setSortBy] = useState('market_cap');
  const { coins, loading, error, lastUpdated } = useCoins();

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

  const displayCoins = sortBy === 'volatility' ? [...coins].sort((a, b) => b.volatility_24h - a.volatility_24h) : coins;

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
          onChange={e => setSortBy(e.target.value)}
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #d1d5db',
            backgroundColor: '#ffffff',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          <option value="market_cap">Market Cap</option>
          <option value="volatility">Volatility</option>
          <option value="sentiment">Sentiment</option>
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
        {displayCoins.map(coin => (
          <CoinCard key={coin.id} coin={coin} onSelect={onCoinSelect} />
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
  const { detail, loading } = useCoinDetail(symbol);

  if (!symbol) return null;

  return (
    <div
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
              </div>

              {/* Chart Placeholder */}
              <div
                style={{
                  backgroundColor: '#f9fafb',
                  padding: '2rem',
                  borderRadius: '0.375rem',
                  marginBottom: '1.5rem',
                  height: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6b7280',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0', fontWeight: '600' }}>Interactive Chart</p>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                    Chart integration with TradingView or Chart.js
                  </p>
                </div>
              </div>

              {/* Headlines */}
              <div>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600' }}>
                  Recent Headlines
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {detail.headlines && detail.headlines.slice(0, 5).map((headline, i) => (
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

export default function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

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
          padding: '1rem 1.5rem',
        }}
      >
        <h1 style={{ margin: '0', fontSize: '1.25rem', fontWeight: '700' }}>
          Sentiment Analyzer
        </h1>
      </nav>

      {/* Main */}
      <main>
        <Dashboard onCoinSelect={setSelectedSymbol} />
      </main>

      {/* Modal */}
      <DetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
    </div>
  );
}
