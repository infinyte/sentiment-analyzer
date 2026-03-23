import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  CompetitionConfig,
  CompetitionAgent,
  CompetitionResult,
  CompetitionStatus,
  StartCompetitionResponse,
  AgentCompareResponse,
  CompetitionListResponse,
  CompetitionEquitySnapshotEvent,
  CompetitionTradeExecutedEvent,
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
  const [liveEquitySnapshots, setLiveEquitySnapshots] = useState<CompetitionResult['equityEvolution']>([]);
  const [liveTradeFeed, setLiveTradeFeed] = useState<Array<CompetitionTradeExecutedEvent>>([]);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [transport, setTransport] = useState<'stream' | 'polling'>('polling');

  // Hold the polling interval handle so we can cancel it
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const terminalRef = useRef(false);
  const startMetaRef = useRef<{
    mode: CompetitionConfig['mode'];
    agentCount: number;
    symbols: string[];
    startedAt: string;
  } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    setIsStreamConnected(false);
  }, []);

  const markTerminal = useCallback(() => {
    if (terminalRef.current) return false;
    terminalRef.current = true;
    return true;
  }, []);

  const applyProgress = useCallback((cid: string, progress: number) => {
    setStatus(prev => {
      if (prev && prev.competitionId === cid) {
        return {
          ...prev,
          status: 'RUNNING',
          progress,
        };
      }

      const meta = startMetaRef.current;
      return {
        competitionId: cid,
        status: 'RUNNING',
        progress,
        mode: meta?.mode ?? 'SINGLE',
        agentCount: meta?.agentCount ?? 0,
        symbols: meta?.symbols ?? [],
        startedAt: meta?.startedAt ?? new Date().toISOString(),
        topPerformer: null,
      };
    });
  }, []);

  const finalizeCompleted = useCallback(async (cid: string): Promise<void> => {
    if (!markTerminal()) return;

    stopPolling();
    closeStream();

    setStatus(prev => prev && prev.competitionId === cid
      ? {
          ...prev,
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date().toISOString(),
        }
      : prev);

    const resultsRes = await fetch(`${API}/competition/${cid}/results`);
    if (resultsRes.ok) {
      const fullResults = await resultsRes.json() as CompetitionResult;
      setResults(fullResults);
      setLiveEquitySnapshots(fullResults.equityEvolution ?? []);
    } else {
      setError('Competition complete but failed to load results');
    }
    setLoading(false);
  }, [closeStream, markTerminal, stopPolling]);

  const finalizeFailed = useCallback((message: string) => {
    if (!markTerminal()) return;
    stopPolling();
    closeStream();
    setError(message);
    setLoading(false);
  }, [closeStream, markTerminal, stopPolling]);

  const startStream = useCallback((cid: string) => {
    closeStream();

    if (typeof EventSource === 'undefined') {
      setTransport('polling');
      return;
    }

    try {
      const stream = new EventSource(`${API}/competition/${encodeURIComponent(cid)}/stream`);
      streamRef.current = stream;
      setTransport('stream');
      setIsStreamConnected(false);

      const parseEvent = <T,>(event: MessageEvent): T | null => {
        try {
          return JSON.parse(event.data) as T;
        } catch {
          return null;
        }
      };

      stream.onopen = () => {
        setIsStreamConnected(true);
      };

      stream.addEventListener('progress', (event) => {
        const payload = parseEvent<{ progress: number; competitionId: string }>(event as MessageEvent);
        if (!payload || payload.competitionId !== cid) return;
        applyProgress(cid, payload.progress);
      });

      stream.addEventListener('equity_snapshot', (event) => {
        const payload = parseEvent<CompetitionEquitySnapshotEvent>(event as MessageEvent);
        if (!payload || payload.competitionId !== cid) return;

        applyProgress(cid, payload.progress);
        setLiveEquitySnapshots(prev => {
          const next = [...prev, {
            timestamp: payload.timestamp,
            agentEquities: payload.agentEquities,
          }];
          return next.slice(-300);
        });
      });

      stream.addEventListener('trade_executed', (event) => {
        const payload = parseEvent<CompetitionTradeExecutedEvent>(event as MessageEvent);
        if (!payload || payload.competitionId !== cid) return;
        setLiveTradeFeed(prev => [payload, ...prev].slice(0, 100));
      });

      stream.addEventListener('completed', (event) => {
        const payload = parseEvent<{ competitionId: string }>(event as MessageEvent);
        if (!payload || payload.competitionId !== cid) return;
        void finalizeCompleted(cid);
      });

      stream.addEventListener('failed', (event) => {
        const payload = parseEvent<{ competitionId: string; error?: string }>(event as MessageEvent);
        if (!payload || payload.competitionId !== cid) return;
        finalizeFailed(payload.error ?? 'Competition failed on server');
      });

      stream.onerror = () => {
        setTransport('polling');
        setIsStreamConnected(false);
        if (streamRef.current === stream) {
          stream.close();
          streamRef.current = null;
        }
      };
    } catch {
      setTransport('polling');
      setIsStreamConnected(false);
    }
  }, [applyProgress, closeStream, finalizeCompleted, finalizeFailed]);

  // ── Start a competition and poll until complete ─────────────────────────────

  const startCompetition = useCallback(async (config: CompetitionConfig): Promise<void> => {
    setLoading(true);
    setError(null);
    setResults(null);
    setStatus(null);
    setLiveEquitySnapshots([]);
    setLiveTradeFeed([]);
    setTransport('polling');
    terminalRef.current = false;

    const startedAt = new Date().toISOString();
    startMetaRef.current = {
      mode: config.mode,
      agentCount: config.agents.length,
      symbols: config.symbols,
      startedAt,
    };

    stopPolling();
    closeStream();

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
      applyProgress(cid, 0);

      startStream(cid);

      // Poll status every 2 seconds
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/competition/${cid}/status`);
          if (!statusRes.ok) {
            finalizeFailed('Failed to poll competition status');
            return;
          }

          const statusData = await statusRes.json() as CompetitionStatus;
          setStatus(statusData);

          if (statusData.status === 'COMPLETED') {
            await finalizeCompleted(cid);
          } else if (statusData.status === 'FAILED') {
            finalizeFailed('Competition failed on server');
          }
        } catch (pollErr) {
          finalizeFailed(pollErr instanceof Error ? pollErr.message : 'Polling error');
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [applyProgress, closeStream, finalizeCompleted, finalizeFailed, startStream, stopPolling]);

  // ── Compare two agents over N rounds ───────────────────────────────────────

  const compareAgents = useCallback(async (
    agent1: CompetitionAgent,
    agent2: CompetitionAgent,
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
    setLiveEquitySnapshots([]);
    setLiveTradeFeed([]);
    stopPolling();
    closeStream();
    terminalRef.current = false;

    try {
      const [statusRes, resultsRes] = await Promise.all([
        fetch(`${API}/competition/${cid}/status`),
        fetch(`${API}/competition/${cid}/results`),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json() as CompetitionStatus);
      if (resultsRes.ok) {
        const data = await resultsRes.json() as CompetitionResult;
        setResults(data);
        setLiveEquitySnapshots(data.equityEvolution ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [closeStream, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    closeStream();
    terminalRef.current = false;
    setLoading(false);
    setCompetitionId(null);
    setStatus(null);
    setResults(null);
    setCompareResult(null);
    setLiveEquitySnapshots([]);
    setLiveTradeFeed([]);
    setTransport('polling');
    setError(null);
  }, [closeStream, stopPolling]);

  useEffect(() => {
    return () => {
      stopPolling();
      closeStream();
    };
  }, [closeStream, stopPolling]);

  return {
    loading,
    competitionId,
    status,
    results,
    compareResult,
    list,
    error,
    liveEquitySnapshots,
    liveTradeFeed,
    isStreamConnected,
    transport,
    startCompetition,
    compareAgents,
    loadList,
    loadResults,
    reset,
  };
}
