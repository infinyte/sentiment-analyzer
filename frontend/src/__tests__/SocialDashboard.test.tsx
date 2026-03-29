import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { SocialDashboard } from '../components/SocialDashboard';
import {
  useTrendingTopics,
  useSocialItems,
  useSocialStats,
  useTrendScore,
  useSymbolScrape,
  useBatchScrape,
  useTrendingRecompute,
  useTrendingIngest,
} from '../hooks/useSocialMedia';

vi.mock('../hooks/useSocialMedia');

const mockUseTrendingTopics = vi.mocked(useTrendingTopics);
const mockUseSocialItems = vi.mocked(useSocialItems);
const mockUseSocialStats = vi.mocked(useSocialStats);
const mockUseTrendScore = vi.mocked(useTrendScore);
const mockUseSymbolScrape = vi.mocked(useSymbolScrape);
const mockUseBatchScrape = vi.mocked(useBatchScrape);
const mockUseTrendingRecompute = vi.mocked(useTrendingRecompute);
const mockUseTrendingIngest = vi.mocked(useTrendingIngest);

describe('SocialDashboard', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const refreshTopics = vi.fn();
  const refreshItems = vi.fn();
  const refreshStats = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseTrendingTopics.mockReturnValue({
      data: {
        timeWindow: '24h',
        count: 1,
        topics: [
          {
            rank: 1,
            topic: 'Bitcoin',
            primary_topic: 'Bitcoin',
            topic_type: 'coin',
            coin_symbol: 'BTC',
            mention_count: 42,
            unique_sources: 3,
            signal_composite: 82,
            signal_sentiment: 76,
            velocity: 5.4,
            trend_direction: 'BULLISH',
            last_updated: '2026-03-23T10:00:00.000Z',
            cluster_size: 1,
            clustered_topics: [],
          },
        ],
      },
      loading: false,
      error: null,
      refresh: refreshTopics,
    });

    mockUseSocialItems.mockReturnValue({
      data: {
        total: 1,
        limit: 20,
        offset: 0,
        items: [
          {
            id: 'item-1',
            source: 'twitter',
            source_id: 'tweet-1',
            content: 'Bitcoin sentiment is improving quickly.',
            title: 'Bitcoin sentiment is improving quickly.',
            author: 'Satoshi',
            engagement_likes: 100,
            engagement_shares: 12,
            engagement_comments: 8,
            content_created_at: '2026-03-23T09:30:00.000Z',
            fetched_at: '2026-03-23T10:00:00.000Z',
            url: 'https://example.com/post/1',
            coins_mentioned: ['BTC'],
            sentiment_score: 0.84,
            sentiment_confidence: 0.9,
            score_sentiment: 70,
            score_engagement: 50,
            score_recency: 90,
            score_authority: 40,
            score_composite: 72,
            last_updated: '2026-03-23T10:00:00.000Z',
          },
        ],
      },
      loading: false,
      error: null,
      refresh: refreshItems,
    });

    mockUseSocialStats.mockReturnValue({
      data: {
        total_items: 500,
        items_24h: 120,
        trending_topics: 8,
        sources: [
          {
            source: 'twitter',
            total_items: 250,
            items_24h: 80,
            fetch_count_today: 12,
            error_count_today: 0,
            last_fetched_at: '2026-03-23T10:00:00.000Z',
          },
        ],
      },
      loading: false,
      error: null,
      lastRefreshed: new Date('2026-03-23T10:00:00.000Z'),
      refresh: refreshStats,
    });

    mockUseTrendScore.mockReturnValue({ data: null, loading: false, error: null });

    mockUseSymbolScrape.mockReturnValue({ data: null, loading: false, error: null, scrape: vi.fn() });
    mockUseBatchScrape.mockReturnValue({ data: null, loading: false, error: null, scrape: vi.fn() });
    mockUseTrendingRecompute.mockReturnValue({ data: null, loading: false, error: null, recompute: vi.fn() });
    mockUseTrendingIngest.mockReturnValue({ data: null, loading: false, error: null, ingest: vi.fn() });

    mockFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/social-media/refresh')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          status: 202,
          json: async () => ({
            status: 'refreshing',
            mode: 'all_sources',
            symbols: ['BTC', 'ETH'],
          }),
        });
      }

      if (url.includes('/api/social-media/item/item-1')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'item-1',
            source: 'twitter',
            source_id: 'tweet-1',
            content: 'Bitcoin sentiment is improving quickly.',
            title: 'Bitcoin sentiment is improving quickly.',
            author: 'Satoshi',
            engagement_likes: 100,
            engagement_shares: 12,
            engagement_comments: 8,
            content_created_at: '2026-03-23T09:30:00.000Z',
            fetched_at: '2026-03-23T10:00:00.000Z',
            url: 'https://example.com/post/1',
            coins_mentioned: ['BTC'],
            sentiment_score: 0.84,
            sentiment_confidence: 0.9,
            score_sentiment: 70,
            score_engagement: 50,
            score_recency: 90,
            score_authority: 40,
            score_composite: 72,
            last_updated: '2026-03-23T10:00:00.000Z',
            scoring_breakdown: {
              score_sentiment: 70,
              score_engagement: 50,
              score_authority: 40,
              score_recency: 90,
              score_composite: 72,
              context_window_used: true,
              weights: { sentiment: '30%', engagement: '25%', authority: '25%', recency: '20%' },
              feature_attribution: {
                sentiment: 21,
                engagement: 12.5,
                authority: 10,
                recency: 18,
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

  it('queues a social refresh and preserves filter input state', async () => {
    render(<SocialDashboard />);

    fireEvent.change(screen.getByPlaceholderText('Filter coin (BTC…)'), { target: { value: 'btc' } });
    fireEvent.change(screen.getByLabelText('Refresh symbols'), { target: { value: 'BTC,ETH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Social' }));

    expect(await screen.findByText('Refresh queued for BTC, ETH (all_sources).')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter coin (BTC…)')).toHaveValue('BTC');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/social-media/refresh', expect.any(Object));
    });
  });

  // ── Advanced Utilities Panel ────────────────────────────────────────────────

  describe('AdvancedUtilitiesPanel', () => {
    it('is collapsed by default and expands on click', () => {
      render(<SocialDashboard />);

      expect(screen.queryByLabelText('Scrape symbol')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByLabelText('Scrape symbol')).toBeInTheDocument();
    });

    it('calls scrape with symbol on per-symbol scrape submit', async () => {
      const scrapeFn = vi.fn();
      mockUseSymbolScrape.mockReturnValue({ data: null, loading: false, error: null, scrape: scrapeFn });
      render(<SocialDashboard />);

      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));
      fireEvent.change(screen.getByLabelText('Scrape symbol'), { target: { value: 'btc' } });
      fireEvent.click(screen.getByRole('button', { name: 'Run symbol scrape' }));

      expect(scrapeFn).toHaveBeenCalledWith('BTC', undefined, undefined);
    });

    it('shows scrape result on success', () => {
      mockUseSymbolScrape.mockReturnValue({
        data: { symbol: 'BTC', total_posts: 42, platforms: [{ platform: 'reddit', posts: [], post_count: 42 }], scraped_at: '' },
        loading: false,
        error: null,
        scrape: vi.fn(),
      });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText(/Scraped 42 posts for BTC/)).toBeInTheDocument();
    });

    it('shows per-symbol scrape error', () => {
      mockUseSymbolScrape.mockReturnValue({ data: null, loading: false, error: 'Scrape failed', scrape: vi.fn() });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText('Scrape failed')).toBeInTheDocument();
    });

    it('shows loading state during per-symbol scrape', () => {
      mockUseSymbolScrape.mockReturnValue({ data: null, loading: true, error: null, scrape: vi.fn() });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByRole('button', { name: 'Run symbol scrape' })).toBeDisabled();
      expect(screen.getByText('Scraping…')).toBeInTheDocument();
    });

    it('calls scrapeBatch with parsed symbols on batch scrape submit', async () => {
      const scrapeFn = vi.fn();
      mockUseBatchScrape.mockReturnValue({ data: null, loading: false, error: null, scrape: scrapeFn });
      render(<SocialDashboard />);

      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));
      fireEvent.change(screen.getByLabelText('Batch scrape symbols'), { target: { value: 'btc, eth' } });
      fireEvent.click(screen.getByRole('button', { name: 'Run batch scrape' }));

      expect(scrapeFn).toHaveBeenCalledWith(['BTC', 'ETH'], undefined, undefined);
    });

    it('shows batch scrape result on success', () => {
      mockUseBatchScrape.mockReturnValue({
        data: { results: [], total_symbols: 2, total_posts: 88, scraped_at: '' },
        loading: false,
        error: null,
        scrape: vi.fn(),
      });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText(/88 posts across 2 symbol/)).toBeInTheDocument();
    });

    it('shows batch scrape error', () => {
      mockUseBatchScrape.mockReturnValue({ data: null, loading: false, error: 'Batch failed', scrape: vi.fn() });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText('Batch failed')).toBeInTheDocument();
    });

    it('calls recompute on trending recompute submit', () => {
      const recomputeFn = vi.fn();
      mockUseTrendingRecompute.mockReturnValue({ data: null, loading: false, error: null, recompute: recomputeFn });
      render(<SocialDashboard />);

      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Trigger trending recompute' }));

      expect(recomputeFn).toHaveBeenCalledWith(4);
    });

    it('shows recompute result on success', () => {
      mockUseTrendingRecompute.mockReturnValue({
        data: { count: 15, timeWindow: '4h', topics: [] },
        loading: false,
        error: null,
        recompute: vi.fn(),
      });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText(/15 topics/)).toBeInTheDocument();
    });

    it('calls ingest with parsed posts on ingest submit', () => {
      const ingestFn = vi.fn();
      mockUseTrendingIngest.mockReturnValue({ data: null, loading: false, error: null, ingest: ingestFn });
      render(<SocialDashboard />);

      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));
      fireEvent.change(screen.getByLabelText('Ingest posts JSON'), {
        target: { value: '[{"platform":"reddit","text":"BTC up!"}]' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit trending ingest' }));

      expect(ingestFn).toHaveBeenCalledWith([{ platform: 'reddit', text: 'BTC up!' }]);
    });

    it('shows JSON parse error for invalid ingest input', () => {
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));
      fireEvent.change(screen.getByLabelText('Ingest posts JSON'), { target: { value: 'not-json' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit trending ingest' }));

      expect(screen.getByText(/not valid JSON|Unexpected token|SyntaxError/i)).toBeInTheDocument();
    });

    it('shows ingest result on success', () => {
      mockUseTrendingIngest.mockReturnValue({
        data: { ingested: 3, stored_total: 103 },
        loading: false,
        error: null,
        ingest: vi.fn(),
      });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText(/Ingested 3 posts/)).toBeInTheDocument();
      expect(screen.getByText(/103/)).toBeInTheDocument();
    });

    it('shows ingest error from hook', () => {
      mockUseTrendingIngest.mockReturnValue({ data: null, loading: false, error: 'Ingest failed', ingest: vi.fn() });
      render(<SocialDashboard />);
      fireEvent.click(screen.getByRole('button', { name: /Advanced Utilities/i }));

      expect(screen.getByText('Ingest failed')).toBeInTheDocument();
    });
  });

  it('loads item detail with score breakdown and source metadata without resetting filters', async () => {
    render(<SocialDashboard />);

    fireEvent.change(screen.getByPlaceholderText('Filter coin (BTC…)'), { target: { value: 'btc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(await screen.findByText('Feature Attribution')).toBeInTheDocument();
    expect(screen.getByText('Source Metadata')).toBeInTheDocument();
    expect(screen.getByText(/Source ID:/)).toBeInTheDocument();
    expect(screen.getByText(/Context window:/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter coin (BTC…)')).toHaveValue('BTC');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/social-media/item/item-1');
    });
  });
});
