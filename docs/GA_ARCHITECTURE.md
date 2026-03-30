# Genetic Algorithm System — Architecture & Design

This document covers the Phase 1–6 design decisions, component responsibilities, data flow, `GenerationDirective` format, and checkpoint/rollback capabilities of the evolutionary GA system.

---

## Table of Contents

1. [Phase Overview](#phase-overview)
2. [Component Responsibilities](#component-responsibilities)
3. [End-to-End Data Flow](#end-to-end-data-flow)
4. [Agent Genome Schema](#agent-genome-schema)
5. [Fitness Model](#fitness-model)
6. [GenerationDirective Format](#generationdirective-format)
7. [Claude Orchestration](#claude-orchestration)
8. [Checkpoint & Rollback](#checkpoint--rollback)
9. [Lineage Tracking](#lineage-tracking)
10. [Adversarial Training](#adversarial-training)
11. [Database Tables](#database-tables)
12. [Event Bus](#event-bus)

---

## Phase Overview

| Phase | Component | Purpose |
|-------|-----------|---------|
| 1 | `MarlCompetitionEngine` | Multi-agent RL competition — runs the actual trading simulation each generation |
| 2.1 | `EvolutionaryOrchestrator` | Background tournament loop, wires all GA sub-systems |
| 2.2 | `AgentGenome` / `GenomeManager` | Heritable trait schema + SQLite CRUD |
| 2.3 | `GeneticCrossover` | UNIFORM / BLENDED offspring breeding |
| 2.4 | `MutationEngine` | LIGHT / MEDIUM / HEAVY stochastic gene mutation |
| 3.1 | `FitnessCalculator` | 0–100 composite fitness scoring |
| 3.2 | `SelectionAlgorithm` | Survivor / retirement partitioning |
| 4 | `ClaudeGAOrchestrator` | Claude API-driven adaptive parameter selection between generations |
| 5 | `GAEventBus` | Typed lifecycle events for observability |
| 5.1 | `GenerationResultStore` | Checkpoint + extended lineage persistence (enables rollback) |
| 6 | `AdversarialTrainer` | Adversary agents that stress-test the population |

---

## Component Responsibilities

### EvolutionaryOrchestrator

The top-level orchestrator executes the tournament loop:

```
startTournament(config)
  └─ initialise population (GenomeManager.registerNewAgent × N)
  └─ for each generation:
       1. run MarlCompetitionEngine → record results
       2. FitnessCalculator.rankAgents()
       3. SelectionAlgorithm.selectTopPercent()
       4. GeneticCrossover.breedPopulation() → new offspring
       5. MutationEngine.mutate() on some offspring
       6. (optional) AdversarialTrainer round
       7. (optional) ClaudeGAOrchestrator.decideNextGeneration()
       8. GenerationResultStore.saveCheckpoint()
       9. persist summary → evolutionary_tournaments
       10. gaEventBus.emit('generation:complete')
```

Status is persisted to `evolutionary_tournaments` as a JSON snapshot — the server can restart mid-tournament and resume from the last saved generation.

### GenomeManager

- Registers new agents in `agent_registry`
- Upserts genomes in `agent_genomes` (JSON blob)
- Provides `clone()`, `setGene()`, `loadGenome()`, `saveGenome()`

### GeneticCrossover

Breeds two parent agents and writes a genealogy record:

- **UNIFORM**: each numeric gene independently inherits from parent1 or parent2 (50/50)
- **BLENDED**: offspring gene = arithmetic mean of both parents (good when both are strong)
- **Policy-weight crossover**: element-wise uniform selection across neural network weights
- **Architecture crossover**: HYBRID offspring when parents have different model architectures

### MutationEngine

Applies stochastic variation _after_ crossover:

| Severity | Genes mutated | Drift factor | Weight noise std-dev |
|----------|---------------|--------------|----------------------|
| LIGHT    | 2             | ±10 %        | 0.01                 |
| MEDIUM   | 4             | ±20 %        | 0.05                 |
| HEAVY    | 7             | ±40 %        | 0.10                 |

- Continuous genes use multiplicative drift: `value × Uniform(1−d, 1+d)`
- Threshold genes (`entryThreshold`, `exitThreshold`) use additive shift
- 5–10 % random-reset chance per selected gene to prevent local optima lock-in
- All mutations are clamped to `GENE_BOUNDS`

### FitnessCalculator

```
fitness = (0.40 × win_rate_pct)
        + (0.35 × sharpe_normalized)   // sharpe (-2…+5) → (0…100)
        + (0.25 × pnl_percentile)      // PnL rank among all agents → (0…100)
```

Special cases:
- **ADVERSARY agents**: score is inverted — `100 − raw` — so their reward opposes sentiment agents
- **Sentiment agents that beat an adversary**: `raw × 1.1`, capped at 100

### SelectionAlgorithm

Given `survivalPercent` (default 30):

```
top 30%   → survivors (breed offspring for next generation)
bottom 30% → retirement candidates (removed from active pool)
middle 40% → middle tier (retained but not used for breeding)
```

Minimum 1 survivor always guaranteed. Retirement candidates never overlap survivors.

---

## End-to-End Data Flow

```
POST /api/evolutionary/tournament
    │
    ▼
EvolutionaryOrchestrator.startTournament()
    │  creates N agents in agent_registry + agent_genomes
    │  emits gaEventBus 'task:queued'
    │
    ▼  [background async loop]
    │
    ├─ Generation N
    │    MarlCompetitionEngine.runCompetition()
    │      └─ each agent trades → fills agent_competitions rows
    │    AgentStatisticsManager.updateStats()   → agent_statistics rows
    │    FitnessCalculator.rankAgents()         → ranked: AgentStats[]
    │    SelectionAlgorithm.selectTopPercent()  → survivors / retirees / middle
    │    GeneticCrossover.breedPopulation()     → new offspring in agent_registry
    │    MutationEngine.mutate() (per offspring, probabilistic)
    │    [optional] AdversarialTrainer.runRound()
    │    [optional] ClaudeGAOrchestrator.decideNextGeneration()
    │                 └─ returns GenerationDirective (or heuristic fallback)
    │    GenerationResultStore.saveCheckpoint() → generation_checkpoints row
    │    saveLineageEntry() per new agent       → agent_lineage_extended rows
    │    persist JSON snapshot                  → evolutionary_tournaments row
    │    gaEventBus.emit('generation:complete')
    │
    ▼  repeat until maxGenerations or earlyStop
    │
    ▼
status = 'COMPLETED'  (or 'FAILED' on error)
```

---

## Agent Genome Schema

All heritable traits are stored as a JSON blob in `agent_genomes.genome`.

```typescript
interface AgentGenome {
  // Learning hyperparameters
  epsilon:              number;  // [0.01, 0.50]   exploration rate
  learningRate:         number;  // [0.001, 0.10]  policy update rate (alpha)
  gamma:                number;  // [0.90, 0.999]  discount factor
  explorationDecayRate: number;  // [0.990, 0.9999] epsilon decay per step

  // Behavioural thresholds
  entryThreshold:   number;  // [30, 80]   min signal strength to open position
  exitThreshold:    number;  // [20, 70]   min signal to close/exit position
  stopLossPct:      number;  // [1, 15]    stop-loss % of entry price
  takeProfitPct:    number;  // [3, 30]    take-profit % of entry price
  positionSizePct:  number;  // [5, 30]    max position size as % of capital
  riskPercent:      number;  // [0.5, 5]   capital risked per trade (%)
  holdDurationMax:  number;  // [1, 20]    max steps to hold (integer)

  // Optional model architecture
  modelArchitecture?:  'LSTM' | 'GAN' | 'TRANSFORMER' | 'HYBRID';
  architectureParams?: LSTMParams | GANParams | TransformerParams;

  // Optional adversarial fields
  agentType?:     'SENTIMENT' | 'ADVERSARY';
  targetAgentId?: string;  // adversary agents only

  // Optional policy weights (neural network state for crossover)
  policyWeights?: PolicyWeights;
}
```

Adversary agents use inverted bounds (e.g. `entryThreshold: [20, 50]`, `exitThreshold: [60, 90]`) to produce counter-strategies that stress-test the population.

---

## Fitness Model

The three components are normalised to 0–100 before weighting:

| Component | Weight | Normalisation |
|-----------|--------|---------------|
| Win rate % | 40 % | Direct (already 0–100) |
| Sharpe ratio | 35 % | Linear map from [−2, +5] → [0, 100] |
| PnL | 25 % | Percentile rank among all agents → [0, 100] |

A population of 1 agent receives a PnL percentile of 50 (neutral) to avoid penalising single-agent scenarios.

---

## GenerationDirective Format

After each generation completes, `ClaudeGAOrchestrator.decideNextGeneration()` is called (when `claudeOrchestrated: true`). Claude receives a `PopulationReport` and returns a `GenerationDirective`:

```typescript
interface GenerationDirective {
  generation: number;            // the generation this directive governs

  mutationSeverity: 'LIGHT' | 'MEDIUM' | 'HEAVY';
  // LIGHT  → preserve high-fitness gene patterns (top fitness > 75)
  // MEDIUM → balanced exploration vs exploitation
  // HEAVY  → aggressive exploration when population is stagnating / low diversity

  survivalPercent: number;       // 1–100; default 30
  // Lower = stronger selection pressure (more offspring from fewer survivors)
  // Higher = more diversity retained from the middle tier

  crossoverStrategy: 'UNIFORM' | 'BLENDED';
  // UNIFORM → each gene randomly from one parent (good for diverse parents)
  // BLENDED → arithmetic mean of parents (good when both parents are strong)

  targetPopulationSize?: number; // optional resize for next generation (min 4)

  earlyStopIfFitnessAbove?: number; // 0–100; halt if any agent exceeds this

  diversityBoost: boolean;       // inject fresh random agents alongside offspring

  reasoning: string;             // Claude's explanation of choices
}
```

### Example: Generation 3 (Low Diversity)

```json
{
  "generation": 3,
  "mutationSeverity": "HEAVY",
  "survivalPercent": 40,
  "crossoverStrategy": "UNIFORM",
  "targetPopulationSize": null,
  "earlyStopIfFitnessAbove": null,
  "diversityBoost": true,
  "reasoning": "Population has converged early with stdDev=2.1 and mean fitness trend of -3.4 over two generations. Applying HEAVY mutation and diversityBoost to escape local optima. Increasing survivalPercent to 40 to preserve the gains of the top 4 agents while injecting fresh genetic material."
}
```

### Example: Generation 7 (Strong Performance)

```json
{
  "generation": 7,
  "mutationSeverity": "LIGHT",
  "survivalPercent": 25,
  "crossoverStrategy": "BLENDED",
  "targetPopulationSize": null,
  "earlyStopIfFitnessAbove": 90,
  "diversityBoost": false,
  "reasoning": "Top fitness reached 83.2 with a positive trend of +6.8. The top 3 agents are clustered tightly in fitness (stdDev=4.3). Switching to BLENDED crossover to average their strategies and LIGHT mutation to preserve the high-fitness genes. Setting earlyStop=90 to avoid wasting compute if convergence completes early."
}
```

### Heuristic Fallback

When the Claude API is unavailable, `buildDefaultDirective()` applies these rules:
- `max fitness > 75` → LIGHT mutation
- `trend < −5` or `(stdDev < 5 and generation > 1)` → HEAVY mutation + diversityBoost
- Otherwise → MEDIUM mutation, no diversityBoost

---

## Claude Orchestration

`ClaudeGAOrchestrator` uses the `claude-sonnet-4-6` model (or the value from `CLAUDE_MODEL` app config key).

Prompt structure sent after each generation:
1. Population size, fitness statistics (max/mean/min/stdDev, trend vs previous generation)
2. Top 5 agents with fitness, win rate, Sharpe, PnL
3. Parameter guidelines with valid ranges
4. Instruction to respond with JSON only (no markdown fences)

The directive is validated against expected types and ranges before use. Any parse or validation error falls back to the heuristic defaults — the orchestrator **never throws**.

---

## Checkpoint & Rollback

`GenerationResultStore` persists two types of records to SQLite.

### Generation Checkpoints

```typescript
interface GenerationCheckpoint {
  id:           string;    // UUID
  tournamentId: string;
  generation:   number;    // generation that completed
  population:   string[];  // ordered agent IDs at end-of-generation
  directive?:   GenerationDirective;  // Claude directive that governed this gen
  createdAt:    string;    // ISO timestamp
}
```

Stored in `generation_checkpoints` with a unique constraint on `(tournament_id, generation)`. Re-running a generation overwrites the checkpoint.

### Rollback Workflow

To roll back to generation G:

1. Call `GET /api/evolutionary/tournament/:id` to list checkpoint generations
2. Call `POST /api/evolutionary/tournament/:id/rollback` with `{ generation: G }`
3. The rollback handler:
   - Loads `GenerationResultStore.loadCheckpoint(tournamentId, G)`
   - Retires all agents created after generation G
   - Restores the `population` array as the active agent pool
   - Resets tournament status and `currentGeneration` to G
4. Resume the tournament from generation G+1

### Accessing Checkpoints via MCP

```
get_generation_summary { tournamentId, generation: 3 }
→ returns: { population: [...], directive: {...}, agentFitnesses: [...] }
```

---

## Lineage Tracking

### AgentLineageExtended

```typescript
interface AgentLineageExtended {
  id:             string;
  agentId:        string;
  parentIds:      string[];    // empty for genesis (generation 0) agents
  generation:     number;
  architecture:   AgentGenome; // full genome snapshot at birth
  fitnessAtBirth: number;      // 0 for genesis; filled after first competition
  tournamentId:   string;
  createdAt:      string;
}
```

Stored in `agent_lineage_extended`. After an agent's first competition, `updateFitnessAtBirth()` fills the fitness field.

### Genealogy Table

`agent_genealogy` records crossover details:

- `parent_1_id`, `parent_2_id` — source agents
- `breeding_generation` — when offspring was created
- `inherited_genes` — JSON map: `{ epsilon: 'parent1', learningRate: 'blend', ... }`
- `mutations_applied` — JSON array of `{ param, oldValue, newValue }` records
- `mutation_severity` — 0–1 scalar reflecting total change magnitude
- `offspring_count` — incremented each time an agent is used as a parent

---

## Adversarial Training

When `adversarialTraining: true`, every `adversarialRoundInterval` generations (default 3):

1. `AdversarialTrainer` creates N adversary agents (default 20 % of population)
2. Adversaries have inverted gene bounds — they trade with counter-strategies
3. Each adversary competes against each sentiment agent individually
4. Sentiment agents that outperform at least one adversary receive `beatsAdversary = true`
5. `FitnessCalculator` applies +10 % bonus to their fitness (capped at 100)
6. Adversary fitness is inverted: `100 − raw`
7. Adversary agents are retired after the round (not carried into the next generation)

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `agent_registry` | Agent IDs, type, risk profile, status, generation, parent refs |
| `agent_genomes` | JSON genome blob per agent (upserted) |
| `agent_statistics` | Cumulative metrics: wins, losses, PnL, Sharpe, ROI, trades |
| `agent_competitions` | Per-competition history rows (rank, capital, PnL, trades) |
| `agent_genealogy` | Crossover + mutation records per agent |
| `evolutionary_tournaments` | JSON snapshot of tournament state + all generation summaries |
| `generation_checkpoints` | Population + directive snapshot per generation (for rollback) |
| `agent_lineage_extended` | Rich birth records with genome snapshot + fitness at birth |

---

## Event Bus

`GAEventBus` (singleton `gaEventBus`) emits typed events throughout the lifecycle:

| Event | Payload | When |
|-------|---------|------|
| `task:queued` | tournamentId, name, populationSize, maxGenerations | startTournament() |
| `task:started` | tournamentId, generation, competitionId | before each competition run |
| `task:progress` | tournamentId, generation, competitionId, progress (0–100) | during competition |
| `task:completed` | tournamentId, generation, topFitness, avgFitness | after competition results recorded |
| `generation:complete` | tournamentId, generation, summary | after breeding + checkpoint |
| `convergence:detected` | tournamentId, generation, topFitness, threshold | when earlyStop threshold exceeded |

Subscribe via: `gaEventBus.on('generation:complete', payload => { ... })` — returns an unsubscribe function.
