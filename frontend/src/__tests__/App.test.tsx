import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import App from '../App';

vi.mock('../components/MarlCompetitionViewer', () => ({
  MarlCompetitionViewer: () => <div>Mock MARL View</div>,
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

describe('App detail modal', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'healthy',
            services: {
              coingecko: 'ok',
              newsapi: 'ok',
              claude_api: 'ok',
              sqlite: 'ok',
            },
            uptime_seconds: 120,
          }),
        });
      }

      if (url.includes('/api/agents/configure')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            configured: 1,
            agents: [
              {
                agentId: 'agent_1',
                type: 'RULE_BASED',
                riskProfile: 'CONSERVATIVE',
                initialCapital: 10000,
              },
            ],
            readyForBacktesting: true,
          }),
        });
      }

      if (url.includes('/api/backtest/run')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            testId: 'backtest_123',
            status: 'COMPLETED',
            topPerformer: 'agent_1',
            results: [
              {
                agentId: 'agent_1',
                agentType: 'RULE_BASED',
                riskProfile: 'CONSERVATIVE',
                totalReturnPct: 12.5,
                winRate: 58.2,
                profitFactor: 1.42,
                maxDrawdown: 4.1,
                sharpeRatio: 1.11,
                totalTrades: 7,
              },
            ],
            summary: {
              averageReturn: 12.5,
              bestReturn: 12.5,
              worstReturn: 12.5,
              averageWinRate: 58.2,
              narrative: 'Rule-based agents held up well in the selected window.',
            },
          }),
        });
      }

      if (url.includes('/api/backtest/results/backtest_123')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            testId: 'backtest_123',
            config: {
              symbols: ['BTC', 'ETH'],
              startDate: '2024-01-01T00:00:00.000Z',
              endDate: '2024-06-30T00:00:00.000Z',
              slippageModel: 'FIXED',
              commissionPct: 0.001,
              agentConfigs: [
                {
                  agentId: 'agent_1',
                  type: 'RULE_BASED',
                  riskProfile: 'CONSERVATIVE',
                  initialCapital: 10000,
                },
              ],
            },
            agentResults: [
              {
                agentId: 'agent_1',
                agentType: 'RULE_BASED',
                riskProfile: 'CONSERVATIVE',
                metrics: {
                  totalTrades: 7,
                  winRate: 0.582,
                  profitFactor: 1.42,
                  totalReturnPct: 0.125,
                  maxDrawdown: 0.041,
                  sharpeRatio: 1.11,
                  equityCurve: [
                    { date: '2024-01-01T00:00:00.000Z', capital: 10000 },
                    { date: '2024-06-30T00:00:00.000Z', capital: 11250 },
                  ],
                },
                trades: [],
              },
            ],
            comparison: {
              topPerformerByReturn: 'agent_1',
              averageReturn: 0.125,
              bestReturn: 0.125,
              worstReturn: 0.125,
              averageWinRate: 0.582,
              summary: 'Rule-based agents held up well in the selected window.',
            },
            startedAt: '2024-01-01T00:00:00.000Z',
            completedAt: '2024-06-30T00:00:00.000Z',
          }),
        });
      }

      if (url.includes('/api/coins?limit=50')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'bitcoin',
                symbol: 'BTC',
                name: 'Bitcoin',
                price_usd: 65000,
                market_cap_usd: 1_000_000_000,
                volume_24h_usd: 100_000_000,
                price_change_24h_percent: 2.5,
                price_change_7d_percent: 8.4,
                volatility_24h: 4.2,
                sentiment_score: 'BULL',
                sentiment_confidence: 0.82,
                sentiment_summary: 'Positive momentum backed by strong signal quality.',
                trending_score: 44.5,
                market_rank: 1,
              },
            ],
          }),
        });
      }

      if (url.includes('/api/coins/BTC?days=7')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            coin: {
              id: 'bitcoin',
              symbol: 'BTC',
              name: 'Bitcoin',
              price_usd: 65000,
              market_cap_usd: 1_000_000_000,
              volume_24h_usd: 100_000_000,
              price_change_24h_percent: 2.5,
              price_change_7d_percent: 8.4,
              volatility_24h: 4.2,
              sentiment_score: 'BULL',
              sentiment_confidence: 0.82,
              sentiment_summary: 'Positive momentum backed by strong signal quality.',
              trending_score: 44.5,
              market_rank: 1,
            },
            price_history: [
              { timestamp: new Date().toISOString(), open: 64000, high: 65500, low: 63500, close: 65000 },
            ],
            headlines: ['Bitcoin rally continues after ETF inflows'],
            scored_items: [
              {
                id: 'news-1',
                source: 'newsapi',
                source_label: 'CoinDesk',
                title: 'Bitcoin rally continues after ETF inflows',
                body: 'Institutional demand remains firm and market breadth is improving.',
                url: 'https://example.com/btc-rally',
                published_at: '2026-03-17T08:00:00.000Z',
                engagement_score: 0.24,
                recency_score: 0.93,
                relevance_score: 0.91,
                keyword_score: 0.75,
                sentiment_score: 0.72,
                weighted_score: 0.61,
                source_weight: 1,
              },
            ],
            sentiment_today: {
              sentiment_score: 'BULL',
              confidence: 0.82,
              summary: 'Positive momentum backed by strong signal quality.',
              key_catalysts: ['ETF inflows'],
              risk_factors: ['Macro uncertainty'],
              short_term_outlook: 'Near-term bias remains constructive while signal breadth holds.',
              volatility_warning: false,
              trending_score: 44.5,
              source_breakdown: [
                {
                  source: 'newsapi',
                  source_label: 'CoinDesk',
                  item_count: 1,
                  average_sentiment_score: 0.72,
                  average_weighted_score: 0.61,
                  weighted_frequency: 0.93,
                },
              ],
              collection_stats: {
                total_items: 1,
                source_count: 1,
                weighted_frequency: 0.93,
                average_recency_score: 0.93,
                trending_score: 44.5,
                collected_at: '2026-03-17T08:05:00.000Z',
              },
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

  it('renders source breakdown and scored market signals in the detail modal', async () => {
    render(<App />);

    await screen.findByText('Bitcoin');
    fireEvent.click(screen.getByText('Bitcoin'));

    await screen.findByText('Signal Overview');

    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Scored Market Signals')).toBeInTheDocument();
    expect(screen.getAllByText('CoinDesk')).toHaveLength(2);
    expect(screen.getAllByText('Bitcoin rally continues after ETF inflows')).toHaveLength(2);
    expect(screen.getByText('Near-term bias remains constructive while signal breadth holds.')).toBeInTheDocument();
    expect(screen.getByText('Trending Score')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/coins/BTC?days=7');
    });
  });

  it('opens the detail modal from the top ticker search', async () => {
    render(<App />);

    await screen.findByText('Bitcoin');

    fireEvent.change(screen.getByLabelText('Search ticker'), { target: { value: 'btc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await screen.findByText('Signal Overview');

    expect(screen.getByText('Scored Market Signals')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/coins/BTC?days=7');
    });
  });

  it('keeps navigation usable when the health endpoint is unavailable', async () => {
    mockFetch.mockImplementation((input: string | URL | Request) => {
      const url = String(input);

      if (url.includes('/api/health')) {
        return Promise.reject(new Error('Network down'));
      }

      if (url.includes('/api/coins?limit=50')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'bitcoin',
                symbol: 'BTC',
                name: 'Bitcoin',
                price_usd: 65000,
                market_cap_usd: 1_000_000_000,
                volume_24h_usd: 100_000_000,
                price_change_24h_percent: 2.5,
                price_change_7d_percent: 8.4,
                volatility_24h: 4.2,
                sentiment_score: 'BULL',
                sentiment_confidence: 0.82,
                sentiment_summary: 'Positive momentum backed by strong signal quality.',
                trending_score: 44.5,
                market_rank: 1,
              },
            ],
          }),
        });
      }

      if (url.includes('/api/coins/BTC?days=7')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            coin: {
              id: 'bitcoin',
              symbol: 'BTC',
              name: 'Bitcoin',
              price_usd: 65000,
              market_cap_usd: 1_000_000_000,
              volume_24h_usd: 100_000_000,
              price_change_24h_percent: 2.5,
              price_change_7d_percent: 8.4,
              volatility_24h: 4.2,
              sentiment_score: 'BULL',
              sentiment_confidence: 0.82,
              sentiment_summary: 'Positive momentum backed by strong signal quality.',
              trending_score: 44.5,
              market_rank: 1,
            },
            price_history: [
              { timestamp: new Date().toISOString(), open: 64000, high: 65500, low: 63500, close: 65000 },
            ],
            headlines: ['Bitcoin rally continues after ETF inflows'],
            scored_items: [],
            sentiment_today: {
              sentiment_score: 'BULL',
              confidence: 0.82,
              summary: 'Positive momentum backed by strong signal quality.',
              key_catalysts: ['ETF inflows'],
              risk_factors: ['Macro uncertainty'],
              short_term_outlook: 'Near-term bias remains constructive while signal breadth holds.',
              volatility_warning: false,
              trending_score: 44.5,
              source_breakdown: [],
              collection_stats: {
                total_items: 1,
                source_count: 1,
                weighted_frequency: 0.93,
                average_recency_score: 0.93,
                trending_score: 44.5,
                collected_at: '2026-03-17T08:05:00.000Z',
              },
            },
          }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch request: ${url}`));
    });

    render(<App />);

    await screen.findByText('Bitcoin');
    expect(screen.getByRole('button', { name: /system down/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search ticker'), { target: { value: 'btc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    await screen.findByText('Signal Overview');
  });

  it('validates and runs the backtesting workflow', async () => {
    render(<App />);

    await screen.findByText('Bitcoin');

    fireEvent.click(screen.getByRole('button', { name: 'Backtesting' }));

    fireEvent.change(screen.getByLabelText('Symbols'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Backtest' }));

    expect(await screen.findByText('At least one symbol is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Symbols'), { target: { value: 'BTC, ETH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configure Agents' }));

    expect(await screen.findByText('Configured 1 agent(s) for backtesting.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run Backtest' }));

    expect(await screen.findByText('Backtest backtest_123 completed. Stored test id is ready for reload.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('backtest_123')).toBeInTheDocument();
    expect(await screen.findByText('Equity Curve')).toBeInTheDocument();
    expect(screen.getByText('Rule-based agents held up well in the selected window.')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/agents/configure', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/backtest/run', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/backtest/results/backtest_123');
    });
  }, 15000);
});