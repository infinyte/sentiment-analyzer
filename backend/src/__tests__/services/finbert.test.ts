import { jest, describe, it, expect, afterEach, beforeEach } from "@jest/globals";
import { FinBertService, finBertService } from "../../services/finbert.js";

function makeOkResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}
function makeErrResponse(status: number): Response {
  return { ok: false, status, json: () => Promise.resolve(null) } as unknown as Response;
}

describe("FinBertService", () => {
  const originalEnv = process.env.FINBERT_API_URL;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env.FINBERT_API_URL = originalEnv;
    jest.restoreAllMocks();
  });

  describe("isAvailable()", () => {
    it("returns false for empty URL", () => {
      expect(new FinBertService("").isAvailable()).toBe(false);
    });
    it("returns false for whitespace URL", () => {
      expect(new FinBertService("   ").isAvailable()).toBe(false);
    });
    it("returns true for valid URL", () => {
      expect(new FinBertService("https://hf.co/finbert").isAvailable()).toBe(true);
    });
    it("reads from FINBERT_API_URL env var", () => {
      process.env.FINBERT_API_URL = "https://some.endpoint/finbert";
      expect(new FinBertService().isAvailable()).toBe(true);
    });
  });

  describe("analyze()", () => {
    it("returns null when not available", async () => {
      expect(await new FinBertService("").analyze("text")).toBeNull();
    });
    it("returns null on non-OK response", async () => {
      mockFetch.mockResolvedValue(makeErrResponse(503));
      expect(await new FinBertService("https://test").analyze("text")).toBeNull();
    });
    it("parses flat array response", async () => {
      mockFetch.mockResolvedValue(makeOkResponse([
        { label: "positive", score: 0.92 },
        { label: "negative", score: 0.05 },
        { label: "neutral",  score: 0.03 },
      ]));
      const result = await new FinBertService("https://test").analyze("BTC moon!");
      expect(result).not.toBeNull();
      expect(result!.label).toBe("positive");
      expect(result!.score).toBeCloseTo(0.92);
    });
    it("parses nested HF pipeline response", async () => {
      mockFetch.mockResolvedValue(makeOkResponse([[
        { label: "negative", score: 0.88 },
        { label: "positive", score: 0.07 },
        { label: "neutral",  score: 0.05 },
      ]]));
      const result = await new FinBertService("https://test").analyze("rug pull scam");
      expect(result).not.toBeNull();
      expect(result!.label).toBe("negative");
      expect(result!.score).toBeCloseTo(0.88);
    });
    it("picks highest-scoring label", async () => {
      mockFetch.mockResolvedValue(makeOkResponse([
        { label: "neutral",  score: 0.10 },
        { label: "negative", score: 0.15 },
        { label: "positive", score: 0.75 },
      ]));
      const result = await new FinBertService("https://test").analyze("ETH bullish");
      expect(result!.label).toBe("positive");
    });
    it("returns null for empty array", async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      expect(await new FinBertService("https://test").analyze("text")).toBeNull();
    });
    it("returns null for unrecognised label", async () => {
      mockFetch.mockResolvedValue(makeOkResponse([{ label: "BULLISH", score: 0.99 }]));
      expect(await new FinBertService("https://test").analyze("text")).toBeNull();
    });
    it("returns null when fetch throws", async () => {
      mockFetch.mockRejectedValue(new Error("network error"));
      expect(await new FinBertService("https://test").analyze("text")).toBeNull();
    });
    it("returns null when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: true, status: 200,
        json: () => Promise.reject(new SyntaxError("bad json")),
      } as unknown as Response);
      expect(await new FinBertService("https://test").analyze("text")).toBeNull();
    });
    it("truncates text to 2048 chars", async () => {
      let capturedBody: string | undefined;
      mockFetch.mockImplementation((_url, init) => {
        capturedBody = (init as RequestInit)?.body as string;
        return Promise.resolve(makeOkResponse([{ label: "neutral", score: 1.0 }]));
      });
      await new FinBertService("https://test").analyze("a".repeat(4000));
      expect(capturedBody).toBeDefined();
      expect((JSON.parse(capturedBody!) as { inputs: string }).inputs.length).toBe(2048);
    });
  });

  describe("toSentimentScore()", () => {
    const svc = new FinBertService("https://test");
    it("positive -> +score", () => expect(svc.toSentimentScore({ label: "positive", score: 0.85 })).toBeCloseTo(0.85));
    it("negative -> -score", () => expect(svc.toSentimentScore({ label: "negative", score: 0.72 })).toBeCloseTo(-0.72));
    it("neutral -> 0",       () => expect(svc.toSentimentScore({ label: "neutral",  score: 0.95 })).toBe(0));
  });

  describe("singleton export", () => {
    it("is a FinBertService instance", () => expect(finBertService).toBeInstanceOf(FinBertService));
    it("isAvailable() returns boolean", () => expect(typeof finBertService.isAvailable()).toBe("boolean"));
  });
});
