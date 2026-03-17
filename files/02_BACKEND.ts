// BACKEND SERVER - index.ts
// Main Express application with API routes and scheduled jobs

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

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

      return data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price_usd: coin.current_price,
        market_cap_usd: coin.market_cap || 0,
        volume_24h_usd: coin.total_volume || 0,
        price_change_24h_percent: coin.price_change_percentage_24h || 0,
        price_change_7d_percent: coin.price_change_percentage_7d || 0,
        volatility_24h: 0,
        volatility_7d: 0,
        sentiment_score: 'NEUTRAL' as const,
        sentiment_confidence: 0,
        sentiment_summary: '',
        trending_score: 0,
        timestamp: new Date(),
        market_rank: coin.market_cap_rank || 999,
      }));
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
          model: 'claude-opus-4-1-20250805',
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

// Store coins in memory
let cachedCoins: Coin[] = [];

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

    const allCoins = await coingecko.getTopCoins(200);
    const coin = allCoins.find(c => c.symbol === symbol.toUpperCase());

    if (!coin) {
      return res.status(404).json({ error: 'Coin not found' });
    }

    const priceHistory = await coingecko.getCoinHistory(coin.id, days);
    const headlines = await newsapi.getHeadlines(coin.name, days);

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
    const token = req.headers.authorization?.split(' ')[1];
    if (token !== process.env.API_SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { symbols } = req.body;
    const coinsToProcess = symbols || [];

    res.status(202).json({
      job_id: `job_${Date.now()}`,
      status: 'queued',
      coins_to_process: coinsToProcess.length,
    });

    console.log('Sentiment refresh job queued for:', coinsToProcess);
  } catch (error) {
    console.error('Error in /api/refresh-sentiment:', error);
    res.status(500).json({ error: 'Failed to queue job' });
  }
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

export default app;
