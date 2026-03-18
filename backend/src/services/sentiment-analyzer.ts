import type { Coin, OnChainMetrics, Sentiment } from '../types.js';
import type { SentimentMomentum } from '../types/social-media.js';
import type { FinBertService } from './finbert.js';
import { finBertService as defaultFinBertService } from './finbert.js';

// ─── Analysis Mode ────────────────────────────────────────────────────────────

export type AnalysisMode = 'BASIC' | 'ADVANCED' | 'TRADING_SIGNALS' | 'SMART';

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface MarketData {
  symbol: string;
  price_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  volatility_7d: number;
  volume_24h_usd: number;
  market_cap_usd: number;
  market_rank: number;
}

export interface NewsData {
  headlines: string[];
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  sentiment_summary: string;
}

export interface TechnicalData {
  rsi_14?: number;          // 0–100; computed from price_history if omitted
  price_history?: number[]; // close prices, chronological
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface BasicSentimentResult {
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number; // 0–1
}

export interface AdvancedAnalysisResult {
  symbol: string;
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  news_score: number;     // –1 to 1
  momentum_score: number; // –1 to 1
  volatility_score: number; // 0–1 (higher = more volatile)
  volume_score: number;   // –1 to 1 (above avg = positive)
  rsi_score: number;      // –1 to 1 (derived from RSI if provided)
  on_chain_score?: number; // –1 to 1 (net exchange flows + activity + whale proxy)
  summary: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  feature_attribution: Record<string, number>;
}

export interface TradingSignal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  strength: number;        // 0–1
  target_price_high: number;
  target_price_low: number;
  stop_loss: number;
  reasoning: string;
  risk_reward_ratio: number;
}

export interface SmartAnalysisResult {
  symbol: string;
  composite_score: number; // –1 to 1
  sentiment: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  factor_weights: {
    news: number;
    momentum: number;
    volatility: number;
    volume: number;
    technical: number;
    on_chain: number;
  };
  on_chain_score?: number;
  explanation: string;
}

export interface RankedCoin {
  coin: Coin;
  composite_score: number;
  rank: number;
}

interface SentimentAnalyzerConfig {
  onChainWeight?: number;
  tradingSignalMomentumWeight1h?: number;
  tradingSignalMomentumWeight6h?: number;
}

// ─── SentimentAnalyzerEngine ──────────────────────────────────────────────────

export class SentimentAnalyzerEngine {
  private readonly onChainWeight: number;
  private readonly tradingSignalMomentumWeight1h: number;
  private readonly tradingSignalMomentumWeight6h: number;

  constructor(config: SentimentAnalyzerConfig = {}) {
    this.onChainWeight = this.clamp(config.onChainWeight ?? 0.15, 0, 0.5);
    this.tradingSignalMomentumWeight1h = this.clamp(config.tradingSignalMomentumWeight1h ?? 0.08, 0, 0.5);
    this.tradingSignalMomentumWeight6h = this.clamp(config.tradingSignalMomentumWeight6h ?? 0.12, 0, 0.5);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * BASIC mode: derive sentiment from existing headline/market data already
   * stored on a Coin without calling any external API.
   */
  analyzeBasicSentiment(
    symbol: string,
    headlines: string[]
  ): BasicSentimentResult {
    const keywordScore = this.scoreHeadlinesByKeyword(headlines);
    const sentiment = this.scoreToSentiment(keywordScore);
    const confidence = Math.min(Math.abs(keywordScore), 1);
    return { sentiment, confidence };
  }

  /**
   * ADVANCED mode: multi-factor analysis combining news, momentum, volatility,
   * volume, and optional technical indicators.
   */
  analyzeAdvancedSentiment(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData,
    onChain?: OnChainMetrics | null
  ): AdvancedAnalysisResult {
    const news_score = this.newsToScore(news);
    const momentum_score = this.calcMomentumScore(
      market.price_change_24h_percent,
      market.price_change_7d_percent
    );
    const volatility_score = this.calcVolatilityScore(
      market.volatility_24h,
      market.volatility_7d
    );
    const volume_score = this.calcVolumeScore(
      market.volume_24h_usd,
      market.market_cap_usd
    );
    const rsi_score = technical
      ? this.rsiToScore(technical.rsi_14 ?? this.calcRSI(technical.price_history ?? []))
      : 0;
    const on_chain_score = onChain ? this.onChainToScore(onChain) : undefined;

    // Weighted composite (no technical weight when not provided)
    const techWeight = technical ? 0.15 : 0;
    const onChainWeight = on_chain_score === undefined ? 0 : this.onChainWeight;
    const baseWeights = { news: 0.30, momentum: 0.25, volatility: -0.10, volume: 0.20 };
    const scale = 1 / (0.30 + 0.25 + 0.10 + 0.20 + techWeight + onChainWeight);
    const composite =
      (baseWeights.news * news_score +
        baseWeights.momentum * momentum_score +
        baseWeights.volatility * (0 - volatility_score) + // high vol is negative
        baseWeights.volume * volume_score +
        techWeight * rsi_score +
        onChainWeight * (on_chain_score ?? 0)) *
      scale;

    const risk_level = this.calcRiskLevel(volatility_score, market.market_rank);
    const sentiment = this.scoreToSentiment(composite);
    const confidence = Math.min(Math.abs(composite) * 1.5, 1);

    const feature_attribution: Record<string, number> = {
      news:       baseWeights.news * news_score * scale,
      momentum:   baseWeights.momentum * momentum_score * scale,
      volatility: baseWeights.volatility * (-volatility_score) * scale,
      volume:     baseWeights.volume * volume_score * scale,
    };
    if (techWeight > 0)    feature_attribution['technical'] = techWeight * rsi_score * scale;
    if (onChainWeight > 0) feature_attribution['on_chain']  = onChainWeight * (on_chain_score ?? 0) * scale;

    return {
      symbol: market.symbol,
      sentiment,
      confidence,
      news_score,
      momentum_score,
      volatility_score,
      volume_score,
      rsi_score,
      on_chain_score,
      summary: this.buildAdvancedSummary(market.symbol, sentiment, composite, risk_level, on_chain_score),
      risk_level,
      feature_attribution,
    };
  }

  /**
   * TRADING_SIGNALS mode: generates actionable BUY/SELL/HOLD signal with
   * target prices and stop-loss.
   */
  generateTradingSignals(
    market: MarketData,
    news: NewsData,
    sentiment: Sentiment,
    technical?: TechnicalData,
    onChain?: OnChainMetrics | null,
    sentimentMomentum?: SentimentMomentum | null
  ): TradingSignal {
    const advanced = this.analyzeAdvancedSentiment(market, news, technical, onChain);
    const momentumAdjustment = this.sentimentMomentumToSignalScore(sentimentMomentum);
    const composite = this.clamp(this.compositeFromAdvanced(advanced) + momentumAdjustment, -1, 1);

    // Signal thresholds
    let signal: 'BUY' | 'SELL' | 'HOLD';
    if (composite > 0.25) signal = 'BUY';
    else if (composite < -0.25) signal = 'SELL';
    else signal = 'HOLD';

    const strength = Math.min(Math.abs(composite) * 2, 1);

    // Target prices: simple ATR-style projection based on volatility
    const atr = market.price_usd * (market.volatility_24h / 100);
    const multiplier = 1 + strength;
    const target_price_high = market.price_usd + atr * multiplier * 2;
    const target_price_low = market.price_usd + atr * multiplier;
    const stop_loss = market.price_usd - atr * multiplier;

    const risk = target_price_low - market.price_usd;
    const reward = target_price_high - market.price_usd;
    const risk_reward_ratio = risk > 0 ? reward / risk : 0;

    return {
      symbol: market.symbol,
      signal,
      strength,
      target_price_high,
      target_price_low,
      stop_loss,
      reasoning: this.buildSignalReasoning(signal, advanced, sentiment, sentimentMomentum),
      risk_reward_ratio,
    };
  }

  /**
   * SMART mode: adaptive weighting — weights shift based on market regime
   * (trending vs. mean-reverting) and data confidence.
   */
  analyzeSmartSentiment(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData,
    onChain?: OnChainMetrics | null
  ): SmartAnalysisResult {
    const isTrending = Math.abs(market.price_change_7d_percent) > 10;
    const highVolume = market.volume_24h_usd / market.market_cap_usd > 0.05;

    // Adapt weights to market regime
    const factor_weights = {
      news: isTrending ? 0.20 : 0.35,
      momentum: isTrending ? 0.35 : 0.15,
      volatility: highVolume ? 0.05 : 0.15,
      volume: highVolume ? 0.25 : 0.15,
      technical: technical ? (isTrending ? 0.15 : 0.20) : 0,
      on_chain: onChain ? this.onChainWeight : 0,
    };

    // Normalise weights to sum to 1
    const total = Object.values(factor_weights).reduce((a, b) => a + b, 0);
    const w = {
      news: factor_weights.news / total,
      momentum: factor_weights.momentum / total,
      volatility: factor_weights.volatility / total,
      volume: factor_weights.volume / total,
      technical: factor_weights.technical / total,
      on_chain: factor_weights.on_chain / total,
    };

    const news_score = this.newsToScore(news);
    const momentum_score = this.calcMomentumScore(
      market.price_change_24h_percent,
      market.price_change_7d_percent
    );
    const volatility_score = this.calcVolatilityScore(
      market.volatility_24h,
      market.volatility_7d
    );
    const volume_score = this.calcVolumeScore(
      market.volume_24h_usd,
      market.market_cap_usd
    );
    const rsi_score = technical
      ? this.rsiToScore(technical.rsi_14 ?? this.calcRSI(technical.price_history ?? []))
      : 0;
    const on_chain_score = onChain ? this.onChainToScore(onChain) : undefined;

    const composite =
      w.news * news_score +
      w.momentum * momentum_score +
      w.volatility * (0 - volatility_score) +
      w.volume * volume_score +
      w.technical * rsi_score +
      w.on_chain * (on_chain_score ?? 0);

    const sentiment = this.scoreToSentiment(composite);
    const confidence = Math.min(Math.abs(composite) * 1.5, 1);

    return {
      symbol: market.symbol,
      composite_score: composite,
      sentiment,
      confidence,
      factor_weights: w,
      on_chain_score,
      explanation: this.buildSmartExplanation(
        market.symbol,
        composite,
        w,
        isTrending,
        highVolume,
        on_chain_score
      ),
    };
  }

  // ── Async FinBERT-enhanced variants ─────────────────────────────────────────

  /**
   * ADVANCED mode — async variant.
   *
   * Uses FinBERT to score each headline individually when available, falling
   * back to keyword-based scoring when FinBERT is unavailable or errors.
   * The `finBert` parameter defaults to the global singleton so callers can
   * omit it in production and pass a mock in tests.
   */
  async analyzeAdvancedSentimentAsync(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData,
    finBert: FinBertService = defaultFinBertService,
    onChain?: OnChainMetrics | null
  ): Promise<AdvancedAnalysisResult> {
    const news_score = await this.newsToScoreAsync(news, finBert);
    const momentum_score = this.calcMomentumScore(
      market.price_change_24h_percent,
      market.price_change_7d_percent
    );
    const volatility_score = this.calcVolatilityScore(
      market.volatility_24h,
      market.volatility_7d
    );
    const volume_score = this.calcVolumeScore(
      market.volume_24h_usd,
      market.market_cap_usd
    );
    const rsi_score = technical
      ? this.rsiToScore(technical.rsi_14 ?? this.calcRSI(technical.price_history ?? []))
      : 0;
    const on_chain_score = onChain ? this.onChainToScore(onChain) : undefined;

    const techWeight = technical ? 0.15 : 0;
    const onChainWeight = on_chain_score === undefined ? 0 : this.onChainWeight;
    const baseWeights = { news: 0.30, momentum: 0.25, volatility: -0.10, volume: 0.20 };
    const scale = 1 / (0.30 + 0.25 + 0.10 + 0.20 + techWeight + onChainWeight);
    const composite =
      (baseWeights.news * news_score +
        baseWeights.momentum * momentum_score +
        baseWeights.volatility * (0 - volatility_score) +
        baseWeights.volume * volume_score +
        techWeight * rsi_score +
        onChainWeight * (on_chain_score ?? 0)) *
      scale;

    const risk_level = this.calcRiskLevel(volatility_score, market.market_rank);
    const sentiment = this.scoreToSentiment(composite);
    const confidence = Math.min(Math.abs(composite) * 1.5, 1);

    const feature_attribution: Record<string, number> = {
      news:       baseWeights.news * news_score * scale,
      momentum:   baseWeights.momentum * momentum_score * scale,
      volatility: baseWeights.volatility * (-volatility_score) * scale,
      volume:     baseWeights.volume * volume_score * scale,
    };
    if (techWeight > 0)    feature_attribution['technical'] = techWeight * rsi_score * scale;
    if (onChainWeight > 0) feature_attribution['on_chain']  = onChainWeight * (on_chain_score ?? 0) * scale;

    return {
      symbol: market.symbol,
      sentiment,
      confidence,
      news_score,
      momentum_score,
      volatility_score,
      volume_score,
      rsi_score,
      on_chain_score,
      summary: this.buildAdvancedSummary(market.symbol, sentiment, composite, risk_level, on_chain_score),
      risk_level,
      feature_attribution,
    };
  }

  /**
   * SMART mode — async variant.
   *
   * Identical to the sync version but uses FinBERT for headline scoring when
   * configured.  Falls back to keyword scoring when unavailable.
   */
  async analyzeSmartSentimentAsync(
    market: MarketData,
    news: NewsData,
    technical?: TechnicalData,
    finBert: FinBertService = defaultFinBertService,
    onChain?: OnChainMetrics | null
  ): Promise<SmartAnalysisResult> {
    const isTrending = Math.abs(market.price_change_7d_percent) > 10;
    const highVolume = market.volume_24h_usd / market.market_cap_usd > 0.05;

    const factor_weights = {
      news: isTrending ? 0.20 : 0.35,
      momentum: isTrending ? 0.35 : 0.15,
      volatility: highVolume ? 0.05 : 0.15,
      volume: highVolume ? 0.25 : 0.15,
      technical: technical ? (isTrending ? 0.15 : 0.20) : 0,
      on_chain: onChain ? this.onChainWeight : 0,
    };

    const total = Object.values(factor_weights).reduce((a, b) => a + b, 0);
    const w = {
      news: factor_weights.news / total,
      momentum: factor_weights.momentum / total,
      volatility: factor_weights.volatility / total,
      volume: factor_weights.volume / total,
      technical: factor_weights.technical / total,
      on_chain: factor_weights.on_chain / total,
    };

    const news_score = await this.newsToScoreAsync(news, finBert);
    const momentum_score = this.calcMomentumScore(
      market.price_change_24h_percent,
      market.price_change_7d_percent
    );
    const volatility_score = this.calcVolatilityScore(
      market.volatility_24h,
      market.volatility_7d
    );
    const volume_score = this.calcVolumeScore(
      market.volume_24h_usd,
      market.market_cap_usd
    );
    const rsi_score = technical
      ? this.rsiToScore(technical.rsi_14 ?? this.calcRSI(technical.price_history ?? []))
      : 0;
    const on_chain_score = onChain ? this.onChainToScore(onChain) : undefined;

    const composite =
      w.news * news_score +
      w.momentum * momentum_score +
      w.volatility * (0 - volatility_score) +
      w.volume * volume_score +
      w.technical * rsi_score +
      w.on_chain * (on_chain_score ?? 0);

    const sentiment = this.scoreToSentiment(composite);
    const confidence = Math.min(Math.abs(composite) * 1.5, 1);

    return {
      symbol: market.symbol,
      composite_score: composite,
      sentiment,
      confidence,
      factor_weights: w,
      on_chain_score,
      explanation: this.buildSmartExplanation(
        market.symbol,
        composite,
        w,
        isTrending,
        highVolume,
        on_chain_score
      ),
    };
  }

  /**
   * TRADING_SIGNALS mode — async variant.
   *
   * Uses `analyzeAdvancedSentimentAsync()` (FinBERT-enhanced) to compute the
   * underlying advanced result, then derives the BUY/SELL/HOLD signal from it.
   * Falls back to keyword scoring when FinBERT is unavailable or errors,
   * producing identical output to the sync `generateTradingSignals()`.
   */
  async generateTradingSignalsAsync(
    market: MarketData,
    news: NewsData,
    sentiment: Sentiment,
    technical?: TechnicalData,
    finBert: FinBertService = defaultFinBertService,
    onChain?: OnChainMetrics | null,
    sentimentMomentum?: SentimentMomentum | null
  ): Promise<TradingSignal> {
    const advanced = await this.analyzeAdvancedSentimentAsync(market, news, technical, finBert, onChain);
    const momentumAdjustment = this.sentimentMomentumToSignalScore(sentimentMomentum);
    const composite = this.clamp(this.compositeFromAdvanced(advanced) + momentumAdjustment, -1, 1);

    let signal: 'BUY' | 'SELL' | 'HOLD';
    if (composite > 0.25) signal = 'BUY';
    else if (composite < -0.25) signal = 'SELL';
    else signal = 'HOLD';

    const strength = Math.min(Math.abs(composite) * 2, 1);
    const atr = market.price_usd * (market.volatility_24h / 100);
    const multiplier = 1 + strength;
    const target_price_high = market.price_usd + atr * multiplier * 2;
    const target_price_low = market.price_usd + atr * multiplier;
    const stop_loss = market.price_usd - atr * multiplier;
    const risk = target_price_low - market.price_usd;
    const reward = target_price_high - market.price_usd;
    const risk_reward_ratio = risk > 0 ? reward / risk : 0;

    return {
      symbol: market.symbol,
      signal,
      strength,
      target_price_high,
      target_price_low,
      stop_loss,
      reasoning: this.buildSignalReasoning(signal, advanced, sentiment, sentimentMomentum),
      risk_reward_ratio,
    };
  }

  /**
   * Ranks a list of coins by their composite smart-sentiment score, highest first.
   */
  rankCoinsForTimeframe(coins: Coin[]): RankedCoin[] {
    const scored = coins.map((coin) => {
      const market = this.coinToMarketData(coin);
      const news: NewsData = {
        headlines: [],
        sentiment_score: coin.sentiment_score,
        sentiment_confidence: coin.sentiment_confidence,
        sentiment_summary: coin.sentiment_summary,
      };
      const result = this.analyzeSmartSentiment(market, news);
      return { coin, composite_score: result.composite_score };
    });

    scored.sort((a, b) => b.composite_score - a.composite_score);
    return scored.map((s, i) => ({ ...s, rank: i + 1 }));
  }

  /**
   * Async text scoring with optional FinBERT fallback.
   *
   * When a configured FinBertService is provided and available, uses the model
   * to derive a score in [-1, 1].  Falls back to keyword-based scoring when
   * FinBERT is unavailable or returns null.
   *
   * This is the async entry point used by scoreItemAsync() in item-scorer.ts.
   */
  async scoreTextAsync(text: string, finBert?: FinBertService): Promise<number> {
    if (finBert?.isAvailable()) {
      const result = await finBert.analyze(text);
      if (result !== null) {
        return finBert.toSentimentScore(result);
      }
    }
    // Fallback: keyword scoring on sentence-split text
    const sentences = text
      .split(/[.!?\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 5);
    return this.scoreHeadlinesByKeyword(sentences.length ? sentences : [text]);
  }

  // ── Helper: RSI Calculation ─────────────────────────────────────────────────

  /**
   * Wilder's RSI over the last 14 periods of close prices.
   * Returns 50 (neutral) when insufficient data.
   */
  calcRSI(prices: number[], period = 14): number {
    if (prices.length < period + 1) return 50;

    const deltas = prices.slice(1).map((p, i) => p - prices[i]);
    const slice = deltas.slice(-period);

    let avgGain = slice.filter((d) => d > 0).reduce((a, b) => a + b, 0) / period;
    let avgLoss = slice.filter((d) => d < 0).map(Math.abs).reduce((a, b) => a + b, 0) / period;

    // Extend with Wilder smoothing if more data available
    const extended = deltas.slice(0, -period);
    for (const delta of extended.reverse()) {
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? Math.abs(delta) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // ── Helper: Score Calculators ───────────────────────────────────────────────

  /**
   * Maps price changes to a momentum score in [–1, 1].
   * 7-day change is weighted more heavily than 24h.
   */
  calcMomentumScore(change24h: number, change7d: number): number {
    const s24 = this.clampNorm(change24h, 15); // 15% = max
    const s7d = this.clampNorm(change7d, 30);  // 30% = max
    return s24 * 0.4 + s7d * 0.6;
  }

  /**
   * Maps volatility percentages to a risk score in [0, 1].
   * High volatility → score near 1.
   */
  calcVolatilityScore(vol24h: number, vol7d: number): number {
    const s24 = Math.min(vol24h / 20, 1); // 20% vol = max
    const s7d = Math.min(vol7d / 30, 1);  // 30% vol = max
    return s24 * 0.5 + s7d * 0.5;
  }

  /**
   * Volume/market-cap ratio signals buying pressure.
   * Returns score in [–1, 1] (positive = high volume relative to cap).
   */
  calcVolumeScore(volume24h: number, marketCap: number): number {
    if (marketCap <= 0) return 0;
    const ratio = volume24h / marketCap;
    // Typical healthy ratio ~3–5%. > 10% = very high.
    return this.clampNorm((ratio - 0.05) * 10, 1);
  }

  private onChainToScore(onChain: OnChainMetrics): number {
    const flowTotal = onChain.exchange_inflow + onChain.exchange_outflow;
    const netFlowScore = flowTotal > 0
      ? this.clamp((onChain.exchange_outflow - onChain.exchange_inflow) / flowTotal, -1, 1)
      : 0;
    const activityScore = this.clamp((Math.log10(onChain.active_addresses_24h + 1) - 5) / 2, -1, 1);
    const whaleScore = this.clamp((Math.log10(onChain.large_tx_count_24h + 1) - 2.5) / 2, -1, 1);

    return this.clamp(netFlowScore * 0.5 + activityScore * 0.3 + whaleScore * 0.2, -1, 1);
  }

  // ── Helper: Converters ──────────────────────────────────────────────────────

  /** Maps RSI to sentiment score in [–1, 1]. Oversold < 30, overbought > 70. */
  private rsiToScore(rsi: number): number {
    // Normalize: 50 = 0, 30 = –0.67, 70 = 0.67, extremes → ±1
    return this.clampNorm((rsi - 50) / 25, 1);
  }

  /** Converts NewsData (existing sentiment + headlines) to a single score [–1, 1]. */
  private newsToScore(news: NewsData): number {
    const sentimentBase =
      news.sentiment_score === 'BULL'
        ? news.sentiment_confidence
        : news.sentiment_score === 'BEAR'
        ? -news.sentiment_confidence
        : 0;
    const keywordBoost = this.scoreHeadlinesByKeyword(news.headlines) * 0.3;
    return this.clamp(sentimentBase + keywordBoost, -1, 1);
  }

  /**
   * Async variant of newsToScore.  Scores each headline via FinBERT when
   * available; falls back to the keyword scorer when FinBERT is unavailable
   * or returns null for an individual headline.
   */
  private async newsToScoreAsync(news: NewsData, finBert: FinBertService): Promise<number> {
    const sentimentBase =
      news.sentiment_score === 'BULL'
        ? news.sentiment_confidence
        : news.sentiment_score === 'BEAR'
        ? -news.sentiment_confidence
        : 0;

    if (!finBert.isAvailable() || news.headlines.length === 0) {
      const keywordBoost = this.scoreHeadlinesByKeyword(news.headlines) * 0.3;
      return this.clamp(sentimentBase + keywordBoost, -1, 1);
    }

    // Score each headline with FinBERT in parallel; fall back per-item on null
    const scores = await Promise.all(
      news.headlines.map(async (headline) => {
        const result = await finBert.analyze(headline);
        if (result === null) return this.scoreHeadlinesByKeyword([headline]);
        return finBert.toSentimentScore(result);
      })
    );

    const avgHeadlineScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    return this.clamp(sentimentBase + avgHeadlineScore * 0.3, -1, 1);
  }

  /** Keyword-based headline scoring. Returns score in [–1, 1]. */
  private scoreHeadlinesByKeyword(headlines: string[]): number {
    if (headlines.length === 0) return 0;
    const bullWords = [
      'surge', 'rally', 'bullish', 'gain', 'high', 'record', 'breakout',
      'adoption', 'partnership', 'upgrade', 'approved', 'launch', 'growth',
    ];
    const bearWords = [
      'crash', 'drop', 'bearish', 'loss', 'low', 'ban', 'hack', 'fraud',
      'lawsuit', 'fear', 'sell-off', 'decline', 'collapse', 'scam',
    ];
    let total = 0;
    for (const headline of headlines) {
      const lower = headline.toLowerCase();
      const bull = bullWords.filter((w) => lower.includes(w)).length;
      const bear = bearWords.filter((w) => lower.includes(w)).length;
      total += (bull - bear) / Math.max(bull + bear, 1);
    }
    return this.clamp(total / headlines.length, -1, 1);
  }

  /** Sentiment label from continuous score. */
  private scoreToSentiment(score: number): 'BULL' | 'NEUTRAL' | 'BEAR' {
    if (score > 0.15) return 'BULL';
    if (score < -0.15) return 'BEAR';
    return 'NEUTRAL';
  }

  private calcRiskLevel(
    volatilityScore: number,
    marketRank: number
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (volatilityScore > 0.7 || marketRank > 100) return 'HIGH';
    if (volatilityScore > 0.4 || marketRank > 20) return 'MEDIUM';
    return 'LOW';
  }

  /** Re-derive a single composite from an AdvancedAnalysisResult. */
  private compositeFromAdvanced(a: AdvancedAnalysisResult): number {
    return (
      0.30 * a.news_score +
      0.25 * a.momentum_score -
      0.10 * a.volatility_score +
      0.20 * a.volume_score +
      0.15 * a.rsi_score +
      this.onChainWeight * (a.on_chain_score ?? 0)
    );
  }

  private coinToMarketData(coin: Coin): MarketData {
    return {
      symbol: coin.symbol,
      price_usd: coin.price_usd,
      price_change_24h_percent: coin.price_change_24h_percent,
      price_change_7d_percent: coin.price_change_7d_percent,
      volatility_24h: coin.volatility_24h,
      volatility_7d: coin.volatility_7d,
      volume_24h_usd: coin.volume_24h_usd,
      market_cap_usd: coin.market_cap_usd,
      market_rank: coin.market_rank,
    };
  }

  // ── Helper: Strings ─────────────────────────────────────────────────────────

  private buildAdvancedSummary(
    symbol: string,
    sentiment: 'BULL' | 'NEUTRAL' | 'BEAR',
    composite: number,
    risk: 'LOW' | 'MEDIUM' | 'HIGH',
    onChainScore?: number
  ): string {
    const dir = sentiment === 'BULL' ? 'bullish' : sentiment === 'BEAR' ? 'bearish' : 'neutral';
    const onChainNote = onChainScore === undefined
      ? ''
      : onChainScore > 0.2
      ? ' On-chain activity is supportive.'
      : onChainScore < -0.2
      ? ' On-chain flows are a headwind.'
      : ' On-chain activity is mixed.';
    return `${symbol} shows ${dir} signals (composite ${composite.toFixed(2)}) with ${risk.toLowerCase()} risk.${onChainNote}`;
  }

  private buildSignalReasoning(
    signal: 'BUY' | 'SELL' | 'HOLD',
    advanced: AdvancedAnalysisResult,
    sentiment: Sentiment,
    sentimentMomentum?: SentimentMomentum | null
  ): string {
    const parts: string[] = [`Signal: ${signal} for ${advanced.symbol}.`];
    if (advanced.momentum_score > 0.3) parts.push('Strong positive momentum.');
    if (advanced.momentum_score < -0.3) parts.push('Strong negative momentum.');
    if (advanced.news_score > 0.3) parts.push('Positive news sentiment.');
    if (advanced.news_score < -0.3) parts.push('Negative news sentiment.');
    if (sentimentMomentum) {
      if (sentimentMomentum.roc_1h > 0 || sentimentMomentum.roc_6h > 0) parts.push('Social sentiment momentum is improving.');
      if (sentimentMomentum.roc_1h < 0 || sentimentMomentum.roc_6h < 0) parts.push('Social sentiment momentum is deteriorating.');
    }
    if (sentiment.volatility_warning) parts.push('Caution: elevated volatility.');
    return parts.join(' ');
  }

  private sentimentMomentumToSignalScore(sentimentMomentum?: SentimentMomentum | null): number {
    if (!sentimentMomentum) return 0;

    const roc1h = this.clamp(sentimentMomentum.roc_1h / 20, -1, 1);
    const roc6h = this.clamp(sentimentMomentum.roc_6h / 20, -1, 1);

    return this.clamp(
      roc1h * this.tradingSignalMomentumWeight1h +
      roc6h * this.tradingSignalMomentumWeight6h,
      -0.5,
      0.5,
    );
  }

  private buildSmartExplanation(
    symbol: string,
    composite: number,
    weights: SmartAnalysisResult['factor_weights'],
    isTrending: boolean,
    highVolume: boolean,
    onChainScore?: number
  ): string {
    const regime = isTrending ? 'trending' : 'consolidating';
    const vol = highVolume ? 'high-volume' : 'normal-volume';
    const onChainFragment = onChainScore === undefined ? '' : ` On-chain score: ${onChainScore.toFixed(3)}.`;
    return (
      `${symbol} in ${regime}, ${vol} regime. ` +
      `Composite score: ${composite.toFixed(3)}. ` +
      `Top factor: ${this.topFactor(weights)}.` +
      onChainFragment
    );
  }

  private topFactor(weights: SmartAnalysisResult['factor_weights']): string {
    return Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Maths Utils ─────────────────────────────────────────────────────────────

  /** Normalize value to [–1, 1] with given max. */
  private clampNorm(value: number, max: number): number {
    return this.clamp(value / max, -1, 1);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
