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

# Worker processes (require REDIS_URL to be set)
npm run dev:tournament-worker  # Tournament BullMQ worker (dev, watch mode)
npm run dev:scraper-worker     # Scraper BullMQ worker (dev, watch mode)
npm run worker:tournament      # Tournament BullMQ worker (production)
npm run worker:scraper         # Scraper BullMQ worker (production)

# MCP servers (stdio transport — connect via Claude Code or any MCP client)
npm run dev:mcp:genetic-ops    # GA operations MCP server (dev, tsx)
npm run dev:mcp:agent-manager  # Agent pool management MCP server (dev, tsx)
npm run mcp:genetic-ops        # GA operations MCP server (production, requires build)
npm run mcp:agent-manager      # Agent pool management MCP server (production, requires build)
# Set DB_PATH env var to override the default ./sentiment_analyzer.db path
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
│   ├── exchange-factory.ts           # Factory routing PAPER→PaperExchange, REALISTIC_PAPER→RealisticPaperExchange, SANDBOX/LIVE→provider; getTradingConfig()/getShadowTradingConfig()
│   ├── paper-exchange.ts             # In-memory paper trading, zero fees/slippage (no real orders)
│   ├── realistic-paper-exchange.ts   # Paper trading WITH fee presets + side-specific slippage; commission on every Order (REALISTIC_PAPER mode)
│   ├── crypto-com-client.ts          # Crypto.com REST v2 HTTP client (HMAC-SHA256 auth)
│   ├── crypto-com-exchange.ts        # ExchangeInterface adapter for Crypto.com
│   ├── binance-us-exchange.ts        # ExchangeInterface adapter for Binance.US
│   ├── coinbase-client.ts            # Coinbase Advanced Trade API v3 HTTP client (CB-ACCESS-KEY scheme)
│   ├── coinbase-exchange.ts          # ExchangeInterface adapter for Coinbase Advanced Trade
│   ├── trading-service.ts            # Safety guards: kill switch, max positions, position size, $1 min
│   ├── risk-manager.ts               # Kill switch + daily-loss + order-size guard (MARL layer)
│   ├── exchange-registry.ts          # Process-lifetime adapter singleton
│   └── adapters/                     # coinbase-adapter.ts, binance-adapter.ts
├── analytics/
│   └── expectancy.ts            # Stateless net-of-fees expectancy: FIFO round-trip reconstruction from Order[], consumes order.commission
├── synthetic-market-generator.ts # 5-regime OHLCV-style price series for agent pre-training
├── pre-trainer.ts                # Runs MarlTradingAgent through synthetic episodes, persists state
├── brokers/                     # Alpaca adapter + broker registry + factory
└── backtesting-engine.ts
```

### MCP Servers
Two standalone stdio MCP servers expose the evolutionary GA services to Claude Code and other MCP clients.

```
backend/src/mcp/
├── mcp-genetic-ops.ts     # GA operations: mutate_agent, crossover_agents, evaluate_fitness,
│                          #   select_population, get_generation_summary
└── mcp-agent-manager.ts   # Agent pool: register_agent, get_agent_health, assign_task,
                           #   collect_results, get_pool_status
```

**Registering with Claude Code** — add to `.claude/settings.json` (or `settings.local.json`):
```json
{
  "mcpServers": {
    "genetic-ops": {
      "command": "npm",
      "args": ["run", "--prefix", "backend", "dev:mcp:genetic-ops"],
      "env": { "DB_PATH": "./backend/sentiment_analyzer.db" }
    },
    "agent-manager": {
      "command": "npm",
      "args": ["run", "--prefix", "backend", "dev:mcp:agent-manager"],
      "env": { "DB_PATH": "./backend/sentiment_analyzer.db" }
    }
  }
}
```

Both servers connect to the same SQLite file used by the main backend (`DB_PATH` env var, default `./sentiment_analyzer.db`).

**`genetic-ops` tool schemas:**

| Tool | Required params | Optional params | Returns |
|------|----------------|-----------------|---------|
| `mutate_agent` | `agentId: string` | `severity: 'LIGHT'\|'MEDIUM'\|'HEAVY'` (default `MEDIUM`) | Changed parameters + scalar severity |
| `crossover_agents` | `parent1Id: string`, `parent2Id: string` | `strategy: 'UNIFORM'\|'BLENDED'` (default `UNIFORM`) | `offspringId`, `generationNumber`, `inheritanceMap`, genome |
| `evaluate_fitness` | `agentId: string` | `includePopulation: boolean` (default `false`) | fitness (0–100), rank, populationSize, component breakdown |
| `select_population` | `agentIds: string[]` | `survivalPercent: number` 1–99 (default `30`) | `survivors[]`, `retirementCandidates[]`, `middleTier[]` with fitness |
| `get_generation_summary` | `tournamentId: string` | `generation: number` (defaults to latest) | population IDs, per-agent fitness, `GenerationDirective` |

**`agent-manager` tool schemas:**

| Tool | Required params | Optional params | Returns |
|------|----------------|-----------------|---------|
| `register_agent` | — | `agentType`, `riskProfile`, `genomeOverrides`, `parentId1/2`, `generationNumber` | `agentId`, status, genome |
| `get_agent_health` | `agentId: string` | — | lifetime stats, genome, fitness score |
| `assign_task` | `agentIds: string[]`, `symbols: string[]` | `duration: number` (default `200`) | `taskId`, competition spec |
| `collect_results` | `agentId: string` | `limit: number` 1–100 (default `10`) | recent competition results, newest first |
| `get_pool_status` | — | `includeRetired: boolean`, `filterType: 'ML_BASED'\|'RULE_BASED'\|'ADVERSARY'\|'all'` | ranked agent list with fitness, generation, riskProfile |

For complete usage examples and a worked one-generation cycle see `docs/GA_MCP_USAGE_EXAMPLES.md`.

### Queue & Worker Infrastructure
```
backend/src/queues/
├── connection.ts          # Parses REDIS_URL → IORedis ConnectionOptions; exports isQueueAvailable()
├── tournament.queue.ts    # BullMQ Queue<TournamentJobData> singleton via getTournamentQueue()
└── scraper.queue.ts       # BullMQ Queue<ScraperJobData> singleton via getScraperQueue()

backend/src/workers/
├── tournament-worker-process.ts   # Stand-alone process: consumes tournament queue → runs MarlCompetitionEngine
└── scraper-worker-process.ts      # Stand-alone process: consumes scraper queue → runs SocialMediaScraperManager
```

**Fallback behavior:** when `REDIS_URL` is not set, `isQueueAvailable()` returns `false` and:
- SIMULATED tournament starts fall back to Worker Threads (same behavior as before queues were added)
- The social scraper cron and `POST /api/social-media/refresh` fall back to in-process execution via `setImmediate`
- PAPER/LIVE tournaments always run on the main API thread regardless of Redis availability

### Route Routers
| Router | File | Mount |
|--------|------|-------|
| MARL competition | `routes/marl-competition.ts` | `/api/marl/*` |
| MARL real trading | `routes/marl-real-trading.ts` | `/api/marl/broker/*` |
| Social media | `routes/social-media.ts` | `/api/social-media/*` |
| Agent stats | `routes/agent-stats.ts` (factory) | `/api/agents/*` |
| Evolutionary | `routes/evolutionary.ts` (factory) | `/api/evolutionary/*` + `/api/evolutionary/breed` + `/api/evolutionary/summary` + `/api/agents/:id/genome` + `/api/agents/:id/genealogy` + `/api/marl/evolution/history` + `/api/marl/evolution/best-genome` + `/api/marl/evolution/population` |
| Trading | `routes/trading.ts` | `/api/trading/*` |
| Paper analytics | `routes/paper-analytics.ts` (factory) | `/api/paper/stats` + `/api/paper/trades` + `/api/paper/export` |
| Core endpoints | `index.ts` directly | `/coins`, `/sentiment/:symbol`, `/health`, `/trending`, etc. |

**Important:** `/api/agents/stats/leaderboard` route must be registered before `/api/agents/:id` to avoid the wildcard swallowing it.

### MARL System
- 3 agents with risk profiles: AGGRESSIVE, CONSERVATIVE, SCALPING
- Competition modes: SINGLE (one-shot), EVOLUTIONARY (genetic mutation), CONTINUOUS (live learning)
- Agent learning states (Q-tables/policy weights) persisted in SQLite `agent_learning_states` table
- Evolutionary tables: `agent_registry`, `agent_statistics`, `agent_competitions`, `evolutionary_tournaments`

### Exchange / Trading
- Default provider: Crypto.com REST v2 (set `TRADING_PROVIDER=binance-us`, `TRADING_PROVIDER=coinbase`, or `TRADING_PROVIDER=alpaca` to switch)
- PAPER mode always uses `PaperExchange` (in-memory, **zero fees/slippage**, no real orders) regardless of provider
- REALISTIC_PAPER mode uses `RealisticPaperExchange` — same in-memory simulation but with provider fee presets (maker/taker) + side-specific slippage, charging a `commission` on every `Order`. Fee preset via `REALISTIC_PAPER_FEE_PRESET` (default `binance-us`, 0% maker / 0.02% taker entry tier)
- **Shadow harness:** set `SHADOW_MODE=true` to upgrade the default PAPER mode to REALISTIC_PAPER (or call `getShadowTradingConfig()`). Plain PAPER users (no `SHADOW_MODE`) are unaffected; explicit SANDBOX/LIVE selections are never downgraded
- `TradingService` wraps any `ExchangeInterface` with 4 safety guards: kill switch (max loss %), max open positions, position size cap, $1 minimum notional
- SELL orders bypass the kill switch; only BUY orders are blocked when the loss threshold is hit

### Paper Analytics (net-of-fees expectancy)
- `services/analytics/expectancy.ts` is a **stateless** service: it reconstructs round-trip trades by FIFO-matching SELL fills against prior BUY fills per symbol (pro-rating each fill's `commission`), then computes net-of-fees metrics. No DB schema, no new dependencies
- Read-only routes (share the trading router's exchange instance, so orders placed via `/api/trading/order` are reflected):
  - `GET /api/paper/stats` → `ExpectancyReport` (win rate, expectancy, profit factor, Sharpe/Sortino, max drawdown, fee drag, unrealized P&L)
  - `GET /api/paper/trades?limit=N` → most recent N reconstructed `ClosedTrade`s
  - `GET /api/paper/export` → writes report + closed trades to a timestamped JSON file under `<cwd>/data` (no schema)
- Most meaningful in REALISTIC_PAPER/shadow mode where commissions are non-zero; in plain PAPER mode net == gross

### Frontend
- `App.tsx` (40KB) — app shell plus Dashboard, Sentiment Lab, sentiment refresh, system-health pill, and Backtesting tab
- `components/AgentManagementDashboard.tsx` — agent registry, leaderboard, breeding controls, genealogy tree, tournament detail drill-down, generation trends, cross-tournament comparisons, genome snapshot
- `components/AgentAvatar.tsx` — reusable, deterministic original-creature SVG avatar (Pokémon *aesthetic*, no copyrighted art). Seed-stable per agent id; honours the agent's accent `color` cosmetic. Decorative by default (`aria-hidden`); pass `label` for a standalone image. Currently wired into AgentManagementDashboard (registry/leaderboard/breeding/detail) — prototype ahead of app-wide rollout
- `components/MarlCompetitionViewer.tsx` (37KB) — tournament UI, equity curves, H2H, info panel, and manual equity reload
- `components/SocialDashboard.tsx` — trending topics, scraper health, manual social refresh, and scored-item detail drill-in
- App dashboard polls every 10 minutes via `useEffect`; system health polls every 30 seconds; agent-management refreshes every 5 seconds via `refreshNonce`
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
- `App.test.tsx` for ticker search, health fallback, and Backtesting workflow coverage
- `MarlCompetitionViewer.test.tsx` for info drawer and equity reload coverage in addition to tournament flows
- `SocialDashboard.test.tsx` for manual refresh and item-detail drill-in with filter preservation

## Environment Variables

### Required
- `CLAUDE_API_KEY` — Anthropic API key
- `NEWSAPI_API_KEY` — NewsAPI key
- `API_SECRET_KEY` — Auth for `POST /api/refresh-sentiment`

### Key Optional
- `BROKER_MASTER_KEY` — AES-256-GCM key for encrypted broker credential storage (`/api/marl/broker/*`)
- `TRADING_PROVIDER` — `crypto-com` (default), `binance-us`, `coinbase`, or `alpaca`; selects exchange for SANDBOX/LIVE mode
- `TRADING_MODE` — `paper` (default), `realistic_paper`, `sandbox`, or `live`
- `SHADOW_MODE` — `true` upgrades the default `paper` mode to `realistic_paper` (fee/slippage model) for the shadow harness; ignored for explicit SANDBOX/LIVE
- `REALISTIC_PAPER_FEE_PRESET` — fee preset for REALISTIC_PAPER: `binance-us` (default), `crypto-com`, `coinbase`, or `alpaca`
- `REALISTIC_PAPER_SLIPPAGE_BUY_PCT` / `REALISTIC_PAPER_SLIPPAGE_SELL_PCT` — per-side slippage fractions (default `0.001` = 0.1% each way)
- `ALPACA_API_KEY` / `ALPACA_API_SECRET` — Alpaca credentials (required when `TRADING_PROVIDER=alpaca` and mode is SANDBOX/LIVE)
- `COINBASE_API_KEY` / `COINBASE_API_SECRET` — Coinbase Advanced Trade credentials (required when `TRADING_PROVIDER=coinbase`)
- `COINBASE_TRADING_PAIR` — default Coinbase product ID, e.g. `BTC-USD` (default)
- `FINBERT_API_URL` / `HUGGINGFACE_API_TOKEN` — remote FinBERT scoring
- `TWITTER_BEARER_TOKEN`, `REDDIT_CLIENT_ID/SECRET`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `YOUTUBE_API_KEY` — social scrapers
- `APPLICATIONINSIGHTS_CONNECTION_STRING` — Azure telemetry
- `REDIS_URL` — Redis connection URL (e.g. `redis://localhost:6379`); enables BullMQ-backed tournament and scraper worker processes; all queue paths degrade gracefully when absent
- `TOURNAMENT_WORKER_CONCURRENCY` — concurrent tournament jobs in the worker process (default: `2`)
- `SCRAPER_WORKER_CONCURRENCY` — concurrent scraper jobs in the worker process (default: `1`)

## CI Pipeline
GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:
1. **Docs** — `node scripts/validate-docs.mjs`
2. **Backend** — lint → type-check → test → build
3. **Frontend** — lint → type-check → build

Always run `npm run type-check` in `backend/` before committing backend changes.

