MARL INTEGRATION GUIDE
======================

This document describes how the MARL competition system is integrated in the current repository.

CURRENT STATUS
==============

The MARL stack is already integrated across backend and frontend.

Backend:
- backend/src/services/marl-competition-engine.ts
- backend/src/routes/marl-competition.ts
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

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
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
- The repo currently does not contain a usable ESLint config for backend or frontend lint scripts, so lint is not a reliable readiness signal right now.

TROUBLESHOOTING
===============

Issue: backend health says misconfigured
Solution: populate backend/.env from backend/.env.example.

Issue: /api/marl/competition/:id/results returns 202
Solution: the tournament is still running; keep polling status.

Issue: frontend path /marl does not exist
Solution: use the MARL Competition tab in the app instead of a dedicated router URL.