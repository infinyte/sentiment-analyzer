/**
 * UserRepository — the snake_case (SQL) ⇄ camelCase (TS) translation boundary
 * for the auth tables. Lives BELOW the auth seam: only `LocalPasswordProvider`
 * and `DbSessionStore` touch it; application code above the seam never does.
 *
 * better-sqlite3 is synchronous; methods are plain (non-async) here and the
 * async seam interfaces wrap them.
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

/** A user row as seen in the TS layer (camelCase). Includes the hash — internal only. */
export interface UserRecord {
  id: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string;
  roles: string[];
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  email: string;
  email_verified: number;
  password_hash: string;
  roles: string;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: UserRow): UserRecord {
  let roles: string[];
  try {
    const parsed = JSON.parse(row.roles);
    roles = Array.isArray(parsed) ? parsed.map(String) : ['user'];
  } catch {
    roles = ['user'];
  }
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified === 1,
    passwordHash: row.password_hash,
    roles,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  roles?: string[];
}

export class UserRepository {
  constructor(private readonly db: Database.Database) {}

  /** Case-insensitive lookup by email. */
  findByEmail(email: string): UserRecord | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .get(email) as UserRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  findById(id: string): UserRecord | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Insert a new user. Caller is responsible for anti-enumeration semantics;
   * this throws on a duplicate email (the COLLATE NOCASE unique index fires).
   */
  create(input: CreateUserInput): UserRecord {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const roles = JSON.stringify(input.roles ?? ['user']);
    this.db
      .prepare(
        `INSERT INTO users (id, email, email_verified, password_hash, roles,
                            failed_login_attempts, locked_until, last_login_at, created_at, updated_at)
         VALUES (@id, @email, 0, @passwordHash, @roles, 0, NULL, NULL, @now, @now)`
      )
      .run({ id, email: input.email, passwordHash: input.passwordHash, roles, now });
    // Non-null: we just inserted it.
    return this.findById(id)!;
  }

  /** Stamp last_login_at = now (and bump updated_at). */
  touchLastLogin(userId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET last_login_at = @now, updated_at = @now WHERE id = @userId')
      .run({ now, userId });
  }

  /**
   * Insert an email-verification token row. The raw token is hashed (SHA-256)
   * before storage — only the hash is persisted. Returns the row id.
   * The actual email send + confirm flow is M4.
   */
  createEmailVerificationToken(userId: string, rawToken: string, ttlMs: number): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    this.db
      .prepare(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (@id, @userId, @tokenHash, @expiresAt, NULL, @createdAt)`
      )
      .run({
        id,
        userId,
        tokenHash,
        expiresAt: new Date(now + ttlMs).toISOString(),
        createdAt: new Date(now).toISOString(),
      });
    return id;
  }
}
