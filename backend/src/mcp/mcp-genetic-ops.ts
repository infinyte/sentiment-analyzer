/**
 * MCP Genetic Operations Server
 *
 * Exposes genetic algorithm services as MCP tools so Claude and other
 * MCP-compatible clients can invoke mutation, crossover, fitness evaluation,
 * and population selection against the live SQLite agent database.
 *
 * Tools provided:
 *   mutate_agent        — apply stochastic mutation to a persisted genome
 *   crossover_agents    — breed two parent agents into an offspring
 *   evaluate_fitness    — compute composite fitness score for agent stats
 *   select_population   — partition a population into survivors / retirees
 *   get_generation_summary — fetch checkpoint + fitness snapshot for a generation
 *
 * Usage (stdio transport):
 *   node dist/mcp/mcp-genetic-ops.js
 *
 * Or in dev mode:
 *   tsx src/mcp/mcp-genetic-ops.ts
 *
 * The DB_PATH env var (or default ./sentiment_analyzer.db) selects the database.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { MutationEngine, type MutationSeverity } from '../services/evolutionary/mutation-engine.js';
import { GeneticCrossover, type CrossoverStrategy } from '../services/evolutionary/genetic-crossover.js';
import { FitnessCalculator, type AgentStats as FitnessAgentStats } from '../services/evolutionary/fitness-calculator.js';
import { SelectionAlgorithm } from '../services/evolutionary/selection-algorithm.js';
import { AgentStatisticsManager } from '../services/evolutionary/agent-statistics-manager.js';
import { GenerationResultStore } from '../services/evolutionary/generation-result-store.js';
import path from 'node:path';

// ── Database connection ────────────────────────────────────────────────────────

function openDb(): Database.Database {
  const dbPath = path.resolve(process.env['DB_PATH'] ?? './sentiment_analyzer.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name:    'genetic-ops',
  version: '1.0.0',
});

const db             = openDb();
const mutationEngine = new MutationEngine(db);
const crossover      = new GeneticCrossover(db);
const fitnessCalc    = new FitnessCalculator();
const statsManager   = new AgentStatisticsManager(db);
const resultStore    = new GenerationResultStore(db);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Load AgentStats rows from agent_statistics for a list of agent IDs. */
function loadFitnessStats(agentIds: string[]): FitnessAgentStats[] {
  return agentIds.map(agentId => {
    try {
      const s = statsManager.getStats(agentId);
      return {
        agentId,
        winRatePct:        s.win_rate_percent,
        sharpeRatio:       s.sharpe_ratio,
        totalPnl:          s.total_pnl,
        totalCompetitions: s.total_competitions,
      };
    } catch {
      return { agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 };
    }
  });
}

/** Return all active agent IDs from the registry. */
function activeAgentIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM agent_registry WHERE status = 'ACTIVE' AND agent_type != 'ADVERSARY'")
    .all() as { id: string }[];
  return rows.map(r => r.id);
}

// ── Tool: mutate_agent ────────────────────────────────────────────────────────

server.registerTool(
  'mutate_agent',
  {
    description: 'Apply stochastic mutation to a persisted agent genome and save the result. Returns the list of changed parameters.',
    inputSchema: {
      agentId:  z.string().describe('UUID of the agent whose genome to mutate'),
      severity: z.enum(['LIGHT', 'MEDIUM', 'HEAVY']).optional().default('MEDIUM')
        .describe('Mutation intensity: LIGHT (2 genes, ±10%), MEDIUM (4 genes, ±20%), HEAVY (7 genes, ±40%)'),
    },
  },
  ({ agentId, severity }) => {
    const result = mutationEngine.mutateAndSave(agentId, (severity ?? 'MEDIUM') as MutationSeverity);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agentId,
          severityLabel:     result.severityLabel,
          mutationSeverity:  result.mutationSeverity,
          mutationsApplied:  result.mutations.length,
          mutations:         result.mutations,
          genome:            result.genome,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: crossover_agents ────────────────────────────────────────────────────

server.registerTool(
  'crossover_agents',
  {
    description: 'Breed two parent agents to produce an offspring. Persists the offspring genome and genealogy record. Returns the new offspring ID and its genome.',
    inputSchema: {
      parent1Id: z.string().describe('UUID of the first parent agent'),
      parent2Id: z.string().describe('UUID of the second parent agent'),
      strategy:  z.enum(['UNIFORM', 'BLENDED']).optional().default('UNIFORM')
        .describe('UNIFORM: each gene inherits randomly from one parent. BLENDED: arithmetic mean of both parents.'),
    },
  },
  ({ parent1Id, parent2Id, strategy }) => {
    const result = crossover.breed(parent1Id, parent2Id, (strategy ?? 'UNIFORM') as CrossoverStrategy);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          offspringId:     result.offspringId,
          generationNumber: result.generationNumber,
          inheritanceMap:  result.inheritanceMap,
          offspringGenome: result.offspringGenome,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: evaluate_fitness ────────────────────────────────────────────────────

server.registerTool(
  'evaluate_fitness',
  {
    description: 'Compute the composite fitness score (0–100) for an agent given its performance stats. Can evaluate a single agent or compare it against a population for PnL percentile ranking.',
    inputSchema: {
      agentId:       z.string().describe('Agent ID to evaluate'),
      populationIds: z.array(z.string()).optional()
        .describe('Optional list of agent IDs to include in the population for relative PnL ranking. Defaults to all active agents.'),
    },
  },
  ({ agentId, populationIds }) => {
    const ids    = populationIds && populationIds.length > 0 ? populationIds : activeAgentIds();
    const allStats = loadFitnessStats(ids.includes(agentId) ? ids : [agentId, ...ids]);

    const agentStat = allStats.find(s => s.agentId === agentId)
      ?? { agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 };

    const fitness = fitnessCalc.calculateFitness(agentStat, allStats);
    const ranked  = fitnessCalc.rankAgents(allStats);
    const rank    = ranked.findIndex(r => r.agentId === agentId) + 1;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agentId,
          fitness,
          rank,
          populationSize: allStats.length,
          stats:          agentStat,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: select_population ───────────────────────────────────────────────────

server.registerTool(
  'select_population',
  {
    description: 'Partition a population of agents into survivors, retirement candidates, and middle tier based on fitness. Uses the top-percent survival rule.',
    inputSchema: {
      agentIds:        z.array(z.string()).optional()
        .describe('Agent IDs to evaluate. Defaults to all active agents.'),
      survivalPercent: z.number().min(1).max(99).optional().default(30)
        .describe('Percentage of the population that survives (top-N%) and is marked for retirement (bottom-N%). Default 30.'),
    },
  },
  ({ agentIds, survivalPercent }) => {
    const ids      = agentIds && agentIds.length > 0 ? agentIds : activeAgentIds();
    const allStats = loadFitnessStats(ids);
    const algo     = new SelectionAlgorithm(fitnessCalc);
    const result   = algo.selectTopPercent(allStats, survivalPercent ?? 30);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          survivalPercent:          survivalPercent ?? 30,
          survivorCount:            result.survivors.length,
          retirementCandidateCount: result.retirementCandidates.length,
          middleTierCount:          result.middleTier.length,
          survivors:                result.survivors.map(a => ({ agentId: a.agentId, fitness: a.fitness })),
          retirementCandidates:     result.retirementCandidates.map(a => ({ agentId: a.agentId, fitness: a.fitness })),
          middleTier:               result.middleTier.map(a => ({ agentId: a.agentId, fitness: a.fitness })),
        }, null, 2),
      }],
    };
  },
);

// ── Tool: get_generation_summary ──────────────────────────────────────────────

server.registerTool(
  'get_generation_summary',
  {
    description: 'Fetch the latest generation checkpoint for a tournament, including the population snapshot and per-agent fitness scores.',
    inputSchema: {
      tournamentId: z.string().describe('Evolutionary tournament ID'),
      generation:   z.number().int().optional()
        .describe('Generation number to retrieve. Defaults to the latest saved checkpoint.'),
    },
  },
  ({ tournamentId, generation }) => {
    let checkpoint;
    if (generation !== undefined) {
      checkpoint = resultStore.loadCheckpoint(tournamentId, generation);
    } else {
      const all = resultStore.listCheckpoints(tournamentId);
      checkpoint = all.length > 0 ? all[all.length - 1] : undefined;
    }

    if (!checkpoint) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: `No checkpoint found for tournament ${tournamentId}` }),
        }],
        isError: true,
      };
    }

    const allStats = loadFitnessStats(checkpoint.population);
    const ranked   = fitnessCalc.rankAgents(allStats);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          tournamentId,
          generation:      checkpoint.generation,
          checkpointId:    checkpoint.id,
          createdAt:       checkpoint.createdAt,
          populationSize:  checkpoint.population.length,
          directive:       checkpoint.directive ?? null,
          rankedAgents:    ranked.map((a, i) => ({
            rank:    i + 1,
            agentId: a.agentId,
            fitness: a.fitness,
          })),
        }, null, 2),
      }],
    };
  },
);

// ── Start server ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
