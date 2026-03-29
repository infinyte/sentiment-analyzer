import { useState, useEffect, useCallback } from 'react';
import type {
  TrendingTopicsResponse,
  SocialItemsResponse,
  SocialStats,
  MultiSourceTrendReport,
  SocialSource,
  ScrapeResult,
  BatchScrapeResult,
  IngestPost,
  IngestResult,
  TrendingRecomputeResult,
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

export function useSocialStats(refreshInterval = 60_000) {
  const [data, setData]                     = useState<SocialStats | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed]   = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch('/api/social-media/stats');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, refreshInterval);
    return () => clearInterval(id);
  }, [fetch_, refreshInterval]);

  return { data, loading, error, lastRefreshed, refresh: fetch_ };
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

// ── Advanced utilities ─────────────────────────────────────────────────────────

export function useSymbolScrape() {
  const [data, setData] = useState<ScrapeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrape = useCallback(async (symbol: string, query?: string, platforms?: string[]) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({ symbol });
      if (query) params.set('query', query);
      if (platforms && platforms.length > 0) params.set('platforms', platforms.join(','));
      const res = await fetch(`/api/scrape/social?${params}`);
      const payload = await res.json() as ScrapeResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scrape failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, scrape };
}

export function useBatchScrape() {
  const [data, setData] = useState<BatchScrapeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrape = useCallback(async (symbols: string[], query?: string, platforms?: string[]) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch('/api/scrape/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, query: query || undefined, platforms: platforms && platforms.length > 0 ? platforms : undefined }),
      });
      const payload = await res.json() as BatchScrapeResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch scrape failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, scrape };
}

export function useTrendingRecompute() {
  const [data, setData] = useState<TrendingRecomputeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recompute = useCallback(async (windowHours = 4, limit = 20) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({ window: String(windowHours), limit: String(limit) });
      const res = await fetch(`/api/trending?${params}`);
      const payload = await res.json() as TrendingRecomputeResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, recompute };
}

export function useTrendingIngest() {
  const [data, setData] = useState<IngestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ingest = useCallback(async (posts: IngestPost[]) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch('/api/trending/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts }),
      });
      const payload = await res.json() as IngestResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, ingest };
}
