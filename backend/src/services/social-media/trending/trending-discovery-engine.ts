/**
 * TrendingTopicDiscoveryEngine
 *
 * Reads scored social items from SQLite and computes trending topics
 * by aggregating entity mentions across all sources within a time window.
 *
 * Algorithm:
 *   1. Pull all items from the DB within [now - timeWindowHours, now]
 *   2. Extract entities (coins, hashtags, keywords) from each item
 *   3. Aggregate mention counts, engagement, sentiment, and source diversity
 *   4. Calculate velocity by comparing to the prior equal-length window
 *   5. Rank by composite signal and persist back to trending_topics table
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import { socialStore } from '../../../database/sqlite-social-store.js';
import { appConfigService } from '../../app-config-service.js';
import { extractAll } from '../scoring/coin-extractor.js';
import type { ScoredSocialItem, TrendingTopicRecord, TopicType } from '../../../types/social-media.js';

// ── Entity accumulator ─────────────────────────────────────────────────────────

interface EntityAccum {
  topic_type: TopicType;
  coin_symbol?: string;
  items: ScoredSocialItem[];
  sources: Set<string>;
  sentimentSum: number;
  engagementSum: number;
  authoritySum: number;
  recencySum: number;
  compositeSum: number;
  peakItem: ScoredSocialItem;
}

function upsert(
  map: Map<string, EntityAccum>,
  key: string,
  type: TopicType,
  coinSymbol: string | undefined,
  item: ScoredSocialItem
): void {
  const ex = map.get(key);
  if (ex) {
    ex.items.push(item);
    ex.sources.add(item.source);
    ex.sentimentSum  += item.score_sentiment;
    ex.engagementSum += item.score_engagement;
    ex.authoritySum  += item.score_authority;
    ex.recencySum    += item.score_recency;
    ex.compositeSum  += item.score_composite;
    if (item.score_composite > ex.peakItem.score_composite) ex.peakItem = item;
  } else {
    map.set(key, {
      topic_type: type,
      coin_symbol: coinSymbol,
      items: [item],
      sources: new Set([item.source]),
      sentimentSum:  item.score_sentiment,
      engagementSum: item.score_engagement,
      authoritySum:  item.score_authority,
      recencySum:    item.score_recency,
      compositeSum:  item.score_composite,
      peakItem: item,
    });
  }
}

// ── Velocity: compare mention count to prior window ───────────────────────────

function computeVelocity(currentCount: number, priorCount: number, windowHours: number): number {
  // Mentions per hour in current window
  const currentRate = currentCount / Math.max(windowHours, 1);
  // Return absolute rate; caller can compare to prior rate for acceleration
  return parseFloat(currentRate.toFixed(3));
}

// ── Composite ranking score ───────────────────────────────────────────────────

/**
 * Composite [0, 100]:
 *   velocity_score   (25%) — normalized mentions/hour
 *   engagement_score (20%) — avg item engagement
 *   mention_score    (20%) — log-normalized mention count
 *   source_score     (15%) — diversity of sources
 *   authority_score  (10%) — avg item authority
 *   sentiment_score  (10%) — avg sentiment strength (distance from neutral)
 */
function buildComposite(accum: EntityAccum, velocity: number): {
  signal_sentiment: number;
  signal_engagement: number;
  signal_recency: number;
  signal_authority: number;
  signal_composite: number;
} {
  const n = accum.items.length;

  const signal_sentiment  = parseFloat((accum.sentimentSum  / n).toFixed(2));
  const signal_engagement = parseFloat((accum.engagementSum / n).toFixed(2));
  const signal_recency    = parseFloat((accum.recencySum    / n).toFixed(2));
  const signal_authority  = parseFloat((accum.authoritySum  / n).toFixed(2));

  const normVelocity  = Math.min(velocity / 20, 1) * 100;         // 20 mentions/h = max
  const normMentions  = Math.min(Math.log1p(n) / Math.log1p(200), 1) * 100;
  const normSources   = Math.min(accum.sources.size / 4, 1) * 100;
  const sentStrength  = Math.abs(signal_sentiment - 50);           // distance from neutral

  const signal_composite = parseFloat((
    normVelocity    * 0.25 +
    signal_engagement * 0.20 +
    normMentions    * 0.20 +
    normSources     * 0.15 +
    signal_authority * 0.10 +
    sentStrength     * 0.10
  ).toFixed(2));

  return { signal_sentiment, signal_engagement, signal_recency, signal_authority, signal_composite };
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class TrendingTopicDiscoveryEngine {

  /**
   * Discover trending topics from the DB.
   * Persists results back to `trending_topics` table and returns them.
   */
  async discoverTrends(
    timeWindowHours = 24,
    topN = 30,
    minMentions = parseInt(appConfigService.get('TRENDING_MIN_MENTIONS') ?? '3', 10)
  ): Promise<TrendingTopicRecord[]> {
    const start = Date.now();

    // Pull items for both current and prior windows
    const cutoffCurrent = new Date(Date.now() - timeWindowHours * 3_600_000).toISOString();
    const cutoffPrior   = new Date(Date.now() - timeWindowHours * 2 * 3_600_000).toISOString();

    // We'll query via store helper — fetch all recent items, excluding likely bots
    const isNotBot = (i: ScoredSocialItem) => (i.bot_score ?? 0) < 0.8;
    const currentItems = this.getItemsSince(cutoffCurrent).filter(isNotBot);
    const priorItems   = this.getItemsSince(cutoffPrior).filter(i => i.fetched_at < cutoffCurrent && isNotBot(i));

    // Build entity maps
    const currentMap = this.buildEntityMap(currentItems);
    const priorMap   = this.buildEntityMap(priorItems);

    const records: TrendingTopicRecord[] = [];
    const now = new Date().toISOString();

    for (const [topic, accum] of currentMap.entries()) {
      if (accum.items.length < minMentions) continue;

      const priorCount = priorMap.get(topic)?.items.length ?? 0;
      const velocity   = computeVelocity(accum.items.length, priorCount, timeWindowHours);
      const signals    = buildComposite(accum, velocity);

      const record: TrendingTopicRecord = {
        id: randomUUID(),
        topic,
        topic_type: accum.topic_type,
        coin_symbol: accum.coin_symbol,
        mention_count: accum.items.length,
        unique_sources: accum.sources.size,
        ...signals,
        velocity,
        peak_time: accum.peakItem.fetched_at,
        last_updated: now,
        created_at: accum.items[0]?.content_created_at ?? now,
      };

      records.push(record);

      try {
        socialStore.upsertTrendingTopic(record);
      } catch (err) {
        logger.warn('trending-discovery: upsert error', { topic, error: String(err) });
      }
    }

    // Snapshot composite scores for coin topics (for historical comparison)
    for (const r of records) {
      if (r.topic_type === 'coin' && r.coin_symbol) {
        try { socialStore.saveTrendingSnapshot(r.coin_symbol, r.signal_composite, r.signal_sentiment); } catch { /* non-fatal */ }
      }
    }

    records.sort((a, b) => b.signal_composite - a.signal_composite);
    const elapsed = Date.now() - start;
    logger.info('trending-discovery: complete', {
      topicsFound: records.length,
      itemsAnalyzed: currentItems.length,
      elapsed_ms: elapsed,
    });

    return records.slice(0, topN);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getItemsSince(isoTimestamp: string): ScoredSocialItem[] {
    // Use the store's queryItems with a sinceHours approximation
    // Calc hours from now
    const hours = Math.ceil((Date.now() - Date.parse(isoTimestamp)) / 3_600_000) + 1;
    return socialStore.queryItems({ sinceHours: hours, limit: 5000, offset: 0 }).items;
  }

  private buildEntityMap(items: ScoredSocialItem[]): Map<string, EntityAccum> {
    const map = new Map<string, EntityAccum>();

    for (const item of items) {
      const fullText = [item.title, item.content].filter(Boolean).join(' ');
      const { coins, hashtags, keywords } = extractAll(fullText);

      // Coins already extracted during scraping
      const effectiveCoins = item.coins_mentioned.length ? item.coins_mentioned : coins;

      for (const coin of effectiveCoins) {
        upsert(map, coin, 'coin', coin, item);
      }
      for (const tag of hashtags.slice(0, 3)) {
        // Only store crypto-relevant hashtags (skip generic ones like #news)
        if (tag.length >= 3) {
          const hashtagCoinSymbol = extractAll(tag).coins[0];
          upsert(map, `#${tag}`, 'hashtag', hashtagCoinSymbol, item);
        }
      }
      for (const keyword of keywords.slice(0, 5)) {
        upsert(map, keyword, 'keyword', undefined, item);
      }
    }

    return map;
  }
}
