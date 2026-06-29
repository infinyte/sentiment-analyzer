import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useTrendingTopics,
  useSocialItems,
  useSocialStats,
  useTrendScore,
} from '../hooks/useSocialMedia';

describe('useSocialMedia hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads trending topics and supports manual refresh', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ timeWindow: '24h', count: 1, topics: [{ rank: 1, topic: 'Bitcoin' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ timeWindow: '24h', count: 2, topics: [{ rank: 1, topic: 'Bitcoin' }, { rank: 2, topic: 'Ethereum' }] }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useTrendingTopics(24, 10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/social-media/trending-topics?timeWindow=24&limit=10');
    expect(result.current.data?.count).toBe(1);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data?.count).toBe(2);
  });

  it('builds item query params and exposes HTTP errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useSocialItems({
      coin: 'BTC',
      source: 'twitter',
      sort: 'engagement',
      sinceHours: 48,
      limit: 5,
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/social-media/items?coin=BTC&source=twitter&sort=engagement&since_hours=48&limit=5');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('HTTP 503');
  });

  it('polls social stats on the configured interval and records lastRefreshed', async () => {
    vi.useFakeTimers();

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_items: 10, items_24h: 4, trending_topics: 2, sources: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ total_items: 12, items_24h: 5, trending_topics: 3, sources: [] }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useSocialStats(5_000));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data?.total_items).toBe(10);
    expect(result.current.lastRefreshed).toBeInstanceOf(Date);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data?.total_items).toBe(12);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/social-media/stats');
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/social-media/stats');
  });

  it('loads trend score only when a symbol is present and surfaces fetch failures', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ symbol: 'ETH', signal_composite: 81, trend_direction: 'BULLISH' }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const { result, rerender } = renderHook(({ symbol }) => useTrendScore(symbol), {
      initialProps: { symbol: null as string | null },
    });

    expect(result.current.data).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    rerender({ symbol: 'BTC' });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('HTTP 404');
    expect(mockFetch).toHaveBeenCalledWith('/api/trending-score/BTC');

    rerender({ symbol: 'ETH' });

    await waitFor(() => {
      expect(result.current.data).toEqual({ symbol: 'ETH', signal_composite: 81, trend_direction: 'BULLISH' });
    });
    expect(result.current.error).toBeNull();
  });
});