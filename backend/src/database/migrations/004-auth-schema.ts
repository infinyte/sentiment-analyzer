/**
 * Migration 004: Multi-user auth schema (M1).
 *
 * Creates the five new auth tables and NOTHING else — M1 is purely additive and
 * must not touch existing domain tables (adding `user_id` columns is M3).
 *
 *   users                     — identities + Argon2id password hashes
 *   sessions                  — opaque server-side sessions (stores token HASH only)
 *   password_reset_tokens     — reset token rows (request/confirm flow is M4)
 *   email_verification_tokens — verification token rows (confirm/send flow is M4)
 *   user_settings             — per-user JSON settings bag
 *
 * SQLite conventions (per design): TEXT UUID primary keys, INTEGER booleans
 * (0/1), ISO-8601 TEXT timestamps, snake_case identifiers, plural table names.
 * The unique email index uses COLLATE NOCASE so emails are case-insensitively
 * unique. Foreign keys ON DELETE CASCADE so destroying a user cleans up
 * sessions/tokens/settings (foreign_keys pragma is enforced per-connection in
 * storage.ts / the connection-open hook).
 *
 * Reversible: `down` drops the tables in FK-safe order.
 */

import type Database from 'better-sqlite3';
import type { Migration } from './runner.js';

const UP = `
  -- ── users ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT    PRIMARY KEY,
    email                 TEXT    NOT NULL,
    email_verified        INTEGER NOT NULL DEFAULT 0,
    password_hash         TEXT    NOT NULL,
    roles                 TEXT    NOT NULL DEFAULT '["user"]', -- JSON array of role strings
    -- Failed-attempt bookkeeping columns exist now; lockout/backoff LOGIC is M2.
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until          TEXT,                                -- ISO-8601, NULL = not locked
    last_login_at         TEXT,
    created_at            TEXT    NOT NULL,
    updated_at            TEXT    NOT NULL
  );

  -- Case-insensitive uniqueness on email.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
    ON users (email COLLATE NOCASE);

  -- ── sessions ─────────────────────────────────────────────────────────────
  -- id holds the SHA-256 hash (hex) of the raw token; the raw token lives only
  -- in the client cookie and is never persisted.
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    last_used_at TEXT,
    user_agent   TEXT,
    ip_address   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

  -- ── password_reset_tokens (rows only; flow is M4) ─────────────────────────
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,            -- SHA-256 of the raw token
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens (token_hash);
  CREATE INDEX IF NOT EXISTS idx_password_reset_user            ON password_reset_tokens (user_id);

  -- ── email_verification_tokens (rows created here; confirm/send is M4) ─────
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,            -- SHA-256 of the raw token
    expires_at TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_email_verification_token_hash ON email_verification_tokens (token_hash);
  CREATE INDEX IF NOT EXISTS idx_email_verification_user            ON email_verification_tokens (user_id);

  -- ── user_settings ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings   TEXT NOT NULL DEFAULT '{}', -- JSON blob
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS user_settings;
  DROP TABLE IF EXISTS email_verification_tokens;
  DROP TABLE IF EXISTS password_reset_tokens;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
`;

export const migration004AuthSchema: Migration = {
  version: 4,
  name: 'auth-schema',
  up(db: Database.Database): void {
    db.exec(UP);
  },
  down(db: Database.Database): void {
    db.exec(DOWN);
  },
};
