import { useState } from 'react';
import {
  useTrendingTopics,
  useSocialItems,
  useSocialStats,
  useTrendScore,
} from '../hooks/useSocialMedia';
import type { ClusteredTrendingTopic, ScoredSocialItem, SocialSource } from '../types/social-media';

// ── Palette ────────────────────────────────────────────────────────────────────

const C = {
  bull:    '#10b981',
  neutral: '#f59e0b',
  bear:    '#ef4444',
  blue:    '#3b82f6',
  gray:    '#6b7280',
  bg:      '#f9fafb',
  card:    '#ffffff',
  border:  '#e5e7eb',
  text:    '#111827',
  muted:   '#4b5563',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function directionColor(dir: string) {
  if (dir === 'BULLISH') return C.bull;
  if (dir === 'BEARISH') return C.bear;
  return C.neutral;
}

function scoreBar(value: number, color = C.blue) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{ flex: 1, height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, backgroundColor: color, borderRadius: '3px' }} />
      </div>
      <span style={{ fontSize: '0.75rem', color: C.gray, minWidth: '2rem', textAlign: 'right' }}>{value.toFixed(0)}</span>
    </div>
  );
}

function sourceLabel(source: SocialSource) {
  const map: Record<SocialSource, string> = {
    twitter: 'X/Twitter', reddit: 'Reddit', rss: 'RSS', tiktok: 'TikTok',
    discord: 'Discord', telegram: 'Telegram', youtube: 'YouTube',
  };
  return map[source] ?? source;
}

function relTime(iso: string) {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: '1rem', border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card }}>
      <div style={{ fontSize: '0.75rem', color: C.gray, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: '700', color: C.text }}>{value}</div>
    </div>
  );
}

function TrendingTopicRow({ topic }: { topic: ClusteredTrendingTopic }) {
  const dirColor = directionColor(topic.trend_direction);
  return (
    <div style={{ padding: '0.875rem 1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <span style={{ width: '1.5rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '700', color: C.gray }}>
        {topic.rank}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ fontWeight: '700', fontSize: '0.95rem', color: C.text }}>{topic.topic}</span>
          <span style={{
            fontSize: '0.65rem', fontWeight: '600', padding: '0.1rem 0.35rem',
            borderRadius: '0.25rem', backgroundColor: `${dirColor}18`, color: dirColor,
          }}>
            {topic.trend_direction}
          </span>
          {topic.cluster_size > 1 && (
            <span style={{ fontSize: '0.65rem', color: C.gray }}>
              +{topic.cluster_size - 1} related
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: C.gray }}>
          {topic.mention_count} mentions · {topic.unique_sources} sources · {topic.velocity.toFixed(1)}/hr velocity
        </div>
      </div>
      <div style={{ width: '100px' }}>
        {scoreBar(topic.signal_composite, dirColor)}
      </div>
      <div style={{ fontSize: '0.75rem', color: C.gray, minWidth: '4rem', textAlign: 'right' }}>
        {relTime(topic.last_updated)}
      </div>
    </div>
  );
}

function SocialItemCard({ item }: { item: ScoredSocialItem }) {
  const sentColor = item.score_sentiment > 65 ? C.bull : item.score_sentiment < 40 ? C.bear : C.neutral;
  const displayText = item.title || item.content;
  return (
    <div style={{ padding: '0.875rem 1rem', border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card, marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem', marginBottom: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: '700', color: C.blue, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {sourceLabel(item.source)}
            </span>
            {item.coins_mentioned.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: C.gray }}>
                {item.coins_mentioned.join(' · ')}
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: C.gray }}>{relTime(item.fetched_at)}</span>
          </div>
          <div style={{ fontSize: '0.875rem', color: C.text, lineHeight: 1.5,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'] }}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.text, textDecoration: 'none' }}>
                {displayText}
              </a>
            ) : displayText}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: '80px' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: '700', color: sentColor }}>{item.score_composite.toFixed(0)}</div>
          <div style={{ fontSize: '0.65rem', color: C.gray }}>composite</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', fontSize: '0.7rem', color: C.gray }}>
        <span>Sentiment <strong style={{ color: sentColor }}>{item.score_sentiment.toFixed(0)}</strong></span>
        <span>Engagement <strong>{item.score_engagement.toFixed(0)}</strong></span>
        <span>Authority <strong>{item.score_authority.toFixed(0)}</strong></span>
        <span>Recency <strong>{item.score_recency.toFixed(0)}</strong></span>
      </div>
    </div>
  );
}

// ── Trend Score Panel ─────────────────────────────────────────────────────────

function TrendScorePanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { data, loading, error } = useTrendScore(symbol);

  return (
    <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '0.5rem', padding: '1.25rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700' }}>Trend Score: {symbol}</h3>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.gray, fontSize: '1.25rem' }}>✕</button>
      </div>
      {loading && <div style={{ color: C.gray }}>Loading...</div>}
      {error && <div style={{ color: C.bear }}>Error: {error}</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{
              padding: '0.25rem 0.75rem', borderRadius: '1rem', fontWeight: '700', fontSize: '0.875rem',
              backgroundColor: `${directionColor(data.trend_direction)}18`, color: directionColor(data.trend_direction),
            }}>
              {data.trend_direction}
            </span>
            <span style={{ fontSize: '0.875rem', color: C.gray }}>{data.trend_strength}</span>
            <span style={{ fontSize: '0.875rem', color: C.gray }}>· {data.mention_count_24h} mentions · {data.velocity.toFixed(1)}/hr</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
            {[
              { label: 'Composite', val: data.signal_composite, color: directionColor(data.trend_direction) },
              { label: 'Sentiment', val: data.signal_sentiment, color: data.signal_sentiment > 65 ? C.bull : data.signal_sentiment < 40 ? C.bear : C.neutral },
              { label: 'Engagement', val: data.signal_engagement, color: C.blue },
              { label: 'Authority', val: data.signal_authority, color: C.blue },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <div style={{ fontSize: '0.75rem', color: C.gray, marginBottom: '0.25rem' }}>{label}</div>
                {scoreBar(val, color)}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.75rem', marginBottom: '1rem' }}>
            {(['BULL', 'NEUTRAL', 'BEAR'] as const).map(k => (
              <div key={k} style={{ textAlign: 'center', padding: '0.5rem', backgroundColor: C.bg, borderRadius: '0.375rem' }}>
                <div style={{ fontWeight: '700', color: k === 'BULL' ? C.bull : k === 'BEAR' ? C.bear : C.neutral }}>{data.sentiment_distribution[k]}%</div>
                <div style={{ color: C.gray }}>{k}</div>
              </div>
            ))}
          </div>

          {data.comparison.trend_acceleration !== 'stable' && (
            <div style={{ fontSize: '0.75rem', color: data.comparison.trend_acceleration === 'accelerating' ? C.bull : C.bear }}>
              {data.comparison.trend_acceleration === 'accelerating' ? '▲ Accelerating' : '▼ Decelerating'}
              {data.comparison.score_24h_ago !== null && ` (was ${data.comparison.score_24h_ago.toFixed(0)} 24h ago)`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Source Health ─────────────────────────────────────────────────────────────

function SourceHealthRow({ source, total, h24, fetches, errors }: {
  source: string; total: number; h24: number; fetches: number; errors: number;
}) {
  const healthy = errors === 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0', borderBottom: `1px solid ${C.border}`, fontSize: '0.8125rem' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: healthy ? C.bull : C.bear, flexShrink: 0 }} />
      <span style={{ flex: 1, fontWeight: '600', color: C.text }}>{sourceLabel(source as SocialSource)}</span>
      <span style={{ color: C.gray }}>{total.toLocaleString()} total</span>
      <span style={{ color: C.gray }}>{h24} today</span>
      <span style={{ color: errors > 0 ? C.bear : C.gray }}>{errors > 0 ? `${errors} err` : `${fetches} fetches`}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SocialDashboard() {
  const [timeWindow, setTimeWindow] = useState(24);
  const [coinFilter, setCoinFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SocialSource | ''>('');
  const [sortBy, setSortBy] = useState<'score' | 'recency' | 'engagement'>('score');
  const [trendSymbol, setTrendSymbol] = useState<string | null>(null);

  const { data: topicsData, loading: topicsLoading, error: topicsError, refresh: refreshTopics } =
    useTrendingTopics(timeWindow, 20);

  const { data: itemsData, loading: itemsLoading, error: itemsError } = useSocialItems({
    coin: coinFilter || undefined,
    source: sourceFilter || undefined,
    sort: sortBy,
    sinceHours: timeWindow,
    limit: 20,
  });

  const { data: statsData } = useSocialStats();

  const handleTopicClick = (topic: ClusteredTrendingTopic) => {
    if (topic.coin_symbol) {
      setTrendSymbol(prev => prev === topic.coin_symbol ? null : topic.coin_symbol!);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.5rem', fontWeight: '700' }}>Social Media Intelligence</h2>
          <p style={{ margin: 0, color: C.gray, fontSize: '0.875rem' }}>Cross-source crypto sentiment from 7 social platforms</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.875rem', color: C.gray }}>Window:</label>
          <select value={timeWindow} onChange={e => setTimeWindow(Number(e.target.value))}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.875rem' }}>
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
          </select>
        </div>
      </div>

      {/* Stats row */}
      {statsData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <StatCard label="Total Items" value={statsData.total_items.toLocaleString()} />
          <StatCard label="Items (24h)" value={statsData.items_24h.toLocaleString()} />
          <StatCard label="Trending Topics" value={statsData.trending_topics} />
          <StatCard label="Active Sources" value={statsData.sources.filter(s => s.total_items > 0).length} />
        </div>
      )}

      {/* Trend score panel (shown when topic clicked) */}
      {trendSymbol && (
        <TrendScorePanel symbol={trendSymbol} onClose={() => setTrendSymbol(null)} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }}>

        {/* Left: Trending topics */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700' }}>Trending Topics</h3>
            <button onClick={refreshTopics}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: `1px solid ${C.border}`, background: C.card, cursor: 'pointer', color: C.gray }}>
              Refresh
            </button>
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card, overflow: 'hidden' }}>
            {topicsLoading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.gray }}>Loading trends...</div>
            )}
            {topicsError && (
              <div style={{ padding: '1rem', color: C.bear }}>Error: {topicsError}</div>
            )}
            {!topicsLoading && topicsData?.topics.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.gray }}>
                No trending topics yet. Data populates on next scrape cycle.
              </div>
            )}
            {topicsData?.topics.map(topic => (
              <div key={`${topic.rank}-${topic.topic}`}
                onClick={() => handleTopicClick(topic)}
                style={{ cursor: topic.coin_symbol ? 'pointer' : 'default' }}
                title={topic.coin_symbol ? `Click to view ${topic.coin_symbol} trend score` : undefined}>
                <TrendingTopicRow topic={topic} />
              </div>
            ))}
          </div>

          {/* Source health */}
          {statsData && statsData.sources.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: '700' }}>Source Health</h3>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card, padding: '0.5rem 1rem' }}>
                {statsData.sources.map(s => (
                  <SourceHealthRow key={s.source}
                    source={s.source}
                    total={s.total_items}
                    h24={s.items_24h}
                    fetches={s.fetch_count_today}
                    errors={s.error_count_today}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Items feed */}
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700', flex: 1 }}>Social Items Feed</h3>
            <input
              value={coinFilter}
              onChange={e => setCoinFilter(e.target.value.toUpperCase())}
              placeholder="Filter coin (BTC…)"
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem', width: '130px' }}
            />
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as SocialSource | '')}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem' }}>
              <option value="">All sources</option>
              <option value="twitter">X/Twitter</option>
              <option value="reddit">Reddit</option>
              <option value="rss">RSS</option>
              <option value="discord">Discord</option>
              <option value="telegram">Telegram</option>
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem' }}>
              <option value="score">Top Score</option>
              <option value="recency">Most Recent</option>
              <option value="engagement">Most Engaged</option>
            </select>
          </div>

          {itemsLoading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.gray }}>Loading items...</div>
          )}
          {itemsError && (
            <div style={{ padding: '1rem', color: C.bear }}>Error: {itemsError}</div>
          )}
          {!itemsLoading && itemsData?.items.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.gray, border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card }}>
              No items found. Try adjusting filters or wait for next scrape cycle.
            </div>
          )}
          {itemsData?.items.map((item: ScoredSocialItem) => (
            <SocialItemCard key={item.id} item={item} />
          ))}
          {itemsData && itemsData.total > itemsData.items.length && (
            <div style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.875rem', color: C.gray }}>
              Showing {itemsData.items.length} of {itemsData.total} items
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
