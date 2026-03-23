# Sentiment-analyzer Coverage Report

This report maps backend endpoints to currently shipped frontend controls.

## Endpoint Coverage Snapshot (2026-03-23)

## Total backend HTTP endpoints found: 64

## Endpoints with frontend usage/control: 53

## Endpoints with no frontend usage/control: 11

## Findings: Endpoints Not Yet Implemented In Frontend
Highest impact first: write/admin/action endpoints with no UI control.

### MARL stream transport missing UI
GET /api/marl/competition/:competitionId/stream (marl-competition.ts)

### Evolutionary endpoints missing UI
POST /api/evolutionary/tournament (evolutionary.ts)
GET /api/evolutionary/tournament (list) (evolutionary.ts)
GET /api/marl/evolution/history (evolutionary.ts)
GET /api/marl/evolution/population (evolutionary.ts)

### Social/trending utility endpoints missing UI
GET /api/scrape/social (index.ts)
POST /api/scrape/batch (index.ts)
GET /api/trending (index.ts)
POST /api/trending/ingest (index.ts)

### Remaining broker admin utility gaps
No additional broker lifecycle gaps identified in this report; create/list/connect/delete/connected/orders/emergency-stop are now UI-covered.

## Endpoints/Features That Do Have Frontend Controls

### Coins dashboard
GET /api/coins
GET /api/coins/:symbol

### Dashboard parity additions
POST /api/sentiment/analyze
POST /api/refresh-sentiment
GET /api/sentiment/:symbol
GET /api/rankings/top-coins
GET /api/info/modes
GET /api/health

### Backtesting
POST /api/agents/configure
POST /api/backtest/run
GET /api/backtest/results/:testId

### Agent management and MARL admin
GET /api/agents
GET /api/agents/stats/leaderboard
GET /api/agents/:id
GET /api/agents/:id/history
PUT /api/agents/:id/customize
POST /api/agents/:id/retire
GET /api/agents/:id/genome
GET /api/agents/:id/genealogy
GET /api/marl/agents/learning
DELETE /api/marl/agents/:agentId/learning
POST /api/marl/agents/:agentId/algorithm

### MARL competition
POST /api/marl/competition/start
GET /api/marl/competition/:id/status
GET /api/marl/competition/:id/results
POST /api/marl/agents/compare
GET /api/marl/competitions
GET /api/marl/competition/:id/trade-log
GET /api/marl/info
GET /api/marl/competition/:competitionId/equity-curves
GET /api/marl/coin-universe
POST /api/marl/agents/:agentId/pretrain

### Broker lifecycle/admin
GET /api/marl/broker/credentials/picker
POST /api/marl/broker/credentials
GET /api/marl/broker/credentials
DELETE /api/marl/broker/credentials/:id
POST /api/marl/broker/connect/:id
GET /api/marl/broker/connected
GET /api/marl/broker/orders/:competitionId
POST /api/marl/broker/emergency-stop

### Trading workspace
GET /api/trading/exchange-status
GET /api/trading/price/:symbol
GET /api/trading/balances
POST /api/trading/order
GET /api/trading/stats

### Evolutionary dashboard (partial)
GET /api/evolutionary/summary
GET /api/evolutionary/tournament/:id
POST /api/evolutionary/breed
GET /api/marl/evolution/best-genome

### Social intelligence
GET /api/social-media/trending-topics
GET /api/social-media/items
GET /api/social-media/item/:id
GET /api/social-media/stats
POST /api/social-media/refresh
GET /api/trending-score/:symbol

## Feature-Level Summary

### Implemented and UI-covered
- core coin dashboard
- dashboard sentiment lab and health
- MARL competition flows
- broker admin lifecycle controls and emergency tools
- agent management, learning-state reset, and algorithm controls
- social topic/item analytics
- trading workspace (status, quote, balances, stats, order ticket)
- breeding and pretraining

### Implemented but UI-missing
- optional MARL SSE live stream toggle
- evolutionary tournament index/history/population workspace
- raw social scraping and ingest utilities

 Backend: Add tournament scheduler — DB table, cron engine, schedule/recurring params to start endpoint
 Backend: Add SSE streaming endpoint for live tournament events (equity, trades, agent actions)
 Backend: Expose live equity snapshots and agent positions during active tournament runs
 Frontend: Tournament Scheduler UI — create/edit/delete scheduled and recurring tournaments
 Frontend: Live Tournament Monitor panel — real-time equity curves, trade feed, agent actions during active run
 Backend: Add RealisticPaperExchange class — real broker prices, per-exchange fee schedules, slippage simulation
 Backend: Add REALISTIC_PAPER mode to exchange factory and expose fee schedule config
 Frontend: Add Realistic Paper mode to trading mode selector in MarlCompetitionViewer
 Backend: Add /api/admin/config endpoints to read and write .env values (auth protected)
 Frontend: Config editor modal on System/Admin tab — password-gated, groups all env vars by category, supports save

# New config to db feature
Migrate all configuration settings from the env files into the database. Here's how it breaks down:

## What stays in .env (irreducible minimum) - Only two things genuinely can't live in the DB:

- BROKER_MASTER_KEY=...      # Encrypts secrets stored IN the DB — circular if it were in the DB
- CONFIG_ADMIN_PASSWORD=...  # Gates the config UI — chicken-and-egg if stored in the DB it protects

Everything else can move to a app_config table and be managed through the UI.

## The architecture
A new ConfigService singleton backed by a app_config DB table:

* key | value (AES-encrypted if secret) | category | description | is_secret | updated_at

- The service reads from DB on startup, caches in memory
- Falls back to any existing .env value if a DB entry doesn't exist yet (smooth migration)
- Example - All existing process.env.NEWSAPI_KEY style reads across the codebase get replaced with config.get('NEWSAPI_KEY')
- When the UI saves a change, the service updates the DB and hot-reloads the in-memory cache — no server restart needed
- Secret values (CLAUDE_API_KEY, all social tokens, etc.) are encrypted at rest using BROKER_MASTER_KEY, same pattern already used for broker credentials
- BROKER_MASTER_KEY does double duty — it already encrypts broker credentials in the DB, now it also encrypts all other secrets stored there. One key to rule them all, and it's the only thing that truly must be in .env.

## What moves to the DB
### Category :	Keys

- AI / Sentiment : CLAUDE_API_KEY, NEWSAPI_API_KEY, FINBERT_API_URL, HUGGINGFACE_API_TOKEN
- Social Scrapers	: TWITTER_BEARER_TOKEN, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, DISCORD_BOT_TOKEN, TELEGRAM_BOT_TOKEN, YOUTUBE_API_KEY
- Trading	TRADING_PROVIDER, COINBASE_API_KEY, COINBASE_API_SECRET, COINBASE_TRADING_PAIR
- Auth	: API_SECRET_KEY
- Schedulers	: SENTIMENT_JOB_CRON, TRENDING_JOB_CRON, SOCIAL_SCRAPE_CRON, SENTIMENT_BATCH_SIZE, SOCIAL_HISTORY_DAYS
- Telemetry	: APPLICATIONINSIGHTS_CONNECTION_STRING

## TODO List
 - Backend: Add tournament scheduler — DB table, cron engine, schedule/recurring params to start endpoint
 - Backend: Add SSE streaming endpoint for live tournament events (equity, trades, agent actions)
 - Backend: Expose live equity snapshots and agent positions during active tournament runs
 - Frontend: Tournament Scheduler UI — create/edit/delete scheduled and recurring tournaments
 - Frontend: Live Tournament Monitor panel — real-time equity curves, trade feed, agent actions during active run
 - Backend: Add RealisticPaperExchange class — real broker prices, per-exchange fee schedules, slippage simulation
 - Backend: Add REALISTIC_PAPER mode to exchange factory and expose fee schedule config
 - Frontend: Add Realistic Paper mode to trading mode selector in MarlCompetitionViewer
 - Backend: Build ConfigService — app_config DB table with AES-encrypted secrets, in-memory cache, hot-reload, env fallback for migration
 - Backend: Migrate all process.env reads (except BROKER_MASTER_KEY and CONFIG_ADMIN_PASSWORD) to ConfigService
 - Backend: Add /api/admin/config GET and PATCH endpoints (password-gated, secrets never returned in plaintext)
 - Frontend: Config editor modal on System/Admin tab — password-gated, grouped by category, write-only secret fields, hot-saves to DB
 - Ops: Reduce .env files to BROKER_MASTER_KEY and CONFIG_ADMIN_PASSWORD only, update docs and .env.example