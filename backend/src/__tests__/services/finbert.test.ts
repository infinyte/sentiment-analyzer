import { FinBertService, finBertService } from '../../services/finbert.js';

// ── fetch response helpers ─────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return { ok: true, status: 200, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

function makeErrResponse(status: number) {
  return { ok: false, status, json: jest.fn() } as unknown as Response;
}

// ── FinBertService ─────────────────────────────────────────────────────────────

describe('FinBertService', () => {
  const originalEnv = process.env.FINBERT_API_URL;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env.FINBERT_API_URL = originalEnv;
    jest.restoreAllMocks();
  });

  // ── isAvailable() ────────────────────────────────────────────────────────────

  describe('isAvailable()', () => {
    it('returns false when constructed with empty URL', () => {
      const svc = new FinBertService('');
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns false when constructed with whitespace-only URL', () => {
      const svc = new FinBertService('   ');
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns true when constructed with a valid URL', () => {
      const svc = new FinBertService('https://api-inference.huggingface.co/models/ProsusAI/finbert');
      expect(svc.isAvailable()).toBe(true);
    });

    it('reads FINBERT_API_URL from environment when no constructor arg given', () => {
      process.env.FINBERT_API_URL = 'https://some.endpoint/finbert';
      const svc = new FinBertService();
      expect(svc.isAvailable()).toBe(true);
    });
  });

  // ── analyze() ────────────────────────────────────────────────────────────────

  describe('analyze()', () => {
    it('returns null immediately when not available', async () => {
      const svc = new FinBertService('');
      const result = await svc.analyze('Bitcoin is doing great');
      expect(result).toBeNull();
    });

    it('returns null when the HTTP response is not OK', async () => {
      mockFetch.mockResolvedValue(makeErrResponse(503));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Some text');
      expect(result).toBeNull();
    });

    it('parses a flat array response [{ label, score }]', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([
        { label: 'positive', score: 0.92 },
        { label: 'negative', score: 0.05 },
        { label: 'neutral',  score: 0.03 },
      ]));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Bitcoin to the moon!');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('positive');
      expect(result!.score).toBeCloseTo(0.92);
    });

    it('parses a nested array response [[{ label, score }]] (HF pipeline format)', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([[
        { label: 'negative', score: 0.88 },
        { label: 'positive', score: 0.07 },
        { label: 'neutral',  score: 0.05 },
      ]]));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('This is a total rug pull scam');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('negative');
      expect(result!.score).toBeCloseTo(0.88);
    });

    it('returns the highest-scoring label when scores are reordered', async () => {
      // Entries arrive in non-descending score order
      mockFetch.mockResolvedValue(makeOkResponse([
        { label: 'neutral',  score: 0.10 },
        { label: 'negative', score: 0.15 },
        { label: 'positive', score: 0.75 },
      ]));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Very bullish on ETH');
      expect(result!.label).toBe('positive');
    });

    it('returns null when response is an empty array', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Any text');
      expect(result).toBeNull();
    });

    it('returns null when top entry has an unrecognised label', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([{ label: 'BULLISH', score: 0.99 }]));
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Any text');
      expect(result).toBeNull();
    });

    it('returns null when fetch throws (network error / timeout)', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      mockFetch.mockRejectedValue(abortErr);
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Any text');
      expect(result).toBeNull();
    });

    it('returns null when JSON parsing fails', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response);
      const svc = new FinBertService('https://test.endpoint/model');
      const result = await svc.analyze('Any text');
      expect(result).toBeNull();
    });

    it('truncates text to 2048 characters before sending', async () => {
      let capturedBody: string | undefined;
      mockFetch.mockImplementation((_url: unknown, init: unknown) => {
        capturedBody = (init as { body?: string })?.body;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ label: 'neutral', score: 1.0 }]),
        } as unknown as Response);
      });

      const longText = 'a'.repeat(4000);
      const svc = new FinBertService('https://test.endpoint/model');
      await svc.analyze(longText);

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!) as { inputs: string };
      expect(parsed.inputs.length).toBe(2048);
    });
  });

  // ── toSentimentScore() ───────────────────────────────────────────────────────

  describe('toSentimentScore()', () => {
    const svc = new FinBertService('https://test.endpoint/model');

    it('maps positive label to +score', () => {
      expect(svc.toSentimentScore({ label: 'positive', score: 0.85 })).toBeCloseTo(0.85);
    });

    it('maps negative label to -score', () => {
      expect(svc.toSentimentScore({ label: 'negative', score: 0.72 })).toBeCloseTo(-0.72);
    });

    it('maps neutral label to 0', () => {
      expect(svc.toSentimentScore({ label: 'neutral', score: 0.95 })).toBe(0);
    });

    it('maps negative with score 1.0 to -1', () => {
      expect(svc.toSentimentScore({ label: 'negative', score: 1.0 })).toBeCloseTo(-1.0);
    });
  });

  // ── Singleton ────────────────────────────────────────────────────────────────

  describe('singleton export', () => {
    it('exports finBertService as a FinBertService instance', () => {
      expect(finBertService).toBeInstanceOf(FinBertService);
    });

    it('singleton availability reflects FINBERT_API_URL at import time', () => {
      // The singleton reads env at construction; just verify the instance method works
      expect(typeof finBertService.isAvailable()).toBe('boolean');
    });
  });
});
