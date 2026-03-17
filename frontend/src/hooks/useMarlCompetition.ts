import { useState, useRef, useCallback } from 'react';
import type {
  CompetitionConfig,
  CompetitionResult,
  CompetitionStatus,
  StartCompetitionResponse,
  AgentCompareResponse,
  CompetitionListResponse,
} from '../types/marl';

const API = '/api/marl';

export function useMarlCompetition() {
  const [loading, setLoading] = useState(false);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [status, setStatus] = useState<CompetitionStatus | null>(null);
  const [results, setResults] = useState<CompetitionResult | null>(null);
  const [compareResult, setCompareResult] = useState<AgentCompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<CompetitionListResponse | null>(null);

  // Hold the polling interval handle so we can cancel it
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Start a competition and poll until complete ─────────────────────────────

  const startCompetition = useCallback(async (config: CompetitionConfig): Promise<void> => {
    setLoading(true);
    setError(null);
    setResults(null);
    setStatus(null);
    stopPolling();

    try {
      const startRes = await fetch(`${API}/competition/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!startRes.ok) {
        const errBody = await startRes.json().catch(() => ({ error: startRes.statusText })) as { error: string };
        throw new Error(errBody.error ?? 'Failed to start competition');
      }

      const startData = await startRes.json() as StartCompetitionResponse;
      const cid = startData.competitionId;
      setCompetitionId(cid);

      // Poll status every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/competition/${cid}/status`);
          if (!statusRes.ok) {
            stopPolling();
            setError('Failed to poll competition status');
            setLoading(false);
            return;
          }

          const statusData = await statusRes.json() as CompetitionStatus;
          setStatus(statusData);

          if (statusData.status === 'COMPLETED') {
            stopPolling();
            // Fetch full results
            const resultsRes = await fetch(`${API}/competition/${cid}/results`);
            if (resultsRes.ok) {
              const fullResults = await resultsRes.json() as CompetitionResult;
              setResults(fullResults);
            } else {
              setError('Competition complete but failed to load results');
            }
            setLoading(false);
          } else if (statusData.status === 'FAILED') {
            stopPolling();
            setError('Competition failed on server');
            setLoading(false);
          }
        } catch (pollErr) {
          stopPolling();
          setError(pollErr instanceof Error ? pollErr.message : 'Polling error');
          setLoading(false);
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [stopPolling]);

  // ── Compare two agents over N rounds ───────────────────────────────────────

  const compareAgents = useCallback(async (
    agent1: { id: string; riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING' },
    agent2: { id: string; riskProfile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING' },
    symbols: string[],
    rounds: number,
    duration: number,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    setCompareResult(null);

    try {
      const res = await fetch(`${API}/agents/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent1, agent2, symbols, rounds, duration }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
        throw new Error(errBody.error ?? 'Agent comparison failed');
      }

      const data = await res.json() as AgentCompareResponse;
      setCompareResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load the list of all competitions ──────────────────────────────────────

  const loadList = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${API}/competitions`);
      if (res.ok) {
        const data = await res.json() as CompetitionListResponse;
        setList(data);
      }
    } catch {
      // Non-fatal — list is a convenience feature
    }
  }, []);

  // ── Load results for a specific competitionId (e.g. from history) ──────────

  const loadResults = useCallback(async (cid: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setCompetitionId(cid);

    try {
      const [statusRes, resultsRes] = await Promise.all([
        fetch(`${API}/competition/${cid}/status`),
        fetch(`${API}/competition/${cid}/results`),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json() as CompetitionStatus);
      if (resultsRes.ok) setResults(await resultsRes.json() as CompetitionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setLoading(false);
    setCompetitionId(null);
    setStatus(null);
    setResults(null);
    setCompareResult(null);
    setError(null);
  }, [stopPolling]);

  return {
    loading,
    competitionId,
    status,
    results,
    compareResult,
    list,
    error,
    startCompetition,
    compareAgents,
    loadList,
    loadResults,
    reset,
  };
}
