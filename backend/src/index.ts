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

dotenv.config();

// ============================================================================
// EXPRESS SERVER SETUP
// ============================================================================

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));
app.use(express.json());

// Initialize services
const coingecko = new CoinGeckoService();
const newsapi = new NewsAPIService();
const sentiment = new SentimentService();
const cache = new Cache();
const sentimentCache = new Cache();


// ============================================================================
// HELPER: Fetch and cache sentiment for a coin
// ============================================================================

async function fetchAndCacheSentiment(coin: Coin): Promise<void> {
  const cacheKey = `sentiment_${coin.symbol}`;
  
  // Check if sentiment is already cached (24-hour TTL)
  const cached = sentimentCache.get<Sentiment>(cacheKey);
  if (cached) {
    coin.sentiment_score = cached.sentiment_score;
    coin.sentiment_confidence = cached.confidence;
    coin.sentiment_summary = cached.summary;
    coin.trending_score = cached.trending_score;
    return;
  }

  // Fetch fresh sentiment data
  try {
    const headlines = await newsapi.getHeadlines(coin.name, 7);
    const sentimentData = await sentiment.analyzeSentiment(
      coin.symbol,
      headlines,
      coin.price_change_7d_percent,
      coin.volatility_24h
    );

    sentimentData.trending_score = headlines.length;

    // Cache sentiment for 24 hours
    sentimentCache.set(cacheKey, sentimentData, 24 * 60 * 60 * 1000);

    // Update coin with sentiment data
    coin.sentiment_score = sentimentData.sentiment_score;
    coin.sentiment_confidence = sentimentData.confidence;
    coin.sentiment_summary = sentimentData.summary;
    coin.trending_score = sentimentData.trending_score;
  } catch (error) {
    console.error(`Failed to fetch sentiment for ${coin.symbol}:`, error);
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
    console.error('Error in /api/coins:', error);
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
    console.error('Error in /api/coins/:symbol:', error);
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

        console.log(`[${jobId}] Starting forced sentiment refresh for ${coins.length} coins...`);

        // Clear sentiment cache entries first so fetchAndCacheSentiment re-analyzes
        for (const coin of coins) {
          sentimentCache.delete(`sentiment_${coin.symbol}`);
        }

        // Analyze sequentially to respect NewsAPI and Claude rate limits
        for (const coin of coins) {
          await fetchAndCacheSentiment(coin);
          console.log(`[${jobId}] Refreshed sentiment for ${coin.symbol}: ${coin.sentiment_score}`);
        }

        console.log(`[${jobId}] Sentiment refresh completed for ${coins.length} coins`);
      } catch (error) {
        console.error(`[${jobId}] Sentiment refresh failed:`, error);
      }
    })();
  } catch (error) {
    console.error('Error in /api/refresh-sentiment:', error);
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
  const allHealthy = claudeStatus === 'ok' && newsapiStatus === 'ok';

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services: {
      coingecko: 'ok',
      newsapi: newsapiStatus,
      claude_api: claudeStatus,
    },
    uptime_seconds: process.uptime(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(port, () => {
  console.log(`\n✓ Server running on port ${port}`);
  console.log(`✓ API: http://localhost:${port}/api/coins`);
  console.log(`✓ Health: http://localhost:${port}/api/health\n`);
});

// ============================================================================
// SCHEDULED SENTIMENT JOB
// ============================================================================

const cronSchedule = process.env.SENTIMENT_JOB_CRON || '0 2 * * *';

cron.schedule(cronSchedule, async () => {
  const batchSize = parseInt(process.env.SENTIMENT_BATCH_SIZE || '50');
  const started = Date.now();
  console.log(`[cron] Sentiment batch job started (${batchSize} coins, schedule: ${cronSchedule})`);

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
    console.log(`[cron] Sentiment batch job completed: ${coins.length} coins in ${elapsed}s`);
  } catch (error) {
    console.error('[cron] Sentiment batch job failed:', error);
  }
});

export default app;
