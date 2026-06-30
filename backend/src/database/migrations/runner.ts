/**
 * Versioned migration runner.
 *
 * The repo historically created tables ad-hoc via `CREATE TABLE IF NOT EXISTS`
 * in `storage.ts#createTables()` with no version tracking. This runner adds a
 * proper, ordered, reversible migration mechanism backed by a `schema_migrations`
 * table — required by the M1 spec. Legacy tables remain owned by
 * `createTables()`; new schema (starting with the auth tables, version 4) is
 * tracked here.
 *
 * better-sqlite3 is synchronous, so every step runs inside a single synchronous
 * transaction — a migration either fully applies (and is recorded) or not at all.
 */

import type Database from 'better-sqlite3';
import logger from '../../logger.js';

export interface Migration {
  /** Monotonic version. Migrations apply in ascending order. */
  version: number;
  /** Human-readable label, recorded in schema_migrations. */
  name: string;
  /** Forward migration. Must be idempotent-safe (use IF NOT EXISTS where apt). */
  up(db: Database.Database): void;
  /** Reverse migration. Must undo `up` cleanly. */
  down(db: Database.Database): void;
}

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(SCHEMA_MIGRATIONS_DDL);
}

function appliedVersions(db: Database.Database): Set<number> {
  ensureMigrationsTable(db);
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  return new Set(rows.map(r => r.version));
}

/**
 * Apply every migration whose version has not yet been recorded, in ascending
 * version order. Each migration runs in its own transaction together with the
 * bookkeeping insert, so a failure leaves `schema_migrations` consistent.
 */
export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const pending = migrations
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, new Date().toISOString());
    });
    tx();
    logger.info('migration applied', { version: migration.version, name: migration.name });
  }
}

/**
 * Roll back the single highest applied migration (or down to and including
 * `targetVersion` when provided). Reversible counterpart used by tooling/tests.
 */
export function rollbackMigrations(
  db: Database.Database,
  migrations: Migration[],
  targetVersion?: number,
): void {
  const applied = appliedVersions(db);
  const toRollback = migrations
    .filter(m => applied.has(m.version))
    .filter(m => (targetVersion === undefined ? true : m.version >= targetVersion))
    .sort((a, b) => b.version - a.version); // newest first

  // Without a target, only roll back the most recent migration.
  const slice = targetVersion === undefined ? toRollback.slice(0, 1) : toRollback;

  for (const migration of slice) {
    const tx = db.transaction(() => {
      migration.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version);
    });
    tx();
    logger.info('migration rolled back', { version: migration.version, name: migration.name });
  }
}
