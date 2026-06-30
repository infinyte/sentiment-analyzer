/**
 * Tests — account lockout with exponential backoff (M2).
 *
 *   • 5 wrong passwords flip the account into a backoff window; the next attempt
 *     is rejected even with the CORRECT password until the window passes.
 *   • Backoff duration grows ~2^(n-threshold) with successive failures.
 *   • A successful login resets failed_login_attempts to 0.
 *   • Lockout is keyed to the ACCOUNT, not the IP (a second account is unaffected).
 *   • Over HTTP, a locked account returns a GENERIC 401 (no lock disclosure).
 */

import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig, buildAuthApp } from './auth-test-utils.js';
import { UserRepository } from '../../services/auth/user-repository.js';
import { LocalPasswordProvider } from '../../services/auth/local-password-provider.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const GOOD = 'a good password';
const BAD = 'wrong password!!';

describe('account lockout (provider)', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let users: UserRepository;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    users = new UserRepository(db);
  });
  afterEach(() => cleanup());

  function provider(backoffBaseMs: number) {
    return new LocalPasswordProvider(
      users,
      testAuthConfig({ lockoutThreshold: 5, lockoutBackoffBaseMs: backoffBaseMs, lockoutCapMs: 60_000 }),
    );
  }

  it('locks after 5 failures; correct password rejected until the window passes', async () => {
    const p = provider(300);
    await p.register({ email: 'lock@example.com', password: GOOD });

    for (let i = 0; i < 5; i++) {
      expect(await p.authenticate({ email: 'lock@example.com', password: BAD })).toBeNull();
    }

    // Within the backoff window the correct password is still rejected.
    expect(await p.authenticate({ email: 'lock@example.com', password: GOOD })).toBeNull();

    // After the window expires, the correct password works again.
    await sleep(360);
    const principal = await p.authenticate({ email: 'lock@example.com', password: GOOD });
    expect(principal).not.toBeNull();
    expect(principal!.email).toBe('lock@example.com');
  });

  it('grows the backoff window with successive lockouts (~2^(n-5))', async () => {
    const base = 200;
    const p = provider(base);
    await p.register({ email: 'grow@example.com', password: GOOD });

    const lockDurationAfterFailure = (): number => {
      const u = users.findByEmail('grow@example.com')!;
      return new Date(u.lockedUntil!).getTime() - Date.now();
    };

    // 5 failures → lock #1 ≈ base * 2^0.
    for (let i = 0; i < 5; i++) await p.authenticate({ email: 'grow@example.com', password: BAD });
    const dur1 = lockDurationAfterFailure();

    // Let lock #1 expire, then one more failure → lock #2 ≈ base * 2^1.
    await sleep(dur1 + 60);
    await p.authenticate({ email: 'grow@example.com', password: BAD });
    const dur2 = lockDurationAfterFailure();

    expect(dur1).toBeGreaterThan(0);
    expect(dur2).toBeGreaterThan(dur1);
    // Ratio ≈ 2 within tolerance.
    expect(dur2 / dur1).toBeGreaterThan(1.5);
    expect(dur2 / dur1).toBeLessThan(2.6);
  });

  it('resets failed_login_attempts to 0 on a successful login', async () => {
    const p = provider(1000);
    await p.register({ email: 'reset@example.com', password: GOOD });

    // 3 failures (below threshold → no lock yet).
    for (let i = 0; i < 3; i++) await p.authenticate({ email: 'reset@example.com', password: BAD });
    expect(users.findByEmail('reset@example.com')!.failedLoginAttempts).toBe(3);

    expect(await p.authenticate({ email: 'reset@example.com', password: GOOD })).not.toBeNull();
    const u = users.findByEmail('reset@example.com')!;
    expect(u.failedLoginAttempts).toBe(0);
    expect(u.lockedUntil).toBeNull();
  });

  it('keys lockout to the account, not the IP (a second account is unaffected)', async () => {
    const p = provider(60_000);
    await p.register({ email: 'victim@example.com', password: GOOD });
    await p.register({ email: 'bystander@example.com', password: GOOD });

    for (let i = 0; i < 5; i++) await p.authenticate({ email: 'victim@example.com', password: BAD });

    // Victim is locked even with the right password…
    expect(await p.authenticate({ email: 'victim@example.com', password: GOOD })).toBeNull();
    // …but the bystander account logs in fine.
    expect(await p.authenticate({ email: 'bystander@example.com', password: GOOD })).not.toBeNull();
  });
});

describe('account lockout (HTTP — generic response)', () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });
  afterEach(() => cleanup());

  it('a locked account returns a generic 401 with no cookie (no lock disclosure)', async () => {
    // High rate-limit so the limiter doesn't mask lockout; long lock so it holds.
    const config = testAuthConfig({
      lockoutThreshold: 5,
      lockoutBackoffBaseMs: 60_000,
      rateLimit: { loginWindowMs: 15 * 60_000, loginMax: 1000, registerWindowMs: 60 * 60_000, registerMax: 1000 },
    });
    const app = buildAuthApp(db, config);

    await request(app).post('/api/v1/auth/register').send({ email: 'http-lock@example.com', password: GOOD });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'http-lock@example.com', password: BAD });
    }

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'http-lock@example.com', password: GOOD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials.'); // identical to a normal bad-password failure
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
