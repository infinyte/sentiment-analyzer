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