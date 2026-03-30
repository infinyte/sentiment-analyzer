# GA Orchestration — Troubleshooting Guide

Common issues encountered when running evolutionary tournaments and how to resolve them.

---

## Table of Contents

1. [Tournament Stalls / Never Completes](#tournament-stalls--never-completes)
2. [Claude Directive Errors (Fallback Always Firing)](#claude-directive-errors-fallback-always-firing)
3. [Population Premature Convergence](#population-premature-convergence)
4. [Negative Fitness Scores or NaN](#negative-fitness-scores-or-nan)
5. [Checkpoint / Rollback Failures](#checkpoint--rollback-failures)
6. [MCP Server Connection Issues](#mcp-server-connection-issues)
7. [Database Errors During Tournament](#database-errors-during-tournament)
8. [Agent Genealogy / Lineage Not Appearing](#agent-genealogy--lineage-not-appearing)
9. [Adversarial Training Misconfiguration](#adversarial-training-misconfiguration)
10. [Performance / Memory Issues](#performance--memory-issues)

---

## Tournament Stalls / Never Completes

**Symptoms:**
- Tournament status stays `RUNNING` indefinitely
- No new generations appear in the summary endpoint
- `gaEventBus` stops emitting `generation:complete` events

**Causes and fixes:**

**A. Competition engine deadlock (Worker Threads)**

Without Redis, each SIMULATED competition runs in a Worker Thread. If the thread throws an uncaught error, the tournament loop catches it but may log without propagating.

```bash
# Check backend logs for Worker Thread errors
npm run dev 2>&1 | grep -i "worker\|thread\|competition"
```

Fix: Check `tournament.status` via `GET /api/evolutionary/tournament/:id`. If `status === 'FAILED'`, the `error` field contains the first exception.

**B. BullMQ worker not running**

SIMULATED tournaments with Redis are offloaded to the tournament worker process.

```bash
# Start the worker
npm run dev:tournament-worker
```

Verify with:
```bash
redis-cli llen bull:tournament:wait
```

**C. All agents retired too aggressively**

If `survivalPercent` is too low and the population is small, all agents may be retired leaving no survivors to breed from, causing the crossover step to throw.

Fix: Ensure `populationSize >= 4` and `survivalPercent >= 10` so at least 1 survivor remains.

**D. `claudeOrchestrated` loop race condition**

The Claude API call is `await`-ed inside the generation loop. If the API key is valid but the API is slow, the tournament may appear stalled. Check logs:

```
[claude-ga] directive received { generation: N, ... }
```

If this log never appears, the API call is hanging. Set a timeout or disable `claudeOrchestrated` temporarily.

---

## Claude Directive Errors (Fallback Always Firing)

**Symptoms:**
- Logs show `[claude-ga] API call failed — using fallback directive` every generation
- Tournament runs but ignores `claudeOrchestrated` intent

**Causes:**

**A. Missing `CLAUDE_API_KEY`**

```bash
# Verify the key is set
GET /api/admin/config        # lists all config keys (admin required)
```

Set via the app config admin panel or environment variable.

**B. Response not pure JSON**

Claude occasionally wraps the JSON in markdown fences despite being instructed not to. The parser strips `` ```json `` and `` ``` `` fences automatically, but other preamble text will cause a parse failure.

Check logs for: `Failed to parse directive JSON from Claude response:`

**C. Invalid field values**

If Claude returns `survivalPercent: 0` or `mutationSeverity: "NONE"`, validation throws and the fallback fires. The validation rules are:
- `mutationSeverity` must be `'LIGHT' | 'MEDIUM' | 'HEAVY'`
- `crossoverStrategy` must be `'UNIFORM' | 'BLENDED'`
- `survivalPercent` must be `1–100`

Check logs for: `Invalid mutationSeverity:` or `Invalid survivalPercent:`

**D. Model token limit**

If the population report is very large (many agents), the prompt may approach 600 tokens output limit. Reduce population size or check if responses are being truncated.

---

## Population Premature Convergence

**Symptoms:**
- All agents cluster around the same fitness score after a few generations
- `stdDev` drops below 5 by generation 3–4
- No improvement in `max fitness` across generations

**Causes and fixes:**

**A. Mutation severity too low for the fitness landscape**

If the initial population is diverse but converges fast, MEDIUM mutation may not be enough.

Fix: Start with `mutationSeverity: 'HEAVY'` for the first 3 generations, then let Claude or the heuristic take over. The heuristic will auto-detect low `stdDev` and apply HEAVY + `diversityBoost`.

**B. `diversityBoost` never triggered**

With `claudeOrchestrated: false`, the heuristic triggers `diversityBoost` when `stdDev < 5 && generation > 1`. If your fitness scores have a wide natural range, stdDev may never drop below 5 even when conceptually converged.

Fix: Enable `claudeOrchestrated: true` and let Claude assess convergence from the full population report.

**C. `survivalPercent` too high**

If 60 % of agents survive, the bottom tier is never replaced, limiting genetic diversity injection.

Fix: Reduce `survivalPercent` to 20–30 for stronger selection pressure.

**D. Initial population too small**

A population of 4 converges immediately — there are only 2 survivors and 2 new offspring each generation.

Recommendation: minimum `populationSize: 8`, ideally 12–20 for meaningful diversity.

---

## Negative Fitness Scores or NaN

**Symptoms:**
- Agent fitness shows as `NaN`, `null`, or negative in the leaderboard
- `evaluate_fitness` MCP tool returns unexpected values

**Causes:**

**A. Agent has no competition history**

New agents (generation 0 or just registered) have `totalCompetitions: 0`, so `winRatePct: 0`, `sharpeRatio: 0`, `totalPnl: 0`. This produces a valid score around 12.5 (PnL percentile = 50 for single agent).

This is expected behaviour — not a bug.

**B. Sharpe ratio extreme outlier**

The Sharpe normalisation maps `[−2, +5] → [0, 100]`. An agent with Sharpe below −2 clamps to 0 for the Sharpe component. An agent with Sharpe above +5 clamps to 100. Both are handled gracefully.

If Sharpe is `NaN` (e.g. zero standard deviation of returns), it normalises to 0.

Fix: Ensure `AgentStatisticsManager.updateStats()` is called after every competition. Check `agent_statistics.sharpe_ratio` directly in SQLite.

**C. Only one agent in the population**

A single-agent population gets a PnL percentile of 50 (neutral). This is intentional — the system cannot rank one agent against itself.

---

## Checkpoint / Rollback Failures

**Symptoms:**
- `GET /api/evolutionary/tournament/:id` shows no checkpoints
- Rollback endpoint returns 404 or 500

**Causes:**

**A. Tables not created**

`generation_checkpoints` and `agent_lineage_extended` tables must exist. They are created by `StorageService.createTables()` on backend startup.

```bash
# Verify tables exist
sqlite3 ./sentiment_analyzer.db ".tables" | grep checkpoint
```

Fix: Restart the backend to trigger `createTables()`.

**B. Tournament ran before GenerationResultStore was wired in**

Older tournaments (pre-Phase 5.1) did not save checkpoints. These cannot be rolled back.

Fix: Start a new tournament — checkpoints are saved from the first generation.

**C. Rollback to generation that doesn't exist**

If you request generation 5 but the tournament only completed 3 generations, the checkpoint query returns `undefined`.

Fix: Use `listCheckpoints(tournamentId)` (via `get_generation_summary` MCP tool or `GET /api/evolutionary/tournament/:id`) to see which generations have checkpoints before attempting rollback.

---

## MCP Server Connection Issues

**Symptoms:**
- Claude Code shows "MCP server not found" or "Connection failed"
- Tools return empty or error responses

**Diagnosis:**

```bash
# Test genetic-ops server manually
cd backend
DB_PATH=./sentiment_analyzer.db npx tsx src/mcp/mcp-genetic-ops.ts
# Should print nothing and wait for stdin (stdio transport)
```

**Common fixes:**

**A. Wrong `DB_PATH`**

The `DB_PATH` in `settings.json` must be relative to the working directory from which Claude Code is launched (typically the repo root).

Correct:
```json
{ "env": { "DB_PATH": "./backend/sentiment_analyzer.db" } }
```

**B. Database file doesn't exist yet**

The backend must have been started at least once to create `sentiment_analyzer.db`.

```bash
cd backend && npm run dev
# Wait for "Storage connected" log, then Ctrl+C
```

**C. Node / npm path issues on Windows**

Ensure `npm` is on `PATH`. Alternatively, use the full path:
```json
{
  "command": "C:\\Program Files\\nodejs\\npm.cmd",
  "args": ["run", "--prefix", "backend", "dev:mcp:genetic-ops"]
}
```

**D. Port conflict (if using SSE transport instead of stdio)**

These servers use stdio transport — they do not bind a port. If you see port errors, you may have accidentally configured the wrong transport.

---

## Database Errors During Tournament

**Symptoms:**
- Tournament fails with `SQLITE_BUSY` or `database is locked` errors
- Intermittent failures on high-concurrency runs

**Causes:**

`better-sqlite3` uses synchronous I/O with WAL mode. Concurrent writes from the main process and worker threads to the same database file can cause busy timeouts.

**Fixes:**

**A. Increase busy timeout**

The default SQLite busy timeout is 5 seconds. For long-running mutations or large populations, this may not be enough.

```typescript
// In StorageService or worker setup:
db.pragma('busy_timeout = 10000');  // 10 seconds
```

**B. Use a single writer**

Ensure only one process (or worker thread) performs writes at any given time. The main backend and tournament workers already coordinate via BullMQ when Redis is available.

**C. Check WAL mode is enabled**

```bash
sqlite3 ./sentiment_analyzer.db "PRAGMA journal_mode"
# Should return: wal
```

If not in WAL mode, restart the backend (StorageService sets it on connect).

---

## Agent Genealogy / Lineage Not Appearing

**Symptoms:**
- `GET /api/agents/:id/genealogy` returns empty array
- Lineage tree shows only the agent with no parents

**Causes:**

**A. Agent registered manually (no crossover)**

Agents created via `GenomeManager.registerNewAgent()` without parent IDs do not have `agent_genealogy` rows. This is normal for genesis (generation 0) agents.

**B. `breedPopulation` called without writing genealogy**

The genealogy INSERT is inside `GeneticCrossover.breed()`. If you manually create offspring using only `GenomeManager.registerNewAgent()` (bypassing `GeneticCrossover`), no genealogy row is written.

Fix: Always use `GeneticCrossover.breed()` or `breedPopulation()` to create offspring.

**C. Extended lineage not saved**

`GenerationResultStore.saveLineageEntry()` is called by `EvolutionaryOrchestrator` after each crossover. If you bypass the orchestrator for manual breeds, call it explicitly.

---

## Adversarial Training Misconfiguration

**Symptoms:**
- No adversary agents appear despite `adversarialTraining: true`
- Sentiment agents never receive the +10 % fitness bonus

**Causes:**

**A. `adversarialRoundInterval` too large**

With default `adversarialRoundInterval: 3`, no adversarial round runs until generation 3. In short tournaments (5 generations), this means only one round occurs.

Fix: Set `adversarialRoundInterval: 1` to run adversarial rounds every generation.

**B. `adversaryPopulationSize: 0`**

If explicitly set to 0, no adversary agents are created.

Fix: Omit the field to use the default (`ceil(populationSize × 0.2)`), or set it to at least 1.

**C. All adversary competitions returned zero PnL**

If the simulation steps are too short (`competitionDuration < 50`), agents may not have time to make trades, resulting in all-zero PnL and no clear winner.

Fix: Use `competitionDuration >= 100` for adversarial rounds.

---

## Performance / Memory Issues

**Symptoms:**
- Backend memory grows across long multi-generation tournaments
- Tournament worker process OOM crashes on large populations

**Causes and recommendations:**

**A. Large `policyWeights` in genomes**

Genome blobs with full policy-weight matrices (3 fully-connected layers × 2 matrices + biases) can be 50–200 KB each. With 20 agents and 50 generations, that's 200 MB of genome blobs.

Fix: Only include `policyWeights` in genomes when neural-network crossover is needed. For most evolutionary experiments, the 11 numeric genes plus architecture are sufficient.

**B. Unlimited competition history**

`agent_competitions` grows unbounded. Each competition row is small (~200 bytes), but with 20 agents × 50 generations = 1 000 rows — that's manageable. At 500 generations it becomes 10 000 rows.

Fix: Periodically archive or delete old `agent_competitions` rows for retired agents.

**C. Synchronous SQLite blocking event loop**

`better-sqlite3` is synchronous. Long-running queries (large `agent_competitions` scans) block the Node.js event loop.

Fix: Run tournaments in the BullMQ worker process (requires `REDIS_URL`) so the main API thread is not blocked.

**D. Memory leak in event bus**

If code subscribes to `gaEventBus.on(...)` without calling the returned unsubscribe function, listeners accumulate.

Fix: Always capture and call the unsubscribe function when done:
```typescript
const unsub = gaEventBus.on('generation:complete', handler);
// ... later:
unsub();
```
