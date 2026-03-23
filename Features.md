# Features & Functionality

> Last updated: 2026-03-23

Status legend: ✅ Fully implemented | ⚠️ Partial / credentials required | 🔴 Stub / not functional

---

## Table of Contents

- [Features \& Functionality](#features--functionality)
  - [Table of Contents](#table-of-contents)
  - [1. Sentiment Analysis Engine](#1-sentiment-analysis-engine)
  - [2. Coin Data \& Market Intelligence](#2-coin-data--market-intelligence)
  - [3. MARL Competition Engine](#3-marl-competition-engine)
    - [Competition Modes](#competition-modes)
    - [Exchange Modes](#exchange-modes)
    - [Agent Risk Profiles](#agent-risk-profiles)
    - [Learning System](#learning-system)
    - [Shared Order Book](#shared-order-book)
    - [API Endpoints](#api-endpoints)
  - [4. Evolutionary System](#4-evolutionary-system)
    - [Components](#components)
    - [Genetic Crossover Strategies](#genetic-crossover-strategies)
    - [Mutation Severities](#mutation-severities)
    - [Fitness Calculation](#fitness-calculation)
    - [Selection](#selection)
    - [API Endpoints](#api-endpoints-1)
  - [5. Agent Pre-Training (Synthetic Markets)](#5-agent-pre-training-synthetic-markets)
    - [Synthetic Market Regimes](#synthetic-market-regimes)
  - [6. Exchange Integrations](#6-exchange-integrations)
  - [7. Risk Management \& Kill Switch](#7-risk-management--kill-switch)
    - [TradingService Safety Guards](#tradingservice-safety-guards)
  - [8. Broker Integration (Alpaca)](#8-broker-integration-alpaca)
  - [9. Backtesting Engine](#9-backtesting-engine)
  - [10. Agent Management](#10-agent-management)
  - [11. Social Media Scrapers](#11-social-media-scrapers)
  - [12. Social Media Scoring](#12-social-media-scoring)
  - [13. Trending Discovery](#13-trending-discovery)
  - [14. BullMQ Worker Infrastructure](#14-bullmq-worker-infrastructure)
  - [15. Redis Pub/Sub](#15-redis-pubsub)
  - [16. Caching](#16-caching)
  - [17. SQLite Storage \& Repositories](#17-sqlite-storage--repositories)
    - [Tables](#tables)
  - [18. Authentication \& Rate Limiting](#18-authentication--rate-limiting)
  - [19. Frontend Dashboard](#19-frontend-dashboard)
    - [Components](#components-1)
    - [Custom Hooks](#custom-hooks)
    - [Polling Intervals](#polling-intervals)
    - [Libraries](#libraries)
  - [20. Docker \& Compose Infrastructure](#20-docker--compose-infrastructure)
    - [`docker-compose.yml` Services](#docker-composeyml-services)
  - [21. CI/CD Pipeline](#21-cicd-pipeline)
  - [22. Azure Telemetry / Application Insights](#22-azure-telemetry--application-insights)

---

## 1. Sentiment Analysis Engine

**Status:** ✅ Fully implemented  
**Key file:** `backend/src/services/sentiment-analyzer.ts`

Four analysis modes selectable per request via `POST /api/sentiment/analyze`:

| Mode | Description | Status |
|------|-------------|--------|
| **BASIC** | Binary BULL / NEUTRAL / BEAR with confidence score | ✅ |
| **ADVANCED** | Multi-factor scoring: news + momentum + volatility + volume + RSI + on-chain metrics; outputs `risk_level` and per-factor `feature_attribution` | ✅ |
| **TRADING_SIGNALS** | BUY / SELL / HOLD with target price, stop-loss, and risk/reward ratio; uses 1 h and 6 h momentum windows | ✅ |
| **SMART** | Composite explainable score combining all factors | ✅ |

**SMART factor weights:** News 25% · Momentum 20% · Volatility 15% · Volume 15% · Technical 15% · On-chain 10%

**Supporting features:**
- Claude 3 API integration with local NLP fallback
- NewsAPI as primary news source
- On-chain metrics aggregation
- 24-hour sentiment cache (TTL)
- Scheduled background refresh (configurable cron)
- `POST /api/refresh-sentiment` admin endpoint (requires `x-api-key`)

---

## 2. Coin Data & Market Intelligence

**Status:** ✅ Fully implemented  
**Key file:** `backend/src/index.ts` (core routes), `backend/src/services/coingecko.ts`

| Endpoint | Description | Status |
|----------|-------------|--------|
| `GET /api/coins` | Top coins with sentiment, market cap, price, volatility, trending score. Supports `?limit`, `?sort_by` | ✅ |
| `GET /api/coins/:symbol` | Full coin detail: price history (OHLCV), headlines, sentiment today, scored signal items, source breakdown, collection stats | ✅ |
| `GET /api/sentiment/:symbol` | Read-only cached sentiment lookup; 404 if not yet analyzed | ✅ |
| `GET /api/rankings/top-coins` | Top coins ranked by composite / sentiment / volatility | ✅ |
| `GET /api/info/modes` | Available sentiment modes and configuration | ✅ |
| `GET /api/trending` | In-memory trending sentiment topics | ✅ |
| `GET /api/health` | Service health check (Claude, NewsAPI, SQLite) | ✅ |

**Cache TTLs:** Coin list 5 min · Price history 15 min · Sentiment 24 h

---

## 3. MARL Competition Engine

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/marl-competition-engine.ts`, `backend/src/routes/marl-competition.ts`

### Competition Modes

| Mode | Description | Status |
|------|-------------|--------|
| **SINGLE** | One-shot tournament; all agents run once | ✅ |
| **EVOLUTIONARY** | Multi-generation tournament wired to genetic algorithm | ✅ |
| **CONTINUOUS** | Persistent live-learning mode | ✅ |

### Exchange Modes

| Mode | Description | Status |
|------|-------------|--------|
| **SIMULATED** | Shared in-process order book with slippage; offloads to BullMQ tournament worker when Redis available | ✅ |
| **PAPER** | Paper trading via `PaperExchange` (in-memory, no real orders); always on main thread | ✅ |
| **LIVE** | Real-money trading via configured exchange adapter | ✅ |

### Agent Risk Profiles

| Profile | Behavior | Status |
|---------|----------|--------|
| **AGGRESSIVE** | Larger position sizes, higher signal sensitivity | ✅ |
| **CONSERVATIVE** | Smaller positions, risk-averse signals | ✅ |
| **SCALPING** | Rapid micro-trades with tight stops | ✅ |

### Learning System

- Q-table (tabular state) and policy network weights
- Optional 54-dimension extended sentiment feature state
- Persistent learning states in SQLite `agent_learning_states` table

### Shared Order Book

- Limit-order matching engine
- Configurable bid/ask spread and slippage model
- Competitor order visibility for game-theoretic signal extraction

### API Endpoints

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| `POST` | `/api/marl/competition/start` | Launch tournament | ✅ |
| `GET` | `/api/marl/competition/:id/status` | Poll progress | ✅ |
| `GET` | `/api/marl/competition/:id/results` | Fetch results | ✅ |
| `GET` | `/api/marl/competition/:id/equity-curves` | Per-agent equity curves | ✅ |
| `POST` | `/api/marl/agents/compare` | Head-to-head multi-round comparison | ✅ |
| `GET` | `/api/marl/competitions` | List all tournaments | ✅ |
| `GET` | `/api/marl/agents/learning` | List persisted learning states | ✅ |
| `DELETE` | `/api/marl/agents/:agentId/learning` | Reset agent Q-table/policy | ✅ |
| `POST` | `/api/marl/agents/:agentId/pretrain` | Offline pre-training with synthetic market data | ✅ |
| `POST` | `/api/marl/agents/:agentId/algorithm` | Swap learning algorithm | ✅ |
| `GET` | `/api/marl/coin-universe` | Preview AUTO coin selection | ✅ |
| `GET` | `/api/marl/info` | Live endpoint info | ✅ |

---

## 4. Evolutionary System

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/evolutionary/`

### Components

| Component | File | Status |
|-----------|------|--------|
| Orchestrator | `evolutionary-orchestrator.ts` | ✅ |
| Genome CRUD | `agent-genome.ts` | ✅ |
| Genetic crossover | `genetic-crossover.ts` | ✅ |
| Mutation engine | `mutation-engine.ts` | ✅ |
| Fitness calculator | `fitness-calculator.ts` | ✅ |
| Selection algorithm | `selection-algorithm.ts` | ✅ |
| Statistics manager | `agent-statistics-manager.ts` | ✅ |
| Cosmetics manager | `agent-cosmetics-manager.ts` | ✅ |

### Genetic Crossover Strategies

| Strategy | Behavior | Status |
|----------|----------|--------|
| **UNIFORM** | 50/50 random gene selection from each parent | ✅ |
| **BLENDED** | Weighted average of parent genes | ✅ |

### Mutation Severities

| Severity | Behavior | Status |
|----------|----------|--------|
| **LIGHT** | Minor parameter tweaks; few genes affected | ✅ |
| **MEDIUM** | Moderate exploration | ✅ |
| **HEAVY** | Major parameter shifts; aggressive exploration | ✅ |

### Fitness Calculation

- Composite 0–100 score: PnL + win rate + Sharpe ratio + risk-adjusted returns

### Selection

- Configurable `survivalPercent`; top performers survive, below-threshold agents retire

### API Endpoints

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| `POST` | `/api/evolutionary/tournament` | Start evolutionary tournament | ✅ |
| `GET` | `/api/evolutionary/tournament` | List all tournaments | ✅ |
| `GET` | `/api/evolutionary/tournament/:id` | Tournament status with generation timeline | ✅ |
| `GET` | `/api/evolutionary/summary` | Aggregate dashboard (best/latest/cross-tournament) | ✅ |
| `POST` | `/api/evolutionary/breed` | Manual breeding (crossover + mutation) | ✅ |
| `GET` | `/api/agents/:id/genome` | Agent genome snapshot | ✅ |
| `GET` | `/api/agents/:id/genealogy` | Agent ancestry tree | ✅ |
| `GET` | `/api/marl/evolution/history` | All generations across all tournaments | ✅ |
| `GET` | `/api/marl/evolution/best-genome` | Highest-fitness genome ever recorded | ✅ |
| `GET` | `/api/marl/evolution/population` | Current population of latest tournament | ✅ |

---

## 5. Agent Pre-Training (Synthetic Markets)

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/pre-trainer.ts`, `backend/src/services/synthetic-market-generator.ts`

### Synthetic Market Regimes

| Regime | Description | Status |
|--------|-------------|--------|
| **BULL_TREND** | Steady upward price movement | ✅ |
| **BEAR_TREND** | Steady downward movement | ✅ |
| **SIDEWAYS** | Flat consolidation | ✅ |
| **VOLATILE_CRASH** | Sudden sharp decline | ✅ |
| **VOLATILE_PUMP** | Sudden sharp rally | ✅ |

**Features:**
- OHLCV-style synthetic candle generation
- Configurable episodes and steps-per-episode via request body
- Additive learning — subsequent calls continue from prior persisted state
- Convergence curve returned per call
- State stored in the same `agent_learning_states` table used by live competitions

---

## 6. Exchange Integrations

**Status:** ✅ All four adapters fully implemented  
**Key files:** `backend/src/services/exchange/`

| Exchange | Type | Modes | Auth | Status |
|----------|------|-------|------|--------|
| **Paper Exchange** | Simulated (in-memory) | PAPER | None | ✅ |
| **Crypto.com** | Real (default) | SANDBOX, LIVE | HMAC-SHA256 REST v2 | ✅ |
| **Binance.US** | Real | SANDBOX (testnet), LIVE | API key + secret | ✅ |
| **Coinbase** | Real | SANDBOX, LIVE | CB-ACCESS-KEY Advanced Trade v3 | ✅ |

**Common interface (`ExchangeInterface`):**
- `getCurrentPrice(symbol)` — latest market price
- `getBalance(symbol)` / `getBalances()` — account holdings
- `placeOrder(params)` — limit/market order placement
- `cancelOrder(orderId)` — cancel open order
- `getOrderStatus(orderId)` — async status polling

**Provider selection:** `TRADING_PROVIDER` env var (`crypto-com` default, `binance-us`, `coinbase`)

---

## 7. Risk Management & Kill Switch

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/exchange/trading-service.ts`, `backend/src/services/exchange/risk-manager.ts`

### TradingService Safety Guards

| Guard | Behavior | Status |
|-------|----------|--------|
| **Kill switch** | Halts all BUY orders when daily loss % exceeds threshold | ✅ |
| **Max positions** | Blocks new positions when open count reaches cap | ✅ |
| **Position size cap** | Limits notional value per position | ✅ |
| **Minimum notional** | Enforces $1 minimum order value | ✅ |

**Notes:**
- SELL orders always allowed even when kill switch is active (exit mechanism preserved)
- Kill switch threshold and position limits configurable per competition

---

## 8. Broker Integration (Alpaca)

**Status:** ✅ Fully implemented (Alpaca only)  
**Key files:** `backend/src/services/brokers/`

| Endpoint | Description | Status |
|----------|-------------|--------|
| `POST /api/marl/broker/credentials` | Store AES-256-GCM encrypted broker credentials | ✅ |
| `GET /api/marl/broker/credentials` | List stored credentials (metadata only, no secrets) | ✅ |
| `DELETE /api/marl/broker/credentials/:id` | Remove credentials | ✅ |
| `POST /api/marl/broker/connect/:id` | Decrypt and activate broker adapter | ✅ |
| `GET /api/marl/broker/connected` | List active adapters | ✅ |
| `GET /api/marl/broker/orders/:competitionId` | Order audit trail | ✅ |
| `POST /api/marl/broker/emergency-stop` | Cancel all open orders immediately | ✅ |

**Notes:**
- Supports both `paper-api.alpaca.markets` and `api.alpaca.markets`
- Credentials encrypted with `BROKER_MASTER_KEY` (AES-256-GCM); never logged or returned in plaintext
- Symbol mapping: internal `BTC` → Alpaca `BTC/USD`

---

## 9. Backtesting Engine

**Status:** ✅ Fully implemented  
**Key file:** `backend/src/services/backtesting-engine.ts`

| Endpoint | Description | Status |
|----------|-------------|--------|
| `POST /api/backtest/run` | Run backtest with agent configs + historical price data | ✅ |
| `GET /api/backtest/results/:testId` | Fetch stored backtest results | ✅ |

**Slippage models:** FIXED · VOLUME_BASED · MARKET_IMPACT

**Output metrics per agent:** trades · PnL · Sharpe ratio · win rate · max drawdown  
**Comparison output:** best-by-metric ranking + aggregate stats across all agents

---

## 10. Agent Management

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/routes/agent-stats.ts`, `backend/src/services/evolutionary/agent-cosmetics-manager.ts`

| Endpoint | Description | Status |
|----------|-------------|--------|
| `GET /api/agents` | Paginated agent list sorted by win rate | ✅ |
| `GET /api/agents/stats/leaderboard` | Top agents by win rate | ✅ |
| `GET /api/agents/:id` | Single agent detail | ✅ |
| `PUT /api/agents/:id/customize` | Update name, emoji, color, bio | ✅ |
| `POST /api/agents/:id/retire` | Manually retire underperforming agent | ✅ |
| `GET /api/agents/:id/history` | Competition history for an agent | ✅ |

**Customization fields:** name (free text) · emoji (10 options) · color (HEX validated) · bio (max 200 chars)  
**Persistence:** cosmetics survive restarts and generations via `agent_registry` table

---

## 11. Social Media Scrapers

**Status:** ✅ 6 of 7 platforms implemented; TikTok is a stub  
**Key files:** `backend/src/services/social-media/scraper/`

| Platform | Credential Required | Status |
|----------|---------------------|--------|
| **Twitter / X** | `TWITTER_BEARER_TOKEN` | ✅ |
| **Reddit** | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | ✅ |
| **Discord** | `DISCORD_BOT_TOKEN` | ✅ |
| **Telegram** | `TELEGRAM_BOT_TOKEN` | ✅ |
| **YouTube** | `YOUTUBE_API_KEY` | ✅ |
| **RSS / News feeds** | None | ✅ |
| **TikTok** | — | 🔴 Stub only |

**Scraper Manager** (`scraper-manager.ts`): orchestrates all scrapers, handles per-platform errors independently, supports batch scraping.

**BullMQ integration:** when `REDIS_URL` is set, `POST /api/social-media/refresh` enqueues to the scraper worker process; falls back to `setImmediate` in-process otherwise.

---

## 12. Social Media Scoring

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/social-media/scoring/`

| Component | Purpose | Status |
|-----------|---------|--------|
| **FinBERT** | Neural financial sentiment score (−1 to +1); local or remote via `FINBERT_API_URL` / `HUGGINGFACE_API_TOKEN` | ✅ |
| **Sarcasm detector** | Flags ironic / sarcastic content before scoring | ✅ |
| **Coin extractor** | Identifies all mentioned cryptocurrency symbols in post text | ✅ |
| **Text normalizer** | ABSA context-window extraction for aspect-based sentiment | ✅ |
| **Item scorer** | Composite per-item score | ✅ |

**Composite score weights:** Sentiment 30% · Engagement 25% · Authority 25% · Recency 20%

---

## 13. Trending Discovery

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/services/social-media/trending/`

| Endpoint | Description | Status |
|----------|-------------|--------|
| `GET /api/social-media/trending-topics` | Top N trending topics with semantic clustering | ✅ |
| `GET /api/social-media/items` | Scored item feed with cursor-based pagination | ✅ |
| `GET /api/social-media/item/:id` | Single item detail | ✅ |
| `GET /api/social-media/stats` | Collection statistics | ✅ |
| `POST /api/social-media/refresh` | Trigger immediate scrape | ✅ |
| `GET /api/trending-score/:symbol` | Multi-source trend report per coin | ✅ |

**Features:**
- Cross-platform trend aggregation with velocity (acceleration) calculation
- Topic clustering: related topics sharing a `coin_symbol` collapsed into one entry with `clustered_topics[]`
- Cursor-based keyset pagination with backward-compatible `offset` support
- Time window filtering: 24 h – 168 h

---

## 14. BullMQ Worker Infrastructure

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/queues/`, `backend/src/workers/`

| Component | File | Status |
|-----------|------|--------|
| Redis connection / `isQueueAvailable()` | `queues/connection.ts` | ✅ |
| Tournament queue | `queues/tournament.queue.ts` | ✅ |
| Scraper queue | `queues/scraper.queue.ts` | ✅ |
| Tournament worker process | `workers/tournament-worker-process.ts` | ✅ |
| Scraper worker process | `workers/scraper-worker-process.ts` | ✅ |

**Fallback behavior when `REDIS_URL` is not set:**

| Path | Fallback |
|------|----------|
| SIMULATED tournaments | Worker Threads (in-process) |
| Social scraper cron / refresh | `setImmediate` (in-process) |
| PAPER / LIVE tournaments | Always on main API thread |

**Worker startup commands:**
```bash
npm run dev:tournament-worker   # dev (watch mode)
npm run dev:scraper-worker      # dev (watch mode)
npm run worker:tournament       # production
npm run worker:scraper          # production
```

**Environment variables:** `REDIS_URL` · `TOURNAMENT_WORKER_CONCURRENCY` (default 2) · `SCRAPER_WORKER_CONCURRENCY` (default 1)

---

## 15. Redis Pub/Sub

**Status:** ✅ Fully implemented  
**Key file:** `backend/src/services/pubsub.ts`

- Real-time tournament progress updates published on `competition:{competitionId}` channel
- `QueueEvents` bridge in `routes/marl-competition.ts` translates BullMQ progress/completed/failed events to `engine.updateRecord()` — status polling API is transparent to callers
- Gracefully falls back to in-process `EventEmitter` when Redis is not available

---

## 16. Caching

**Status:** ✅ Fully implemented  
**Key file:** `backend/src/services/cache.ts`

| Data | TTL |
|------|-----|
| Coin list | 5 minutes |
| Sentiment per coin | 24 hours |
| Price history | 15 minutes |
| Headlines | 15 minutes |
| Trending data | 1 hour |

Implementation: `node-cache` (in-memory); no external dependency required.

---

## 17. SQLite Storage & Repositories

**Status:** ✅ Fully implemented  
**Key files:** `backend/src/storage.ts`, `backend/src/repositories/`, `backend/src/database/`

**Database:** `sentiment_analyzer.db` — WAL mode + foreign keys enabled; all queries synchronous via `better-sqlite3`

### Tables

| Table | Purpose |
|-------|---------|
| `agent_registry` | Agent master data + cosmetics |
| `agent_statistics` | Win rates, PnL, history |
| `agent_competitions` | Per-competition agent results |
| `agent_learning_states` | Q-tables + policy weights |
| `evolutionary_tournaments` | Tournament records |
| `broker_credentials` | AES-256-GCM encrypted broker API keys |
| `sentiment_cache` | Persisted sentiment analyses |
| `social_items` | Scraped posts + composite scores |
| `trending_topics` | Aggregated trending data |

**Repository pattern:** factory at `repositories/factory.ts` routes to SQLite adapters; interface definitions in `repositories/interfaces/`

**Migrations:** versioned migration files in `database/migrations/`; current latest: `003-agent-identity.ts`

---

## 18. Authentication & Rate Limiting

**Status:** ✅ Fully implemented  

| Feature | Coverage | Status |
|---------|----------|--------|
| API key auth (`x-api-key` header) | Admin endpoints: `POST /api/refresh-sentiment`, all `/api/marl/broker/*` credential routes | ✅ |
| Rate limiting | Per-path buckets on MARL routes (configurable window/max) | ✅ |
| 429 response with `Retry-After` | Applied on rate-limited MARL endpoints | ✅ |

---

## 19. Frontend Dashboard

**Status:** ✅ Fully implemented  
**Key files:** `frontend/src/`

### Components

| Component | File | Description | Status |
|-----------|------|-------------|--------|
| **Main dashboard** | `App.tsx` (40 KB) | Coin list, sentiment filters, coin detail modal, Sentiment Lab, health pill, sentiment refresh controls, Backtesting tab | ✅ |
| **MARL Competition Viewer** | `components/MarlCompetitionViewer.tsx` (37 KB) | Tournament launch UI, equity curves, head-to-head comparison, info drawer, manual equity reload, agent cosmetics | ✅ |
| **Agent Management Dashboard** | `components/AgentManagementDashboard.tsx` | Agent registry, leaderboard, breeding controls, genealogy tree, generation trends, cross-tournament comparison, genome snapshot | ✅ |
| **Social Dashboard** | `components/SocialDashboard.tsx` | Trending topics, scraper health, manual refresh, trend score panel, scored item detail drill-in | ✅ |

### Custom Hooks

| Hook | Purpose | Status |
|------|---------|--------|
| `useMarlCompetition.ts` | Tournament lifecycle: start → poll → results → compare → history | ✅ |
| `useSocialMedia.ts` | Trending topics, scored items, social stats with auto-refresh | ✅ |

### Phase 1 UI Parity Delivered

- `P1-T1` Sentiment Lab in Dashboard: analyze, lookup, rankings, and modes
- `P1-T2` Sentiment refresh action with API-key entry and async feedback
- `P1-T3` Global health indicator with expandable backend service detail
- `P1-T4` Dedicated Backtesting tab with configure, run, and result reload workflow
- `P1-T5` MARL info panel and equity-curve reload workflow
- `P1-T6` Social refresh control and item-level detail drill-in

### Polling Intervals

| Context | Interval |
|---------|----------|
| Main dashboard | 10 minutes |
| Global health pill | 30 seconds |
| Tournament progress | 2 seconds |
| Agent management | 5 seconds (via `refreshNonce`) |

### Libraries

- **ChartJS / react-chartjs-2** — equity curves, generation trend charts
- Inline styles throughout (no external CSS framework)

---

## 20. Docker & Compose Infrastructure

**Status:** ✅ Fully implemented

### `docker-compose.yml` Services

| Service | Image | Purpose | Status |
|---------|-------|---------|--------|
| `redis` | `redis:7-alpine` | BullMQ broker + pub/sub | ✅ |
| `backend` | Custom (multi-stage) | Express API; depends on Redis | ✅ |
| `frontend` | Custom (Vite + Nginx) | Serves built SPA; proxies `/api/*` to backend | ✅ |
| `tournament-worker` | Same as backend | BullMQ tournament consumer; depends on Redis + healthy backend | ✅ |
| `scraper-worker` | Same as backend | BullMQ scraper consumer; depends on Redis + healthy backend | ✅ |

**Networking:** internal `REDIS_URL: redis://redis:6379`; `backend` health check via `GET /api/health`  
**Volumes:** SQLite database file shared between backend and workers (WAL mode ensures safe concurrent access)

---

## 21. CI/CD Pipeline

**Status:** ✅ Fully implemented  
**File:** `.github/workflows/ci.yml`

| Job | Steps | Trigger |
|-----|-------|---------|
| **Docs** | `node scripts/validate-docs.mjs` doc consistency check | push / PR to `main` |
| **Backend** | lint → type-check → test (Jest) → build | push / PR to `main` |
| **Frontend** | lint → type-check → test (Vitest) → build | push / PR to `main` |

---

## 22. Azure Telemetry / Application Insights

**Status:** ⚠️ Implemented; requires `APPLICATIONINSIGHTS_CONNECTION_STRING`  
**Key file:** `backend/src/telemetry/app-insights-transport.ts`

- Winston transport that forwards structured log events to Application Insights
- Activated automatically when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set in environment
- No code changes required to enable/disable
