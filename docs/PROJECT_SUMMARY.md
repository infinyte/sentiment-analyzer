SENTIMENT ANALYZER
CURRENT PROJECT SUMMARY AND REMAINING WORK

Date: June 29, 2026 (updated)
Repository: infinyte/sentiment-analyzer
Branch: main

This document replaces the earlier master-review style summary that treated much of the evolutionary system as planned work. The repository has moved past that state. Use this file as the current high-level status reference.

---

CURRENT STATUS

Overall state: Core platform implemented, validated, and usable for active development.

Implemented areas:
- Advanced sentiment analysis modes and backtesting
- Social-media ingestion, scoring, trending, and hourly refresh flows
- MARL competition engine and tournament APIs
- Real trading service with Crypto.com, Binance.US, Coinbase, and Alpaca adapters, plus zero-risk paper and fee-realistic paper exchanges
- Evolutionary backend primitives, tournament orchestration, Claude-driven generation directives, and adversarial training
- Agent identity, cosmetics, statistics, history, genome, and genealogy APIs
- Live agent pipeline (Phases 3–7): single-cycle trading orchestrator, continuous shadow harness with an SSE live feed, walk-forward validation, net-of-fees expectancy analytics, and a MARL policy feeder that maps the best evolved genome onto the live policy
- Tournament scheduling and live pause/resume/stop control with SSE streams
- DI container (tsyringe) + repository layer refactor of the backend bootstrap
- Two GA MCP servers (genetic-ops, agent-manager) exposing evolutionary operations to MCP clients
- Frontend surface across Dashboard/Sentiment Lab, Agents, MARL Competition, Social Intel, Backtesting, Trading, Shadow Live, Admin, and Tournaments tabs

Primary remaining work:
- Deeper evolutionary analytics dashboards (population movement, fitness distribution)
- Hardening the live pipeline toward real-capital readiness (the shadow/expectancy/walk-forward loop currently runs on paper)
- Ongoing docs alignment so summary, README, and contributor docs describe the same current system

---

IMPLEMENTED CAPABILITIES

1. Sentiment and trading analysis
- Local analysis modes: BASIC, ADVANCED, TRADING_SIGNALS, SMART
- Trading agent configuration and historical backtesting
- Cached sentiment API, rankings, and detail views

Key backend files:
- backend/src/services/sentiment-analyzer.ts
- backend/src/services/backtesting-engine.ts
- backend/src/app.ts (Express app + core routes; bootstrapped by index.ts → lifecycle.ts)

2. Social-media intelligence
- Multi-source scraping and ingestion
- Per-item scoring with language detection and sarcasm handling
- Trending-topic persistence and historical trend calculations
- Event-driven ingest queue and refresh orchestration

Key backend files:
- backend/src/services/social-media/scraper/
- backend/src/services/social-media/scoring/
- backend/src/services/social-media/trending/
- backend/src/database/sqlite-social-store.ts

3. MARL competition system
- Competition start, status, and results endpoints
- Learning-state persistence across runs
- Broker credential flow and real-trading route surface
- Regression coverage for non-zero trade execution in full tournaments

Key backend files:
- backend/src/services/marl-competition-engine.ts
- backend/src/routes/marl-competition.ts
- backend/src/routes/marl-real-trading.ts
- backend/src/__tests__/services/marl-competition-engine.test.ts

4. Exchange and trading layer
- Crypto.com REST v2 adapter (default provider)
- Binance.US adapter
- Coinbase Advanced Trade API v3 adapter
- Paper trading exchange for safe simulation
- TradingService safety guards for max loss, max positions, position size, and minimum notional

Key backend files:
- backend/src/services/exchange/crypto-com-client.ts
- backend/src/services/exchange/crypto-com-exchange.ts
- backend/src/services/exchange/binance-us-exchange.ts
- backend/src/services/exchange/coinbase-client.ts
- backend/src/services/exchange/coinbase-exchange.ts
- backend/src/services/exchange/paper-exchange.ts
- backend/src/services/exchange/exchange-factory.ts
- backend/src/services/exchange/trading-service.ts

7. Agent pre-training
- SyntheticMarketGenerator: 5 configurable market regimes for synthetic price series
- PreTrainer: runs agents through offline episodes, builds Q-table and policy weights
- POST /api/marl/agents/:agentId/pretrain endpoint with convergence curve output
- Pre-training is additive across calls (loads prior state, continues training)

Key backend files:
- backend/src/services/synthetic-market-generator.ts
- backend/src/services/pre-trainer.ts

5. Evolutionary backend
- Genome persistence
- Crossover and mutation engines
- Fitness calculation and selection algorithm
- Multi-generation tournament orchestration
- Breed endpoint and tournament listing/detail endpoints
- Agent statistics persistence and genealogy retrieval

Key backend files:
- backend/src/services/evolutionary/agent-genome.ts
- backend/src/services/evolutionary/genetic-crossover.ts
- backend/src/services/evolutionary/mutation-engine.ts
- backend/src/services/evolutionary/fitness-calculator.ts
- backend/src/services/evolutionary/selection-algorithm.ts
- backend/src/services/evolutionary/evolutionary-orchestrator.ts
- backend/src/services/evolutionary/agent-cosmetics-manager.ts
- backend/src/services/evolutionary/agent-statistics-manager.ts
- backend/src/routes/evolutionary.ts
- backend/src/routes/agent-stats.ts

6. Frontend workflow coverage
- Dashboard Sentiment Lab, sentiment refresh action, and global health indicator integrated into `App.tsx`
- Dedicated Backtesting tab with test-id persistence and stored-result reloads
- MARL viewer enhancements for info discovery and historical equity recovery
- Social dashboard manual refresh and item-level detail inspection
- Agent-management view remains integrated into the main shell with registry, leaderboard, customization, and evolutionary controls
- Frontend tests now cover App, MARL viewer, Social dashboard, and Agent Management flows

Key frontend files:
- frontend/src/App.tsx
- frontend/src/components/MarlCompetitionViewer.tsx
- frontend/src/components/SocialDashboard.tsx
- frontend/src/components/AgentManagementDashboard.tsx
- frontend/src/__tests__/App.test.tsx
- frontend/src/__tests__/MarlCompetitionViewer.test.tsx
- frontend/src/__tests__/SocialDashboard.test.tsx
- frontend/src/__tests__/AgentManagementDashboard.test.tsx

8. Live agent pipeline (Phases 3–7)
- Phase 3: TradingAgentOrchestrator runs a single decision cycle (signal → transparent policy → safety-guarded TradingService → shared exchange); pluggable Static/Sentiment signal sources
- Phase 4: ShadowHarness drives the orchestrator on a fixed interval (overlap-guarded, in-memory ring buffer) so a track record accrues with no human in the loop
- Phase 5: walk-forward validation rolls IS/OOS windows, optimizing the policy on IS and scoring it net-of-fees on the unseen OOS window; reports walk-forward efficiency
- Phase 6: SSE live feed (/api/shadow/stream) consumed by the Shadow Live tab
- Phase 7: MarlPolicyFeeder maps the best evolved genome onto live PolicyParams (entryThreshold→minStrength, positionSizePct→tradeFraction)
- Net-of-fees expectancy analytics (/api/paper/*) measure win rate, expectancy, profit factor, Sharpe/Sortino, drawdown, and fee drag from FIFO round-trip reconstruction

Key backend files:
- backend/src/services/agent/trading-orchestrator.ts
- backend/src/services/agent/shadow-harness.ts
- backend/src/services/agent/marl-policy-feeder.ts
- backend/src/services/analytics/walk-forward.ts
- backend/src/services/analytics/expectancy.ts
- backend/src/services/exchange/realistic-paper-exchange.ts
- backend/src/routes/agent-orchestrator.ts
- backend/src/routes/shadow-harness.ts
- backend/src/routes/walk-forward.ts
- backend/src/routes/paper-analytics.ts
- frontend/src/components/ShadowHarnessDashboard.tsx

---

WHAT WAS PREVIOUSLY STALE

The earlier summary was no longer accurate in these areas:
- It described most evolutionary backend work as prompt-ready rather than implemented.
- It described MARL trade execution as unresolved even though the current tests cover non-zero trade execution.
- It described agent-state persistence as unverified even though orchestration tests now verify statistics and competition-history persistence.
- It treated Crypto.com integration and the agent management UI as future work, even though both are already present in the repo.

---

WHAT REMAINS GENUINELY UNFINISHED

1. Evolutionary frontend visualizations
- Lineage is now navigable (interactive parent-agent exploration) and first-pass generation/tournament fitness trends are rendered, but there is still no full free-form genealogy tree explorer.
- There is no dedicated standalone evolution workspace for generation-over-generation population movement or fitness-distribution analysis.
- Competition-history and genome data are visible, but deeper analytical visualizations remain a gap.

2. Focused evolutionary documentation
- The backend and APIs are ahead of the docs.
- There is no concise, current document that explains the evolutionary workflow end-to-end for maintainers and users.
- README and contributor guidance should be aligned with the newer agent-management and evolutionary UI/backend surface.

3. Optional product polish
- Better visual differentiation for lineage and generation relationships
- More explicit tournament summaries in the frontend
- Additional UX around breeding, retirement, and population-level analysis if those workflows are intended to be operator-facing

---

REMAINING-WORK CHECKLIST

Priority 1: Correct the docs
- [x] Replace the stale project summary with a current-state document
- [x] Update README.md to reflect the current frontend surface area and Phase 1 parity work clearly
- [x] Update CLAUDE.md so contributor guidance matches current architecture and frontend capabilities
- [x] Add a dedicated evolution-focused doc describing tourn