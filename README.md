# Sentiment Analyzer

Real-time cryptocurrency sentiment analysis platform. Fetches live market data from CoinGecko, aggregates news headlines from NewsAPI, and uses Claude AI to generate daily Bull/Neutral/Bear sentiment scores for the top 50 coins. Displayed through an interactive React dashboard.

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

## Architecture

Backend is `backend/src/index.ts` (routes + cron) with services split into `backend/src/services/`. Single-file frontend (`frontend/src/App.tsx`) with all components and hooks.

```
React Dashboard (polling every 10 min)
    ↓ /api/*
Express Backend (port 3000)
    ├── CoinGeckoService        → market data, OHLCV history
    ├── NewsAPIService          → headlines per coin
    ├── SentimentService        → Claude API (BULL/NEUTRAL/BEAR + summary)
    ├── SentimentAnalyzerEngine → 4-mode local analysis engine
    ├── TradingAgent (×3)       → RuleBased / MLBased / Hybrid agents
    ├── BacktestingEngine       → historical simulation + metrics
    └── Cache                   → 5-min coins TTL, 24-hr sentiment TTL
```

**Scheduled job:** Daily at 2 AM UTC (`SENTIMENT_JOB_CRON`), the backend re-analyzes the top `SENTIMENT_BATCH_SIZE` coins (default 50) and refreshes the sentiment cache.

## API Endpoints

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/coins` | Top coins with sentiment. Params: `limit`, `sort_by` |
| GET | `/api/coins/:symbol` | Detail view — price history, headlines, sentiment |
| GET | `/api/sentiment/:symbol` | Cached sentiment only (404 if not yet analyzed) |
| POST | `/api/refresh-sentiment` | Force re-analysis. Requires `x-api-key` header |
| GET | `/api/health` | Service status — reports `misconfigured` if API keys are missing |

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

**Backend:** Node.js 18+, Express, TypeScript (strict), node-cron, Helmet, CORS, better-sqlite3

**Frontend:** React 18, TypeScript, Vite, Chart.js / react-chartjs-2

**External APIs:** CoinGecko (free), NewsAPI (free tier, 500 req/day), Claude API (pay-per-call, ~$6–15/month for daily batch)

**Storage:** SQLite (via better-sqlite3) — persists backtest results and sentiment cache across restarts; no server required

## Project Structure

```
sentiment-analyzer/
├── backend/
│   ├── src/
│   │   ├── index.ts                          # Routes, cron job, server setup
│   │   ├── types.ts                          # Shared Coin / Sentiment interfaces
│   │   ├── storage.ts                        # SQLite persistence layer
│   │   ├── services/
│   │   │   ├── cache.ts                      # TTL Map cache
│   │   │   ├── coingecko.ts                  # CoinGecko API client
│   │   │   ├── newsapi.ts                    # NewsAPI client
│   │   │   ├── sentiment.ts                  # Claude API sentiment analysis
│   │   │   ├── sentiment-analyzer.ts         # 4-mode local analysis engine
│   │   │   ├── trading-agent.ts              # Agent framework (Rule/ML/Hybrid)
│   │   │   ├── backtesting-engine.ts         # Historical simulation engine
│   │   │   └── marl-competition-engine.ts    # Multi-agent competition engine (Phase 2)
│   │   └── routes/
│   │       └── marl-competition.ts           # MARL competition API routes (Phase 2)
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

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for Azure App Service setup. Note: Azure Table Storage and GitHub Actions CI/CD are documented as future targets but not yet configured.

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
