# Installation & Setup Guide

This guide walks through installing, configuring, and running the **Sentiment Analyzer** platform — the Express/TypeScript backend, the React/Vite frontend, the optional BullMQ worker processes, and the GA MCP servers.

For a feature overview see [README.md](./README.md); for a deeper environment-variable reference see [docs/ENV_SETUP_GUIDE.md](./docs/ENV_SETUP_GUIDE.md); for production/Azure deployment see [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md).

---

## 1. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | `>= 18` (20 recommended) | Backend and frontend both target Node 18+. |
| npm | `>= 9` | Ships with Node 18+. |
| Git | any recent | To clone the repository. |
| Redis | optional | Only needed to enable the BullMQ tournament/scraper worker processes. Everything degrades gracefully to in-process execution when `REDIS_URL` is unset. |

No external database server is required — persistence uses a local SQLite file via `better-sqlite3`.

### API keys

The platform runs without any keys (it falls back to local NLP scoring and in-memory/paper modes), but the following unlock full functionality. All are optional except where your use case requires them:

- **`CLAUDE_API_KEY`** — Claude-powered sentiment summaries and GA generation directives (falls back to local scoring).
- **`NEWSAPI_API_KEY`** — news headline aggregation.
- **`API_SECRET_KEY`** — gates the `x-api-key` admin endpoints (e.g. `POST /api/refresh-sentiment`).
- Social scrapers, exchanges, and telemetry each have their own optional keys — see the templates referenced below.

---

## 2. Clone the repository

```bash
git clone https://github.com/infinyte/sentiment-analyzer.git
cd sentiment-analyzer
```

The repository is a two-package layout: `backend/` (API + services) and `frontend/` (React dashboard), with shared docs under `docs/`.

---

## 3. Configure environment variables

Both packages ship annotated templates. Copy each to a local `.env` and fill in the values you need.

```bash
# Backend
cd backend
cp backend.env.template .env
# edit .env — at minimum review CLAUDE_API_KEY, NEWSAPI_API_KEY, API_SECRET_KEY

# Frontend (separate file)
cd ../frontend
cp frontend.env.template .env
cd ..
```

> **Never commit `.env`.** It is git-ignored. Only the `*.env.template` files are tracked.

### Runtime vs. bootstrap configuration

The backend supports **DB-backed runtime configuration** through the `app_config` table and the password-gated `/api/admin/config/*` endpoints (and the Admin tab in the UI). Lookups resolve in this order: **DB value → `.env` fallback → code default**.

In practice:

- Put **bootstrap/security** values in `.env`: `CONFIG_ADMIN_PASSWORD`, `BROKER_MASTER_KEY`, `PORT`, `DATABASE_PATH`, `REDIS_URL`.
- Most **application** values (API keys, cron schedules, social integrations, exchange/trading settings) can be edited at runtime from the Admin UI and persisted in SQLite, with `.env` acting as a fallback.

### Key trading & shadow-mode variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRADING_MODE` | `paper` | `paper`, `realistic_paper`, `sandbox`, or `live`. |
| `SHADOW_MODE` | unset | `true` upgrades the default `paper` mode to `realistic_paper` for the shadow harness. |
| `REALISTIC_PAPER_FEE_PRESET` | `binance-us` | Fee preset for the realistic paper exchange. |
| `TRADING_PROVIDER` | `crypto-com` | Exchange used for SANDBOX/LIVE: `crypto-com`, `binance-us`, `coinbase`, `alpaca`. |
| `BROKER_MASTER_KEY` | — | AES-256-GCM key required to store/connect broker credentials. |
| `CONFIG_ADMIN_PASSWORD` | — | Required to use the Admin config endpoints/UI. |

A complete annotated list lives in `backend/backend.env.template`.

---

## 4. Install dependencies

```bash
# from the repository root
cd backend && npm install
cd ../frontend && npm install
cd ..
```

---

## 5. Quick start (development)

Run the backend and frontend in two terminals.

```bash
# Terminal 1 — backend on http://localhost:3000
cd backend
npm run dev          # nodemon + tsx, watch mode

# Terminal 2 — frontend on http://localhost:5173
cd frontend
npm run dev          # Vite dev server
```

Then open **http://localhost:5173**. The Vite dev server proxies `/api/*` to the backend automatically, so no CORS configuration is needed in development.

### VS Code one-shot

If you use VS Code, run **Terminal: Run Task → `dev: restart in vscode`**. It stops any existing repo-local dev processes, starts the backend and frontend in separate integrated terminals, and opens the app once the frontend is ready. The PowerShell helpers `start.ps1`, `restart-dev.ps1`, and `stop-dev.ps1` provide the same lifecycle from a terminal on Windows.

---

## 6. Optional: background workers (Redis/BullMQ)

When `REDIS_URL` is set, tournament and social-scrape jobs can run in dedicated worker processes instead of in-process. Start them after the backend:

```bash
cd backend
npm run dev:tournament-worker   # consumes the tournament queue
npm run dev:scraper-worker      # consumes the scraper queue
```

Production equivalents (after `npm run build`): `npm run worker:tournament` and `npm run worker:scraper`. Concurrency is tunable via `TOURNAMENT_WORKER_CONCURRENCY` and `SCRAPER_WORKER_CONCURRENCY`.

If `REDIS_URL` is unset, these jobs fall back to Worker Threads / in-process execution and the workers are unnecessary.

---

## 7. Optional: GA MCP servers

Two stdio MCP servers expose the evolutionary GA operations to Claude Code and other MCP clients:

```bash
cd backend
npm run dev:mcp:genetic-ops     # mutate_agent, crossover_agents, evaluate_fitness, select_population, get_generation_summary
npm run dev:mcp:agent-manager   # register_agent, get_agent_health, assign_task, collect_results, get_pool_status
```

They connect to the same SQLite file as the backend (`DB_PATH`, default `./sentiment_analyzer.db`). See [docs/GA_MCP_USAGE_EXAMPLES.md](./docs/GA_MCP_USAGE_EXAMPLES.md) for registration JSON and a worked example, and [CLAUDE.md](./CLAUDE.md) for the full tool schemas.

---

## 8. Build & run (production)

```bash
# Backend
cd backend
npm run build        # compile TypeScript -> dist/
npm start            # node dist/index.js

# Frontend
cd ../frontend
npm run build        # outputs static assets to dist/
npm run preview      # optional: preview the production build locally
```

Serve the frontend `dist/` from any static host and point it at the backend's `/api`. For an Azure App Service walkthrough, see [docs/DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md).

### Docker

A `docker-compose.yml` is provided that brings up the backend, Redis, and the tournament and scraper worker processes together:

```bash
docker compose up --build
```

---

## 9. Verify the installation

```bash
# Backend: type-check, tests, build
cd backend
npm run type-check
npm test
npm run build

# Frontend: type-check, tests, build
cd ../frontend
npm run type-check
npm test
npm run build

# Repo docs consistency (also enforced in CI)
cd ..
node scripts/validate-docs.mjs
```

A quick smoke test once the backend is running:

```bash
curl -s http://localhost:3000/api/health | jq .
```

A healthy response reports per-service status for CoinGecko, NewsAPI, the Claude API, and SQLite. Endpoints whose keys are missing are reported as `misconfigured` rather than failing the whole server.

### Explore the API

Import the Postman collection in [`postman/`](./postman/) — it contains an example request **and** a saved example response for every endpoint — and set the `base_url` variable to `http://localhost:3000`. See [postman/README.md](./postman/README.md) for details.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `/api/health` reports `misconfigured` | One or more API keys are absent. Add them to `backend/.env` or via the Admin config UI; the server still runs with local fallbacks. |
| DB-dependent routes return `404` | SQLite failed to open. Check `DATABASE_PATH` is writable; `storage.isHealthy()` gates these routes. |
| Broker credential operations return `503` | `BROKER_MASTER_KEY` is missing — it is required to encrypt/decrypt stored broker credentials. |
| Admin config endpoints reject requests | Set `CONFIG_ADMIN_PASSWORD` and supply it from the Admin UI. |
| Workers do nothing / jobs run in-process | `REDIS_URL` is unset — this is expected; queues degrade gracefully. Set `REDIS_URL` to enable the worker processes. |
| Frontend can't reach the API | In dev, use the Vite proxy (open `:5173`, not `:3000`). In prod, point the frontend at the backend's `/api` base URL. |

---

For architecture and contributor guidance, see [CLAUDE.md](./CLAUDE.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
