# Sentiment Analyzer - System Architecture

## Overview

Real-time cryptocurrency sentiment analysis platform combining:
- Market data polling on demand (CoinGecko, cached 5 min)
- Daily sentiment analysis batch using Claude AI (cached 24 hr)
- Interactive React dashboard with price history charts
- Deployed on Azure Free Tier (~$6–15/month)

---

## 1. Data Flow

```
REACT FRONTEND (localhost:5173)
         |
         | HTTP API calls — polled every 10 min
         v
EXPRESS BACKEND (localhost:3000)
    |          |          |
    v          v          v
CoinGecko   NewsAPI   Claude API
    |          |          |
    v          v          v
     In-Memory Cache (node-cache)
       ├── coins: 5-min TTL
       ├── sentiment: 24-hr TTL
       ├── price history: 15-min TTL per coin
       └── headlines: 15-min TTL per coin
```

> **Note:** Azure Table Storage is listed as a dependency but is not yet integrated. All data is held in-memory and lost on server restart.

---

## 2. Backend Architecture (`backend/src/index.ts`)

All backend logic lives in a single file. Key classes:

### CoinGeckoService
- `getTopCoins(limit)` — fetches `/coins/markets` from CoinGecko, calculates `volatility_24h` from `high_24h`/`low_24h`
- `getCoinHistory(coinId, days)` — fetches OHLCV data from `/coins/:id/ohlc`

### NewsAPIService
- `getHeadlines(topic, days)` — queries NewsAPI `/everything` for recent articles, returns array of headline strings (max 20)

### SentimentService
- `analyzeSentiment(symbol, headlines, priceChange7d, volatility)` — calls Claude API, requests JSON with `sentiment_score`, `confidence`, `summary`, `key_catalysts`, `risk_factors`, `short_term_outlook`, `volatility_warning`
- Model: `CLAUDE_MODEL` env var (default: `claude-sonnet-4-6`)
- Falls back to `NEUTRAL` / confidence `0` on any error

### Cache
- Simple `Map`-based TTL cache with `get`, `set`, `delete` methods
- Two instances: `cache` (coins/history/headlines) and `sentimentCache` (sentiment results)

### fetchAndCacheSentiment (helper)
- Checks `sentimentCache` for a coin; if hit, merges fields onto the coin object
- If miss: calls `NewsAPIService` → `SentimentService`, stores in `sentimentCache` with 24-hr TTL
- Also sets `trending_score = headlines.length` on the coin

---

## 3. Data Models

### Coin (TypeScript interface)

```typescript
interface Coin {
  id: string;
  symbol: string;                          // e.g. "BTC"
  name: string;
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  volatility_24h: number;                  // ((high_24h - low_24h) / price) * 100
  volatility_7d: number;                   // always 0 (not yet calculated)
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;            // 0–1
  sentiment_summary: string;
  trending_score: number;                  // headline count from NewsAPI
  timestamp: Date;
  market_rank: number;
}
```

### Sentiment (TypeScript interface)

```typescript
interface Sentiment {
  symbol: string;
  analysis_date: string;                   // YYYY-MM-DD
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;                      // 0–1
  summary: string;                         // 1–2 sentence overview
  key_catalysts: string[];
  risk_factors: string[];
  short_term_outlook: string;
  volatility_warning: boolean;
  trending_score: number;                  // cached alongside sentiment
}
```

---

## 4. API Endpoints

### GET /api/coins
Returns top coins with current data and merged sentiment.

Query params: `limit` (default 50, max 200), `sort_by` (`market_cap` | `volatility` | `sentiment`)

```json
{
  "data": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "price_usd": 43250.50,
      "sentiment_score": "BULL",
      "sentiment_confidence": 0.87,
      "sentiment_summary": "Positive momentum from institutional adoption...",
      "volatility_24h": 2.1,
      "trending_score": 14,
      "price_change_24h_percent": 2.34,
      "price_change_7d_percent": 5.67,
      "market_rank": 1
    }
  ],
  "last_updated": "2026-03-16T10:45:00Z",
  "count": 50
}
```

### GET /api/coins/:symbol
Detailed report for one coin. Query param: `days` (default 7, max 30).

```json
{
  "coin": { "...Coin fields..." },
  "price_history": [
    { "timestamp": "...", "open": 43000, "high": 43500, "low": 42900, "close": 43250 }
  ],
  "sentiment_today": {
    "sentiment_score": "BULL",
    "confidence": 0.87,
    "summary": "..."
  },
  "headlines": ["Headline 1", "Headline 2"],
  "news_count": 14
}
```

### GET /api/sentiment/:symbol
Returns cached `Sentiment` object. Returns 404 if not yet analyzed. Does not trigger new analysis.

### POST /api/refresh-sentiment
Admin endpoint. Requires `x-api-key: <API_SECRET_KEY>` header.

```json
// Request body (symbols optional — omit to refresh all cached coins)
{ "symbols": ["BTC", "ETH"] }

// Response 202
{ "job_id": "job_1710583200000", "status": "processing", "coins_to_process": 2 }
```

Clears sentiment cache for target coins then re-analyzes sequentially in the background.

### GET /api/health

```json
// All keys present → 200
{ "status": "healthy", "services": { "coingecko": "ok", "newsapi": "ok", "claude_api": "ok" }, "uptime_seconds": 3600 }

// Missing key → 503
{ "status": "degraded", "services": { "coingecko": "ok", "newsapi": "ok", "claude_api": "misconfigured" }, "uptime_seconds": 3600 }
```

---

## 5. Sentiment Prompt

```
You are a crypto market analyst. Analyze sentiment for {SYMBOL}.

HEADLINES (past 7 days):
1. {headline}
...

MARKET DATA:
- Price change (7d): {n}%
- Volatility (24h): {n}%

Respond with ONLY this JSON (no markdown, no explanation):
{
  "sentiment_score": "BULL" | "NEUTRAL" | "BEAR",
  "confidence": 0.5,
  "summary": "Brief 1-2 sentence summary",
  "key_catalysts": ["..."],
  "risk_factors": ["..."],
  "short_term_outlook": "1-2 sentence forecast",
  "volatility_warning": false
}
```

---

## 6. Frontend Architecture (`frontend/src/App.tsx`)

All UI lives in a single file.

**Hooks:**
- `useCoins()` — polls `/api/coins?limit=50` every 10 minutes
- `useCoinDetail(symbol)` — fetches `/api/coins/:symbol?days=7` when a coin is selected

**Components:**
- `SentimentBadge` — colored badge with score and confidence %
- `PercentChange` — price change with ▲/▼ indicator
- `CoinCard` — card with price, sentiment, volatility, volume, summary; opens modal on click
- `Dashboard` — responsive auto-fill grid, sort dropdown (market cap / volatility / sentiment)
- `DetailModal` — full-screen overlay with Chart.js line chart, sentiment summary, headlines. Closes on ESC or backdrop click.

**Chart:** `react-chartjs-2` `<Line>` component rendering 7-day OHLCV close prices. Registered components: `CategoryScale`, `LinearScale`, `PointElement`, `LineElement`, `Tooltip`.

---

## 7. Scheduled Job

```typescript
cron.schedule(process.env.SENTIMENT_JOB_CRON || '0 2 * * *', async () => {
  // 1. Fetch top SENTIMENT_BATCH_SIZE coins from CoinGecko
  // 2. Clear sentiment cache for all coins
  // 3. Re-analyze sequentially (sequential to respect API rate limits)
  // Logs: start, per-coin result, elapsed time
});
```

---

## 8. Environment Variables

```bash
# Required
CLAUDE_API_KEY=             # Anthropic console
NEWSAPI_API_KEY=            # newsapi.org
API_SECRET_KEY=             # Any string for admin endpoint auth

# Optional
PORT=3000
CLAUDE_MODEL=claude-sonnet-4-6
SENTIMENT_BATCH_SIZE=50
SENTIMENT_JOB_CRON="0 2 * * *"
ALLOWED_ORIGINS=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Not yet implemented
AZURE_STORAGE_CONNECTION_STRING=
APPINSIGHTS_INSTRUMENTATION_KEY=
LOG_LEVEL=info
```

---

## 9. Actual File Structure

```
sentiment-analyzer/
├── backend/
│   ├── src/
│   │   └── index.ts          ← all services, routes, cache, cron job
│   ├── .env / .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx           ← all components, hooks, chart
│   │   └── main.tsx          ← React entry point
│   ├── index.html
│   ├── vite.config.ts        ← proxies /api → localhost:3000
│   ├── package.json
│   └── tsconfig.json
│
├── postman/                  ← API test collection
├── .github/workflows/        ← empty (CI/CD not yet configured)
└── docs/                     ← empty
```

---

## 10. Cost (Monthly)

| Service | Free Tier | Cost |
|---------|-----------|------|
| Azure App Service (B1) | 100 hrs/mo | $0 |
| CoinGecko | Free | $0 |
| NewsAPI | 500 req/day | $0 |
| Claude API (50 coins/day) | — | ~$6–15 |
| **Total** | | **~$6–15/month** |

---

## 11. Security

- All API keys in environment variables — never in code
- `POST /api/refresh-sentiment` protected by `x-api-key` header
- CORS restricted to `ALLOWED_ORIGINS`
- Helmet.js for security headers
- HTTPS enforced by Azure App Service

---

## 12. Future Enhancements

- **Azure Table Storage** — persist sentiment history across restarts
- **GitHub Actions CI/CD** — automated deploy to Azure on push to main
- **Application Insights** — structured logging and alerting
- **User accounts & watchlists** — Cosmos DB, JWT auth
- **Price alerts** — email/push notifications via SendGrid/Twilio
- **TradingView Lightweight Charts** — candlestick chart with volume and indicators
- **Multi-timeframe sentiment** — hourly and weekly analysis
- **Redis cache** — replace in-memory cache for multi-instance deployments
