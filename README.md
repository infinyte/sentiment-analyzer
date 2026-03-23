# Sentiment Analyzer

Real-time cryptocurrency sentiment analysis platform. Fetches live market data from CoinGecko, aggregates news and social signals, and uses Claude AI plus local NLP scoring heuristics to generate Bull/Neutral/Bear sentiment for top coins. The social scoring path now includes optional FinBERT inference, sarcasm detection, ABSA-ready context windows, and language detection. Results are displayed through an interactive React dashboard with Sentiment Lab tools, a global health indicator, backtesting, MARL tournament tooling, social media intelligence, and agent-management views backed by the evolutionary system.

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

Optional tuning variables: `CLAUDE_MODEL`, `SENTIMENT_BATCH_SIZE`, `SENTIMENT_JOB_CRON`, `PORT`, `ALLOWED_ORIGINS`, `MARL_RATE_LIMIT_WINDOW_MS`, `MARL_START_RATE_LIMIT_MAX`, `MARL_COMPARE_RATE_LIMIT_MAX`, `MARL_READ_RATE_LIMIT_MAX`, `TRADING_PROVIDER`, `REDIS_URL`, `TOURNAMENT_WORKER_CONCURRENCY`, `SCRAPER_WORKER_CONCURRENCY`.

### Social Media, NLP & Telemetry Variables

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
| `FINBERT_API_URL` | No | Hugging Face inference endpoint for FinBERT-compatible sentiment scoring |
| `HUGGINGFACE_API_TOKEN` | No | Hugging Face token used with `FINBERT_API_URL` |
| `TRANSLATION_API_KEY` | No | Reserved for future multilingual translation routing; language detection is already active without it |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | Azure Application Insights telemetry |
| `BROKER_MASTER_KEY` | No | AES-256-GCM key used to encrypt stored broker credentials (for `/api/marl/broker/*`); only required when using broker credential storage |
| `TRADING_PROVIDER` | No | `crypto-com` (default), `binance-us`, `coinbase`, or `alpaca`; selects exchange for SANDBOX/LIVE trading mode |
| `SOCIAL_SCRAPE_CRON` | No | Cron for hourly scrape (default: `0 * * * *`) |
| `TRENDING_MIN_MENTIONS` | No | Min mentions to appear in trending (default: `3`) |
| `REDIS_URL` | No | Redis connection URL (e.g. `redis://localhost:6379`). When set, enables BullMQ-backed tournament and scraper worker processes. Omit to keep all work in-process. |
| `TOURNAMENT_WORKER_CONCURRENCY` | No | Number of parallel tournament jobs the tournament worker processes at a time (default: `2`) |
| `SCRAPER_WORKER_CONCURRENCY` | No | Number of parallel scraper jobs the scraper worker processes at a time (default: `1`) |

## Architecture

Backend bootstrap lives in `backend/src/index.ts` (routes + cron) with services split into `backend/src/services/`. The frontend is a multi-file React app rooted at `frontend/src/App.tsx` with components, hooks, and types separated under `frontend/src/`.

## Frontend Surface

Current top-level tabs:

- Dashboard
- Agents
- MARL Competition
- Social Intel
- Backtesting

Current user-facing Phase 1 controls:

- Dashboard Sentiment Lab: analyze symbols, inspect cached sentiment, load rankings, and browse mode metadata
- Dashboard header refresh action: queue a sentiment cache refresh with API-key entry and feedback
- Global health pill: polls `/api/health` every 30 seconds with expandable service status
- Backtesting tab: configure agents, run backtests, persist test ids in session state, and reload stored results with KPI and equity views
- MARL info and curve reload: on-demand info drawer plus manual equity-curve recovery for historical competition ids
- Social manual refresh and item drill-in: queue social refresh jobs and inspect per-item scoring breakdowns without losing feed filters

```
React Dashboard (polling every 10 min)
    ↓ /api/*
Express Backend (port 3000)
    ├── CoinGeckoService           → market data, OHLCV history
    ├── ContentSignalService       → normalized NewsAPI + Reddit + X-ready scoring pipeline with sarcasm handling and optional context-window extraction
    ├── NewsAPIService             → structured news articles
    ├── SocialScraperService       → Reddit / Stocktwits / X scraping
    ├── TrendingTopicsEngine       → cross-source topic ranking and trending endpoints
    ├── SentimentService           → Claude API (BULL/NEUTRAL/BEAR + summary) with local fallback
    ├── SentimentAnalyzerEngine    → 4-mode local analysis engine + async text scoring helper
    ├── FinBertService             → optional Hugging Face-backed sentiment scoring for async social/item paths
    ├── TradingAgent (×3)          → RuleBased / MLBased / Hybrid agents
    ├── BacktestingEngine          → historical simulation + metrics
    ├── SocialMediaScraperManager  → 7-source scraper (Twitter, Reddit, RSS, Discord, Telegram, YouTube, TikTok) + async item scoring
    ├── TrendingDiscoveryEngine    → entity aggregation, velocity scoring, SQLite persistence
    ├── MultiSourceTrendCalculator → per-symbol trend report with historical comparison
    ├── ExchangeAdapter framework  → CoinbaseAdapter + BinanceAdapter (MARL layer); RiskManager (kill switch, daily-loss, order cap)
    ├── CryptoComExchange / BinanceUSExchange → ExchangeInterface adapters; CryptoComClient (HMAC-SHA256 REST v2)
    ├── TradingService             → 4 safety guards: kill switch, max positions, position size cap, $1 min notional
    ├── EvolutionaryOrchestrator   → multi-generation loop: MARL → fitness → selection → crossover → mutation
    ├── SocialStore (SQLite)       → social_media_items (+ language, sarcasm_flagged), trending_topics, trending_topic_history, source_metadata
    ├── Cache + SQLite             → 5-min coins TTL, 24-hr sentiment TTL, persisted sentiment/backtests
    │
    │   ── Queue Layer (optional — requires REDIS_URL) ──────────────────────────
    ├── BullMQ tournament queue    → enqueues SIMULATED competition jobs; falls back to Worker Threads when Redis is absent
    └── BullMQ scraper queue       → enqueues social scrape jobs; falls back to in-process setImmediate when Redis is absent

Tournament Worker Process (npm run worker:tournament)
    └── Consumes tournament queue → runs MarlCompetitionEngine → publishes progress/completed/failed via Redis pubsub

Scraper Worker Process (npm run worker:scraper)
    └── Consumes scraper queue → runs SocialMediaScraperManager → discoverTrends → prune
```

**NLP scoring enhancements:**

- `scoreItemAsync()` in the social-media pipeline prefers FinBERT when `FINBERT_API_URL` is configured, then falls back to the local keyword scorer.
- `detectSarcasm()` can invert and down-weight strong sarcastic sentiment in both content and social scoring flows.
- `detectLanguage()` stores ISO 639-1 language codes for social items using a Unicode-script heuristic with no external runtime dependency.
- `ContentSignalService` supports target-coin context windows for aspect-based sentiment scoring (ABSA). The `targetCoin` parameter defaults to the coin symbol so the ABSA path is fully active for all `/api/coins/:symbol` sentiment fetches.

**Scheduled jobs:**

- **Daily at 2 AM UTC** (`SENTIMENT_JOB_CRON`): re-analyzes the top `SENTIMENT_BATCH_SIZE` coins (default 50) and refreshes the sentiment cache.
- **Every 30 minutes** (`TRENDING_JOB_CRON`, default `*/30 * * * *`): scrapes the top-20 coins via the in-memory `TrendingTopicsEngine` and refreshes topic scores.
- **Hourly** (`SOCIAL_SCRAPE_CRON`, default `0 * * * *`): RSS + Discord + Telegram bulk refresh, Twitter + Reddit for the top 10 coins, `discoverTrends()`, and prune of old items. When `REDIS_URL` is set, the cron enqueues these jobs to the BullMQ scraper queue (processed by the scraper worker); otherwise they run in-process.
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
| POST | `/api/social-media/refresh` | Trigger immediate multi-source or RSS-only social refresh |
| GET | `/api/social-media/item/:id` | Retrieve one social item with full scoring breakdown |

### Phase 2 — MARL Competitive Trading

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/marl/competition/start` | Start tournament (fire-and-forget, returns 202 + `competitionId`) |
| GET | `/api/marl/competition/:id/status` | Poll progress, top performer, and status |
| GET | `/api/marl/competition/:id/results` | Full results — rankings, H2H, equity curve, market impact |
| POST | `/api/marl/agents/compare` | N-round head-to-head comparison between two agents |
| GET | `/api/marl/competitions` | List all competitions (in-memory) |
| GET | `/api/marl/agents/learning` | List all persisted agent learning states |
| DELETE | `/api/marl/agents/:agentId/learning` | Reset agent learning state (requires `x-api-key`). Query: `?riskProfile=` |
| GET | `/api/marl/coin-universe` | Compute per-agent coin selections from CoinGecko live data. Params: `agents` (JSON array), `universeSize`, `coinsPerAgent` |
| GET | `/api/marl/info` | Documentation for modes, agent configs, order book, and learning persistence |
| POST | `/api/marl/broker/credentials` | Store encrypted broker credentials (requires `x-api-key`) |
| GET | `/api/marl/broker/credentials` | List stored credential metadata — no secrets (requires `x-api-key`) |
| DELETE | `/api/marl/broker/credentials/:id` | Remove stored credential (requires `x-api-key`) |
| POST | `/api/marl/broker/connect/:id` | Decrypt and connect a broker adapter into the in-process registry |
| GET | `/api/marl/broker/connected` | List currently connected adapters |
| GET | `/api/marl/broker/credentials/picker` | Unauthenticated — returns `id`, `label`, `provider`, `mode` for UI dropdowns |
| GET | `/api/marl/broker/orders/:competitionId` | Order audit trail for a competition. Query: `?agentId=` |
| POST | `/api/marl/broker/emergency-stop` | Cancel all open orders for a competition |

### Agent Identity & Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List active agents (paginated) |
| GET | `/api/agents/stats/leaderboard` | Top agents by win rate |
| GET | `/api/agents/:id` | Single agent with stats |
| PUT | `/api/agents/:id/customize` | Update agent cosmetics (name, emoji, color, bio) |
| GET | `/api/agents/:id/history` | Competition history for an agent |
| GET | `/api/agents/:id/genome` | Agent genome (evolutionary parameters) |
| GET | `/api/agents/:id/genealogy` | Ancestry chain |

### Evolutionary Tournaments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evolutionary/tournament` | Start a multi-generation evolutionary tournament (202 + `tournamentId`) |
| GET | `/api/evolutionary/tournament` | List all tournaments (lightweight) |
| GET | `/api/evolutionary/tournament/:id` | Full tournament status + generation history |
| GET | `/api/evolutionary/summary` | Dashboard summary of recent tournaments and latest generation fitness timeline |

### Trading Service

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trading/exchange-status` | Exchange name and connection status |
| GET | `/api/trading/price/:symbol` | Current price for a symbol |
| GET | `/api/trading/balances` | All non-zero balances from the exchange |
| POST | `/api/trading/order` | Place an order through `TradingService` safety guards |
| GET | `/api/trading/stats` | Capital, PnL, trade counts, and max loss threshold |

**Tournament Modes:**
- `SINGLE` — one-shot tournament; all agents compete simultaneously on a shared order book
- `EVOLUTIONARY` — multi-round tournament where underperformers are mutated/replaced each round
- `CONTINUOUS` — ongoing learning loop; agents update Q-tables and policy weights in real time

**Learning Persistence:**
Agent Q-tables and policy-network weights are saved to SQLite (`agent_learning_states` table) at the end of every competition and loaded on startup. Agents accumulate knowledge across separate competition runs — they genuinely get smarter over time. Use `DELETE /api/marl/agents/:agentId/learning` (with `x-api-key`) to reset an agent to a blank state.

**MARL rate limiting:**
- `POST /api/marl/competition/start` defaults to 5 requests per 60 seconds per client IP
- `POST /api/marl/agents/compare` defaults to 10 requests per 60 seconds per client IP
- MARL read endpoints default to 120 requests per 60 seconds per client IP
- Rate-limited responses include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
- Override these with `MARL_RATE_LIMIT_WINDOW_MS`, `MARL_START_RATE_LIMIT_MAX`, `MARL_COMPARE_RATE_LIMIT_MAX`, and `MARL_READ_RATE_LIMIT_MAX`

## Validation

Latest local validation completed successfully:

- Backend build passed
- Frontend build passed
- Backend test suite passed
- Frontend test suite passed
- `node scripts/validate-docs.mjs` passed

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

**Backend:** Node.js 20, Express, TypeScript (strict), Winston structured logging, node-cron, Helmet, CORS, better-sqlite3, BullMQ + ioredis (optional background worker queues)

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
│   │   │   ├── marl-real-trading.ts          # Broker credentials + emergency stop
│   │   │   ├── agent-stats.ts                # Agent identity, leaderboard, cosmetics
│   │   │   ├── evolutionary.ts               # Evolutionary tournament routes
│   │   │   ├── trading.ts                    # TradingService REST wrapper
│   │   │   └── social-media.ts               # Phase 3 social media API routes
│   │   ├── queues/
│   │   │   ├── connection.ts                 # IORedis connection options + isQueueAvailable()
│   │   │   ├── tournament.queue.ts           # BullMQ Queue<TournamentJobData> singleton
│   │   │   └── scraper.queue.ts              # BullMQ Queue<ScraperJobData> singleton
│   │   ├── workers/
│   │   │   ├── tournament-worker-process.ts  # Stand-alone tournament worker entry point
│   │   │   └── scraper-worker-process.ts     # Stand-alone scraper worker entry point
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
│   │       ├── exchange/                     # Exchange adapter framework
│   │       │   ├── exchange-interface.ts      # Shared Order/Balance/PlaceOrderParams types
│   │       │   ├── exchange-factory.ts        # Routes PAPER→PaperExchange, SANDBOX/LIVE→provider
│   │       │   ├── paper-exchange.ts          # In-memory paper trading (no real orders)
│   │       │   ├── crypto-com-client.ts       # Crypto.com REST v2 client (HMAC-SHA256)
│   │       │   ├── crypto-com-exchange.ts     # ExchangeInterface adapter for Crypto.com
│   │       │   ├── binance-us-exchange.ts     # ExchangeInterface adapter for Binance.US
│   │       │   ├── trading-service.ts         # 4-guard safety layer over ExchangeInterface
│   │       │   ├── exchange-adapter.ts        # Abstract base + AccountMode types (MARL)
│   │       │   ├── exchange-registry.ts       # Process-lifetime adapter singleton
│   │       │   ├── risk-manager.ts            # Kill switch + daily-loss + order size guard
│   │       │   └── adapters/                  # coinbase-adapter.ts, binance-adapter.ts
│   │       ├── evolutionary/                 # Genetic algorithm pipeline
│   │       │   ├── evolutionary-orchestrator.ts  # Multi-generation tournament loop
│   │       │   ├── fitness-calculator.ts         # 0–100 composite fitness
│   │       │   ├── selection-algorithm.ts        # Survival partitioning
│   │       │   ├── genetic-crossover.ts          # UNIFORM / BLENDED crossover
│   │       │   ├── mutation-engine.ts            # LIGHT / MEDIUM / HEAVY mutation
│   │       │   ├── genome-manager.ts             # SQLite-backed genome CRUD
│   │       │   ├── agent-cosmetics-manager.ts    # Name / emoji / color / bio
│   │       │   └── agent-statistics-manager.ts  # Win-rate, PnL, history
│   │       ├── risk/
│   │       │   └── risk-guard.ts              # Pre-trade circuit breaker (MARL layer)
│   │       ├── brokers/                      # Alpaca adapter + broker registry + factory
│   │       └── social-media/
│   │           ├── scraper/                  # 7 scraper adapters + scraper-manager.ts
│   │           ├── scoring/                  # coin-extractor.ts, item-scorer.ts, sarcasm-detector.ts
│   │           └── trending/                 # trending-discovery-engine.ts, multi-source-calculator.ts
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Root component + hooks (useCoins, useCoinDetail)
│   │   ├── main.tsx              # React entry point
│   │   ├── components/
│   │   │   ├── AgentManagementDashboard.tsx # Agent registry, breeding controls, lineage + generation trends
│   │   │   ├── MarlCompetitionViewer.tsx   # MARL tournament UI
│   │   │   └── SocialDashboard.tsx         # Social Intel tab
│   │   ├── hooks/
│   │   │   ├── useMarlCompetition.ts       # MARL polling + state
│   │   │   └── useSocialMedia.ts           # Social media hooks
│   │   └── types/                          # marl.ts, social-media.ts
│   ├── vite.config.ts        # Proxies /api to localhost:3000
│   └── package.json
├── docs/
│   ├── phase1/               # Phase 1 architecture & integration docs
│   ├── phase2/               # Phase 2 MARL competition docs
│   └── references/           # Reference implementations and storage guides
├── postman/                  # API test collection
├── docker-compose.yml        # Backend + Redis + tournament-worker + scraper-worker services
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
- **Broker Integration** — PAPER / SANDBOX / LIVE modes; encrypted credential storage (AES-256-GCM); Alpaca adapter; emergency stop
- **Agent Identity** — cosmetics (name, emoji, color, bio), competition history, win-rate leaderboard persisted in SQLite
- **Evolutionary Orchestrator** — external genome-based evolution layer: FitnessCalculator → SelectionAlgorithm → GeneticCrossover → MutationEngine; results persisted in `evolutionary_tournaments` table
- **Exchange Layer** — `CryptoComExchange` (default) and `BinanceUSExchange` behind a shared `ExchangeInterface`; `TradingService` adds 4 safety guards; `PaperExchange` for zero-risk simulation

### Agent Management Dashboard

The frontend now includes a dedicated agent-management view backed by the existing agent identity and evolutionary APIs.

Current capabilities:
- Registry of active agents with filtering and sorting
- Leaderboard view based on persisted win rate and PnL
- Agent detail view with stats, competition history, genome snapshot, and genealogy records
- Cosmetic editing for name, emoji, color, biography, and nickname
- Breeding-pool workflow for selecting parents and creating mutated children from the UI
- Retirement flow for culling poor performers from the active pool
- Tournament-history drill-down for persisted evolutionary runs
- Cross-tournament comparison metrics for recent population improvement trends
- Interactive lineage exploration with parent-agent navigation
- First-pass evolutionary visualizations for lineage, generation-level population trends, and tournament fitness timelines

Backed by these endpoints:
- `GET /api/agents`
- `GET /api/agents/stats/leaderboard`
- `GET /api/agents/:id`
- `PUT /api/agents/:id/customize`
- `POST /api/agents/:id/retire`
- `GET /api/agents/:id/history`
- `GET /api/agents/:id/genome`
- `GET /api/agents/:id/genealogy`
- `POST /api/evolutionary/breed`

Still intentionally lightweight:
- Genealogy is now navigable, but still not a full free-form tree explorer yet.
- Generation and tournament trends are available, but there is not yet a full standalone historical evolution workspace.

### Documentation

See [`docs/phase2/`](./docs/phase2/) for full architecture, game theory analysis, and integration details:
- [MARL Executive Summary](./docs/phase2/MARL_EXECUTIVE_SUMMARY.md)
- [Detailed Architecture](./docs/phase2/MARL_ARCHITECTURE_DETAILED.md)
- [Integration Guide](./docs/phase2/MARL_INTEGRATION_GUIDE.md)
- [Evolutionary System Overview](./docs/EVOLUTIONARY_SYSTEM_OVERVIEW.md)

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
