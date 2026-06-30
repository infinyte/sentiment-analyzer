/**
 * Tests — layered CSRF protection (M2).
 *
 * App configured with an explicit Origin allow-list so the Origin check is
 * active. State-changing requests in this app must carry a valid Origin.
 *
 *   • missing X-CSRF-Token on a guarded mutation → 403
 *   • wrong/forged token → 403
 *   • token bound to a DIFFERENT session → 403 (proves session-binding)
 *   • cross-origin POST (bad Origin) → 403
 *   • a GET needs no token and succeeds
 *   • correct token + valid Origin → 200 (the guard passes when satisfied)
 */

import request from 'supertest';
import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig, buildAuthApp, cookiePair } from './auth-test-utils.js';

const ORIGIN = 'http://localhost';
const config = testAuthConfig({ allowedOrigins: [ORIGIN] });

describe('CSRF protection', () => {
  let db: Database.Database;
  let cleanup: () => void;
  let app: Express;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    app = buildAuthApp(db, config);
  });
  afterEach(() => cleanup());

  /** Register + login (with valid Origin) → returns the session cookie. */
  async function loginCookie(email: string): Promise<string> {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send({ email, password: 'a good password' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email, password: 'a good password' });
    return cookiePair(login.headers['set-cookie'], config.cookieName)!;
  }

  async function csrfToken(cookie: string): Promise<string> {
    const res = await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie);
    return res.body.csrfToken;
  }

  it('rejects a guarded mutation with a missing token (403)', async () => {
    const cookie = await loginCookie('a@example.com');
    const res = await request(app).post('/api/v1/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('rejects a forged/wrong token (403)', async () => {
    const cookie = await loginCookie('b@example.com');
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'not-the-real-token');
    expect(res.status).toBe(403);
  });

  it('rejects a token bound to a DIFFERENT session (403)', async () => {
    const cookieA = await loginCookie('sessionA@example.com');
    const cookieB = await loginCookie('sessionB@example.com');
    const tokenA = await csrfToken(cookieA);

    // Present session B's cookie but session A's token → session-binding fails.
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', cookieB)
      .set('X-CSRF-Token', tokenA);
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin POST (bad Origin) → 403', async () => {
    const cookie = await loginCookie('c@example.com');
    const token = await csrfToken(cookie);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://evil.example.com')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);
    expect(res.status).toBe(403);
  });

  it('allows a GET without any token', async () => {
    const cookie = await loginCookie('d@example.com');
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('passes the guard with a correct token + valid Origin (200)', async () => {
    const cookie = await loginCookie('e@example.com');
    const token = await csrfToken(cookie);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token);
    expect(res.status).toBe(200);
    // And the session was actually destroyed server-side.
    expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(0);
  });
});
