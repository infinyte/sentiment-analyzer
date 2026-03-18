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

  beforeEach(() => {
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
  });
});