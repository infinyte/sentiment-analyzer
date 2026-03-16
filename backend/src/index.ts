// BACKEND SERVER - index.ts
// Main Express application with API routes and scheduled jobs

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';

dotenv.config();

// ============================================================================
// TYPES
// ============================================================================

interface Coin {
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
  timestamp: Date;
  market_rank: number;
}

interface Sentiment {
  symbol: string;
  analysis_date: string;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;
  summary: string;
  key_catalysts: string[];
  risk_factors: string[];
  short_term_outlook: string;
  volatility_warning: boolean;
  trending_score: number;
}

// ============================================================================
// SERVICE: COINGECKO CLIENT
// ============================================================================

class CoinGeckoService {
  private apiUrl = 'https://api.coingecko.com/api/v3';

  async getTopCoins(limit: number = 50): Promise<Coin[]> {
    try {
      const response = await fetch(
        `${this.apiUrl}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&sparkline=false`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) throw new Error(`CoinGecko API error: ${response.status}`);

      const data = await response.json();

      return data.map((coin: any) => {
        // Calculate volatility_24h from high/low range
        const high24h = coin.high_24h || coin.current_price;
        const low24h = coin.low_24h || coin.current_price;
        const volatility24h = coin.current_price 
          ? ((high24h - low24h) / coin.current_price) * 100 
          : 0;

        return {
          id: coin.id,
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price_usd: coin.current_price,
          market_cap_usd: coin.market_cap || 0,
          volume_24h_usd: coin.total_volume || 0,
          price_change_24h_percent: coin.price_change_percentage_24h || 0,
          price_change_7d_percent: coin.price_change_percentage_7d || 0,
          volatility_24h: volatility24h,
          volatility_7d: 0,
          sentiment_score: 'NEUTRAL' as const,
          sentiment_confidence: 0,
          sentiment_summary: '',
          trending_score: 0,
          timestamp: new Date(),
          market_rank: coin.market_cap_rank || 999,
        };
      });
    } catch (error) {
      console.error('CoinGecko error:', error);
      throw error;
    }
  }

  async getCoinHistory(coinId: string, days: number = 7) {
    try {
      const response = await fetch(
        `${this.apiUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) throw new Error(`Failed to fetch history for ${coinId}`);

      const data = await response.json();

      return data.map((point: any[]) => ({
        timestamp: new Date(point[0]),
        open: point[1],
        high: point[2],
        low: point[3],
        close: point[4],
      }));
    } catch (error) {
      console.error('CoinGecko history error:', error);
      return [];
    }
  }
}

// ============================================================================
// SERVICE: NEWSAPI CLIENT
// ============================================================================

class NewsAPIService {
  private apiKey = process.env.NEWSAPI_API_KEY || '';
  private apiUrl = 'https://newsapi.org/v2';

  async getHeadlines(topic: string, days: number = 7): Promise<string[]> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const response = await fetch(
        `${this.apiUrl}/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&language=en&from=${fromDate.toISOString()}&apiKey=${this.apiKey}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        console.warn(`NewsAPI responded with ${response.status}`);
        return [];
      }

      const data = await response.json();
      return (data.articles || []).slice(0, 20).map((a: any) => a.title);
    } catch (error) {
      console.error('NewsAPI error:', error);
      return [];
    }
  }
}

// ============================================================================
// SERVICE: SENTIMENT ANALYSIS (CLAUDE)
// ============================================================================

class SentimentService {
  private apiKey = process.env.CLAUDE_API_KEY || '';
  private apiUrl = 'https://api.anthropic.com/v1/messages';

  async analyzeSentiment(
    symbol: string,
    headlines: string[],
    priceChange7d: number,
    volatility: number
  ): Promise<Sentiment> {
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

      const data = await response.json();
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
        };
      } catch {
        console.error('Failed to parse Claude response:', content);
        return {
          symbol,
          analysis_date: new Date().toISOString().split('T')[0],
          sentiment_score: 'NEUTRAL',
          confidence: 0,
          summary: 'Analysis failed',
          key_catalysts: [],
          risk_factors: [],
          short_term_outlook: '',
          volatility_warning: false,
        };
      }
    } catch (error) {
      console.error('Sentiment analysis error:', error);
      return {
        symbol,
        analysis_date: new Date().toISOString().split('T')[0],
        sentiment_score: 'NEUTRAL',
        confidence: 0,
        summary: 'Error during analysis',
        key_catalysts: [],
        risk_factors: [],
        short_term_outlook: '',
        volatility_warning: false,
      };
    }
  }
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

class Cache {
  private data = new Map<string, { value: any; expires: number }>();

  set(key: string, value: any, ttlMs: number = 10 * 60 * 1000) {
    this.data.set(key, { value, expires: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.data.delete(key);
      return null;
    }
    return entry.value as T;
  }

  delete(key: string) {
    this.data.delete(key);
  }
}

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
  res.json({
    status: 'healthy',
    services: {
      coingecko: 'ok',
      newsapi: 'ok',
      claude_api: 'ok',
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
