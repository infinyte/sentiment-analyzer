// BACKEND SERVER - index.ts
// Main Express application with API routes and scheduled jobs

// reflect-metadata MUST be the first import so the Reflect polyfill is
// installed before tsyringe (via container.ts) reads any class metadata.
import 'reflect-metadata';
import { container, TOKENS } from './container.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import type { Coin, OnChainMetrics, Sentiment, TrendingSentiment } from './types.js';
import type { SentimentMomentum, TrendingTopicRecord } from './types/social-media.js';
import { Cache } from './services/cache.js';
import { CoinGeckoService } from './services/coingecko.js';
import { ContentSignalService } from './services/content-signals.js';
import { SentimentService } from './services/sentiment.js';
import { SentimentAnalyzerEngine } from './services/sentiment-analyzer.js';
import type { MarketData, NewsData } from './services/sentiment-analyzer.js';
import { finBertService } from './services/finbert.js';
import { onChainService } from './services/onchain.js';
import type { AgentConfig } from './services/trading-agent.js';
import type { BacktestConfig } from './services/backtesting-engine.js';
import { workerPool } from './services/worker-pool.js';
import { storage } from './storage.js';
import { createRepositories } from './repositories/factory.js';
import { socialStore } from './database/sqlite-social-store.js';
import marlRoutes from './routes/marl-competition.js';
import { createMarlRealTradingRouter } from './routes/marl-real-trading.js';
import socialMediaRoutes from './routes/social-media.js';
import { createAgentStatsRouter } from './routes/agent-stats.js';
import { createEvolutionaryRouter } from './routes/evolutionary.js';
import { createTradingRouter }      from './routes/trading.js';
import { SocialScraperService } from './services/social-scraper.js';
import type { ScrapedPost, SocialPlatform } from './services/social-scraper.js';
import { TrendingTopicsEngine } from './services/trending-topics.js';
import { SocialMediaScraperManager } from './services/social-media/scraper/scraper-manager.js';
import { TrendingTopicDiscoveryEngine } from './services/social-media/trending/trending-discovery-engine.js';
import { MultiSourceTrendingScoreCalculator } from './services/social-media/trending/multi-source-calculator.js';
import { ingestQueue } from './services/social-media/ingest-queue.js';
import { getScraperQueue } from './queues/scraper.queue.js';
import { isQueueAvailable } from './queues/connection.js';
import logger from './logger.js';

dotenv.config();

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================

const app = express();
export const port = process.env.PORT || 3000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-eval'"],
      },
    },
  })
);
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

// Initialize services via DI container
const coingecko          = container.resolve<CoinGeckoService>(TOKENS.CoinGeckoService);
const contentSignals     = container.resolve<ContentSignalService>(TOKENS.ContentSignalService);
const sentiment          = container.resolve<SentimentService>(TOKENS.SentimentService);
const cache              = container.resolve<Cache>(TOKENS.Cache);
const sentimentCache     = container.resolve<Cache>(TOKENS.SentimentCache);
const analyzer           = container.resolve<SentimentAnalyzerEngine>(TOKENS.SentimentAnalyzerEngine);
// backtestEngine removed — POST /api/backtest/run now uses workerPool.runBacktest().
const socialScraper      = container.resolve<SocialScraperService>(TOKENS.SocialScraperService);
const trendingEngine     = container.resolve<TrendingTopicsEngine>(TOKENS.TrendingTopicsEngine);
const socialScraperManager  = container.resolve<SocialMediaScraperManager>(TOKENS.SocialMediaScraperManager);
const socialDiscoveryEngine = container.resolve<TrendingTopicDiscoveryEngine>(TOKENS.TrendingTopicDiscoveryEngine);
const trendCalculator       = container.resolve<MultiSourceTrendingScoreCalculator>(TOKENS.MultiSourceTrendingScoreCalculator);

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

// Connect social media SQLite store (shares same DB file; non-fatal)
try {
  socialStore.connect();
} catch (err) {
  logger.warn('social-store unavailable', { error: String(err) });
}

// Warn about any open real-trading orders that survived a restart.
// Broker adapters do NOT survive restarts — admin must re-POST
// /api/marl/broker/connect/:id to reconnect before running PAPER/LIVE competitions.
export function logOpenBrokerOrderWarning(): void {
  try {
    const openOrders = storage.getOpenBrokerOrders();
    if (openOrders.length > 0) {
      logger.warn('open real-trading orders found from previous session — broker adapters not connected, re-connect via POST /api/marl/broker/connect/:id', {
        count: openOrders.length,
        competitionIds: [...new Set(openOrders.map(o => o.competitionId))],
      });
    }
  } catch {
    /* storage may not be connected yet */
  }
}


// ============================================================================
// HELPER: Fetch and cache sentiment for a coin
// ============================================================================

function buildFallbackSentimentSummary(coin: Coin, sentimentScore: Sentiment['sentiment_score']): string {
  const weeklyMove = coin.price_change_7d_percent;
  const absMove = Math.abs(weeklyMove).toFixed(2);

  if (sentimentScore === 'BULL') {
    return weeklyMove >= 0
      ? `${coin.name} is showing bullish sentiment with a ${absMove}% move over the last 7 days.`
      : `${coin.name} remains bullish despite a recent ${absMove}% pullback over the last 7 days.`;
  }

  if (sentimentScore === 'BEAR') {
    return weeklyMove <= 0
      ? `${coin.name} is showing bearish sentiment after a ${absMove}% move lower over the last 7 days.`
      : `${coin.name} is showing bearish sentiment despite a recent ${absMove}% rise over the last 7 days.`;
  }

  return `${coin.name} sentiment is neutral with limited confirmed catalysts right now.`;
}

const invalidSentimentSummaries = new Set([
  '',
  'Analysis failed',
  'Error during analysis',
  'No sentiment data available',
  'Sentiment analysis pending...',
]);

function normalizeSentimentForCoin(coin: Coin, sentimentData: Sentiment): Sentiment {
  const rawSummary = sentimentData.summary?.trim() || '';
  const normalizedSummary = invalidSentimentSummaries.has(rawSummary)
    ? buildFallbackSentimentSummary(coin, sentimentData.sentiment_score)
    : rawSummary;

  return {
    ...sentimentData,
    confidence: Number.isFinite(sentimentData.confidence) ? sentimentData.confidence : 0,
    summary: normalizedSummary,
    trending_score: Number.isFinite(sentimentData.trending_score) ? sentimentData.trending_score : 0,
  };
}

function applySentimentToCoin(coin: Coin, sentimentData: Sentiment): void {
  coin.sentiment_score = sentimentData.sentiment_score;
  coin.sentiment_confidence = sentimentData.confidence;
  coin.sentiment_summary = sentimentData.summary;
  coin.trending_score = sentimentData.trending_score;
}

async function fetchOnChainMetrics(coinIdOrSymbol: string): Promise<OnChainMetrics | null> {
  try {
    return await onChainService.getMetrics(coinIdOrSymbol);
  } catch (error) {
    logger.warn('onchain lookup failed', { coinIdOrSymbol, error: String(error) });
    return null;
  }
}

async function fetchSentimentMomentum(symbol: string): Promise<SentimentMomentum | null> {
  try {
    const report = await trendCalculator.calculate(symbol, 24);
    return report.sentiment_momentum;
  } catch (error) {
    logger.warn('sentiment momentum lookup failed', { symbol, error: String(error) });
    return null;
  }
}

async function fetchAndCacheSentiment(coin: Coin): Promise<Sentiment> {
  const cacheKey = `sentiment_${coin.symbol}`;

  // 1. Hot path: in-memory cache hit
  const cached = sentimentCache.get<Sentiment>(cacheKey);
  if (cached) {
    const normalizedCached = normalizeSentimentForCoin(coin, cached);
    applySentimentToCoin(coin, normalizedCached);
    return normalizedCached;
  }

  // 2. Warm path: SQLite has a non-expired row from a previous run
  try {
    const persisted = storage.getSentiment(coin.symbol);
    if (persisted) {
      const normalizedPersisted = normalizeSentimentForCoin(coin, persisted);
      sentimentCache.set(cacheKey, normalizedPersisted, 24 * 60 * 60 * 1000);
      try { storage.saveSentiment(coin.symbol, normalizedPersisted); } catch { /* non-fatal */ }
      applySentimentToCoin(coin, normalizedPersisted);
      return normalizedPersisted;
    }
  } catch {
    // SQLite unavailable — continue to live fetch
  }

  // 3. Cold path: fetch from APIs
  try {
    const contentAnalysis = await contentSignals.collect(coin.name, coin.symbol, 7, coin.symbol);
    const headlines = contentAnalysis.items.map(item => item.title).filter(Boolean).slice(0, 20);
    const analyzedSentiment = await sentiment.analyzeSentiment(
      coin.symbol,
      headlines,
      coin.price_change_7d_percent,
      coin.volatility_24h,
      contentAnalysis
    );

    const sentimentData = normalizeSentimentForCoin(coin, {
      ...analyzedSentiment,
      trending_score: contentAnalysis.collectionStats.trending_score,
      scored_items: contentAnalysis.items,
      source_breakdown: contentAnalysis.sourceBreakdown,
      collection_stats: contentAnalysis.collectionStats,
    });

    // Store in both caches
    sentimentCache.set(cacheKey, sentimentData, 24 * 60 * 60 * 1000);
    try { storage.saveSentiment(coin.symbol, sentimentData); } catch { /* non-fatal */ }

    applySentimentToCoin(coin, sentimentData);
    return sentimentData;
  } catch (error) {
    logger.error('sentiment fetch failed', { symbol: coin.symbol, error: String(error) });
    const fallbackSentiment = normalizeSentimentForCoin(coin, {
      symbol: coin.symbol,
      analysis_date: new Date().toISOString().split('T')[0],
      sentiment_score: coin.sentiment_score,
      confidence: coin.sentiment_confidence,
      summary: coin.sentiment_summary,
      key_catalysts: [],
      risk_factors: [],
      short_term_outlook: '',
      volatility_warning: false,
      trending_score: coin.trending_score,
      scored_items: [],
      source_breakdown: [],
      collection_stats: {
        total_items: 0,
        source_count: 0,
        weighted_frequency: 0,
        average_recency_score: 0,
        trending_score: 0,
        collected_at: new Date().toISOString(),
      },
    });
    applySentimentToCoin(coin, fallbackSentiment);
    return fallbackSentiment;
  }
}

// ============================================================================
// TRENDING SENTIMENT HELPERS
// ============================================================================

function trendRecordToSentiment(record: TrendingTopicRecord): TrendingSentiment {
  const composite = record.signal_composite;
  return {
    sentiment: composite > 65 ? 'BULL' : composite < 40 ? 'BEAR' : 'NEUTRAL',
    composite_score: composite,
    velocity: record.velocity,
    mention_count: record.mention_count,
    unique_sources: record.unique_sources,
    signals: {
      sentiment: record.signal_sentiment,
      engagement: record.signal_engagement,
      authority: record.signal_authority,
      recency: record.signal_recency,
    },
  };
}

function buildTrendingMap(): Map<string, TrendingTopicRecord> {
  try {
    const topics = socialStore.getTrendingTopics(200, 'coin');
    const map = new Map<string, TrendingTopicRecord>();
    for (const topic of topics) {
      if (!topic.coin_symbol) continue;
      const sym = topic.coin_symbol.toUpperCase();
      const existing = map.get(sym);
      if (!existing || topic.signal_composite > existing.signal_composite) {
        map.set(sym, topic);
      }
    }
    return map;
  } catch {
    return new Map();
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

    // Augment with Phase 3 social trending data (single fast sync read)
    const trendingMap = buildTrendingMap();
    const responseCoins = coins.map(coin => {
      const trendRecord = trendingMap.get(coin.symbol);
      if (!trendRecord) return coin;
      const trending = trendRecordToSentiment(trendRecord);
      return {
        ...coin,
        sentiment_score: trending.sentiment,
        sentiment_confidence: trending.composite_score / 100,
        trending_sentiment: trending,
      };
    });

    // Apply sorting (on augmented data)
    if (sortBy === 'volatility') {
      responseCoins.sort((a, b) => b.volatility_24h - a.volatility_24h);
    } else if (sortBy === 'sentiment') {
      const order = { BULL: 0, NEUTRAL: 1, BEAR: 2 };
      responseCoins.sort(
        (a, b) =>
          order[a.sentiment_score] - order[b.sentiment_score] ||
          b.sentiment_confidence - a.sentiment_confidence
      );
    }

    res.json({
      data: responseCoins,
      last_updated: new Date(),
      count: responseCoins.length,
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
    const sentimentData = await fetchAndCacheSentiment(coin);

    const historyKey = `history_${coin.id}_${days}`;
    const priceHistory = cache.get<object[]>(historyKey) || await (async () => {
      const data = await coingecko.getCoinHistory(coin.id, days);
      cache.set(historyKey, data, 15 * 60 * 1000);
      return data;
    })();

    const headlinesKey = `headlines_${coin.id}_${days}`;
    const headlines = cache.get<string[]>(headlinesKey) || (() => {
      const data = (sentimentData.scored_items ?? []).map(item => item.title).filter(Boolean).slice(0, 10);
      cache.set(headlinesKey, data, 15 * 60 * 1000);
      return data;
    })();
    const onChainMetrics = await fetchOnChainMetrics(coin.id);

    const trendRecord = buildTrendingMap().get(symbol.toUpperCase());
    const trendingSentiment = trendRecord ? trendRecordToSentiment(trendRecord) : undefined;

    // Compute feature attribution from available market data
    const marketForAttrib: MarketData = {
      symbol: coin.symbol,
      price_usd: coin.price_usd,
      price_change_24h_percent: coin.price_change_24h_percent,
      price_change_7d_percent: coin.price_change_7d_percent,
      volatility_24h: coin.volatility_24h,
      volatility_7d: coin.volatility_24h * 1.5,
      volume_24h_usd: coin.volume_24h_usd,
      market_cap_usd: coin.market_cap_usd,
      market_rank: coin.market_rank,
    };
    const newsForAttrib: NewsData = {
      headlines,
      sentiment_score: sentimentData.sentiment_score,
      sentiment_confidence: sentimentData.confidence,
      sentiment_summary: sentimentData.summary,
    };
    const featureAttribution = analyzer.analyzeAdvancedSentiment(marketForAttrib, newsForAttrib, undefined, onChainMetrics).feature_attribution;

    res.json({
      coin: trendingSentiment
        ? { ...coin, sentiment_score: trendingSentiment.sentiment, sentiment_confidence: trendingSentiment.composite_score / 100, trending_sentiment: trendingSentiment }
        : coin,
      price_history: priceHistory,
      sentiment_today: {
        sentiment_score: trendingSentiment?.sentiment ?? coin.sentiment_score,
        confidence: trendingSentiment ? trendingSentiment.composite_score / 100 : coin.sentiment_confidence,
        summary: coin.sentiment_summary,
        key_catalysts: sentimentData.key_catalysts,
        risk_factors: sentimentData.risk_factors,
        short_term_outlook: sentimentData.short_term_outlook,
        volatility_warning: sentimentData.volatility_warning,
        trending_score: sentimentData.trending_score,
        source_breakdown: sentimentData.source_breakdown ?? [],
        collection_stats: sentimentData.collection_stats,
        trending_sentiment: trendingSentiment,
        feature_attribution: featureAttribution,
      },
      scored_items: sentimentData.scored_items ?? [],
      headlines: headlines.slice(0, 10),
      news_count: sentimentData.collection_stats?.total_items ?? headlines.length,
      ...(onChainMetrics ? { on_chain: onChainMetrics } : {}),
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
      const onChainMetrics = analysisMode === 'BASIC' ? null : await fetchOnChainMetrics(sym);
      const sentimentMomentum = analysisMode === 'TRADING_SIGNALS' ? await fetchSentimentMomentum(sym) : null;

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
        // Use FinBERT-enhanced async path; falls back to keyword scoring when
        // FINBERT_API_URL is not configured or the model call fails.
        results[sym] = await analyzer.analyzeAdvancedSentimentAsync(market, news, technical, finBertService, onChainMetrics);
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
        // Use FinBERT-enhanced async path for the underlying advanced analysis;
        // falls back to keyword scoring when FINBERT_API_URL is not configured.
        results[sym] = await analyzer.generateTradingSignalsAsync(market, news, sentimentInput, technical, finBertService, onChainMetrics, sentimentMomentum);
      } else {
        // SMART — FinBERT-enhanced async path
        if (!market) { results[sym] = { error: 'No marketData for symbol' }; continue; }
        const news: NewsData = {
          headlines: symHeadlines,
          sentiment_score: 'NEUTRAL',
          sentiment_confidence: 0,
          sentiment_summary: '',
        };
        results[sym] = await analyzer.analyzeSmartSentimentAsync(market, news, technical, finBertService, onChainMetrics);
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

    // Run the CPU-bound simulation on a Worker Thread so the event loop stays
    // responsive. The await here is non-blocking: Node.js can serve other
    // requests while the worker thread runs the day-by-day simulation loop.
    const handle = workerPool.runBacktest(config.symbols.join('-') + '_' + Date.now(), config);
    const result = await handle.result;

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
// Persist result to SQLite after the worker completes and returns the result to the API process.
app.get('/api/backtest/results/:testId', (req, res) => {
  const testId = req.params.testId;
  const result = storage.getBacktestResult(testId);
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
// SOCIAL SCRAPING & TRENDING TOPIC ROUTES
// ============================================================================

// GET /api/scrape/social?symbol=BTC[&query=defi][&platforms=reddit,stocktwits]
// Scrape one symbol from social platforms and return raw posts.
app.get('/api/scrape/social', async (req, res) => {
  try {
    const symbol = (req.query.symbol as string | undefined)?.toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: '"symbol" query parameter is required' });
    }

    const query = req.query.query as string | undefined;
    const platformsParam = req.query.platforms as string | undefined;
    const platforms = platformsParam
      ? (platformsParam.split(',').map(p => p.trim()) as SocialPlatform[])
      : undefined;

    const result = await socialScraper.scrape(symbol, query, platforms);

    // Auto-ingest into the trending engine so scraped data contributes to trends
    trendingEngine.ingestPosts(result.platforms.flatMap(p => p.posts));

    res.json(result);
  } catch (error) {
    logger.error('route error', { endpoint: '/api/scrape/social', error: String(error) });
    res.status(500).json({ error: 'Social scrape failed' });
  }
});

// POST /api/scrape/batch
// Scrape multiple symbols. Body: { symbols: string[], query?: string, platforms?: string[] }
app.post('/api/scrape/batch', async (req, res) => {
  try {
    const { symbols, query, platforms } = req.body as {
      symbols?: string[];
      query?: string;
      platforms?: string[];
    };

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: '"symbols" array is required' });
    }
    if (symbols.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 symbols per batch request' });
    }

    const upperSymbols = symbols.map(s => s.toUpperCase());
    const results = await socialScraper.scrapeBatch(
      upperSymbols,
      query,
      platforms as SocialPlatform[] | undefined
    );

    trendingEngine.ingestPosts(results.flatMap(r => r.platforms.flatMap(p => p.posts)));

    res.json({
      results,
      total_symbols: results.length,
      total_posts: results.reduce((sum, r) => sum + r.total_posts, 0),
      scraped_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/scrape/batch', error: String(error) });
    res.status(500).json({ error: 'Batch scrape failed' });
  }
});

// GET /api/trending?window=4[&limit=20][&min_volume=2]
// Return currently trending topics across all ingested posts.
app.get('/api/trending', (req, res) => {
  try {
    const windowHours = Math.min(parseFloat(req.query.window as string) || 4, 48);
    const limit       = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const minVolume   = parseInt(req.query.min_volume as string) || 2;

    const result = trendingEngine.getTrendingTopics(windowHours, limit, minVolume);
    res.json(result);
  } catch (error) {
    logger.error('route error', { endpoint: '/api/trending', error: String(error) });
    res.status(500).json({ error: 'Failed to compute trending topics' });
  }
});

// POST /api/trending/ingest
// Manually push an array of ScrapedPost objects into the trending engine.
// Useful for piping data from external collectors or tests.
app.post('/api/trending/ingest', (req, res) => {
  try {
    const { posts } = req.body as { posts?: unknown[] };
    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: '"posts" array is required' });
    }
    trendingEngine.ingestPosts(posts as ScrapedPost[]);
    res.json({ ingested: posts.length, stored_total: trendingEngine.storedPostCount });
  } catch (error) {
    logger.error('route error', { endpoint: '/api/trending/ingest', error: String(error) });
    res.status(500).json({ error: 'Ingest failed' });
  }
});

// ============================================================================
// MARL COMPETITION ROUTES (Phase 2)
// ============================================================================

app.use(marlRoutes);
app.use(socialMediaRoutes);

// DB-dependent routes — require an active DB connection
if (storage.isHealthy()) {
  const repos = createRepositories({ driver: 'sqlite', db: storage.getDb() });
  app.use(createMarlRealTradingRouter(repos.broker));
  app.use(createAgentStatsRouter(repos.agents));
  app.use(createEvolutionaryRouter(storage.getDb(), repos.agents));
} else {
  logger.warn('DB-dependent routes skipped (storage not connected)');
}

// Trading routes (paper / sandbox / live exchange)
app.use('/api/trading', createTradingRouter());

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

export async function runSentimentCronJob(schedule: string): Promise<void> {
  const batchSize = parseInt(process.env.SENTIMENT_BATCH_SIZE || '50');
  const started = Date.now();
  logger.info('cron started', { batchSize, schedule });

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
}

export async function runTrendingCronJob(): Promise<void> {
  try {
    const coins = cache.get<{ symbol: string }[]>('coins');
    if (!coins || coins.length === 0) return;

    const symbols = coins.slice(0, 20).map(c => c.symbol);
    const { ingested } = await trendingEngine.scrapeAndIngest(symbols, socialScraper);
    logger.info('trending cron completed', { symbols: symbols.length, ingested });
  } catch (error) {
    logger.error('trending cron failed', { error: String(error) });
  }
}

export async function runSocialCronJob(): Promise<void> {
  try {
    const coins = cache.get<{ symbol: string }[]>('coins');
    const top = coins?.slice(0, 10).map(c => c.symbol) ?? [];

    if (isQueueAvailable()) {
      // Delegate to the scraper worker process via BullMQ
      await getScraperQueue().add('cron-social-scrape', { targets: top, rss_only: false });
      logger.info('social cron: scrape job enqueued', { symbols: top.length });
    } else {
      // Fallback: run in-process when Redis is not configured
      const scrapeResult = await socialScraperManager.scrapeAll(top);
      logger.info('social cron: scrape phase complete', {
        symbols: top.length,
        rss: scrapeResult.rss_items,
        discord: scrapeResult.discord_items,
        telegram: scrapeResult.telegram_items,
        total_scraped: scrapeResult.total_items_scraped,
        total_stored: scrapeResult.total_items_stored,
        duration_ms: scrapeResult.duration_ms,
      });

      logger.debug('social cron: ingest queue stats', ingestQueue.getStats());

      const trendWindow = parseInt(process.env.TRENDING_WINDOW_HOURS || '24');
      const topics = await socialDiscoveryEngine.discoverTrends(trendWindow, 30);
      logger.info('social cron: trending topics updated', { count: topics.length });

      const retainDays = parseInt(process.env.SOCIAL_HISTORY_DAYS || '30');
      const pruned = socialStore.pruneOldItems(retainDays);
      if (pruned > 0) logger.info('social cron: pruned old items', { count: pruned });
    }
  } catch (error) {
    logger.error('social cron failed', { error: String(error) });
  }
}

export function runMidnightResetJob(): void {
  try {
    socialStore.resetDailyCounters();
    logger.info('midnight cron: daily source counters reset');
  } catch (error) {
    logger.error('midnight cron failed', { error: String(error) });
  }
}

export default app;
