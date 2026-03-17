/**
 * Sarcasm / Irony Detector
 *
 * Applies lightweight heuristic rules to flag text that may be sarcastic or
 * ironic.  The result includes a confidence score [0, 1] and the list of
 * matched reasons so callers can choose their own threshold.
 *
 * This is intentionally a heuristic approach (no ML required) so it works
 * without any external service.  It is tuned for crypto social-media text.
 *
 * Confidence thresholds used downstream:
 *   >= 0.34  → sarcasm_flagged = true   (at least one clear signal)
 *   >= 0.67  → strong enough to invert sentiment in the scoring pipeline
 */

export interface SarcasmResult {
  /** True when at least one sarcasm signal was detected. */
  sarcastic: boolean;
  /** Proportion of max signals fired — [0, 1]; increases with more evidence. */
  confidence: number;
  /** Human-readable labels for each matched rule. */
  reasons: string[];
}

// ── Rule constants ─────────────────────────────────────────────────────────────

const SARCASM_PHRASES = [
  '/s', '(/s)', 'yeah right', 'sure...', 'oh wow', 'wow much',
  'totally normal', 'great job everyone', 'this is fine',
];

const IRONY_EMOJI_REGEX = /🙄|😂|🤣|🤦|🫠/u;

const EXCESSIVE_PUNCT_REGEX = /(!{3,}|\?{3,})/;

/** Positive sentiment words that rarely appear sincere next to negative context. */
const POSITIVE_WORDS = [
  'great', 'amazing', 'wonderful', 'excellent', 'fantastic',
  'perfect', 'brilliant', 'love', 'awesome', 'incredible',
];

/** Negation prefixes. Space suffix on multi-word forms prevents partial matches. */
const NEGATIONS = ["not ", "n't ", "never ", "no "];

/** Bear-market terms whose co-occurrence with positive words suggests mockery. */
const BEAR_TERMS = [
  'crash', 'dump', 'scam', 'fraud', 'rug', 'hack', 'rekt',
  'liquidat', 'collapse', 'exit', 'ponzi',
];

const SARCASTIC_STARTERS = ['wow', 'nice', 'good job', 'lol', 'congrats', 'brilliant'];

/** Well-known crypto acronyms to exclude from the all-caps rule. */
const CRYPTO_ACRONYMS = new Set([
  'BTC', 'ETH', 'USD', 'NFT', 'DeFi', 'HODL', 'FOMO', 'ATH', 'ATL',
  'ROI', 'APY', 'APR', 'DCA', 'CEX', 'DEX', 'DAO', 'L1', 'L2', 'ICO',
  'IDO', 'POS', 'POW', 'USDT', 'USDC', 'XRP', 'ADA', 'SOL', 'BNB',
  'NEAR', 'MATIC', 'DOT', 'LINK', 'AVAX', 'UNI', 'AAVE', 'LTC',
]);

const ALL_CAPS_REGEX = /\b[A-Z]{4,}\b/g;

// ── Detector ───────────────────────────────────────────────────────────────────

/**
 * Assign a sarcasm confidence score to `text`.
 * Max 3 independent signals are modelled; confidence = reasons ÷ 3.
 */
export function detectSarcasm(text: string): SarcasmResult {
  const lower = text.toLowerCase();
  const reasons: string[] = [];

  // ── Rule 1: Explicit sarcasm markers (/s, "yeah right", etc.) ──────────────
  for (const phrase of SARCASM_PHRASES) {
    if (lower.includes(phrase)) {
      reasons.push(`explicit marker ("${phrase}")`);
      break; // one match is enough for this rule
    }
  }

  // ── Rule 2: Irony emoji ────────────────────────────────────────────────────
  if (IRONY_EMOJI_REGEX.test(text)) {
    reasons.push('irony emoji');
  }

  // ── Rule 3: Negated positive (e.g. "not great", "never amazing") ───────────
  let negatedPositiveFound = false;
  outer: for (const neg of NEGATIONS) {
    for (const pos of POSITIVE_WORDS) {
      if (lower.includes(neg + pos)) {
        reasons.push(`negated positive ("${neg.trim()} ${pos}")`);
        negatedPositiveFound = true;
        break outer;
      }
    }
  }

  // ── Rule 4: Sarcastic starter + bear term ─────────────────────────────────
  if (!negatedPositiveFound) {
    const hasSarcasticStarter = SARCASTIC_STARTERS.some(s => lower.includes(s));
    const hasBearTerm = BEAR_TERMS.some(t => lower.includes(t));
    if (hasSarcasticStarter && hasBearTerm) {
      reasons.push('positive framing with negative context');
    }
  }

  // ── Rule 5: Excessive punctuation (!!!! or ????) ───────────────────────────
  if (EXCESSIVE_PUNCT_REGEX.test(text)) {
    reasons.push('excessive punctuation');
  }

  // ── Rule 6: Multiple non-acronym all-caps words ───────────────────────────
  const capsMatches = text.match(ALL_CAPS_REGEX) ?? [];
  const realCapsWords = capsMatches.filter(w => !CRYPTO_ACRONYMS.has(w));
  if (realCapsWords.length >= 2) {
    reasons.push(`all-caps: ${realCapsWords.slice(0, 3).join(', ')}`);
  }

  // Confidence: 1 reason → 0.33, 2 → 0.67, 3+ → 1.0
  const confidence = Math.min(reasons.length / 3, 1);

  return {
    sarcastic: reasons.length >= 1,
    confidence,
    reasons,
  };
}
