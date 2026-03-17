# Sentiment Analyzer

Real-time cryptocurrency sentiment analysis platform. Fetches live market data from CoinGecko, aggregates news and social signals, and uses Claude AI plus local scoring heuristics to generate Bull/Neutral/Bear sentiment for the top coins. Displayed through an interactive React dashboard with MARL tournament tooling and social media intelligence.

## Quick Start

```bash
# Backend (localhost:3000)
cd backend
npm install
cp .env.example .env   # add your API keys
npm run dev

# Frontend (localhost:5173) — separate terminal
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. The Vite dev server proxies `/api/*` to the backend automatically.

## VS Code Dev Task

If you are running the app from VS Code, use `Terminal: Run Task` and select `dev: restart in vscode`.

That task:

- stops existing repo-local backend and frontend dev processes
- starts backend and frontend in separate VS Code integrated terminals
- opens `http://localhost:5173` after the frontend is ready

## Required Environment Variables

Set these in `backend/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | Yes | From [console.anthropic.com](https://console.anthropic.com) |
| `NEWSAPI_API_KEY` | Yes | From [newsapi.org](https://newsapi.org) |
| `API_SECRET_KEY` | Yes | Any string — used to authenticate `POST /api/refresh-sentiment` |
| `COINGECKO_API_KEY` | No | Free tier works without it |

Optional tuning variables: `CLAUDE_MODEL`, `SENTIMENT_BATCH_SIZE`, `SENTIMENT_JOB_CRON`, `PORT`, `ALLOWED_ORIGINS`, `MARL_RATE_LIMIT_WINDOW_MS`, `MARL_START_RATE_LIMIT_MAX`, `MARL_COMPARE_RATE_LIMIT_MAX`, `MARL_READ_RATE_LIMIT_MAX`.

### Phase 3 — Social Media & Telemetry Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWITTER_BEARER_TOKEN` | No | Twitter/X API v2 bearer token |
| `REDDIT_CLIENT_ID` | No | Reddit OAuth2 (falls back to unauthenticated) |
| `REDDIT_CLIENT_SECRET` | No | Reddit OAuth2 |
| `REDDIT_USERNAME` | No | Reddit OAuth2 |
| `REDDIT_PASSWORD` | No | Reddit OAuth2 |
| `DISCORD_BOT_TOKEN` | No | Discord bot for channel monitoring |
| `DISCORD_CHANNEL_IDS` | No | Comma-separated snowflake IDs |
| `TELEGRAM_BOT_TOKEN` | No | Telegram Bot API (optional; scrapes public HTML without it) |
| `TELEGRAM_CHANNEL_USERNAMES` | No | Comma-separated public channel names |
| `YOUTUBE_API_KEY` | No | YouTube Data API v3 (~101 quota units/coin) |
| `RAPIDAPI_KEY` | No | TikTok via RapidAPI |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | Azure Application Insights telemetry |
| `SOCIAL_SCRAPE_CRON` | No | Cron for hourly scrape (default: `0 * * * *`) |
| `TRENDING_MIN_MENTIONS` | No | Min mentions to appear in trending (default: `3`) |

## Architecture

Backend is `backend/src/index.ts` (routes + cron) with services split into `backend/src/services/`. Single-file frontend (`frontend/src/App.tsx`) with all components and hooks.

```
React Dashboard (polling every 10 min)
    ↓ /api/*
Express Backend (port 3000)
    ├── CoinGeckoService           → market data, OHLCV history
    ├── ContentSignalService       → normalized NewsAPI + Reddit + X-ready scoring pipeline
    ├── NewsAPIService             → structured news articles
    ├── SocialScraperService       → Reddit / Stocktwits / X scraping
    ├── TrendingTopicsEngine       → cross-source topic ranking and trending endpoints
    ├── SentimentService           → Claude API (BULL/NEUTRAL/BEAR + summary) with local fallback
    ├── SentimentAnalyzerEngine    → 4-mode local analysis engine
    ├── TradingAgent (×3)          → RuleBased / MLBased / Hybrid agents
    ├── BacktestingEngine          → historical simulation + metrics
    ├── SocialMediaScraperManager  → 7-source scraper (Twitter, Reddit, RSS, Discord, Telegram, YouTube, TikTok)
    ├── TrendingDiscoveryEngine    → entity aggregation, velocity scoring, SQLite persistence
    ├── MultiSourceTrendCalculator → per-symbol trend report with historical comparison
    ├── SocialStore (SQLite)       → social_media_items, trending_topics, trending_topic_history, source_metadata
    └── Cache + SQLite             → 5-min coins TTL, 24-hr sentiment TTL, persisted sentiment/backtests
```

**Scheduled jobs:**

- **Daily at 2 AM UTC** (`SENTIMENT_JOB_CRON`): re-analyzes the top `SENTIMENT_BATCH_SIZE` coins (default 50) and refreshes the sentiment cache.
- **Hourly** (`SOCIAL_SCRAPE_CRON`, default `0 * * * *`): RSS + Discord + Telegram bulk refresh, Twitter + Reddit for the top 10 coins, `discoverTrends()`, and prune of old items.
- **Midnight UTC** (`0 0 * * *`): resets daily fetch and error counters for all social sources.

## API Endpoints

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/coins` | Top coins with sentiment. Params: `limit`, `sort_by` |
| GET | `/api/coins/:symbol` | Detail view — price history, headlines, scored items, source breakdown, sentiment |
| GET | `/api/sentiment/:symbol` | Cached sentiment object including `scored_items`, `source_breakdown`, and `collection_stats` |
| POST | `/api/refresh-sentiment` | Force re-analysis. Requires `x-api-key` header |
| GET | `/api/health` | Service status — reports `misconfigured` if API keys are missing |
| GET | `/api/scrape/social` | Scrape one symbol from social sources and ingest posts into the trending engine |
| POST | `/api/scrape/batch` | Batch scrape up to 20 symbols from social sources |
| GET | `/api/trending` | Ranked trending topics from ingested social posts |
| POST | `/api/trending/ingest` | Manually ingest scraped posts into the trending engine |

### Phase 1 — Advanced Analysis & Backtesting

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sentiment/analyze` | Run BASIC / ADVANCED / TRADING_SIGNALS / SMART analysis |
| POST | `/api/agents/configure` | Register trading agents (RULE_BASED / ML_BASED / HYBRID) |
| POST | `/api/backtest/run` | Run day-by-day backtest over CoinGecko historical data |
| GET | `/api/backtest/results/:testId` | Retrieve full backtest report with equity curves |
| GET | `/api/rankings/top-coins` | Coins ranked by SMART composite score. Params: `limit` |
| GET | `/api/info/modes` | Documentation — modes, agent types, risk profiles |

### Phase 2 — MARL Competitive Trading

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/marl/competition/start` | Start tournament (fire-and-forget, returns 202 + `competitionId`) |
| GET | `/api/marl/competition/:id/status` | Poll progress, top performer, and status |
| GET | `/api/marl/competition/:id/results` | Full results — rankings, H2H, equity curve, market impact |
| POST | `/api/marl/agents/compare` | N-round head-to-head comparison between two agents |
| GET | `/api/marl/competitions` | List all competitions (in-memory) |
| GET | `/api/marl/info` | Documentation for modes, agent configs, and order book |

**Tournament Modes:**
- `SINGLE` — one-shot tournament; all agents compete simultaneously on a shared order book
- `EVOLUTIONARY` — multi-round tournament where underperformers are mutated/replaced each round
- `CONTINUOUS` — ongoing learning loop; agents update Q-tables and policy weights in real time

**MARL rate limiting:**
- `POST /api/marl/competition/start` defaults to 5 requests per 60 seconds per client IP
- `POST /api/marl/agents/compare` defaults to 10 requests per 60 seconds per client IP
- MARL read endpoints default to 120 requests per 60 seconds per client IP
- Rate-limited responses include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
- Override these with `MARL_RATE_LIMIT_WINDOW_MS`, `MARL_START_RATE_LIMIT_MAX`, `MARL_COMPARE_RATE_LIMIT_MAX`, and `MARL_READ_RATE_LIMIT_MAX`

**Example cURL:**
```bash
# Start a SINGLE tournament with 3 agents
curl -s -X POST http://localhost:3000/api/marl/competition/start \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "SINGLE",
    "agents": [
      { "id": "alpha", "riskProfile": "AGGRESSIVE" },
      { "id": "beta",  "riskProfile": "CONSERVATIVE" },
      { "id": "gamma", "riskProfile": "SCALPING" }
    ],
    "symbols": ["BTC", "ETH"],
    "duration": 200,
    "refreshInterval": 1000,
    "learningEnabled": true
  }' | jq '{id: .competitionId, status: .status}'

# Poll until COMPLETED
curl -s http://localhost:3000/api/marl/competition/<id>/status | jq '{status, progress, topPerformer}'

# Fetch full results
curl -s http://localhost:3000/api/marl/competition/<id>/results | jq '{rankings: .finalRankings[0:3]}'

# Head-to-head comparison (5 rounds)
curl -s -X POST http://localhost:3000/api/marl/agents/compare \
  -H "Content-Type: application/json" \
  -d '{
    "agent1": { "id": "alpha", "riskProfile": "AGGRESSIVE" },
    "agent2": { "id": "beta",  "riskProfile": "CONSERVATIVE" },
    "symbols": ["BTC"],
    "rounds": 5,
    "duration": 100
  }' | jq '{winner: .overallWinner, a1WinRate: .agent1WinRate, a2WinRate: .agent2WinRate}'

# List all competitions
curl -s http://localhost:3000/api/marl/competitions | jq '{total: .total, latest: .competitions[0]}'

# API documentation (modes, risk profiles, order book, learning algorithm)
curl -s http://localhost:3000/api/marl/info | jq .
```

### Phase 3 — Social Media Intelligence

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/social-media/trending-topics` | Clustered trending topics; params: `timeWindow`, `limit`, `type` |
| GET | `/api/social-media/items` | Paginated scored social items; params: `coin`, `source`, `sort`, `limit`, `offset`, `cursor`, `min_score`, `since_hours` |
| GET | `/api/social-media/item/:id` | Single item with `scoring_breakdown` and signal weights |
| GET | `/api/social-media/stats` | Source health counters and item totals |
| GET | `/api/trending-score/:symbol` | Multi-source `MultiSourceTrendReport`; params: `interval` |
| POST | `/api/social-media/refresh` | Fire-and-forget scrape; body: `{ symbols?, rss_only? }`; returns 202 |

**Example cURL — Phase 3:**
```bash
# Top trending topics across all sources (last 4 hours, top 10)
curl -s "http://localhost:3000/api/social-media/trending-topics?timeWindow=4h&limit=10" | jq .

# Paginated social items for BTC, sorted by score
curl -s "http://localhost:3000/api/social-media/items?coin=BTC&sort=score&limit=20" | jq .

# Multi-source trend report for BTC
curl -s "http://localhost:3000/api/trending-score/BTC?interval=1h" | jq .
```

### Example cURL Commands

```bash
# 1. SMART sentiment for BTC
curl -s -X POST http://localhost:3000/api/sentiment/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["BTC"],
    "mode": "SMART",
    "marketData": {
      "BTC": {
        "symbol": "BTC", "price_usd": 65000,
        "price_change_24h_percent": 2.5, "price_change_7d_percent": 8.0,
        "volatility_24h": 4.2, "volatility_7d": 12.0,
        "volume_24h_usd": 30000000000, "market_cap_usd": 1300000000000,
        "market_rank": 1
      }
    }
  }' | jq .

# 2. Configure agents
curl -s -X POST http://localhost:3000/api/agents/configure \
  -H "Content-Type: application/json" \
  -d '{
    "agents": [
      { "type": "RULE_BASED",  "riskProfile": "CONSERVATIVE", "initialCapital": 10000 },
      { "type": "ML_BASED",   "riskProfile": "AGGRESSIVE",   "initialCapital": 10000 },
      { "type": "HYBRID",     "riskProfile": "SCALPING",      "initialCapital": 5000  }
    ]
  }' | jq .

# 3. Run backtest (uses agents configured above)
curl -s -X POST http://localhost:3000/api/backtest/run \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["bitcoin", "ethereum"],
    "startDate": "2024-09-01",
    "endDate": "2025-03-01"
  }' | jq '{testId: .testId, top: .topPerformer, summary: .summary}'

# 4. Fetch full backtest report
curl -s http://localhost:3000/api/backtest/results/<testId> | jq .

# 5. Smart coin rankings (top 10)
curl -s "http://localhost:3000/api/rankings/top-coins?limit=10" | jq .

# 6. API documentation
curl -s http://localhost:3000/api/info/modes | jq .
```

## Tech Stack

**Backend:** Node.js 20, Express, TypeScript (strict), Winston structured logging, node-cron, Helmet, CORS, better-sqlite3

**Frontend:** React 18, TypeScript, Vite, Chart.js / react-chartjs-2

**External APIs:** CoinGecko (free), NewsAPI (free tier, 500 req/day), Claude API (pay-per-call, ~$6–15/month for daily batch)

**Storage:** SQLite (via better-sqlite3) — persists backtest results, sentiment cache, and social media items across restarts; no server required

## Project Structure

```
sentiment-analyzer/
├── backend/
│   ├── src/
│   │   ├── index.ts                          # Routes, cron jobs, server setup
│   │   ├── types.ts                          # Shared Coin / Sentiment interfaces
│   │   ├── storage.ts                        # SQLite persistence layer
│   │   ├── database/
│   │   │   └── sqlite-social-store.ts        # Social media SQLite store (4 tables)
│   │   ├── routes/
│   │   │   ├── marl-competition.ts           # MARL competition API routes (Phase 2)
│   │   │   └── social-media.ts               # Phase 3 social media API routes
│   │   ├── telemetry/
│   │   │   └── app-insights-transport.ts     # Azure Application Insights Winston transport
│   │   └── services/
│   │       ├── cache.ts                      # TTL Map cache
│   │       ├── coingecko.ts                  # CoinGecko API client
│   │       ├── content-signals.ts            # Normalized content scoring pipeline
│   │       ├── newsapi.ts                    # NewsAPI client
│   │       ├── social-scraper.ts             # Social scraping adapters
│   │       ├── sentiment.ts                  # Claude API sentiment analysis
│   │       ├── sentiment-analyzer.ts         # 4-mode local analysis engine
│   │       ├── trending-topics.ts            # Trending topic discovery engine
│   │       ├── trading-agent.ts              # Agent framework (Rule/ML/Hybrid)
│   │       ├── backtesting-engine.ts         # Historical simulation engine
│   │       ├── marl-competition-engine.ts    # Multi-agent competition engine (Phase 2)
│   │       └── social-media/
│   │           ├── scraper/                  # 7 scraper adapters + scraper-manager.ts
│   │           ├── scoring/                  # coin-extractor.ts, item-scorer.ts
│   │           └── trending/                 # trending-discovery-engine.ts, multi-source-calculator.ts
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/App.tsx           # All UI — components, hooks, chart
│   ├── vite.config.ts        # Proxies /api to localhost:3000
│   └── package.json
├── docs/
│   ├── phase1/               # Phase 1 architecture & integration docs
│   ├── phase2/               # Phase 2 MARL competition docs
│   └── references/           # Reference implementations and storage guides
├── postman/                  # API test collection
├── DEPLOYMENT_GUIDE.md       # Azure Free Tier deployment steps
└── CLAUDE.md                 # Claude Code guidance
```

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for Azure App Service setup. Current deployments use SQLite for persistence and the repo already includes GitHub Actions CI in `.github/workflows/ci.yml`; Azure Table Storage remains a future option rather than the active storage layer.

## Cost

Running the sentiment batch daily against 50 coins costs approximately **$6–15/month** in Claude API fees. All other services (CoinGecko, NewsAPI free tier, Azure App Service B1) are free.

---

## Phase 2: Multi-Agent Reinforcement Learning (MARL) — Complete ✅

Competitive multi-agent trading: multiple AI agents compete simultaneously on a shared order book, discovering emergent strategies through adversarial Q-learning.

### Key Concepts

- **SharedOrderBook** — Price-time FIFO order matching; agents directly affect each other's fill prices through slippage
- **MarlTradingAgent** — Q-learning + epsilon-greedy exploration + experience replay; 50-feature state space; 5-action policy network (50→64→32→5)
- **Tournament Modes** — SINGLE (one-shot), EVOLUTIONARY (mutation + replacement), CONTINUOUS (live learning loop)
- **Risk Profiles** — CONSERVATIVE (1% risk/trade), AGGRESSIVE (5%), SCALPING (3%, short hold)

### Documentation

See [`docs/phase2/`](./docs/phase2/) for full architecture, game theory analysis, and integration details:
- [MARL Executive Summary](./docs/phase2/MARL_EXECUTIVE_SUMMARY.md)
- [Detailed Architecture](./docs/phase2/MARL_ARCHITECTURE_DETAILED.md)
- [Integration Guide](./docs/phase2/MARL_INTEGRATION_GUIDE.md)

---

## Phase 3: Social Media Intelligence — Complete ✅

A full social media intelligence layer sits alongside the existing sentiment pipeline, ingesting content from 7 sources, scoring every item through a 4-signal pipeline, and surfacing per-symbol trend reports with velocity comparisons.

### What's Included

- **7-source scraper suite** — Twitter/X (API v2), Reddit (OAuth2 + unauthenticated fallback), RSS feeds, Discord (bot), Telegram (Bot API or public HTML fallback), YouTube Data API v3, TikTok via RapidAPI; orchestrated by `SocialMediaScraperManager`
- **4-signal scoring pipeline** — each ingested item is scored across sentiment (30%), engagement (25%), authority (25%), and recency (20%); implemented in `item-scorer.ts` with coin detection via a 55-coin dictionary (`coin-extractor.ts`)
- **SQLite persistence** — 4 tables (`social_media_items`, `trending_topics`, `trending_topic_history`, `source_metadata`); bulk upsert via transactions; cursor-based pagination for efficient large result sets
- **Trending discovery** — `TrendingDiscoveryEngine` aggregates entities cross-source, computes velocity against the prior time window, and persists snapshots to `trending_topic_history` for historical comparison
- **Multi-source trend report** — `MultiSourceTrendCalculator` produces a `MultiSourceTrendReport` per symbol: per-source item counts, composite trend score, and comparison to the previous interval
- **Application Insights transport** — `AppInsightsTransport` is a custom Winston transport that batches structured log entries and exceptions, then POSTs them to the Azure Application Insights REST API; enabled automatically when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set
- **Hourly scrape cron** — configurable via `SOCIAL_SCRAPE_CRON` (default `0 * * * *`); runs RSS + Discord + Telegram bulk refresh, Twitter + Reddit for the top 10 coins, `discoverTrends()`, and pruning of stale items
- **Midnight counter reset** — resets daily fetch and error counters stored in `source_metadata` so per-day rate budgets are tracked accurately
- **Frontend Social Intel tab** — `SocialDashboard` component with trending topics ranked table (rank, direction badge, score bar, velocity), clickable per-symbol trend score panel (composite/sentiment/engagement signals, BULL/NEUTRAL/BEAR distribution, acceleration indicator), social items feed with coin/source/sort filters, and source health table showing per-platform item counts and error rates

For Phase 3 API endpoints see the [Phase 3 — Social Media Intelligence](#phase-3--social-media-intelligence) table above.
