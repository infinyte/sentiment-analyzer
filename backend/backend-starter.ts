/**
 * Sentiment Analyzer - Backend Server (Node.js + Express)
 * Entry point for the backend API and scheduled tasks
 *
 * This file demonstrates the core server setup, route registration,
 * and scheduled job initialization.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import * as cron from 'node-cron';
import winston from 'winston';

// Load environment variables
dotenv.config();

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

const requiredEnvVars = [
  'CLAUDE_API_KEY',
  'NEWSAPI_API_KEY',
  'AZURE_STORAGE_CONNECTION_STRING',
];

const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}`
  );
  process.exit(1);
}

// ============================================================================
// LOGGER SETUP
// ============================================================================

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
});

// ============================================================================
// DATA MODELS (Interfaces)
// ============================================================================

interface CoinSnapshot {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  volatility_7d: number;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  sentiment_summary: string;
  trending_score: number;
  headline_sample: string[];
  timestamp: Date;
  source: 'coingecko';
  market_rank: number;
}

interface SentimentAnalysis {
  symbol: string;
  analysis_date: string;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  key_catalysts: string[];
  risk_factors: string[];
  sources_analyzed: number;
  data_range: { start: Date; end: Date };
  short_term_outlook: string;
  volatility_warning: boolean;
  generated_at: Date;
  model: 'claude-opus' | 'claude-sonnet';
  tokens_used: number;
}

// ============================================================================
// SERVICE LAYER - EXTERNAL API CLIENTS
// ============================================================================

/**
 * CoinGecko Service
 * Handles market data fetching and caching
 */
class CoinGeckoService {
  private apiUrl = 'https://api.coingecko.com/api/v3';
  private requestDelay = 1000; // Respect rate limits
  private lastRequestTime = 0;

  async getTopCoins(limit: number = 50): Promise<CoinSnapshot[]> {
    try {
      // Enforce rate limiting
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve =>
          setTimeout(resolve, this.requestDelay - timeSinceLastRequest)
        );
      }

      const response = await fetch(
        `${this.apiUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&sparkline=true&price_change_percentage=7d`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(
          `CoinGecko API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      this.lastRequestTime = Date.now();

      // Transform API response to CoinSnapshot
      return data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price_usd: coin.current_price,
        market_cap_usd: coin.market_cap || 0,
        volume_24h_usd: coin.total_volume || 0,
        price_change_24h_percent: coin.price_change_percentage_24h || 0,
        price_change_7d_percent: coin.price_change_percentage_7d || 0,
        volatility_24h: 0, // Calculate from historical data
        volatility_7d: 0,
        sentiment_score: 'NEUTRAL' as const,
        sentiment_confidence: 0,
        sentiment_summary: '',
        trending_score: 0,
        headline_sample: [],
        timestamp: new Date(),
        source: 'coingecko' as const,
        market_rank: coin.market_cap_rank || 999,
      }));
    } catch (error) {
      logger.error('CoinGecko API error', { error });
      throw error;
    }
  }

  async getCoinHistory(
    coinId: string,
    days: number = 7
  ): Promise<Array<{ timestamp: Date; ohlcv: any }>> {
    try {
      const response = await fetch(
        `${this.apiUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch OHLCV for ${coinId}`);
      }

      const data = await response.json();

      return data.map((point: any[]) => ({
        timestamp: new Date(point[0]),
        ohlcv: {
          open: point[1],
          high: point[2],
          low: point[3],
          close: point[4],
        },
      }));
    } catch (error) {
      logger.error('CoinGecko history error', { error, coinId });
      throw error;
    }
  }
}

/**
 * NewsAPI Service
 * Fetches trending topics and headlines for sentiment context
 */
class NewsAPIService {
  private apiKey = process.env.NEWSAPI_API_KEY || '';
  private apiUrl = 'https://newsapi.org/v2';

  async getTopicHeadlines(topic: string, days: number = 7): Promise<any[]> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const response = await fetch(
        `${this.apiUrl}/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&language=en&from=${fromDate.toISOString()}&apiKey=${this.apiKey}`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (!response.ok) {
        logger.warn(`NewsAPI responded with ${response.status}`, { topic });
        return [];
      }

      const data = await response.json();
      return (data.articles || []).slice(0, 20); // Top 20 articles
    } catch (error) {
      logger.error('NewsAPI error', { error, topic });
      return [];
    }
  }

  async getTrendingTopics(): Promise<string[]> {
    // This is a simplified approach; NewsAPI doesn't have a dedicated
    // "trending" endpoint, so we query popular crypto topics
    const topics = [
      'Bitcoin',
      'Ethereum',
      'cryptocurrency regulation',
      'crypto market',
      'altcoin',
    ];
    return topics;
  }
}

/**
 * Claude Sentiment Analysis Service
 * Uses Anthropic's API for advanced sentiment analysis
 */
class SentimentAnalysisService {
  private apiKey = process.env.CLAUDE_API_KEY || '';
  private apiUrl = 'https://api.anthropic.com/v1/messages';
  private model = 'claude-opus-4-1-20250805'; // Latest available model

  async analyzeCoinSentiment(
    coinSymbol: string,
    headlines: string[],
    marketMetrics: {
      priceChange7d: number;
      volatility: number;
      volumeChange: number;
    }
  ): Promise<SentimentAnalysis> {
    try {
      const prompt = `You are a cryptocurrency market analyst. Analyze the sentiment for ${coinSymbol}.

RECENT NEWS (past 7 days):
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

MARKET METRICS:
- Price change (7d): ${marketMetrics.priceChange7d.toFixed(2)}%
- Volatility (24h): ${marketMetrics.volatility.toFixed(2)}%
- Volume change: ${marketMetrics.volumeChange.toFixed(2)}%

Provide your analysis in this exact JSON format (no markdown, no extra text):
{
  "sentiment_score": "BULL" | "NEUTRAL" | "BEAR",
  "confidence": 0.0-1.0,
  "summary": "1-2 sentence overview",
  "key_catalysts": ["catalyst1", "catalyst2", "catalyst3"],
  "risk_factors": ["risk1", "risk2"],
  "short_term_outlook": "1-2 sentence forecast for next 24-48h",
  "volatility_warning": true | false
}`;

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Claude API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const content = data.content[0].text;

      // Parse JSON response
      let analysis;
      try {
        analysis = JSON.parse(content);
      } catch {
        logger.error('Failed to parse Claude response as JSON', { content });
        throw new Error('Invalid Claude API response format');
      }

      return {
        symbol: coinSymbol,
        analysis_date: new Date().toISOString().split('T')[0],
        sentiment_score: analysis.sentiment_score,
        confidence: analysis.confidence,
        summary: analysis.summary,
        key_catalysts: analysis.key_catalysts,
        risk_factors: analysis.risk_factors,
        sources_analyzed: headlines.length,
        data_range: {
          start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          end: new Date(),
        },
        short_term_outlook: analysis.short_term_outlook,
        volatility_warning: analysis.volatility_warning,
        generated_at: new Date(),
        model: 'claude-opus-4-1-20250805' as const,
        tokens_used: data.usage.output_tokens,
      };
    } catch (error) {
      logger.error('Sentiment analysis error', { error, coinSymbol });
      throw error;
    }
  }
}

/**
 * Storage Service
 * Manages Azure Table Storage operations (snapshots, sentiment cache, etc.)
 */
class StorageService {
  private connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || '';

  async saveSnapshot(snapshot: CoinSnapshot): Promise<void> {
    // In production, use @azure/data-tables library
    // This is a placeholder for the implementation
    logger.info(`Snapshot saved: ${snapshot.symbol}`);
  }

  async getSentimentCache(
    symbol: string,
    date: string
  ): Promise<SentimentAnalysis | null> {
    // Query sentiment cache table
    // Return null if not found or expired
    logger.info(`Sentiment cache query: ${symbol} on ${date}`);
    return null;
  }

  async saveSentimentAnalysis(analysis: SentimentAnalysis): Promise<void> {
    // Store sentiment result in Table Storage
    logger.info(`Sentiment saved: ${analysis.symbol}`);
  }

  async getHistoricalSnapshots(
    symbol: string,
    days: number = 7
  ): Promise<CoinSnapshot[]> {
    // Query snapshots for the past N days
    logger.info(`Historical snapshots query: ${symbol} (${days} days)`);
    return [];
  }
}

/**
 * In-Memory Cache Service
 * Reduces API calls by caching frequently accessed data
 */
class CacheService {
  private cache = new Map<string, { data: any; expiresAt: number }>();
  private defaultTtlMs = 10 * 60 * 1000; // 10 minutes

  set(key: string, value: any, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs || this.defaultTtlMs);
    this.cache.set(key, { data: value, expiresAt });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// INITIALIZE SERVICES
// ============================================================================

const coingecko = new CoinGeckoService();
const newsapi = new NewsAPIService();
const sentiment = new SentimentAnalysisService();
const storage = new StorageService();
const cache = new CacheService();

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app: Express = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * GET /api/coins
 * Retrieve list of top coins with current snapshots
 */
app.get('/api/coins', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const sortBy = (req.query.sort_by as string) || 'market_cap';
    const sentimentFilter = (req.query.sentiment_filter as string) || 'all';

    // Check cache first
    const cacheKey = `coins_${limit}_${sortBy}`;
    let coins = cache.get<CoinSnapshot[]>(cacheKey);

    if (!coins) {
      // Fetch from CoinGecko
      coins = await coingecko.getTopCoins(limit);

      // Apply sentiment filter if not "all"
      if (sentimentFilter !== 'all') {
        coins = coins.filter(c => c.sentiment_score === sentimentFilter);
      }

      // Sort
      if (sortBy === 'volatility') {
        coins.sort((a, b) => b.volatility_24h - a.volatility_24h);
      } else if (sortBy === 'sentiment') {
        const sentimentOrder = { BULL: 0, NEUTRAL: 1, BEAR: 2 };
        coins.sort(
          (a, b) =>
            sentimentOrder[a.sentiment_score] -
              sentimentOrder[b.sentiment_score] ||
            b.sentiment_confidence - a.sentiment_confidence
        );
      }

      // Cache for 5 minutes
      cache.set(cacheKey, coins, 5 * 60 * 1000);
    }

    res.json({
      data: coins,
      last_updated: new Date(),
      cache_age_minutes: 0,
    });
  } catch (error) {
    logger.error('Error fetching coins', { error });
    res.status(500).json({ error: 'Failed to fetch coins' });
  }
});

/**
 * GET /api/coins/:symbol
 * Fetch detailed report for a specific coin
 */
app.get('/api/coins/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);

    // Fetch coin metadata from CoinGecko
    const allCoins = await coingecko.getTopCoins(200);
    const coin = allCoins.find(c => c.symbol === symbol.toUpperCase());

    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }

    // Fetch historical OHLCV data
    const priceHistory = await coingecko.getCoinHistory(coin.id, days);

    // Fetch recent articles (in production, query Table Storage)
    const articles = await newsapi.getTopicHeadlines(coin.name, days);

    res.json({
      coin,
      sentiment_today: {
        sentiment_score: coin.sentiment_score,
        confidence: coin.sentiment_confidence,
        summary: coin.sentiment_summary,
        key_catalysts: ['Example catalyst 1', 'Example catalyst 2'],
        risk_factors: ['Example risk 1'],
        volatility_warning: false,
        cached_at: coin.timestamp,
      },
      price_history: priceHistory.map(p => ({
        timestamp: p.timestamp,
        open: p.ohlcv.open,
        high: p.ohlcv.high,
        low: p.ohlcv.low,
        close: p.ohlcv.close,
        volume: 0, // Would need additional API call
      })),
      sentiment_history: [], // Would query Table Storage
      recent_articles: articles.slice(0, 10).map((a: any) => ({
        title: a.title,
        url: a.url,
        source: a.source.name,
        published_at: a.publishedAt,
        sentiment: 'neutral', // Would use Claude to classify
      })),
      volatility_trend: [], // Calculated from price_history
      volume_trend: [], // Calculated from price_history
      recommendations: {
        short_term: 'Monitor for breakout above key resistance',
        risk_level: 'MODERATE',
        volatility_warning: false,
      },
    });
  } catch (error) {
    logger.error('Error fetching coin detail', { error });
    res.status(500).json({ error: 'Failed to fetch coin details' });
  }
});

/**
 * GET /api/sentiment/:symbol
 * Get cached sentiment data
 */
app.get('/api/sentiment/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const today = new Date().toISOString().split('T')[0];

    // Check Table Storage cache
    const cached = await storage.getSentimentCache(symbol, today);

    if (!cached) {
      return res.status(404).json({ error: 'Sentiment data not available' });
    }

    res.json(cached);
  } catch (error) {
    logger.error('Error fetching sentiment', { error });
    res.status(500).json({ error: 'Failed to fetch sentiment' });
  }
});

/**
 * POST /api/refresh-sentiment
 * Admin endpoint to manually trigger sentiment analysis
 */
app.post(
  '/api/refresh-sentiment',
  (req: Request, res: Response, next: NextFunction) => {
    // Authentication middleware
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const { symbols, force_refresh } = req.body;

      res.status(202).json({
        job_id: `job_${Date.now()}`,
        status: 'queued',
        coins_to_process: (symbols || []).length || 50,
        estimated_completion: new Date(Date.now() + 2 * 60 * 1000),
      });

      // Process async (don't wait for response)
      // In production, use Azure Durable Functions or a job queue
      logger.info('Sentiment refresh job queued', {
        symbols,
        force_refresh,
      });
    } catch (error) {
      logger.error('Error triggering sentiment refresh', { error });
      res.status(500).json({ error: 'Failed to trigger refresh' });
    }
  }
);

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    services: {
      coingecko: 'ok',
      newsapi: 'ok',
      claude_api: 'ok',
      table_storage: 'ok',
    },
    last_market_update: new Date(),
    last_sentiment_update: new Date(Date.now() - 24 * 60 * 60 * 1000),
    uptime_hours: Math.round(process.uptime() / 3600),
  });
});

// ============================================================================
// SCHEDULED JOBS
// ============================================================================

/**
 * Market Data Refresh Job
 * Runs every 10 minutes to fetch market data and headlines
 */
const marketDataJob = cron.schedule(
  '*/10 * * * *', // Every 10 minutes
  async () => {
    try {
      logger.info('Starting market data refresh job');

      const coins = await coingecko.getTopCoins(100);

      // In production, save each to Table Storage
      for (const coin of coins) {
        await storage.saveSnapshot(coin);
      }

      // Clear coin list cache to force refresh
      cache.clear();

      logger.info(`Market data job completed: ${coins.length} coins updated`);
    } catch (error) {
      logger.error('Market data job failed', { error });
    }
  },
  { scheduled: false } // Don't start immediately in development
);

/**
 * Sentiment Analysis Job
 * Runs daily at 2 AM UTC to analyze sentiment for top coins
 */
const sentimentJob = cron.schedule(
  process.env.SENTIMENT_JOB_CRON || '0 2 * * *', // Daily @ 2 AM UTC
  async () => {
    try {
      logger.info('Starting sentiment analysis job');

      const topCoins = await coingecko.getTopCoins(50);

      for (const coin of topCoins) {
        try {
          // Fetch recent headlines for this coin
          const headlines = await newsapi.getTopicHeadlines(coin.name, 7);

          if (headlines.length === 0) {
            logger.warn(`No headlines found for ${coin.symbol}`);
            continue;
          }

          // Analyze sentiment using Claude
          const analysis = await sentiment.analyzeCoinSentiment(
            coin.symbol,
            headlines.map(h => h.title),
            {
              priceChange7d: coin.price_change_7d_percent,
              volatility: coin.volatility_24h,
              volumeChange: 0, // Would calculate from historical data
            }
          );

          // Store result
          await storage.saveSentimentAnalysis(analysis);

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Sentiment analysis failed for ${coin.symbol}`, {
            error,
          });
        }
      }

      logger.info('Sentiment analysis job completed');
    } catch (error) {
      logger.error('Sentiment job failed', { error });
    }
  },
  { scheduled: false } // Don't start immediately in development
);

// ============================================================================
// START SERVER
// ============================================================================

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info('Available endpoints:');
  logger.info('  GET  /api/coins');
  logger.info('  GET  /api/coins/:symbol');
  logger.info('  GET  /api/sentiment/:symbol');
  logger.info('  POST /api/refresh-sentiment (requires auth)');
  logger.info('  GET  /api/health');

  // Start scheduled jobs in production
  if (process.env.NODE_ENV === 'production') {
    marketDataJob.start();
    sentimentJob.start();
    logger.info('Scheduled jobs started');
  } else {
    logger.info('⚠️  Scheduled jobs disabled in development mode');
  }
});

export default app;
