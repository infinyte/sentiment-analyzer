import type { TournamentRecord } from '../../services/evolutionary/evolutionary-orchestrator.js';

export type { TournamentRecord };

// ── Summary shape returned by list() ─────────────────────────────────────────

export interface TournamentSummary {
  id: string;
  name: string;
  started_at: string;
  status: string;
  currentGeneration: number;
  populationSize: number;
}

// ── Repository interface ──────────────────────────────────────────────────────

export interface ITournamentRepository {
  saveTournament(record: TournamentRecord): Promise<void>;
  getTournament(tournamentId: string): Promise<TournamentRecord | null>;
  listTournaments(): Promise<TournamentSummary[]>;
}
