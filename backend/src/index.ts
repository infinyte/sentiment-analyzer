// BACKEND SERVER - index.ts
// Main Express application with API routes and scheduled jobs

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';
import type { Coin, Sentiment } from './types.js';
import { Cache } from './services/cache.js';
import { CoinGeckoService } from './services/coingecko.js';
import { NewsAPIService } from './services/newsapi.js';
import { SentimentService } from './services/sentiment.js';
import { SentimentAnalyzerEngine } from './services/sentiment-analyzer.js';
import type { MarketData, NewsData } from './services/sentiment-analyzer.js';
import { AgentFactory } from './services/trading-agent.js';
import type { AgentConfig } from './services/trading-agent.js';
import { BacktestingEngine } from './services/backtesting-engine.js';
import type { BacktestConfig } from './services/backtesting-engine.js';
import { storage } from './storage.js';
import marlRoutes from './routes/marl-competition.js';
import logger from './logger.js';

dotenv.config();

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));
app.use(express.json());

// HTTP request logger — records method, path, status, and duration for every request
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration_ms = Date.now() - start;
    const meta = { method: req.method, url: req.url, status: res.statusCode, duration_ms };
    if (res.statusCode >= 500) logger.error('request', meta);
    else if (res.statusCode >= 400) logger.warn('request', meta);
    else logger.info('request', meta);
  });
  next();
});

// Initialize services
const coingecko = new CoinGeckoService();
const newsapi = new NewsAPIService();
const sentiment = new SentimentService();
const cache = new Cache();
const sentimentCache = new Cache();
const analyzer = new SentimentAnalyzerEngine();
const backtestEngine = new BacktestingEngine();

// In-memory agent registry (cleared on restart)
const configuredAgents: Map<string, AgentConfig> = new Map();

// Connect SQLite storage (non-fatal — app runs in-memory if this fails)
try {
  storage.connect();
  const pruned = storage.pruneExpiredSentiment();
  if (pruned > 0) logger.info('storage pruned expired rows', { count: pruned });
} catch (err) {
  logger.warn('storage unavailable, using in-memory only', { error: String(err) });
}

// Graceful shutdown — close DB before process exits
process.on('SIGTERM', () => { storage.close(); process.exit(0); });
process.on('SIGINT',  () => { storage.close(); process.exit(0); });


// ============================================================================
// HELPER: Fetch and cache sentiment for a coin
// ============================================================================

async function fetchAndCacheSentiment(coin: Coin): Promise<void> {
  const cacheKey = `sentiment_${coin.symbol}`;

  // 1. Hot path: in-memory cache hit
  const cached = sentimentCache.get<Sentiment>(cacheKey);
  if (cached) {
    coin.sentiment_score = cached.sentiment_score;
    coin.sentiment_confidence = cached.confidence;
    coin.sentiment_summary = cached.summary;
    coin.trending_score = cached.trending_score;
    return;
  }

  // 2. Warm path: SQLite has a non-expired row from a previous run
  try {
    const persisted = storage.getSentiment(coin.symbol);
    if (persisted) {
      sentimentCache.set(cacheKey, persisted, 24 * 60 * 60 * 1000);
      coin.sentiment_score = persisted.sentiment_score;
      coin.sentiment_confidence = persisted.confidence;
      coin.sentiment_summary = persisted.summary;
      coin.trending_score = persisted.trending_score;
      return;
    }
  } catch {
    // SQLite unavailable — continue to live fetch
  }

  // 3. Cold path: fetch from APIs
  try {
    const headlines = await newsapi.getHeadlines(coin.name, 7);
    const sentimentData = await sentiment.analyzeSentiment(
      coin.symbol,
      headlines,
      coin.price_change_7d_percent,
      coin.volatility_24h
    );

    sentimentData.trending_score = headlines.length;

    // Store in both caches
    sentimentCache.set(cacheKey, sentimentData, 24 * 60 * 60 * 1000);
    try { storage.saveSentiment(coin.symbol, sentimentData); } catch { /* non-fatal */ }

    coin.sentiment_score = sentimentData.sentiment_score;
    coin.sentiment_confidence = sentimentData.confidence;
    coin.sentiment_summary = sentimentData.summary;
    coin.trending_score = sentimentData.trending_score;
  } catch (error) {
    logger.error('sentiment fetch failed', { symbol: coin.symbol, error: String(error) });
    // Keep defaults on error
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

// GET /api/coins - Fetch list of coins
app.get('/api/coins', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const sortBy = (req.query.sort_by as string) || 'market_cap';

    let coins = cache.get<Coin[]>('coins');

    if (!coins) {
      coins = await coingecko.getTopCoins(limit);
      cache.set('coins', coins, 5 * 60 * 1000);
    }

    // Fetch sentiment for each coin (cached separately with 24-hour TTL)
    await Promise.all(coins.map(coin => fetchAndCacheSentiment(coin)));

    // Apply sorting
    if (sortBy === 'volatility') {
      coins.sort((a, b) => b.volatility_24h - a.volatility_24h);
    } else if (sortBy === 'sentiment') {
      const order = { BULL: 0, NEUTRAL: 1, BEAR: 2 };
      coins.sort(
        (a, b) =>
          order[a.sentiment_score] - order[b.sentiment_score] ||
          b.sentiment_confidence - a.sentiment_confidence
      );
    }

    res.json({
      data: coins,
      last_updated: new Date(),
      count: coins.length,
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/coins', error: String(error) });
    res.status(500).json({ error: 'Failed to fetch coins' });
  }
});

// GET /api/coins/:symbol - Get detailed coin report
app.get('/api/coins/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);

    // Reuse the cached coin list rather than fetching 200 coins on every modal open
    const allCoins = cache.get<Coin[]>('coins') || await coingecko.getTopCoins(200);
    const coin = allCoins.find(c => c.symbol === symbol.toUpperCase());

    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }

    // Fetch sentiment for this coin (also sets trending_score via cache)
    await fetchAndCacheSentiment(coin);

    const historyKey = `history_${coin.id}_${days}`;
    const priceHistory = cache.get<object[]>(historyKey) || await (async () => {
      const data = await coingecko.getCoinHistory(coin.id, days);
      cache.set(historyKey, data, 15 * 60 * 1000);
      return data;
    })();

    const headlinesKey = `headlines_${coin.id}_${days}`;
    const headlines = cache.get<string[]>(headlinesKey) || await (async () => {
      const data = await newsapi.getHeadlines(coin.name, days);
      cache.set(headlinesKey, data, 15 * 60 * 1000);
      return data;
    })();

    res.json({
      coin,
      price_history: priceHistory,
      sentiment_today: {
        sentiment_score: coin.sentiment_score,
        confidence: coin.sentiment_confidence,
        summary: coin.sentiment_summary,
      },
      headlines: headlines.slice(0, 10),
      news_count: headlines.length,
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/coins/:symbol', error: String(error) });
    res.status(500).json({ error: 'Failed to fetch coin details' });
  }
});

// POST /api/refresh-sentiment - Trigger sentiment analysis (admin only)
app.post('/api/refresh-sentiment', async (req, res) => {
  try {
    const token = req.headers['x-api-key'];
    if (token !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { symbols } = req.body;
    const jobId = `job_${Date.now()}`;

    res.status(202).json({
      job_id: jobId,
      status: 'processing',
      coins_to_process: symbols?.length || 'all',
    });

    // Process sentiment in background
    (async () => {
      try {
        // Use cached coin list if available, otherwise fetch fresh
        let coins: Coin[] = cache.get<Coin[]>('coins') || await coingecko.getTopCoins(
          parseInt(process.env.SENTIMENT_BATCH_SIZE || '50')
        );

        // Filter to specific symbols if provided
        if (symbols && Array.isArray(symbols) && symbols.length > 0) {
          const upperSymbols = symbols.map((s: string) => s.toUpperCase());
          coins = coins.filter(c => upperSymbols.includes(c.symbol));
        }

        logger.info('sentiment refresh started', { jobId, coinCount: coins.length });

        // Clear sentiment cache entries first so fetchAndCacheSentiment re-analyzes
        for (const coin of coins) {
          sentimentCache.delete(`sentiment_${coin.symbol}`);
        }

        // Analyze sequentially to respect NewsAPI and Claude rate limits
        for (const coin of coins) {
          await fetchAndCacheSentiment(coin);
          logger.info('sentiment refreshed', { jobId, symbol: coin.symbol, sentiment: coin.sentiment_score });
        }

        logger.info('sentiment refresh completed', { jobId, coinCount: coins.length });
      } catch (error) {
        logger.error('sentiment refresh failed', { jobId, error: String(error) });
      }
    })();
  } catch (error) {
    logger.error('route error', { endpoint: '/api/refresh-sentiment', error: String(error) });
    res.status(500).json({ error: 'Failed to queue job' });
  }
});

// GET /api/sentiment/:symbol - Get cached sentiment for a coin
app.get('/api/sentiment/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = sentimentCache.get<Sentiment>(`sentiment_${symbol}`);

  if (!cached) {
    return res.status(404).json({ error: `No sentiment data for ${symbol}` });
  }

  res.json(cached);
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  const claudeStatus = process.env.CLAUDE_API_KEY ? 'ok' : 'misconfigured';
  const newsapiStatus = process.env.NEWSAPI_API_KEY ? 'ok' : 'misconfigured';
  const sqliteStatus = storage.isHealthy() ? 'ok' : 'unavailable';
  const allHealthy = claudeStatus === 'ok' && newsapiStatus === 'ok';

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services: {
      coingecko: 'ok',
      newsapi: newsapiStatus,
      claude_api: claudeStatus,
      sqlite: sqliteStatus,
    },
    uptime_seconds: process.uptime(),
  });
});

// ============================================================================
// PHASE 1: ADVANCED SENTIMENT & TRADING ROUTES
// ============================================================================

// POST /api/sentiment/analyze
// Run sentiment analysis in one of 4 modes across one or more symbols.
app.post('/api/sentiment/analyze', async (req, res) => {
  try {
    const { symbols, mode, headlines, marketData, technicalData } = req.body as {
      symbols?: string[];
      mode?: 'BASIC' | 'ADVANCED' | 'TRADING_SIGNALS' | 'SMART';
      headlines?: Record<string, string[]>;
      marketData?: Record<string, MarketData>;
      technicalData?: Record<string, { rsi_14?: number; price_history?: number[] }>;
    };

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: '"symbols" array is required' });
    }
    const analysisMode = mode ?? 'BASIC';

    // For ADVANCED / TRADING_SIGNALS / SMART modes, at least marketData must be supplied.
    if (analysisMode !== 'BASIC' && !marketData) {
      return res.status(400).json({
        error: '"marketData" is required for ADVANCED, TRADING_SIGNALS, and SMART modes',
      });
    }

    const results: Record<string, unknown> = {};

    for (const rawSym of symbols) {
      const sym = rawSym.toUpperCase();
      const symHeadlines = headlines?.[sym] ?? headlines?.[rawSym] ?? [];
      const market = marketData?.[sym] ?? marketData?.[rawSym];
      const technical = technicalData?.[sym] ?? technicalData?.[rawSym];

      if (analysisMode === 'BASIC') {
        results[sym] = analyzer.analyzeBasicSentiment(sym, symHeadlines);
      } else if (analysisMode === 'ADVANCED') {
        if (!market) { results[sym] = { error: 'No marketData for symbol' }; continue; }
        const news: NewsData = {
          headlines: symHeadlines,
          sentiment_score: 'NEUTRAL',
          sentiment_confidence: 0,
          sentiment_summary: '',
        };
        results[sym] = analyzer.analyzeAdvancedSentiment(market, news, technical);
      } else if (analysisMode === 'TRADING_SIGNALS') {
        if (!market) { results[sym] = { error: 'No marketData for symbol' }; continue; }
        const news: NewsData = {
          headlines: symHeadlines,
          sentiment_score: 'NEUTRAL',
          sentiment_confidence: 0,
          sentiment_summary: '',
        };
        const cachedSentiment = sentimentCache.get<Sentiment>(`sentiment_${sym}`);
        const sentimentInput = cachedSentiment ?? {
          symbol: sym, analysis_date: new Date().toISOString().split('T')[0],
          sentiment_score: 'NEUTRAL' as const, confidence: 0, summary: '',
          key_catalysts: [], risk_factors: [], short_term_outlook: '',
          volatility_warning: false, trending_score: 0,
        };
        results[sym] = analyzer.generateTradingSignals(market, news, sentimentInput, technical);
      } else {
        // SMART
        if (!market) { results[sym] = { error: 'No marketData for symbol' }; continue; }
        const news: NewsData = {
          headlines: symHeadlines,
          sentiment_score: 'NEUTRAL',
          sentiment_confidence: 0,
          sentiment_summary: '',
        };
        results[sym] = analyzer.analyzeSmartSentiment(market, news, technical);
      }
    }

    res.json({ mode: analysisMode, results });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/sentiment/analyze', error: String(error) });
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// POST /api/agents/configure
// Register one or more trading agents for use in backtesting.
app.post('/api/agents/configure', (req, res) => {
  try {
    const { agents } = req.body as {
      agents?: Array<Partial<AgentConfig> & { name?: string }>;
    };

    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ error: '"agents" array is required' });
    }

    const configured: AgentConfig[] = [];
    for (const cfg of agents) {
      if (!cfg.type || !cfg.riskProfile) {
        return res.status(400).json({ error: 'Each agent needs "type" and "riskProfile"' });
      }
      const agentId = cfg.agentId ?? cfg.name ?? `${cfg.type}_${cfg.riskProfile}_${Date.now()}`;
      const fullConfig: AgentConfig = {
        agentId,
        type: cfg.type,
        riskProfile: cfg.riskProfile,
        initialCapital: cfg.initialCapital ?? 10_000,
      };
      configuredAgents.set(agentId, fullConfig);
      configured.push(fullConfig);
    }

    res.json({
      configured: configured.length,
      agents: configured.map(({ agentId, type, riskProfile, initialCapital }) => ({
        agentId, type, riskProfile, initialCapital,
      })),
      readyForBacktesting: true,
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/agents/configure', error: String(error) });
    res.status(500).json({ error: 'Agent configuration failed' });
  }
});

// POST /api/backtest/run
// Run a backtest simulation over historical CoinGecko data.
app.post('/api/backtest/run', async (req, res) => {
  try {
    const body = req.body as {
      symbols?: string[];
      startDate?: string;
      endDate?: string;
      agents?: Array<Partial<AgentConfig> & { name?: string }>;
      slippageModel?: BacktestConfig['slippageModel'];
      commissionPct?: number;
    };

    if (!body.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return res.status(400).json({ error: '"symbols" array is required' });
    }
    if (!body.startDate || !body.endDate) {
      return res.status(400).json({ error: '"startDate" and "endDate" are required (YYYY-MM-DD)' });
    }

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate >= endDate) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    // Resolve agent configs: use inline definitions or fall back to configured registry
    let agentConfigs: AgentConfig[];
    if (body.agents && body.agents.length > 0) {
      agentConfigs = body.agents.map((cfg) => ({
        agentId: cfg.agentId ?? cfg.name ?? `${cfg.type}_${cfg.riskProfile}_${Date.now()}`,
        type: cfg.type ?? 'RULE_BASED',
        riskProfile: cfg.riskProfile ?? 'CONSERVATIVE',
        initialCapital: cfg.initialCapital ?? 10_000,
      }));
    } else if (configuredAgents.size > 0) {
      agentConfigs = Array.from(configuredAgents.values());
    } else {
      // Default: one conservative rule-based agent
      agentConfigs = [{ agentId: 'default', type: 'RULE_BASED', riskProfile: 'CONSERVATIVE', initialCapital: 10_000 }];
    }

    const config: BacktestConfig = {
      symbols: body.symbols.map((s) => s.toUpperCase()),
      startDate,
      endDate,
      agentConfigs,
      slippageModel: body.slippageModel ?? 'FIXED',
      commissionPct: body.commissionPct ?? 0.001,
    };

    const result = await backtestEngine.runSimulation(config);

    // Persist result to SQLite so it survives a restart
    try { storage.saveBacktestResult(result); } catch { /* non-fatal */ }

    res.json({
      testId: result.testId,
      status: 'COMPLETED',
      results: result.agentResults.map((r) => ({
        agentId: r.agentId,
        agentType: r.agentType,
        riskProfile: r.riskProfile,
        totalReturnPct: parseFloat((r.metrics.totalReturnPct * 100).toFixed(2)),
        winRate: parseFloat((r.metrics.winRate * 100).toFixed(1)),
        profitFactor: parseFloat(r.metrics.profitFactor.toFixed(2)),
        maxDrawdown: parseFloat((r.metrics.maxDrawdown * 100).toFixed(2)),
        sharpeRatio: parseFloat(r.metrics.sharpeRatio.toFixed(2)),
        totalTrades: r.metrics.totalTrades,
        trades: r.trades.map((t) => ({
          symbol: t.symbol,
          signal: t.signal,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          pnl: parseFloat(t.pnl.toFixed(2)),
          pnlPct: parseFloat((t.pnlPct * 100).toFixed(2)),
          holdDays: t.holdDays,
          exitReason: t.exitReason,
        })),
      })),
      topPerformer: result.comparison.topPerformerByReturn,
      summary: {
        averageReturn: parseFloat((result.comparison.averageReturn * 100).toFixed(2)),
        bestReturn: parseFloat((result.comparison.bestReturn * 100).toFixed(2)),
        worstReturn: parseFloat((result.comparison.worstReturn * 100).toFixed(2)),
        averageWinRate: parseFloat((result.comparison.averageWinRate * 100).toFixed(1)),
        narrative: result.comparison.summary,
      },
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/backtest/run', error: String(error) });
    res.status(500).json({ error: 'Backtest simulation failed' });
  }
});

// GET /api/backtest/results/:testId
// Retrieve full details (equity curves, all trades) for a completed backtest.
// Falls back to SQLite when the result is no longer in the engine's in-memory store.
app.get('/api/backtest/results/:testId', (req, res) => {
  const testId = req.params.testId;
  const result = backtestEngine.getResult(testId) ?? storage.getBacktestResult(testId);
  if (!result) {
    return res.status(404).json({ error: 'Backtest result not found' });
  }
  res.json(result);
});

// GET /api/rankings/top-coins
// Rank coins by composite smart-sentiment score for a given timeframe.
app.get('/api/rankings/top-coins', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const coins = cache.get<Coin[]>('coins') ?? await coingecko.getTopCoins(limit);
    await Promise.all(coins.slice(0, limit).map((c) => fetchAndCacheSentiment(c)));

    const ranked = analyzer.rankCoinsForTimeframe(coins.slice(0, limit));

    res.json({
      timeframe: (req.query.timeframe as string) ?? '1d',
      sentimentMode: 'SMART',
      coins: ranked.map((r) => ({
        rank: r.rank,
        symbol: r.coin.symbol,
        name: r.coin.name,
        sentiment: r.coin.sentiment_score,
        confidence: parseFloat(r.coin.sentiment_confidence.toFixed(3)),
        compositeScore: parseFloat(r.composite_score.toFixed(3)),
        price_usd: r.coin.price_usd,
        price_change_7d_percent: r.coin.price_change_7d_percent,
        market_rank: r.coin.market_rank,
      })),
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/rankings/top-coins', error: String(error) });
    res.status(500).json({ error: 'Failed to compute rankings' });
  }
});

// GET /api/info/modes
// Documentation endpoint — lists all analysis modes, agent types, and risk profiles.
app.get('/api/info/modes', (_req, res) => {
  res.json({
    analysisMode: {
      BASIC: 'Keyword-based headline scoring → BULL / NEUTRAL / BEAR + confidence.',
      ADVANCED: 'Multi-factor scoring: news, momentum, volatility, volume, RSI.',
      TRADING_SIGNALS: 'BUY / SELL / HOLD signal with target prices and stop-loss.',
      SMART: 'Adaptive weighting that shifts with market regime (trending vs. consolidating).',
    },
    agentTypes: {
      RULE_BASED: 'Hard if-then rules based on signal strength and confidence thresholds.',
      ML_BASED: 'Weighted scoring entry model; weights updated from backtest outcomes.',
      HYBRID: 'Acts only when RuleBasedAgent and MLBasedAgent agree on direction.',
    },
    riskProfiles: {
      CONSERVATIVE: { maxRiskPct: '1%', stopLoss: '2%', takeProfit: '5%', maxHoldDays: 5 },
      AGGRESSIVE:   { maxRiskPct: '5%', stopLoss: '8%', takeProfit: '20%', maxHoldDays: 14 },
      SCALPING:     { maxRiskPct: '3%', stopLoss: '1.5%', takeProfit: '3%', maxHoldDays: 2 },
    },
    slippageModels: {
      FIXED: '0.1% slippage on every order.',
      VOLUME_BASED: '0.2% slippage (simulates thinner liquidity).',
      MARKET_IMPACT: '0.3% slippage (simulates large-order price impact).',
    },
  });
});

// ============================================================================
// MARL COMPETITION ROUTES (Phase 2)
// ============================================================================

app.use(marlRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================================================
// START SERVER
// ============================================================================

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    logger.info('server started', { port, env: process.env.NODE_ENV || 'development' });
  });
}

// ============================================================================
// SCHEDULED SENTIMENT JOB
// ============================================================================

const cronSchedule = process.env.SENTIMENT_JOB_CRON || '0 2 * * *';

cron.schedule(cronSchedule, async () => {
  const batchSize = parseInt(process.env.SENTIMENT_BATCH_SIZE || '50');
  const started = Date.now();
  logger.info('cron started', { batchSize, schedule: cronSchedule });

  try {
    const coins = await coingecko.getTopCoins(batchSize);

    // Force re-analysis by clearing existing sentiment cache entries
    for (const coin of coins) {
      sentimentCache.delete(`sentiment_${coin.symbol}`);
    }

    for (const coin of coins) {
      await fetchAndCacheSentiment(coin);
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    logger.info('cron completed', { coinCount: coins.length, elapsed_s: elapsed });
  } catch (error) {
    logger.error('cron failed', { error: String(error) });
  }
});

export default app;
