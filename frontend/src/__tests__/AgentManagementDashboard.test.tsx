import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

vi.mock('../components/MarlCompetitionViewer', () => ({
  MarlCompetitionViewer: () => <div>Mock MARL View</div>,
}));

vi.mock('../components/SocialDashboard', () => ({
  SocialDashboard: () => <div>Mock Social View</div>,
}));

vi.mock('react-chartjs-2', () => ({ Line: () => null }));
vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  CategoryScale: class {},
  LinearScale: class {},
  PointElement: class {},
  LineElement: class {},
  Tooltip: class {},
}));

describe('Agent management dashboard', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let breedTriggered: boolean;
  let retireTriggered: boolean;
  let agentOneLearningProfiles: string[];
  let algorithmByAgent: Record<string, 'Q_TABLE' | 'POLICY_GRADIENT'>;

  beforeEach(() => {
    breedTriggered = false;
    retireTriggered = false;
    agentOneLearningProfiles = ['AGGRESSIVE', 'SCALPING'];
    algorithmByAgent = {
      'agent-1': 'Q_TABLE',
      'agent-2': 'POLICY_GRADIENT',
      'parent-a': 'Q_TABLE',
      'agent-child-1': 'Q_TABLE',
    };
    mockFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/coins?limit=50')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }

      if (url.includes('/api/agents?limit=100')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agents: retireTriggered
              ? []
              : [
                {
                  id: 'agent-1',
                  agent_type: 'MOMENTUM',
                  risk_profile: 'AGGRESSIVE',
                  status: 'ACTIVE',
                  custom_name: 'Signal Hunter',
                  emoji: '🚀',
                  color: '#00FF00',
                  biography: 'Tracks breakout regimes and adapts quickly.',
                  nickname: 'Hunter',
                  age_iterations: 14,
                  generation_number: 3,
                  created_at: '2026-03-17T09:00:00.000Z',
                  total_competitions: 12,
                  total_wins: 8,
                  total_losses: 4,
                  win_rate_percent: 66.7,
                  total_pnl: 1234.56,
                  sharpe_ratio: 1.42,
                  roi_percent: 18.4,
                },
                {
                  id: 'agent-2',
                  agent_type: 'MEAN_REVERSION',
                  risk_profile: 'CONSERVATIVE',
                  status: 'ACTIVE',
                  custom_name: 'Mean Reverter',
                  emoji: '⚡',
                  color: '#0099FF',
                  biography: 'Prefers exhaustion and re-entry setups.',
                  nickname: 'Reverter',
                  age_iterations: 10,
                  generation_number: 3,
                  created_at: '2026-03-16T08:00:00.000Z',
                  total_competitions: 11,
                  total_wins: 6,
                  total_losses: 5,
                  win_rate_percent: 54.5,
                  total_pnl: 640.25,
                  sharpe_ratio: 1.11,
                  roi_percent: 9.1,
                },
                ...(breedTriggered ? [{
                  id: 'agent-child-1',
                  agent_type: 'MOMENTUM',
                  risk_profile: 'AGGRESSIVE',
                  status: 'ACTIVE',
                  custom_name: 'Child One',
                  emoji: '🟢',
                  color: '#00FF00',
                  biography: 'Mutated child.',
                  nickname: 'Child',
                  age_iterations: 0,
                  generation_number: 4,
                  created_at: '2026-03-18T12:00:00.000Z',
                  total_competitions: 0,
                  total_wins: 0,
                  total_losses: 0,
                  win_rate_percent: 0,
                  total_pnl: 0,
                  sharpe_ratio: 0,
                  roi_percent: 0,
                }] : []),
              ],
          }),
        });
      }

      if (url.includes('/api/agents/stats/leaderboard?limit=10')) {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              id: 'agent-1',
              agent_type: 'MOMENTUM',
              risk_profile: 'AGGRESSIVE',
              status: 'ACTIVE',
              custom_name: 'Signal Hunter',
              emoji: '🚀',
              color: '#00FF00',
              biography: 'Tracks breakout regimes and adapts quickly.',
              nickname: 'Hunter',
              age_iterations: 14,
              generation_number: 3,
              created_at: '2026-03-17T09:00:00.000Z',
              total_competitions: 12,
              total_wins: 8,
              total_losses: 4,
              win_rate_percent: 66.7,
              total_pnl: 1234.56,
              sharpe_ratio: 1.42,
              roi_percent: 18.4,
            },
          ]),
        });
      }

      if (url.includes('/api/evolutionary/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: {
              totalTournaments: 2,
              completedTournaments: 1,
              runningTournaments: 1,
              failedTournaments: 0,
              totalGenerations: 3,
              averageTopFitness: 84.5,
              averageGenerationFitness: 66.1,
            },
            crossTournament: {
              bestTournament: {
                tournamentId: 'evo-2',
                name: 'March Finals',
                status: 'COMPLETED',
                completedAt: '2026-03-18T10:15:00.000Z',
                symbols: ['BTC', 'ETH'],
                generationCount: 2,
                latestTopFitness: 92,
                latestAvgFitness: 71,
                latestAvgPnl: 245.2,
                latestSurvivalRate: 50,
              },
              latestVsPrevious: {
                latestTournamentId: 'evo-2',
                previousTournamentId: 'evo-1',
                topFitnessDelta: 8,
                avgFitnessDelta: 5,
                generationCountDelta: 1,
              },
              recentPerformance: [
                {
                  tournamentId: 'evo-2',
                  name: 'March Finals',
                  status: 'COMPLETED',
                  completedAt: '2026-03-18T10:15:00.000Z',
                  symbols: ['BTC', 'ETH'],
                  generationCount: 2,
                  latestTopFitness: 92,
                  latestAvgFitness: 71,
                  latestAvgPnl: 245.2,
                  latestSurvivalRate: 50,
                },
                {
                  tournamentId: 'evo-1',
                  name: 'March Warmup',
                  status: 'RUNNING',
                  completedAt: '2026-03-17T10:15:00.000Z',
                  symbols: ['ETH'],
                  generationCount: 1,
                  latestTopFitness: 84,
                  latestAvgFitness: 66,
                  latestAvgPnl: 132.75,
                  latestSurvivalRate: 75,
                },
              ],
            },
            recentTournaments: [
              {
                tournamentId: 'evo-2',
                name: 'March Finals',
                status: 'COMPLETED',
                currentGeneration: 2,
                maxGenerations: 2,
                populationSize: 4,
                symbols: ['BTC', 'ETH'],
                startedAt: '2026-03-18T10:00:00.000Z',
                completedAt: '2026-03-18T10:15:00.000Z',
                generationCount: 2,
                latestTopFitness: 92,
                latestAvgFitness: 71,
                latestAvgPnl: 245.2,
                latestSurvivalRate: 50,
              },
              {
                tournamentId: 'evo-1',
                name: 'March Warmup',
                status: 'RUNNING',
                currentGeneration: 1,
                maxGenerations: 3,
                populationSize: 4,
                symbols: ['ETH'],
                startedAt: '2026-03-17T10:00:00.000Z',
                completedAt: '2026-03-17T10:15:00.000Z',
                generationCount: 1,
                latestTopFitness: 84,
                latestAvgFitness: 66,
                latestAvgPnl: 132.75,
                latestSurvivalRate: 75,
              },
            ],
            latestTournament: {
              tournamentId: 'evo-2',
              name: 'March Finals',
              status: 'COMPLETED',
              currentGeneration: 2,
              maxGenerations: 2,
              populationSize: 4,
              symbols: ['BTC', 'ETH'],
              startedAt: '2026-03-18T10:00:00.000Z',
              completedAt: '2026-03-18T10:15:00.000Z',
              generationCount: 2,
              latestTopFitness: 92,
              latestAvgFitness: 71,
              latestAvgPnl: 245.2,
              latestSurvivalRate: 50,
              generationTimeline: [
                {
                  generation: 1,
                  topFitness: 88,
                  avgFitness: 63,
                  avgPnl: 140.5,
                  survivalRate: 50,
                  populationCount: 4,
                  survivorCount: 2,
                  offspringCount: 2,
                  retiredCount: 2,
                  completedAt: '2026-03-18T10:05:00.000Z',
                },
                {
                  generation: 2,
                  topFitness: 92,
                  avgFitness: 71,
                  avgPnl: 245.2,
                  survivalRate: 50,
                  populationCount: 4,
                  survivorCount: 2,
                  offspringCount: 2,
                  retiredCount: 2,
                  completedAt: '2026-03-18T10:15:00.000Z',
                },
              ],
            },
          }),
        });
      }

      if (url.endsWith('/api/evolutionary/tournament/evo-2')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tournamentId: 'evo-2',
            name: 'March Finals',
            status: 'COMPLETED',
            currentGeneration: 2,
            startedAt: '2026-03-18T10:00:00.000Z',
            completedAt: '2026-03-18T10:15:00.000Z',
            config: {
              populationSize: 4,
              maxGenerations: 2,
              symbols: ['BTC', 'ETH'],
            },
            generations: [
              {
                generation: 1,
                competitionId: 'comp-1',
                population: ['agent-a', 'agent-b', 'agent-c', 'agent-d'],
                survivors: ['agent-a', 'agent-b'],
                offspring: ['agent-e', 'agent-f'],
                retired: ['agent-c', 'agent-d'],
                topAgentId: 'agent-a',
                topFitness: 88,
                avgFitness: 63,
                completedAt: '2026-03-18T10:05:00.000Z',
              },
              {
                generation: 2,
                competitionId: 'comp-2',
                population: ['agent-a', 'agent-b', 'agent-e', 'agent-f'],
                survivors: ['agent-a', 'agent-e'],
                offspring: ['agent-g', 'agent-h'],
                retired: ['agent-b', 'agent-f'],
                topAgentId: 'agent-a',
                topFitness: 92,
                avgFitness: 71,
                completedAt: '2026-03-18T10:15:00.000Z',
              },
            ],
          }),
        });
      }

      if (url.endsWith('/api/evolutionary/tournament/evo-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tournamentId: 'evo-1',
            name: 'March Warmup',
            status: 'RUNNING',
            currentGeneration: 1,
            startedAt: '2026-03-17T10:00:00.000Z',
            completedAt: '2026-03-17T10:15:00.000Z',
            config: {
              populationSize: 4,
              maxGenerations: 3,
              symbols: ['ETH'],
            },
            generations: [
              {
                generation: 1,
                competitionId: 'comp-old',
                population: ['agent-1', 'agent-2', 'agent-3', 'agent-4'],
                survivors: ['agent-1', 'agent-2', 'agent-3'],
                offspring: ['agent-5'],
                retired: ['agent-4'],
                topAgentId: 'agent-1',
                topFitness: 84,
                avgFitness: 66,
                completedAt: '2026-03-17T10:15:00.000Z',
              },
            ],
          }),
        });
      }

      if (url.endsWith('/api/agents/agent-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'agent-1',
            agent_type: 'MOMENTUM',
            risk_profile: 'AGGRESSIVE',
            status: 'ACTIVE',
            custom_name: 'Signal Hunter',
            emoji: '🚀',
            color: '#00FF00',
            biography: 'Tracks breakout regimes and adapts quickly.',
            nickname: 'Hunter',
            age_iterations: 14,
            generation_number: 3,
            created_at: '2026-03-17T09:00:00.000Z',
            stats: {
              total_competitions: 12,
              total_wins: 8,
              total_losses: 4,
              win_rate_percent: 66.7,
              total_pnl: 1234.56,
              max_drawdown_percent: 9.2,
              sharpe_ratio: 1.42,
              roi_percent: 18.4,
              trades_executed: 71,
              consistency_score: 82,
              avg_trade_profit: 17.38,
            },
          }),
        });
      }

      if (url.endsWith('/api/agents/agent-2')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'agent-2',
            agent_type: 'MEAN_REVERSION',
            risk_profile: 'CONSERVATIVE',
            status: 'ACTIVE',
            custom_name: 'Mean Reverter',
            emoji: '⚡',
            color: '#0099FF',
            biography: 'Prefers exhaustion and re-entry setups.',
            nickname: 'Reverter',
            age_iterations: 10,
            generation_number: 3,
            created_at: '2026-03-16T08:00:00.000Z',
            stats: {
              total_competitions: 11,
              total_wins: 6,
              total_losses: 5,
              win_rate_percent: 54.5,
              total_pnl: 640.25,
              max_drawdown_percent: 6.4,
              sharpe_ratio: 1.11,
              roi_percent: 9.1,
              trades_executed: 54,
              consistency_score: 76,
              avg_trade_profit: 11.85,
            },
          }),
        });
      }

      if (url.includes('/api/agents/agent-1/history?limit=12')) {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              competition_id: 'tour-9',
              rank_position: 1,
              starting_capital: 10000,
              ending_capital: 10650,
              pnl: 650,
              trades_count: 8,
              win_trades: 5,
              loss_trades: 3,
              largest_win: 210,
              largest_loss: -80,
              sharpe_ratio: 1.5,
              completed_at: '2026-03-18T10:30:00.000Z',
            },
          ]),
        });
      }

      if (url.includes('/api/agents/agent-1/genome')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId: 'agent-1',
            genome: {
              position_size: 0.12,
              sentiment_weight: 0.28,
            },
          }),
        });
      }

      if (url.includes('/api/agents/agent-1/genealogy')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId: 'agent-1',
            genealogy: [
              {
                id: 'lineage-1',
                agentId: 'agent-1',
                parent1Id: 'parent-a',
                parent2Id: 'parent-b',
                breedingDate: '2026-03-15T12:00:00.000Z',
                breedingGeneration: 3,
                inheritedGenes: { sentiment_weight: 0.28 },
                mutationsApplied: ['sharpe_bias'],
                mutationSeverity: 2,
                offspringCount: 1,
              },
            ],
          }),
        });
      }

      if (url.endsWith('/api/agents/parent-a')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'parent-a',
            agent_type: 'MOMENTUM',
            risk_profile: 'AGGRESSIVE',
            status: 'RETIRED',
            custom_name: 'Parent Alpha',
            emoji: '🌟',
            color: '#800080',
            biography: 'Archived parent strategist.',
            nickname: 'Alpha',
            age_iterations: 20,
            generation_number: 2,
            created_at: '2026-03-14T08:00:00.000Z',
            stats: {
              total_competitions: 18,
              total_wins: 11,
              total_losses: 7,
              win_rate_percent: 61.1,
              total_pnl: 980.15,
              max_drawdown_percent: 8.1,
              sharpe_ratio: 1.31,
              roi_percent: 12.7,
              trades_executed: 89,
              consistency_score: 80,
              avg_trade_profit: 12.1,
            },
          }),
        });
      }

      if (url.includes('/api/agents/parent-a/history?limit=12')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
      }

      if (url.includes('/api/agents/parent-a/genome')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'parent-a', genome: { exploration_decay: 0.99 } }) });
      }

      if (url.includes('/api/agents/parent-a/genealogy')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'parent-a', genealogy: [] }) });
      }

      if (url.includes('/api/agents/agent-2/history?limit=12')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
      }

      if (url.includes('/api/agents/agent-2/genome')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'agent-2', genome: { risk_bias: 0.42 } }) });
      }

      if (url.includes('/api/agents/agent-2/genealogy')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'agent-2', genealogy: [] }) });
      }

      if (url.endsWith('/api/agents/agent-1/customize') && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'agent-1',
            custom_name: 'Signal Vanguard',
            emoji: '🔥',
            color: '#FFA500',
            biography: 'Updated bio',
            nickname: 'Vanguard',
          }),
        });
      }

      if (url.endsWith('/api/agents/agent-1/retire') && init?.method === 'POST') {
        retireTriggered = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({ retired: true, agent: { id: 'agent-1', status: 'RETIRED' } }),
        });
      }

      if (url.endsWith('/api/agents/agent-2/retire') && init?.method === 'POST') {
        retireTriggered = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({ retired: true, agent: { id: 'agent-2', status: 'RETIRED' } }),
        });
      }

      if (url.endsWith('/api/agents/agent-child-1/retire') && init?.method === 'POST') {
        retireTriggered = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({ retired: true, agent: { id: 'agent-child-1', status: 'RETIRED' } }),
        });
      }

      if (url.endsWith('/api/evolutionary/breed') && init?.method === 'POST') {
        breedTriggered = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            parentIds: ['agent-1', 'agent-2'],
            childCount: 1,
            crossoverStrategy: 'UNIFORM',
            mutationSeverity: 'MEDIUM',
            children: [
              {
                id: 'agent-child-1',
                agentType: 'MOMENTUM',
                riskProfile: 'AGGRESSIVE',
                generationNumber: 4,
                status: 'ACTIVE',
                parent1Id: 'agent-1',
                parent2Id: 'agent-2',
                mutationsApplied: ['position_size'],
                mutationSeverity: 'MEDIUM',
              },
            ],
          }),
        });
      }

      if (url.endsWith('/api/agents/agent-child-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'agent-child-1',
            agent_type: 'MOMENTUM',
            risk_profile: 'AGGRESSIVE',
            status: 'ACTIVE',
            custom_name: 'Child One',
            emoji: '🟢',
            color: '#00FF00',
            biography: 'Mutated child.',
            nickname: 'Child',
            age_iterations: 0,
            generation_number: 4,
            created_at: '2026-03-18T12:00:00.000Z',
            stats: {
              total_competitions: 0,
              total_wins: 0,
              total_losses: 0,
              win_rate_percent: 0,
              total_pnl: 0,
              max_drawdown_percent: 0,
              sharpe_ratio: 0,
              roi_percent: 0,
              trades_executed: 0,
              consistency_score: 0,
              avg_trade_profit: 0,
            },
          }),
        });
      }

      if (url.includes('/api/agents/agent-child-1/history?limit=12')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
      }

      if (url.includes('/api/agents/agent-child-1/genome')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'agent-child-1', genome: { position_size: 0.14 } }) });
      }

      if (url.includes('/api/agents/agent-child-1/genealogy')) {
        return Promise.resolve({ ok: true, json: async () => ({ agentId: 'agent-child-1', genealogy: [] }) });
      }

      if (url.includes('/api/marl/evolution/best-genome')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId: 'agent-1',
            fitnessScore: 92.5,
            tournamentId: 'evo-2',
            generation: 2,
            foundAt: '2026-03-18T10:15:00.000Z',
            genome: { position_size: 0.12, sentiment_weight: 0.28 },
          }),
        });
      }

      if (url.endsWith('/api/marl/agents/learning')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            count: agentOneLearningProfiles.length + 1,
            agents: [
              ...agentOneLearningProfiles.map(riskProfile => ({
                cacheKey: `agent-1::${riskProfile}`,
                agentId: 'agent-1',
                riskProfile,
              })),
              {
                cacheKey: 'agent-2::CONSERVATIVE',
                agentId: 'agent-2',
                riskProfile: 'CONSERVATIVE',
              },
            ],
          }),
        });
      }

      if (url.includes('/api/marl/agents/agent-1/learning') && init?.method === 'DELETE') {
        const parsedUrl = new URL(url);
        const riskProfile = parsedUrl.searchParams.get('riskProfile');

        if ((init.headers as Record<string, string> | undefined)?.['x-api-key'] !== 'secret-key') {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized — x-api-key header required' }),
          });
        }

        if (riskProfile) {
          agentOneLearningProfiles = agentOneLearningProfiles.filter(profile => profile !== riskProfile);
        } else {
          agentOneLearningProfiles = [];
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            agentId: 'agent-1',
            riskProfile: riskProfile ?? 'all profiles',
            cleared: riskProfile ? 1 : 2,
            message: riskProfile
              ? `Cleared learning state for ${riskProfile}.`
              : 'Cleared learning state for all profiles.',
          }),
        });
      }

      if (url.includes('/api/marl/agents/') && url.endsWith('/algorithm') && init?.method === 'POST') {
        const agentId = url.split('/api/marl/agents/')[1]!.replace('/algorithm', '');
        const parsedBody = typeof init.body === 'string'
          ? JSON.parse(init.body) as { algorithm?: string }
          : {};
        const algorithm = String(parsedBody.algorithm ?? '').toUpperCase();

        if (algorithm === 'DQN') {
          return Promise.resolve({
            ok: false,
            status: 501,
            json: async () => ({
              error: 'DQN via TensorFlow is not bundled. Use Q_TABLE or POLICY_GRADIENT.',
              supported: ['Q_TABLE', 'POLICY_GRADIENT'],
            }),
          });
        }

        if (algorithm !== 'Q_TABLE' && algorithm !== 'POLICY_GRADIENT') {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({
              error: 'algorithm must be one of: Q_TABLE, POLICY_GRADIENT',
              supported: ['Q_TABLE', 'POLICY_GRADIENT'],
            }),
          });
        }

        algorithmByAgent[agentId] = algorithm;

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            agentId,
            algorithm,
            note: 'Agent uses a combined Q-table + policy-gradient network by default. The algorithm selection is informational — all agents in this build use the hybrid.',
            policyNetwork: {
              architecture: 'Feedforward 50→128(ReLU)→64(ReLU)→5(Softmax)',
              updateRule: 'Advantage-weighted gradient-free nudge',
              replayBuffer: 'Up to 1 000 experiences',
            },
          }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch request: ${url}`));
    });

    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads the agents view and saves customization changes', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await screen.findByText('Agent Management');
    await screen.findByText('Genome Snapshot');
    await screen.findByText('Generation Trends');
    await screen.findByText('Tournament History');
    await screen.findByText('Latest Tournament Fitness Distribution');
    await screen.findByText('Tournament Detail');
    await screen.findByText('Cross-Tournament Comparison');
    await screen.findByText('Genealogy Tree');
    await screen.findByLabelText('Agent lineage graph');
    await screen.findByText('sharpe_bias');
    await screen.findByText('PnL curve');
    await screen.findByText('Survival curve');
    await screen.findByText('comp-1');

    fireEvent.change(screen.getByLabelText('Filter tournaments by status'), { target: { value: 'RUNNING' } });

    await screen.findByRole('button', { name: /March Warmup/i });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /March Finals/i })).toBeNull();
    });

    fireEvent.change(screen.getByLabelText('Filter tournaments by status'), { target: { value: 'ALL' } });
    fireEvent.change(screen.getByLabelText('Filter tournaments by symbol'), { target: { value: 'BTC' } });

    fireEvent.click(screen.getByRole('button', { name: /March Finals/i }));

    await screen.findByText('BTC, ETH');

    fireEvent.change(screen.getByLabelText('Filter generations from'), { target: { value: '2' } });
    await waitFor(() => {
      expect(screen.queryByText('comp-1')).toBeNull();
    });
    await screen.findByText('comp-2');

    fireEvent.change(screen.getByLabelText('Filter generations from'), { target: { value: '1' } });

    fireEvent.click(screen.getAllByRole('button', { name: /Parent 1/i })[0]!);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/agents/parent-a');
    });

    await screen.findByText('Archived parent strategist.');

    fireEvent.click(screen.getAllByRole('button', { name: /Signal Hunter/i })[0]!);

    await screen.findByText('Tracks breakout regimes and adapts quickly.');

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));

    await screen.findByRole('dialog', { name: 'Customize 🚀 Signal Hunter' });

    fireEvent.change(screen.getByLabelText('Custom name'), { target: { value: 'Signal Vanguard' } });
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Vanguard' } });
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: '🔥' } });
    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#FFA500' } });
    fireEvent.change(screen.getByLabelText('Biography'), { target: { value: 'Updated bio' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent-1/customize', expect.objectContaining({ method: 'PUT' }));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/agents?limit=100');
    });
  }, 60000);

  it('marks agents ready to evolve, breeds children, and retires weak agents', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await screen.findByText('Agent Management');
    await screen.findByRole('button', { name: 'Mark Ready To Evolve' });

    fireEvent.click(screen.getByRole('button', { name: 'Mark Ready To Evolve' }));
    fireEvent.click(screen.getByRole('button', { name: /Mean Reverter/i }));
    await screen.findByText('Prefers exhaustion and re-entry setups.');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Ready To Evolve' }));

    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Mutated Children' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/evolutionary/breed', expect.objectContaining({ method: 'POST' }));
    });

    await screen.findByText('Created 1 child agents from 2 selected parents.');
    await screen.findByText('Mutated child.');

    fireEvent.click(screen.getByRole('button', { name: 'Kill Agent' }));

    await screen.findByRole('dialog', { name: 'Confirm retirement for 🟢 Child One' });
    expect(mockFetch).not.toHaveBeenCalledWith('/api/agents/agent-child-1/retire', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Kill Agent' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/agents/agent-child-1/retire', expect.objectContaining({ method: 'POST' }));
    });
  }, 60000);

  it('lists learning states and resets one profile or all profiles for an agent', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await screen.findByText('Learning States');
    await screen.findByText('SCALPING');
    expect(screen.getAllByText('Risk profile learning state')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Admin API key for learning state reset'), {
      target: { value: 'secret-key' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[0]!);

    await screen.findByRole('dialog', { name: 'Reset learning state confirmation' });
    await screen.findByText(/AGGRESSIVE profile/i);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/marl/agents/agent-1/learning?riskProfile=AGGRESSIVE'),
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
        }),
      );
    });

    await screen.findByText('Cleared learning state for AGGRESSIVE.');
    await waitFor(() => {
      expect(screen.getAllByText('Risk profile learning state')).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset All Profiles' }));
    await screen.findByRole('dialog', { name: 'Reset learning state confirmation' });
    await screen.findByText(/ALL risk profiles/i);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reset' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/marl/agents/agent-1/learning'),
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ 'x-api-key': 'secret-key' }),
        }),
      );
    });

    await screen.findByText('Cleared learning state for all profiles.');
    await screen.findByText('No learning state stored for this agent.');
  }, 60000);

  it('shows current algorithm state, updates supported values, and surfaces unsupported API errors', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await screen.findByText('Algorithm');
    await screen.findByText('Current algorithm');
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/marl/agents/agent-1/algorithm',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ algorithm: 'Q_TABLE' }),
        }),
      );
    });

    await screen.findByText('Feedforward 50→128(ReLU)→64(ReLU)→5(Softmax)');

    fireEvent.change(screen.getByLabelText('Select algorithm'), {
      target: { value: 'POLICY_GRADIENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Algorithm' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/marl/agents/agent-1/algorithm',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ algorithm: 'POLICY_GRADIENT' }),
        }),
      );
    });

    await screen.findByText('Algorithm updated to POLICY_GRADIENT.');
    await waitFor(() => {
      expect(screen.getAllByText('POLICY_GRADIENT').length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByLabelText('Select algorithm'), {
      target: { value: 'DQN' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Algorithm' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('DQN via TensorFlow is not bundled. Use Q_TABLE or POLICY_GRADIENT.');
    expect(screen.getAllByText('POLICY_GRADIENT').length).toBeGreaterThan(0);
  }, 60000);
});

describe('AgentManagementDashboard — Issue 6 tournament detail enhancements', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let rollbackFails: boolean;

  beforeEach(() => {
    rollbackFails = false;

    mockFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/coins?limit=50')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }

      if (url.includes('/api/agents?limit=100')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agents: [
              {
                id: 'adversary-1',
                agent_type: 'ADVERSARY',
                risk_profile: 'AGGRESSIVE',
                status: 'ACTIVE',
                custom_name: 'Counter Strike',
                emoji: '⚔️',
                color: '#dc2626',
                biography: 'Adversary agent designed to stress-test sentiment agents.',
                nickname: 'Counter',
                age_iterations: 5,
                generation_number: 2,
                created_at: '2026-03-18T09:00:00.000Z',
                total_competitions: 3,
                total_wins: 1,
                total_losses: 2,
                win_rate_percent: 33.3,
                total_pnl: -120.0,
                sharpe_ratio: -0.5,
                roi_percent: -1.2,
              },
              {
                id: 'agent-1',
                agent_type: 'MOMENTUM',
                risk_profile: 'AGGRESSIVE',
                status: 'ACTIVE',
                custom_name: 'Signal Hunter',
                emoji: '🚀',
                color: '#00FF00',
                biography: 'Tracks breakout regimes.',
                nickname: 'Hunter',
                age_iterations: 14,
                generation_number: 3,
                created_at: '2026-03-17T09:00:00.000Z',
                total_competitions: 12,
                total_wins: 8,
                total_losses: 4,
                win_rate_percent: 66.7,
                total_pnl: 1234.56,
                sharpe_ratio: 1.42,
                roi_percent: 18.4,
              },
            ],
          }),
        });
      }

      if (url.includes('/api/agents/stats/leaderboard?limit=10')) {
        return Promise.resolve({
          ok: true,
          json: async () => ([
            {
              id: 'agent-1',
              agent_type: 'MOMENTUM',
              risk_profile: 'AGGRESSIVE',
              status: 'ACTIVE',
              custom_name: 'Signal Hunter',
              emoji: '🚀',
              color: '#00FF00',
              biography: 'Tracks breakout regimes.',
              nickname: 'Hunter',
              age_iterations: 14,
              generation_number: 3,
              created_at: '2026-03-17T09:00:00.000Z',
              total_competitions: 12,
              total_wins: 8,
              total_losses: 4,
              win_rate_percent: 66.7,
              total_pnl: 1234.56,
              sharpe_ratio: 1.42,
              roi_percent: 18.4,
            },
          ]),
        });
      }

      if (url.includes('/api/evolutionary/summary')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            totals: {
              totalTournaments: 1,
              completedTournaments: 1,
              runningTournaments: 0,
              failedTournaments: 0,
              totalGenerations: 2,
              averageTopFitness: 82.0,
              averageGenerationFitness: 65.0,
            },
            crossTournament: {
              bestTournament: {
                tournamentId: 'evo-3',
                name: 'Claude Finals',
                status: 'COMPLETED',
                completedAt: '2026-03-19T11:00:00.000Z',
                symbols: ['BTC', 'ETH'],
                generationCount: 2,
                latestTopFitness: 82,
                latestAvgFitness: 65,
                latestAvgPnl: 310.5,
                latestSurvivalRate: 30,
              },
              latestVsPrevious: null,
              recentPerformance: [
                {
                  tournamentId: 'evo-3',
                  name: 'Claude Finals',
                  status: 'COMPLETED',
                  completedAt: '2026-03-19T11:00:00.000Z',
                  symbols: ['BTC', 'ETH'],
                  generationCount: 2,
                  latestTopFitness: 82,
                  latestAvgFitness: 65,
                  latestAvgPnl: 310.5,
                  latestSurvivalRate: 30,
                },
              ],
            },
            recentTournaments: [
              {
                tournamentId: 'evo-3',
                name: 'Claude Finals',
                status: 'COMPLETED',
                currentGeneration: 2,
                maxGenerations: 2,
                populationSize: 8,
                symbols: ['BTC', 'ETH'],
                startedAt: '2026-03-19T10:30:00.000Z',
                completedAt: '2026-03-19T11:00:00.000Z',
                generationCount: 2,
                latestTopFitness: 82,
                latestAvgFitness: 65,
                latestAvgPnl: 310.5,
                latestSurvivalRate: 30,
              },
            ],
            latestTournament: {
              tournamentId: 'evo-3',
              name: 'Claude Finals',
              status: 'COMPLETED',
              currentGeneration: 2,
              maxGenerations: 2,
              populationSize: 8,
              symbols: ['BTC', 'ETH'],
              startedAt: '2026-03-19T10:30:00.000Z',
              completedAt: '2026-03-19T11:00:00.000Z',
              generationCount: 2,
              latestTopFitness: 82,
              latestAvgFitness: 65,
              latestAvgPnl: 310.5,
              latestSurvivalRate: 30,
              generationTimeline: [
                {
                  generation: 1,
                  topFitness: 75,
                  avgFitness: 58,
                  avgPnl: 180.0,
                  survivalRate: 30,
                  populationCount: 8,
                  survivorCount: 3,
                  offspringCount: 5,
                  retiredCount: 5,
                  completedAt: '2026-03-19T10:45:00.000Z',
                },
                {
                  generation: 2,
                  topFitness: 82,
                  avgFitness: 65,
                  avgPnl: 310.5,
                  survivalRate: 30,
                  populationCount: 8,
                  survivorCount: 3,
                  offspringCount: 5,
                  retiredCount: 5,
                  completedAt: '2026-03-19T11:00:00.000Z',
                },
              ],
            },
          }),
        });
      }

      if (url.endsWith('/api/evolutionary/tournament/evo-3')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tournamentId: 'evo-3',
            name: 'Claude Finals',
            status: 'COMPLETED',
            currentGeneration: 2,
            startedAt: '2026-03-19T10:30:00.000Z',
            completedAt: '2026-03-19T11:00:00.000Z',
            config: {
              populationSize: 8,
              maxGenerations: 2,
              symbols: ['BTC', 'ETH'],
              claudeOrchestrated: true,
              adversarialTraining: true,
            },
            generations: [
              {
                generation: 1,
                competitionId: 'comp-adv-1',
                population: ['agent-aa', 'agent-bb', 'adversary-aa'],
                survivors: ['agent-aa', 'agent-bb'],
                offspring: ['agent-cc'],
                retired: ['adversary-aa'],
                topAgentId: 'agent-aa',
                topFitness: 75.0,
                avgFitness: 58.0,
                completedAt: '2026-03-19T10:45:00.000Z',
                claudeDirective: {
                  generation: 1,
                  mutationSeverity: 'MEDIUM',
                  survivalPercent: 30,
                  crossoverStrategy: 'UNIFORM',
                  diversityBoost: false,
                  reasoning: 'Population showing moderate diversity, standard parameters apply.',
                },
                adversarialSummary: {
                  sentimentAgentsCount: 2,
                  adversaryAgentsCount: 1,
                  sentimentWinRate: 100.0,
                  beatingAgentIds: ['agent-aa', 'agent-bb'],
                  matchups: [
                    {
                      sentimentAgentId: 'sent-agent-aa',
                      adversaryAgentId: 'adv-agent-aa',
                      sentimentFitness: 75.0,
                      adversaryFitness: 40.5,
                      sentimentWon: true,
                    },
                    {
                      sentimentAgentId: 'sent-agent-bb',
                      adversaryAgentId: 'adv-agent-aa',
                      sentimentFitness: 38.0,
                      adversaryFitness: 40.5,
                      sentimentWon: false,
                    },
                  ],
                },
              },
              {
                generation: 2,
                competitionId: 'comp-adv-2',
                population: ['agent-aa', 'agent-bb', 'agent-cc'],
                survivors: ['agent-aa'],
                offspring: ['agent-dd'],
                retired: ['agent-bb', 'agent-cc'],
                topAgentId: 'agent-aa',
                topFitness: 82.0,
                avgFitness: 65.0,
                completedAt: '2026-03-19T11:00:00.000Z',
                claudeDirective: {
                  generation: 2,
                  mutationSeverity: 'LIGHT',
                  survivalPercent: 25,
                  crossoverStrategy: 'BLENDED',
                  diversityBoost: true,
                  reasoning: 'Strong top fitness warrants LIGHT mutation to preserve gains.',
                },
              },
            ],
          }),
        });
      }

      if (url.includes('/api/evolutionary/tournament/evo-3/rollback') && init?.method === 'POST') {
        if (rollbackFails) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Generation 99 checkpoint not found' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, restoredGeneration: 1 }),
        });
      }

      if (url.endsWith('/api/agents/agent-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'agent-1',
            agent_type: 'MOMENTUM',
            risk_profile: 'AGGRESSIVE',
            status: 'ACTIVE',
            custom_name: 'Signal Hunter',
            emoji: '🚀',
            color: '#00FF00',
            biography: 'Tracks breakout regimes.',
            nickname: 'Hunter',
            age_iterations: 14,
            generation_number: 3,
            created_at: '2026-03-17T09:00:00.000Z',
            stats: {
              total_competitions: 12,
              total_wins: 8,
              total_losses: 4,
              win_rate_percent: 66.7,
              total_pnl: 1234.56,
              max_drawdown_percent: 9.2,
              sharpe_ratio: 1.42,
              roi_percent: 18.4,
              trades_executed: 71,
              consistency_score: 82,
              avg_trade_profit: 17.38,
            },
          }),
        });
      }

      if (url.includes('/api/agents/agent-1/history')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
      }

      if (url.includes('/api/agents/agent-1/genome')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ agentId: 'agent-1', genome: { position_size: 0.12 } }),
        });
      }

      if (url.includes('/api/agents/agent-1/genealogy')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ agentId: 'agent-1', genealogy: [] }),
        });
      }

      if (url.endsWith('/api/agents/adversary-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'adversary-1',
            agent_type: 'ADVERSARY',
            risk_profile: 'AGGRESSIVE',
            status: 'ACTIVE',
            custom_name: 'Counter Strike',
            emoji: '⚔️',
            color: '#dc2626',
            biography: 'Adversary agent.',
            nickname: 'Counter',
            age_iterations: 5,
            generation_number: 2,
            created_at: '2026-03-18T09:00:00.000Z',
            stats: {
              total_competitions: 3,
              total_wins: 1,
              total_losses: 2,
              win_rate_percent: 33.3,
              total_pnl: -120.0,
              max_drawdown_percent: 5.0,
              sharpe_ratio: -0.5,
              roi_percent: -1.2,
              trades_executed: 15,
              consistency_score: 40,
              avg_trade_profit: -8.0,
            },
          }),
        });
      }

      if (url.includes('/api/agents/adversary-1/history')) {
        return Promise.resolve({ ok: true, json: async () => ([]) });
      }

      if (url.includes('/api/agents/adversary-1/genome')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId: 'adversary-1',
            genome: { modelArchitecture: 'LSTM', epsilon: 0.3 },
          }),
        });
      }

      if (url.includes('/api/agents/adversary-1/genealogy')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ agentId: 'adversary-1', genealogy: [] }),
        });
      }

      if (url.includes('/api/marl/evolution/best-genome')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId: 'agent-1',
            fitnessScore: 82.0,
            tournamentId: 'evo-3',
            generation: 2,
            foundAt: '2026-03-19T11:00:00.000Z',
            genome: { position_size: 0.12 },
          }),
        });
      }

      if (url.endsWith('/api/marl/agents/learning')) {
        return Promise.resolve({ ok: true, json: async () => ({ count: 0, agents: [] }) });
      }

      if (url.includes('/api/marl/agents/') && url.endsWith('/algorithm') && init?.method === 'POST') {
        const agentId = url.split('/api/marl/agents/')[1]!.replace('/algorithm', '');
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agentId,
            algorithm: 'Q_TABLE',
            policyNetwork: {
              architecture: 'Feedforward',
              updateRule: 'Gradient',
              replayBuffer: '1000',
            },
          }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });

    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Claude-orchestrated badge, Adversarial Training badge, and Pop N badge in tournament detail (AC7)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('comp-adv-1');
    expect(screen.getByText('Claude-orchestrated')).toBeTruthy();
    expect(screen.getByText('Adversarial Training')).toBeTruthy();
    expect(screen.getByText('Pop 8')).toBeTruthy();
  }, 30000);

  it('shows positive fitness trend badge for generation 2 relative to generation 1 (AC5)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    // evo-3 auto-loads; both generations visible (range set to 1–2 on load)
    await screen.findByText('comp-adv-2');
    // avgFitness went 58 → 65, trend = +7.0
    expect(screen.getByText('+7.0 avg')).toBeTruthy();
  }, 30000);

  it('renders adversarial matchup table with WIN and LOSS result badges (AC3)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('Adversarial Round');
    await screen.findByText('Sentiment agent');
    expect(screen.getAllByText('WIN').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('LOSS').length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('renders Claude directive block with mutation severity, crossover strategy, and reasoning text (AC4)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('Claude Directive');
    // Gen 1 directive params
    await screen.findByText(
      'Population showing moderate diversity, standard parameters apply.',
    );
    // Gen 2 directive params (diversityBoost + reasoning)
    await screen.findByText('Strong top fitness warrants LIGHT mutation to preserve gains.');
    expect(screen.getByText('+Diversity boost')).toBeTruthy();
  }, 30000);

  it('renders ADVERSARY badge for adversary agents in the agent registry list (AC1)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('Agent Management');
    // Badge appears in the agent list button; agent_type also renders in the detail panel
    const adversaryLabels = await screen.findAllByText('ADVERSARY');
    expect(adversaryLabels.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('shows LSTM architecture badge in the genome snapshot for an agent with modelArchitecture (AC2)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('Agent Management');
    fireEvent.click(screen.getByRole('button', { name: /Counter Strike/i }));
    await screen.findByText('LSTM');
  }, 30000);

  it('shows success message after restore checkpoint completes (AC6 success)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('comp-adv-1');
    const restoreButtons = await screen.findAllByRole('button', { name: 'Restore checkpoint' });
    expect(restoreButtons.length).toBeGreaterThan(0);
    fireEvent.click(restoreButtons[0]!);
    await screen.findByText(/Checkpoint for generation \d+ restored successfully/);
  }, 30000);

  it('shows Restoring... while rollback fetch is in flight (AC6 loading state)', async () => {
    let resolveRollback!: (value: unknown) => void;
    const originalImpl = mockFetch.getMockImplementation() as (input: string | URL | Request, init?: RequestInit) => Promise<unknown>;
    mockFetch.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/evo-3/rollback') && init?.method === 'POST') {
        return new Promise(res => { resolveRollback = res; });
      }
      return originalImpl(input, init);
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('comp-adv-1');
    const restoreButtons = await screen.findAllByRole('button', { name: 'Restore checkpoint' });
    fireEvent.click(restoreButtons[0]!);
    await screen.findByText('Restoring...');
    resolveRollback({ ok: true, json: async () => ({}) });
    await screen.findByText(/Checkpoint for generation \d+ restored successfully/);
  }, 30000);

  it('shows an error alert when restore checkpoint API returns a failure (AC6 error path)', async () => {
    rollbackFails = true;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByText('comp-adv-1');
    const restoreButtons = await screen.findAllByRole('button', { name: 'Restore checkpoint' });
    fireEvent.click(restoreButtons[0]!);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Generation 99 checkpoint not found');
  }, 30000);
});