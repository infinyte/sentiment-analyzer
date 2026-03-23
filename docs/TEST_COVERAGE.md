# Test Coverage Report

> Last updated: 2026-03-23
> Backend: Jest + ts-jest | Frontend: Vitest + @testing-library/react

---

## Summary

Measured from current local coverage runs:

- Backend: `npx jest --config jest.config.cjs --coverage --coverageReporters=json-summary --coverageReporters=text-summary`
- Frontend: `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary`

| Project | Suites | Tests | Stmts | Branch | Funcs | Lines |
|---------|-------:|------:|------:|-------:|------:|------:|
| **Backend** | 44 | 603 | 54.90% | 40.36% | 50.29% | 56.20% |
| **Frontend** | 6 | 48 | 67.53% | 50.93% | 61.08% | 70.05% |

Latest verification run (non-coverage):

- Backend tests: 46 suites, 606 tests passed.
- Frontend tests: 6 files, 52 tests passed.
- Backend build passes.
- Frontend build passes.
- Docs validator passes.

Raw coverage artifacts:

- Backend summary: `backend/coverage/coverage-summary.json`
- Frontend summary: `frontend/coverage/coverage-summary.json`

---

## Backend Highlights

### Highest Coverage Areas

| File | Stmts | Branch | Funcs | Lines |
|------|------:|-------:|------:|------:|
| `src/container.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/services/cache.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/services/finbert.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/services/social-media/scoring/coin-extractor.ts` | 100.00% | 100.00% | 100.00% | 100.00% |
| `src/services/evolutionary/agent-genome.ts` | 100.00% | 100.00% | 100.00% | 100.00% |

### Important Mid-Coverage Files

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `src/index.ts` | 56.53% | 46.42% | 50.00% | 58.29% | Better than before, but startup and long-tail route paths still dominate untested lines |
| `src/routes/marl-competition.ts` | 55.67% | 48.89% | 50.00% | 56.52% | Queue and SSE branches still light |
| `src/services/marl-competition-engine.ts` | 61.77% | 46.40% | 58.92% | 63.21% | Main simulation logic is covered; wall-clock and live paths remain thin |
| `src/routes/social-media.ts` | 67.56% | 43.39% | 73.91% | 67.61% | Good endpoint coverage, but branch depth can improve |
| `src/services/sentiment-analyzer.ts` | 83.60% | 62.79% | 78.72% | 89.32% | Strong core engine coverage |
| `src/services/pre-trainer.ts` | 100.00% | 77.77% | 100.00% | 100.00% | Newly covered additive pre-training and persistence paths |
| `src/services/synthetic-market-generator.ts` | 94.91% | 83.33% | 100.00% | 94.73% | Newly covered step clamp, regime restriction, and bar invariants |

### Lowest Coverage Priorities

| File | Stmts | Branch | Funcs | Lines | Why low |
|------|------:|-------:|------:|------:|---------|
| `src/services/brokers/base-broker-adapter.ts` | 3.77% | 0.00% | 0.00% | 4.25% | Credential and integration driven |
| `src/services/brokers/alpaca-adapter.ts` | 5.05% | 0.00% | 0.00% | 5.31% | External API dependent |
| `src/services/exchange/coinbase-exchange.ts` | 3.38% | 0.00% | 0.00% | 3.63% | External API dependent |
| `src/repositories/adapters/sqlite/sqlite-social.repository.ts` | 4.22% | 0.00% | 5.00% | 4.34% | Good candidate for in-memory SQLite tests |

---

## Frontend Highlights

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `src/App.tsx` | 58.07% | 46.56% | 48.12% | 60.96% | Covers detail modal, health fallback, and Backtesting workflow |
| `src/components/AgentManagementDashboard.tsx` | 79.21% | 59.15% | 78.28% | 81.25% | Strongest major UI surface |
| `src/components/MarlCompetitionViewer.tsx` | 58.36% | 44.31% | 44.55% | 60.59% | Improved by info drawer and equity reload tests |
| `src/components/SocialDashboard.tsx` | 71.73% | 49.72% | 66.66% | 77.50% | Large jump after refresh and detail tests |
| `src/hooks/useMarlCompetition.ts` | 61.45% | 34.37% | 60.00% | 64.13% | Polling and retry branches still open |
| `src/hooks/useSocialMedia.ts` | 91.02% | 62.96% | 93.75% | 93.84% | Newly covered direct hook tests for fetch, refresh, polling, and error states |

---

## Testing Notes

- The latest backend test run completed successfully but still emitted one Jest worker-exit warning at shutdown.
- Frontend coverage runs are slower than normal test runs; the long App and Agent Management tests use higher timeouts compatible with coverage instrumentation.
- `useSocialMedia` hook coverage required limiting fake timers to the polling case only; direct `act(...)` timer advancement was more reliable than `waitFor(...)` under fake timers.
- The latest backend increase comes from focused service coverage for synthetic market generation and additive pre-training persistence.

---

## Recommended Next Targets

### Backend

1. `src/repositories/adapters/sqlite/sqlite-social.repository.ts`
2. `src/repositories/adapters/sqlite/sqlite-agent.repository.ts`
3. `src/routes/trading.ts`
4. `src/services/trending-topics.ts`
5. `src/services/trading-agent.ts`

### Frontend

1. More branch coverage for `src/components/MarlCompetitionViewer.tsx`
2. More retry and error coverage for `src/hooks/useMarlCompetition.ts`
3. More App-level branch coverage in `src/App.tsx`

---

## Running Tests

```bash
# Backend - all tests
cd backend && npm test

# Backend - coverage
cd backend && npx jest --config jest.config.cjs --coverage --coverageReporters=json-summary --coverageReporters=text-summary

# Frontend - all tests
cd frontend && npm test

# Frontend - coverage
cd frontend && npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary

# Type-checks
cd backend && npm run type-check
cd frontend && npm run type-check
```
