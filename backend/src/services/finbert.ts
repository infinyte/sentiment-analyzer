/**
 * FinBertService
 *
 * Wraps the Hugging Face Inference API to run a FinBERT (or any compatible
 * finance/crypto text-classification model) on arbitrary text.
 *
 * Default model endpoint: ProsusAI/finbert (positive / negative / neutral)
 * Configure via: FINBERT_API_URL=https://api-inference.huggingface.co/models/ProsusAI/finbert
 *
 * Returns null when:
 *   - FINBERT_API_URL is not configured
 *   - The request fails or times out
 *   - The response cannot be parsed
 *
 * This lets callers always fall back gracefully to keyword-based scoring.
 */
import { appConfigService } from './app-config-service.js';

export interface FinBertResult {
  /** Model-assigned sentiment label. */
  label: 'positive' | 'neutral' | 'negative';
  /** Model confidence [0, 1]. */
  score: number;
}

// Hugging Face returns either [ [{label, score}] ] or [{label, score}]
interface HFClassificationEntry {
  label: string;
  score: number;
}

export class FinBertService {
  private readonly overrideApiUrl: string | undefined;

  constructor(apiUrl?: string) {
    this.overrideApiUrl = apiUrl?.trim();
  }

  private get apiUrl(): string {
    return this.overrideApiUrl ?? appConfigService.get('FINBERT_API_URL')?.trim() ?? '';
  }

  /** True when FINBERT_API_URL is configured. */
  isAvailable(): boolean {
    return this.apiUrl.length > 0;
  }

  /**
   * Run sentiment classification on the given text.
   * Returns null on any error so callers can fall back without throwing.
   *
   * Text is truncated at 2048 characters (approximate 512-token proxy) to
   * stay within model limits.
   */
  async analyze(text: string): Promise<FinBertResult | null> {
    if (!this.isAvailable()) return null;

    const input = text.slice(0, 2048);

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: input }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as HFClassificationEntry[][] | HFClassificationEntry[];

      // HF wraps in an outer array when called via pipeline endpoint
      const entries: HFClassificationEntry[] = Array.isArray(data[0])
        ? (data as HFClassificationEntry[][])[0]
        : (data as HFClassificationEntry[]);

      if (!entries || entries.length === 0) return null;

      const top = [...entries].sort((a, b) => b.score - a.score)[0];
      const label = top.label.toLowerCase() as FinBertResult['label'];

      if (!['positive', 'neutral', 'negative'].includes(label)) return null;

      return { label, score: top.score };
    } catch {
      return null;
    }
  }

  /**
   * Convert a FinBERT label+score to a raw sentiment value in [-1, 1].
   *   positive → +score  (e.g. 0.92)
   *   negative → -score  (e.g. -0.87)
   *   neutral  → 0
   */
  toSentimentScore(result: FinBertResult): number {
    switch (result.label) {
      case 'positive': return result.score;
      case 'negative': return -result.score;
      default:         return 0;
    }
  }
}

/** Singleton — configured from FINBERT_API_URL environment variable. */
export const finBertService = new FinBertService();
