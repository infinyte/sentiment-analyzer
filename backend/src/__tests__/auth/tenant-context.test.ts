/**
 * Tests — request-scoped tenant context + authenticate() binding (M2).
 *
 *   • getCurrentUserId() throws outside any authenticated context.
 *   • runWithPrincipal binds the principal for synchronous + async reads.
 *   • A protected route is 401 without a valid session cookie, 200 with one,
 *     and getCurrentUserId() inside it returns the logged-in user's id.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createTestDb, testAuthConfig, cookiePair } from './auth-test-utils.js';
import { createAuthSystem } from '../../services/auth/index.js';
import { createAuthRouter } from '../../routes/auth.js';
import {
  runWithPrincipal,
  getCurrentUserId,
  getCurrentPrincipal,
} from '../../services/auth/tenant-context.js';
import type { AuthenticatedPrincipal } from '../../services/auth/types.js';

const config = testAuthConfig();

describe('tenant-context (unit)', () => {
  const principal: AuthenticatedPrincipal = {
    userId: 'user-123',
    email: 'u@example.com',
    emailVerified: false,
    roles: ['user'],
    authTime: new Date(),
  };

  it('throws when read outside an authenticated context', () => {
    expect(() => getCurrentUserId()).toThrow(/No authenticated context/);
    expect(() => getCurrentPrincipal()).toThrow(/No authenticated context/);
  });

  it('returns the bound principal inside runWithPrincipal (sync)', () => {
    expect(runWithPrincipal(principal, () => getCurrentUserId())).toBe('user-123');
  });

  it('propagates across async boundaries', async () => {
    const id = await runWithPrincipal(principal, async () => {
      await Promise.resolve();
      return getCurrentUserId();
    });
    expect(id).toBe('user-123');
  });
});

describe('authenticate() context binding (integration)', () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
  });
  afterEach(() => cleanup());

  it('protects a route: 401 without a session, 200 + correct id with one', async () => {
    // The auth router (register/login) + a custom protected route that echoes
    // getCurrentUserId() from the tenant context the middleware binds.
    const { authenticate } = createAuthSystem(db, config);
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAuthRouter(db, config));
    app.get('/whoami', authenticate, (_req, res) => {
      res.json({ id: getCurrentUserId() });
    });

    // No cookie → 401.
    expect((await request(app).get('/whoami')).status).toBe(401);

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'who@example.com', password: 'a good password' });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'who@example.com', password: 'a good password' });
    const cookie = cookiePair(login.headers['set-cookie'], config.cookieName)!;

    const expectedId = (
      db.prepare('SELECT id FROM users WHERE email = ?').get('who@example.com') as { id: string }
    ).id;

    const res = await request(app).get('/whoami').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(expectedId);
  });
});
