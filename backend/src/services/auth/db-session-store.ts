/**
 * DbSessionStore — opaque server-side sessions persisted in SQLite (M1).
 *
 * Token handling (defense in depth):
 *   • The raw token is ≥128-bit CSPRNG output (we use 256 bits).
 *   • Only its SHA-256 hash is stored in `sessions.id`. A DB leak therefore
 *     does not yield usable tokens. The raw token lives only in the cookie.
 *   • `resolve` treats `expires_at` as authoritative — expired or missing → null.
 *     Expired rows are pruned opportunistically on resolve.
 *
 * Implements `ISessionStore`. better-sqlite3 is synchronous; the async seam is
 * satisfied by returning resolved promises.
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthConfig } from './config.js';
import type {
  AuthenticatedPrincipal,
  ISessionStore,
  SessionContext,
} from './types.js';

interface SessionJoinRow {
  user_id: string;
  created_at: string;
  expires_at: string;
  email: string;
  email_verified: number;
  roles: string;
}

export class DbSessionStore implements ISessionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly config: AuthConfig,
  ) {}

  async create(principal: AuthenticatedPrincipal, context: SessionContext = {}): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('base64url'); // 256-bit
    const id = hashToken(rawToken);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, last_used_at, user_agent, ip_address)
         VALUES (@id, @userId, @createdAt, @expiresAt, @createdAt, @userAgent, @ipAddress)`
      )
      .run({
        id,
        userId: principal.userId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.config.sessionTtlMs).toISOString(),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
      });
    return rawToken;
  }

  async resolve(rawToken: string): Promise<AuthenticatedPrincipal | null> {
    if (!rawToken) return null;
    const id = hashToken(rawToken);

    const row = this.db
      .prepare(
        `SELECT s.user_id, s.created_at, s.expires_at,
                u.email, u.email_verified, u.roles
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`
      )
      .get(id) as SessionJoinRow | undefined;

    if (!row) return null;

    // expires_at is authoritative.
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }

    this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    let roles: string[];
    try {
      const parsed = JSON.parse(row.roles);
      roles = Array.isArray(parsed) ? parsed.map(String) : ['user'];
    } catch {
      roles = ['user'];
    }

    return {
      userId: row.user_id,
      email: row.email,
      emailVerified: row.email_verified === 1,
      roles,
      authTime: new Date(row.created_at),
    };
  }

  async revoke(rawToken: string): Promise<void> {
    if (!rawToken) return;
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(rawToken));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/** SHA-256 (hex) of the raw token — the only form ever persisted. */
function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
