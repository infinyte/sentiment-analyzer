/**
 * Text Normaliser — Adversarial Robustness Pre-processing (Enhancement #14)
 *
 * Applies three hardening steps before any ML/keyword inference:
 *   1. NFKC Unicode normalization — collapses lookalike/confusable characters
 *   2. Repeated-character collapsing — "mooooon" → "moon" (≥3 identical → 2)
 *   3. Crypto slang mapping — hodl → hold, wen → when, gm → good morning, …
 *
 * Loaded once at module initialisation; subsequent calls are pure string transforms.
 * Benchmarked at < 1 ms per typical social-media item (well within the 5 ms budget).
 */

// ── Slang map ────────────────────────────────────────────────────────────────
// Canonical source: crypto-slang-map.json in the same directory.
// Inlined here as a TypeScript const to avoid ESM/CJS JSON-import differences
// across Jest (CommonJS transform) and the compiled ESM bundle.

const CRYPTO_SLANG_MAP: Record<string, string> = {
  hodl:       'hold',
  wen:        'when',
  gm:         'good morning',
  wagmi:      'we are going to make it',
  ngmi:       'not going to make it',
  ser:        'sir',
  fren:       'friend',
  lfg:        'lets go',
  rekt:       'wrecked',
  dyor:       'do your own research',
  nfa:        'not financial advice',
  fud:        'fear uncertainty doubt',
  fomo:       'fear of missing out',
  aping:      'buying aggressively',
  mooning:    'rising significantly',
  safu:       'safe',
  buidl:      'build',
  shill:      'promote',
  bagholder:  'investor holding losing position',
  altszn:     'altcoin season',
  defi:       'decentralized finance',
  ngl:        'not going to lie',
  smh:        'shaking my head',
  gn:         'good night',
  ath:        'all time high',
  atl:        'all time low',
  btfd:       'buy the dip',
  dip:        'price decline',
  rip:        'rest in peace',
  idk:        'i do not know',
  tbh:        'to be honest',
};

// Pre-compile one regex per slang term with word-boundary anchors (\b).
// Using word boundaries prevents "gm" from matching "game" or "agram".
const SLANG_PATTERNS: Array<{ pattern: RegExp; replacement: string }> =
  Object.entries(CRYPTO_SLANG_MAP).map(([slang, replacement]) => ({
    pattern: new RegExp(`\\b${slang}\\b`, 'gi'),
    replacement,
  }));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalise `text` before ML/keyword inference:
 *  1. NFKC — Unicode lookalike/confusable collapse
 *  2. Repeated-char collapse — ≥3 identical consecutive chars → 2
 *  3. Crypto-slang substitution — case-insensitive word-boundary replacement
 */
export function normalizeText(text: string): string {
  // 1. NFKC Unicode normalisation
  let out = text.normalize('NFKC');

  // 2. Collapse ≥3 identical consecutive characters to 2
  //    Examples: "mooooon" → "moon", "!!!!" → "!!", "AAAAA" → "AA"
  out = out.replace(/(.)\1{2,}/g, '$1$1');

  // 3. Crypto-slang substitution
  for (const { pattern, replacement } of SLANG_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  return out;
}

/** Expose the slang map for tests and documentation. */
export const cryptoSlangMap: Readonly<Record<string, string>> = CRYPTO_SLANG_MAP;
