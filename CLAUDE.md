# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A full-stack crypto sentiment analysis platform. The backend fetches live market data (CoinGecko + NewsAPI) and uses Claude API to generate daily sentiment scores (BULL/NEUTRAL/BEAR) for the top 50 coins. The React frontend displays an interactive dashboard with polling, filtering, and a detail modal.

## Commands

### Backend (`cd backend`)
```bash
npm run dev          # Start with hot-reload (nodemon + ts-node)
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
- **NewsAPIService** (`services/newsapi.ts`) — headlines per coin
- **SentimentService** (`services/sentiment.ts`) — Claude API, returns BULL/NEUTRAL/BEAR + summary; falls back to NEUTRAL on error
- **SentimentAnalyzerEngine** (`services/sentiment-analyzer.ts`) — 4-mode local engine (BASIC/ADVANCED/TRADING_SIGNALS/SMART); no external API calls
- **TradingAgent** (`services/trading-agent.ts`) — abstract base + RuleBasedAgent, MLBasedAgent, HybridAgent; AgentFactory for instantiation
- **BacktestingEngine** (`services/backtesting-engine.ts`) — day-by-day simulation using CoinGecko OHLCV; stores results in memory
- **Cache** (`services/cache.ts`) — `Map`-based TTL cache with `get/set/delete`

API endpoints (core):
- `GET /api/coins` — top coins with sentiment
- `GET /api/coins/:symbol` — detailed report
- `GET /api/sentiment/:symbol` — cached sentiment only
- `POST /api/refresh-sentiment` — admin trigger (requires `x-api-key` header matching `API_SECRET_KEY`)
- `GET /api/health`

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
- `GET /api/marl/info` — static documentation for modes/config

### Frontend (`frontend/src/App.tsx`)
Multi-view app with Dashboard + MARL Competition tabs:
- Polls `/api/coins` every 10 minutes on Dashboard view
- `useCoins()` / `useCoinDetail()` custom hooks
- Components: `SentimentBadge`, `PercentChange`, `CoinCard`, `Dashboard`, `DetailModal`, `MarlCompetitionViewer`
- MARL hook: `useMarlCompetition()` in `frontend/src/hooks/useMarlCompetition.ts`
- MARL types: `frontend/src/types/marl.ts`
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

Frontend `.env` only needs `VITE_API_BASE_URL=http://localhost:3000` for non-proxied use; defaults work for dev.

## Implementation Status

**Implemented:** All 5 core API endpoints, 6 Phase 1 endpoints, 6 Phase 2 MARL endpoints, sentiment analysis pipeline (Claude API), 24-hr sentiment cache, 5-min coin cache, 15-min price history/headlines cache, daily cron job (`node-cron`), Chart.js price chart in detail modal, ESC/backdrop modal close, volatility calculation from CoinGecko high/low, `trending_score` from headline count, `SentimentAnalyzerEngine` (4 modes), `TradingAgent` framework (Rule/ML/Hybrid + AgentFactory), `BacktestingEngine` (day-by-day simulation, Sharpe, drawdown, equity curve), **`MarlCompetitionEngine`** (SINGLE/EVOLUTIONARY/CONTINUOUS tournament modes, `SharedOrderBook` with price-time FIFO matching, `PolicyNetwork` feedforward net in pure TypeScript, `MarlTradingAgent` with Q-learning + epsilon-greedy + replay buffer, equity evolution snapshots, competitor impact tracking), **MARL React UI** (config form, progress polling, rankings table, H2H table, equity chart, market impact table).

**Not yet implemented:** Azure Table Storage (SQLite via `better-sqlite3` is used instead — sentiment cache and backtest results survive restarts), GitHub Actions CI/CD (`.github/workflows/` has only a stub), Application Insights structured logging, frontend tests (Vitest/React Testing Library), Docker/container configuration.
