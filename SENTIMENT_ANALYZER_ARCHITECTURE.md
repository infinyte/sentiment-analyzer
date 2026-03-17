# Sentiment Analyzer - System Architecture

## Overview

Real-time cryptocurrency sentiment analysis platform combining:
- Market data polling on demand (CoinGecko, cached 5 min)
- Daily sentiment analysis batch using Claude AI (cached 24 hr)
- Normalized content scoring across news and social sources
- Social scraping and trending-topic discovery APIs
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
    |          |          |              |
    v          v          v              v
CoinGecko   NewsAPI   Claude API    Social Scrapers
    |          |          |         (7 sources)
    v          v          v              v
     Cache + SQLite persistence    SQLite Social Store
       ├── coins: 5-min TTL        ├── social_media_items
       ├── sentiment: 24-hr TTL   ├── trending_topics
       ├── price history: 15-min  ├── trending_topic_history
       └── headlines: 15-min      └── source_metadata
```

> **Note:** Azure Table Storage packages exist in the backend dependency graph, but the active runtime persistence layer is SQLite (`better-sqlite3`) plus in-memory caches.

---

## 2. Backend Architecture (`backend/src/index.ts`)

All backend logic lives in a single file. Key classes:

### CoinGeckoService
- `getTopCoins(limit)` — fetches `/coins/markets` from CoinGecko, calculates `volatility_24h` from `high_24h`/`low_24h`
- `getCoinHistory(coinId, days)` — fetches OHLCV data from `/coins/:id/ohlc`

### NewsAPIService
- `getArticles(topic, days)` — queries NewsAPI `/everything` for recent structured articles (max 20)
- `getHeadlines(topic, days)` — headline helper built on top of `getArticles`

### ContentSignalService
- Collects normalized items from NewsAPI, Reddit, and an X-ready adapter
- Scores each item using keyword polarity, recency, relevance, engagement, and source weights
- Produces `scored_items`, `source_breakdown`, and `collection_stats`

### SocialScraperService + TrendingTopicsEngine
- `GET /api/scrape/social` and `POST /api/scrape/batch` collect normalized posts from Reddit, Stocktwits, and X (when bearer token is configured)
- `GET /api/trending` ranks topics by volume, velocity, source diversity, and aggregate sentiment
- A scheduled trending scrape job ingests social posts every 30 minutes for the top cached symbols

### SocialMediaScraperManager (Phase 3)
- Orchestrates 7 source adapters: `TwitterScraper`, `RedditScraper`, `RssScraper`, `DiscordScraper`, `TelegramScraper`, `YouTubeScraper`, `TikTokScraper`
- `fetchForCoin(symbol)` — coin-filtered scrape from all sources in parallel
- `fetchBatch(symbols[])` — sequential per-coin scraping
- `refreshRssAll()`, `refreshDiscordAll()`, `refreshTelegramAll()` — bulk background refresh

### ItemScorer (Phase 3)
- 4-signal pipeline per item: `score_sentiment (30%) + score_engagement (25%) + score_authority (25%) + score_recency (20%)`
- Platform-specific engagement weights; source authority baselines (rss=75, youtube=65, twitter=45, discord=40, reddit=35, telegram=30, tiktok=25)

### TrendingDiscoveryEngine (Phase 3)
- Extracts coins, hashtags, and keywords from all items in the time window
- Velocity = `mentions/hour` vs prior window; composite rank: `velocity×0.25 + engagement×0.20 + mentions×0.20 + sources×0.15 + authority×0.10 + sentiment_strength×0.10`
- Persists results to `trending_topics` table; saves historical snapshots for coin topics

### MultiSourceTrendCalculator (Phase 3)
- Per-symbol `MultiSourceTrendReport` with direction (BULLISH/NEUTRAL/BEARISH), strength (STRONG/MODERATE/WEAK), velocity, sentiment distribution, top sources, keywords, recent items
- Historical comparison: `score_24h_ago`, `score_7d_ago`, `trend_acceleration` (accelerating/decelerating/stable)

### SocialStore (Phase 3)
- `better-sqlite3` synchronous SQLite; 4 tables: `social_media_items`, `trending_topics`, `trending_topic_history`, `source_metadata`
- Cursor-based pagination via base64url-encoded `{sort, primary, fetched_at, id}` payloads
- Bulk upsert via transactions; `pruneOldItems`, `resetDailyCounters`, `getStats`

### AppInsightsTransport (Telemetry)
- Extends Winston's `Transport`; batches events and flushes every 5s or at 50 events
- Severity mapping: debug→0, info→1, warn→2, error→3
- Error logs with `stack` → `ExceptionData` envelope; others → `MessageData`
- Enabled only when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set

### SentimentService
- `analyzeSentiment(symbol, headlines, priceChange7d, volatility, context)` — calls Claude API, requests JSON with `sentiment_score`, `confidence`, `summary`, `key_catalysts`, `risk_factors`, `short_term_outlook`, `volatility_warning`
- Model: `CLAUDE_MODEL` env var (default: `claude-sonnet-4-6`)
- Falls back to local heuristics using the scored content context on any Claude/API parse failure

### Cache
- Simple `Map`-based TTL cache with `get`, `set`, `delete` methods
- Two instances: `cache` (coins/history/headlines) and `sentimentCache` (sentiment results)

### fetchAndCacheSentiment (helper)
- Checks `sentimentCache` for a coin; if hit, merges fields onto the coin object
- If miss: calls `ContentSignalService` → `SentimentService`, stores the enriched sentiment in `sentimentCache` with 24-hr TTL and persists it to SQLite
- Sets `trending_score` from weighted frequency, recency, and source diversity rather than raw headline count

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
  trending_score: number;                  // weighted trend score derived from content volume/recency/source mix
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
  trending_score: number;
  scored_items?: ScoredSentimentItem[];
  source_breakdown?: SentimentSourceBreakdown[];
  collection_stats?: SentimentCollectionStats;
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
      "trending_score": 44.5,
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
    "summary": "...",
    "trending_score": 44.5,
    "source_breakdown": [],
    "collection_stats": {
      "total_items": 8,
      "source_count": 2,
      "weighted_frequency": 5.8,
      "average_recency_score": 0.71,
      "trending_score": 44.5,
      "collected_at": "2026-03-17T08:00:00.000Z"
    }
  },
  "scored_items": [],
  "headlines": ["Headline 1", "Headline 2"],
  "news_count": 8
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
- `DetailModal` — full-screen overlay with Chart.js line chart, sentiment summary, source breakdown, scored market signals, and headlines. Closes on ESC or backdrop click.

**Chart:** `react-chartjs-2` `<Line>` component rendering 7-day OHLCV close prices. Registered components: `CategoryScale`, `LinearScale`, `PointElement`, `LineElement`, `Tooltip`.

---

## 7. Scheduled Jobs

**Daily sentiment batch** (`SENTIMENT_JOB_CRON`, default `0 2 * * *`):
```typescript
cron.schedule(process.env.SENTIMENT_JOB_CRON || '0 2 * * *', async () => {
  // 1. Fetch top SENTIMENT_BATCH_SIZE coins from CoinGecko
  // 2. Clear sentiment cache for all coins
  // 3. Re-analyze sequentially (sequential to respect API rate limits)
  // Logs: start, per-coin result, elapsed time
});
```

**Hourly social scrape** (`SOCIAL_SCRAPE_CRON`, default `0 * * * *`):
- RSS + Discord + Telegram bulk refresh for all configured sources
- Twitter + Reddit per-coin scrape for the top 10 cached coins
- `discoverTrends()` — rebuild trending topic rankings from fresh data
- Prune `social_media_items` older than the configured retention window

**Midnight counter reset** (`0 0 * * *`):
- `socialStore.resetDailyCounters()` — resets per-source daily rate-limit counters

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

# Optional / future-facing
AZURE_STORAGE_CONNECTION_STRING=
APPINSIGHTS_INSTRUMENTATION_KEY=
LOG_LEVEL=info
TRENDING_JOB_CRON="*/30 * * * *"
X_BEARER_TOKEN=
TWITTER_BEARER_TOKEN=
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
├── .github/workflows/        ← CI workflows
└── docs/                     ← architecture, phase, and reference docs
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
