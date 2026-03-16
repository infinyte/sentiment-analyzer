/**
 * Sentiment Analyzer - React Frontend
 * Interactive dashboard for cryptocurrency sentiment analysis
 *
 * This file contains the main App component with route structure,
 * reusable React hooks, and core UI components.
 */

import React, { useEffect, useState, useCallback } from 'react';
import './App.css';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CoinSnapshot {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  volatility_7d: number;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  sentiment_summary: string;
  trending_score: number;
  headline_sample: string[];
  timestamp: Date;
  source: 'coingecko';
  market_rank: number;
}

interface SentimentAnalysis {
  symbol: string;
  analysis_date: string;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  key_catalysts: string[];
  risk_factors: string[];
  sources_analyzed: number;
  data_range: { start: Date; end: Date };
  short_term_outlook: string;
  volatility_warning: boolean;
  generated_at: Date;
  model: string;
  tokens_used: number;
}

interface DetailReport {
  coin: CoinSnapshot;
  sentiment_today: SentimentAnalysis;
  price_history: Array<{
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  sentiment_history: Array<{
    date: string;
    score: 'BULL' | 'NEUTRAL' | 'BEAR';
    confidence: number;
  }>;
  recent_articles: Array<{
    title: string;
    url: string;
    source: string;
    published_at: Date;
    sentiment: 'positive' | 'neutral' | 'negative';
  }>;
  volatility_trend: number[];
  volume_trend: number[];
  recommendations: {
    short_term: string;
    risk_level: string;
    volatility_warning: boolean;
  };
}

// ============================================================================
// CUSTOM REACT HOOKS
// ============================================================================

/**
 * useCoins - Fetch and manage coin list with filtering/sorting
 */
const useCoins = (limit: number = 50, sortBy: string = 'market_cap') => {
  const [coins, setCoins] = useState<CoinSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCoins = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/coins?limit=${limit}&sort_by=${sortBy}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setCoins(data.data);
      setLastUpdated(new Date(data.last_updated));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [limit, sortBy]);

  // Fetch on mount and set up polling
  useEffect(() => {
    fetchCoins();
    const interval = setInterval(fetchCoins, 10 * 60 * 1000); // Refresh every 10 min
    return () => clearInterval(interval);
  }, [fetchCoins]);

  return { coins, loading, error, lastUpdated, refetch: fetchCoins };
};

/**
 * useCoinDetail - Fetch detailed report for a single coin
 */
const useCoinDetail = (symbol: string, enabled: boolean = true) => {
  const [detail, setDetail] = useState<DetailReport | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !symbol) return;

    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/coins/${symbol}?days=7`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setDetail(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [symbol, enabled]);

  return { detail, loading, error };
};

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

/**
 * SentimentBadge - Color-coded sentiment indicator
 */
interface SentimentBadgeProps {
  score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
}

const SentimentBadge: React.FC<SentimentBadgeProps> = ({
  score,
  confidence,
}) => {
  const sentimentConfig = {
    BULL: {
      color: '#10b981',
      emoji: '📈',
      label: 'Bullish',
    },
    NEUTRAL: {
      color: '#f59e0b',
      emoji: '➡️',
      label: 'Neutral',
    },
    BEAR: {
      color: '#ef4444',
      emoji: '📉',
      label: 'Bearish',
    },
  };

  const config = sentimentConfig[score];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        backgroundColor: `${config.color}15`,
        border: `2px solid ${config.color}`,
        borderRadius: '0.375rem',
        width: 'fit-content',
      }}
    >
      <span style={{ fontSize: '1.2rem' }}>{config.emoji}</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: config.color }}>
          {config.label}
        </span>
        <span style={{ fontSize: '0.625rem', color: '#6b7280' }}>
          {(confidence * 100).toFixed(0)}% confidence
        </span>
      </div>
    </div>
  );
};

/**
 * Sparkline - Mini 7-day price trend chart
 */
interface SparklineProps {
  values: number[];
  color?: string;
}

const Sparkline: React.FC<SparklineProps> = ({ values, color = '#3b82f6' }) => {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Normalize values to 0-100
  const normalized = values.map(v => ((v - min) / range) * 100);

  return (
    <svg
      width="100%"
      height="40"
      style={{
        display: 'block',
        cursor: 'pointer',
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polyline
        points={normalized.map((y, i) => `${(i / (normalized.length - 1)) * 100},${100 - y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={normalized.map((y, i) => `${(i / (normalized.length - 1)) * 100},${100 - y}`).join(' ') + ` 100,100 0,100`}
        fill={`${color}20`}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

/**
 * PercentageChange - Colored percentage badge
 */
interface PercentageChangeProps {
  value: number;
  label?: string;
}

const PercentageChange: React.FC<PercentageChangeProps> = ({
  value,
  label,
}) => {
  const isPositive = value >= 0;
  const color = isPositive ? '#10b981' : '#ef4444';
  const symbol = isPositive ? '▲' : '▼';

  return (
    <span style={{ color, fontWeight: '600', fontSize: '0.875rem' }}>
      {symbol} {Math.abs(value).toFixed(2)}%
      {label && <span style={{ fontSize: '0.75rem', marginLeft: '0.25rem' }}>({label})</span>}
    </span>
  );
};

// ============================================================================
// MAIN COMPONENTS
// ============================================================================

/**
 * CoinCard - Individual coin snapshot card
 */
interface CoinCardProps {
  coin: CoinSnapshot;
  onSelect: (symbol: string) => void;
}

const CoinCard: React.FC<CoinCardProps> = ({ coin, onSelect }) => {
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
        hover: {
          boxShadow: '0 10px 15px rgba(0,0,0,0.1)',
          transform: 'translateY(-2px)',
        },
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 10px 15px rgba(0,0,0,0.1)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'start',
        marginBottom: '0.75rem',
      }}>
        <div>
          <h3 style={{
            margin: '0 0 0.25rem 0',
            fontSize: '1.125rem',
            fontWeight: '700',
          }}>
            {coin.name}
          </h3>
          <span style={{
            fontSize: '0.875rem',
            color: '#6b7280',
            fontWeight: '600',
          }}>
            {coin.symbol}
          </span>
        </div>
        <span style={{
          fontSize: '0.75rem',
          backgroundColor: '#f3f4f6',
          padding: '0.25rem 0.5rem',
          borderRadius: '0.25rem',
          color: '#6b7280',
        }}>
          #{coin.market_rank}
        </span>
      </div>

      {/* Price and Change */}
      <div style={{
        marginBottom: '0.75rem',
      }}>
        <div style={{
          fontSize: '1.5rem',
          fontWeight: '700',
          marginBottom: '0.25rem',
        }}>
          ${coin.price_usd.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
        <div style={{
          display: 'flex',
          gap: '1rem',
          fontSize: '0.875rem',
        }}>
          <PercentageChange value={coin.price_change_24h_percent} label="24h" />
          <PercentageChange value={coin.price_change_7d_percent} label="7d" />
        </div>
      </div>

      {/* Sparkline Chart */}
      <div style={{
        marginBottom: '0.75rem',
        height: '40px',
      }}>
        <Sparkline
          values={[
            coin.price_usd * (1 - coin.price_change_7d_percent / 100),
            coin.price_usd * (1 - coin.price_change_7d_percent / 100 * 0.7),
            coin.price_usd * (1 - coin.price_change_7d_percent / 100 * 0.5),
            coin.price_usd * (1 - coin.price_change_7d_percent / 100 * 0.3),
            coin.price_usd * (1 - coin.price_change_7d_percent / 100 * 0.1),
            coin.price_usd,
            coin.price_usd * (1 + coin.price_change_24h_percent / 100),
          ]}
          color={coin.sentiment_score === 'BULL' ? '#10b981' : '#ef4444'}
        />
      </div>

      {/* Sentiment Badge */}
      <div style={{ marginBottom: '0.75rem' }}>
        <SentimentBadge
          score={coin.sentiment_score}
          confidence={coin.sentiment_confidence}
        />
      </div>

      {/* Metrics Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.5rem',
        marginBottom: '0.75rem',
        fontSize: '0.75rem',
        color: '#6b7280',
      }}>
        <div>
          <span style={{ fontWeight: '600' }}>Vol 24h:</span>
          <div>${(coin.volume_24h_usd / 1e9).toFixed(2)}B</div>
        </div>
        <div>
          <span style={{ fontWeight: '600' }}>Volatility:</span>
          <div>{coin.volatility_24h.toFixed(2)}%</div>
        </div>
      </div>

      {/* Trending Score */}
      <div style={{
        fontSize: '0.875rem',
        color: '#6b7280',
        marginBottom: '0.75rem',
      }}>
        <span style={{ fontWeight: '600' }}>{coin.trending_score}</span> headlines (24h)
      </div>

      {/* Summary Text */}
      <p style={{
        margin: '0',
        fontSize: '0.875rem',
        lineHeight: '1.4',
        color: '#1f2937',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {coin.sentiment_summary || 'Sentiment analysis pending...'}
      </p>
    </div>
  );
};

/**
 * Dashboard - Main grid view of all coins
 */
interface DashboardProps {
  onCoinSelect: (symbol: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onCoinSelect }) => {
  const [sortBy, setSortBy] = useState('market_cap');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const { coins, loading, error, lastUpdated } = useCoins(50, sortBy);

  const filteredCoins =
    sentimentFilter === 'all'
      ? coins
      : coins.filter(c => c.sentiment_score === sentimentFilter);

  if (error) {
    return (
      <div style={{
        padding: '2rem',
        backgroundColor: '#fee2e2',
        color: '#991b1b',
        borderRadius: '0.5rem',
        marginBottom: '1rem',
      }}>
        Error loading coins: {error}
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div style={{
        marginBottom: '1.5rem',
      }}>
        <h1 style={{
          margin: '0 0 0.5rem 0',
          fontSize: '2rem',
          fontWeight: '700',
        }}>
          Sentiment Analyzer
        </h1>
        <p style={{
          margin: '0',
          color: '#6b7280',
        }}>
          Real-time cryptocurrency sentiment analysis powered by AI
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
      }}>
        {/* Sort Dropdown */}
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
          <option value="market_cap">Market Cap (High to Low)</option>
          <option value="volatility">Volatility (High to Low)</option>
          <option value="sentiment">Sentiment (Bull to Bear)</option>
          <option value="price_change">Price Change (High to Low)</option>
        </select>

        {/* Sentiment Filter */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {['all', 'BULL', 'NEUTRAL', 'BEAR'].map(filter => (
            <button
              key={filter}
              onClick={() => setSentimentFilter(filter)}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '0.375rem',
                border: sentimentFilter === filter ? 'none' : '1px solid #d1d5db',
                backgroundColor:
                  sentimentFilter === filter
                    ? filter === 'all'
                      ? '#3b82f6'
                      : filter === 'BULL'
                        ? '#10b981'
                        : filter === 'BEAR'
                          ? '#ef4444'
                          : '#f59e0b'
                    : '#ffffff',
                color:
                  sentimentFilter === filter ? '#ffffff' : '#1f2937',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600',
              }}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Last Updated */}
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          color: '#6b7280',
        }}>
          {loading ? (
            <>
              <span style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '50%',
                backgroundColor: '#ef4444',
                animation: 'pulse 2s infinite',
              }} />
              Updating...
            </>
          ) : (
            <>
              <span style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '50%',
                backgroundColor: '#10b981',
              }} />
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Ready'}
            </>
          )}
        </div>
      </div>

      {/* Coin Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '1rem',
      }}>
        {filteredCoins.map(coin => (
          <CoinCard
            key={coin.id}
            coin={coin}
            onSelect={onCoinSelect}
          />
        ))}
      </div>

      {filteredCoins.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          color: '#6b7280',
        }}>
          No coins found with selected filters.
        </div>
      )}
    </div>
  );
};

/**
 * DetailModal - Full coin report with chart and analysis
 */
interface DetailModalProps {
  symbol: string | null;
  onClose: () => void;
}

const DetailModal: React.FC<DetailModalProps> = ({ symbol, onClose }) => {
  const { detail, loading } = useCoinDetail(symbol || '', !!symbol);

  if (!symbol) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1rem',
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '0.5rem',
        maxWidth: '900px',
        maxHeight: '90vh',
        overflow: 'auto',
        width: '100%',
        position: 'relative',
      }}>
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
              Loading detailed report for {symbol}...
            </div>
          ) : detail ? (
            <>
              {/* Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                marginBottom: '1.5rem',
              }}>
                <div>
                  <h2 style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '1.875rem',
                    fontWeight: '700',
                  }}>
                    {detail.coin.name}
                  </h2>
                  <div style={{
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: '#3b82f6',
                  }}>
                    ${detail.coin.price_usd.toLocaleString()}
                  </div>
                </div>
                <SentimentBadge
                  score={detail.sentiment_today.sentiment_score}
                  confidence={detail.sentiment_today.confidence}
                />
              </div>

              {/* Sentiment Summary */}
              <div style={{
                backgroundColor: '#f3f4f6',
                padding: '1rem',
                borderRadius: '0.375rem',
                marginBottom: '1.5rem',
              }}>
                <h3 style={{
                  margin: '0 0 0.5rem 0',
                  fontSize: '1rem',
                  fontWeight: '600',
                }}>
                  Sentiment Analysis
                </h3>
                <p style={{
                  margin: '0 0 0.75rem 0',
                  color: '#1f2937',
                }}>
                  {detail.sentiment_today.summary}
                </p>

                {/* Catalysts & Risks */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1rem',
                }}>
                  <div>
                    <h4 style={{
                      margin: '0 0 0.5rem 0',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: '#10b981',
                    }}>
                      Key Catalysts
                    </h4>
                    <ul style={{
                      margin: '0',
                      paddingLeft: '1.5rem',
                      fontSize: '0.875rem',
                    }}>
                      {detail.sentiment_today.key_catalysts.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 style={{
                      margin: '0 0 0.5rem 0',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: '#ef4444',
                    }}>
                      Risk Factors
                    </h4>
                    <ul style={{
                      margin: '0',
                      paddingLeft: '1.5rem',
                      fontSize: '0.875rem',
                    }}>
                      {detail.sentiment_today.risk_factors.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {detail.sentiment_today.volatility_warning && (
                  <div style={{
                    marginTop: '1rem',
                    padding: '0.75rem',
                    backgroundColor: '#fef3c7',
                    borderLeft: '4px solid #f59e0b',
                    borderRadius: '0.25rem',
                    fontSize: '0.875rem',
                    color: '#92400e',
                  }}>
                    ⚠️ High volatility detected. Be cautious with large positions.
                  </div>
                )}
              </div>

              {/* Price Chart Placeholder */}
              <div style={{
                backgroundColor: '#f9fafb',
                padding: '1rem',
                borderRadius: '0.375rem',
                marginBottom: '1.5rem',
                height: '300px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: '0', fontWeight: '600' }}>
                    Interactive Chart
                  </p>
                  <p style={{
                    margin: '0.5rem 0 0 0',
                    fontSize: '0.875rem',
                  }}>
                    Integration with TradingView Lightweight Charts or Chart.js
                  </p>
                </div>
              </div>

              {/* Recent Articles */}
              <div>
                <h3 style={{
                  margin: '0 0 1rem 0',
                  fontSize: '1rem',
                  fontWeight: '600',
                }}>
                  Recent Articles
                </h3>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}>
                  {detail.recent_articles.slice(0, 5).map((article, i) => (
                    <a
                      key={i}
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '0.75rem',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.375rem',
                        textDecoration: 'none',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          '#f3f4f6';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          'transparent';
                      }}
                    >
                      <div style={{
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        color: '#1f2937',
                        marginBottom: '0.25rem',
                      }}>
                        {article.title}
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: '#6b7280',
                      }}>
                        {article.source} •{' '}
                        {new Date(article.published_at).toLocaleDateString()}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              Failed to load detailed report
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Global Styles */}
      <style>{`
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Navigation */}
      <nav style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #e5e7eb',
        padding: '1rem 1.5rem',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h1 style={{
            margin: '0',
            fontSize: '1.25rem',
            fontWeight: '700',
          }}>
            Sentiment Analyzer
          </h1>
          <div style={{
            display: 'flex',
            gap: '1rem',
            fontSize: '0.875rem',
            color: '#6b7280',
          }}>
            <button style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: '#1f2937',
            }}>
              Dashboard
            </button>
            <button style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: '#1f2937',
            }}>
              Settings
            </button>
            <button style={{
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: '#1f2937',
            }}>
              Help
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>
        <Dashboard onCoinSelect={setSelectedSymbol} />
      </main>

      {/* Detail Modal */}
      <DetailModal
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />
    </div>
  );
};

export default App;
