# API Endpoints Reference

Complete inventory of all 64 HTTP API endpoints across the sentiment-analyzer platform, organized by feature area. Each endpoint includes method, path, authentication requirements, rate limiting, and coverage status (mapped to [TASKS.md](TASKS.md) for UI implementation).

**Generated**: From backend source code across `index.ts`, `routes/marl-competition.ts`, `routes/evolutionary.ts`, `routes/agent-stats.ts`, `routes/social-media.ts`, `routes/marl-real-trading.ts`, and `routes/trading.ts`.

**Total Endpoints**: 64  
**Phase 1 Coverage**: 6 tasks covering 14 endpoints  
**Phase 2 Coverage**: 5 tasks covering 11 endpoints  
**Phase 3 Coverage**: 3 tasks covering 7 endpoints  
**Already Covered**: 39 endpoints with existing UI  
**Gaps Remaining**: 3 endpoints (intentionally internal/utility)

---

## Table of Contents

1. [Coins](#coins) (2 endpoints)
2. [Sentiment Analysis](#sentiment-analysis) (3 endpoints)
3. [Health & Info](#health--info) (3 endpoints)
4. [MARL Competition](#marl-competition) (13 endpoints)
5. [Evolutionary Tournaments](#evolutionary-tournaments) (8 endpoints)
6. [Agent Management](#agent-management) (8 endpoints)
7. [Social Media & Trending](#social-media--trending) (10 endpoints)
8. [Broker & Real Trading](#broker--real-trading) (8 endpoints)
9. [Trading (Paper/Sandbox/Live)](#trading-papersandboxlive) (5 endpoints)
10. [Backtesting](#backtesting) (3 endpoints)
11. [Rankings & Analysis](#rankings--analysis) (1 endpoint)
12. [Authentication & Rate Limiting](#authentication--rate-limiting)
13. [Technical Notes](#technical-notes)

---

## Coins

| Status | Method | Path | Description | Coverage | Rate Limit |
|--------|--------|------|-------------|----------|-----------|
| ✅ Covered | GET | `/api/coins` | Fetch top coins with sentiment scores | Dashboard | None |
| ✅ Covered | GET | `/api/coins/:symbol` | Detailed coin report with history & headlines | Coin Detail Modal | None |

**Notes**: Coins endpoints are fully integrated in the Dashboard tab. No additional UI needed.

---

## Sentiment Analysis

| Status | Method | Path | Description | Task Coverage | Auth | Rate Limit |
|--------|--------|------|-------------|---|------|-----------|
| ✅ Covered | POST | `/api/sentiment/analyze` | Multi-mode sentiment analysis (BASIC/ADVANCED/TRADING_SIGNALS/SMART) | Dashboard Sentiment Lab | None | None |
| ✅ Covered | GET | `/api/sentiment/:symbol` | Get cached sentiment for a coin | Dashboard Sentiment Lab | None | None |
| ✅ Covered | POST | `/api/refresh-sentiment` | Trigger sentiment refresh (admin only) | Dashboard Header Refresh | x-api-key | None |

**Request/Response Examples**:
- **POST /api/sentiment/analyze**: Body `{symbols: [], mode: "ADVANCED", headlines?: true, marketData?: true, technicalData?: true}` → 200: `{mode, results: {symbol: AnalysisResult}}`
- **POST /api/refresh-sentiment**: Requires `x-api-key` header. Returns 202: `{job_id, status: "processing", coins_to_process}`

---

## Health & Info

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | GET | `/api/health` | Service health check (coingecko, newsapi, claude_api, sqlite) | Global Health Indicator | None |
| ✅ Covered | GET | `/api/info/modes` | Documentation: analysis modes, agent types, risk profiles | Dashboard Sentiment Lab | None |
| ✅ Covered | GET | `/api/marl/info` | Full MARL system documentation & parameters | MARL Info Drawer | 120/min |

**Health Response**: 200/503: `{status: "healthy"|"degraded", services: {coingecko, newsapi, claude_api, sqlite}, uptime_seconds}`. The frontend maps fetch failures to a local `down` UI state.

---

## MARL Competition

| Status | Method | Path | Description | Task Coverage | Auth | Rate Limit |
|--------|--------|------|-------------|---|------|-----------|
| ✅ Covered | POST | `/api/marl/competition/start` | Start new tournament (fire-and-forget) | Existing MARL UI | None | 5/min |
| ✅ Covered | GET | `/api/marl/competition/:competitionId/status` | Poll competition status | Existing MARL UI | None | 120/min |
| ✅ Covered | GET | `/api/marl/competition/:competitionId/results` | Fetch full results after completion | Existing MARL UI | None | 120/min |
| ✅ Covered | GET | `/api/marl/competition/:competitionId/trade-log` | Per-agent trade summary | Existing MARL UI | None | 120/min |
| ✅ Covered | GET | `/api/marl/competitions` | List all competitions | Existing MARL UI | None | 120/min |
| ✅ Covered | POST | `/api/marl/agents/compare` | Head-to-head agent comparison (N rounds) | Existing MARL UI | None | 10/min |
| ✅ Covered | GET | `/api/marl/competition/:competitionId/equity-curves` | Time-series equity for all agents | MARL Equity Reload | None | 120/min |
| 🎯 Phase 1 | GET | `/api/marl/competition/:competitionId/stream` | Server-Sent Events stream for real-time progress | **P3-T2**: SSE Streaming Upgrade | None | None |
| 🎯 Phase 1 | GET | `/api/marl/coin-universe` | Preview AUTO mode coin selections | Existing MARL UI | None | 120/min |
| 🎯 Phase 2 | POST | `/api/marl/agents/:agentId/pretrain` | Pre-train on synthetic market data | Existing Agent Mgmt | None | 5/min |
| 🎯 Phase 2 | GET | `/api/marl/agents/learning` | List all agent learning states | **P2-T3**: Agent Learning State | None | 120/min |
| 🎯 Phase 2 | DELETE | `/api/marl/agents/:agentId/learning` | Reset learned Q-table/policy | **P2-T3**: Agent Learning State | x-api-key | None |
| 🎯 Phase 2 | POST | `/api/marl/agents/:agentId/algorithm` | Set agent learning algorithm (Q_TABLE/POLICY_GRADIENT/DQN) | **P2-T4**: Agent Algorithm Config | None | 120/min |

**Key Rate Limits**:
- `MARL_START_RATE_LIMIT_MAX` = 5/min (start competition)
- `MARL_COMPARE_RATE_LIMIT_MAX` = 10/min (compare agents)
- `MARL_READ_RATE_LIMIT_MAX` = 120/min (all GET endpoints)
- `MARL_RATE_LIMIT_WINDOW_MS` = 60,000ms

**Rate Limit Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (429 status)

---

## Evolutionary Tournaments

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | POST | `/api/evolutionary/tournament` | Start new evolutionary tournament | Existing Evolution UI | None |
| ✅ Covered | GET | `/api/evolutionary/tournament` | List all tournaments | Existing Evolution UI | None |
| ✅ Covered | GET | `/api/evolutionary/tournament/:id` | Get full tournament record with generation history | Existing Evolution UI | None |
| ✅ Covered | GET | `/api/evolutionary/summary` | Aggregate dashboard summary | Existing Agent Mgmt | None |
| ✅ Covered | POST | `/api/evolutionary/breed` | Create mutated children from parents | Existing Agent Mgmt | None |
| 🎯 Phase 3 | GET | `/api/marl/evolution/history` | All evolutionary generations with stats (for charting) | **P3-T1**: Evolution Analytics | None |
| 🎯 Phase 3 | GET | `/api/marl/evolution/best-genome` | Genome of highest-fitness agent across tournaments | **P3-T1**: Evolution Analytics | None |
| 🎯 Phase 3 | GET | `/api/marl/evolution/population` | Current population of most recent tournament | **P3-T1**: Evolution Analytics | None |

---

## Agent Management

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | GET | `/api/agents` | List active agents (paginated) | Agent Management Dashboard | None |
| ✅ Covered | GET | `/api/agents/stats/leaderboard` | Top agents by win rate (MUST register before `/:id` route) | Agent Leaderboard | None |
| ✅ Covered | GET | `/api/agents/:id` | Single agent detail | Agent Detail View | None |
| ✅ Covered | PUT | `/api/agents/:id/customize` | Update agent cosmetics (name, emoji, color, bio) | Agent Customization | None |
| ✅ Covered | POST | `/api/agents/:id/retire` | Manually retire an agent | Agent Management | None |
| ✅ Covered | GET | `/api/agents/:id/history` | Competition participation history | Agent History | None |
| ✅ Covered | GET | `/api/agents/:id/genome` | Get agent's genome (genetic blueprint) | Genealogy Tree | None |
| ✅ Covered | GET | `/api/agents/:id/genealogy` | Get agent's ancestry tree | Genealogy Tree | None |

**Notes**: All agent endpoints are fully covered. No Phase 1-3 tasks needed.

---

## Social Media & Trending

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | GET | `/api/social-media/trending-topics` | Top trending topics across all sources | Social Dashboard | None |
| ✅ Covered | GET | `/api/social-media/items` | Paginated scored social items | Social Feed | None |
| ✅ Covered | GET | `/api/social-media/item/:id` | Single scored item with breakdown | Social Item Detail Panel | None |
| ✅ Covered | GET | `/api/social-media/stats` | Source health metrics | Social Dashboard | None |
| ✅ Covered | GET | `/api/trending-score/:symbol` | Multi-source trend report | Social Dashboard | None |
| ✅ Covered | POST | `/api/social-media/refresh` | Trigger immediate social scrape | Social Dashboard Refresh | None |
| 🎯 Phase 3 | GET | `/api/scrape/social` | Scrape one symbol from social platforms | **P3-T3**: Advanced Social Tools | None |
| 🎯 Phase 3 | POST | `/api/scrape/batch` | Batch scrape up to 20 symbols | **P3-T3**: Advanced Social Tools | None |
| 🎯 Phase 3 | GET | `/api/trending` | Trending topics from in-memory engine | **P3-T3**: Advanced Social Tools | None |
| 🎯 Phase 3 | POST | `/api/trending/ingest` | Manually push ScrapedPost objects | **P3-T3**: Advanced Social Tools | None |

**Social Refresh Response**: 202: `{status: "refreshing", mode, symbols}` (fire-and-forget)

**Item Detail Response**: 200: Full item with `scoring_breakdown: {sentiment, engagement, authority, recency, composite, feature_attribution}`

---

## Broker & Real Trading

| Status | Method | Path | Description | Task Coverage | Auth | Rate Limit |
|--------|--------|------|-------------|---|------|-----------|
| ✅ Covered | GET | `/api/marl/broker/credentials/picker` | Unauthenticated dropdown: id + label + provider + mode | MARL Credential Modal | None | None |
| 🎯 Phase 2 | GET | `/api/marl/broker/credentials` | List stored credentials (metadata only, no secrets) | **P2-T1**: Broker Credential Mgmt | x-api-key | None |
| 🎯 Phase 2 | POST | `/api/marl/broker/credentials` | Store encrypted broker credentials | **P2-T1**: Broker Credential Mgmt | x-api-key | None |
| 🎯 Phase 2 | DELETE | `/api/marl/broker/credentials/:id` | Remove stored credential & disconnect adapter | **P2-T1**: Broker Credential Mgmt | x-api-key | None |
| 🎯 Phase 2 | POST | `/api/marl/broker/connect/:id` | Decrypt & activate broker adapter | **P2-T1**: Broker Credential Mgmt | x-api-key | None |
| 🎯 Phase 2 | GET | `/api/marl/broker/connected` | List currently connected adapters | **P2-T1**: Broker Credential Mgmt | x-api-key | None |
| 🎯 Phase 2 | GET | `/api/marl/broker/orders/:competitionId` | Order audit trail for a competition | **P2-T2**: Broker Order Audit | x-api-key | None |
| 🎯 Phase 2 | POST | `/api/marl/broker/emergency-stop` | Cancel all open orders for a competition | **P2-T2**: Broker Emergency Stop | x-api-key | None |

**Credential Storage**: Body `{label?, provider (ALPACA/CRYPTO_COM/BINANCE_US/COINBASE), mode (PAPER/SANDBOX/LIVE), apiKey, apiSecret}`

**Auth Requirement**: All broker endpoints require `x-api-key` header matching `API_SECRET_KEY` environment variable.

**Important**: Broker credentials are encrypted at rest using AES-256-GCM with `BROKER_MASTER_KEY`. Without this key, adapter connection will fail with 503.

---

## Trading (Paper/Sandbox/Live)

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| 🎯 Phase 2 | GET | `/api/trading/exchange-status` | Connection state & active exchange | **P2-T5**: Trading Dashboard | None |
| 🎯 Phase 2 | GET | `/api/trading/price/:symbol` | Current price from active exchange | **P2-T5**: Trading Dashboard | None |
| 🎯 Phase 2 | GET | `/api/trading/balances` | All non-zero balances | **P2-T5**: Trading Dashboard | None |
| 🎯 Phase 2 | POST | `/api/trading/order` | Place order (BUY/SELL) with safety guards | **P2-T5**: Trading Dashboard | None |
| 🎯 Phase 2 | GET | `/api/trading/stats` | Capital, PnL, trade counts | **P2-T5**: Trading Dashboard | None |

**Trading Response**: POST order → 200: `{success, message?, order?}` or 400/500 with errors

**Safety Guards**: All BUY orders protected by:
- Kill switch (% daily loss threshold)
- Max open positions limit
- Position size cap
- $1 minimum notional

SELL orders bypass kill switch. Emergency stop (broker endpoint) cancels all orders.

---

## Backtesting

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | POST | `/api/agents/configure` | Register trading agents for backtesting | Backtesting Tab | None |
| ✅ Covered | POST | `/api/backtest/run` | Run backtest on historical data | Backtesting Tab | None |
| ✅ Covered | GET | `/api/backtest/results/:testId` | Retrieve full equity curves & trades | Backtesting Tab | None |

**Backtest Run Response**: 200: `{testId, status: "COMPLETED", results: [{agentId, agentType, riskProfile, totalReturnPct, winRate, profitFactor, maxDrawdown, sharpeRatio, totalTrades, trades[]}], topPerformer, summary}`

**Backtest Request**: Body `{symbols[], startDate (YYYY-MM-DD), endDate, agents?, slippageModel? (FIXED/VOLUME_BASED/MARKET_IMPACT), commissionPct?}`

---

## Rankings & Analysis

| Status | Method | Path | Description | Task Coverage | Rate Limit |
|--------|--------|------|-------------|---|-----------|
| ✅ Covered | GET | `/api/rankings/top-coins` | Rank coins by smart-sentiment score | Dashboard | None |

**Notes**: Integrated into Dashboard. P1-T1 (Sentiment Lab) includes this endpoint for ranking display.

---

## Authentication & Rate Limiting

### Admin Endpoints (Require x-api-key)

These endpoints require the `x-api-key` header to match the `API_SECRET_KEY` environment variable:

- POST `/api/refresh-sentiment` — Sentiment refresh trigger
- DELETE `/api/marl/agents/:agentId/learning` — Reset agent learning state
- All `/api/marl/broker/*` endpoints — Broker credential and order management
- POST `/api/marl/broker/emergency-stop` — Emergency stop (destructive action)

### Rate Limiting

**MARL-specific rate limiters** (configurable via env):

| Endpoint Group | Default Limit | Window | Config Variable |
|---|---|---|---|
| Competition Start | 5/min | 60s | `MARL_START_RATE_LIMIT_MAX` |
| Agent Compare | 10/min | 60s | `MARL_COMPARE_RATE_LIMIT_MAX` |
| All GET endpoints | 120/min | 60s | `MARL_READ_RATE_LIMIT_MAX` |
| Window duration | — | 60,000ms | `MARL_RATE_LIMIT_WINDOW_MS` |

**Response headers on rate-limited responses**:
- `X-RateLimit-Limit` — Max requests in window
- `X-RateLimit-Remaining` — Remaining requests
- `X-RateLimit-Reset` — Unix timestamp when limit resets
- `Retry-After` — Seconds to wait before retry (428/429 status)

**Rate Limit Exceeded**: HTTP 429 with message indicating retry timing.

### Public Endpoints (No Auth Required)

All other endpoints are publicly accessible without authentication.

---

## Technical Notes

### Async Operations

Several endpoints return **HTTP 202 Accepted** for long-running operations:

- `POST /api/refresh-sentiment` — Fire-and-forget sentiment cache refresh
- `POST /api/evolutionary/tournament` — Evolutionary tournament execution
- `POST /api/social-media/refresh` — Social platform scrape trigger

Clients must poll the corresponding status/result endpoints to track completion.

### Database Health Check

Routes that depend on SQLite database are conditionally mounted via `storage.isHealthy()`:

- Agent stats routes (all endpoints)
- Evolutionary routes (all endpoints)
- MARL competition routes (all endpoints)

If database connection fails at startup or runtime, these route groups return **404 Not Found** for all endpoints.

### Redis Queue Infrastructure

Social scraper and tournament worker processes support **optional BullMQ queue integration** (disabled if `REDIS_URL` not set).

When Redis is unavailable, operations fall back to in-process execution:
- Social refresh falls back to `setImmediate()` pseudo-queue
- SIMULATED tournaments fall back to Worker Threads
- PAPER/LIVE tournaments always run on main API thread

### Credential Encryption

Broker credentials are encrypted at rest using **AES-256-GCM**:

- Requires `BROKER_MASTER_KEY` environment variable (256-bit key)
- Credentials are encrypted before storage in SQLite
- Decryption happens on-demand during adapter connection
- If `BROKER_MASTER_KEY` is missing, credential operations fail with **503 Service Unavailable**

### Polling Intervals (Frontend)

For reference when implementing UI:

- MARL competition status: **2 seconds** (in existing MarlCompetitionViewer)
- Agent management: **5 seconds** (in existing AgentManagementDashboard)
- Social media: **60 seconds** (in existing SocialDashboard)
- Health check: Configure per P1-T3 implementation needs

### SSE (Server-Sent Events)

`GET /api/marl/competition/:competitionId/stream` is a streaming endpoint that sends real-time progress events:

- Content-Type: `text/event-stream`
- Events: `{type: "progress"|"completed"|"failed", ...}`
- Heartbeats keep TCP connection alive during long competitions
- Auto-closes on terminal events (completed/failed)
- Use as optional upgrade in P3-T2 (fallback to polling otherwise)

### Session State Persistence

Learn about agent pre-training (synthetic market training) persistence:

- `POST /api/marl/agents/:agentId/pretrain` stores converged state in SQLite `agent_learning_states` table
- Multiple calls to pretrain continue from the persisted state (additive)
- State is used by live competitions for warm-start initialization
- Reset via `DELETE /api/marl/agents/:agentId/learning` (destructive, **requires confirmation in UI**)

---

## Implementation Checklist

Use this list when implementing Phase 1-3 tasks to verify all mapped endpoints are integrated:

- [ ] **P1-T1** (Sentiment Lab): `/api/sentiment/analyze`, `/api/sentiment/:symbol`, `/api/rankings/top-coins`, `/api/info/modes` integrated and tested
- [ ] **P1-T2** (Refresh): `/api/refresh-sentiment` callable with x-api-key input modal and async feedback
- [ ] **P1-T3** (Health): `/api/health` polled and rendered as status indicator
- [ ] **P1-T4** (Backtesting): `/api/agents/configure`, `/api/backtest/run`, `/api/backtest/results/:testId` form + result display complete
- [ ] **P1-T5** (MARL Info): `/api/marl/info` and `/api/marl/competition/:competitionId/equity-curves` drawable
- [ ] **P1-T6** (Social): `/api/social-media/refresh` button + `/api/social-media/item/:id` side panel complete
- [ ] **P2-T1** (Broker Mgmt): `/api/marl/broker/credentials`, `/api/marl/broker/credentials/:id`, `/api/marl/broker/connect/:id`, `/api/marl/broker/connected` admin panel
- [ ] **P2-T2** (Broker Orders): `/api/marl/broker/orders/:competitionId` and `/api/marl/broker/emergency-stop` destructive controls
- [ ] **P2-T3** (Learning State): `/api/marl/agents/learning` and `/api/marl/agents/:agentId/learning` (DELETE with warning)
- [ ] **P2-T4** (Algorithm): `/api/marl/agents/:agentId/algorithm` selector
- [ ] **P2-T5** (Trading): All `/api/trading/*` endpoints in dedicated tab
- [ ] **P3-T1** (Evolution): `/api/marl/evolution/history`, `/api/marl/evolution/best-genome`, `/api/marl/evolution/population`
- [ ] **P3-T2** (SSE): `/api/marl/competition/:competitionId/stream` optional toggle (fallback to polling)
- [ ] **P3-T3** (Advanced Social): `/api/scrape/batch`, `/api/trending`, `/api/trending/ingest` advanced drawer

---

## Related Documentation

- [TASKS.md](TASKS.md) — Detailed task descriptions and acceptance criteria
- [CLAUDE.md](CLAUDE.md) — Project setup, architecture overview, and quick reference
- [docs/EVOLUTIONARY_SYSTEM_OVERVIEW.md](docs/EVOLUTIONARY_SYSTEM_OVERVIEW.md) — Evolutionary tournament design
- [docs/MARL/MARL_INTEGRATION_GUIDE.md](docs/MARL/MARL_INTEGRATION_GUIDE.md) — MARL system integration

---

**Last Updated**: [Date when this file was created]  
**API Version**: v1 (current production)  
**Total Endpoints Documented**: 64