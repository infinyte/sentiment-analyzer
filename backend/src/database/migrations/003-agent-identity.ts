/**
 * Migration 003: Agent Identity Schema
 *
 * Creates three new tables for the evolutionary agent system:
 *   - agent_registry:     persistent agent identities with cosmetic fields
 *   - agent_statistics:   per-agent cumulative performance counters
 *   - agent_competitions: per-competition result rows (one row per agent per competition)
 *
 * Safe to run on an existing database — uses CREATE TABLE IF NOT EXISTS and
 * ALTER TABLE ADD COLUMN (guarded by an existence check) so it never touches
 * data that is already correct.
 */

import Database from 'better-sqlite3';

export function runMigration003(db: Database.Database): void {
  // ── agent_registry ──────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      id                 TEXT PRIMARY KEY,
      agent_type         TEXT NOT NULL DEFAULT 'ML_BASED',
      risk_profile       TEXT NOT NULL DEFAULT 'CONSERVATIVE',
      status             TEXT NOT NULL DEFAULT 'ACTIVE',
      custom_name        TEXT,
      emoji              TEXT,
      color              TEXT,
      biography          TEXT,
      personality_traits TEXT,
      nickname           TEXT,
      age_iterations     INTEGER NOT NULL DEFAULT 0,
      generation_number  INTEGER NOT NULL DEFAULT 0,
      parent_id_1        TEXT REFERENCES agent_registry(id),
      parent_id_2        TEXT REFERENCES agent_registry(id),
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_registry_status ON agent_registry (status);
  `);

  // If the table already existed without the new cosmetic / lineage columns,
  // add them one by one. SQLite ignores ADD COLUMN when the column is already
  // present only from SQLite 3.37+; for older runtimes we guard with a check.
  const existingCols = new Set(
    (db.pragma(`table_info(agent_registry)`) as Array<{ name: string }>).map(r => r.name)
  );

  const newCols: Array<[string, string]> = [
    ['custom_name',        'TEXT'],
    ['emoji',              'TEXT'],
    ['color',              'TEXT'],
    ['biography',          'TEXT'],
    ['personality_traits', 'TEXT'],
    ['nickname',           'TEXT'],
    ['age_iterations',     'INTEGER NOT NULL DEFAULT 0'],
    ['generation_number',  'INTEGER NOT NULL DEFAULT 0'],
    ['parent_id_1',        'TEXT'],
    ['parent_id_2',        'TEXT'],
  ];

  for (const [col, definition] of newCols) {
    if (!existingCols.has(col)) {
      db.exec(`ALTER TABLE agent_registry ADD COLUMN ${col} ${definition}`);
    }
  }

  // ── agent_statistics ────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_statistics (
      agent_id             TEXT PRIMARY KEY REFERENCES agent_registry(id),
      total_competitions   INTEGER NOT NULL DEFAULT 0,
      total_wins           INTEGER NOT NULL DEFAULT 0,
      total_losses         INTEGER NOT NULL DEFAULT 0,
      win_rate_percent     REAL    NOT NULL DEFAULT 0,
      total_pnl            REAL    NOT NULL DEFAULT 0,
      max_drawdown_percent REAL    NOT NULL DEFAULT 0,
      sharpe_ratio         REAL    NOT NULL DEFAULT 0,
      roi_percent          REAL    NOT NULL DEFAULT 0,
      trades_executed      INTEGER NOT NULL DEFAULT 0,
      consistency_score    REAL    NOT NULL DEFAULT 0,
      avg_trade_profit     REAL    NOT NULL DEFAULT 0,
      last_updated         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── agent_competitions ──────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_competitions (
      id               TEXT PRIMARY KEY,
      agent_id         TEXT NOT NULL REFERENCES agent_registry(id),
      competition_id   TEXT NOT NULL,
      rank_position    INTEGER NOT NULL,
      starting_capital REAL    NOT NULL,
      ending_capital   REAL    NOT NULL,
      pnl              REAL    NOT NULL DEFAULT 0,
      trades_count     INTEGER NOT NULL DEFAULT 0,
      win_trades       INTEGER NOT NULL DEFAULT 0,
      loss_trades      INTEGER NOT NULL DEFAULT 0,
      largest_win      REAL    NOT NULL DEFAULT 0,
      largest_loss     REAL    NOT NULL DEFAULT 0,
      sharpe_ratio     REAL    NOT NULL DEFAULT 0,
      completed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_competitions_agent ON agent_competitions (agent_id, completed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_competitions_comp  ON agent_competitions (competition_id);
  `);
}
