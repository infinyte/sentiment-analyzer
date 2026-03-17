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
    const buildLocalFallback = (): Sentiment => {
      const positiveTerms = ['surge', 'rally', 'gain', 'bull', 'breakout', 'approval', 'adoption', 'record', 'high'];
      const negativeTerms = ['drop', 'sell-off', 'bear', 'hack', 'lawsuit', 'ban', 'liquidation', 'outflow', 'loss'];
      const headlineText = headlines.join(' ').toLowerCase();
      const positiveHits = positiveTerms.filter(term => headlineText.includes(term)).length;
      const negativeHits = negativeTerms.filter(term => headlineText.includes(term)).length;
      const momentumBias = priceChange7d >= 4 ? 1 : priceChange7d <= -4 ? -1 : 0;
      const headlineBias = positiveHits > negativeHits ? 1 : negativeHits > positiveHits ? -1 : 0;
      const bias = headlineBias !== 0 ? headlineBias : momentumBias;

      const sentiment_score = bias > 0 ? 'BULL' : bias < 0 ? 'BEAR' : 'NEUTRAL';
      const confidenceBase = 0.35 + Math.min(Math.abs(priceChange7d) / 20, 0.25) + Math.min(headlines.length / 20, 0.15);
      const confidence = Number(Math.min(0.75, confidenceBase).toFixed(2));
      const summary = sentiment_score === 'BULL'
        ? `${symbol} is showing bullish signals from recent market momentum${headlines.length ? ' and headline activity' : ''}.`
        : sentiment_score === 'BEAR'
          ? `${symbol} is showing bearish pressure from recent market weakness${headlines.length ? ' and negative headline flow' : ''}.`
          : `${symbol} sentiment is neutral based on the current price action${headlines.length ? ' and limited headline conviction' : ''}.`;

      return {
        symbol,
        analysis_date: new Date().toISOString().split('T')[0],
        sentiment_score,
        confidence,
        summary,
        key_catalysts: headlines.slice(0, 2),
        risk_factors: volatility >= 8 ? ['Elevated short-term volatility'] : [],
        short_term_outlook: sentiment_score === 'BULL'
          ? 'Near-term momentum remains constructive, but confirmation is limited.'
          : sentiment_score === 'BEAR'
            ? 'Near-term risk remains skewed to the downside until momentum improves.'
            : 'Near-term direction is unclear and likely range-bound without stronger catalysts.',
        volatility_warning: volatility >= 8,
        trending_score: 0,
      };
    };

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
        return buildLocalFallback();
      }
    } catch (error) {
      logger.error('sentiment analysis error', { symbol, error: String(error) });
      return buildLocalFallback();
    }
  }
}
