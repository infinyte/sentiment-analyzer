/**
 * Shared helpers for the M1 auth test suites.
 *
 * Spins up a REAL on-disk SQLite database (temp file) with the same pragmas the
 * production connection uses (WAL + foreign_keys ON), runs the versioned
 * migrations, and yields a handle plus a cleanup fn. Also exposes a fast Argon2
 * config so the suites don't pay the production ~300 ms hashing cost per call.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runMigrations, ALL_MIGRATIONS } from '../../database/migrations/index.js';
import { loadAuthConfig, type AuthConfig } from '../../services/auth/config.js';

export interface TestDb {
  db: Database.Database;
  cleanup: () => void;
}

/** Open a temp-file SQLite DB with production pragmas and the M1 migrations applied. */
export function createTestDb(): TestDb {
  const file = path.join(os.tmpdir(), `auth-test-${crypto.randomUUID()}.db`);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, ALL_MIGRATIONS);

  return {
    db,
    cleanup: () => {
      try {
        db.close();
      } finally {
        for (const suffix of ['', '-wal', '-shm']) {
          try {
            fs.unlinkSync(file + suffix);
          } catch {
            /* already gone */
          }
        }
      }
    },
  };
}

/** Auth config with cheap Argon2 params — fast tests, identical PHC hash format. */
export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  const base = loadAuthConfig();
  return {
    ...base,
    argon2: { memoryCost: 512, timeCost: 1, parallelism: 1 },
    ...overrides,
  };
}
