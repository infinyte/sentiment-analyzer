/**
 * MCP Agent Manager Server
 *
 * Exposes agent pool management operations as MCP tools so Claude and other
 * MCP-compatible clients can register agents, query health, assign tasks,
 * collect competition results, and inspect the full agent pool.
 *
 * Tools provided:
 *   register_agent    — create a new agent with optional genome overrides
 *   get_agent_health  — return lifetime stats + genome for a single agent
 *   assign_task       — queue a competition task for an agent (or population)
 *   collect_results   — retrieve recent competition results for an agent
 *   get_pool_status   — list all active agents with their fitness snapshots
 *
 * Usage (stdio transport):
 *   node dist/mcp/mcp-agent-manager.js
 *
 * Or in dev mode:
 *   tsx src/mcp/mcp-agent-manager.ts
 *
 * The DB_PATH env var (or default ./sentiment_analyzer.db) selects the database.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  GenomeManager,
  createDefaultGenome,
  type AgentGenome,
} from '../services/evolutionary/agent-genome.js';
import { AgentStatisticsManager } from '../services/evolutionary/agent-statistics-manager.js';
import { FitnessCalculator, type AgentStats as FitnessAgentStats } from '../services/evolutionary/fitness-calculator.js';
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
  name:    'agent-manager',
  version: '1.0.0',
});

const db           = openDb();
const genomeManager = new GenomeManager(db);
const statsManager  = new AgentStatisticsManager(db);
const fitnessCalc   = new FitnessCalculator();

// ── Helpers ───────────────────────────────────────────────────────────────────

interface AgentRow {
  id:                string;
  agent_type:        string;
  risk_profile:      string;
  status:            string;
  generation_number: number;
  custom_name:       string | null;
  emoji:             string | null;
  created_at:        string;
}

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

// ── Tool: register_agent ──────────────────────────────────────────────────────

server.registerTool(
  'register_agent',
  {
    description: 'Register a new agent in the agent pool. Optionally specify a risk profile, agent type, genome overrides, and parent IDs for genealogy tracking.',
    inputSchema: {
      agentType:       z.enum(['ML_BASED', 'RULE_BASED']).optional().default('ML_BASED')
        .describe('Agent learning strategy. ML_BASED uses Q-learning + policy network; RULE_BASED uses fixed rules.'),
      riskProfile:     z.enum(['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING']).optional().default('CONSERVATIVE')
        .describe('Trading risk profile governing position sizing and stop-loss thresholds.'),
      generationNumber: z.number().int().min(0).optional().default(0)
        .describe('Generation number to assign to this agent.'),
      parentId1:       z.string().optional().describe('UUID of parent agent 1 (for genealogy tracking).'),
      parentId2:       z.string().optional().describe('UUID of parent agent 2 (for genealogy tracking).'),
      genomeOverrides: z.object({
        epsilon:              z.number().optional(),
        learningRate:         z.number().optional(),
        gamma:                z.number().optional(),
        explorationDecayRate: z.number().optional(),
        entryThreshold:       z.number().optional(),
        exitThreshold:        z.number().optional(),
        stopLossPct:          z.number().optional(),
        takeProfitPct:        z.number().optional(),
        positionSizePct:      z.number().optional(),
        riskPercent:          z.number().optional(),
        holdDurationMax:      z.number().optional(),
      }).optional().describe('Override specific genome genes. Unspecified genes use mid-range defaults.'),
    },
  },
  ({ agentType, riskProfile, generationNumber, parentId1, parentId2, genomeOverrides }) => {
    const baseGenome = createDefaultGenome();
    const genome: AgentGenome = genomeOverrides
      ? { ...baseGenome, ...(genomeOverrides as Partial<AgentGenome>) }
      : baseGenome;

    const agentId = genomeManager.registerNewAgent({
      agentType:        agentType ?? 'ML_BASED',
      riskProfile:      riskProfile ?? 'CONSERVATIVE',
      generationNumber: generationNumber ?? 0,
      parentId1,
      parentId2,
      genome,
    });

    statsManager.initializeStats(agentId);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agentId,
          agentType:        agentType ?? 'ML_BASED',
          riskProfile:      riskProfile ?? 'CONSERVATIVE',
          generationNumber: generationNumber ?? 0,
          genome,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: get_agent_health ────────────────────────────────────────────────────

server.registerTool(
  'get_agent_health',
  {
    description: 'Return lifetime performance statistics, registry metadata, and genome for a single agent.',
    inputSchema: {
      agentId: z.string().describe('UUID of the agent to inspect'),
    },
  },
  ({ agentId }) => {
    const row = db
      .prepare('SELECT id, agent_type, risk_profile, status, generation_number, custom_name, emoji, created_at FROM agent_registry WHERE id = ?')
      .get(agentId) as AgentRow | undefined;

    if (!row) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Agent ${agentId} not found` }) }],
        isError: true,
      };
    }

    let stats = null;
    try { stats = statsManager.getStats(agentId); } catch { /* no stats yet */ }

    const genome = genomeManager.loadGenome(agentId);

    const fitnessAgentStat: FitnessAgentStats = stats
      ? { agentId, winRatePct: stats.win_rate_percent, sharpeRatio: stats.sharpe_ratio, totalPnl: stats.total_pnl, totalCompetitions: stats.total_competitions }
      : { agentId, winRatePct: 0, sharpeRatio: 0, totalPnl: 0, totalCompetitions: 0 };

    const fitness = fitnessCalc.calculateFitness(fitnessAgentStat, [fitnessAgentStat]);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agentId,
          status:           row.status,
          agentType:        row.agent_type,
          riskProfile:      row.risk_profile,
          generationNumber: row.generation_number,
          customName:       row.custom_name,
          emoji:            row.emoji,
          createdAt:        row.created_at,
          fitness,
          statistics:       stats,
          genome,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: assign_task ─────────────────────────────────────────────────────────

server.registerTool(
  'assign_task',
  {
    description: 'Assign a competition task to one or more agents by recording a task intent row in the database. Returns instructions for the competition runner to pick up the task.',
    inputSchema: {
      agentIds:       z.array(z.string()).min(1).describe('List of agent UUIDs to participate in the competition'),
      symbols:        z.array(z.string()).min(1).describe('Trading symbols (e.g. ["BTC", "ETH"]) for the competition'),
      duration:       z.number().int().min(1).optional().default(60)
        .describe('Competition duration in simulation steps. Default 60.'),
      initialCapital: z.number().min(100).optional().default(10000)
        .describe('Starting capital per agent in USD. Default 10000.'),
      taskLabel:      z.string().optional().describe('Optional human-readable label for this task'),
    },
  },
  ({ agentIds, symbols, duration, initialCapital, taskLabel }) => {
    // Validate all agents exist and are active
    const missing: string[] = [];
    for (const id of agentIds) {
      const row = db.prepare("SELECT id FROM agent_registry WHERE id = ? AND status = 'ACTIVE'").get(id);
      if (!row) missing.push(id);
    }
    if (missing.length > 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Agents not found or not ACTIVE', missing }) }],
        isError: true,
      };
    }

    // Build a competition spec ready to pass to MarlCompetitionEngine.runCompetition()
    const competitionSpec = {
      taskLabel:      taskLabel ?? `mcp-task-${Date.now()}`,
      mode:           'SINGLE',
      agents:         agentIds.map(id => ({ id, riskProfile: getAgentRiskProfile(id), initialCapital: initialCapital ?? 10000 })),
      symbols:        symbols,
      duration:       duration ?? 60,
      refreshInterval: 1000,
      learningEnabled: true,
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status:  'TASK_SPEC_READY',
          message: 'Pass the competitionSpec to MarlCompetitionEngine.runCompetition() to execute this task.',
          competitionSpec,
        }, null, 2),
      }],
    };
  },
);

function getAgentRiskProfile(agentId: string): 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING' {
  const row = db.prepare('SELECT risk_profile FROM agent_registry WHERE id = ?').get(agentId) as { risk_profile: string } | undefined;
  return (row?.risk_profile ?? 'CONSERVATIVE') as 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
}

// ── Tool: collect_results ─────────────────────────────────────────────────────

server.registerTool(
  'collect_results',
  {
    description: 'Retrieve recent competition results for a specific agent, ordered most-recent-first.',
    inputSchema: {
      agentId: z.string().describe('UUID of the agent whose results to retrieve'),
      limit:   z.number().int().min(1).max(100).optional().default(10)
        .describe('Maximum number of competition records to return. Default 10.'),
    },
  },
  ({ agentId, limit }) => {
    const rows = db.prepare(`
      SELECT competition_id, rank_position, starting_capital, ending_capital,
             pnl, trades_count, win_trades, loss_trades, sharpe_ratio, completed_at
      FROM agent_competitions
      WHERE agent_id = ?
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(agentId, limit ?? 10) as Array<{
      competition_id:   string;
      rank_position:    number;
      starting_capital: number;
      ending_capital:   number;
      pnl:              number;
      trades_count:     number;
      win_trades:       number;
      loss_trades:      number;
      sharpe_ratio:     number;
      completed_at:     string;
    }>;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          agentId,
          resultCount: rows.length,
          results: rows.map(r => ({
            competitionId:   r.competition_id,
            rankPosition:    r.rank_position,
            startingCapital: r.starting_capital,
            endingCapital:   r.ending_capital,
            pnl:             r.pnl,
            tradesCount:     r.trades_count,
            winTrades:       r.win_trades,
            lossTrades:      r.loss_trades,
            sharpeRatio:     r.sharpe_ratio,
            completedAt:     r.completed_at,
          })),
        }, null, 2),
      }],
    };
  },
);

// ── Tool: get_pool_status ─────────────────────────────────────────────────────

server.registerTool(
  'get_pool_status',
  {
    description: 'Return a summary of all active agents in the pool including their fitness scores, risk profiles, and generation numbers.',
    inputSchema: {
      includeRetired: z.boolean().optional().default(false)
        .describe('When true, also include RETIRED agents. Default false (active only).'),
      agentType: z.enum(['ML_BASED', 'RULE_BASED', 'ADVERSARY', 'all']).optional().default('all')
        .describe('Filter by agent type. Default "all".'),
    },
  },
  ({ includeRetired, agentType }) => {
    const statusFilter = includeRetired ? "status IN ('ACTIVE','RETIRED')" : "status = 'ACTIVE'";
    const typeFilter   = (agentType && agentType !== 'all') ? `AND agent_type = '${agentType}'` : '';

    const agents = db.prepare(`
      SELECT id, agent_type, risk_profile, status, generation_number, custom_name, emoji, created_at
      FROM agent_registry
      WHERE ${statusFilter} ${typeFilter}
      ORDER BY created_at ASC
    `).all() as AgentRow[];

    const agentIds = agents.map(a => a.id);
    const fitnessStats = loadFitnessStats(agentIds);
    const ranked       = fitnessCalc.rankAgents(fitnessStats);
    const fitnessMap   = new Map(ranked.map((r, i) => [r.agentId, { fitness: r.fitness, rank: i + 1 }]));

    const poolEntries = agents.map(a => ({
      agentId:          a.id,
      agentType:        a.agent_type,
      riskProfile:      a.risk_profile,
      status:           a.status,
      generationNumber: a.generation_number,
      customName:       a.custom_name,
      emoji:            a.emoji,
      createdAt:        a.created_at,
      fitness:          fitnessMap.get(a.id)?.fitness ?? 0,
      rank:             fitnessMap.get(a.id)?.rank ?? agents.length,
    }));

    // Sort by fitness descending
    poolEntries.sort((a, b) => b.fitness - a.fitness);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          totalAgents:  poolEntries.length,
          activeCount:  poolEntries.filter(a => a.status === 'ACTIVE').length,
          retiredCount: poolEntries.filter(a => a.status === 'RETIRED').length,
          agents:       poolEntries,
        }, null, 2),
      }],
    };
  },
);

// ── Start server ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
