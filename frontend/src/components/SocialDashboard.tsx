import { useState, useEffect, useCallback } from 'react';
import {
  useTrendingTopics,
  useSocialItems,
  useSocialStats,
  useTrendScore,
  useSymbolScrape,
  useBatchScrape,
  useTrendingRecompute,
  useTrendingIngest,
} from '../hooks/useSocialMedia';
import type { IngestPost } from '../types/social-media';
import type { ClusteredTrendingTopic, ScoredSocialItem, SocialSource, SourceStat } from '../types/social-media';

interface SocialItemDetail extends ScoredSocialItem {
  scoring_breakdown: {
    score_sentiment: number;
    score_engagement: number;
    score_authority: number;
    score_recency: number;
    score_composite: number;
    context_window_used: boolean;
    weights: Record<string, string>;
    feature_attribution: Record<string, number>;
  };
}

// ── Palette ────────────────────────────────────────────────────────────────────

const C = {
  bull:    '#10b981',
  neutral: '#f59e0b',
  bear:    '#ef4444',
  blue:    '#3b82f6',
  gray:    'var(--text-muted)',
  bg:      'var(--bg)',
  card:    'var(--surface)',
  border:  'var(--border)',
  text:    'var(--text)',
  muted:   'var(--text-subtle)',
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

function SocialItemCard({
  item,
  onOpenDetail,
  isSelected,
}: {
  item: ScoredSocialItem;
  onOpenDetail: (id: string) => void;
  isSelected: boolean;
}) {
  const sentColor = item.score_sentiment > 65 ? C.bull : item.score_sentiment < 40 ? C.bear : C.neutral;
  const displayText = item.title || item.content;
  return (
    <div style={{ padding: '0.875rem 1rem', border: `1px solid ${isSelected ? C.blue : C.border}`, borderRadius: '0.5rem', backgroundColor: C.card, marginBottom: '0.5rem', boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.12)' : undefined }}>
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
          <button
            type="button"
            onClick={() => onOpenDetail(item.id)}
            style={{ marginTop: '0.35rem', fontSize: '0.7rem', padding: '0.2rem 0.45rem', borderRadius: '0.25rem', border: `1px solid ${C.border}`, backgroundColor: C.card, cursor: 'pointer', color: C.blue, fontWeight: 600 }}
          >
            Details
          </button>
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

function SocialItemDetailPanel({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: SocialItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.5rem', backgroundColor: C.card, padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700' }}>Item Detail</h3>
          <div style={{ fontSize: '0.75rem', color: C.gray }}>Score breakdown and source metadata</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.gray, fontSize: '1.25rem' }}>✕</button>
      </div>

      {loading && <div style={{ color: C.gray, fontSize: '0.875rem' }}>Loading item detail...</div>}
      {error && <div style={{ color: C.bear, fontSize: '0.875rem' }}>{error}</div>}

      {detail && (
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: '700', color: C.blue, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {sourceLabel(detail.source)}
              </span>
              {detail.author && <span style={{ fontSize: '0.75rem', color: C.gray }}>by {detail.author}</span>}
              <span style={{ fontSize: '0.75rem', color: C.gray }}>{relTime(detail.fetched_at)}</span>
            </div>
            <div style={{ fontSize: '0.95rem', color: C.text, lineHeight: 1.5 }}>{detail.title || detail.content}</div>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.8rem', color: C.blue }}>
                Open source
              </a>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
            {([
              ['Sentiment', detail.scoring_breakdown.score_sentiment, detail.score_sentiment > 65 ? C.bull : detail.score_sentiment < 40 ? C.bear : C.neutral],
              ['Engagement', detail.scoring_breakdown.score_engagement, C.blue],
              ['Authority', detail.scoring_breakdown.score_authority, C.blue],
              ['Recency', detail.scoring_breakdown.score_recency, C.blue],
              ['Composite', detail.scoring_breakdown.score_composite, C.blue],
            ] as Array<[string, number, string]>).map(([label, value, color]) => (
              <div key={label}>
                <div style={{ fontSize: '0.75rem', color: C.gray, marginBottom: '0.25rem' }}>{label}</div>
                {scoreBar(value, color)}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>Feature Attribution</div>
              <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.78rem', color: C.gray }}>
                {Object.entries(detail.scoring_breakdown.feature_attribution).map(([key, value]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span>{key}</span>
                    <strong style={{ color: C.text }}>{value.toFixed(2)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.5rem', padding: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>Source Metadata</div>
              <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.78rem', color: C.gray }}>
                <div><strong style={{ color: C.text }}>Source ID:</strong> {detail.source_id}</div>
                {detail.author && <div><strong style={{ color: C.text }}>Author:</strong> {detail.author}</div>}
                <div><strong style={{ color: C.text }}>Created:</strong> {new Date(detail.content_created_at).toLocaleString()}</div>
                <div><strong style={{ color: C.text }}>Fetched:</strong> {new Date(detail.fetched_at).toLocaleString()}</div>
                <div><strong style={{ color: C.text }}>Coins:</strong> {detail.coins_mentioned.length ? detail.coins_mentioned.join(', ') : 'None tagged'}</div>
                <div><strong style={{ color: C.text }}>Context window:</strong> {detail.scoring_breakdown.context_window_used ? 'Used' : 'Not used'}</div>
              </div>
            </div>
          </div>
        </div>
      )}
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

// ── Scraper Status Panel ──────────────────────────────────────────────────────

type ScraperStatus = 'LIVE' | 'DEGRADED' | 'STALE' | 'ERROR' | 'OFFLINE';

function getScraperStatus(s: SourceStat): ScraperStatus {
  if (s.total_items === 0) return 'OFFLINE';
  if (s.items_24h === 0 && s.error_count_today > 0) return 'ERROR';
  if (s.items_24h === 0) return 'STALE';
  if (s.error_count_today > 0) return 'DEGRADED';
  return 'LIVE';
}

const STATUS_CFG: Record<ScraperStatus, { color: string; bg: string; label: string; description: string }> = {
  LIVE:     { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  label: 'LIVE',     description: 'Receiving data, no errors' },
  DEGRADED: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'DEGRADED', description: 'Active but errors detected' },
  STALE:    { color: '#f97316', bg: 'rgba(249,115,22,0.12)', label: 'STALE',    description: 'No new data today' },
  ERROR:    { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  label: 'ERROR',    description: 'Errors, no data today' },
  OFFLINE:  { color: '#6b7280', bg: 'rgba(107,114,128,0.12)',label: 'OFFLINE',  description: 'No data received' },
};

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function ScraperCard({ stat }: { stat: SourceStat }) {
  const status = getScraperStatus(stat);
  const cfg    = STATUS_CFG[status];
  const isLive = status === 'LIVE';

  return (
    <div
      title={cfg.description}
      style={{
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${cfg.color}`,
        borderRadius: '0.5rem',
        backgroundColor: C.card,
        padding: '0.75rem 0.875rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
      }}
    >
      {/* Name + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{ fontWeight: '700', fontSize: '0.8125rem', color: C.text }}>
          {sourceLabel(stat.source as SocialSource)}
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem',
          fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.05em',
          padding: '0.15rem 0.45rem', borderRadius: '1rem',
          backgroundColor: cfg.bg, color: cfg.color, flexShrink: 0,
        }}>
          <span
            className={isLive ? 'scraper-live-dot' : undefined}
            style={{
              width: '5px', height: '5px', borderRadius: '50%',
              backgroundColor: cfg.color, display: 'inline-block', flexShrink: 0,
            }}
          />
          {cfg.label}
        </span>
      </div>

      {/* Counters */}
      <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: '700', color: isLive ? cfg.color : C.text, lineHeight: 1 }}>
            {fmtCount(stat.items_24h)}
          </div>
          <div style={{ fontSize: '0.6rem', color: C.muted, marginTop: '0.1rem' }}>today</div>
        </div>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: '700', color: C.text, lineHeight: 1 }}>
            {fmtCount(stat.total_items)}
          </div>
          <div style={{ fontSize: '0.6rem', color: C.muted, marginTop: '0.1rem' }}>total</div>
        </div>
        {stat.error_count_today > 0 && (
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#ef4444', lineHeight: 1 }}>
              {stat.error_count_today}
            </div>
            <div style={{ fontSize: '0.6rem', color: C.muted, marginTop: '0.1rem' }}>errors</div>
          </div>
        )}
      </div>

      {/* Last fetch + fetch count */}
      <div style={{ fontSize: '0.68rem', color: C.muted }}>
        {stat.last_fetched_at
          ? `${relTime(stat.last_fetched_at)} · ${stat.fetch_count_today} fetches`
          : status === 'OFFLINE'
            ? 'Never fetched'
            : `${stat.fetch_count_today} fetches today`}
      </div>
    </div>
  );
}

function ScraperStatusPanel({
  sources,
  lastRefreshed,
  onRefresh,
}: {
  sources: SourceStat[];
  lastRefreshed: Date | null;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const updatedAgo = lastRefreshed
    ? (() => {
        const s = Math.floor((now - lastRefreshed.getTime()) / 1000);
        if (s < 60) return `${s}s ago`;
        return `${Math.floor(s / 60)}m ago`;
      })()
    : null;

  const liveCnt     = sources.filter(s => getScraperStatus(s) === 'LIVE').length;
  const degradedCnt = sources.filter(s => ['DEGRADED', 'STALE', 'ERROR'].includes(getScraperStatus(s))).length;

  const summaryColor = degradedCnt > 0
    ? (sources.some(s => getScraperStatus(s) === 'ERROR') ? '#ef4444' : '#f59e0b')
    : liveCnt > 0 ? '#10b981' : '#6b7280';

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <style>{`
        @keyframes scraper-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
          60%       { box-shadow: 0 0 0 5px rgba(16,185,129,0); }
        }
        .scraper-live-dot { animation: scraper-pulse 2s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '700' }}>Scraper Status</h3>
          <span style={{
            fontSize: '0.7rem', fontWeight: '700', padding: '0.1rem 0.45rem',
            borderRadius: '1rem', backgroundColor: `${summaryColor}18`, color: summaryColor,
          }}>
            {liveCnt}/{sources.length} live
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          {updatedAgo && (
            <span style={{ fontSize: '0.7rem', color: C.muted }}>Updated {updatedAgo}</span>
          )}
          <button
            onClick={onRefresh}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: `1px solid ${C.border}`, background: C.card, cursor: 'pointer', color: C.gray }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.625rem', flexWrap: 'wrap' }}>
        {(Object.entries(STATUS_CFG) as [ScraperStatus, typeof STATUS_CFG[ScraperStatus]][]).map(([key, cfg]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.65rem', color: C.muted }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: cfg.color, display: 'inline-block' }} />
            {cfg.label} — {cfg.description}
          </span>
        ))}
      </div>

      {/* Cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
        {sources.map(s => <ScraperCard key={s.source} stat={s} />)}
      </div>
    </div>
  );
}

// ── Advanced Utilities Panel ───────────────────────────────────────────────────

function AdvancedUtilitiesPanel() {
  const [expanded, setExpanded] = useState(false);

  // Per-symbol scrape
  const { data: scrapeData, loading: scrapeLoading, error: scrapeError, scrape } = useSymbolScrape();
  const [scrapeSymbol, setScrapeSymbol] = useState('');
  const [scrapeQuery, setScrapeQuery] = useState('');
  const [scrapePlatforms, setScrapePlatforms] = useState('');

  // Batch scrape
  const { data: batchData, loading: batchLoading, error: batchError, scrape: scrapeBatch } = useBatchScrape();
  const [batchSymbols, setBatchSymbols] = useState('');
  const [batchQuery, setBatchQuery] = useState('');
  const [batchPlatforms, setBatchPlatforms] = useState('');

  // Trending recompute
  const { data: recomputeData, loading: recomputeLoading, error: recomputeError, recompute } = useTrendingRecompute();
  const [recomputeWindow, setRecomputeWindow] = useState('4');

  // Trending ingest
  const { data: ingestData, loading: ingestLoading, error: ingestError, ingest } = useTrendingIngest();
  const [ingestJson, setIngestJson] = useState('');
  const [ingestJsonError, setIngestJsonError] = useState<string | null>(null);

  const handleSymbolScrape = useCallback(() => {
    if (!scrapeSymbol.trim()) return;
    const platforms = scrapePlatforms.split(',').map(p => p.trim()).filter(Boolean);
    void scrape(scrapeSymbol.trim().toUpperCase(), scrapeQuery.trim() || undefined, platforms.length > 0 ? platforms : undefined);
  }, [scrape, scrapeSymbol, scrapeQuery, scrapePlatforms]);

  const handleBatchScrape = useCallback(() => {
    const symbols = batchSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (symbols.length === 0) return;
    const platforms = batchPlatforms.split(',').map(p => p.trim()).filter(Boolean);
    void scrapeBatch(symbols, batchQuery.trim() || undefined, platforms.length > 0 ? platforms : undefined);
  }, [scrapeBatch, batchSymbols, batchQuery, batchPlatforms]);

  const handleRecompute = useCallback(() => {
    void recompute(Number(recomputeWindow) || 4);
  }, [recompute, recomputeWindow]);

  const handleIngest = useCallback(() => {
    setIngestJsonError(null);
    let posts: IngestPost[];
    try {
      posts = JSON.parse(ingestJson) as IngestPost[];
      if (!Array.isArray(posts)) throw new Error('Must be a JSON array');
    } catch (e) {
      setIngestJsonError(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    void ingest(posts);
  }, [ingest, ingestJson]);

  const inputStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem', borderRadius: '0.25rem',
    border: `1px solid ${C.border}`, fontSize: '0.8125rem',
    backgroundColor: C.card, color: C.text, width: '100%',
  };
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.75rem', borderRadius: '0.25rem', border: 'none',
    background: disabled ? '#93c5fd' : C.blue, color: '#fff',
    fontWeight: 600, fontSize: '0.75rem', cursor: disabled ? 'wait' : 'pointer',
    whiteSpace: 'nowrap' as const,
  });
  const sectionStyle: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: '0.5rem',
    backgroundColor: C.card, padding: '1rem',
  };
  const labelStyle: React.CSSProperties = { fontSize: '0.75rem', color: C.gray, marginBottom: '0.25rem', display: 'block' };
  const resultStyle = (ok: boolean): React.CSSProperties => ({
    marginTop: '0.5rem', fontSize: '0.75rem', color: ok ? C.bull : C.bear,
  });

  return (
    <div style={{ marginTop: '1.5rem', border: `1px solid ${C.border}`, borderRadius: '0.5rem' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer',
          color: C.text, fontWeight: 600, fontSize: '0.875rem',
        }}
      >
        <span>Advanced Utilities</span>
        <span style={{ fontSize: '0.75rem', color: C.gray }}>{expanded ? '▲ Collapse' : '▼ Expand'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 1rem 1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

          {/* Per-symbol scrape */}
          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.75rem' }}>Per-Symbol Scrape</div>
            <label style={labelStyle}>Symbol *
              <input
                value={scrapeSymbol}
                onChange={e => setScrapeSymbol(e.target.value)}
                placeholder="BTC"
                aria-label="Scrape symbol"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>Query (optional)
              <input
                value={scrapeQuery}
                onChange={e => setScrapeQuery(e.target.value)}
                placeholder="defi"
                aria-label="Scrape query"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>Platforms (optional, comma-separated)
              <input
                value={scrapePlatforms}
                onChange={e => setScrapePlatforms(e.target.value)}
                placeholder="reddit,twitter"
                aria-label="Scrape platforms"
                style={inputStyle}
              />
            </label>
            <button
              onClick={handleSymbolScrape}
              disabled={scrapeLoading || !scrapeSymbol.trim()}
              aria-label="Run symbol scrape"
              style={{ ...btnStyle(scrapeLoading), marginTop: '0.5rem' }}
            >
              {scrapeLoading ? 'Scraping…' : 'Scrape'}
            </button>
            {scrapeError && <div style={resultStyle(false)}>{scrapeError}</div>}
            {scrapeData && (
              <div style={resultStyle(true)}>
                Scraped {scrapeData.total_posts} posts for {scrapeData.symbol} across {scrapeData.platforms.length} platform(s).
              </div>
            )}
          </div>

          {/* Batch scrape */}
          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.75rem' }}>Batch Scrape</div>
            <label style={labelStyle}>Symbols * (comma-separated, max 20)
              <input
                value={batchSymbols}
                onChange={e => setBatchSymbols(e.target.value)}
                placeholder="BTC,ETH,SOL"
                aria-label="Batch scrape symbols"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>Query (optional)
              <input
                value={batchQuery}
                onChange={e => setBatchQuery(e.target.value)}
                placeholder="defi"
                aria-label="Batch scrape query"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>Platforms (optional, comma-separated)
              <input
                value={batchPlatforms}
                onChange={e => setBatchPlatforms(e.target.value)}
                placeholder="reddit,twitter"
                aria-label="Batch scrape platforms"
                style={inputStyle}
              />
            </label>
            <button
              onClick={handleBatchScrape}
              disabled={batchLoading || !batchSymbols.trim()}
              aria-label="Run batch scrape"
              style={{ ...btnStyle(batchLoading), marginTop: '0.5rem' }}
            >
              {batchLoading ? 'Scraping…' : 'Batch Scrape'}
            </button>
            {batchError && <div style={resultStyle(false)}>{batchError}</div>}
            {batchData && (
              <div style={resultStyle(true)}>
                Scraped {batchData.total_posts} posts across {batchData.total_symbols} symbol(s).
              </div>
            )}
          </div>

          {/* Trending recompute */}
          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.75rem' }}>Recompute Trending</div>
            <label style={labelStyle}>Window (hours)
              <input
                type="number"
                min={1}
                max={48}
                value={recomputeWindow}
                onChange={e => setRecomputeWindow(e.target.value)}
                aria-label="Recompute window hours"
                style={inputStyle}
              />
            </label>
            <button
              onClick={handleRecompute}
              disabled={recomputeLoading}
              aria-label="Trigger trending recompute"
              style={{ ...btnStyle(recomputeLoading), marginTop: '0.5rem' }}
            >
              {recomputeLoading ? 'Computing…' : 'Recompute'}
            </button>
            {recomputeError && <div style={resultStyle(false)}>{recomputeError}</div>}
            {recomputeData && (
              <div style={resultStyle(true)}>
                Recomputed: {recomputeData.count} topics in {recomputeData.timeWindow} window.
              </div>
            )}
          </div>

          {/* Trending ingest */}
          <div style={sectionStyle}>
            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.75rem' }}>Manual Trending Ingest</div>
            <label style={labelStyle}>Posts JSON array *
              <textarea
                value={ingestJson}
                onChange={e => setIngestJson(e.target.value)}
                placeholder={'[{"platform":"reddit","text":"BTC is pumping!"}]'}
                aria-label="Ingest posts JSON"
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.75rem' }}
              />
            </label>
            <button
              onClick={handleIngest}
              disabled={ingestLoading || !ingestJson.trim()}
              aria-label="Submit trending ingest"
              style={{ ...btnStyle(ingestLoading), marginTop: '0.5rem' }}
            >
              {ingestLoading ? 'Ingesting…' : 'Ingest Posts'}
            </button>
            {(ingestJsonError || ingestError) && (
              <div style={resultStyle(false)}>{ingestJsonError ?? ingestError}</div>
            )}
            {ingestData && (
              <div style={resultStyle(true)}>
                Ingested {ingestData.ingested} posts. Store total: {ingestData.stored_total}.
              </div>
            )}
          </div>

        </div>
      )}
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemDetail, setSelectedItemDetail] = useState<SocialItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [refreshSymbolsInput, setRefreshSymbolsInput] = useState('');
  const [refreshRssOnly, setRefreshRssOnly] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const { data: topicsData, loading: topicsLoading, error: topicsError, refresh: refreshTopics } =
    useTrendingTopics(timeWindow, 20);

  const { data: itemsData, loading: itemsLoading, error: itemsError, refresh: refreshItems } = useSocialItems({
    coin: coinFilter || undefined,
    source: sourceFilter || undefined,
    sort: sortBy,
    sinceHours: timeWindow,
    limit: 20,
  });

  const { data: statsData, lastRefreshed: statsRefreshedAt, refresh: refreshStats } = useSocialStats(60_000);

  const handleTopicClick = (topic: ClusteredTrendingTopic) => {
    if (topic.coin_symbol) {
      setTrendSymbol(prev => prev === topic.coin_symbol ? null : topic.coin_symbol!);
    }
  };

  const openItemDetail = useCallback(async (itemId: string) => {
    setSelectedItemId(itemId);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const res = await fetch(`/api/social-media/item/${encodeURIComponent(itemId)}`);
      const payload = await res.json().catch(() => ({})) as SocialItemDetail & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Failed to fetch item detail (${res.status})`);
      }
      setSelectedItemDetail(payload);
    } catch (err) {
      setSelectedItemDetail(null);
      setDetailError(err instanceof Error ? err.message : 'Failed to fetch item detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const triggerRefresh = useCallback(async () => {
    setRefreshPending(true);
    setRefreshError(null);
    setRefreshMessage(null);

    try {
      const symbols = refreshSymbolsInput
        .split(',')
        .map(symbol => symbol.trim().toUpperCase())
        .filter(Boolean);

      const res = await fetch('/api/social-media/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: symbols.length > 0 ? symbols : undefined,
          rss_only: refreshRssOnly,
        }),
      });

      const payload = await res.json().catch(() => ({})) as {
        error?: string;
        status?: string;
        mode?: string;
        symbols?: string[] | string;
      };

      if (res.status !== 202) {
        throw new Error(payload.error ?? `Failed to trigger social refresh (${res.status})`);
      }

      const targetLabel = Array.isArray(payload.symbols)
        ? payload.symbols.join(', ')
        : payload.symbols ?? 'top-coins';
      setRefreshMessage(`Refresh queued for ${targetLabel} (${payload.mode ?? 'all_sources'}).`);

      void Promise.allSettled([refreshStats(), refreshTopics(), refreshItems()]);
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Failed to trigger social refresh');
    } finally {
      setRefreshPending(false);
    }
  }, [refreshItems, refreshRssOnly, refreshStats, refreshSymbolsInput, refreshTopics]);

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
          <input
            value={refreshSymbolsInput}
            onChange={e => setRefreshSymbolsInput(e.target.value.toUpperCase())}
            placeholder="Refresh symbols (BTC,ETH)"
            aria-label="Refresh symbols"
            style={{ padding: '0.4rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem', width: '190px', backgroundColor: C.card, color: C.text }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8125rem', color: C.gray }}>
            <input type="checkbox" checked={refreshRssOnly} onChange={e => setRefreshRssOnly(e.target.checked)} />
            RSS only
          </label>
          <button
            onClick={() => void triggerRefresh()}
            disabled={refreshPending}
            style={{ fontSize: '0.75rem', padding: '0.4rem 0.7rem', borderRadius: '0.25rem', border: 'none', background: refreshPending ? '#93c5fd' : C.blue, cursor: refreshPending ? 'wait' : 'pointer', color: '#fff', fontWeight: 600 }}
          >
            {refreshPending ? 'Queuing…' : 'Refresh Social'}
          </button>
        </div>
      </div>

      {(refreshMessage || refreshError) && (
        <div style={{ marginBottom: '1rem', fontSize: '0.82rem', color: refreshError ? C.bear : C.bull }} role="status">
          {refreshError ?? refreshMessage}
        </div>
      )}

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

          {/* Scraper Status */}
          {statsData && statsData.sources.length > 0 && (
            <ScraperStatusPanel
              sources={statsData.sources}
              lastRefreshed={statsRefreshedAt}
              onRefresh={refreshStats}
            />
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
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem', width: '130px', backgroundColor: C.card, color: C.text }}
            />
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as SocialSource | '')}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem', backgroundColor: C.card, color: C.text }}>
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
              style={{ padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: `1px solid ${C.border}`, fontSize: '0.8125rem', backgroundColor: C.card, color: C.text }}>
              <option value="score">Top Score</option>
              <option value="recency">Most Recent</option>
              <option value="engagement">Most Engaged</option>
            </select>
          </div>

          {(selectedItemId || detailLoading || detailError || selectedItemDetail) && (
            <SocialItemDetailPanel
              detail={selectedItemDetail}
              loading={detailLoading}
              error={detailError}
              onClose={() => {
                setSelectedItemId(null);
                setSelectedItemDetail(null);
                setDetailError(null);
              }}
            />
          )}

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
            <SocialItemCard key={item.id} item={item} onOpenDetail={openItemDetail} isSelected={selectedItemId === item.id} />
          ))}
          {itemsData && itemsData.total > itemsData.items.length && (
            <div style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.875rem', color: C.gray }}>
              Showing {itemsData.items.length} of {itemsData.total} items
            </div>
          )}
        </div>
      </div>

      <AdvancedUtilitiesPanel />
    </div>
  );
}
