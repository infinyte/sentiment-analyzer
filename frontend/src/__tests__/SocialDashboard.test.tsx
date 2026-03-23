import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { SocialDashboard } from '../components/SocialDashboard';
import {
  useTrendingTopics,
  useSocialItems,
  useSocialStats,
  useTrendScore,
} from '../hooks/useSocialMedia';

vi.mock('../hooks/useSocialMedia');

const mockUseTrendingTopics = vi.mocked(useTrendingTopics);
const mockUseSocialItems = vi.mocked(useSocialItems);
const mockUseSocialStats = vi.mocked(useSocialStats);
const mockUseTrendScore = vi.mocked(useTrendScore);

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
