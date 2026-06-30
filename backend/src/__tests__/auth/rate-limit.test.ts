/**
 * Tests — rate limiting on credential endpoints (M2).
 *
 *   • 6th /login within the window (same account+IP) → 429 with Retry-After.
 *   • /register over the per-IP limit → 429.
 *   • 429 bodies are generic — they don't reveal whether an account exists.
 *
 * Uses the default limits (login 5/window, register 10/window). Limiters are
 * created once per app build (per OWASP), and each test builds a fresh app so
 * counters start clean.
 */

import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig, buildAuthApp } from './auth-test-utils.js';

const config = testAuthConfig(); // loginMax=5, registerMax=10, no Origin enforcement

describe('rate limiting', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let app: Express;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    app = buildAuthApp(db, config);
  });
  afterEach(() => cleanup());

  it('returns 429 + Retry-After on the 6th login in the window', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'rl@example.com', password: 'a good password' });

    const statuses: number[] = [];
    let limited: request.Response | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'rl@example.com', password: 'wrong password' });
      statuses.push(res.status);
      if (res.status === 429) limited = res;
    }

    // First 5 reach the handler (401); the 6th is rate-limited.
    expect(statuses.slice(0, 5).every(s => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(limited!.headers['retry-after']).toBeDefined();
    // Generic body — no account-existence signal.
    expect(limited!.body.error).toBe('Too many requests, please try again later.');
  });

  it('returns 429 once /register exceeds the per-IP limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: `reg${i}@example.com`, password: 'a good password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every(s => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('rate-limits identically for unknown vs known accounts (no enumeration)', async () => {
    // Hammer login for an email that was never registered.
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'whatever 123' });
      last = res.status;
    }
    expect(last).toBe(429); // same outcome as a real account hitting the limit
  });
});
