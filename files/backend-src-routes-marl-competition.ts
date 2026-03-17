API ROUTES - MARL COMPETITION ENGINE
===================================

File: backend/src/routes/marl-competition.ts

Endpoints for configuring agents, running tournaments, and analyzing results.

---

import express, { Router, Request, Response } from 'express';
import { MarlCompetitionEngine, CompetitionConfig, CompetitionResult } from '../services/marl-competition-engine';

const router = Router();
const competitionEngine = new MarlCompetitionEngine();

// ========================================
// START COMPETITION
// ========================================

/**
 * POST /api/marl/competition/start
 *
 * Start a new competitive tournament with configurable agents and rules.
 *
 * Request body:
 * {
 *   "mode": "SINGLE" | "EVOLUTIONARY" | "CONTINUOUS",
 *   "agents": [
 *     {
 *       "id": "agent_conservative_1",
 *       "riskProfile": "CONSERVATIVE"
 *     },
 *     {
 *       "id": "agent_aggressive_1",
 *       "riskProfile": "AGGRESSIVE"
 *     },
 *     {
 *       "id": "agent_scalper_1",
 *       "riskProfile": "SCALPING"
 *     }
 *   ],
 *   "symbols": ["BTC", "ETH", "SOL"],
 *   "duration": 3600000,  // 1 hour in milliseconds
 *   "refreshInterval": 1000,  // Update market state every 1s
 *   "evolutionaryRounds": 5,  // Only for EVOLUTIONARY mode
 *   "learningEnabled": true
 * }
 *
 * Response:
 * {
 *   "competitionId": "comp_1710644400000",
 *   "status": "STARTED",
 *   "mode": "SINGLE",
 *   "agents": 3,
 *   "estimatedDuration": "1 hour",
 *   "message": "Competition started. Results will be available when complete."
 * }
 */
router.post('/api/marl/competition/start', async (req: Request, res: Response) => {
  try {
    const { mode, agents, symbols, duration, refreshInterval, evolutionaryRounds, learningEnabled } = req.body;

    if (!mode || !['SINGLE', 'EVOLUTIONARY', 'CONTINUOUS'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use: SINGLE, EVOLUTIONARY, CONTINUOUS' });
    }

    if (!agents || agents.length < 2) {
      return res.status(400).json({ error: 'Minimum 2 agents required' });
    }

    if (!symbols || symbols.length === 0) {
      return res.status(400).json({ error: 'At least 1 symbol required' });
    }

    const config: CompetitionConfig = {
      mode: mode as 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS',
      agents,
      symbols,
      duration: duration || 3600000,  // Default 1 hour
      refreshInterval: refreshInterval || 1000,  // Default 1s
      evolutionaryRounds: evolutionaryRounds || 5,
      learningEnabled: learningEnabled !== false
    };

    // Start competition asynchronously
    const competitionId = `comp_${Date.now()}`;
    const historicalData = new Map();  // Would load from database
    const sentimentData = new Map();  // Would load from sentiment cache

    // Don't await - return immediately and let it run in background
    competitionEngine.runCompetition(config, historicalData, sentimentData)
      .catch(err => console.error(`Competition ${competitionId} error:`, err));

    res.json({
      competitionId,
      status: 'STARTED',
      mode,
      agentCount: agents.length,
      symbols,
      estimatedDuration: formatDuration(duration),
      message: `Competition started with ${agents.length} agents trading ${symbols.join(', ')} for ${formatDuration(duration)}`
    });
  } catch (error: any) {
    console.error('Competition start error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// GET COMPETITION STATUS
// ========================================

/**
 * GET /api/marl/competition/:competitionId/status
 *
 * Check status of ongoing or completed competition.
 *
 * Response:
 * {
 *   "competitionId": "comp_...",
 *   "status": "RUNNING" | "COMPLETED",
 *   "progress": 45,  // Percentage
 *   "elapsedTime": 1800000,
 *   "estimatedRemaining": 1800000,
 *   "agentEquities": [
 *     { "agentId": "conservative_1", "equity": 10250, "return": 2.5 },
 *     { "agentId": "aggressive_1", "equity": 10450, "return": 4.5 }
 *   ],
 *   "topPerformer": "aggressive_1"
 * }
 */
router.get('/api/marl/competition/:competitionId/status', (req: Request, res: Response) => {
  try {
    const { competitionId } = req.params;
    const result = competitionEngine.getCompetitionResults(competitionId);

    if (!result) {
      return res.status(404).json({ error: 'Competition not found or still running' });
    }

    // If completed, return final results
    res.json({
      competitionId,
      status: 'COMPLETED',
      mode: result.mode,
      duration: result.duration,
      finalRankings: result.finalRankings,
      topPerformer: result.finalRankings[0],
      equityEvolution: result.equityEvolution.slice(-20)  // Last 20 snapshots
    });
  } catch (error: any) {
    console.error('Status check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// GET DETAILED RESULTS
// ========================================

/**
 * GET /api/marl/competition/:competitionId/results
 *
 * Detailed results including head-to-head metrics, impact analysis, equity curves.
 *
 * Response:
 * {
 *   "competitionId": "comp_...",
 *   "finalRankings": [ ... ],
 *   "headToHeadMetrics": [
 *     {
 *       "agent1": "conservative_1",
 *       "agent2": "aggressive_1",
 *       "agent1Return": 2.5,
 *       "agent2Return": 4.5,
 *       "winner": "aggressive_1"
 *     }
 *   ],
 *   "competitorImpact": [
 *     {
 *       "agentId": "conservative_1",
 *       "averageLiquidityImpact": 3.2,  // bps
 *       "timesOutbid": 12,
 *       "timesOutsold": 8
 *     }
 *   ],
 *   "equityEvolution": [ ... ]
 * }
 */
router.get('/api/marl/competition/:competitionId/results', (req: Request, res: Response) => {
  try {
    const { competitionId } = req.params;
    const result = competitionEngine.getCompetitionResults(competitionId);

    if (!result) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    res.json({
      competitionId: result.competitionId,
      mode: result.mode,
      duration: result.duration,
      completedAt: new Date(),
      finalRankings: result.finalRankings.map(r => ({
        rank: r.rank,
        agentId: r.agentId,
        finalCapital: r.finalCapital.toFixed(2),
        totalReturn: r.totalReturn.toFixed(2),
        totalReturnPct: ((r.totalReturn / 10000) * 100).toFixed(2),
        sharpeRatio: r.sharpeRatio.toFixed(2),
        maxDrawdown: r.maxDrawdown.toFixed(2),
        tradesExecuted: r.tradesExecuted,
        winRate: r.winRate.toFixed(2)
      })),
      headToHeadMetrics: result.headToHeadMetrics.map(m => ({
        agent1: m.agent1,
        agent2: m.agent2,
        agent1Return: m.agent1Return.toFixed(2),
        agent2Return: m.agent2Return.toFixed(2),
        winner: m.winner,
        margin: Math.abs(m.agent1Return - m.agent2Return).toFixed(2)
      })),
      competitorImpact: result.competitorImpact.map(c => ({
        agentId: c.agentId,
        averageLiquidityImpact: c.averageLiquidityImpact.toFixed(2),
        timesOutbid: c.timesOutbid,
        timesOutsold: c.timesOutsold,
        netOutperformed: c.timesOutbid - c.timesOutsold
      })),
      equityEvolution: result.equityEvolution.map(e => ({
        timestamp: e.timestamp,
        agentEquities: e.agentEquities.map(ae => ({
          agentId: ae.agentId,
          equity: ae.equity.toFixed(2)
        }))
      }))
    });
  } catch (error: any) {
    console.error('Results error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// COMPARE AGENTS
// ========================================

/**
 * POST /api/marl/agents/compare
 *
 * Run quick head-to-head comparison between specific agents.
 *
 * Request body:
 * {
 *   "agents": [
 *     { "id": "agent1", "riskProfile": "CONSERVATIVE" },
 *     { "id": "agent2", "riskProfile": "AGGRESSIVE" }
 *   ],
 *   "symbols": ["BTC", "ETH"],
 *   "duration": 600000,  // 10 minutes
 *   "rounds": 5  // Run 5 times and average
 * }
 *
 * Response:
 * {
 *   "comparison": {
 *     "agent1": {
 *       "id": "agent1",
 *       "riskProfile": "CONSERVATIVE",
 *       "avgReturn": 2.3,
 *       "winRate": 60,  // % of competitions won
 *       "avgSharpe": 0.85
 *     },
 *     "agent2": {
 *       "id": "agent2",
 *       "riskProfile": "AGGRESSIVE",
 *       "avgReturn": 3.8,
 *       "winRate": 40,
 *       "avgSharpe": 0.92
 *     }
 *   },
 *   "verdict": "agent2 outperforms in all metrics"
 * }
 */
router.post('/api/marl/agents/compare', async (req: Request, res: Response) => {
  try {
    const { agents, symbols, duration, rounds } = req.body;

    if (!agents || agents.length < 2) {
      return res.status(400).json({ error: 'Minimum 2 agents required for comparison' });
    }

    const config: CompetitionConfig = {
      mode: 'SINGLE',
      agents,
      symbols: symbols || ['BTC', 'ETH'],
      duration: duration || 600000,
      refreshInterval: 1000,
      learningEnabled: true
    };

    const results = [];
    const numRounds = rounds || 3;

    for (let i = 0; i < numRounds; i++) {
      const historicalData = new Map();
      const sentimentData = new Map();
      const result = await competitionEngine.runCompetition(config, historicalData, sentimentData);
      results.push(result);
    }

    // Aggregate results
    const agentStats = new Map<string, any>();
    for (const agent of agents) {
      agentStats.set(agent.id, {
        id: agent.id,
        riskProfile: agent.riskProfile,
        returns: [] as number[],
        sharpeRatios: [] as number[],
        wins: 0
      });
    }

    for (const result of results) {
      const topAgent = result.finalRankings[0];
      agentStats.get(topAgent.agentId).wins++;

      for (const ranking of result.finalRankings) {
        const stats = agentStats.get(ranking.agentId);
        stats.returns.push(ranking.totalReturn);
        stats.sharpeRatios.push(ranking.sharpeRatio);
      }
    }

    const comparison = new Map();
    for (const [agentId, stats] of agentStats) {
      comparison.set(agentId, {
        id: agentId,
        riskProfile: stats.riskProfile,
        avgReturn: (stats.returns.reduce((a: number, b: number) => a + b, 0) / stats.returns.length).toFixed(2),
        returnStdDev: Math.sqrt(
          stats.returns.reduce((a: number, r: number) => a + Math.pow(r - stats.returns[0], 2), 0) / stats.returns.length
        ).toFixed(2),
        winRate: ((stats.wins / numRounds) * 100).toFixed(1),
        avgSharpe: (stats.sharpeRatios.reduce((a: number, b: number) => a + b, 0) / stats.sharpeRatios.length).toFixed(2)
      });
    }

    const winner = Array.from(comparison.values()).sort((a: any, b: any) => b.avgReturn - a.avgReturn)[0];

    res.json({
      roundsRun: numRounds,
      comparison: Object.fromEntries(comparison),
      winner: winner.id,
      verdict: `${winner.id} outperforms with avg return of ${winner.avgReturn}% and Sharpe of ${winner.avgSharpe}`
    });
  } catch (error: any) {
    console.error('Comparison error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// LIST ALL COMPETITIONS
// ========================================

/**
 * GET /api/marl/competitions
 *
 * List all competitions (running and completed).
 *
 * Response:
 * {
 *   "competitions": [
 *     {
 *       "competitionId": "comp_1710644400000",
 *       "mode": "SINGLE",
 *       "status": "COMPLETED",
 *       "agents": 3,
 *       "topPerformer": "aggressive_1",
 *       "topPerformerReturn": 4.5,
 *       "completedAt": "2024-03-17T10:30:00Z"
 *     }
 *   ]
 * }
 */
router.get('/api/marl/competitions', (req: Request, res: Response) => {
  try {
    const allResults = competitionEngine.getAllResults();

    const competitions = allResults.map(result => ({
      competitionId: result.competitionId,
      mode: result.mode,
      status: 'COMPLETED',
      agents: result.finalRankings.length,
      duration: result.duration,
      topPerformer: result.finalRankings[0].agentId,
      topPerformerReturn: result.finalRankings[0].totalReturn.toFixed(2),
      completedAt: new Date()
    }));

    res.json({
      count: competitions.length,
      competitions: competitions.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    });
  } catch (error: any) {
    console.error('List competitions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// DOCUMENTATION
// ========================================

/**
 * GET /api/marl/info
 *
 * Information about MARL competition modes and configuration.
 */
router.get('/api/marl/info', (req: Request, res: Response) => {
  res.json({
    modes: {
      SINGLE: {
        description: 'Single tournament: all agents trade simultaneously for fixed duration',
        duration: '1 hour (configurable)',
        learningDuringCompetition: true,
        bestFor: 'Quick comparison, learning validation',
        example: 'Run 3 agents for 1 hour, see who wins'
      },
      EVOLUTIONARY: {
        description: 'Multi-round elimination: top agents breed, weak ones eliminated',
        duration: '1-5 rounds (configurable)',
        learningDuringCompetition: true,
        bestFor: 'Long-term strategy optimization',
        example: 'Run 8 agents for 5 rounds: top 2 survive each round'
      },
      CONTINUOUS: {
        description: 'Never-ending tournament: agents learn from replays in background',
        duration: 'Unlimited (configurable)',
        learningDuringCompetition: true,
        bestFor: 'Real-time simulation, market dynamics learning',
        example: 'Agents trade continuously, replay best trades hourly'
      }
    },
    riskProfiles: {
      CONSERVATIVE: {
        maxRiskPerTrade: '1%',
        positionSize: 'Small',
        holdTime: '30+ days',
        tradingStyle: 'Position trading'
      },
      AGGRESSIVE: {
        maxRiskPerTrade: '5%',
        positionSize: 'Large',
        holdTime: '3 days',
        tradingStyle: 'Swing trading'
      },
      SCALPING: {
        maxRiskPerTrade: '3%',
        positionSize: 'Medium',
        holdTime: '1 hour',
        tradingStyle: 'Quick trades'
      }
    },
    competitorImpactMetrics: {
      averageLiquidityImpact: 'Basis points added by agent orders',
      timesOutbid: 'How many times agent was beaten to buy orders',
      timesOutsold: 'How many times agent was beaten to sell orders',
      netOutperformed: 'Positive = agent more aggressive, Negative = passive'
    },
    sharedOrderBook: {
      mechanism: 'All agents trade on same order book',
      pricing: 'Slippage increases with order size relative to depth',
      liquidity: 'Agents can see competitor orders and adjust',
      strategy: 'Smart agents learn to time entries when competitors exit'
    }
  });
});

// ========================================
// HELPER FUNCTIONS
// ========================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day(s)`;
  if (hours > 0) return `${hours} hour(s)`;
  if (minutes > 0) return `${minutes} minute(s)`;
  return `${seconds} second(s)`;
}

export default router;
