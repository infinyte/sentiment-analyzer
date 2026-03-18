/**
 * Tests for text-normalizer.ts — Adversarial Robustness Pre-processing (Enhancement #14)
 */
import { describe, it, expect } from '@jest/globals';
import { normalizeText, cryptoSlangMap } from '../../../services/social-media/scoring/text-normalizer.js';

describe('normalizeText — NFKC Unicode normalization', () => {
  it('normalizes fullwidth ASCII letters to regular ASCII', () => {
    // \uFF42\uFF54\uFF43 = fullwidth 'b', 't', 'c'
    const result = normalizeText('\uFF42\uFF54\uFF43');
    expect(result.toLowerCase()).toBe('btc');
  });

  it('normalizes fullwidth uppercase letters', () => {
    // \uFF22\uFF34\uFF23 = fullwidth 'B', 'T', 'C'
    const result = normalizeText('\uFF22\uFF34\uFF23');
    expect(result).toBe('BTC');
  });

  it('normalizes mixed fullwidth and normal ASCII', () => {
    // '\uFF22TC' — fullwidth B + normal TC
    const result = normalizeText('\uFF22TC');
    expect(result).toBe('BTC');
  });
});

describe('normalizeText — repeated character collapsing', () => {
  it('collapses 4+ repeated chars to 2: "mooooon" → "moon"', () => {
    expect(normalizeText('mooooon')).toBe('moon');
  });

  it('collapses exactly 3 repeated chars to 2: "gooo" → "goo"', () => {
    // g + o + o + o = 3 o's => collapses to "goo"
    expect(normalizeText('gooo')).toBe('goo');
  });

  it('collapses "goooood" → "good"', () => {
    expect(normalizeText('goooood')).toBe('good');
  });

  it('does NOT collapse 2 repeated chars: "goo" stays "goo"', () => {
    expect(normalizeText('goo')).toBe('goo');
  });

  it('collapses repeated exclamation marks: "!!!!" → "!!"', () => {
    expect(normalizeText('!!!!')).toBe('!!');
  });

  it('collapses repeated uppercase: "AAAAA" → "AA"', () => {
    expect(normalizeText('AAAAA')).toBe('AA');
  });
});

describe('normalizeText — crypto slang substitution', () => {
  it('replaces "hodl" with "hold"', () => {
    const result = normalizeText('hodl your coins');
    expect(result).toContain('hold');
    expect(result).not.toContain('hodl');
  });

  it('replaces "wen moon" → "when moon"', () => {
    const result = normalizeText('wen moon');
    expect(result).toContain('when');
    expect(result).not.toContain('wen ');
  });

  it('replaces "gm fren" → "good morning friend"', () => {
    const result = normalizeText('gm fren');
    expect(result).toContain('good morning');
    expect(result).toContain('friend');
  });

  it('replaces multiple slang terms in one string', () => {
    const result = normalizeText('hodl and wagmi fren');
    expect(result).toContain('hold');
    expect(result).toContain('we are going to make it');
    expect(result).toContain('friend');
  });

  it('replaces "rekt" with "wrecked"', () => {
    const result = normalizeText('I got rekt');
    expect(result).toContain('wrecked');
  });

  it('replaces "fud" with "fear uncertainty doubt"', () => {
    const result = normalizeText('ignore the fud');
    expect(result).toContain('fear uncertainty doubt');
  });
});

describe('normalizeText — case-insensitive slang', () => {
  it('replaces "HODL" (uppercase) case-insensitively', () => {
    const result = normalizeText('HODL your BTC');
    expect(result.toLowerCase()).toContain('hold');
    expect(result.toLowerCase()).not.toContain('hodl');
  });

  it('replaces "WEN" (uppercase) case-insensitively', () => {
    const result = normalizeText('WEN moon');
    expect(result.toLowerCase()).toContain('when');
  });

  it('replaces mixed-case "HoDl"', () => {
    const result = normalizeText('HoDl forever');
    expect(result.toLowerCase()).toContain('hold');
    expect(result.toLowerCase()).not.toContain('hodl');
  });
});

describe('normalizeText — clean text passthrough', () => {
  it('does not alter normal English text', () => {
    const text = 'Bitcoin is trading higher today';
    expect(normalizeText(text)).toBe(text);
  });

  it('does not alter text with no slang or repeated chars', () => {
    const text = 'The market looks stable and healthy';
    expect(normalizeText(text)).toBe(text);
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
});

describe('normalizeText — combined transformations', () => {
  it('"mooooon and hodl!!!" → "moon and hold!!"', () => {
    const result = normalizeText('mooooon and hodl!!!');
    expect(result).toContain('moon');
    expect(result).toContain('hold');
    expect(result).toContain('!!');
    expect(result).not.toContain('mooooon');
    expect(result).not.toContain('hodl');
    expect(result).not.toContain('!!!');
  });

  it('handles fullwidth chars + slang together', () => {
    // fullwidth 'hodl' using fullwidth h-o-d-l
    // \uFF48\uFF4F\uFF44\uFF4C = fullwidth 'h','o','d','l'
    const fullwidthHodl = '\uFF48\uFF4F\uFF44\uFF4C';
    const result = normalizeText(fullwidthHodl);
    // After NFKC, becomes 'hodl'; after slang replacement, becomes 'hold'
    expect(result.toLowerCase()).toContain('hold');
  });
});

describe('normalizeText — performance benchmark', () => {
  it('completes 1000 calls in under 5000ms (< 5ms per call)', () => {
    const sampleText = 'HODL your mooooon bags fren, wagmi!! gm to all the rekt bagholder out there!!!';
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      normalizeText(sampleText);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('cryptoSlangMap export', () => {
  it('exports the slang map as a readonly record', () => {
    expect(typeof cryptoSlangMap).toBe('object');
    expect(cryptoSlangMap).not.toBeNull();
  });

  it('contains expected key-value pairs', () => {
    expect(cryptoSlangMap['hodl']).toBe('hold');
    expect(cryptoSlangMap['wen']).toBe('when');
    expect(cryptoSlangMap['gm']).toBe('good morning');
    expect(cryptoSlangMap['wagmi']).toBe('we are going to make it');
    expect(cryptoSlangMap['ngmi']).toBe('not going to make it');
  });

  it('has more than 10 entries', () => {
    expect(Object.keys(cryptoSlangMap).length).toBeGreaterThan(10);
  });
});
