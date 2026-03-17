/**
 * Hook tests — useMarlCompetition
 *
 * Fetch is stubbed globally so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarlCompetition } from '../hooks/useMarlCompetition';

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('useMarlCompetition — initial state', () => {
  it('starts with all null/false/empty values', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useMarlCompetition());
    expect(result.current.loading).toBe(false);
    expect(result.current.competitionId).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.results).toBeNull();
    expect(result.current.compareResult).toBeNull();
    expect(result.current.list).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ── startCompetition ──────────────────────────────────────────────────────────

describe('useMarlCompetition — startCompetition', () => {
  const validConfig = {
    mode: 'SINGLE' as const,
    agents: [
      { id: 'alpha', riskProfile: 'AGGRESSIVE' as const },
      { id: 'beta',  riskProfile: 'CONSERVATIVE' as const },
    ],
    symbols: ['BTC', 'ETH'],
    duration: 200,
    refreshInterval: 1000,
    learningEnabled: true,
  };

  it('POSTs to /api/marl/competition/start with JSON body', async () => {
    const mockFetch = mockFetchOk({ competitionId: 'cid-abc', status: 'STARTED' });
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.startCompetition(validConfig);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/marl/competition/start',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validConfig),
      })
    );
  });

  it('stores the returned competitionId in state', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ competitionId: 'cid-xyz', status: 'STARTED' }));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.startCompetition(validConfig);
    });

    expect(result.current.competitionId).toBe('cid-xyz');
  });

  it('sets error when the server responds with a non-ok status', async () => {
    vi.stubGlobal('fetch', mockFetchError(400, { error: 'Invalid mode' }));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.startCompetition(validConfig);
    });

    expect(result.current.error).toBe('Invalid mode');
    expect(result.current.loading).toBe(false);
  });

  it('sets error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.startCompetition(validConfig);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.loading).toBe(false);
  });
});

// ── compareAgents ─────────────────────────────────────────────────────────────

describe('useMarlCompetition — compareAgents', () => {
  it('POSTs to /api/marl/agents/compare with correct body', async () => {
    const comparePayload = {
      agent1Wins: 2, agent2Wins: 1, draws: 0,
      agent1WinRate: 66.7, agent2WinRate: 33.3,
      averageAgent1Return: 5.2, averageAgent2Return: -1.4,
    };
    const mockFetch = mockFetchOk(comparePayload);
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMarlCompetition());
    const agent1 = { id: 'a', riskProfile: 'AGGRESSIVE' as const };
    const agent2 = { id: 'b', riskProfile: 'CONSERVATIVE' as const };

    await act(async () => {
      result.current.compareAgents(agent1, agent2, ['BTC'], 3, 100);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/marl/agents/compare',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ agent1, agent2, symbols: ['BTC'], rounds: 3, duration: 100 }),
      })
    );
  });

  it('stores compare results in state', async () => {
    const payload = {
      agent1Wins: 2, agent2Wins: 1, draws: 0,
      agent1WinRate: 66.7, agent2WinRate: 33.3,
      averageAgent1Return: 5.2, averageAgent2Return: -1.4,
    };
    vi.stubGlobal('fetch', mockFetchOk(payload));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.compareAgents(
        { id: 'a', riskProfile: 'AGGRESSIVE' },
        { id: 'b', riskProfile: 'CONSERVATIVE' },
        ['BTC'], 3, 100,
      );
    });

    expect(result.current.compareResult).toEqual(payload);
    expect(result.current.loading).toBe(false);
  });

  it('sets error when compare fails', async () => {
    vi.stubGlobal('fetch', mockFetchError(429, { error: 'Rate limit exceeded' }));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.compareAgents(
        { id: 'a', riskProfile: 'AGGRESSIVE' },
        { id: 'b', riskProfile: 'CONSERVATIVE' },
        ['BTC'], 3, 100,
      );
    });

    expect(result.current.error).toBe('Rate limit exceeded');
  });
});

// ── loadList ──────────────────────────────────────────────────────────────────

describe('useMarlCompetition — loadList', () => {
  it('GETs /api/marl/competitions and stores the result', async () => {
    const listPayload = { competitions: [], total: 0 };
    const mockFetch = mockFetchOk(listPayload);
    vi.stubGlobal('fetch', mockFetch);

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.loadList();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/marl/competitions');
    expect(result.current.list).toEqual(listPayload);
  });

  it('silently ignores network errors (non-fatal)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.loadList();
    });

    // No error surfaced — list stays null
    expect(result.current.error).toBeNull();
    expect(result.current.list).toBeNull();
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('useMarlCompetition — reset', () => {
  it('clears all state back to initial values', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ competitionId: 'cid-1', status: 'STARTED' }));

    const { result } = renderHook(() => useMarlCompetition());

    await act(async () => {
      result.current.startCompetition({
        mode: 'SINGLE', agents: [
          { id: 'a', riskProfile: 'AGGRESSIVE' },
          { id: 'b', riskProfile: 'CONSERVATIVE' },
        ],
        symbols: ['BTC'], duration: 100, refreshInterval: 1000, learningEnabled: true,
      });
    });

    expect(result.current.competitionId).toBe('cid-1');

    act(() => { result.current.reset(); });

    expect(result.current.loading).toBe(false);
    expect(result.current.competitionId).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.results).toBeNull();
    expect(result.current.compareResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
