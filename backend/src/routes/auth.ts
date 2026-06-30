/**
 * Auth routes (M1, hardened in M2) — mounted under /api/v1/auth.
 *
 *   POST /register    — zod-validated; anti-enumeration; rate-limited (per IP).
 *   POST /login       — authenticate; mint session + hardened cookie on success;
 *                       generic 401 on failure; rate-limited (email+IP);
 *                       account lockout/backoff lives in LocalPasswordProvider.
 *   POST /logout      — authenticated + CSRF-guarded; revoke current session.
 *   POST /logout-all  — authenticated + CSRF-guarded; revoke all user sessions.
 *   GET  /me          — current principal, or 401.
 *   GET  /csrf        — issue the session-bound CSRF token (cookie + body).
 *
 * Middleware order within this router (justification in M2-NOTES.md):
 *   originCheck (all state-changing) → per-route rate limiter → authenticate
 *   (protected) → csrfGuard (protected mutations) → handler.
 *
 * CSRF scope: /logout and /logout-all are authenticated mutations → full
 * session-bound token guard. /login and /register are UNAUTHENTICATED (no
 * session yet to bind a token to) → protected by the Origin check + rate
 * limiting instead, which is the design doc's prescribed handling.
 *
 * M4: password-reset/verify-confirm endpoints land here; they inherit
 * originCheck automatically and should add csrfGuard (authenticated) +
 * the passwordResetRequest limiter.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import logger from '../logger.js';
import { createAuthSystem, type AuthConfig } from '../services/auth/index.js';
import { WeakPasswordError } from '../services/auth/local-password-provider.js';
import { readSessionCookie } from '../services/auth/authenticate-middleware.js';
import { createOriginCheck, createCsrfGuard, issueCsrfCookie } from '../services/auth/csrf.js';
import { createRateLimiters } from '../services/auth/rate-limiters.js';
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
  const limiters = createRateLimiters(cfg);
  const originCheck = createOriginCheck(cfg.allowedOrigins);
  const csrfGuard = createCsrfGuard(cfg);
  const router = Router();

  // Layer 2 (Origin/Referer) for every state-changing request in this router.
  router.use(originCheck);

  const cookieOptions = {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    // No `domain` — required for the `__Host-` prefix.
  };

  // POST /api/v1/auth/register
  router.post('/api/v1/auth/register', limiters.register, async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }
    try {
      await identityProvider.register(parsed.data);
      // Anti-enumeration: identical 201 regardless of whether the email existed.
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
  router.post('/api/v1/auth/login', limiters.login, async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    try {
      // Lockout/backoff is enforced inside authenticate() (account-associated).
      const principal = await identityProvider.authenticate(parsed.data);
      if (!principal) {
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

  // GET /api/v1/auth/csrf — issue the session-bound CSRF token (auth required).
  router.get('/api/v1/auth/csrf', limiters.csrf, authenticate, (req: Request, res: Response) => {
    const token = issueCsrfCookie(req, res, cfg);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ csrfToken: token });
  });

  // POST /api/v1/auth/logout — authenticated + CSRF-guarded; revoke current session.
  router.post(
    '/api/v1/auth/logout',
    limiters.logout,
    authenticate,
    csrfGuard,
    async (req: Request, res: Response) => {
      try {
        const rawToken = readSessionCookie(req, cfg.cookieName);
        if (rawToken) await sessionStore.revoke(rawToken);
      } catch (err) {
        logger.warn('auth.logout: revoke error', { error: String(err) });
      }
      res.clearCookie(cfg.cookieName, cookieOptions);
      return res.status(200).json({ status: 'ok' });
    },
  );

  // POST /api/v1/auth/logout-all — authenticated + CSRF-guarded; revoke every session.
  router.post(
    '/api/v1/auth/logout-all',
    limiters.logout,
    authenticate,
    csrfGuard,
    async (req: Request, res: Response) => {
      try {
        await sessionStore.revokeAllForUser(req.principal!.userId);
      } catch (err) {
        logger.warn('auth.logout-all: revoke error', { error: String(err) });
      }
      res.clearCookie(cfg.cookieName, cookieOptions);
      return res.status(200).json({ status: 'ok' });
    },
  );

  // GET /api/v1/auth/me — current principal (the SPA hydrates from this in M5).
  router.get('/api/v1/auth/me', limiters.me, authenticate, (req: Request, res: Response) => {
    // authenticate() guarantees req.principal is set when we reach here.
    return res.status(200).json({ user: principalToDto(req.principal!) });
  });

  return router;
}
