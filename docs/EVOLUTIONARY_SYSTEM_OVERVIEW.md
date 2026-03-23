# Evolutionary System Overview

Date: March 19, 2026

This document describes the current state of the evolutionary agent system in the repository. It is intended to be the concise maintainer-facing overview that sits between the top-level README and the implementation details in the backend services.

## Purpose

The evolutionary layer sits on top of the MARL competition engine. Its job is to:

- register and persist heritable agent genomes
- run repeated competitions across generations
- score each generation with a fitness model
- keep the strongest agents, retire the weakest, and breed replacements
- persist history so the frontend can inspect lineage, stats, and tournament progress

The result is a system where tournament outcomes feed future populations instead of treating each competition as an isolated run.

## Core Flow

1. A tournament is started with `POST /api/evolutionary/tournament`.
2. `EvolutionaryOrchestrator` creates an initial population and initializes stats rows.
3. Each generation runs a MARL competition through `MarlCompetitionEngine`.
   - When `REDIS_URL` is configured, SIMULATED competitions are enqueued to the BullMQ `tournament` queue and processed by the stand-alone tournament worker process (`workers/tournament-worker-process.ts`). Progress and completion events are published via Redis pubsub and bridged back to the in-process competition record by a `QueueEvents` listener in `routes/marl-competition.ts`.
   - When `REDIS_URL` is not set, competitions fall back to Worker Threads (in-process), preserving the original behavior.
4. Competition results are persisted to `agent_statistics` and `agent_competitions`.
5. `FitnessCalculator` ranks the population.
6. `SelectionAlgorithm` partitions the population into survivors, middle tier, and retirement candidates.
7. `GeneticCrossover` breeds offspring from the survivor pool.
8. `MutationEngine` applies stochastic mutation to offspring genomes.
9. The orchestrator persists a generation summary into the tournament record.
10. The next generation runs until `maxGenerations` is reached or the tournament fails.

## Main Backend Files

- `backend/src/services/evolutionary/evolutionary-orchestrator.ts`
- `backend/src/services/evolutionary/agent-genome.ts`
- `backend/src/services/evolutionary/genetic-crossover.ts`
- `backend/src/services/evolutionary/mutation-engine.ts`
- `backend/src/services/evolutionary/fitness-calculator.ts`
- `backend/src/services/evolutionary/selection-algorithm.ts`
- `backend/src/services/evolutionary/agent-cosmetics-manager.ts`
- `backend/src/services/evolutionary/agent-statistics-manager.ts`
- `backend/src/routes/evolutionary.ts`
- `backend/src/routes/agent-stats.ts`

## Route Surface

### Tournament control

- `POST /api/evolutionary/tournament`
  Starts a background multi-generation tournament and returns `202` with a `tournamentId`.

- `GET /api/evolutionary/tournament`
  Lists persisted tournaments with lightweight metadata.

- `GET /api/evolutionary/tournament/:id`
  Returns the full tournament record including generation summaries.

- `GET /api/evolutionary/summary`
  Returns dashboard-oriented aggregates for recent tournament history and the latest generation fitness timeline.

### Agent evolution support

- `POST /api/evolutionary/breed`
  Breeds selected active parents into new offspring and persists stats, genome, and genealogy rows.

- `GET /api/agents/:id/genome`
  Returns the persisted genome for an agent.

- `GET /api/agents/:id/genealogy`
  Returns genealogy records for an agent.

- `GET /api/agents`
- `GET /api/agents/stats/leaderboard`
- `GET /api/agents/:id`
- `PUT /api/agents/:id/customize`
- `POST /api/agents/:id/retire`
- `GET /api/agents/:id/history`

These identity and stats routes are what the frontend uses for the agent-management dashboard.

## Persistent Tables

### `agent_registry`

Stores the active and retired population, generation number, risk profile, and parent references.

### `agent_genomes`

Stores the heritable parameter set for each agent.

### `agent_genealogy`

Stores parent relationships, inheritance metadata, mutation logs, and offspring counts.

### `agent_statistics`

Stores cumulative agent-level metrics such as competitions, wins, losses, PnL, Sharpe, ROI, and trade counts.

### `agent_competitions`

Stores per-competition history for each agent.

### `evolutionary_tournaments`

Stores serialized tournament records so generation progress survives process restarts as snapshots.

## Frontend Data Flow

The current frontend implementation lives in:

- `frontend/src/components/AgentManagementDashboard.tsx`

It currently uses these API groups:

- registry and leaderboard: `/api/agents`, `/api/agents/stats/leaderboard`
- selected-agent detail: `/api/agents/:id`, `/history`, `/genome`, `/genealogy`
- manual evolution action: `POST /api/evolutionary/breed`
- tournament summary data: `GET /api/evolutionary/summary`

The dashboard refreshes overview and selected-agent data every 5 seconds so competition-driven state changes can appear without manual reloads.

## Current UI Coverage

Implemented now:

- active-agent registry with filtering and sorting
- leaderboard and population metrics
- breeding-pool selection and child creation
- retirement flow for culling agents
- selected-agent stats, history, genome snapshot, and genealogy
- compact lineage tree for the selected agent with parent-agent navigation
- generation trend panel derived from current registry state
- recent tournament history and latest-tournament fitness distribution derived from persisted tournament summaries
- tournament detail drill-down for the selected persisted tournament via `GET /api/evolutionary/tournament/:id`
- cross-tournament comparison metrics derived from `GET /api/evolutionary/summary`

Still intentionally lightweight:

- no full free-form genealogy explorer
- no histogram or scatterplot for full population fitness distribution across runs
- no separate page for evolutionary analytics outside the existing agent dashboard

## Testing Coverage

High-value current coverage includes:

- `backend/src/__tests__/services/evolutionary/evolutionary-orchestrator.test.ts`
  Verifies completed tournaments persist agent statistics and competition history.

- `backend/src/__tests__/api/evolutionary-summary.test.ts`
  Verifies the dashboard summary endpoint aggregates tournament history and generation timelines correctly.

- `backend/src/__tests__/api/agent-management-actions.test.ts`
  Verifies selective breeding and retirement routes persist the expected rows.

- `frontend/src/__tests__/AgentManagementDashboard.test.tsx`
  Verifies the dashboard renders and exercises customization, breeding, retirement, and evolutionary UI sections.

## Operational Notes

- Tournament execution is background and fire-and-forget from the API caller’s perspective.- When `REDIS_URL` is set, SIMULATED tournament jobs are offloaded to the `tournament-worker-process`. The API process tracks job state via `QueueEvents`; poll `GET /api/marl/competition/:id/status` as normal.
- When `REDIS_URL` is not set, all tournament work runs inside Worker Threads in the API process. Behavior is identical from the caller's perspective.- The summary endpoint is intended for dashboards, not detailed forensic analysis.
- The system currently uses persisted tournament snapshots rather than live-streaming generation events to the client.

## Remaining Gaps

The main missing pieces are now product-facing rather than foundational:

- richer interactive lineage visualization
- broader tournament analytics in the UI
- optional API endpoints for deeper historical analysis if the frontend needs more than the current summary model

The backend foundation for evolutionary work is already present. Future work should focus on presentation, operator workflows, and documentation quality rather than rebuilding the core orchestration layer.