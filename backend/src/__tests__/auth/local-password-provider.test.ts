/**
 * Unit tests — LocalPasswordProvider (M1).
 *
 * Covers Argon2id hash/verify round-trip (via register→authenticate), wrong
 * password rejection, anti-enumeration registration (no second row, identical
 * outcome), constant-time unknown-email path, the overlong-password DoS guard,
 * and that the stored hash is a PHC Argon2id string (never plaintext).
 */

import argon2 from 'argon2';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig } from './auth-test-utils.js';
import { UserRepository } from '../../services/auth/user-repository.js';
import {
  LocalPasswordProvider,
  WeakPasswordError,
} from '../../services/auth/local-password-provider.js';

describe('LocalPasswordProvider', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let provider: LocalPasswordProvider;
  let users: UserRepository;

  const config = testAuthConfig();

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    users = new UserRepository(db);
    provider = new LocalPasswordProvider(users, config);
  });

  afterEach(() => cleanup());

  function countUsers(): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  }

  it('hashes and verifies a correct password (round-trip)', async () => {
    await provider.register({ email: 'a@example.com', password: 'correct horse battery' });
    const principal = await provider.authenticate({ email: 'a@example.com', password: 'correct horse battery' });
    expect(principal).not.toBeNull();
    expect(principal!.email).toBe('a@example.com');
    expect(principal!.roles).toEqual(['user']);
    expect(principal!.emailVerified).toBe(false);
  });

  it('rejects a wrong password', async () => {
    await provider.register({ email: 'b@example.com', password: 'the right password' });
    const principal = await provider.authenticate({ email: 'b@example.com', password: 'the WRONG password' });
    expect(principal).toBeNull();
  });

  it('returns null for an unknown email (no throw — constant-time path runs)', async () => {
    const principal = await provider.authenticate({ email: 'nobody@example.com', password: 'whatever123' });
    expect(principal).toBeNull();
  });

  it('stores a PHC Argon2id hash, never the plaintext', async () => {
    const password = 'super secret value';
    await provider.register({ email: 'c@example.com', password });
    const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('c@example.com') as {
      password_hash: string;
    };
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(password);
    // And it genuinely verifies.
    await expect(argon2.verify(row.password_hash, password)).resolves.toBe(true);
  });

  it('is anti-enumeration: duplicate register creates no second row and does not throw', async () => {
    await provider.register({ email: 'dup@example.com', password: 'first password' });
    expect(countUsers()).toBe(1);

    // Same email again — must NOT throw and must NOT create a second row.
    await expect(
      provider.register({ email: 'dup@example.com', password: 'a different password' }),
    ).resolves.toBeUndefined();
    expect(countUsers()).toBe(1);

    // Original credentials still work; the duplicate attempt did not overwrite.
    const principal = await provider.authenticate({ email: 'dup@example.com', password: 'first password' });
    expect(principal).not.toBeNull();
  });

  it('treats email case-insensitively', async () => {
    await provider.register({ email: 'Mixed@Example.com', password: 'password value' });
    const principal = await provider.authenticate({ email: 'mixed@example.com', password: 'password value' });
    expect(principal).not.toBeNull();
  });

  it('creates an email-verification token row on registration (M4 send stubbed)', async () => {
    await provider.register({ email: 'verify@example.com', password: 'password value' });
    const user = users.findByEmail('verify@example.com')!;
    const tokens = db
      .prepare('SELECT token_hash FROM email_verification_tokens WHERE user_id = ?')
      .all(user.id) as Array<{ token_hash: string }>;
    expect(tokens).toHaveLength(1);
    // Stored as a hash, not a raw token (64 hex chars = SHA-256).
    expect(tokens[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects overlong passwords before hashing (DoS guard) on register', async () => {
    const longPassword = 'x'.repeat(config.maxPasswordLength + 1);
    await expect(provider.register({ email: 'long@example.com', password: longPassword })).rejects.toBeInstanceOf(
      WeakPasswordError,
    );
    expect(countUsers()).toBe(0);
  });

  it('rejects too-short passwords on register', async () => {
    await expect(provider.register({ email: 'short@example.com', password: 'x' })).rejects.toBeInstanceOf(
      WeakPasswordError,
    );
  });

  it('fails authentication for an overlong password without throwing', async () => {
    await provider.register({ email: 'len@example.com', password: 'a valid password' });
    const longPassword = 'x'.repeat(config.maxPasswordLength + 1);
    await expect(
      provider.authenticate({ email: 'len@example.com', password: longPassword }),
    ).resolves.toBeNull();
  });
});
