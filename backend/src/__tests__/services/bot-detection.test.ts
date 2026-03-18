/**
 * Tests for BotDetectionService (Enhancement #9).
 *
 * Covers each heuristic individually and combined scoring / clamping.
 */

import { describe, it, expect } from '@jest/globals';
import { BotDetectionService } from '../../services/bot-detection.js';
import type { SocialMediaItem } from '../../types/social-media.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_TIME = new Date('2026-03-18T12:00:00Z').getTime();

function makeItem(overrides: Partial<SocialMediaItem> = {}): SocialMediaItem {
  return {
    id:                  'item-default',
    source:              'twitter',
    source_id:           'tweet-default',
    content:             'Bitcoin is looking bullish today',
    engagement_likes:    100,
    engagement_shares:   20,
    engagement_comments: 5,
    content_created_at:  new Date(BASE_TIME).toISOString(),
    fetched_at:          new Date(BASE_TIME).toISOString(),
    url:                 'https://x.com/i/web/status/tweet-default',
    coins_mentioned:     ['BTC'],
    metadata:            {},
    ...overrides,
  };
}

/** Build N near-identical items fetched within the given millisecond window. */
function manyItemsForAuthor(
  author: string,
  count: number,
  windowMs = 55_000,       // < 60 s (one-minute freq window)
  startTime = BASE_TIME,
): SocialMediaItem[] {
  return Array.from({ length: count }, (_, i) => makeItem({
    id:        `item-${author}-${i}`,
    source_id: `tweet-${author}-${i}`,
    author,
    fetched_at: new Date(startTime - (windowMs / count) * i).toISOString(),
    content:   `Post number ${i} from ${author}`,
  }));
}

const svc = new BotDetectionService();

// ── 1. Blocklist ──────────────────────────────────────────────────────────────

describe('BotDetectionService — blocklist heuristic', () => {
  it('flags known bot account', () => {
    const item = makeItem({ author: 'cryptopumpbot' });
    const { score, reasons } = svc.score(item, [item]);
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(reasons.some(r => r.includes('bot blocklist'))).toBe(true);
  });

  it('is case-insensitive', () => {
    const item = makeItem({ author: 'CryptoPumpBot' });
    const { score } = svc.score(item, [item]);
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it('does not flag a clean author', () => {
    const item = makeItem({ author: 'satoshi_nakamoto' });
    const { score, reasons } = svc.score(item, [item]);
    expect(score).toBeLessThan(0.4);
    expect(reasons.some(r => r.includes('bot blocklist'))).toBe(false);
  });

  it('returns score 0 and empty reasons for anonymous item with clean content', () => {
    const item = makeItem({ author: undefined, coins_mentioned: [] });
    const { score, reasons } = svc.score(item, [item]);
    expect(score).toBe(0);
    expect(reasons).toHaveLength(0);
  });
});

// ── 2. Posting-frequency anomaly ──────────────────────────────────────────────

describe('BotDetectionService — posting-frequency heuristic', () => {
  it('flags author posting more than 10 times per minute', () => {
    const author = 'spammy_user';
    const batch  = manyItemsForAuthor(author, 12);
    const target = batch[0];
    const { score, reasons } = svc.score(target, batch);
    expect(score).toBeGreaterThanOrEqual(0.35);
    expect(reasons.some(r => r.includes('posting rate'))).toBe(true);
  });

  it('does not flag author posting 9 times per minute', () => {
    const author = 'normal_user';
    const batch  = manyItemsForAuthor(author, 9);
    const target = batch[0];
    const { score, reasons } = svc.score(target, batch);
    expect(reasons.some(r => r.includes('posting rate'))).toBe(false);
    // Without any other triggers the frequency contribution should be 0
    expect(score).toBeLessThan(0.35);
  });

  it('ignores posts outside the 1-minute window', () => {
    const author = 'old_poster';
    // 11 items but spread over 5 minutes — only 2 per minute
    const batch = manyItemsForAuthor(author, 11, 5 * 60_000);
    const target = batch[0];
    const { reasons } = svc.score(target, batch);
    expect(reasons.some(r => r.includes('posting rate'))).toBe(false);
  });
});

// ── 3. Near-duplicate content (Jaccard) ──────────────────────────────────────

describe('BotDetectionService — Jaccard near-duplicate heuristic', () => {
  it('flags item that is almost identical to another in the batch', () => {
    const target = makeItem({ id: 'item-a', source_id: 'a', content: 'Bitcoin moon pump rally adopt' });
    const clone  = makeItem({ id: 'item-b', source_id: 'b', content: 'Bitcoin moon pump rally adopt' }); // identical
    const { score, reasons } = svc.score(target, [target, clone]);
    expect(score).toBeGreaterThanOrEqual(0.30);
    expect(reasons.some(r => r.includes('near-duplicate'))).toBe(true);
  });

  it('does not flag clearly different content', () => {
    const a = makeItem({ id: 'item-a', source_id: 'a', content: 'Bitcoin is surging after adoption news' });
    const b = makeItem({ id: 'item-b', source_id: 'b', content: 'Ethereum faces regulatory headwinds today' });
    const { reasons } = svc.score(a, [a, b]);
    expect(reasons.some(r => r.includes('near-duplicate'))).toBe(false);
  });

  it('skips self-comparison (identical item id)', () => {
    const item = makeItem({ id: 'only-item', content: 'BTC moon' });
    const { reasons } = svc.score(item, [item]);
    expect(reasons.some(r => r.includes('near-duplicate'))).toBe(false);
  });
});

// ── 4. Coordinated surge ──────────────────────────────────────────────────────

describe('BotDetectionService — surge-detection heuristic', () => {
  it('flags when >3× baseline items for a coin arrive in 5-min window', () => {
    // Design: 5 old items spread over 60 min (one per 12-min window) → baseline ≈ 1.2/5-min window
    // Then 15 surge items crammed into the last 5 min → 14 (excl. target) >> 3×1.2
    const now      = BASE_TIME;
    const oldItems = Array.from({ length: 5 }, (_, i) => makeItem({
      id:        `old-${i}`,
      source_id: `old-tweet-${i}`,
      fetched_at: new Date(now - (10 + i * 12) * 60_000).toISOString(), // 10,22,34,46,58 min ago
      coins_mentioned: ['BTC'],
    }));
    // 15 surge items within the last 5 minutes (spread 0–4.5 min ago at 20-s intervals)
    const surgeItems = Array.from({ length: 15 }, (_, i) => makeItem({
      id:        `surge-${i}`,
      source_id: `surge-tweet-${i}`,
      fetched_at: new Date(now - i * 20_000).toISOString(),
      coins_mentioned: ['BTC'],
    }));
    const target = surgeItems[0]; // most recent (now)
    const batch  = [...oldItems, ...surgeItems];
    const { score, reasons } = svc.score(target, batch);
    expect(score).toBeGreaterThanOrEqual(0.25);
    expect(reasons.some(r => r.includes('surge'))).toBe(true);
  });

  it('does not flag low-volume coins that do not meet SURGE_MIN_ABS', () => {
    // Only 3 items in window (< SURGE_MIN_ABS=5) even if 3× baseline
    const batch = Array.from({ length: 3 }, (_, i) => makeItem({
      id:        `few-${i}`,
      source_id: `few-tweet-${i}`,
      fetched_at: new Date(BASE_TIME - i * 60_000).toISOString(),
      coins_mentioned: ['PEPE'],
    }));
    const { reasons } = svc.score(batch[0], batch);
    expect(reasons.some(r => r.includes('surge'))).toBe(false);
  });

  it('does not flag when item has no coins_mentioned', () => {
    const item = makeItem({ coins_mentioned: [] });
    const { reasons } = svc.score(item, [item]);
    expect(reasons.some(r => r.includes('surge'))).toBe(false);
  });
});

// ── Combined + clamping ───────────────────────────────────────────────────────

describe('BotDetectionService — combined score + clamping', () => {
  it('clamps total score to 1.0 even when multiple heuristics fire', () => {
    const author = 'cryptopumpbot'; // blocklist (+0.40)
    const batch  = manyItemsForAuthor(author, 12); // frequency (+0.35)
    // Make all items near-identical (+0.30 on one of them)
    const clone = { ...batch[1], content: batch[0].content };
    batch[1] = clone;
    const { score } = svc.score(batch[0], batch);
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThanOrEqual(0.75);
  });

  it('returns score 0 for a completely clean item with unique content', () => {
    const item  = makeItem({ author: 'satoshi', coins_mentioned: [] });
    const other = makeItem({ id: 'other', source_id: 'other', author: 'hal', content: 'ETH proof of stake upgrade' });
    const { score, reasons } = svc.score(item, [item, other]);
    expect(score).toBe(0);
    expect(reasons).toHaveLength(0);
  });
});

// ── scoreAll ──────────────────────────────────────────────────────────────────

describe('BotDetectionService.scoreAll', () => {
  it('returns a Map with one entry per item', () => {
    const items = [
      makeItem({ id: 'a', source_id: 'sa' }),
      makeItem({ id: 'b', source_id: 'sb', content: 'Ethereum news today' }),
    ];
    const results = svc.scoreAll(items);
    expect(results.size).toBe(2);
    expect(results.has('a')).toBe(true);
    expect(results.has('b')).toBe(true);
  });

  it('returns empty Map for empty input', () => {
    expect(svc.scoreAll([]).size).toBe(0);
  });

  it('all scores are in [0, 1]', () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem({
      id: `item-${i}`, source_id: `s-${i}`,
    }));
    for (const { score } of svc.scoreAll(items).values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
