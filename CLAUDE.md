# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack crypto sentiment analysis platform. The backend fetches live market data (CoinGecko + NewsAPI), uses Claude API to generate daily coin sentiment scores, and augments social/content scoring with optional FinBERT inference, sarcasm detection, context-window extraction, and language detection. The React frontend displays an interactive dashboard with polling, filtering, and a detail modal.

## Commands

### Backend (`cd backend`)
```bash
npm run dev          # Start with hot-reload (nodemon + tsx)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled dist/index.js
npm test             # Run Jest tests
npm run test:watch   # Jest watch mode
npm run lint         # ESLint on src/
npm run type-check   # TypeScript type-check without emitting
npm run clean        # Remove dist/ and logs/
```

### Frontend (`cd frontend`)
```bash
npm run dev          # Vite dev server on :5173
npm run build        # tsc + vite build → dist/
npm run preview      # Preview production build
npm run lint         # ESLint on src/
npm run type-check   # TypeScript type-check without emitting
npm test             # Run Vitest tests
npm run test:watch   # Vitest watch mode
```

## Architecture

### Data Flow
```
React (localhost:5173)
  → /api/* proxied to Express (localhost:3000)
  → CoinGeckoService (free, no key) + NewsAPIService (500 req/day free tier)
  → SentimentService (Claude API, ~$0.01-0.03/request)
  → In-memory Cache (5-min TTL for coins, 24-hr for sentiment) + SQLite secondary cache
```

### Backend (`backend/src/index.ts` + `backend/src/services/`)
Routes and cron job live in `index.ts`; logic is split into service files:
- **CoinGeckoService** (`services/coingecko.ts`) — top coins + OHLCV history
- **NewsAPIService** (`services/newsapi.ts`) — structured news articles + headline helper
- **ContentSignalService** (`services/content-signals.ts`) — normalized per-item scoring for NewsAPI, Reddit, and X-ready content, with sarcasm handling and optional target-coin context windows
- **SocialScraperService** (`services/social-scraper.ts`) — Reddit / Stocktwits / X scraping with dedupe and rate limiting
- **TrendingTopicsEngine** (`services/trending-topics.ts`) — cross-source topic ranking with trending scores
- **SentimentService** (`services/sentiment.ts`) — Claude API, returns BULL/NEUTRAL/BEAR + summary; falls back to local scored-signal heuristics on error
- **SentimentAnalyzerEngine** (`services/sentiment-analyzer.ts`) — 4-mode local engine (BASIC/ADVANCED/TRADING_SIGNALS/SMART) plus `scoreTextAsync()` for optional FinBERT-backed text scoring
- **FinBertService** (`services/finbert.ts`) — optional Hugging Face inference wrapper for social/item sentiment scoring
- **TradingAgent** (`services/trading-agent.ts`) — abstract base + RuleBasedAgent, MLBasedAgent, HybridAgent; AgentFactory for instantiation
- **BacktestingEngine** (`services/backtesting-engine.ts`) — day-by-day simulation using CoinGecko OHLCV; stores results in memory
- **Cache** (`services/cache.ts`) — `Map`-based TTL cache with `get/set/delete`

API endpoints (core):
- `GET /api/coins` — top coins with sentiment
- `GET /api/coins/:symbol` — detailed report with `sentiment_today`, `scored_items`, and `source_breakdown`
- `GET /api/sentiment/:symbol` — cached sentiment object including scored content metadata
- `POST /api/refresh-sentiment` — admin trigger (requires `x-api-key` header matching `API_SECRET_KEY`)
- `GET /api/health`
- `GET /api/scrape/social` — scrape one symbol from social sources and auto-ingest posts into trending analysis
- `POST /api/scrape/batch` — batch social scrape for up to 20 symbols
- `GET /api/trending` — ranked trending topics across ingested social posts
- `POST /api/trending/ingest` — manual ingestion endpoint for scraped posts/tests

API endpoints (Phase 1):
- `POST /api/sentiment/analyze` — 4-mode analysis; BASIC works without `marketData`, others require it
- `POST /api/agents/configure` — register agents in memory registry
- `POST /api/backtest/run` — runs simulation; uses configured agents or inline `agents` array; symbols must be CoinGecko IDs (e.g. `"bitcoin"`)
- `GET /api/backtest/results/:testId` — full report from in-memory store
- `GET /api/rankings/top-coins` — SMART-ranked coin list
- `GET /api/info/modes` — static documentation

API endpoints (Phase 2 — MARL Competition):
- `POST /api/marl/competition/start` — fire-and-forget start; returns 202 with `competitionId`; body: `{ mode, agents, symbols, duration, refreshInterval, learningEnabled, evolutionaryRounds? }`
- `GET /api/marl/competition/:id/status` — poll running/completed/failed status + progress %
- `GET /api/marl/competition/:id/results` — full `CompetitionResult` (rankings, H2H, equity curve, impact)
- `POST /api/marl/agents/compare` — N-round head-to-head; body: `{ agent1, agent2, symbols, rounds, duration }`
- `GET /api/marl/competitions` — list all competitions (in-memory)
- `GET /api/marl/agents/learning` — list all persisted agent learning states (cache keys + agent IDs)
- `DELETE /api/marl/agents/:agentId/learning` — reset learned Q-table + weights for an agent; requires `x-api-key`; optional `?riskProfile=` to target one profile
- `GET /api/marl/info` — static documentation for modes/config/learning persistence

API endpoints (Phase 3 — Social Media Intelligence):
- `GET /api/social-media/trending-topics` — top trending topics (clustered by coin); query: `timeWindow`, `limit`, `type`
- `GET /api/social-media/items` — paginated scored social items; query: `coin`, `source`, `sort`, `limit`, `offset`, `cursor`, `min_score`, `since_hours`
- `GET /api/social-media/item/:id` — single item with `scoring_breakdown` and signal weights
- `GET /api/social-media/stats` — source health counters and item totals
- `GET /api/trending-score/:symbol` — multi-source `MultiSourceTrendReport`; query: `interval`
- `POST /api/social-media/refresh` — fire-and-forget scrape; body: `{ symbols?, rss_only? }`; returns 202

Social media services (`backend/src/services/social-media/`):
- **Scrapers** (`scraper/`): `twitter-scraper.ts`, `reddit-scraper.ts`, `rss-scraper.ts`, `discord-scraper.ts`, `telegram-scraper.ts`, `youtube-scraper.ts`, `tiktok-scraper.ts`; orchestrated by `scraper-manager.ts`
- **Scoring** (`scoring/`): `coin-extractor.ts` (55-coin dictionary, `$BTC`/`#BTC`/name detection), `item-scorer.ts` (4-signal pipeline: sentiment 30%, engagement 25%, authority 25%, recency 20%, plus optional FinBERT, sarcasm detection, and language detection), `sarcasm-detector.ts` (heuristic sarcasm/irony detector)
- **Trending** (`trending/`): `trending-discovery-engine.ts` (cross-source entity aggregation, velocity vs prior window, persists to DB), `multi-source-calculator.ts` (per-symbol trend report with historical comparison)
- **SQLite store** (`database/sqlite-social-store.ts`): tables `social_media_items`, `trending_topics`, `trending_topic_history`, `source_metadata`; cursor-based pagination; bulk upsert via transactions

Cron jobs (in `index.ts`):
- Hourly (`SOCIAL_SCRAPE_CRON`, default `0 * * * *`): RSS + Discord + Telegram bulk refresh, Twitter + Reddit for top 10 coins, `discoverTrends()`, prune old items
- Midnight (`0 0 * * *`): `socialStore.resetDailyCounters()`

Telemetry:
- **AppInsightsTransport** (`telemetry/app-insights-transport.ts`): Winston transport that POSTs batched `MessageData`/`ExceptionData` envelopes to Azure Application Insights REST API; enabled when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set

### Frontend (`frontend/src/App.tsx`)
Multi-view app with Dashboard, MARL Competition, and Social Intel tabs:
- Polls `/api/coins` every 10 minutes on Dashboard view
- `useCoins()` / `useCoinDetail()` custom hooks in `App.tsx`
- Components: `SentimentBadge`, `PercentChange`, `CoinCard`, `Dashboard`, `DetailModal`, `MarlCompetitionViewer`, `SocialDashboard`
- Detail modal renders `sentiment_today`, `source_breakdown`, and `scored_items` from the enriched coin detail payload
- MARL hook: `useMarlCompetition()` in `frontend/src/hooks/useMarlCompetition.ts`; types: `frontend/src/types/marl.ts`
- Social hooks: `useTrendingTopics`, `useSocialItems`, `useSocialStats`, `useTrendScore` in `frontend/src/hooks/useSocialMedia.ts`; types: `frontend/src/types/social-media.ts`
- `SocialDashboard` (`frontend/src/components/SocialDashboard.tsx`): trending topics ranked table, per-symbol trend score panel (composite/sentiment/engagement signals, sentiment distribution, acceleration), social items feed (filterable by coin/source/sort), source health table
- All styles are inline (no CSS files)
- Vite proxies `/api` to `http://localhost:3000`

## Environment Setup

Copy `backend/.env.example` to `backend/.env` and set:
```
NEWSAPI_API_KEY=      # newsapi.org
CLAUDE_API_KEY=       # console.anthropic.com
API_SECRET_KEY=       # any string for admin endpoint auth
```
`COINGECKO_API_KEY` is optional (free tier works without it).

Optional Group A sentiment variables:
```
FINBERT_API_URL=      # Hugging Face inference endpoint for FinBERT-compatible models
HUGGINGFACE_API_TOKEN=# token sent to the FinBERT endpoint when configured
TRANSLATION_API_KEY=  # reserved for future multilingual translation routing
```

Frontend `.env` only needs `VITE_API_BASE_URL=http://localhost:3000` for non-proxied use; defaults work for dev.

## Docker

```bash
# Build and run both services (frontend on :80, backend on :3000 internally)
docker compose up --build

# Backend only
docker compose up backend

# One-off backend build
docker build -t sentiment-backend ./backend
```

`docker-compose.yml` at the repo root wires frontend → nginx → backend. SQLite data is persisted in a named Docker volume (`sqlite_data`). Set secrets in `backend/.env` before `docker compose up`.

## CI/CD

`.github/workflows/ci.yml` runs on every push/PR to `main`:
- **backend** job: `npm ci` → lint → type-check → test → build
- **frontend** job: `npm ci` → lint → type-check → build (parallel with backend)

Both jobs use Node 20 with npm cache enabled.

## Implementation Status

**Implemented:** All 5 core API endpoints, social scraping endpoints, trending-topic endpoints, 6 Phase 1 endpoints, 8 Phase 2 MARL endpoints, 6 Phase 3 social-media intelligence endpoints, normalized content scoring pipeline (NewsAPI + Reddit + X-ready), 4-signal social item scoring pipeline, optional `FinBertService` integration for async social/item scoring, heuristic sarcasm detection, content-scoring context-window extraction support, social-item language detection + persistence, 7-source scraper suite (Twitter, Reddit, RSS, Discord, Telegram, YouTube, TikTok), trending topic discovery with velocity + entity clustering, multi-source coin trend report with historical comparison, SQLite social persistence (3 core tables plus `language` / `sarcasm_flagged` social-item columns), Application Insights Winston transport, hourly social scrape cron, midnight counter-reset cron, Winston structured logging, GitHub Actions CI/CD, Docker + docker-compose, ESLint configs (backend + frontend), 24-hr sentiment cache, 5-min coin cache, 15-min price history/headlines cache, SQLite sentiment/backtest/agent-learning persistence, daily sentiment cron job, Chart.js price chart in detail modal, scored signal rendering in the detail modal, `SentimentAnalyzerEngine` (4 modes + `scoreTextAsync()`), `TradingAgent` framework (Rule/ML/Hybrid + AgentFactory), `BacktestingEngine` (day-by-day simulation, Sharpe, drawdown, equity curve), **`MarlCompetitionEngine`** (SINGLE/EVOLUTIONARY/CONTINUOUS tournament modes, `SharedOrderBook` with price-time FIFO matching + synthetic market-maker liquidity, `PolicyNetwork` feedforward net in pure TypeScript, `MarlTradingAgent` with Q-learning + epsilon-greedy + experience replay, scale-invariant state space, normalised % reward signals, cross-competition learning persistence via SQLite `agent_learning_states`), **MARL React UI** (config form, progress polling, rankings table, H2H table, equity chart, market impact table), **Social Intel React UI** (`SocialDashboard` with trending topics table, trend score panel, items feed with filters, source health table), backend Jest 291 tests, frontend Vitest 36 tests.

**Not yet implemented:** Azure Table Storage as active persistence layer.
