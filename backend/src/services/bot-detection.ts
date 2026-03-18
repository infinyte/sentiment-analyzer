/**
 * BotDetectionService
 *
 * Scores each SocialMediaItem for bot/coordinated-manipulation probability
 * using four heuristics:
 *
 *   1. Known-account blocklist (score += 0.40)
 *   2. Posting-frequency anomaly — author > 10 posts/min (score += 0.35)
 *   3. Near-duplicate content — Jaccard similarity ≥ 0.85 (score += 0.30)
 *   4. Coordinated surge — > 3× baseline for a coin in a 5-min window (score += 0.25)
 *
 * A composite score ≥ 0.8 is treated as "likely bot" by downstream filters.
 * The score is clamped to [0, 1].
 */

import type { SocialMediaItem } from '../types/social-media.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface BotScore {
  /** Probability that the item is bot-generated, in [0, 1]. */
  score: number;
  /** Human-readable list of triggered heuristics. */
  reasons: string[];
}

// ── Config ────────────────────────────────────────────────────────────────────

/** Maximum legitimate posts per author per minute. */
const FREQ_THRESHOLD = 10;

/** Jaccard similarity above which two items are considered near-duplicates. */
const JACCARD_THRESHOLD = 0.85;

/** Factor above baseline activity required to trigger the surge heuristic. */
const SURGE_MULTIPLIER = 3;

/** Minimum absolute items-in-window required to trigger surge (avoids false
 *  positives on very low-volume coins). */
const SURGE_MIN_ABS = 5;

/** Duration of the surge detection window in milliseconds (5 minutes). */
const SURGE_WINDOW_MS = 5 * 60 * 1_000;

/** Duration of the frequency detection window in milliseconds (1 minute). */
const FREQ_WINDOW_MS = 60 * 1_000;

/** Known bot / shill account usernames (lower-cased). */
const BOT_BLOCKLIST = new Set<string>([
  'cryptopumpbot',
  'moonbotx',
  'shillmaster',
  'btcpump100x',
  'cryptospammer',
  'pumpndumpbot',
  'moonshot_shill',
  'cryptobotking',
  'shillcryptobot',
  'pumpmaster9000',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tokenize text into a Set of normalised words (length ≥ 2). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9$#\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2),
  );
}

/** Jaccard similarity between two token sets. Returns 1 when both are empty. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class BotDetectionService {
  /**
   * Score a single item against a window of co-scraped items.
   *
   * @param item        The item to evaluate.
   * @param recentItems All items scraped in the same batch (including `item`
   *                    itself — the heuristics skip self-comparison by id).
   */
  score(item: SocialMediaItem, recentItems: SocialMediaItem[] = [item]): BotScore {
    const reasons: string[] = [];
    let score = 0;

    // ── 1. Blocklist ──────────────────────────────────────────────────────────
    if (item.author && BOT_BLOCKLIST.has(item.author.toLowerCase())) {
      reasons.push(`author "${item.author}" on bot blocklist`);
      score += 0.40;
    }

    // ── 2. Posting-frequency anomaly ──────────────────────────────────────────
    if (item.author) {
      const itemTime   = Date.parse(item.fetched_at);
      const windowStart = itemTime - FREQ_WINDOW_MS;
      const postsInWindow = recentItems.filter(r =>
        r.author === item.author &&
        r.id !== item.id &&
        Date.parse(r.fetched_at) >= windowStart &&
        Date.parse(r.fetched_at) <= itemTime,
      ).length;

      if (postsInWindow >= FREQ_THRESHOLD) {
        reasons.push(
          `author posting rate: ${postsInWindow + 1} posts/min (threshold: ${FREQ_THRESHOLD})`,
        );
        score += 0.35;
      }
    }

    // ── 3. Near-duplicate content (Jaccard similarity) ────────────────────────
    const fullText    = [item.title, item.content].filter(Boolean).join(' ');
    const itemTokens  = tokenize(fullText);

    if (itemTokens.size > 0) {
      for (const other of recentItems) {
        if (other.id === item.id) continue;
        const otherText   = [other.title, other.content].filter(Boolean).join(' ');
        const otherTokens = tokenize(otherText);
        const sim         = jaccardSimilarity(itemTokens, otherTokens);
        if (sim >= JACCARD_THRESHOLD) {
          reasons.push(
            `near-duplicate content (Jaccard=${sim.toFixed(2)}) with item ${other.id}`,
          );
          score += 0.30;
          break; // one near-duplicate match is sufficient
        }
      }
    }

    // ── 4. Coordinated surge (> 3× baseline per coin in 5-min window) ─────────
    const itemTime = Date.parse(item.fetched_at);

    for (const coin of item.coins_mentioned) {
      const surgeWindowStart = itemTime - SURGE_WINDOW_MS;

      const currentWindowItems = recentItems.filter(r => {
        const t = Date.parse(r.fetched_at);
        return r.coins_mentioned.includes(coin) && t >= surgeWindowStart && t <= itemTime;
      });

      // Baseline: average items per 5-minute window before the current surge window.
      const historicalCoinItems = recentItems.filter(
        r => r.coins_mentioned.includes(coin) && Date.parse(r.fetched_at) < surgeWindowStart,
      );

      if (historicalCoinItems.length === 0) continue;

      const oldestTime = historicalCoinItems.reduce(
        (min, r) => Math.min(min, Date.parse(r.fetched_at)),
        surgeWindowStart,
      );
      const totalWindowMs = Math.max(surgeWindowStart - oldestTime, SURGE_WINDOW_MS);
      const numWindows    = totalWindowMs / SURGE_WINDOW_MS;
      const baseline      = historicalCoinItems.length / Math.max(numWindows, 1);

      if (
        currentWindowItems.length >= SURGE_MIN_ABS &&
        baseline > 0 &&
        currentWindowItems.length >= SURGE_MULTIPLIER * baseline
      ) {
        reasons.push(
          `coordinated surge for ${coin}: ${currentWindowItems.length} posts in 5 min` +
          ` (${SURGE_MULTIPLIER}× baseline of ${baseline.toFixed(1)})`,
        );
        score += 0.25;
        break; // one surge trigger per item is sufficient
      }
    }

    return { score: Math.min(score, 1), reasons };
  }

  /**
   * Score all items in a batch in one pass.
   * Each item is evaluated against all others in the batch.
   *
   * @returns Map from item.id to its BotScore.
   */
  scoreAll(items: SocialMediaItem[]): Map<string, BotScore> {
    const results = new Map<string, BotScore>();
    for (const item of items) {
      results.set(item.id, this.score(item, items));
    }
    return results;
  }
}

export const botDetectionService = new BotDetectionService();
