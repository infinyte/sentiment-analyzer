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
});