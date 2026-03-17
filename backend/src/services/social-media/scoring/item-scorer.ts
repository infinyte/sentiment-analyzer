/**
 * Social Media Item Scoring Pipeline
 *
 * Runs four independent sub-scorers and combines them into a composite [0, 100] signal:
 *
 *   score_sentiment  (30%) — bull/bear strength of the content text
 *   score_engagement (25%) — normalized like/share/comment/view counts
 *   score_authority  (25%) — source credibility + author influence
 *   score_recency    (20%) — exponential decay from publish time
 *
 * Each scorer returns a value in [0, 100].
 */

import { SentimentAnalyzerEngine } from '../../sentiment-analyzer.js';
import { extractCoins } from './coin-extractor.js';
import type { SocialMediaItem, ScoredSocialItem, SocialSource } from '../../../types/social-media.js';

const analyzer = new SentimentAnalyzerEngine();

// ── 1. Sentiment Scorer ───────────────────────────────────────────────────────

/**
 * Calls the existing BASIC sentiment analyzer on the item's text.
 * BULL → 75–100, NEUTRAL → 40–60, BEAR → 0–25, weighted by confidence.
 */
function scoreSentiment(text: string): { score: number; raw: number; confidence: number } {
  const headlines = text
    .split(/[.!?\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 10)
    .slice(0, 5);

  const result = analyzer.analyzeBasicSentiment('UNKNOWN', headlines.length ? headlines : [text]);

  let baseMid: number;
  let rawSentiment: number;
  if (result.sentiment === 'BULL') {
    baseMid = 87.5;
    rawSentiment = 1;
  } else if (result.sentiment === 'BEAR') {
    baseMid = 12.5;
    rawSentiment = -1;
  } else {
    baseMid = 50;
    rawSentiment = 0;
  }

  const confidence = result.confidence ?? 0.5;
  // Pull the score towards the neutral midpoint (50) when confidence is low
  const score = baseMid * confidence + 50 * (1 - confidence);

  return {
    score: parseFloat(score.toFixed(2)),
    raw: rawSentiment,
    confidence,
  };
}

// ── 2. Engagement Scorer ──────────────────────────────────────────────────────

// Platform-specific weighting for each engagement metric
const ENGAGEMENT_WEIGHTS: Record<SocialSource, { likes: number; shares: number; comments: number; views: number }> = {
  twitter:  { likes: 0.30, shares: 0.40, comments: 0.20, views: 0.10 },
  reddit:   { likes: 0.40, shares: 0.00, comments: 0.60, views: 0.00 },
  rss:      { likes: 0.00, shares: 0.00, comments: 0.00, views: 0.00 }, // baseline below
  tiktok:   { likes: 0.30, shares: 0.20, comments: 0.00, views: 0.50 },
  discord:  { likes: 0.60, shares: 0.00, comments: 0.40, views: 0.00 }, // reactions + replies
  telegram: { likes: 0.00, shares: 0.00, comments: 0.00, views: 1.00 }, // view count is primary signal
  youtube:  { likes: 0.25, shares: 0.00, comments: 0.25, views: 0.50 },
};

// Log-scale normalization ceiling per metric
const METRIC_CEILINGS: Record<string, number> = {
  likes: 10_000,
  shares: 2_000,
  comments: 1_000,
  views: 500_000,
};

function logNorm(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(Math.log1p(value) / Math.log1p(ceiling), 1) * 100;
}

function scoreEngagement(item: SocialMediaItem): number {
  if (item.source === 'rss') return 40;      // professional journalism baseline
  if (item.source === 'telegram' && !item.engagement_views) return 20; // no data

  const weights = ENGAGEMENT_WEIGHTS[item.source] ?? ENGAGEMENT_WEIGHTS.twitter;

  const normLikes    = logNorm(item.engagement_likes,    METRIC_CEILINGS.likes);
  const normShares   = logNorm(item.engagement_shares,   METRIC_CEILINGS.shares);
  const normComments = logNorm(item.engagement_comments, METRIC_CEILINGS.comments);
  const normViews    = logNorm(item.engagement_views ?? 0, METRIC_CEILINGS.views);

  const score =
    normLikes    * weights.likes +
    normShares   * weights.shares +
    normComments * weights.comments +
    normViews    * weights.views;

  return parseFloat(Math.min(score, 100).toFixed(2));
}

// ── 3. Recency Scorer ─────────────────────────────────────────────────────────

/**
 * Exponential decay: score = 100 * exp(-ageHours / 48)
 *   0h  → 100,  6h → ~88,  24h → ~61,  7d → ~9,  30d → ~0
 */
function scoreRecency(publishedAt: string): number {
  const ms = Date.parse(publishedAt);
  if (isNaN(ms)) return 40; // unknown age
  const ageHours = Math.max(0, (Date.now() - ms) / 3_600_000);
  return parseFloat((100 * Math.exp(-ageHours / 48)).toFixed(2));
}

// ── 4. Authority Scorer ───────────────────────────────────────────────────────

const RSS_TIER: Record<string, number> = {
  coindesk: 20,
  cointelegraph: 15,
  theblock: 15,
  decrypt: 12,
  bloomberg: 20,
  reuters: 20,
  cryptonews: 10,
  ambcrypto: 8,
};

const SOURCE_BASE: Record<SocialSource, number> = {
  rss:      75,
  youtube:  65, // established video creators have strong authority
  twitter:  45,
  discord:  40, // community servers vary widely
  reddit:   35,
  telegram: 30, // channel quality varies; view count compensates
  tiktok:   25,
};

function scoreAuthority(item: SocialMediaItem): number {
  let base = SOURCE_BASE[item.source] ?? 40;

  // Author follower boost
  const followers = item.author_followers ?? 0;
  if (followers >= 1_000_000)       base += 20;
  else if (followers >= 100_000)    base += 15;
  else if (followers >= 10_000)     base += 10;
  else if (followers >= 1_000)      base += 5;

  // RSS domain credibility
  if (item.source === 'rss') {
    const domain = (item.metadata?.feed_name as string ?? '').toLowerCase();
    for (const [key, bonus] of Object.entries(RSS_TIER)) {
      if (domain.includes(key)) { base += bonus; break; }
    }
  }

  // Reddit subreddit authority — larger subs tend to have higher quality
  if (item.source === 'reddit') {
    const sub = (item.metadata?.subreddit as string ?? '').toLowerCase();
    if (['cryptocurrency', 'bitcoin', 'ethereum'].includes(sub)) base += 10;
    else if (['cryptomarkets', 'altcoin'].includes(sub)) base += 5;
  }

  return parseFloat(Math.min(base, 100).toFixed(2));
}

// ── 5. Composite ──────────────────────────────────────────────────────────────

const WEIGHTS = { sentiment: 0.30, engagement: 0.25, authority: 0.25, recency: 0.20 };

// ── Public API ─────────────────────────────────────────────────────────────────

export function scoreItem(item: SocialMediaItem): ScoredSocialItem {
  const fullText = [item.title, item.content].filter(Boolean).join(' ');

  const sentResult = scoreSentiment(fullText);
  const engScore   = scoreEngagement(item);
  const recScore   = scoreRecency(item.content_created_at);
  const authScore  = scoreAuthority(item);

  const composite = parseFloat((
    sentResult.score * WEIGHTS.sentiment +
    engScore          * WEIGHTS.engagement +
    authScore         * WEIGHTS.authority +
    recScore          * WEIGHTS.recency
  ).toFixed(2));

  const coins = item.coins_mentioned.length
    ? item.coins_mentioned
    : extractCoins(fullText);

  return {
    ...item,
    coins_mentioned: coins,
    sentiment_score: sentResult.raw,
    sentiment_confidence: sentResult.confidence,
    score_sentiment:  sentResult.score,
    score_engagement: engScore,
    score_recency:    recScore,
    score_authority:  authScore,
    score_composite:  composite,
    last_updated: new Date().toISOString(),
  };
}

export function scoreItems(items: SocialMediaItem[]): ScoredSocialItem[] {
  return items.map(scoreItem);
}
