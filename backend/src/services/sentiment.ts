import type { Sentiment } from '../types.js';
import logger from '../logger.js';

export class SentimentService {
  private apiKey: string;
  private apiUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.CLAUDE_API_KEY ?? '';
  }

  async analyzeSentiment(
    symbol: string,
    headlines: string[],
    priceChange7d: number,
    volatility: number
  ): Promise<Sentiment> {
    const neutralDefault = (summary: string): Sentiment => ({
      symbol,
      analysis_date: new Date().toISOString().split('T')[0],
      sentiment_score: 'NEUTRAL',
      confidence: 0,
      summary,
      key_catalysts: [],
      risk_factors: [],
      short_term_outlook: '',
      volatility_warning: false,
      trending_score: 0,
    });

    try {
      const prompt = `You are a crypto market analyst. Analyze sentiment for ${symbol}.

HEADLINES (past 7 days):
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}

MARKET DATA:
- Price change (7d): ${priceChange7d.toFixed(2)}%
- Volatility (24h): ${volatility.toFixed(2)}%

Respond with ONLY this JSON (no markdown, no explanation):
{
  "sentiment_score": "BULL" | "NEUTRAL" | "BEAR",
  "confidence": 0.5,
  "summary": "Brief 1-2 sentence summary",
  "key_catalysts": ["positive factor 1", "positive factor 2"],
  "risk_factors": ["risk 1", "risk 2"],
  "short_term_outlook": "1-2 sentence forecast",
  "volatility_warning": false
}`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

      const data = (await response.json()) as any;
      const content = data.content[0].text;

      try {
        const analysis = JSON.parse(content);
        return {
          symbol,
          analysis_date: new Date().toISOString().split('T')[0],
          sentiment_score: analysis.sentiment_score,
          confidence: analysis.confidence,
          summary: analysis.summary,
          key_catalysts: analysis.key_catalysts,
          risk_factors: analysis.risk_factors,
          short_term_outlook: analysis.short_term_outlook,
          volatility_warning: analysis.volatility_warning,
          trending_score: 0,
        };
      } catch {
        logger.error('claude parse failed', { symbol, content });
        return neutralDefault('Analysis failed');
      }
    } catch (error) {
      logger.error('sentiment analysis error', { symbol, error: String(error) });
      return neutralDefault('Error during analysis');
    }
  }
}
