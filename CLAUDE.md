# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
cd backend
npm run dev          # Dev server with watch (tsx)
npm run build        # Compile TypeScript → dist/
npm run type-check   # tsc --noEmit (run before committing)
npm run lint         # ESLint
npm test             # All Jest tests
npm test -- --testPathPattern=cache   # Single test file by pattern
npm test -- --testNamePattern="should" # Single test by name
```

### Frontend
```bash
cd frontend
npm run dev          # Vite dev server on :5173
npm run build        # Vite production build
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
npm test             # Vitest (watch mode)
npm run test:run     # Vitest single run (CI)
```

### Root
```bash
node scripts/validate-docs.mjs   # Validate doc consistency (required by CI)
```

## Architecture

### Request Flow
1. Vite dev proxy `/api/*` → `http://localhost:3000`
2. `backend/src/index.ts` — Express bootstrap, service init, route registration
3. Routes registered with `app.use(router)` — no prefix at registration, full path lives in the router
4. DB-dependent routes use the pattern: `if (storage.isHealthy()) { app.use(createXRouter(storage.getDb())); }`

### Database
- Single SQLite file (`sentiment_analyzer.db`) managed by `StorageService` singleton in `backend/src/storage.ts`
- `socialStore` (`database/sqlite-social-store.ts`) opens its own connection to the same file
- WAL mode + foreign keys ON; all queries are synchronous (better-sqlite3)
- `storage.isHealthy()` must be checked before any DB operation in routes/services
- Broker credentials stored AES-256-GCM encrypted; requires `BROKER_MASTER_KEY` env var

### Services Layout
```
backend/src/services/
├── marl-competition-engine.ts   # 90KB core tournament engine (MARL)
├── sentiment-analyzer.ts        # 32KB local NLP (4 modes: BASIC/ADVANCED/TRADING_SIGNALS/SMART)
├── content-signals.ts           # NewsAPI + Reddit + X signal pipeline
├── sentiment.ts                 # Claude API wrapper with local fallback
├── social-media/
│   ├── scraper/                 # 7 platform scrapers + manager
│   ├── scoring/                 # FinBERT, sarcasm, coin extraction, text normalization
│   └── trending/                # Discovery engine + multi-source calculator
├── evolutionary/                # Genetic algorithm: genome, crossover, mutation, cosmetics, stats
├── exchange/                    # Broker adapters (Alpaca, Binance, Coinbase) + risk manager
└── backtesting-engine.ts
```

### Route Routers
| Router | File | Mount |
|--------|------|-------|
| MARL competition | `routes/marl-competition.ts` | `/api/marl/*` |
| MARL real trading | `routes/marl-real-trading.ts` | `/api/marl/broker/*` |
| Social media | `routes/social-media.ts` | `/api/social/*` |
| Agent stats | `routes/agent-stats.ts` (factory) | `/api/agents/*` |
| Core endpoints | `index.ts` directly | `/coins`, `/sentiment/:symbol`, `/health`, `/trending`, etc. |

**Important:** `/api/agents/stats/leaderboard` route must be registered before `/api/agents/:id` to avoid the wildcard swallowing it.

### MARL System
- 3 agents with risk profiles: AGGRESSIVE, CONSERVATIVE, SCALPING
- Competition modes: SINGLE (one-shot), EVOLUTIONARY (genetic mutation), CONTINUOUS (live learning)
- Agent learning states (Q-tables/policy weights) persisted in SQLite `agent_learning_states` table
- Phase 1 evolutionary tables: `agent_registry`, `agent_statistics`, `agent_competitions`

### Frontend
- `App.tsx` (40KB) — main dashboard, coin list, sentiment filters, coin detail modal
- `components/MarlCompetitionViewer.tsx` (37KB) — tournament UI, equity curves, H2H, agent cosmetics
- `components/SocialDashboard.tsx` — trending topics, volume trends
- Polls every 10 minutes via `useEffect` + axios
- ChartJS via `react-chartjs-2` for price/equity charts

## Test Patterns

### Backend (Jest + ts-jest)
Tests live in `backend/src/__tests__/`. Two tsconfig files:
- `tsconfig.json` — production (ES modules, bundler resolution)
- `tsconfig.jest.json` — test (CommonJS override)

**Storage mock — always include both `isHealthy` and `getDb`:**
```typescript
jest.mock('../../storage.js', () => ({
  storage: {
    connect: jest.fn(),
    close: jest.fn(),
    isHealthy: jest.fn().mockReturnValue(true),
    getDb: jest.fn().mockReturnValue({}),
    pruneExpiredSentiment: jest.fn().mockReturnValue(0),
    // ...other methods as needed
  },
}));
```

Import paths in backend use `.js` extension even for `.ts` source files (TypeScript bundler resolution).

### Frontend (Vitest + @testing-library/react)
Tests live in `frontend/src/__tests__/`. Environment: jsdom. Setup file: `__tests__/setup.ts`.

## Environment Variables

### Required
- `CLAUDE_API_KEY` — Anthropic API key
- `NEWSAPI_API_KEY` — NewsAPI key
- `API_SECRET_KEY` — Auth for `POST /api/refresh-sentiment`

### Key Optional
- `BROKER_MASTER_KEY` — AES-256-GCM key; required for PAPER/LIVE broker modes
- `FINBERT_API_URL` / `HUGGINGFACE_API_TOKEN` — remote FinBERT scoring
- `TWITTER_BEARER_TOKEN`, `REDDIT_CLIENT_ID/SECRET`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `YOUTUBE_API_KEY` — social scrapers
- `APPLICATIONINSIGHTS_CONNECTION_STRING` — Azure telemetry

## CI Pipeline
GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
1. **Docs** — `node scripts/validate-docs.mjs`
2. **Backend** — lint → type-check → test → build
3. **Frontend** — lint → type-check → build

Always run `npm run type-check` in `backend/` before committing backend changes.
