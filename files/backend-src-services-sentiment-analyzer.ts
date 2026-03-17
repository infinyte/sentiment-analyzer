SENTIMENT ANALYZER ENGINE
========================

File: backend/src/services/sentiment-analyzer.ts

This is the brain of the application. It:
1. Takes raw market data + headlines
2. Generates sentiment using Claude API
3. Produces trading signals
4. Creates smart composite scores
5. Ranks coins for different timeframes

---

SENTIMENT MODES
===============

Mode 1: BASIC
Input: Coin symbol, headlines
Output: { score: "BULL|NEUTRAL|BEAR", confidence: 0-1 }

Mode 2: ADVANCED
Input: Sentiment + volatility + volume + momentum + technical
Output: { score: "BULL|NEUTRAL|BEAR", confidence: 0-1, analysis: {...} }

Mode 3: TRADING_SIGNALS
Input: All advanced inputs
Output: { signal: "BUY|SELL|HOLD", strength: 0-100, target_price: number }

Mode 4: SMART (Adaptive)
Input: Coin + available data
Output: Dynamically combines 1-3 based on data richness + market conditions


---

IMPLEMENTATION
===============

import Anthropic from "@anthropic-ai/sdk";

interface MarketData {
  symbol: string;
  name: string;
  current_price: number;
  price_24h_change: number;
  price_7d_change: number;
  volatility_24h: number;
  volatility_7d: number;
  volume_24h: number;
  volume_change_24h: number;
  market_cap_rank: number;
}

interface NewsData {
  headlines: string[];
  sentiment_by_source: { [source: string]: string };
  recency_score: number; // 0-1, how recent are headlines
}

interface TechnicalData {
  rsi_14: number; // Relative Strength Index
  macd: { value: number; signal: number; histogram: number };
  moving_average_20: number;
  moving_average_50: number;
  supports: number[];
  resistances: number[];
}

// ========================================
// SENTIMENT ANALYSIS ENGINE
// ========================================

export class SentimentAnalyzerEngine {
  private client: Anthropic;
  private model = "claude-opus-4-1-20250805";

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    });
  }

  // MODE 1: BASIC SENTIMENT
  async analyzeBasicSentiment(
    symbol: string,
    headlines: string[]
  ): Promise<BasicSentiment> {
    const prompt = `
You are a crypto sentiment analyst. Analyze the sentiment for ${symbol}.

Headlines (last 7 days):
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Provide ONLY a JSON response with:
- sentiment_score: "BULL" | "NEUTRAL" | "BEAR"
- confidence: 0.0-1.0

Response format:
{
  "sentiment_score": "BULL",
  "confidence": 0.87
}
    `;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return {
      sentiment_score: result.sentiment_score,
      confidence: result.confidence,
      mode: "BASIC",
      timestamp: new Date(),
    };
  }

  // MODE 2: ADVANCED SENTIMENT
  async analyzeAdvancedSentiment(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData
  ): Promise<AdvancedSentiment> {
    const volatilityScore = this.calculateVolatilityScore(market);
    const volumeScore = this.calculateVolumeScore(market);
    const momentumScore = this.calculateMomentumScore(market);
    const technicalScore = technical ? this.calculateTechnicalScore(technical) : 0.5;

    const prompt = `
You are a crypto sentiment analyst specializing in ${market.name} (${market.symbol}).

MARKET DATA:
- Current Price: $${market.current_price}
- 24h Change: ${market.price_24h_change}%
- 7d Change: ${market.price_7d_change}%
- 24h Volatility: ${market.volatility_24h}%
- 7d Volatility: ${market.volatility_7d}%
- Volume Change 24h: ${market.volume_change_24h}%
- Market Cap Rank: #${market.market_cap_rank}

HEADLINES (Last 7 Days):
${news.headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join("\n")}

TECHNICAL ANALYSIS:
- RSI 14: ${technical?.rsi_14 || "N/A"}
- MACD: ${technical?.macd ? `Value: ${technical.macd.value.toFixed(2)}, Signal: ${technical.macd.signal.toFixed(2)}` : "N/A"}
- MA20/MA50: ${technical?.moving_average_20 ? `20: $${technical.moving_average_20.toFixed(2)}, 50: $${technical.moving_average_50.toFixed(2)}` : "N/A"}

Analyze the OVERALL sentiment considering ALL factors.

Response JSON:
{
  "sentiment_score": "BULL|NEUTRAL|BEAR",
  "confidence": 0.0-1.0,
  "key_drivers": ["reason1", "reason2", "reason3"],
  "risk_factors": ["risk1", "risk2"],
  "volatility_assessment": "HIGH|MEDIUM|LOW",
  "volume_signal": "STRONG|NORMAL|WEAK",
  "technical_outlook": "BULLISH|NEUTRAL|BEARISH",
  "short_term_trend": "UP|DOWN|SIDEWAYS",
  "recommended_hold_period": "hours|days|weeks"
}
    `;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return {
      sentiment_score: result.sentiment_score,
      confidence: result.confidence,
      key_drivers: result.key_drivers,
      risk_factors: result.risk_factors,
      volatility_assessment: result.volatility_assessment,
      volume_signal: result.volume_signal,
      technical_outlook: result.technical_outlook,
      short_term_trend: result.short_term_trend,
      recommended_hold_period: result.recommended_hold_period,
      mode: "ADVANCED",
      timestamp: new Date(),
    };
  }

  // MODE 3: TRADING SIGNALS
  async generateTradingSignals(
    market: MarketData,
    news: NewsData,
    sentiment: AdvancedSentiment,
    technical?: TechnicalData
  ): Promise<TradingSignal> {
    const prompt = `
You are a professional crypto trader analyzing ${market.symbol}.

CURRENT SENTIMENT ANALYSIS:
- Sentiment: ${sentiment.sentiment_score}
- Confidence: ${sentiment.confidence}
- Volatility: ${sentiment.volatility_assessment}
- Technical Outlook: ${sentiment.technical_outlook}
- Risk Factors: ${sentiment.risk_factors.join(", ")}

MARKET CONDITIONS:
- Price Movement (7d): ${market.price_7d_change}%
- Current Volatility: ${market.volatility_7d}%
- Volume Trend: ${market.volume_change_24h}%

Generate a SPECIFIC trading signal with target prices and position sizing.

Response JSON:
{
  "signal": "BUY|SELL|HOLD",
  "strength": 0-100,
  "entry_price": ${market.current_price},
  "target_price_short": <price for 1-3 day target>,
  "target_price_medium": <price for 3-7 day target>,
  "stop_loss": <price for stop loss>,
  "expected_roi_pct": <expected return %>,
  "risk_reward_ratio": <risk:reward>,
  "position_size_pct": 0-100,
  "confidence": 0-1,
  "reasoning": "Explanation of signal"
}
    `;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return {
      signal: result.signal,
      strength: result.strength,
      entry_price: result.entry_price,
      target_price_short: result.target_price_short,
      target_price_medium: result.target_price_medium,
      stop_loss: result.stop_loss,
      expected_roi_pct: result.expected_roi_pct,
      risk_reward_ratio: result.risk_reward_ratio,
      position_size_pct: result.position_size_pct,
      confidence: result.confidence,
      reasoning: result.reasoning,
      mode: "TRADING_SIGNALS",
      timestamp: new Date(),
    };
  }

  // MODE 4: SMART ADAPTIVE SENTIMENT
  async analyzeSmartSentiment(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData
  ): Promise<SmartSentiment> {
    // Determine data richness
    const hasHeadlines = news.headlines.length > 0;
    const hasVolatility = market.volatility_24h && market.volatility_7d;
    const hasVolume = market.volume_24h && market.volume_change_24h;
    const hasMomentum = market.price_7d_change !== undefined;
    const hasTechnical = technical !== undefined;
    const hasRecency = news.recency_score !== undefined;

    // Decision tree: which factors to combine?
    const selectedFactors = [
      "Sentiment strength (bullish/bearish intensity)" as const,
      ...(hasVolatility ? (["Volatility (24h and 7d)"] as const) : []),
      ...(hasVolume ? (["Trading volume trend"] as const) : []),
      ...(hasMomentum ? (["Price momentum (7d change %)"] as const) : []),
      ...(hasRecency ? (["Headline recency/freshness"] as const) : []),
      ...(hasTechnical ? (["Technical indicators (if available)"] as const) : []),
    ];

    // Generate smart analysis
    const prompt = `
You are an expert crypto analyst. Create a SMART composite sentiment analysis for ${market.symbol}.

COMBINE THESE FACTORS INTELLIGENTLY:
${selectedFactors.map((f) => `- ${f}`).join("\n")}

FACTOR VALUES:
- Sentiment from Headlines: [Analyze headlines]
- Volatility (24h/7d): ${market.volatility_24h}% / ${market.volatility_7d}%
- Volume Trend: ${market.volume_change_24h}% change
- Price Momentum (7d): ${market.price_7d_change}%
- Headline Recency: ${news.recency_score || "Unknown"}
${hasTechnical ? `- Technical (RSI: ${technical?.rsi_14})` : ""}

Headlines:
${news.headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join("\n")}

Create a composite score by weighting these factors appropriately.
Higher weight on recency + volatility + momentum when combined.
Lower weight on individual sentiment if technical contradicts.

Response JSON:
{
  "composite_score": 0-100,
  "sentiment": "BULL|NEUTRAL|BEAR",
  "confidence": 0-1,
  "factor_weights": {
    "sentiment_strength": 0-1,
    "volatility": 0-1,
    "volume_trend": 0-1,
    "momentum": 0-1,
    "headline_recency": 0-1,
    "technical": 0-1
  },
  "weighted_factors": {
    "sentiment_strength": <value 0-1>,
    "volatility": <value 0-1>,
    "volume_trend": <value 0-1>,
    "momentum": <value 0-1>,
    "headline_recency": <value 0-1>,
    "technical": <value 0-1>
  },
  "explanation": "How these factors combined to create the score",
  "dominant_factor": "Which factor had most influence",
  "contradictions": "Any factors that contradict the main sentiment"
}
    `;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text);

    return {
      composite_score: result.composite_score,
      sentiment: result.sentiment,
      confidence: result.confidence,
      factor_weights: result.factor_weights,
      weighted_factors: result.weighted_factors,
      explanation: result.explanation,
      dominant_factor: result.dominant_factor,
      contradictions: result.contradictions,
      selected_factors: selectedFactors,
      mode: "SMART",
      timestamp: new Date(),
    };
  }

  // ========================================
  // RANKING SYSTEM (for 1/3/5 day predictions)
  // ========================================

  async rankCoinsForTimeframe(
    coins: (MarketData & { sentiment: AdvancedSentiment; signal: TradingSignal })[]
  ): Promise<RankedCoin[]> {
    // Calculate composite score for each coin
    const scores = coins.map((coin) => {
      const sentimentMultiplier = coin.sentiment.sentiment_score === "BULL" ? 1 : coin.sentiment.sentiment_score === "BEAR" ? -1 : 0;
      const signalStrength = (coin.signal.strength / 100) * (coin.signal.signal === "BUY" ? 1 : coin.signal.signal === "SELL" ? -1 : 0);
      const volatilityAdjustment = Math.min(coin.market.volatility_7d / 10, 0.5); // Cap at 0.5
      const confidenceMultiplier = coin.sentiment.confidence;

      const compositeScore =
        sentimentMultiplier * 30 + signalStrength * 40 + volatilityAdjustment * 20 + confidenceMultiplier * 10;

      return {
        ...coin,
        compositeScore,
        expectedReturn: coin.signal.expected_roi_pct,
        riskAdjustedReturn: coin.signal.expected_roi_pct / Math.max(coin.market.volatility_7d, 1),
      };
    });

    // Rank by composite score
    return scores.sort((a, b) => b.compositeScore - a.compositeScore).map((coin, rank) => ({
      ...coin,
      rank: rank + 1,
    }));
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  private calculateVolatilityScore(market: MarketData): number {
    const vol = market.volatility_7d || market.volatility_24h;
    if (vol < 2) return 0.2; // Very stable
    if (vol < 5) return 0.4;
    if (vol < 10) return 0.6; // Moderate
    if (vol < 20) return 0.8;
    return 1.0; // Very volatile
  }

  private calculateVolumeScore(market: MarketData): number {
    if ((market.volume_change_24h || 0) > 100) return 1.0; // Strong
    if ((market.volume_change_24h || 0) > 50) return 0.8;
    if ((market.volume_change_24h || 0) > 0) return 0.6;
    if ((market.volume_change_24h || 0) > -30) return 0.4;
    return 0.2; // Weak volume
  }

  private calculateMomentumScore(market: MarketData): number {
    const momentum = market.price_7d_change || 0;
    if (momentum > 20) return 1.0; // Strong uptrend
    if (momentum > 10) return 0.8;
    if (momentum > 0) return 0.6;
    if (momentum > -10) return 0.4;
    return 0.2; // Downtrend
  }

  private calculateTechnicalScore(technical: TechnicalData): number {
    let score = 0.5;

    // RSI analysis
    if (technical.rsi_14 > 70) score += 0.2; // Overbought = bearish
    else if (technical.rsi_14 < 30) score += 0.3; // Oversold = bullish
    else score += 0.15;

    // Moving average crossover
    if (technical.moving_average_20 > technical.moving_average_50) score += 0.15;
    else score -= 0.1;

    // MACD signal
    if (technical.macd.value > technical.macd.signal) score += 0.15;
    else score -= 0.1;

    return Math.min(Math.max(score, 0), 1);
  }
}

// ========================================
// TYPE DEFINITIONS
// ========================================

interface BasicSentiment {
  sentiment_score: "BULL" | "NEUTRAL" | "BEAR";
  confidence: number;
  mode: "BASIC";
  timestamp: Date;
}

interface AdvancedSentiment {
  sentiment_score: "BULL" | "NEUTRAL" | "BEAR";
  confidence: number;
  key_drivers: string[];
  risk_factors: string[];
  volatility_assessment: "HIGH" | "MEDIUM" | "LOW";
  volume_signal: "STRONG" | "NORMAL" | "WEAK";
  technical_outlook: "BULLISH" | "NEUTRAL" | "BEARISH";
  short_term_trend: "UP" | "DOWN" | "SIDEWAYS";
  recommended_hold_period: "hours" | "days" | "weeks";
  mode: "ADVANCED";
  timestamp: Date;
}

interface TradingSignal {
  signal: "BUY" | "SELL" | "HOLD";
  strength: number;
  entry_price: number;
  target_price_short: number; // 1-3 days
  target_price_medium: number; // 3-7 days
  stop_loss: number;
  expected_roi_pct: number;
  risk_reward_ratio: number;
  position_size_pct: number;
  confidence: number;
  reasoning: string;
  mode: "TRADING_SIGNALS";
  timestamp: Date;
}

interface SmartSentiment {
  composite_score: number;
  sentiment: "BULL" | "NEUTRAL" | "BEAR";
  confidence: number;
  factor_weights: Record<string, number>;
  weighted_factors: Record<string, number>;
  explanation: string;
  dominant_factor: string;
  contradictions: string;
  selected_factors: string[];
  mode: "SMART";
  timestamp: Date;
}

interface RankedCoin {
  symbol: string;
  rank: number;
  compositeScore: number;
  expectedReturn: number;
  riskAdjustedReturn: number;
}

export type SentimentAnalysis = BasicSentiment | AdvancedSentiment | TradingSignal | SmartSentiment;

export { BasicSentiment, AdvancedSentiment, TradingSignal, SmartSentiment, RankedCoin };
