import type {
  ScoredSentimentItem,
  Sentiment,
  SentimentCollectionStats,
  SentimentSourceBreakdown,
} from '../types.js';
import logger from '../logger.js';

interface SentimentAnalysisContext {
  aggregateScore?: number;
  scoredItems?: ScoredSentimentItem[];
  sourceBreakdown?: SentimentSourceBreakdown[];
  collectionStats?: SentimentCollectionStats;
}

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
    volatility: number,
    context?: SentimentAnalysisContext
  ): Promise<Sentiment> {
    const buildLocalFallback = (): Sentiment => {
      const scoredItems = context?.scoredItems ?? [];
      const aggregateScore = context?.aggregateScore ?? 0;
      const momentumBias = priceChange7d >= 4 ? 1 : priceChange7d <= -4 ? -1 : 0;
      const bias = Math.abs(aggregateScore) >= 0.1 ? Math.sign(aggregateScore) : momentumBias;

      const sentiment_score = bias > 0 ? 'BULL' : bias < 0 ? 'BEAR' : 'NEUTRAL';
      const confidenceBase = 0.3 + Math.min(Math.abs(priceChange7d) / 20, 0.2) + Math.min(Math.abs(aggregateScore) * 0.4, 0.25) + Math.min(scoredItems.length / 20, 0.15);
      const confidence = Number(Math.min(0.75, confidenceBase).toFixed(2));
      const positiveDrivers = scoredItems
        .filter(item => item.weighted_score > 0)
        .slice(0, 2)
        .map(item => item.title);
      const negativeDrivers = scoredItems
        .filter(item => item.weighted_score < 0)
        .slice(0, 2)
        .map(item => item.title);
      const sourceLabels = Array.from(new Set(scoredItems.map(item => item.source_label))).slice(0, 3);
      const sourceText = sourceLabels.length > 0 ? ` across ${sourceLabels.join(', ')}` : '';
      const summary = sentiment_score === 'BULL'
        ? `${symbol} is showing bullish signals from recent market momentum${headlines.length ? ' and scored content activity' : ''}${sourceText}.`
        : sentiment_score === 'BEAR'
          ? `${symbol} is showing bearish pressure from recent market weakness${headlines.length ? ' and negative scored content flow' : ''}${sourceText}.`
          : `${symbol} sentiment is neutral based on current price action${headlines.length ? ' and mixed scored content' : ''}${sourceText}.`;

      return {
        symbol,
        analysis_date: new Date().toISOString().split('T')[0],
        sentiment_score,
        confidence,
        summary,
        key_catalysts: positiveDrivers.length > 0 ? positiveDrivers : headlines.slice(0, 2),
        risk_factors: negativeDrivers.length > 0 ? negativeDrivers : volatility >= 8 ? ['Elevated short-term volatility'] : [],
        short_term_outlook: sentiment_score === 'BULL'
          ? 'Near-term momentum remains constructive, but confirmation is limited.'
          : sentiment_score === 'BEAR'
            ? 'Near-term risk remains skewed to the downside until momentum improves.'
            : 'Near-term direction is unclear and likely range-bound without stronger catalysts.',
        volatility_warning: volatility >= 8,
        trending_score: context?.collectionStats?.trending_score ?? 0,
        scored_items: scoredItems,
        source_breakdown: context?.sourceBreakdown ?? [],
        collection_stats: context?.collectionStats,
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
      scored_items: context?.scoredItems ?? [],
      source_breakdown: context?.sourceBreakdown ?? [],
      collection_stats: context?.collectionStats,
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
          trending_score: context?.collectionStats?.trending_score ?? 0,
          scored_items: context?.scoredItems ?? [],
          source_breakdown: context?.sourceBreakdown ?? [],
          collection_stats: context?.collectionStats,
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
