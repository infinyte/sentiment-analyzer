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

## Required Environment Variables

Set these in `backend/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | Yes | From [console.anthropic.com](https://console.anthropic.com) |
| `NEWSAPI_API_KEY` | Yes | From [newsapi.org](https://newsapi.org) |
| `API_SECRET_KEY` | Yes | Any string — used to authenticate `POST /api/refresh-sentiment` |
| `COINGECKO_API_KEY` | No | Free tier works without it |

Optional tuning variables: `CLAUDE_MODEL`, `SENTIMENT_BATCH_SIZE`, `SENTIMENT_JOB_CRON`, `PORT`, `ALLOWED_ORIGINS`.

## Architecture

Single-file backend (`backend/src/index.ts`) with three service classes and an in-memory cache. Single-file frontend (`frontend/src/App.tsx`) with all components and hooks.

```
React Dashboard (polling every 10 min)
    ↓ /api/*
Express Backend (port 3000)
    ├── CoinGeckoService  → market data, OHLCV history
    ├── NewsAPIService    → headlines per coin
    ├── SentimentService  → Claude API (BULL/NEUTRAL/BEAR)
    └── Cache             → 5-min coins TTL, 24-hr sentiment TTL
```

**Scheduled job:** Daily at 2 AM UTC (`SENTIMENT_JOB_CRON`), the backend re-analyzes the top `SENTIMENT_BATCH_SIZE` coins (default 50) and refreshes the sentiment cache.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/coins` | Top coins with sentiment. Params: `limit`, `sort_by` |
| GET | `/api/coins/:symbol` | Detail view — price history, headlines, sentiment |
| GET | `/api/sentiment/:symbol` | Cached sentiment only (404 if not yet analyzed) |
| POST | `/api/refresh-sentiment` | Force re-analysis. Requires `x-api-key` header |
| GET | `/api/health` | Service status — reports `misconfigured` if API keys are missing |

## Tech Stack

**Backend:** Node.js 18+, Express, TypeScript (strict), node-cron, Helmet, CORS

**Frontend:** React 18, TypeScript, Vite, Chart.js / react-chartjs-2

**External APIs:** CoinGecko (free), NewsAPI (free tier, 500 req/day), Claude API (pay-per-call, ~$6–15/month for daily batch)

## Project Structure

```
sentiment-analyzer/
├── backend/
│   ├── src/index.ts        # All server logic — services, routes, cache, cron job
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/App.tsx         # All UI — components, hooks, chart
│   ├── vite.config.ts      # Proxies /api to localhost:3000
│   └── package.json
├── postman/                # API test collection
├── DEPLOYMENT_GUIDE.md     # Azure Free Tier deployment steps
└── CLAUDE.md               # Claude Code guidance
```

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for Azure App Service setup. Note: Azure Table Storage and GitHub Actions CI/CD are documented as future targets but not yet configured.

## Cost

Running the sentiment batch daily against 50 coins costs approximately **$6–15/month** in Claude API fees. All other services (CoinGecko, NewsAPI free tier, Azure App Service B1) are free.
