import { detectSarcasm } from '../../../services/social-media/scoring/sarcasm-detector.js';

describe('detectSarcasm()', () => {

  // ── Rule 1: Explicit sarcasm markers ──────────────────────────────────────

  it('detects /s marker', () => {
    const result = detectSarcasm('Bitcoin is totally going to 100k /s');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('explicit marker'))).toBe(true);
  });

  it('detects "yeah right" phrase', () => {
    const result = detectSarcasm('Yeah right, another all-time high incoming');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('explicit marker'))).toBe(true);
  });

  it('detects "this is fine" phrase', () => {
    const result = detectSarcasm('Exchange just got hacked for $500M. This is fine.');
    expect(result.sarcastic).toBe(true);
  });

  // ── Rule 2: Irony emoji ───────────────────────────────────────────────────

  it('detects eye-roll emoji 🙄 as irony signal', () => {
    const result = detectSarcasm('Oh sure, the SEC will approve it 🙄');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('irony emoji'))).toBe(true);
  });

  it('detects facepalm emoji 🤦 as irony signal', () => {
    const result = detectSarcasm('Another rug pull 🤦 who saw this coming');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('irony emoji'))).toBe(true);
  });

  // ── Rule 3: Negated positive ──────────────────────────────────────────────

  it('detects "not great" as negated positive', () => {
    const result = detectSarcasm('The price action is not great right now');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('negated positive'))).toBe(true);
  });

  it('detects "never amazing" as negated positive', () => {
    const result = detectSarcasm('This project is never amazing when you need it');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('negated positive'))).toBe(true);
  });

  it("detects \"n't perfect\" as negated positive", () => {
    const result = detectSarcasm("This system isn't perfect, it collapses under any load");
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('negated positive'))).toBe(true);
  });

  // ── Rule 4: Sarcastic starter + bear term ────────────────────────────────

  it('detects "wow" + "crash" as positive framing with negative context', () => {
    const result = detectSarcasm('Wow what a crash, really impressive');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('positive framing'))).toBe(true);
  });

  it('detects "nice" + "rug" as positive framing with negative context', () => {
    const result = detectSarcasm('Nice rug pull by the devs again');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('positive framing'))).toBe(true);
  });

  // ── Rule 5: Excessive punctuation ────────────────────────────────────────

  it('detects triple exclamation !!! as excessive punctuation', () => {
    const result = detectSarcasm('Great investment!!! lost 90% already');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('excessive punctuation'))).toBe(true);
  });

  it('detects triple question ??? as excessive punctuation', () => {
    const result = detectSarcasm('Who could have predicted this??? definitely not me');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('excessive punctuation'))).toBe(true);
  });

  // ── Rule 6: Multiple non-acronym all-caps words ───────────────────────────

  it('detects two all-caps non-acronym words', () => {
    const result = detectSarcasm('TOTALLY NORMAL market behaviour here');
    expect(result.sarcastic).toBe(true);
    expect(result.reasons.some(r => r.includes('all-caps'))).toBe(true);
  });

  it('does NOT flag BTC and ETH all-caps as sarcasm signal', () => {
    // BTC and ETH are in the CRYPTO_ACRONYMS exclusion list
    const result = detectSarcasm('BTC and ETH are both up today');
    // Should have no all-caps reason (only 2 words, both excluded)
    expect(result.reasons.some(r => r.includes('all-caps'))).toBe(false);
  });

  it('does NOT flag a single non-acronym all-caps word (requires 2+)', () => {
    const result = detectSarcasm('MOON is coming for BTC');
    // Only one non-acronym caps word (MOON); BTC is excluded
    expect(result.reasons.some(r => r.includes('all-caps'))).toBe(false);
  });

  it('excludes HODL and FOMO from all-caps rule', () => {
    const result = detectSarcasm('HODL is the strategy, FOMO will get you rekt');
    // HODL and FOMO are both in exclusion set
    expect(result.reasons.some(r => r.includes('all-caps'))).toBe(false);
  });

  // ── Genuine positive text ─────────────────────────────────────────────────

  it('returns sarcastic: false for plainly bullish text with no signals', () => {
    const result = detectSarcasm('Bitcoin just broke above resistance. Looking very strong for Q4.');
    expect(result.sarcastic).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns sarcastic: false for a neutral factual statement', () => {
    const result = detectSarcasm('The Fed announced interest rate decisions today affecting markets.');
    expect(result.sarcastic).toBe(false);
  });

  // ── Confidence scaling ────────────────────────────────────────────────────

  it('confidence is ~0.33 when only one rule fires', () => {
    // Only irony emoji, no other signals
    const result = detectSarcasm('Good news today 🙄');
    expect(result.confidence).toBeCloseTo(1 / 3, 1);
  });

  it('confidence is ~0.67 when two rules fire', () => {
    // irony emoji + excessive punctuation
    const result = detectSarcasm('Wow great news!!! 🙄');
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.confidence).toBeGreaterThanOrEqual(2 / 3 - 0.01);
  });

  it('confidence caps at 1.0 when three or more rules fire', () => {
    // /s marker + irony emoji + excessive punctuation
    const result = detectSarcasm('This is fine 🙄 /s !!!');
    expect(result.confidence).toBe(1.0);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles empty string without throwing', () => {
    expect(() => detectSarcasm('')).not.toThrow();
    const result = detectSarcasm('');
    expect(result.sarcastic).toBe(false);
  });

  it('handles very long text without throwing', () => {
    const longText = 'Bitcoin is going up. '.repeat(200);
    expect(() => detectSarcasm(longText)).not.toThrow();
  });
});
