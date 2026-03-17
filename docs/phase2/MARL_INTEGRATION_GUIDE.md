MARL INTEGRATION GUIDE
====================

How to integrate the MARL competitive framework into your existing sentiment analyzer project.

---

FILE STRUCTURE AFTER INTEGRATION
=================================

backend/
├── src/
│   ├── services/
│   │   ├── sentiment-analyzer.ts          ✅ Existing
│   │   ├── trading-agent.ts               ✅ Existing
│   │   ├── backtesting-engine.ts          ✅ Existing
│   │   └── marl-competition-engine.ts     ✨ NEW
│   │
│   ├── routes/
│   │   ├── coins.ts                       ✅ Existing
│   │   ├── sentiment-trading.ts           ✅ Existing
│   │   └── marl-competition.ts            ✨ NEW
│   │
│   └── index.ts                            ✏️ UPDATE
│
└── package.json                            ✏️ UPDATE (add types if needed)

frontend/
├── src/
│   ├── components/
│   │   ├── SentimentDashboard.tsx          ✅ Existing
│   │   ├── BacktestConfigurator.tsx        ✅ Existing
│   │   └── MarlCompetitionViewer.tsx       ✨ NEW
│   │
│   ├── hooks/
│   │   ├── useSentimentAnalysis.ts         ✅ Existing
│   │   ├── useBacktest.ts                  ✅ Existing
│   │   └── useMarlCompetition.ts           ✨ NEW
│   │
│   └── types/
│       └── marl.ts                         ✨ NEW
│
└── App.tsx                                 ✏️ UPDATE (add MARL routes)


STEP 1: COPY SERVICE FILE
=========================

Copy the new MARL service file into your backend:

File: backend/src/services/marl-competition-engine.ts
Source: marl-competition-engine.ts (provided above)

This file contains:
- SharedOrderBook class (manages limit order book)
- MarlTradingAgent class (extends TradingAgent with RL)
- MarlCompetitionEngine class (orchestrates tournaments)


STEP 2: COPY ROUTES FILE
========================

Copy the MARL routes file into your backend:

File: backend/src/routes/marl-competition.ts
Source: marl-competition.ts (provided above)

This file provides 5 endpoints:
- POST /api/marl/competition/start
- GET /api/marl/competition/:competitionId/status
- GET /api/marl/competition/:competitionId/results
- POST /api/marl/agents/compare
- GET /api/marl/competitions
- GET /api/marl/info


STEP 3: UPDATE BACKEND SERVER
=============================

File: backend/src/index.ts

Add these imports:

import marlCompetitionRoutes from './routes/marl-competition';

Add these routes:

app.use(marlCompetitionRoutes);  // After existing routes

Example of updated server:

import express from 'express';
import sentimentRoutes from './routes/sentiment-trading';
import coinRoutes from './routes/coins';
import marlCompetitionRoutes from './routes/marl-competition';  // NEW

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.cors());

// Existing routes
app.use(sentimentRoutes);
app.use(coinRoutes);

// NEW MARL routes
app.use(marlCompetitionRoutes);

// Error handling
app.use((err, req, res) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`✓ Server running on port ${port}`);
  console.log(`✓ Sentiment endpoints available`);
  console.log(`✓ MARL competition endpoints available`);
});

export default app;


STEP 4: CREATE FRONTEND TYPES
=============================

File: frontend/src/types/marl.ts

export interface CompetitionAgent {
  id: string;
  riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
}

export interface CompetitionConfig {
  mode: 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
  agents: CompetitionAgent[];
  symbols: string[];
  duration: number;
  refreshInterval: number;
  evolutionaryRounds?: number;
  learningEnabled: boolean;
}

export interface CompetitionResult {
  competitionId: string;
  mode: string;
  finalRankings: {
    rank: number;
    agentId: string;
    finalCapital: number;
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    tradesExecuted: number;
    winRate: number;
  }[];
  headToHeadMetrics: {
    agent1: string;
    agent2: string;
    agent1Return: number;
    agent2Return: number;
    winner: string;
  }[];
  competitorImpact: {
    agentId: string;
    averageLiquidityImpact: number;
    timesOutbid: number;
    timesOutsold: number;
  }[];
}


STEP 5: CREATE FRONTEND HOOK
============================

File: frontend/src/hooks/useMarlCompetition.ts

import { useState } from 'react';
import { CompetitionConfig, CompetitionResult } from '../types/marl';

export function useMarlCompetition() {
  const [loading, setLoading] = useState(false);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [results, setResults] = useState<CompetitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCompetition = async (config: CompetitionConfig) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/marl/competition/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      const data = await response.json();
      setCompetitionId(data.competitionId);

      // Poll for results
      const pollInterval = setInterval(async () => {
        const statusResponse = await fetch(`/api/marl/competition/${data.competitionId}/status`);
        const statusData = await statusResponse.json();

        if (statusData.status === 'COMPLETED') {
          setResults(statusData);
          clearInterval(pollInterval);
          setLoading(false);
        }
      }, 5000);  // Check every 5 seconds
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  const getDetailedResults = async (compId: string) => {
    try {
      const response = await fetch(`/api/marl/competition/${compId}/results`);
      const data = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const compareAgents = async (
    agent1: { id: string; riskProfile: string },
    agent2: { id: string; riskProfile: string },
    symbols: string[],
    rounds: number = 3
  ) => {
    setLoading(true);
    try {
      const response = await fetch('/api/marl/agents/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [agent1, agent2],
          symbols,
          duration: 600000,
          rounds
        })
      });

      const data = await response.json();
      setResults(data as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return {
    startCompetition,
    getDetailedResults,
    compareAgents,
    competitionId,
    results,
    loading,
    error
  };
}


STEP 6: CREATE FRONTEND COMPONENT
=================================

File: frontend/src/components/MarlCompetitionViewer.tsx

import React, { useState } from 'react';
import { useMarlCompetition } from '../hooks/useMarlCompetition';
import { CompetitionConfig } from '../types/marl';

export function MarlCompetitionViewer() {
  const { startCompetition, getDetailedResults, results, loading, competitionId } = useMarlCompetition();
  const [mode, setMode] = useState<'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS'>('SINGLE');
  const [agentCount, setAgentCount] = useState(3);
  const [duration, setDuration] = useState(3600000);  // 1 hour

  const handleStartCompetition = () => {
    const agents = Array.from({ length: agentCount }, (_, i) => ({
      id: `agent_${i + 1}`,
      riskProfile: ['CONSERVATIVE', 'AGGRESSIVE', 'SCALPING'][i % 3] as any
    }));

    const config: CompetitionConfig = {
      mode,
      agents,
      symbols: ['BTC', 'ETH', 'SOL'],
      duration,
      refreshInterval: 1000,
      evolutionaryRounds: mode === 'EVOLUTIONARY' ? 5 : undefined,
      learningEnabled: true
    };

    startCompetition(config);
  };

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">MARL Competition Arena</h1>

      <div className="mb-6 p-4 bg-blue-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Tournament Configuration</h2>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block font-semibold mb-2">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              className="w-full p-2 border rounded"
              disabled={loading}
            >
              <option value="SINGLE">Single Tournament</option>
              <option value="EVOLUTIONARY">Evolutionary (Multi-Round)</option>
              <option value="CONTINUOUS">Continuous Learning</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-2">Agents</label>
            <input
              type="number"
              min="2"
              max="10"
              value={agentCount}
              onChange={(e) => setAgentCount(parseInt(e.target.value))}
              className="w-full p-2 border rounded"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block font-semibold mb-2">Duration (minutes)</label>
            <input
              type="number"
              value={duration / 60000}
              onChange={(e) => setDuration(e.target.valueAsNumber * 60000)}
              className="w-full p-2 border rounded"
              disabled={loading}
            />
          </div>
        </div>

        <button
          onClick={handleStartCompetition}
          disabled={loading}
          className="bg-purple-600 text-white px-6 py-2 rounded font-bold hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Tournament Running...' : 'Start Tournament'}
        </button>
      </div>

      {competitionId && (
        <div className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-400 rounded">
          <p className="font-semibold">Competition ID: <code className="bg-white p-1">{competitionId}</code></p>
          <p className="text-sm text-gray-600 mt-2">Tournament is running. Results will appear when complete.</p>
        </div>
      )}

      {results && (
        <div className="mt-6">
          <h2 className="text-2xl font-bold mb-4">🏆 Final Rankings</h2>

          <div className="grid grid-cols-1 gap-4">
            {results.finalRankings.map((ranking) => (
              <div key={ranking.agentId} className="border rounded-lg p-4 bg-white">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xl font-bold">#{ranking.rank} {ranking.agentId}</div>
                    <div className="text-gray-600">Capital: ${ranking.finalCapital.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${ranking.totalReturn > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {ranking.totalReturn > 0 ? '+' : ''}{ranking.totalReturn.toFixed(2)}%
                    </div>
                    <div className="text-sm text-gray-600">Sharpe: {ranking.sharpeRatio.toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  Trades: {ranking.tradesExecuted} | Win Rate: {ranking.winRate.toFixed(1)}% | Max DD: {ranking.maxDrawdown.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-2xl font-bold mt-8 mb-4">Head-to-Head Results</h2>
          <div className="bg-white rounded-lg p-4">
            {results.headToHeadMetrics?.slice(0, 5).map((metric, idx) => (
              <div key={idx} className="flex justify-between py-2 border-b">
                <span>{metric.agent1} vs {metric.agent2}</span>
                <span className={metric.winner === metric.agent1 ? 'text-green-600 font-bold' : ''}>
                  {metric.agent1}: {metric.agent1Return.toFixed(2)}%
                </span>
                <span className={metric.winner === metric.agent2 ? 'text-green-600 font-bold' : ''}>
                  {metric.agent2}: {metric.agent2Return.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


STEP 7: UPDATE FRONTEND ROUTER
==============================

File: frontend/src/App.tsx

Add MarlCompetitionViewer to your routes:

import { MarlCompetitionViewer } from './components/MarlCompetitionViewer';

// In your Routes or Router:
<Route path="/marl" element={<MarlCompetitionViewer />} />
<Route path="/marl/:competitionId" element={<MarlCompetitionViewer />} />


STEP 8: UPDATE NAVIGATION
=========================

Add link to MARL section in your navigation:

<nav>
  ...existing links...
  <a href="/marl">MARL Competitions</a>
</nav>


TESTING CHECKLIST
=================

After integration, test:

Backend:
☐ npm install (if new dependencies)
☐ npm run dev (backend starts without errors)
☐ POST /api/marl/competition/start (returns competitionId)
☐ GET /api/marl/info (returns documentation)

Frontend:
☐ npm run dev (frontend starts)
☐ Navigate to /marl page
☐ See tournament configuration form
☐ Click "Start Tournament"
☐ See competitionId appear
☐ See results after tournament completes

E2E:
☐ Run single tournament (1 min duration)
☐ Verify results show rankings
☐ Verify head-to-head metrics
☐ Compare two agents
☐ Check list all competitions


EXAMPLE: QUICK TEST
===================

1. Start backend:
   cd backend && npm run dev

2. In another terminal, start frontend:
   cd frontend && npm run dev

3. Navigate to http://localhost:5173/marl

4. Configure:
   - Mode: SINGLE
   - Agents: 3
   - Duration: 1 minute

5. Click "Start Tournament"

6. Wait ~1 minute

7. See results with rankings, returns, Sharpe ratios

Result: You've run your first MARL competition! 🎉


NEXT: LIVE COMPETITION DASHBOARD
=================================

Optional: Add real-time visualization during competition:

// Hook for polling status
const { status, progress } = usePollCompetitionStatus(competitionId);

// Component to show:
<div>
  Live Equity: <EquityCurveChart data={status.equityHistory} />
  Agent Progress: <AgentProgressBars agents={status.agents} />
  Competition Timer: {progress}%
</div>

This would give real-time feedback during tournaments.


TROUBLESHOOTING
===============

Issue: "Cannot find module './marl-competition-engine'"
Solution: Ensure the file is in backend/src/services/ with correct name

Issue: "Port 3000 already in use"
Solution: Change PORT env variable: PORT=3001 npm run dev

Issue: "Results endpoint returns 404"
Solution: Tournament may still be running. Wait or check status endpoint first

Issue: "Frontend won't load /marl route"
Solution: Ensure you added the route in App.tsx/Router configuration

Issue: "Agents aren't competing properly"
Solution: Verify shared order book initialization. Check console for errors.


CONGRATULATIONS! 🚀

You now have a complete MARL competitive trading system integrated into your sentiment analyzer!

Next: Run real tournaments, analyze emergent strategies, and let your agents compete to find optimal trading strategies.

