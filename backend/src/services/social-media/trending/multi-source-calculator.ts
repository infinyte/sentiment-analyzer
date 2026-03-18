/**
 * MultiSourceTrendingScoreCalculator
 *
 * Produces a comprehensive trend report for a single coin symbol by
 * aggregating scored social items from SQLite across all sources.
 *
 * Report includes:
 *   - Composite signal (sentiment, engagement, recency, authority)
 *   - Trend direction + strength classification
 *   - Mentions velocity (per hour)
 *   - Source-level breakdown
 *   - Top hashtags and trending keywords
 *   - Historical comparison (24 h ago, 7 d ago)
 */

import { socialStore } from '../../../database/sqlite-social-store.js';
import { extractHashtags, extractKeywords } from '../scoring/coin-extractor.js';
import type {
  MultiSourceTrendReport,
  SentimentMomentum,
  TrendDirection,
  TrendStrength,
  SourceBreakdown,
  SocialSource,
  ScoredSocialItem,
} from '../../../types/social-media.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function classify(signal_sentiment: number): TrendDirection {
  if (signal_sentiment > 65) return 'BULLISH';
  if (signal_sentiment < 40) return 'BEARISH';
  return 'NEUTRAL';
}

function strength(signal_composite: number): TrendStrength {
  if (signal_composite > 75) return 'STRONG';
  if (signal_composite > 50) return 'MODERATE';
  return 'WEAK';
}

function buildSourceBreakdown(items: ScoredSocialItem[]): SourceBreakdown[] {
  const map = new Map<SocialSource, { mentions: number; engagements: number[]; authorities: number[] }>();

  for (const item of items) {
    const src = item.source;
    const ex = map.get(src) ?? { mentions: 0, engagements: [], authorities: [] };
    ex.mentions++;
    ex.engagements.push(item.score_engagement);
    ex.authorities.push(item.score_authority);
    map.set(src, ex);
  }

  return Array.from(map.entries()).map(([source, data]) => ({
    source,
    mentions: data.mentions,
    avg_engagement: parseFloat(avg(data.engagements).toFixed(2)),
    avg_authority:  parseFloat(avg(data.authorities).toFixed(2)),
  })).sort((a, b) => b.mentions - a.mentions);
}

function topHashtags(items: ScoredSocialItem[], topN = 5): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    const tags = extractHashtags([item.title, item.content].filter(Boolean).join(' '));
    for (const t of tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => `#${tag}`);
}

function topKeywords(items: ScoredSocialItem[], topN = 5): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    const kws = extractKeywords([item.title, item.content].filter(Boolean).join(' '));
    for (const k of kws) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([kw]) => kw);
}

function sentimentDistribution(items: ScoredSocialItem[]): { BULL: number; NEUTRAL: number; BEAR: number } {
  let bull = 0, bear = 0, neutral = 0;
  for (const item of items) {
    if (item.score_sentiment > 60)      bull++;
    else if (item.score_sentiment < 40) bear++;
    else                                neutral++;
  }
  const total = items.length || 1;
  return {
    BULL:    Math.round(bull    / total * 100),
    NEUTRAL: Math.round(neutral / total * 100),
    BEAR:    Math.round(bear    / total * 100),
  };
}

interface HistoricalSignalSnapshot {
  snapshot_time: string;
  signal_composite: number;
  signal_sentiment?: number;
}

function avgSnapshotWindow(
  snapshots: HistoricalSignalSnapshot[],
  endMs: number,
  durationMs: number,
  fallback: number,
): number {
  const startMs = endMs - durationMs;
  const values = snapshots
    .filter(snapshot => {
      const time = Date.parse(snapshot.snapshot_time);
      return time >= startMs && time <= endMs;
    })
    .map(snapshot => snapshot.signal_sentiment ?? fallback);

  return parseFloat((values.length ? avg(values) : fallback).toFixed(2));
}

function buildSentimentMomentum(
  currentSentiment: number,
  mentionCount24h: number,
  history: HistoricalSignalSnapshot[],
  nowMs: number,
): SentimentMomentum {
  const snapshots: HistoricalSignalSnapshot[] = [
    { snapshot_time: new Date(nowMs).toISOString(), signal_composite: 0, signal_sentiment: currentSentiment },
    ...history,
  ];

  const h1_avg = avgSnapshotWindow(snapshots, nowMs, 1 * 3_600_000, currentSentiment);
  const h6_avg = avgSnapshotWindow(snapshots, nowMs, 6 * 3_600_000, currentSentiment);
  const h24_avg = avgSnapshotWindow(snapshots, nowMs, 24 * 3_600_000, currentSentiment);

  const prevH1 = avgSnapshotWindow(history, nowMs - 1 * 3_600_000, 1 * 3_600_000, h1_avg);
  const prevH6 = avgSnapshotWindow(history, nowMs - 6 * 3_600_000, 6 * 3_600_000, h6_avg);

  return {
    h1_avg,
    h6_avg,
    h24_avg,
    roc_1h: parseFloat((h1_avg - prevH1).toFixed(2)),
    roc_6h: parseFloat((h6_avg - prevH6).toFixed(2)),
    volume_interaction_24h: parseFloat((((h24_avg - 50) / 50) * mentionCount24h).toFixed(4)),
  };
}

// ── Dynamic signal weight adjustment ─────────────────────────────────────────

function compositeSignal(params: {
  signal_sentiment: number;
  signal_engagement: number;
  signal_authority: number;
  signal_recency: number;
  velocity: number;
  unique_sources: number;
}): number {
  const { signal_sentiment, signal_engagement, signal_authority, signal_recency, velocity, unique_sources } = params;

  // Base weights per spec
  let w_sent = 0.35, w_eng = 0.30, w_auth = 0.20, w_rec = 0.15;

  // Dynamic: velocity boost
  if (velocity > 20) {
    w_sent  += 0.05; w_eng  += 0.05;
    w_auth  -= 0.05; w_rec  -= 0.05;
  }
  // Consensus boost
  if (unique_sources >= 3) {
    w_sent  += 0.03; w_eng  += 0.02;
    w_auth  -= 0.03; w_rec  -= 0.02;
  }

  return parseFloat((
    signal_sentiment  * w_sent +
    signal_engagement * w_eng  +
    signal_authority  * w_auth +
    signal_recency    * w_rec
  ).toFixed(2));
}

// ── Calculator ────────────────────────────────────────────────────────────────

export class MultiSourceTrendingScoreCalculator {

  async calculate(symbol: string, intervalHours = 24): Promise<MultiSourceTrendReport> {
    const upper = symbol.toUpperCase();
    const nowMs = Date.now();
    const now   = new Date(nowMs).toISOString();

    // Current window items
    const items = socialStore.getItemsForCoin(upper, intervalHours);

    if (items.length === 0) {
      return this.emptyReport(upper, intervalHours);
    }

    // Compute sub-signals
    const signal_sentiment  = parseFloat(avg(items.map(i => i.score_sentiment)).toFixed(2));
    const signal_engagement = parseFloat(avg(items.map(i => i.score_engagement)).toFixed(2));
    const signal_authority  = parseFloat(avg(items.map(i => i.score_authority)).toFixed(2));
    const signal_recency    = parseFloat(avg(items.map(i => i.score_recency)).toFixed(2));

    const uniqueSources = new Set(items.map(i => i.source)).size;

    // Velocity: mentions per hour over the interval
    const velocity = parseFloat((items.length / Math.max(intervalHours, 1)).toFixed(3));

    const signal_composite = compositeSignal({
      signal_sentiment, signal_engagement, signal_authority, signal_recency,
      velocity, unique_sources: uniqueSources,
    });

    // Historical comparison
    const history = socialStore.getHistoricalSignal(upper);
    const cutoff24h = Date.now() - 24 * 3_600_000;
    const cutoff7d  = Date.now() - 7  * 24 * 3_600_000;

    const snap24h = history.find(h => Date.parse(h.snapshot_time) <= cutoff24h);
    const snap7d  = history.find(h => Date.parse(h.snapshot_time) <= cutoff7d);

    const score24hAgo = snap24h?.signal_composite ?? null;
    const score7dAgo  = snap7d?.signal_composite  ?? null;
    const sentiment_momentum = buildSentimentMomentum(signal_sentiment, items.length, history, nowMs);

    let acceleration: MultiSourceTrendReport['comparison']['trend_acceleration'] = 'stable';
    if (score24hAgo !== null) {
      const delta = signal_composite - score24hAgo;
      if (delta > 5)       acceleration = 'accelerating';
      else if (delta < -5) acceleration = 'decelerating';
    }

    // Top 5 items by composite score
    const topItems = [...items]
      .sort((a, b) => b.score_composite - a.score_composite)
      .slice(0, 5)
      .map(i => ({
        id: i.id,
        source: i.source,
        author: i.author,
        content: i.content.slice(0, 200),
        score_composite: i.score_composite,
        published_at: i.content_created_at,
        url: i.url,
      }));

    return {
      symbol: upper,
      signal_sentiment,
      signal_engagement,
      signal_recency,
      signal_authority,
      signal_composite,
      trend_direction: classify(signal_sentiment),
      trend_strength: strength(signal_composite),
      velocity,
      mention_count_24h: items.length,
      unique_sources: uniqueSources,
      sentiment_momentum,
      sentiment_distribution: sentimentDistribution(items),
      top_sources: buildSourceBreakdown(items),
      top_hashtags: topHashtags(items),
      trending_keywords: topKeywords(items),
      recent_items: topItems,
      comparison: {
        score_24h_ago: score24hAgo,
        score_7d_ago:  score7dAgo,
        trend_acceleration: acceleration,
      },
      computed_at: now,
    };
  }

  private emptyReport(symbol: string, _intervalHours: number): MultiSourceTrendReport {
    return {
      symbol,
      signal_sentiment: 50, signal_engagement: 0,
      signal_recency: 0, signal_authority: 0, signal_composite: 0,
      trend_direction: 'NEUTRAL', trend_strength: 'WEAK',
      velocity: 0, mention_count_24h: 0, unique_sources: 0,
      sentiment_momentum: {
        h1_avg: 50,
        h6_avg: 50,
        h24_avg: 50,
        roc_1h: 0,
        roc_6h: 0,
        volume_interaction_24h: 0,
      },
      sentiment_distribution: { BULL: 0, NEUTRAL: 100, BEAR: 0 },
      top_sources: [], top_hashtags: [], trending_keywords: [],
      recent_items: [],
      comparison: { score_24h_ago: null, score_7d_ago: null, trend_acceleration: 'stable' },
      computed_at: new Date().toISOString(),
    };
  }
}
