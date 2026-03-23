# Sentiment-analyzer task Report

This report shows items remaining to be completed.


## Endpoints Not Yet Implemented In Frontend
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


### Implemented but UI-missing
- optional MARL SSE live stream toggle
- evolutionary tournament index/history/population workspace
- raw social scraping and ingest utilities


## Not yet checked
- Backend: Add tournament scheduler — DB table, cron engine, schedule/recurring params to start endpoint
- Backend: Add SSE streaming endpoint for live tournament events (equity, trades, agent actions)
- Backend: Expose live equity snapshots and agent positions during active tournament runs
- Frontend: Tournament Scheduler UI — create/edit/delete scheduled and recurring tournaments
- Frontend: Live Tournament Monitor panel — real-time equity curves, trade feed, agent actions during active run
- Backend: Add RealisticPaperExchange class — real broker prices, per-exchange fee schedules, slippage simulation
- Backend: Add REALISTIC_PAPER mode to exchange factory and expose fee schedule config
- Frontend: Add Realistic Paper mode to trading mode selector in MarlCompetitionViewer
- Backend: Add /api/admin/config endpoints to read and write .env values (auth protected)
- Frontend: Config editor modal on System/Admin tab — password-gated, groups all env vars by category, supports save

# TODO — Remaining & Partial Feature Work

Generated: 2026-03-23  
Based on implementation audit against TASKS.md

---

## Feature Area 1 — Live Tournament Monitoring

Three interconnected items: extend the SSE stream with rich events, capture live equity
snapshots inside the engine, and build the frontend monitor panel that consumes them.

---

### TODO-1: Extend SSE stream to broadcast equity snapshots and trade events
**Status:** Partial — SSE endpoint exists (`GET /api/marl/competition/:id/stream`) but only
emits `progress` (0–100), `completed`, and `failed`. No equity data or trade events are
published during an active run.

**Files to change:**
- `backend/src/services/pubsub.ts` — add new event types to union
- `backend/src/services/marl-competition-engine.ts` — publish equity/trade events during the tournament loop
- `backend/src/routes/marl-competition.ts` — SSE handler already forwards all pub/sub events; no route changes needed

**Acceptance Criteria:**
1. `pubsub.ts` exports two new event interfaces:
   - `CompetitionEquityEvent { type: 'equity_snapshot'; competitionId: string; progress: number; snapshots: { agentId: string; equity: number }[] }`
   - `CompetitionTradeEvent { type: 'trade_executed'; competitionId: string; agentId: string; symbol: string; side: 'BUY'|'SELL'; quantity: number; price: number; timestamp: string }`
   - Both are added to the `CompetitionPubSubEvent` union type.
2. `marl-competition-engine.ts` — inside `runSingleTournament`, at every existing snapshot interval (every `SNAPSHOT_INTERVAL` steps), in addition to pushing to `equitySnapshots[]`, it also calls `getPubSub().publish(channel, { type: 'equity_snapshot', ... })` with current per-agent equity.
3. `marl-competition-engine.ts` — after any `placeOrder` call in SIMULATED mode, the engine publishes a `trade_executed` event to the same channel.
4. An SSE client connected to `/api/marl/competition/:id/stream` during an active tournament receives `event: equity_snapshot` messages interspersed with `event: progress` messages throughout the run (not just at completion).
5. An SSE client receives `event: trade_executed` within 1 second of each trade being simulated.
6. Existing `progress`, `completed`, and `failed` events are unaffected.
7. Backend type-check (`npm run type-check` in `backend/`) passes.
8. All existing backend tests pass (`npm test` in `backend/`).

---

### TODO-2: Expose live equity snapshots via the equity-curves endpoint during active runs
**Status:** Partial — `GET /api/marl/competition/:id/equity-curves` returns HTTP 202 with
no data while the tournament is `RUNNING`. The engine only assembles `equityEvolution` at
tournament end; there is no in-progress snapshot buffer.

**Files to change:**
- `backend/src/services/marl-competition-engine.ts` — maintain live snapshot buffer accessible during execution
- `backend/src/routes/marl-competition.ts` — update the equity-curves handler to return partial data while RUNNING

**Acceptance Criteria:**
1. `MarlCompetitionEngine` exposes a `getLiveEquitySnapshots(competitionId: string): EquitySnapshot[]` method that returns the snapshots collected so far for a running tournament (same `EquitySnapshot` type already used for the final `equityEvolution`).
2. An in-memory map (`Map<string, EquitySnapshot[]>`) is maintained per active competition, appended at every existing snapshot interval, and cleared when the competition reaches a terminal state (COMPLETED or FAILED).
3. `GET /api/marl/competition/:id/equity-curves` — when status is `RUNNING`:
   - Returns HTTP 200 (not 202).
   - Response body includes `"status": "RUNNING"`, `"snapshotCount": <n>`, `"equityCurves": [ ... ]` with all snapshots collected so far (same shape as the completed-tournament response).
   - Response body includes `"progress": <0–100>` alongside the curves.
4. When the tournament is COMPLETED the endpoint still returns the full set of final snapshots as before.
5. Backend type-check passes.
6. All existing backend tests pass.

---

### TODO-3: Frontend — Live Tournament Monitor panel
**Status:** Not implemented. `MarlCompetitionViewer` polls `/status` every 2 seconds via
`useMarlCompetition`; no `EventSource` is used; equity reload is manual and shows a 202
message while a tournament is running.

**Files to change / create:**
- `frontend/src/hooks/useLiveTournament.ts` — new hook wrapping `EventSource`
- `frontend/src/components/MarlCompetitionViewer.tsx` — integrate hook and render live panel

**Acceptance Criteria:**
1. A new `useLiveTournament(competitionId: string | null)` hook in `frontend/src/hooks/useLiveTournament.ts`:
   - Opens an `EventSource` to `/api/marl/competition/:id/stream` when `competitionId` is non-null.
   - Handles `equity_snapshot` events by appending to a `liveSnapshots` state array.
   - Handles `trade_executed` events by prepending to a `tradeFeed` state array (capped at 50 entries).
   - Handles `progress` events to update a `liveProgress` number.
   - Handles `completed` and `failed` events by closing the `EventSource` and setting a `isLive: false` flag.
   - Closes and cleans up the `EventSource` on unmount or when `competitionId` changes.
2. `MarlCompetitionViewer.tsx` — while a tournament is in STARTED/RUNNING status:
   - Uses `useLiveTournament` to receive live events.
   - Renders a live equity chart (existing ChartJS `react-chartjs-2` Line chart pattern) that updates in real-time as `equity_snapshot` events arrive; one dataset per agent, colored to match existing agent colors.
   - Renders a "Trade Feed" list below the chart showing the 10 most recent `trade_executed` events with columns: Agent, Symbol, Side, Qty, Price, Time.
   - The existing "Reload Equity" manual button is hidden while `isLive` is true; it reappears after the tournament ends.
   - The progress bar already present updates from `liveProgress`.
3. When the tournament completes, the live chart stops updating and the final equity curves are fetched once via the existing manual reload flow (or automatically).
4. The monitor gracefully handles the case where SSE is unavailable (falls back to existing polling without crashing).
5. Frontend type-check (`npm run type-check` in `frontend/`) passes.
6. All existing frontend tests pass (`npm test` in `frontend/`).
7. A Vitest test in `frontend/src/__tests__/MarlCompetitionViewer.test.tsx` covers: (a) `EventSource` is opened when a competition is started, (b) a synthetic `equity_snapshot` event updates the chart dataset, (c) a synthetic `trade_executed` event appears in the trade feed, (d) `EventSource` is closed on `completed` event.

---

## Feature Area 2 — Tournament Scheduler

Two items: backend persistence + cron engine, and the frontend CRUD UI.

---

### TODO-4: Backend — Tournament scheduler (DB table + cron engine + API endpoints)
**Status:** Not implemented. No `tournament_schedules` table exists. `POST /api/marl/competition/start`
accepts no schedule or recurrence parameters. There is no cron runner for tournaments.

**Files to change / create:**
- `backend/src/storage.ts` — add `tournament_schedules` table DDL
- `backend/src/database/migrations/` — add migration `004-tournament-schedules.ts`
- `backend/src/routes/marl-competition.ts` — add schedule CRUD endpoints
- `backend/src/lifecycle.ts` — register scheduler cron job on startup
- `backend/src/services/tournament-scheduler.ts` — new service

**Schema (`tournament_schedules` table):**
```sql
CREATE TABLE IF NOT EXISTS tournament_schedules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  config          TEXT NOT NULL,   -- JSON: same shape as POST /api/marl/competition/start body
  cron_expression TEXT,            -- NULL means one-shot
  run_at          TEXT,            -- ISO datetime for one-shot schedules; NULL for recurring
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_run_at     TEXT,
  last_run_id     TEXT,            -- competitionId of most recent run
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON tournament_schedules (enabled, run_at);
```
**New API endpoints (all under /api/marl/schedule):**

- POST   /api/marl/schedule — create a schedule
- GET    /api/marl/schedule — list all schedules
- GET    /api/marl/schedule/:id — get one schedule
- PATCH  /api/marl/schedule/:id — update (name, config, cron_expression, run_at, enabled)
- DELETE /api/marl/schedule/:id — delete a schedule
- POST   /api/marl/schedule/:id/run-now — immediately trigger a scheduled tournament

**Acceptance Criteria:**

1. tournament_schedules table is created during storage initialization and populated by the new migration file following the pattern in 003-agent-identity.ts.
2. All five CRUD endpoints exist and return correct HTTP status codes (201 create, 200 list/get/patch, 204 delete, 400 validation errors, 404 not found).
3. POST /api/marl/schedule body validates: name (required), config (required, object with same fields as competition start), and one of cron_expression or run_at (at least one must be provided).
4. A TournamentSchedulerService in backend/src/services/tournament-scheduler.ts:
 - On startup, loads all enabled schedules.
 - For recurring schedules (non-null cron_expression), registers a node-cron job that fires startScheduledTournament(schedule) on the cron expression.
 - For one-shot schedules (non-null run_at), checks if the run_at time is in the future and sets a setTimeout; if in the past and last_run_at is null, fires immediately.
 - startScheduledTournament submits the tournament using the stored config and updates last_run_at and last_run_id on completion.
5. lifecycle.ts starts TournamentSchedulerService after storage is healthy and stops it on shutdown.
6. POST /api/marl/schedule/:id/run-now triggers the tournament regardless of schedule timing and returns the new competitionId.
7. Disabling a schedule (enabled: 0 via PATCH) stops its cron job without deleting the record.
8. Backend type-check passes; all existing tests pass.
9. New Jest tests in backend/src/__tests__/api/marl-schedule.test.ts cover: create, list, get, patch, delete, 404 on unknown id.

---

TODO-5: Frontend — Tournament Scheduler UI
Status: Not implemented. No component exists for creating, editing, or listing scheduled tournaments.

Files to change / create:

frontend/src/components/TournamentScheduler.tsx — new component
frontend/src/components/MarlCompetitionViewer.tsx — add "Scheduler" tab/section
Acceptance Criteria:

A new TournamentScheduler component renders a list of existing schedules fetched from GET /api/marl/schedule, with columns: Name, Type (One-shot / Recurring), Cron/Run-at, Enabled toggle, Last Run, Actions.
A "New Schedule" button opens an inline form (or modal-style panel) with:
Name text input (required).
Schedule type toggle: "One-shot" (date-time picker for run_at) vs "Recurring" (cron expression text input with a human-readable preview).
Tournament config section reusing the same tournament config fields already present in MarlCompetitionViewer (agents, symbols, mode, duration, exchangeMode, etc.) — either by composing the existing form or linking to a config: JSON textarea with an example pre-populated.
Save button → POST /api/marl/schedule; Cancel resets form.
Each schedule row has:
An enabled/disabled toggle → PATCH /api/marl/schedule/:id with { enabled: true/false }.
A "Run Now" button → POST /api/marl/schedule/:id/run-now; on success, navigates to the returned competitionId in the competition viewer.
An "Edit" button that re-opens the form pre-populated.
A "Delete" button with confirmation → DELETE /api/marl/schedule/:id.
The scheduler is accessible from the existing MARL Competition tab (e.g., as a "Scheduled" sub-tab alongside the competition list).
Frontend type-check passes; all existing frontend tests pass.
A Vitest test in frontend/src/__tests__/ covers: schedule list renders, new schedule form submits correctly, delete prompts confirmation.
Feature Area 3 — Realistic Paper Exchange
Three items: the exchange class, the factory/type wiring, and the frontend mode selector.

TODO-6: Backend — RealisticPaperExchange class
Status: Not implemented. PaperExchange uses a random walk (±1%/tick) with no fees and
no slippage. No RealisticPaperExchange file exists.

Files to create:

backend/src/services/exchange/realistic-paper-exchange.ts
Reference: Extend the pattern from backend/src/services/exchange/paper-exchange.ts
and follow the ExchangeInterface contract in backend/src/services/exchange/exchange-interface.ts.

Acceptance Criteria:

RealisticPaperExchange implements ExchangeInterface and is exported from realistic-paper-exchange.ts.
Real broker prices: getCurrentPrice(symbol) fetches a live quote from the configured provider using the existing exchange adapters (e.g., CryptoComClient.getPrice() or equivalent) instead of the random-walk simulation. Falls back to the random-walk if the live fetch fails.
Per-exchange fee schedules: Constructor accepts a FeeSchedule object:

interface FeeSchedule {  makerFeePct: number;   // e.g. 0.001 (0.1%)  takerFeePct: number;   // e.g. 0.002 (0.2%)}
Default values pre-set per provider:
Crypto.com: maker 0.10%, taker 0.15%
Coinbase Advanced: maker 0.00%, taker 0.05% (≤$100k/mo tier)
Binance.US: maker 0.10%, taker 0.10%
Alpaca: maker 0.00%, taker 0.00% (equity-style)
Slippage simulation: On placeOrder, the executed price is adjusted by a configurable slippageModelPct (default 0.05%) multiplied by Math.random(), with direction opposite to the trade side (BUY pays more, SELL receives less).
Fee deduction: After slippage, the fee (takerFeePct × notional) is deducted from the USDT balance on BUY and from the proceeds on SELL. The returned Order object includes a commission field with the fee amount.
placeOrder returns status: 'FILLED' immediately (same as PaperExchange) since the goal is realistic cost simulation, not fill simulation.
Unit tests in backend/src/__tests__/services/realistic-paper-exchange.test.ts cover: (a) fee is deducted on BUY, (b) fee is deducted on SELL, (c) slippage moves executed price in the correct direction, (d) live price fetch failure falls back to random walk.
Backend type-check passes; all existing tests pass.

TODO-7: Backend — REALISTIC_PAPER mode in exchange factory
Status: Not implemented. TradingMode enum only has PAPER, SANDBOX, LIVE.
The factory has no case for realistic paper trading.

Files to change:

backend/src/services/exchange/exchange-factory.ts
backend/src/services/app-config-service.ts — add REALISTIC_PAPER_SLIPPAGE_PCT and REALISTIC_PAPER_FEE_PRESET to the config catalog
backend/src/types.ts or equivalent types file that defines ExchangeMode for the MARL engine
Acceptance Criteria:

TradingMode enum gains REALISTIC_PAPER = 'realistic_paper'.
ExchangeFactory.create() handles TradingMode.REALISTIC_PAPER:
Reads REALISTIC_PAPER_FEE_PRESET from appConfigService (values: crypto-com, coinbase, binance-us, alpaca; default: matches current TRADING_PROVIDER).
Reads REALISTIC_PAPER_SLIPPAGE_PCT from appConfigService (default 0.05).
Constructs the appropriate fee schedule from the preset and instantiates RealisticPaperExchange.
appConfigService catalog includes:
REALISTIC_PAPER_FEE_PRESET (category: Trading, description: Fee schedule preset for REALISTIC_PAPER mode, default: crypto-com)
REALISTIC_PAPER_SLIPPAGE_PCT (category: Trading, description: Max one-way slippage % per trade in REALISTIC_PAPER mode, default: 0.05)
The existing PAPER mode is unchanged (still returns PaperExchange).
POST /api/marl/competition/start accepts exchangeMode: "REALISTIC_PAPER" without validation error (validation should now allow SIMULATED | PAPER | REALISTIC_PAPER | LIVE).
Backend type-check passes; all existing tests pass.

TODO-8: Frontend — Realistic Paper mode in MarlCompetitionViewer
Status: Not implemented. ExchangeMode type is 'SIMULATED' | 'PAPER' | 'LIVE'.
No "Realistic Paper" button exists in the mode selector.

Files to change:

frontend/src/types/marl.ts — extend ExchangeMode
frontend/src/components/MarlCompetitionViewer.tsx — add button and fee schedule info panel
Acceptance Criteria:

ExchangeMode type in frontend/src/types/marl.ts becomes 'SIMULATED' | 'PAPER' | 'REALISTIC_PAPER' | 'LIVE'.
The trading mode selector in MarlCompetitionViewer gains a fourth button labeled "Realistic Paper" with value REALISTIC_PAPER, positioned between "Paper Trading" and "Live Trading" in the button group.
When REALISTIC_PAPER is selected:
Broker credential picker remains hidden (no real credential needed, same as PAPER mode).
An informational note is shown beneath the selector explaining: "Uses live price feeds with simulated fees and slippage. Configured via Admin → REALISTIC_PAPER_FEE_PRESET and REALISTIC_PAPER_SLIPPAGE_PCT."
exchangeMode: "REALISTIC_PAPER" is sent in the POST /api/marl/competition/start body when this mode is selected.
Competition results and history rows display "Realistic Paper" label (not the raw enum string) wherever PAPER currently shows "Paper Trading".
Frontend type-check passes; all existing frontend tests pass.
A Vitest test in MarlCompetitionViewer.test.tsx covers: "Realistic Paper" button renders, clicking it sets exchangeMode to REALISTIC_PAPER in the submitted start body, info note is visible, broker picker is not rendered.

