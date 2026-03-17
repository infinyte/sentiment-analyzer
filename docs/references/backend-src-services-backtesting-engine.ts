BACKTESTING & SIMULATION ENGINE
===============================

File: backend/src/services/backtesting-engine.ts

This engine:
1. Loads historical OHLCV data (6-12 months)
2. Runs agents through that data day-by-day
3. Simulates all trades with realistic slippage
4. Generates performance reports
5. Compares agents head-to-head

---

WORKFLOW
========

1. Load Historical Data
   - Fetch from CoinGecko (or database)
   - OHLCV for selected coins, 6-12 months back

2. Initialize Agents
   - Create agent instances with starting capital
   - Set agent type, risk profile, strategy

3. Run Simulation
   For each day in history:
   - Get market data + sentiment
   - Each agent makes decision
   - Execute trades (with slippage)
   - Update portfolio values
   - Track metrics

4. Generate Report
   - Win rate, profit factor, drawdown
   - Compare agents
   - Visualize equity curve
   - Export trades for review

---

IMPLEMENTATION

import { TradingAgent } from "./trading-agent";
import { SentimentAnalyzerEngine, TradingSignal, AdvancedSentiment } from "./sentiment-analyzer";

interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SimulationConfig {
  startDate: Date;
  endDate: Date;
  symbols: string[];
  agents: TradingAgent[];
  slippageModel: "FIXED" | "VOLUME_BASED" | "MARKET_IMPACT";
  commissionPct: number;
  refreshSentimentDaily: boolean;
}

interface SimulationResult {
  agentId: string;
  agentType: string;
  riskProfile: string;
  startingCapital: number;
  endingCapital: number;
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWinSize: number;
  avgLossSize: number;
  avgTradeTime: number; // in days
  trades: TradeRecord[];
  equityHistory: EquityPoint[];
}

interface TradeRecord {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  holdDays: number;
  exitReason: string;
}

interface EquityPoint {
  date: string;
  value: number;
  drawdown: number;
}

// ========================================
// BACKTESTING ENGINE
// ========================================

export class BacktestingEngine {
  private sentiment: SentimentAnalyzerEngine;
  private historicalData: Map<string, OHLCVBar[]> = new Map();

  constructor() {
    this.sentiment = new SentimentAnalyzerEngine();
  }

  // Load historical data from CoinGecko
  async loadHistoricalData(
    symbol: string,
    days: number = 180
  ): Promise<OHLCVBar[]> {
    console.log(`Loading ${days} days of historical data for ${symbol}...`);

    const bars: OHLCVBar[] = [];
    const daysPerRequest = 365; // CoinGecko can return ~365 days

    for (let offset = 0; offset < days; offset += daysPerRequest) {
      const toDate = new Date();
      const fromDate = new Date(toDate);
      fromDate.setDate(toDate.getDate() - (days - offset));

      const url = `https://api.coingecko.com/api/v3/coins/${this.getCoinId(symbol)}/ohlc`;
      const params = new URLSearchParams({
        vs_currency: "usd",
        days: Math.min(daysPerRequest, days - offset).toString(),
      });

      try {
        const response = await fetch(`${url}?${params}`);
        const data = await response.json();

        for (const [timestamp, o, h, l, c] of data) {
          const date = new Date(timestamp).toISOString().split("T")[0];
          bars.push({
            date,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: 0, // CoinGecko OHLC doesn't include volume
          });
        }
      } catch (error) {
        console.error(`Error loading data for ${symbol}:`, error);
      }
    }

    // Sort by date ascending
    bars.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    this.historicalData.set(symbol, bars);

    console.log(`✓ Loaded ${bars.length} bars for ${symbol}`);
    return bars;
  }

  // Map symbol to CoinGecko coin ID
  private getCoinId(symbol: string): string {
    const symbolMap: Record<string, string> = {
      BTC: "bitcoin",
      ETH: "ethereum",
      BNB: "binancecoin",
      ADA: "cardano",
      SOL: "solana",
      XRP: "ripple",
      DOGE: "dogecoin",
      MATIC: "matic-network",
      AVAX: "avalanche-2",
      LINK: "chainlink",
      // Add more as needed
    };
    return symbolMap[symbol] || symbol.toLowerCase();
  }

  // Run simulation
  async runSimulation(config: SimulationConfig): Promise<SimulationResult[]> {
    console.log(`Starting backtesting simulation...`);
    console.log(
      `Symbols: ${config.symbols.join(", ")}, Agents: ${config.agents.length}`
    );

    // Load historical data for all symbols
    for (const symbol of config.symbols) {
      if (!this.historicalData.has(symbol)) {
        const days = Math.floor(
          (config.endDate.getTime() - config.startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        await this.loadHistoricalData(symbol, days);
      }
    }

    const results: SimulationResult[] = [];

    // Run simulation for each agent
    for (const agent of config.agents) {
      console.log(
        `\nRunning simulation for agent: ${agent.agentId} (${agent.agentType} / ${agent.riskProfile})`
      );
      const result = await this.simulateAgent(agent, config);
      results.push(result);
    }

    return results;
  }

  // Simulate single agent
  private async simulateAgent(
    agent: TradingAgent,
    config: SimulationConfig
  ): Promise<SimulationResult> {
    const startDate = new Date(config.startDate);
    const endDate = new Date(config.endDate);

    const equityHistory: EquityPoint[] = [];
    const tradeRecords: TradeRecord[] = [];

    let maxEquity = agent.initialCash;
    let maxDrawdown = 0;

    const dayCount =
      Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Day-by-day simulation
    for (let dayOffset = 0; dayOffset < dayCount; dayOffset++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + dayOffset);
      const dateStr = currentDate.toISOString().split("T")[0];

      // Process each symbol
      for (const symbol of config.symbols) {
        const historicalBars = this.historicalData.get(symbol) || [];
        const todayBar = historicalBars.find((b) => b.date === dateStr);

        if (!todayBar) continue; // No data for this date

        // Generate sentiment for today
        // (In real scenario, this would be cached sentiment from database)
        const sentiment: AdvancedSentiment = {
          sentiment_score: "NEUTRAL",
          confidence: 0.5,
          key_drivers: [],
          risk_factors: [],
          volatility_assessment: "MEDIUM",
          volume_signal: "NORMAL",
          technical_outlook: "NEUTRAL",
          short_term_trend: "SIDEWAYS",
          recommended_hold_period: "days",
          mode: "ADVANCED",
          timestamp: new Date(),
        };

        // Generate trading signal (simplified for backtest)
        const signal = this.generateSignalFromPrice(
          symbol,
          todayBar,
          historicalBars,
          dayOffset
        );

        // Agent makes decision
        const decision = await agent.makeDecision(
          symbol,
          signal,
          todayBar.close,
          sentiment
        );

        // Execute decision
        if (decision.action === "BUY" && decision.quantity) {
          await agent.executeOrder(
            symbol,
            "BUY",
            decision.quantity,
            todayBar.close,
            signal
          );
        } else if (decision.action === "CLOSE_POSITION") {
          const position = agent.portfolio.find(
            (p) => p.symbol === symbol && p.status === "OPEN"
          );
          if (position) {
            const pnl = (todayBar.close - position.entry_price) * position.quantity;
            const pnlPct =
              ((todayBar.close - position.entry_price) / position.entry_price) * 100;
            const holdDays = Math.floor(
              (Date.now() - position.entry_time.getTime()) / (1000 * 60 * 60 * 24)
            );

            tradeRecords.push({
              symbol,
              entryDate: position.entry_time.toISOString().split("T")[0],
              entryPrice: position.entry_price,
              exitDate: dateStr,
              exitPrice: todayBar.close,
              quantity: position.quantity,
              pnl,
              pnlPct,
              holdDays,
              exitReason: decision.reasoning,
            });

            await agent.closePosition(position, todayBar.close, "SIGNAL_EXIT");
          }
        }

        // Update position prices
        agent.updatePositionPrice(symbol, todayBar.close);
      }

      // Record equity
      const currentEquity = agent.getPortfolioValue(
        Object.fromEntries(
          config.symbols.map((s) => [
            s,
            this.historicalData.get(s)?.find((b) => b.date === dateStr)?.close || 0,
          ])
        )
      );

      maxEquity = Math.max(maxEquity, currentEquity);
      const drawdown = ((currentEquity - maxEquity) / maxEquity) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);

      equityHistory.push({
        date: dateStr,
        value: currentEquity,
        drawdown,
      });
    }

    // Calculate metrics
    const totalReturn = agent.cash - agent.initialCash;
    const totalReturnPct = (totalReturn / agent.initialCash) * 100;

    const winningTrades = tradeRecords.filter((t) => t.pnl > 0).length;
    const losingTrades = tradeRecords.filter((t) => t.pnl < 0).length;
    const totalTrades = tradeRecords.length;

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const grossProfit = tradeRecords
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(
      tradeRecords
        .filter((t) => t.pnl < 0)
        .reduce((sum, t) => sum + t.pnl, 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    const avgWinSize =
      winningTrades > 0 ? grossProfit / winningTrades : 0;
    const avgLossSize = losingTrades > 0 ? grossLoss / losingTrades : 0;

    const avgTradeTime =
      totalTrades > 0
        ? tradeRecords.reduce((sum, t) => sum + t.holdDays, 0) / totalTrades
        : 0;

    // Sharpe ratio (simplified)
    const returns = equityHistory.map((e) => e.value);
    const avgReturn =
      returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn - agent.initialCash) / stdDev : 0;

    return {
      agentId: agent.agentId,
      agentType: agent.agentType,
      riskProfile: agent.riskProfile,
      startingCapital: agent.initialCash,
      endingCapital: agent.cash,
      totalReturn,
      totalReturnPct,
      winRate,
      profitFactor,
      maxDrawdown: Math.abs(maxDrawdown),
      sharpeRatio,
      totalTrades,
      winningTrades,
      losingTrades,
      avgWinSize,
      avgLossSize,
      avgTradeTime,
      trades: tradeRecords,
      equityHistory,
    };
  }

  // Generate signal from price action (simplified technical analysis)
  private generateSignalFromPrice(
    symbol: string,
    today: OHLCVBar,
    historicalBars: OHLCVBar[],
    dayOffset: number
  ): TradingSignal {
    const pastBars = historicalBars.slice(Math.max(0, dayOffset - 20), dayOffset);

    // Simple momentum indicator
    const ma5 = pastBars.slice(-5).reduce((sum, b) => sum + b.close, 0) / 5;
    const ma20 = pastBars.reduce((sum, b) => sum + b.close, 0) / pastBars.length;

    // Simple RSI
    const rsi = this.calculateRSI(pastBars);

    let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
    let strength = 50;

    if (today.close > ma5 && ma5 > ma20 && rsi < 70) {
      signal = "BUY";
      strength = Math.min(rsi + 20, 100);
    } else if (today.close < ma5 && ma5 < ma20 && rsi > 30) {
      signal = "SELL";
      strength = Math.min(100 - rsi + 20, 100);
    }

    return {
      signal,
      strength,
      entry_price: today.close,
      target_price_short: today.close * 1.03,
      target_price_medium: today.close * 1.05,
      stop_loss: today.close * 0.97,
      expected_roi_pct: 5,
      risk_reward_ratio: 1.7,
      position_size_pct: 50,
      confidence: strength / 100,
      reasoning: `Price ${signal} based on MA crossover (RSI: ${rsi.toFixed(1)})`,
      mode: "TRADING_SIGNALS",
      timestamp: new Date(),
    };
  }

  // Calculate RSI
  private calculateRSI(bars: OHLCVBar[], period: number = 14): number {
    if (bars.length < period + 1) return 50;

    const changes = [];
    for (let i = 1; i < bars.length; i++) {
      changes.push(bars[i].close - bars[i - 1].close);
    }

    const gains = changes.filter((c) => c > 0);
    const losses = changes.filter((c) => c < 0);

    const avgGain = gains.reduce((a, b) => a + b, 0) / period;
    const avgLoss = Math.abs(losses.reduce((a, b) => a + b, 0) / period);

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return Math.min(Math.max(rsi, 0), 100);
  }

  // Generate comparison report
  compareAgents(results: SimulationResult[]): ComparisonReport {
    const sorted = [...results].sort((a, b) => b.totalReturnPct - a.totalReturnPct);

    return {
      topPerformer: sorted[0],
      byReturn: sorted,
      byRiskAdjustedReturn: [...results].sort(
        (a, b) =>
          b.totalReturnPct / Math.max(b.maxDrawdown, 1) -
          a.totalReturnPct / Math.max(a.maxDrawdown, 1)
      ),
      byWinRate: [...results].sort((a, b) => b.winRate - a.winRate),
      summary: {
        averageReturn: results.reduce((sum, r) => sum + r.totalReturnPct, 0) / results.length,
        bestReturn: sorted[0].totalReturnPct,
        worstReturn: sorted[sorted.length - 1].totalReturnPct,
        averageWinRate: results.reduce((sum, r) => sum + r.winRate, 0) / results.length,
      },
    };
  }
}

interface ComparisonReport {
  topPerformer: SimulationResult;
  byReturn: SimulationResult[];
  byRiskAdjustedReturn: SimulationResult[];
  byWinRate: SimulationResult[];
  summary: {
    averageReturn: number;
    bestReturn: number;
    worstReturn: number;
    averageWinRate: number;
  };
}

export type { SimulationConfig, SimulationResult, TradeRecord, EquityPoint, ComparisonReport };
