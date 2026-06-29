MARL INTEGRATION GUIDE
======================

This document describes how the MARL competition system is integrated in the current repository.

> **Now part of a live pipeline (Phases 4-7).** The MARL/evolution stack integrated here is the research engine for a live agent loop: the best evolved genome is mapped onto the live decision policy by the **MarlPolicyFeeder** (Phase 7), run continuously by the **ShadowHarness** (Phase 4) through the safety-guarded `TradingService`, validated by **walk-forward analysis** (Phase 5), streamed to the "Shadow Live" UI over SSE (Phase 6), and measured by **net-of-fees expectancy analytics** (`/api/paper/*`). See the README section "Phase 4-7: Live Agent Pipeline" and `CLAUDE.md`.

CURRENT STATUS
==============

The MARL stack is already integrated across backend and frontend.

Backend:
- backend/src/services/marl-competition-engine.ts
- backend/src/routes/marl-competition.ts
- backend/src/queues/connection.ts
- backend/src/queues/tournament.queue.ts
- backend/src/queues/scraper.queue.ts
- backend/src/workers/tournament-worker-process.ts
- backend/src/workers/scraper-worker-process.ts
- backend/src/index.ts

Frontend:
- frontend/src/types/marl.ts
- frontend/src/hooks/useMarlCompetition.ts
- frontend/src/components/MarlCompetitionViewer.tsx
- frontend/src/App.tsx

Tests:
- backend/src/__tests__/api/marl.test.ts
- backend/src/__tests__/services/marl-competition-engine.test.ts
- frontend/src/__tests__/useMarlCompetition.test.ts
- frontend/src/__tests__/MarlCompetitionViewer.test.tsx

BACKEND INTEGRATION
===================

The Express app mounts the MARL routes from backend/src/index.ts.

Current route mount:

```ts
import marlRoutes from './routes/marl-competition.js';

app.use(marlRoutes);
```

Exposed MARL endpoints:
- POST /api/marl/competition/start
- GET /api/marl/competition/:competitionId/status
- GET /api/marl/competition/:competitionId/results
- POST /api/marl/agents/compare
- GET /api/marl/competitions
- GET /api/marl/info

Engine capabilities currently implemented:
- shared order book with deterministic price-time priority
- SINGLE, EVOLUTIONARY, and CONTINUOUS competition modes
- Q-learning agent updates using the action actually taken
- evolutionary learning-state carry-over and mutation
- preserved competition IDs from route start through result payload
- CoinGecko-seeded base prices with fallback behavior

BullMQ queue layer (optional — requires REDIS_URL):
- SIMULATED tournament starts are enqueued to the BullMQ `tournament` queue
  instead of dispatched directly to a Worker Thread.
- A `QueueEvents` listener in `marl-competition.ts` bridges job progress/completed/
  failed events back to the in-process competition record so status polling works
  identically whether Redis is present or not.
- When REDIS_URL is not set, the route falls back to Worker Threads, preserving
  the original in-process behavior.
- PAPER and LIVE tournaments always run on the main API thread regardless of Redis.

FRONTEND INTEGRATION
====================

The frontend does not use a standalone /marl route. MARL is integrated as an in-app tab in frontend/src/App.tsx.

Current app integration:

```tsx
type ActiveView = 'dashboard' | 'marl';

{activeView === 'marl' && <MarlCompetitionViewer />}
```

The hook in frontend/src/hooks/useMarlCompetition.ts provides:
- startCompetition(config)
- compareAgents(agent1, agent2, symbols, rounds, duration)
- loadList()
- loadResults(competitionId)
- reset()

The compare API request shape is:

```json
{
  "agent1": { "id": "alpha", "riskProfile": "AGGRESSIVE" },
  "agent2": { "id": "beta", "riskProfile": "CONSERVATIVE" },
  "symbols": ["BTC"],
  "rounds": 3,
  "duration": 100
}
```

It does not use an agents array for comparisons.

VALIDATED STATE
===============

Validated during review:
- backend MARL API tests pass
- backend MARL engine service tests pass
- backend type-check passes
- backend build passes
- frontend MARL hook tests pass
- frontend MARL viewer tests pass
- frontend type-check passes

RUN PATH
========

Backend (API only, no Redis):

```bash
cd backend
npm install
cp backend.env.template .env
npm run dev
```

Backend with BullMQ workers (optional — requires Redis):

```bash
# Start Redis (or use docker-compose up redis)

# Set REDIS_URL=redis://localhost:6379 in backend/.env

cd backend
npm run dev                     # API process
npm run dev:tournament-worker   # Tournament worker process (separate terminal)
npm run dev:scraper-worker      # Scraper worker process (separate terminal)
```

Full stack via Docker Compose (includes Redis + both workers):

```bash
docker-compose up
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173 and switch to the MARL Competition tab.

IMPORTANT NOTES
===============

- The main app can start without API keys, but /api/health will report `misconfigured` for Claude and NewsAPI until backend/.env is populated.
- Core live sentiment functionality depends on valid CLAUDE_API_KEY and NEWSAPI_API_KEY.
- MARL simulations can still run with fallback market seeding if CoinGecko fetches fail.
- REDIS_URL is optional. Without it, SIMULATED tournaments fall back to Worker Threads and social
  scraping falls back to in-process execution. The API surface and polling behavior are identical.
- When REDIS_URL is set, start the tournament worker and scraper worker as separate processes
  (see Run Path above) to handle queued jobs. The API process will not process queued jobs itself.
- The `docker-compose.yml` includes `redis`, `tournament-worker`, and `scraper-worker` services
  that wire all of this up automatically for containerised deployments.

TROUBLESHOOTING
===============

Issue: backend health says misconfigured
Solution: populate backend/.env from backend/backend.env.template.

Issue: /api/marl/competition/:id/results returns 202
Solution: the tournament is still running; keep polling status.

Issue: frontend path /marl does not exist
Solution: use the MARL Competition tab in the app instead of a dedicated router URL.