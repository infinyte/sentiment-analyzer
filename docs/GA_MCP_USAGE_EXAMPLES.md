# GA Operations via Claude Code — MCP Usage Examples

This guide shows how to use the two GA MCP servers from Claude Code (or any MCP client) to manually manage the evolutionary agent population, inspect generation state, and perform manual breeding operations.

---

## Prerequisites

Both MCP servers must be registered in `.claude/settings.json` (or `settings.local.json`):

```json
{
  "mcpServers": {
    "genetic-ops": {
      "command": "npm",
      "args": ["run", "--prefix", "backend", "dev:mcp:genetic-ops"],
      "env": { "DB_PATH": "./backend/sentiment_analyzer.db" }
    },
    "agent-manager": {
      "command": "npm",
      "args": ["run", "--prefix", "backend", "dev:mcp:agent-manager"],
      "env": { "DB_PATH": "./backend/sentiment_analyzer.db" }
    }
  }
}
```

The database file must exist and contain the `agent_registry`, `agent_genomes`, `agent_statistics`, and `generation_checkpoints` tables (created automatically by the backend's `StorageService`).

---

## genetic-ops Tools

### `mutate_agent` — Apply Stochastic Mutation

Mutates an agent's genome in-place and returns the changed parameters.

**Schema:**
```
agentId:  string   (required) — UUID from agent_registry
severity: 'LIGHT' | 'MEDIUM' | 'HEAVY'  (default: 'MEDIUM')
```

**Example — apply HEAVY mutation to a stagnant agent:**
```
mutate_agent { agentId: "abc123", severity: "HEAVY" }
```

**Example response:**
```json
{
  "agentId": "abc123",
  "severity": "HEAVY",
  "changedParams": [
    { "param": "epsilon",        "oldValue": 0.10, "newValue": 0.18 },
    { "param": "entryThreshold", "oldValue": 55,   "newValue": 71   },
    { "param": "stopLossPct",    "oldValue": 5,    "newValue": 2    }
  ],
  "mutationSeverity": 0.34
}
```

**When to use:**
- Manually diversify an agent that has stopped improving
- Test how a specific genome responds to large mutations
- Inject variation into a converged population without breeding

---

### `crossover_agents` — Breed Two Parents

Creates an offspring agent combining genome traits from two parents.

**Schema:**
```
parent1Id: string   (required)
parent2Id: string   (required)
strategy:  'UNIFORM' | 'BLENDED'  (default: 'UNIFORM')
```

**Example — breed top two agents with BLENDED strategy:**
```
crossover_agents { parent1Id: "abc123", parent2Id: "def456", strategy: "BLENDED" }
```

**Example response:**
```json
{
  "offspringId": "new-uuid-789",
  "generationNumber": 4,
  "inheritanceMap": {
    "epsilon":        "blend",
    "learningRate":   "blend",
    "entryThreshold": "blend",
    "stopLossPct":    "blend"
  },
  "genome": {
    "epsilon": 0.125,
    "learningRate": 0.0075,
    "entryThreshold": 62.5,
    "stopLossPct": 7.5
  }
}
```

**When to use:**
- Manually combine the best traits from two top performers
- Create targeted offspring for a specific competition
- Seed a new tournament generation with a hand-crafted starting population

---

### `evaluate_fitness` — Score an Agent

Computes the 0–100 composite fitness for any agent given its stored statistics.

**Schema:**
```
agentId:            string    (required)
includePopulation?: boolean   — if true, loads all active agents to compute relative PnL rank
```

**Example — evaluate a single agent:**
```
evaluate_fitness { agentId: "abc123", includePopulation: true }
```

**Example response:**
```json
{
  "agentId": "abc123",
  "fitness": 73.2,
  "rank": 2,
  "populationSize": 12,
  "breakdown": {
    "winRateComponent": 34.0,
    "sharpeComponent": 28.7,
    "pnlComponent": 10.5
  }
}
```

**When to use:**
- Assess an agent's current fitness without running a competition
- Compare manual agents against the automated population
- Debug why an agent's fitness is unexpectedly high or low

---

### `select_population` — Partition Survivors and Retirees

Runs the selection algorithm against a set of agent IDs.

**Schema:**
```
agentIds:        string[]  (required) — list of agent UUIDs
survivalPercent: number    (default: 30) — 1–99; top N% become survivors
```

**Example — select from 10 agents with 20 % survival pressure:**
```
select_population { agentIds: ["a1", "a2", ..., "a10"], survivalPercent: 20 }
```

**Example response:**
```json
{
  "survivors": [
    { "agentId": "a1", "fitness": 81.2 },
    { "agentId": "a3", "fitness": 74.5 }
  ],
  "retirementCandidates": [
    { "agentId": "a9", "fitness": 12.1 },
    { "agentId": "a10", "fitness": 8.3 }
  ],
  "middleTier": [
    { "agentId": "a2", "fitness": 61.0 },
    ...
  ]
}
```

**When to use:**
- Preview which agents would survive before committing a tournament round
- Manually curate a population by adjusting survival pressure
- Understand why specific agents are being retired

---

### `get_generation_summary` — Inspect a Generation Checkpoint

Returns the population snapshot + Claude directive stored at the end of a generation.

**Schema:**
```
tournamentId: string   (required)
generation?:  number   — specific generation to load; defaults to latest
```

**Example — inspect generation 3 of a tournament:**
```
get_generation_summary { tournamentId: "tour-xyz", generation: 3 }
```

**Example response:**
```json
{
  "tournamentId": "tour-xyz",
  "generation": 3,
  "population": ["a1", "a3", "a7", "a11"],
  "agentFitnesses": [
    { "agentId": "a1", "fitness": 81.2, "winRate": 68, "sharpe": 1.8, "pnl": 1240 },
    { "agentId": "a3", "fitness": 74.5, "winRate": 55, "sharpe": 1.2, "pnl":  890 }
  ],
  "directive": {
    "mutationSeverity": "LIGHT",
    "survivalPercent": 30,
    "crossoverStrategy": "BLENDED",
    "diversityBoost": false,
    "reasoning": "Top fitness 81.2 warrants preservation..."
  },
  "createdAt": "2026-03-15T14:22:31Z"
}
```

**When to use:**
- Inspect the Claude directive that governed a specific generation
- View which agents survived a generation for genealogy analysis
- Cross-reference with competition results to understand selection outcomes

---

## agent-manager Tools

### `register_agent` — Create a New Agent

Registers a new agent in the pool with optional genome overrides.

**Schema:**
```
agentType?:        'ML_BASED' | 'RULE_BASED'  (default: 'ML_BASED')
riskProfile?:      'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING'  (default: 'CONSERVATIVE')
genomeOverrides?:  Partial<AgentGenome>  — override specific genome parameters
parentId1?:        string   — first parent ID (for lineage tracking)
parentId2?:        string   — second parent ID
generationNumber?: number   (default: 0)
```

**Example — create a hand-crafted aggressive agent:**
```
register_agent {
  riskProfile: "AGGRESSIVE",
  genomeOverrides: {
    epsilon: 0.05,
    entryThreshold: 40,
    positionSizePct: 25,
    takeProfitPct: 20
  }
}
```

**Example response:**
```json
{
  "agentId": "new-uuid-abc",
  "status": "ACTIVE",
  "genome": {
    "epsilon": 0.05,
    "learningRate": 0.01,
    "entryThreshold": 40,
    ...
  }
}
```

**When to use:**
- Seed a population with domain-knowledge-informed starting parameters
- Create a reference agent to benchmark against the automated population
- Register manually-designed adversary agents for targeted stress tests

---

### `get_agent_health` — Full Agent Diagnostics

Returns lifetime statistics, genome, and fitness score for one agent.

**Schema:**
```
agentId: string  (required)
```

**Example:**
```
get_agent_health { agentId: "abc123" }
```

**Example response:**
```json
{
  "agentId": "abc123",
  "status": "ACTIVE",
  "riskProfile": "CONSERVATIVE",
  "generationNumber": 3,
  "stats": {
    "totalCompetitions": 8,
    "totalWins": 5,
    "winRatePercent": 62.5,
    "totalPnl": 1890.50,
    "sharpeRatio": 1.72,
    "maxDrawdownPercent": 8.3,
    "tradesExecuted": 142
  },
  "genome": {
    "epsilon": 0.08,
    "entryThreshold": 62,
    ...
  },
  "fitness": 76.4
}
```

**When to use:**
- Assess whether an agent is healthy before including it in a manual breed
- Monitor long-running agents for performance regression
- Debug unexpectedly poor fitness scores by inspecting the full genome

---

### `assign_task` — Queue a Competition Task

Builds a competition specification for one or more agents to execute next.

**Schema:**
```
agentIds:  string[]  (required) — agents to include in the competition
symbols:   string[]  (required) — crypto symbols to trade (e.g. ["BTC","ETH"])
duration:  number    (default: 200) — simulation steps
```

**Example — assign BTC/ETH competition to top performers:**
```
assign_task {
  agentIds: ["abc123", "def456", "ghi789"],
  symbols: ["BTC", "ETH", "SOL"],
  duration: 300
}
```

**Example response:**
```json
{
  "taskId": "task-uuid-xxx",
  "status": "ASSIGNED",
  "competitionSpec": {
    "agents": ["abc123", "def456", "ghi789"],
    "symbols": ["BTC", "ETH", "SOL"],
    "duration": 300,
    "mode": "SINGLE"
  }
}
```

**When to use:**
- Manually trigger a one-off competition between specific agents
- Create a benchmark competition to evaluate a newly bred offspring
- Warm up agents with a targeted symbol set before an evolutionary tournament

---

### `collect_results` — Retrieve Competition History

Returns recent competition results for an agent, newest first.

**Schema:**
```
agentId: string  (required)
limit?:  number  (default: 10, max: 100)
```

**Example:**
```
collect_results { agentId: "abc123", limit: 5 }
```

**Example response:**
```json
{
  "agentId": "abc123",
  "results": [
    {
      "competitionId": "comp-001",
      "rankPosition": 1,
      "startingCapital": 10000,
      "endingCapital": 11240,
      "pnl": 1240,
      "tradesCount": 18,
      "winTrades": 12,
      "lossTrades": 6,
      "sharpeRatio": 1.72,
      "completedAt": "2026-03-14T09:12:00Z"
    }
  ]
}
```

**When to use:**
- Audit an agent's recent performance before including it in breeding
- Verify that a manually assigned task completed successfully
- Build a performance narrative when explaining agent genealogy

---

### `get_pool_status` — Full Population Snapshot

Lists all active agents ranked by fitness.

**Schema:**
```
includeRetired?: boolean  (default: false)
filterType?:     'ML_BASED' | 'RULE_BASED' | 'ADVERSARY' | 'all'  (default: 'all')
```

**Example — view all active ML agents by fitness:**
```
get_pool_status { filterType: "ML_BASED" }
```

**Example response:**
```json
{
  "activeCount": 8,
  "retiredCount": 4,
  "agents": [
    { "agentId": "abc123", "fitness": 81.2, "riskProfile": "AGGRESSIVE",   "generation": 4, "winRate": 68 },
    { "agentId": "def456", "fitness": 74.5, "riskProfile": "CONSERVATIVE", "generation": 3, "winRate": 55 },
    ...
  ]
}
```

**When to use:**
- Get a current leaderboard without opening the UI
- Identify the best survivors before starting a manual breed cycle
- Check generation diversity (how many generation-0 seed agents remain vs offspring)

---

## Worked Example: Manual One-Generation Cycle

This example shows how to manually run one evolutionary cycle using Claude Code:

```
1. Inspect current pool
   get_pool_status {}
   → identifies top 3 agents: abc123 (81.2), def456 (74.5), ghi789 (68.1)

2. Select survivors (top 30 % of pool of 10)
   select_population { agentIds: [...10 agent IDs...], survivalPercent: 30 }
   → survivors: [abc123, def456, ghi789]
   → retirees:  [poor1, poor2, poor3]

3. Breed offspring
   crossover_agents { parent1Id: "abc123", parent2Id: "def456", strategy: "BLENDED" }
   → offspringId: new001

   crossover_agents { parent1Id: "abc123", parent2Id: "ghi789", strategy: "UNIFORM" }
   → offspringId: new002

4. Mutate offspring
   mutate_agent { agentId: "new001", severity: "LIGHT" }
   mutate_agent { agentId: "new002", severity: "MEDIUM" }

5. Check new agent health
   get_agent_health { agentId: "new001" }

6. Assign competition
   assign_task { agentIds: ["abc123", "def456", "new001", "new002"], symbols: ["BTC","ETH"], duration: 200 }

7. Collect results after competition
   collect_results { agentId: "new001", limit: 1 }
   collect_results { agentId: "new002", limit: 1 }
```
