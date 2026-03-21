# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend
```bash
cd backend
npm run dev          # Dev server with watch (nodemon + tsx)
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
npm test             # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
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
├── evolutionary/
│   ├── evolutionary-orchestrator.ts  # Multi-generation tournament loop wiring MARL + genetics
│   ├── fitness-calculator.ts         # 0–100 composite fitness score
│   ├── selection-algorithm.ts        # Survival partitioning (survivalPercent)
│   ├── genetic-crossover.ts          # UNIFORM / BLENDED genome crossover
│   ├── mutation-engine.ts            # LIGHT / MEDIUM / HEAVY stochastic mutation
│   ├── agent-genome.ts               # SQLite-backed genome CRUD
│   ├── agent-cosmetics-manager.ts    # Name / emoji / color / bio management
│   └── agent-statistics-manager.ts  # Win-rate, PnL, history tracking
├── exchange/
│   ├── exchange-interface.ts         # Shared Order/Balance/PlaceOrderParams types
│   ├── exchange-factory.ts           # Factory routing PAPER→PaperExchange, SANDBOX/LIVE→provider
│   ├── paper-exchange.ts             # In-memory paper trading (no real orders)
│   ├── crypto-com-client.ts          # Crypto.com REST v2 HTTP client (HMAC-SHA256 auth)
│   ├── crypto-com-exchange.ts        # ExchangeInterface adapter for Crypto.com
│   ├── binance-us-exchange.ts        # ExchangeInterface adapter for Binance.US
│   ├── coinbase-client.ts            # Coinbase Advanced Trade API v3 HTTP client (CB-ACCESS-KEY scheme)
│   ├── coinbase-exchange.ts          # ExchangeInterface adapter for Coinbase Advanced Trade
│   ├── trading-service.ts            # Safety guards: kill switch, max positions, position size, $1 min
│   ├── risk-manager.ts               # Kill switch + daily-loss + order-size guard (MARL layer)
│   ├── exchange-registry.ts          # Process-lifetime adapter singleton
│   └── adapters/                     # coinbase-adapter.ts, binance-adapter.ts
├── synthetic-market-generator.ts # 5-regime OHLCV-style price series for agent pre-training
├── pre-trainer.ts                # Runs MarlTradingAgent through synthetic episodes, persists state
├── brokers/                     # Alpaca adapter + broker registry + factory
└── backtesting-engine.ts
```

### Route Routers
| Router | File | Mount |
|--------|------|-------|
| MARL competition | `routes/marl-competition.ts` | `/api/marl/*` |
| MARL real trading | `routes/marl-real-trading.ts` | `/api/marl/broker/*` |
| Social media | `routes/social-media.ts` | `/api/social-media/*` |
| Agent stats | `routes/agent-stats.ts` (factory) | `/api/agents/*` |
| Evolutionary | `routes/evolutionary.ts` (factory) | `/api/evolutionary/*` + `/api/evolutionary/breed` + `/api/evolutionary/summary` + `/api/agents/:id/genome` + `/api/agents/:id/genealogy` + `/api/marl/evolution/history` + `/api/marl/evolution/best-genome` + `/api/marl/evolution/population` |
| Trading | `routes/trading.ts` | `/api/trading/*` |
| Core endpoints | `index.ts` directly | `/coins`, `/sentiment/:symbol`, `/health`, `/trending`, etc. |

**Important:** `/api/agents/stats/leaderboard` route must be registered before `/api/agents/:id` to avoid the wildcard swallowing it.

### MARL System
- 3 agents with risk profiles: AGGRESSIVE, CONSERVATIVE, SCALPING
- Competition modes: SINGLE (one-shot), EVOLUTIONARY (genetic mutation), CONTINUOUS (live learning)
- Agent learning states (Q-tables/policy weights) persisted in SQLite `agent_learning_states` table
- Evolutionary tables: `agent_registry`, `agent_statistics`, `agent_competitions`, `evolutionary_tournaments`

### Exchange / Trading
- Default provider: Crypto.com REST v2 (set `TRADING_PROVIDER=binance-us` or `TRADING_PROVIDER=coinbase` to switch)
- PAPER mode always uses `PaperExchange` (in-memory, no real orders) regardless of provider
- `TradingService` wraps any `ExchangeInterface` with 4 safety guards: kill switch (max loss %), max open positions, position size cap, $1 minimum notional
- SELL orders bypass the kill switch; only BUY orders are blocked when the loss threshold is hit

### Frontend
- `App.tsx` (40KB) — main dashboard, coin list, sentiment filters, coin detail modal
- `components/AgentManagementDashboard.tsx` — agent registry, leaderboard, breeding controls, genealogy tree, tournament detail drill-down, generation trends, cross-tournament comparisons, genome snapshot
- `components/MarlCompetitionViewer.tsx` (37KB) — tournament UI, equity curves, H2H, agent cosmetics
- `components/SocialDashboard.tsx` — trending topics, volume trends
- App dashboard polls every 10 minutes via `useEffect`; agent-management refreshes every 5 seconds via `refreshNonce`
- UI styling is mostly inline styles inside focused components; extend the existing pattern rather than introducing a new design system for isolated changes
- ChartJS via `react-chartjs-2` for price/equity charts

### Agent Pre-Training
- `PreTrainer` (`services/pre-trainer.ts`) + `SyntheticMarketGenerator` (`services/synthetic-market-generator.ts`) provide offline training before live competitions
- `POST /api/marl/agents/:agentId/pretrain` body: `{ episodes, stepsPerEpisode, riskProfile, regimes }`; returns convergence curve
- Pre-training is additive: calling it multiple times continues from the prior persisted state
- The synthetic generator supports 5 regimes: BULL_TREND, BEAR_TREND, SIDEWAYS, VOLATILE_CRASH, VOLATILE_PUMP
- Pre-trained state is stored via the same `agent_learning_states` SQLite table used by live competitions

### Evolution Docs
- `docs/EVOLUTIONARY_SYSTEM_OVERVIEW.md` — maintainer overview of lifecycle, routes, tables, UI data flow, and remaining gaps
- `docs/MARL/` — detailed MARL architecture, game theory analysis, and integration guide

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

Current high-value frontend coverage includes:
- `AgentManagementDashboard.test.tsx` for registry, customization, breeding, retirement, and evolutionary UI rendering

## Environment Variables

### Required
- `CLAUDE_API_KEY` — Anthropic API key
- `NEWSAPI_API_KEY` — NewsAPI key
- `API_SECRET_KEY` — Auth for `POST /api/refresh-sentiment`

### Key Optional
- `BROKER_MASTER_KEY` — AES-256-GCM key; required for SANDBOX/LIVE broker modes
- `TRADING_PROVIDER` — `crypto-com` (default), `binance-us`, or `coinbase`; selects exchange for SANDBOX/LIVE mode
- `COINBASE_API_KEY` / `COINBASE_API_SECRET` — Coinbase Advanced Trade credentials (required when `TRADING_PROVIDER=coinbase`)
- `COINBASE_TRADING_PAIR` — default Coinbase product ID, e.g. `BTC-USD` (default)
- `FINBERT_API_URL` / `HUGGINGFACE_API_TOKEN` — remote FinBERT scoring
- `TWITTER_BEARER_TOKEN`, `REDDIT_CLIENT_ID/SECRET`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `YOUTUBE_API_KEY` — social scrapers
- `APPLICATIONINSIGHTS_CONNECTION_STRING` — Azure telemetry

## CI Pipeline
GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
1. **Docs** — `node scripts/validate-docs.mjs`
2. **Backend** — lint → type-check → test → build
3. **Frontend** — lint → type-check → build

Always run `npm run type-check` in `backend/` before committing backend changes.
