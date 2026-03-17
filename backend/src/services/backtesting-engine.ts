import { CoinGeckoService } from './coingecko.js';
import { NewsAPIService } from './newsapi.js';
import { SentimentAnalyzerEngine } from './sentiment-analyzer.js';
import type { MarketData, NewsData } from './sentiment-analyzer.js';
import {
  AgentFactory,
  type AgentConfig,
  type AgentMetrics,
  type TradeRecord,
  type TradingAgent,
} from './trading-agent.js';

// ─── Input / Config Types ──────────────────────────────────────────────────

export type SlippageModel = 'FIXED' | 'VOLUME_BASED' | 'MARKET_IMPACT';

export interface BacktestConfig {
  symbols: string[];
  startDate: Date;
  endDate: Date;
  agentConfigs: Array<Omit<AgentConfig, 'agentId'> & { agentId?: string }>;
  slippageModel: SlippageModel;
  commissionPct: number; // e.g. 0.001 = 0.1%
}

// ─── Historical Data ────────────────────────────────────────────────────────

export interface OHLCVBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Output Types ──────────────────────────────────────────────────────────

export interface AgentBacktestResult {
  agentId: string;
  agentType: string;
  riskProfile: string;
  metrics: AgentMetrics;
  trades: TradeRecord[];
}

export interface SimulationResult {
  testId: string;
  config: BacktestConfig;
  agentResults: AgentBacktestResult[];
  comparison: ComparisonReport;
  startedAt: Date;
  completedAt: Date;
}

export interface ComparisonReport {
  topPerformerByReturn: string;    // agentId
  topPerformerByWinRate: string;   // agentId
  topPerformerBySharpe: string;    // agentId
  averageReturn: number;
  bestReturn: number;
  worstReturn: number;
  averageWinRate: number;
  summary: string;
}

// ─── BacktestingEngine ──────────────────────────────────────────────────────

export class BacktestingEngine {
  private coinGecko: CoinGeckoService;
  private newsAPI: NewsAPIService;
  private analyzer: SentimentAnalyzerEngine;

  // In-memory store of completed simulations
  private results: Map<string, SimulationResult> = new Map();

  // Cache of historical OHLCV data loaded for a run
  private historicalData: Map<string, OHLCVBar[]> = new Map();

  constructor() {
    this.coinGecko = new CoinGeckoService();
    this.newsAPI = new NewsAPIService();
    this.analyzer = new SentimentAnalyzerEngine();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Load OHLCV data from CoinGecko for all requested symbols.
   * CoinGecko's free OHLC endpoint returns up to 365 days (90 days on free tier).
   */
  async loadHistoricalData(symbol: string, days: number): Promise<OHLCVBar[]> {
    const cacheKey = `${symbol}:${days}`;
    if (this.historicalData.has(cacheKey)) {
      return this.historicalData.get(cacheKey)!;
    }

    // We need a CoinGecko coin ID for the API call.
    // Approximate: lower-case the symbol and try as ID first.
    const coinId = symbol.toLowerCase();
    const raw = await this.coinGecko.getCoinHistory(coinId, days);
    const bars: OHLCVBar[] = raw.map((r) => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
    }));

    this.historicalData.set(cacheKey, bars);
    return bars;
  }

  /**
   * Run a full backtest simulation.
   */
  async runSimulation(config: BacktestConfig): Promise<SimulationResult> {
    const testId = `backtest_${Date.now()}`;
    const startedAt = new Date();

    // ── Load data ─────────────────────────────────────────────────────────
    const days = Math.ceil(
      (config.endDate.getTime() - config.startDate.getTime()) / 86_400_000
    );

    const symbolBars: Map<string, OHLCVBar[]> = new Map();
    await Promise.all(
      config.symbols.map(async (sym) => {
        const bars = await this.loadHistoricalData(sym, days + 14); // extra for warmup
        symbolBars.set(sym, bars.filter((b) => b.timestamp >= config.startDate && b.timestamp <= config.endDate));
      })
    );

    // ── Pre-fetch recent headlines for all symbols (best-effort) ──────────
    const symbolHeadlines = new Map<string, string[]>();
    await Promise.all(
      config.symbols.map(async (sym) => {
        try {
          symbolHeadlines.set(sym, await this.newsAPI.getHeadlines(sym, 7));
        } catch {
          symbolHeadlines.set(sym, []);
        }
      })
    );

    // ── Instantiate agents ────────────────────────────────────────────────
    const agents: TradingAgent[] = AgentFactory.createAll(config.agentConfigs);

    // ── Build sorted date sequence ────────────────────────────────────────
    const allDates = this.buildDateSequence(symbolBars, config.startDate, config.endDate);

    // ── Day-by-day simulation loop ─────────────────────────────────────────
    for (const day of allDates) {
      const prices: Map<string, number> = new Map();
      const signals = new Map<string, ReturnType<SentimentAnalyzerEngine['generateTradingSignals']>>();

      // Collect prices and generate signals for each symbol on this day
      for (const sym of config.symbols) {
        const bar = this.barForDate(symbolBars.get(sym) ?? [], day);
        if (!bar) continue;

        prices.set(sym, bar.close);

        // Build lightweight market / news snapshots from OHLCV + real headlines
        const market = this.barToMarketData(sym, bar);
        const news = this.syntheticNews(bar, symbolHeadlines.get(sym) ?? []);
        const sentiment = this.analyzer.analyzeAdvancedSentiment(market, news);

        // Generate trading signal (uses our analyzer, no live API call)
        const syntheticSentiment = this.toSentimentShape(sym, sentiment);
        signals.set(sym, this.analyzer.generateTradingSignals(market, news, syntheticSentiment));
      }

      // Each agent acts on each symbol
      for (const agent of agents) {
        // 1. Check existing positions for exits first
        agent.evaluateOpenPositions(prices, day);

        // 2. Consider new entries
        for (const sym of config.symbols) {
          const price = prices.get(sym);
          const signal = signals.get(sym);
          if (price === undefined || !signal) continue;

          // Apply slippage to execution price
          const execPrice = this.applySlippage(price, config.slippageModel, config.commissionPct);

          const action = agent.makeDecision({ symbol: sym, signal, currentPrice: execPrice, date: day });
          if (action !== 'HOLD') {
            agent.executeOrder({ symbol: sym, signal, currentPrice: execPrice, date: day }, action);
          }
        }

        // 3. Track daily equity
        agent.recordDailyEquity(prices, day);
      }
    }

    // ── Finalise metrics ──────────────────────────────────────────────────
    const lastPrices = this.lastKnownPrices(symbolBars);
    const agentResults: AgentBacktestResult[] = agents.map((agent) => ({
      agentId: agent.agentId,
      agentType: agent.agentType,
      riskProfile: agent.riskProfile,
      metrics: agent.finalizeMetrics(lastPrices),
      trades: (agent as unknown as { tradeHistory: TradeRecord[] }).tradeHistory,
    }));

    const comparison = this.compareAgents(agentResults);
    const completedAt = new Date();

    const result: SimulationResult = {
      testId,
      config,
      agentResults,
      comparison,
      startedAt,
      completedAt,
    };

    this.results.set(testId, result);
    return result;
  }

  /** Retrieve a completed simulation by ID. */
  getResult(testId: string): SimulationResult | undefined {
    return this.results.get(testId);
  }

  /** List all stored test IDs. */
  listResults(): string[] {
    return Array.from(this.results.keys());
  }

  // ── Agent Comparison ───────────────────────────────────────────────────

  compareAgents(results: AgentBacktestResult[]): ComparisonReport {
    if (results.length === 0) {
      return {
        topPerformerByReturn: '',
        topPerformerByWinRate: '',
        topPerformerBySharpe: '',
        averageReturn: 0,
        bestReturn: 0,
        worstReturn: 0,
        averageWinRate: 0,
        summary: 'No agents to compare.',
      };
    }

    const byReturn = [...results].sort((a, b) => b.metrics.totalReturnPct - a.metrics.totalReturnPct);
    const byWinRate = [...results].sort((a, b) => b.metrics.winRate - a.metrics.winRate);
    const bySharpe = [...results].sort((a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);

    const returns = results.map((r) => r.metrics.totalReturnPct);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const avgWinRate = results.reduce((s, r) => s + r.metrics.winRate, 0) / results.length;

    const top = byReturn[0];
    const summary =
      `Top performer: ${top.agentId} (${(top.metrics.totalReturnPct * 100).toFixed(1)}% return, ` +
      `${(top.metrics.winRate * 100).toFixed(0)}% win rate, ` +
      `Sharpe ${top.metrics.sharpeRatio.toFixed(2)}).`;

    return {
      topPerformerByReturn: byReturn[0].agentId,
      topPerformerByWinRate: byWinRate[0].agentId,
      topPerformerBySharpe: bySharpe[0].agentId,
      averageReturn: avgReturn,
      bestReturn: Math.max(...returns),
      worstReturn: Math.min(...returns),
      averageWinRate: avgWinRate,
      summary,
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  /** Build a sorted list of unique dates spanning all symbol data within range. */
  private buildDateSequence(
    symbolBars: Map<string, OHLCVBar[]>,
    start: Date,
    end: Date
  ): Date[] {
    const dateSet = new Set<number>();
    for (const bars of symbolBars.values()) {
      for (const bar of bars) {
        const t = bar.timestamp.getTime();
        if (t >= start.getTime() && t <= end.getTime()) dateSet.add(t);
      }
    }
    return Array.from(dateSet)
      .sort((a, b) => a - b)
      .map((t) => new Date(t));
  }

  /** Find the OHLCV bar closest to a given date (within 12h). */
  private barForDate(bars: OHLCVBar[], date: Date): OHLCVBar | null {
    const target = date.getTime();
    const tolerance = 12 * 3_600_000; // 12 hours in ms
    return (
      bars.find((b) => Math.abs(b.timestamp.getTime() - target) <= tolerance) ??
      null
    );
  }

  /** Apply slippage model to execution price. */
  private applySlippage(
    price: number,
    model: SlippageModel,
    commissionPct: number
  ): number {
    const commission = price * commissionPct;
    switch (model) {
      case 'FIXED':
        return price * (1 + 0.001) + commission; // 0.1% fixed
      case 'VOLUME_BASED':
        return price * (1 + 0.002) + commission; // 0.2% for volume-based
      case 'MARKET_IMPACT':
        return price * (1 + 0.003) + commission; // 0.3% for large orders
    }
  }

  /** Build a minimal MarketData snapshot from a single OHLCV bar. */
  private barToMarketData(symbol: string, bar: OHLCVBar): MarketData {
    const priceRange = bar.high - bar.low;
    const volatility24h = bar.close > 0 ? (priceRange / bar.close) * 100 : 0;
    const priceChange24h = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;

    return {
      symbol,
      price_usd: bar.close,
      price_change_24h_percent: priceChange24h,
      price_change_7d_percent: priceChange24h, // approximation in single-bar context
      volatility_24h: volatility24h,
      volatility_7d: volatility24h,
      volume_24h_usd: bar.volume ?? 0,
      market_cap_usd: 0, // not available from OHLCV
      market_rank: 999,
    };
  }

  /**
   * Build NewsData for a simulation bar.
   * Real headlines (fetched once per simulation run) are passed in; price action
   * is still used to derive sentiment_score and confidence when no headlines are
   * available, but the headlines array is now populated with actual news.
   */
  private syntheticNews(bar: OHLCVBar, headlines: string[]): NewsData {
    const priceChange = bar.open > 0 ? (bar.close - bar.open) / bar.open : 0;
    const sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR' =
      priceChange > 0.02 ? 'BULL' : priceChange < -0.02 ? 'BEAR' : 'NEUTRAL';
    const sentiment_confidence = Math.min(Math.abs(priceChange) * 10, 1);

    return {
      headlines,
      sentiment_score,
      sentiment_confidence,
      sentiment_summary: `Price ${priceChange >= 0 ? 'up' : 'down'} ${(Math.abs(priceChange) * 100).toFixed(1)}%`,
    };
  }

  /**
   * Convert an AdvancedAnalysisResult into the Sentiment shape expected by
   * generateTradingSignals without importing the full Sentiment interface.
   */
  private toSentimentShape(
    symbol: string,
    advanced: ReturnType<SentimentAnalyzerEngine['analyzeAdvancedSentiment']>
  ) {
    return {
      symbol,
      analysis_date: new Date().toISOString().split('T')[0],
      sentiment_score: advanced.sentiment,
      confidence: advanced.confidence,
      summary: advanced.summary,
      key_catalysts: [],
      risk_factors: [],
      short_term_outlook: '',
      volatility_warning: advanced.volatility_score > 0.7,
      trending_score: 0,
    };
  }

  /** Gather the last close price for each symbol from loaded data. */
  private lastKnownPrices(symbolBars: Map<string, OHLCVBar[]>): Map<string, number> {
    const prices = new Map<string, number>();
    for (const [sym, bars] of symbolBars) {
      if (bars.length > 0) {
        prices.set(sym, bars[bars.length - 1].close);
      }
    }
    return prices;
  }
}
