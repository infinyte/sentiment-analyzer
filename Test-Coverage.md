# Test Coverage Report

> Last updated: 2026-03-22  
> Backend: Jest + ts-jest | Frontend: Vitest + @testing-library/react

---

## Summary

| Project | Suites | Tests | Stmts | Branch | Funcs | Lines |
|---------|-------:|------:|------:|-------:|------:|------:|
| **Backend** | 40 | 584 | 53.98% | 39.47% | 51.04% | 55.3% |
| **Frontend** | 4 | 38 | 57.72% | 45.09% | 51.95% | 60.38% |

Both projects pass all tests with zero failures. Type-checks are clean on both sides.

---

## Backend Coverage — File by File

### `src/` (root)

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `container.ts` | 100% | 100% | 100% | 100% | ✅ Full coverage |
| `index.ts` | 57% | 47% | 50% | 59% | Large bootstrap file; many startup paths untested |
| `logger.ts` | 92% | 83% | 50% | 100% | |
| `storage.ts` | 8% | 11% | 8% | 8% | ⚠️ Very low — requires real SQLite file |

### `src/database/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `sqlite-social-store.ts` | 95% | 82% | 93% | 96% | ✅ Well covered |
| `migrations/003-agent-identity.ts` | 90% | 0% | 100% | 90% | Branch untested |

### `src/queues/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `connection.ts` | 20% | 0% | 50% | 20% | ⚠️ Requires live Redis |
| `tournament.queue.ts` | 41% | 0% | 0% | 41% | ⚠️ Requires live Redis |
| `scraper.queue.ts` | 41% | 0% | 0% | 41% | ⚠️ Requires live Redis |

### `src/repositories/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `factory.ts` | 71% | 33% | 100% | 71% | |
| `interfaces/sentiment.repository.ts` | 100% | 100% | 100% | 100% | ✅ |
| `adapters/sqlite/index.ts` | 100% | 100% | 100% | 100% | ✅ |
| `adapters/sqlite/sqlite-agent.repository.ts` | 16% | 5% | 22% | 18% | 🔴 Priority |
| `adapters/sqlite/sqlite-backtest.repository.ts` | 16% | 0% | 16% | 18% | 🔴 Priority |
| `adapters/sqlite/sqlite-broker.repository.ts` | 5% | 0% | 7% | 6% | 🔴 Priority |
| `adapters/sqlite/sqlite-sentiment.repository.ts` | 25% | 0% | 20% | 25% | 🔴 Priority |
| `adapters/sqlite/sqlite-social.repository.ts` | 4% | 0% | 5% | 4% | 🔴 Priority |
| `adapters/sqlite/sqlite-tournament.repository.ts` | 22% | 0% | 20% | 22% | 🔴 Priority |

### `src/routes/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `marl-real-trading.ts` | 86% | 100% | 81% | 85% | ✅ Good coverage |
| `social-media.ts` | 67% | 43% | 73% | 67% | Refresh + error paths need expansion |
| `marl-competition.ts` | 56% | 49% | 50% | 57% | BullMQ/QueueEvents paths untested |
| `evolutionary.ts` | 45% | 38% | 61% | 44% | Several mutation/breed endpoints uncovered |
| `agent-stats.ts` | 34% | 9% | 45% | 37% | ⚠️ Low branch coverage |
| `trading.ts` | 34% | 0% | 16% | 34% | ⚠️ No branch coverage |

### `src/services/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `cache.ts` | 100% | 100% | 100% | 100% | ✅ |
| `finbert.ts` | 100% | 100% | 100% | 100% | ✅ |
| `coingecko.ts` | 100% | 81% | 100% | 100% | ✅ |
| `newsapi.ts` | 100% | 62% | 100% | 100% | ✅ |
| `bot-detection.ts` | 97% | 84% | 100% | 100% | ✅ |
| `risk-manager.ts` | 96% | 100% | 88% | 96% | ✅ |
| `trading-service.ts` | 94% | 71% | 100% | 94% | ✅ |
| `crypto-com-exchange.ts` | 91% | 64% | 90% | 92% | ✅ |
| `crypto-com-client.ts` | 87% | 52% | 90% | 89% | ✅ |
| `paper-exchange.ts` | 100% | 69% | 100% | 100% | ✅ |
| `content-signals.ts` | 85% | 50% | 97% | 86% | Branch coverage could improve |
| `onchain.ts` | 83% | 72% | 100% | 82% | |
| `sentiment-analyzer.ts` | 83% | 62% | 78% | 89% | |
| `sentiment.ts` | 85% | 60% | 44% | 89% | Several function overloads uncovered |
| `binance-us-exchange.ts` | 82% | 79% | 86% | 84% | ✅ |
| `marl-competition-engine.ts` | 61% | 45% | 58% | 63% | Live/continuous modes largely untested |
| `pubsub.ts` | 28% | 16% | 12% | 29% | ⚠️ Redis pubsub paths untested |
| `config-service.ts` | 29% | 25% | 30% | 30% | ⚠️ |
| `social-scraper.ts` | 15% | 6% | 23% | 17% | ⚠️ Requires platform credentials |
| `trading-agent.ts` | 9% | 0% | 6% | 11% | 🔴 Very low |
| `trending-topics.ts` | 8% | 0% | 7% | 10% | 🔴 Very low |
| `pre-trainer.ts` | 8% | 0% | 16% | 9% | 🔴 Requires synthetic market setup |
| `synthetic-market-generator.ts` | 1% | 0% | 0% | 1% | 🔴 No meaningful coverage |
| `exchange-factory.ts` | 30% | 20% | 75% | 30% | ⚠️ Credential-gated branches |
| `coinbase-client.ts` | 5% | 0% | 0% | 6% | 🔴 Requires Coinbase credentials |
| `coinbase-exchange.ts` | 3% | 0% | 0% | 3% | 🔴 |

### `src/services/evolutionary/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `agent-genome.ts` | 100% | 100% | 100% | 100% | ✅ |
| `agent-cosmetics-manager.ts` | 100% | 92% | 100% | 100% | ✅ |
| `agent-statistics-manager.ts` | 100% | 62% | 100% | 100% | ✅ |
| `evolutionary-orchestrator.ts` | 81% | 63% | 76% | 81% | |
| `genetic-crossover.ts` | 83% | 61% | 57% | 87% | Some crossover modes uncovered |
| `mutation-engine.ts` | 80% | 66% | 53% | 87% | HEAVY mutation path untested |
| `fitness-calculator.ts` | 80% | 0% | 80% | 85% | |
| `selection-algorithm.ts` | 28% | 0% | 28% | 31% | ⚠️ Selection partitioning untested |

### `src/services/exchange/adapters/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `exchange-adapter.ts` | 100% | 100% | 0% | 100% | |
| `binance-adapter.ts` | 3% | 0% | 0% | 3% | 🔴 Requires Binance credentials |
| `coinbase-adapter.ts` | 6% | 0% | 0% | 7% | 🔴 Requires Coinbase credentials |

### `src/services/brokers/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `alpaca-adapter.ts` | 5% | 0% | 0% | 5% | 🔴 Requires Alpaca credentials |
| `base-broker-adapter.ts` | 3% | 0% | 0% | 4% | 🔴 |
| `broker-factory.ts` | 33% | 0% | 0% | 33% | |
| `broker-registry.ts` | 12% | 0% | 12% | 14% | |

### `src/services/social-media/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `ingest-queue.ts` | 86% | 78% | 87% | 89% | ✅ |
| `scoring/coin-extractor.ts` | 100% | 100% | 100% | 100% | ✅ |
| `scoring/sarcasm-detector.ts` | 100% | 100% | 100% | 100% | ✅ |
| `scoring/text-normalizer.ts` | 100% | 100% | 100% | 100% | ✅ |
| `scoring/item-scorer.ts` | 78% | 54% | 93% | 85% | |
| `scoring/normalize-text.ts` | 90% | 0% | 75% | 100% | |
| `trending/trending-discovery-engine.ts` | 97% | 69% | 100% | 98% | ✅ |
| `trending/multi-source-calculator.ts` | 87% | 72% | 86% | 91% | |
| `scraper/scraper-manager.ts` | 88% | 50% | 78% | 87% | ✅ |
| `scraper/discord-scraper.ts` | 14% | 8% | 22% | 16% | ⚠️ Requires Discord token |
| `scraper/reddit-scraper.ts` | 17% | 16% | 14% | 20% | ⚠️ Requires Reddit credentials |
| `scraper/rss-scraper.ts` | 10% | 3% | 7% | 11% | ⚠️ Network-gated |
| `scraper/telegram-scraper.ts` | 13% | 13% | 14% | 14% | ⚠️ Requires Telegram token |
| `scraper/tiktok-scraper.ts` | 17% | 5% | 12% | 17% | ⚠️ Network-gated |
| `scraper/twitter-scraper.ts` | 19% | 11% | 11% | 21% | ⚠️ Requires Twitter bearer token |
| `scraper/youtube-scraper.ts` | 12% | 5% | 11% | 13% | ⚠️ Requires YouTube API key |

### `src/telemetry/`

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `app-insights-transport.ts` | 36% | 15% | 31% | 36% | ⚠️ Requires App Insights connection string |

---

## Frontend Coverage — File by File

| File | Stmts | Branch | Funcs | Lines | Notes |
|------|------:|-------:|------:|------:|-------|
| `App.tsx` | 66% | 53% | 58% | 69% | Coin detail modal, filter interactions untested |
| `components/AgentManagementDashboard.tsx` | 78% | 59% | 76% | 81% | ✅ Good coverage |
| `components/MarlCompetitionViewer.tsx` | 47% | 37% | 34% | 49% | ⚠️ Many chart/equity-curve paths untested |
| `components/SocialDashboard.tsx` | 2% | 0% | 0% | 2% | 🔴 No meaningful coverage |
| `hooks/useMarlCompetition.ts` | 61% | 34% | 60% | 64% | Polling/retry paths untested |
| `hooks/useSocialMedia.ts` | 0% | 0% | 0% | 0% | 🔴 Zero coverage |

---

## Priority: Where to Write Tests Next

### High Impact / High Feasibility (no external credentials needed)

| Target | Reason | Estimated Effort |
|--------|--------|-----------------|
| `services/synthetic-market-generator.ts` (1%) | Core pre-training dependency; pure deterministic logic | Low |
| `services/pre-trainer.ts` (8%) | Can be tested with mocked `MarlCompetitionEngine` and SQLite in-memory | Medium |
| `services/trending-topics.ts` (8%) | Pure aggregation logic; no external dependencies | Low |
| `services/trading-agent.ts` (9%) | Q-table logic is pure; mock the exchange | Medium |
| `services/selection-algorithm.ts` (28%) | Pure survival partitioning math | Low |
| `repositories/adapters/sqlite/sqlite-social.repository.ts` (4%) | Use in-memory SQLite (already done in other repo tests) | Medium |
| `repositories/adapters/sqlite/sqlite-agent.repository.ts` (16%) | Same pattern as above | Medium |
| `repositories/adapters/sqlite/sqlite-sentiment.repository.ts` (25%) | Same pattern | Low |
| `services/pubsub.ts` (28%) | Mock `ioredis` publisher/subscriber | Medium |
| `queues/connection.ts` (20%) | Mock `ioredis` constructor | Low |
| `routes/trading.ts` (34%) | Straightforward route tests; mock exchange | Low |
| `routes/agent-stats.ts` (34%) | Mock storage + existing route test pattern | Low |
| `frontend: useSocialMedia.ts` (0%) | Mock `fetch`; hook is self-contained | Low |
| `frontend: SocialDashboard.tsx` (2%) | Render with mocked hook | Low |
| `frontend: MarlCompetitionViewer.tsx` (47%) | Expand equity curve / H2H table rendering tests | Medium |

### Low Priority (blocked by external credentials or live infra)

These files require real API keys, a running Redis instance, or live exchange connections. Coverage is expected to remain low without an integration test environment.

- All `scraper/` platform scrapers (Discord, Reddit, Telegram, TikTok, Twitter, YouTube, RSS)
- `services/exchange/coinbase-*`, `adapters/coinbase-adapter.ts`, `adapters/binance-adapter.ts`
- `services/brokers/alpaca-adapter.ts`, `base-broker-adapter.ts`
| `telemetry/app-insights-transport.ts` — requires `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `storage.ts` — full integration requires a real SQLite file path

---

## Running Tests

```bash
# Backend — all tests
cd backend && npm test

# Backend — single file by pattern
npm test -- --testPathPattern=cache

# Backend — with coverage
npx jest --coverage --coverageReporters=text --silent

# Frontend — all tests
cd frontend && npm test

# Frontend — with coverage
npx vitest run --coverage

# Type-checks (run before committing)
cd backend && npm run type-check
cd frontend && npm run type-check
```
