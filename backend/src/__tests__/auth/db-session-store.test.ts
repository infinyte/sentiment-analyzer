/**
 * Unit tests — DbSessionStore (M1).
 *
 * Covers: create→resolve→revoke lifecycle; the raw token is never persisted
 * (only its SHA-256 hash, which equals sessions.id); expired sessions resolve
 * to null (and are pruned); revokeAllForUser clears every session.
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig } from './auth-test-utils.js';
import { DbSessionStore } from '../../services/auth/db-session-store.js';
import type { AuthenticatedPrincipal } from '../../services/auth/types.js';

describe('DbSessionStore', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let store: DbSessionStore;
  let userId: string;

  const config = testAuthConfig();

  function seedUser(email = 'session@example.com'): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, email_verified, password_hash, roles,
                          failed_login_attempts, locked_until, last_login_at, created_at, updated_at)
       VALUES (?, ?, 1, 'hash', '["user","admin"]', 0, NULL, NULL, ?, ?)`,
    ).run(id, email, now, now);
    return id;
  }

  function principalFor(id: string): AuthenticatedPrincipal {
    return { userId: id, email: 'session@example.com', emailVerified: true, roles: ['user', 'admin'], authTime: new Date() };
  }

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    store = new DbSessionStore(db, config);
    userId = seedUser();
  });

  afterEach(() => cleanup());

  it('create → resolve → revoke lifecycle', async () => {
    const rawToken = await store.create(principalFor(userId));
    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBeGreaterThanOrEqual(20);

    const principal = await store.resolve(rawToken);
    expect(principal).not.toBeNull();
    expect(principal!.userId).toBe(userId);
    expect(principal!.roles).toEqual(['user', 'admin']);

    await store.revoke(rawToken);
    expect(await store.resolve(rawToken)).toBeNull();
  });

  it('never stores the raw token — only its SHA-256 hash (= sessions.id)', async () => {
    const rawToken = await store.create(principalFor(userId));
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const rows = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(expectedHash);
    // The raw token must appear nowhere in the row.
    expect(rows[0]!.id).not.toBe(rawToken);

    const dump = JSON.stringify(db.prepare('SELECT * FROM sessions').all());
    expect(dump).not.toContain(rawToken);
  });

  it('resolves expired sessions to null and prunes the row', async () => {
    const shortConfig = testAuthConfig({ sessionTtlMs: -1000 }); // already expired
    const expiringStore = new DbSessionStore(db, shortConfig);
    const rawToken = await expiringStore.create(principalFor(userId));

    expect(await expiringStore.resolve(rawToken)).toBeNull();
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('returns null for a bogus / empty token', async () => {
    expect(await store.resolve('not-a-real-token')).toBeNull();
    expect(await store.resolve('')).toBeNull();
  });

  it('revokeAllForUser clears every session for that user', async () => {
    await store.create(principalFor(userId));
    await store.create(principalFor(userId));
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(2);

    await store.revokeAllForUser(userId);
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(0);
  });
});
