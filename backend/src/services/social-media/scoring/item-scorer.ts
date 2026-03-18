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
import { detectSarcasm } from './sarcasm-detector.js';
import { finBertService } from '../../finbert.js';
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

function buildBotAuditRecord(item: SocialMediaItem, coins: string[]): ScoredSocialItem {
  return {
    ...item,
    coins_mentioned: coins,
    sentiment_score: 0,
    sentiment_confidence: 0,
    score_sentiment: 50,
    score_engagement: 0,
    score_recency: 0,
    score_authority: 0,
    score_composite: 0,
    last_updated: new Date().toISOString(),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function scoreItem(item: SocialMediaItem): ScoredSocialItem {
  const fullText = [item.title, item.content].filter(Boolean).join(' ');
  const coins = item.coins_mentioned.length
    ? item.coins_mentioned
    : extractCoins(fullText);

  if ((item.bot_score ?? 0) >= 0.8) {
    return buildBotAuditRecord(item, coins);
  }

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

// ── Language Detection (Issue #4) ─────────────────────────────────────────────

/**
 * Returns an ISO 639-1 language code for `text`.
 *
 * Uses Unicode script ranges rather than an external library so it works in
 * both ESM and CommonJS (Jest) environments without additional configuration.
 *
 * Detects non-Latin scripts reliably; defaults to 'en' for Latin-script text
 * (English, Spanish, French, German, …).
 */
export function detectLanguage(text: string): string {
  if (text.trim().length < 10) return 'en';

  let cjk = 0, hangul = 0, arabic = 0, cyrillic = 0, hiragana = 0, katakana = 0;

  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)) cjk++;
    else if (cp >= 0xAC00 && cp <= 0xD7AF) hangul++;
    else if (cp >= 0x0600 && cp <= 0x06FF) arabic++;
    else if (cp >= 0x0400 && cp <= 0x04FF) cyrillic++;
    else if (cp >= 0x3040 && cp <= 0x309F) hiragana++;
    else if (cp >= 0x30A0 && cp <= 0x30FF) katakana++;
  }

  const len = text.length;
  if ((hiragana + katakana) / len > 0.05) return 'ja';
  if (cjk / len > 0.15) return 'zh';
  if (hangul / len > 0.1) return 'ko';
  if (arabic / len > 0.1) return 'ar';
  if (cyrillic / len > 0.1) return 'ru';
  return 'en';
}

// ── ABSA helper (Issue #3) ────────────────────────────────────────────────────

/**
 * Extract a ±windowSize token window centred on the first occurrence of
 * `target` in `text`.  Returns null when `target` is not found.
 */
function extractContextWindow(text: string, target: string, windowSize = 50): string | null {
  const tokens = text.split(/\s+/);
  const targetLower = target.toLowerCase();
  const idx = tokens.findIndex(t => t.toLowerCase().includes(targetLower));
  if (idx === -1) return null;
  const start = Math.max(0, idx - windowSize);
  const end   = Math.min(tokens.length, idx + windowSize + 1);
  return tokens.slice(start, end).join(' ');
}

// ── Async Scoring Pipeline (Issues #1, #2, #3, #4) ───────────────────────────

/**
 * Async variant of scoreItem that integrates:
 *   - FinBERT sentiment model when FINBERT_API_URL is configured  (Issue #1)
 *   - Sarcasm/irony heuristic detection                           (Issue #2)
 *   - Language detection via Unicode script heuristic             (Issue #4)
 *
 * Falls back gracefully to the sync keyword scorer when FinBERT is unavailable.
 * The sync scoreItem() is unchanged so existing callers keep working.
 */
export async function scoreItemAsync(item: SocialMediaItem): Promise<ScoredSocialItem> {
  const fullText = [item.title, item.content].filter(Boolean).join(' ');
  const coins = item.coins_mentioned.length ? item.coins_mentioned : extractCoins(fullText);

  if ((item.bot_score ?? 0) >= 0.8) {
    return buildBotAuditRecord(item, coins);
  }

  // ABSA (Issue #3): extract context window around the primary coin mention
  let scoringText = fullText;
  let context_window_used = false;
  const primaryCoin = item.coins_mentioned[0];
  if (primaryCoin) {
    const window = extractContextWindow(fullText, primaryCoin);
    if (window) {
      scoringText = window;
      context_window_used = true;
    }
  }

  // Sarcasm detection (shared; used regardless of FinBERT availability)
  const sarcasmResult = detectSarcasm(scoringText);

  // Language detection
  const language = detectLanguage(scoringText);

  // Sentiment scoring — FinBERT preferred, keyword fallback
  let sentResult: { score: number; raw: number; confidence: number };
  let finbert_used = false;

  if (finBertService.isAvailable()) {
    const finBertOutput = await finBertService.analyze(scoringText);
    if (finBertOutput !== null) {
      finbert_used = true;
      const rawSentiment = finBertService.toSentimentScore(finBertOutput);

      if (sarcasmResult.sarcastic && sarcasmResult.confidence >= 0.67) {
        // Strong sarcasm signal: invert and halve the magnitude
        const invertedRaw = -rawSentiment * 0.5;
        sentResult = {
          score: parseFloat((50 + invertedRaw * 50).toFixed(2)),
          raw:   invertedRaw,
          confidence: finBertOutput.score * 0.5,
        };
      } else {
        sentResult = {
          score: parseFloat((50 + rawSentiment * 50).toFixed(2)),
          raw:   rawSentiment,
          confidence: finBertOutput.score,
        };
      }
    } else {
      sentResult = scoreSentiment(scoringText);
    }
  } else {
    sentResult = scoreSentiment(scoringText);
    // Apply sarcasm adjustment to keyword-based score too
    if (sarcasmResult.sarcastic && sarcasmResult.confidence >= 0.67) {
      const invertedRaw = -sentResult.raw * 0.5;
      sentResult = {
        score: parseFloat((50 + invertedRaw * 50).toFixed(2)),
        raw:   invertedRaw,
        confidence: sentResult.confidence * 0.5,
      };
    }
  }

  const engScore  = scoreEngagement(item);
  const recScore  = scoreRecency(item.content_created_at);
  const authScore = scoreAuthority(item);

  const composite = parseFloat((
    sentResult.score * WEIGHTS.sentiment +
    engScore          * WEIGHTS.engagement +
    authScore         * WEIGHTS.authority +
    recScore          * WEIGHTS.recency
  ).toFixed(2));

  return {
    ...item,
    language,
    coins_mentioned: coins,
    sentiment_score:     sentResult.raw,
    sentiment_confidence: sentResult.confidence,
    score_sentiment:  sentResult.score,
    score_engagement: engScore,
    score_recency:    recScore,
    score_authority:  authScore,
    score_composite:  composite,
    sarcasm_flagged:  sarcasmResult.sarcastic,
    finbert_used,
    context_window_used,
    last_updated: new Date().toISOString(),
  };
}

/** Async bulk scoring — runs items in parallel. */
export async function scoreItemsAsync(items: SocialMediaItem[]): Promise<ScoredSocialItem[]> {
  return Promise.all(items.map(scoreItemAsync));
}
