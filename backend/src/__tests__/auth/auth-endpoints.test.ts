/**
 * Integration tests — /api/v1/auth endpoints (M1) against a REAL SQLite DB.
 *
 * Builds a minimal Express app (cookie-parser + json + the auth router) over a
 * temp-file database with migrations applied, and exercises the full
 * register → login → me → logout cycle through supertest.
 *
 * Asserts the M1 security guarantees end-to-end:
 *   • register creates exactly one row; duplicate register is identical and
 *     creates no second row (anti-enumeration).
 *   • login sets a `__Host-sa_session` cookie (HttpOnly, Secure, SameSite=Lax)
 *     and returns the user; bad creds → generic 401, no cookie.
 *   • /me returns the user with the cookie, 401 without it.
 *   • logout destroys the session SERVER-SIDE (stale cookie → 401 afterwards).
 */

import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig } from './auth-test-utils.js';
import { createAuthRouter } from '../../routes/auth.js';

describe('auth endpoints (/api/v1/auth)', () => {
  let app: Express;
  let db: Database.Database;
  let cleanup: () => void;

  const config = testAuthConfig();
  const COOKIE = config.cookieName; // __Host-sa_session

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter(db, config));
  });

  afterEach(() => cleanup());

  function userCount(): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  }

  /** Pull the raw `name=value` pair from a Set-Cookie header for resending. */
  function cookiePair(setCookie: string[] | undefined, name: string): string | undefined {
    const header = (setCookie ?? []).find(c => c.startsWith(`${name}=`));
    return header?.split(';')[0];
  }

  // ── register ───────────────────────────────────────────────────────────────

  it('register creates exactly one users row and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'a good password' });
    expect(res.status).toBe(201);
    expect(userCount()).toBe(1);
  });

  it('duplicate register is anti-enumeration: identical response, no second row', async () => {
    const first = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'a good password' });
    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'another password' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(userCount()).toBe(1);
  });

  it('register rejects invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'a good password' });
    expect(res.status).toBe(400);
    expect(userCount()).toBe(0);
  });

  // ── login ────────────────────────────────────────────────────────────────

  it('login with correct creds sets a hardened cookie and returns the user', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: 'log@example.com', password: 'a good password' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'log@example.com', password: 'a good password' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('log@example.com');

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const header = setCookie.find(c => c.startsWith(`${COOKIE}=`))!;
    expect(header).toBeDefined();
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toContain('Path=/');
    expect(header).not.toMatch(/Domain=/i); // __Host- prefix forbids Domain
    expect(header.startsWith('__Host-')).toBe(true);
  });

  it('login with wrong password returns generic 401 and sets no cookie', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: 'log2@example.com', password: 'a good password' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'log2@example.com', password: 'WRONG password' });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login for an unknown email returns generic 401 (same as wrong password)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'a good password' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  // ── me + logout ─────────────────────────────────────────────────────────────

  it('GET /me returns the user with the cookie, 401 without it', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: 'me@example.com', password: 'a good password' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'me@example.com', password: 'a good password' });
    const cookie = cookiePair(login.headers['set-cookie'] as unknown as string[], COOKIE)!;

    const withCookie = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(withCookie.status).toBe(200);
    expect(withCookie.body.user.email).toBe('me@example.com');

    const without = await request(app).get('/api/v1/auth/me');
    expect(without.status).toBe(401);
  });

  it('logout destroys the session server-side (stale cookie → 401)', async () => {
    await request(app).post('/api/v1/auth/register').send({ email: 'bye@example.com', password: 'a good password' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bye@example.com', password: 'a good password' });
    const cookie = cookiePair(login.headers['set-cookie'] as unknown as string[], COOKIE)!;

    // Sanity: the session is valid before logout.
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(1);

    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(200);

    // Server-side row is gone — not merely the client cookie.
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(0);

    // Re-presenting the now-stale cookie must be rejected.
    const stale = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(stale.status).toBe(401);
  });

  it('does not leak the password into the response body', async () => {
    const password = 'totally-secret-pw';
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'leak@example.com', password });
    expect(JSON.stringify(res.body)).not.toContain(password);
  });
});
