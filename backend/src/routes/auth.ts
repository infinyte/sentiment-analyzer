/**
 * Auth routes (M1) — mounted under /api/v1/auth.
 *
 *   POST /register — zod-validated; creates a user (anti-enumeration) + an
 *                    email-verification token row (mailer stubbed, M4).
 *   POST /login    — authenticate; on success mint a session + set the hardened
 *                    cookie; generic 401 on failure (no cookie).
 *   POST /logout   — server-side revoke of the current session, then clear cookie.
 *   GET  /me       — return the current AuthenticatedPrincipal, or 401.
 *
 * Cookie hardening: name `__Host-sa_session`; HttpOnly; Secure; SameSite=Lax;
 * Path=/; no Domain (the `__Host-` prefix enforces the last three).
 *
 * Out of scope here (markers left inline): CSRF/double-submit + Origin checks
 * (M2), rate limiting + lockout (M2), password-reset/verify-confirm flows (M4).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import logger from '../logger.js';
import { createAuthSystem, type AuthConfig } from '../services/auth/index.js';
import { WeakPasswordError } from '../services/auth/local-password-provider.js';
import { readSessionCookie } from '../services/auth/authenticate-middleware.js';
import type { AuthenticatedPrincipal } from '../services/auth/types.js';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024), // hard ceiling; policy enforced in provider
});

function principalToDto(p: AuthenticatedPrincipal) {
  return {
    userId: p.userId,
    email: p.email,
    emailVerified: p.emailVerified,
    roles: p.roles,
    authTime: p.authTime.toISOString(),
  };
}

export function createAuthRouter(db: Database.Database, config?: AuthConfig): Router {
  const { identityProvider, sessionStore, authenticate, config: cfg } = createAuthSystem(db, config);
  const router = Router();

  const cookieOptions = {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    // No `domain` — required for the `__Host-` prefix.
  };

  // POST /api/v1/auth/register
  router.post('/api/v1/auth/register', async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    try {
      await identityProvider.register(parsed.data);
      // M2: rate-limit this endpoint. Anti-enumeration: identical 201 regardless
      // of whether the email already existed.
      return res.status(201).json({ status: 'ok' });
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('auth.register failed', { error: String(err) });
      return res.status(500).json({ error: 'Registration failed.' });
    }
  });

  // POST /api/v1/auth/login
  router.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    try {
      const principal = await identityProvider.authenticate(parsed.data);
      if (!principal) {
        // M2: count failed attempt / apply backoff here.
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const rawToken = await sessionStore.create(principal, {
        userAgent: req.get('user-agent') ?? undefined,
        ipAddress: req.ip,
      });
      res.cookie(cfg.cookieName, rawToken, { ...cookieOptions, maxAge: cfg.sessionTtlMs });
      return res.status(200).json({ user: principalToDto(principal) });
    } catch (err) {
      logger.error('auth.login failed', { error: String(err) });
      return res.status(500).json({ error: 'Login failed.' });
    }
  });

  // POST /api/v1/auth/logout — destroy server-side, then clear the cookie.
  router.post('/api/v1/auth/logout', async (req: Request, res: Response) => {
    try {
      const rawToken = readSessionCookie(req, cfg.cookieName);
      if (rawToken) await sessionStore.revoke(rawToken);
    } catch (err) {
      logger.warn('auth.logout: revoke error', { error: String(err) });
    }
    res.clearCookie(cfg.cookieName, cookieOptions);
    return res.status(200).json({ status: 'ok' });
  });

  // GET /api/v1/auth/me — current principal (the SPA hydrates from this in M5).
  router.get('/api/v1/auth/me', authenticate, (req: Request, res: Response) => {
    // authenticate() guarantees req.principal is set when we reach here.
    return res.status(200).json({ user: principalToDto(req.principal!) });
  });

  return router;
}
