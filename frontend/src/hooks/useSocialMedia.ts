import { useState, useEffect, useCallback } from 'react';
import type {
  TrendingTopicsResponse,
  SocialItemsResponse,
  SocialStats,
  MultiSourceTrendReport,
  SocialSource,
} from '../types/social-media';

// ── Trending topics ───────────────────────────────────────────────────────────

export function useTrendingTopics(timeWindow = 24, limit = 20) {
  const [data, setData] = useState<TrendingTopicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/social-media/trending-topics?timeWindow=${timeWindow}&limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeWindow, limit]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

// ── Social items ──────────────────────────────────────────────────────────────

export interface ItemsFilter {
  coin?: string;
  source?: SocialSource;
  sort?: 'score' | 'recency' | 'engagement';
  sinceHours?: number;
  limit?: number;
}

export function useSocialItems(filter: ItemsFilter = {}) {
  const [data, setData] = useState<SocialItemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { coin, source, sort = 'score', sinceHours = 24, limit = 20 } = filter;

  const fetch_ = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (coin) params.set('coin', coin);
      if (source) params.set('source', source);
      params.set('sort', sort);
      params.set('since_hours', String(sinceHours));
      params.set('limit', String(limit));
      const res = await fetch(`/api/social-media/items?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [coin, source, sort, sinceHours, limit]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refresh: fetch_ };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function useSocialStats() {
  const [data, setData] = useState<SocialStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/social-media/stats')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

// ── Trend score ───────────────────────────────────────────────────────────────

export function useTrendScore(symbol: string | null) {
  const [data, setData] = useState<MultiSourceTrendReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) { setData(null); return; }
    setLoading(true);
    fetch(`/api/trending-score/${symbol}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setData(d); setError(null); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [symbol]);

  return { data, loading, error };
}
