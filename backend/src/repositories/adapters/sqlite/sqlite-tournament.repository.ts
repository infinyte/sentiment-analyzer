import type Database from 'better-sqlite3';
import type { TournamentRecord } from '../../../services/evolutionary/evolutionary-orchestrator.js';
import type { ITournamentRepository, TournamentSummary } from '../../interfaces/tournament.repository.js';

export class SQLiteTournamentRepository implements ITournamentRepository {
  constructor(private readonly db: Database.Database) {}

  async saveTournament(record: TournamentRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO evolutionary_tournaments (id, name, started_at, payload)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload    = excluded.payload,
        name       = excluded.name,
        started_at = excluded.started_at
    `).run(record.tournamentId, record.name, record.startedAt, JSON.stringify(record));
  }

  async getTournament(tournamentId: string): Promise<TournamentRecord | null> {
    const row = this.db.prepare(
      'SELECT payload FROM evolutionary_tournaments WHERE id = ?',
    ).get(tournamentId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as TournamentRecord) : null;
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    const rows = this.db.prepare(
      'SELECT id, name, started_at, payload FROM evolutionary_tournaments ORDER BY started_at DESC',
    ).all() as Array<{ id: string; name: string; started_at: string; payload: string }>;

    return rows.map(row => {
      const record = JSON.parse(row.payload) as TournamentRecord;
      return {
        id:                row.id,
        name:              row.name,
        started_at:        row.started_at,
        status:            record.status,
        currentGeneration: record.currentGeneration,
        populationSize:    record.config.populationSize,
      };
    });
  }
}
