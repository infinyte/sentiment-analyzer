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
  → In-memory Cache (10-min TTL for coins, 24-hr for sentiment)
```

### Backend (`backend/src/index.ts`)
Single file with all logic. Key classes:
- **CoinGeckoService** — fetches top coins + OHLCV history from CoinGecko
- **NewsAPIService** — fetches headlines per coin symbol
- **SentimentService** — calls Claude API (`claude-opus-4-1-20250805`) with structured prompt, parses JSON response; returns NEUTRAL on error
- **Cache** — simple `Map`-based TTL cache

API endpoints:
- `GET /api/coins` — top coins with sentiment
- `GET /api/coins/:symbol` — detailed report
- `GET /api/sentiment/:symbol` — cached sentiment only
- `POST /api/refresh-sentiment` — admin trigger (requires `x-api-key` header matching `API_SECRET_KEY`)
- `GET /api/health`

### Frontend (`frontend/src/App.tsx`)
Single file with all components and logic:
- Polls `/api/coins` every 10 minutes
- `useCoins()` / `useCoinDetail()` custom hooks
- Components: `SentimentBadge`, `PercentChange`, `CoinCard`, `Dashboard`, `DetailModal`
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

**Implemented:** All 5 API endpoints, sentiment analysis pipeline, 24-hr sentiment cache, 5-min coin cache, 15-min price history/headlines cache, daily cron job (`node-cron`), Chart.js price chart in detail modal, ESC/backdrop modal close, volatility calculation from CoinGecko high/low, `trending_score` from headline count.

**Not yet implemented:** Azure Table Storage persistence (app is in-memory only — data lost on restart), GitHub Actions CI/CD (`.github/workflows/` is empty), Application Insights structured logging.
