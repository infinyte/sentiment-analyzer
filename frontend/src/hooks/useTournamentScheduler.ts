import { useState, useCallback, useEffect } from 'react';
import type {
  TournamentSchedule,
  CreateScheduleInput,
  UpdateScheduleInput,
} from '../types/tournament-schedule';

const BASE = '/api/tournaments/schedules';

export function useTournamentScheduler() {
  const [schedules, setSchedules] = useState<TournamentSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // schedule id during action

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(BASE);
      const payload = await res.json() as { success: boolean; data: TournamentSchedule[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setSchedules(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  const createSchedule = useCallback(async (input: CreateScheduleInput): Promise<TournamentSchedule | null> => {
    setError(null);
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = await res.json() as { success: boolean; data: TournamentSchedule; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      await loadSchedules();
      return payload.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
      return null;
    }
  }, [loadSchedules]);

  const updateSchedule = useCallback(async (id: string, input: UpdateScheduleInput): Promise<boolean> => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`${BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const payload = await res.json() as { success: boolean; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      await loadSchedules();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
      return false;
    } finally {
      setActionLoading(null);
    }
  }, [loadSchedules]);

  const deleteSchedule = useCallback(async (id: string): Promise<boolean> => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
      const payload = await res.json() as { success: boolean; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setSchedules(prev => prev.filter(s => s.id !== id));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete schedule');
      return false;
    } finally {
      setActionLoading(null);
    }
  }, []);

  const runNow = useCallback(async (id: string): Promise<string | null> => {
    setError(null);
    setActionLoading(id);
    try {
      const res = await fetch(`${BASE}/${id}/run-now`, { method: 'POST' });
      const payload = await res.json() as { success: boolean; data?: { competitionId: string }; error?: string };
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      await loadSchedules();
      return payload.data?.competitionId ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run schedule');
      return null;
    } finally {
      setActionLoading(null);
    }
  }, [loadSchedules]);

  const toggleEnabled = useCallback(async (schedule: TournamentSchedule): Promise<void> => {
    await updateSchedule(schedule.id, { enabled: !schedule.enabled });
  }, [updateSchedule]);

  return {
    schedules,
    loading,
    error,
    actionLoading,
    loadSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runNow,
    toggleEnabled,
  };
}
