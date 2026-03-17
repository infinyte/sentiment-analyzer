API ENDPOINTS - SENTIMENT & TRADING
===================================

File: backend/src/routes/sentiment-trading.ts

These endpoints tie together:
- Sentiment analysis (4 modes)
- Trading agent selection (3 types × 3 profiles)
- Backtesting execution
- Results & rankings

---

ENDPOINTS OVERVIEW
==================

POST /api/sentiment/analyze
  - Analyze sentiment for one or multiple coins
  - Select mode: BASIC, ADVANCED, TRADING_SIGNALS, SMART
  - Returns sentiment scores + trading signals

POST /api/agents/configure
  - Create agent configuration
  - Select: agent type (RULE/ML/HYBRID)
  - Select: risk profile (CONSERVATIVE/AGGRESSIVE/SCALPING)
  - Set initial capital

POST /api/backtest/run
  - Execute backtest with agents against historical data
  - Select coins, date range, agent configs
  - Returns performance metrics, trade history, equity curves

GET /api/rankings/top-coins
  - Get top coins for 1/3/5 day trading
  - Filtered by sentiment mode, timeframe
  - Ranked by expected return, risk-adjusted metrics

GET /api/backtest/results/:testId
  - Get detailed results from completed backtest
  - Includes equity curves, trade analysis, comparisons

---

IMPLEMENTATION

import express, { Router, Request, Response } from "express";
import { SentimentAnalyzerEngine } from "../services/sentiment-analyzer";
import { AgentFactory, TradingAgent } from "../services/trading-agent";
import { BacktestingEngine, SimulationResult } from "../services/backtesting-engine";

const router = Router();
const sentiment = new SentimentAnalyzerEngine();
const backtesting = new BacktestingEngine();

// Store active backtests
const activeBacktests: Map<string, SimulationResult[]> = new Map();

// ========================================
// SENTIMENT ANALYSIS ENDPOINT
// ========================================

/**
 * POST /api/sentiment/analyze
 *
 * Request body:
 * {
 *   "symbols": ["BTC", "ETH", "SOL"],
 *   "mode": "SMART" | "BASIC" | "ADVANCED" | "TRADING_SIGNALS",
 *   "headlines": {
 *     "BTC": ["headline1", "headline2", ...],
 *     ...
 *   }
 * }
 *
 * Response:
 * {
 *   "results": {
 *     "BTC": { sentiment analysis result },
 *     ...
 *   }
 * }
 */
router.post("/api/sentiment/analyze", async (req: Request, res: Response) => {
  try {
    const { symbols, mode, headlines, marketData, technicalData } = req.body;

    if (!symbols || !Array.isArray(symbols)) {
      return res.status(400).json({ error: "Invalid symbols array" });
    }

    const validModes = ["BASIC", "ADVANCED", "TRADING_SIGNALS", "SMART"];
    const selectedMode = mode || "SMART";

    if (!validModes.includes(selectedMode)) {
      return res.status(400).json({ error: `Invalid mode. Use: ${validModes.join(", ")}` });
    }

    const results: Record<string, any> = {};

    for (const symbol of symbols) {
      const coinHeadlines = headlines?.[symbol] || [];

      switch (selectedMode) {
        case "BASIC":
          results[symbol] = await sentiment.analyzeBasicSentiment(symbol, coinHeadlines);
          break;

        case "ADVANCED":
          const market = marketData?.[symbol];
          const news = {
            headlines: coinHeadlines,
            sentiment_by_source: {},
            recency_score: 0.8,
          };
          const technical = technicalData?.[symbol];

          if (market) {
            results[symbol] = await sentiment.analyzeAdvancedSentiment(market, news, technical);
          } else {
            return res
              .status(400)
              .json({ error: `Market data required for ${symbol} in ADVANCED mode` });
          }
          break;

        case "TRADING_SIGNALS":
          const marketSignal = marketData?.[symbol];
          const newsSignal = {
            headlines: coinHeadlines,
            sentiment_by_source: {},
            recency_score: 0.8,
          };
          const technicalSignal = technicalData?.[symbol];

          if (marketSignal) {
            const advancedSent = await sentiment.analyzeAdvancedSentiment(
              marketSignal,
              newsSignal,
              technicalSignal
            );
            results[symbol] = await sentiment.generateTradingSignals(
              marketSignal,
              newsSignal,
              advancedSent,
              technicalSignal
            );
          } else {
            return res
              .status(400)
              .json({ error: `Market data required for ${symbol} in TRADING_SIGNALS mode` });
          }
          break;

        case "SMART":
          const marketSmart = marketData?.[symbol];
          const newsSmart = {
            headlines: coinHeadlines,
            sentiment_by_source: {},
            recency_score: 0.8,
          };
          const technicalSmart = technicalData?.[symbol];

          if (marketSmart) {
            results[symbol] = await sentiment.analyzeSmartSentiment(
              marketSmart,
              newsSmart,
              technicalSmart
            );
          } else {
            return res
              .status(400)
              .json({ error: `Market data required for ${symbol} in SMART mode` });
          }
          break;
      }
    }

    res.json({
      mode: selectedMode,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("Sentiment analysis error:", error);
    res.status(500).json({ error: "Sentiment analysis failed" });
  }
});

// ========================================
// AGENT CONFIGURATION ENDPOINT
// ========================================

/**
 * POST /api/agents/configure
 *
 * Request body:
 * {
 *   "agents": [
 *     {
 *       "name": "Conservative Bot",
 *       "type": "RULE_BASED",
 *       "riskProfile": "CONSERVATIVE",
 *       "initialCapital": 10000
 *     },
 *     {
 *       "name": "ML Aggressive",
 *       "type": "ML_BASED",
 *       "riskProfile": "AGGRESSIVE",
 *       "initialCapital": 10000
 *     },
 *     {
 *       "name": "Hybrid Scalper",
 *       "type": "HYBRID",
 *       "riskProfile": "SCALPING",
 *       "initialCapital": 5000
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   "agents": [
 *     {
 *       "agentId": "uuid-or-name",
 *       "type": "...",
 *       "riskProfile": "...",
 *       "initialCapital": 10000
 *     }
 *   ]
 * }
 */
router.post("/api/agents/configure", (req: Request, res: Response) => {
  try {
    const { agents: agentConfigs } = req.body;

    if (!Array.isArray(agentConfigs) || agentConfigs.length === 0) {
      return res.status(400).json({ error: "agents array required" });
    }

    const validTypes = ["RULE_BASED", "ML_BASED", "HYBRID"];
    const validProfiles = ["CONSERVATIVE", "AGGRESSIVE", "SCALPING"];

    const agents = agentConfigs.map((config: any, index: number) => {
      if (!validTypes.includes(config.type)) {
        throw new Error(`Invalid agent type: ${config.type}`);
      }
      if (!validProfiles.includes(config.riskProfile)) {
        throw new Error(`Invalid risk profile: ${config.riskProfile}`);
      }

      const agentId = config.name || `Agent_${index + 1}`;
      return {
        agentId,
        type: config.type,
        riskProfile: config.riskProfile,
        initialCapital: config.initialCapital || 10000,
      };
    });

    res.json({
      configured: agents.length,
      agents,
      message: "Agents configured successfully. Ready for backtesting.",
    });
  } catch (error: any) {
    console.error("Agent configuration error:", error);
    res.status(400).json({ error: error.message });
  }
});

// ========================================
// BACKTESTING ENDPOINT
// ========================================

/**
 * POST /api/backtest/run
 *
 * Request body:
 * {
 *   "symbols": ["BTC", "ETH", "SOL"],
 *   "startDate": "2023-09-16",
 *   "endDate": "2024-03-16",
 *   "agents": [
 *     {
 *       "name": "Conservative",
 *       "type": "RULE_BASED",
 *       "riskProfile": "CONSERVATIVE",
 *       "initialCapital": 10000
 *     }
 *   ],
 *   "slippageModel": "FIXED",
 *   "commissionPct": 0.1
 * }
 *
 * Response:
 * {
 *   "testId": "uuid",
 *   "status": "RUNNING" | "COMPLETED",
 *   "progress": 0-100,
 *   "results": [ ... ]
 * }
 */
router.post("/api/backtest/run", async (req: Request, res: Response) => {
  try {
    const {
      symbols,
      startDate,
      endDate,
      agents: agentConfigs,
      slippageModel = "FIXED",
      commissionPct = 0.1,
    } = req.body;

    // Validate input
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "symbols array required" });
    }

    if (!Array.isArray(agentConfigs) || agentConfigs.length === 0) {
      return res.status(400).json({ error: "agents array required" });
    }

    // Create agents
    const agents = agentConfigs.map((config: any) =>
      AgentFactory.createAgent(
        config.name || `Agent_${Math.random().toString(36).substr(2, 9)}`,
        config.type,
        config.riskProfile,
        config.initialCapital || 10000
      )
    );

    // Run simulation
    const config = {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      symbols,
      agents,
      slippageModel: slippageModel as "FIXED" | "VOLUME_BASED" | "MARKET_IMPACT",
      commissionPct,
      refreshSentimentDaily: true,
    };

    const results = await backtesting.runSimulation(config);

    // Store results
    const testId = `backtest_${Date.now()}`;
    activeBacktests.set(testId, results);

    // Generate comparison
    const comparison = backtesting.compareAgents(results);

    res.json({
      testId,
      status: "COMPLETED",
      timestamp: new Date().toISOString(),
      config: {
        symbols,
        startDate: startDate,
        endDate: endDate,
        agentCount: agents.length,
      },
      results: results.map((r) => ({
        agentId: r.agentId,
        agentType: r.agentType,
        riskProfile: r.riskProfile,
        startingCapital: r.startingCapital,
        endingCapital: r.endingCapital,
        totalReturnPct: r.totalReturnPct.toFixed(2),
        winRate: r.winRate.toFixed(2),
        profitFactor: r.profitFactor.toFixed(2),
        maxDrawdown: r.maxDrawdown.toFixed(2),
        sharpeRatio: r.sharpeRatio.toFixed(2),
        totalTrades: r.totalTrades,
      })),
      topPerformer: {
        agentId: comparison.topPerformer.agentId,
        totalReturnPct: comparison.topPerformer.totalReturnPct.toFixed(2),
        riskProfile: comparison.topPerformer.riskProfile,
      },
      summary: {
        averageReturn: comparison.summary.averageReturn.toFixed(2),
        bestReturn: comparison.summary.bestReturn.toFixed(2),
        worstReturn: comparison.summary.worstReturn.toFixed(2),
        averageWinRate: comparison.summary.averageWinRate.toFixed(2),
      },
    });
  } catch (error: any) {
    console.error("Backtesting error:", error);
    res.status(500).json({ error: error.message || "Backtesting failed" });
  }
});

// ========================================
// BACKTEST RESULTS ENDPOINT
// ========================================

/**
 * GET /api/backtest/results/:testId
 *
 * Returns detailed results including:
 * - Trade history
 * - Equity curve
 * - Performance metrics
 * - Agent comparison
 */
router.get("/api/backtest/results/:testId", (req: Request, res: Response) => {
  try {
    const { testId } = req.params;
    const results = activeBacktests.get(testId);

    if (!results) {
      return res.status(404).json({ error: "Backtest not found" });
    }

    // Return detailed results
    const detailedResults = results.map((result) => ({
      agentId: result.agentId,
      agentType: result.agentType,
      riskProfile: result.riskProfile,
      metrics: {
        startingCapital: result.startingCapital,
        endingCapital: result.endingCapital,
        totalReturn: result.totalReturn.toFixed(2),
        totalReturnPct: result.totalReturnPct.toFixed(2),
        winRate: result.winRate.toFixed(2),
        profitFactor: result.profitFactor.toFixed(2),
        maxDrawdown: result.maxDrawdown.toFixed(2),
        sharpeRatio: result.sharpeRatio.toFixed(2),
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        avgWinSize: result.avgWinSize.toFixed(2),
        avgLossSize: result.avgLossSize.toFixed(2),
        avgTradeTime: result.avgTradeTime.toFixed(2),
      },
      trades: result.trades.slice(0, 50), // First 50 trades
      equityHistory: result.equityHistory.filter((_, i) => i % 7 === 0), // Weekly snapshots
    }));

    res.json({
      testId,
      resultsCount: results.length,
      results: detailedResults,
    });
  } catch (error: any) {
    console.error("Results retrieval error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// TOP COINS RANKING ENDPOINT
// ========================================

/**
 * GET /api/rankings/top-coins
 *
 * Query parameters:
 * - timeframe: "1d" | "3d" | "5d"
 * - sentimentMode: "BASIC" | "ADVANCED" | "TRADING_SIGNALS" | "SMART"
 * - limit: default 20
 *
 * Response:
 * {
 *   "timeframe": "3d",
 *   "mode": "SMART",
 *   "coins": [
 *     {
 *       "rank": 1,
 *       "symbol": "SOL",
 *       "sentiment": "BULL",
 *       "confidence": 0.87,
 *       "expectedReturn": 8.5,
 *       "riskAdjustedReturn": 4.2,
 *       "signal": "BUY",
 *       "strength": 78
 *     }
 *   ]
 * }
 */
router.get("/api/rankings/top-coins", (req: Request, res: Response) => {
  try {
    const { timeframe = "3d", sentimentMode = "SMART", limit = 20 } = req.query;

    // This would fetch from database in production
    // For now, return mock data structure
    res.json({
      timeframe,
      sentimentMode,
      timestamp: new Date().toISOString(),
      coins: [
        {
          rank: 1,
          symbol: "SOL",
          name: "Solana",
          sentiment: "BULL",
          confidence: 0.87,
          expectedReturn: 8.5,
          riskAdjustedReturn: 4.2,
          signal: "BUY",
          strength: 78,
          volatility: 4.2,
          topReason: "Strong social sentiment + positive technical setup",
        },
        {
          rank: 2,
          symbol: "ETH",
          name: "Ethereum",
          sentiment: "BULL",
          confidence: 0.82,
          expectedReturn: 6.3,
          riskAdjustedReturn: 3.8,
          signal: "BUY",
          strength: 72,
          volatility: 3.8,
          topReason: "Institutional interest + bullish technicals",
        },
      ],
      note: "Connect to database for live rankings",
    });
  } catch (error: any) {
    console.error("Rankings error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// SIMULATION MODE DOCUMENTATION
// ========================================

router.get("/api/info/modes", (req: Request, res: Response) => {
  res.json({
    sentimentModes: {
      BASIC: {
        description: "Simple bullish/bearish/neutral classification",
        inputs: ["headlines"],
        complexity: "Low",
      },
      ADVANCED: {
        description: "Multi-factor analysis with volatility, volume, technical",
        inputs: ["sentiment", "volatility", "volume", "momentum", "technical"],
        complexity: "Medium",
      },
      TRADING_SIGNALS: {
        description: "Direct BUY/SELL/HOLD signals with target prices",
        inputs: ["all advanced factors"],
        complexity: "High",
      },
      SMART: {
        description: "Adaptive combination of factors based on coin characteristics",
        inputs: ["all available data"],
        complexity: "Highest",
        factors: [
          "Sentiment strength",
          "Volatility",
          "Trading volume",
          "Price momentum",
          "Headline recency",
          "Technical indicators",
          "Crowd sentiment",
        ],
      },
    },
    agentTypes: {
      RULE_BASED: {
        description: "Hardcoded decision rules, fast and explainable",
        pros: ["Deterministic", "Fast", "Easy to understand"],
        cons: ["Limited adaptability", "No learning"],
      },
      ML_BASED: {
        description: "Learns from historical backtesting patterns",
        pros: ["Adapts to market", "Learns from data", "Long-term effective"],
        cons: ["Slower training", "Black box", "Requires data"],
      },
      HYBRID: {
        description: "Rules refined by ML, best of both worlds",
        pros: ["Explainable + adaptive", "Confidence boost", "Balanced"],
        cons: ["Complex", "Medium speed"],
      },
    },
    riskProfiles: {
      CONSERVATIVE: {
        description: "Small positions, tight stops, frequent exits",
        maxRiskPerTrade: "1%",
        positionSize: "Small",
        holdTime: "Long term",
      },
      AGGRESSIVE: {
        description: "Large positions, hold through noise, higher risk",
        maxRiskPerTrade: "5%",
        positionSize: "Large",
        holdTime: "Medium term",
      },
      SCALPING: {
        description: "Quick trades, high volume, low hold time",
        maxRiskPerTrade: "3%",
        positionSize: "Medium",
        holdTime: "Hours",
      },
    },
  });
});

export default router;
