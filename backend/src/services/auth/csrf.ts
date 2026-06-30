/**
 * CSRF protection (M2) — layered, per the design doc's strategy.
 *
 * Three independent layers, all required:
 *   1. SameSite=Lax on the session cookie (set in M1; confirmed, not regressed).
 *   2. Origin/Referer check on every state-changing request (createOriginCheck).
 *   3. Synchronizer token cryptographically BOUND TO THE SESSION (createCsrfGuard):
 *      token = base64url(HMAC-SHA256(serverSecret, sessionId)). This is NOT a
 *      naive random double-submit (which the doc flags as bypassable) — a token
 *      minted for one session fails validation under any other session, because
 *      the HMAC input is that session's id.
 *
 * The token is delivered via a non-HttpOnly cookie and the `GET /csrf` endpoint,
 * and must be echoed in the `X-CSRF-Token` header on state-changing requests.
 *
 * Scope: applied to authenticated state-changing routes (/logout, /logout-all,
 * and the future M4 endpoints). `/login` and `/register` are unauthenticated —
 * no session exists yet to bind a token to — so they rely on the Origin check
 * (layer 2) + rate limiting instead; this is intentional and documented.
 *
 * Azure/scale: the HMAC secret must be SHARED across instances (set
 * AUTH_CSRF_SECRET) so a token minted on one node validates on another. The
 * per-process random fallback only suits a single instance.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthConfig } from './config.js';
import { readSessionCookie } from './authenticate-middleware.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The session id is the SHA-256 (hex) of the raw cookie token (matches DbSessionStore). */
function sessionIdFromRawToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** Mint the session-bound CSRF token for a given session id. */
export function csrfTokenForSession(sessionId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Extract the scheme://host[:port] origin from an absolute URL, or null. */
function originOfUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Layer 2 — Origin/Referer check. For state-changing methods, the request's
 * source origin must be in the configured allow-list. Safe methods pass through.
 * When no allow-list is configured the check is skipped (dev default) — log a
 * one-time note and configure ALLOWED_ORIGINS in production.
 */
export function createOriginCheck(allowedOrigins: string[]): RequestHandler {
  const allow = new Set(allowedOrigins);
  return function originCheck(req: Request, res: Response, next: NextFunction): void {
    if (!STATE_CHANGING.has(req.method)) return next();
    if (allow.size === 0) return next(); // unconfigured → cannot compare; documented

    const source = req.get('origin') ?? originOfUrl(req.get('referer'));
    if (!source || !allow.has(source)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  };
}

/**
 * Layer 3 — session-bound synchronizer token guard. For state-changing methods,
 * requires a valid session cookie and a matching `X-CSRF-Token` header. Safe
 * methods pass through. Rejects with 403 on any mismatch.
 */
export function createCsrfGuard(config: AuthConfig): RequestHandler {
  return function csrfGuard(req: Request, res: Response, next: NextFunction): void {
    if (!STATE_CHANGING.has(req.method)) return next();

    const rawToken = readSessionCookie(req, config.cookieName);
    if (!rawToken) {
      // No session → no session-bound token can exist. Reject.
      res.status(403).json({ error: 'CSRF validation failed' });
      return;
    }

    const expected = csrfTokenForSession(sessionIdFromRawToken(rawToken), config.csrfSecret);
    const provided = req.get('x-csrf-token') ?? '';

    if (!provided || !safeEqual(provided, expected)) {
      res.status(403).json({ error: 'CSRF validation failed' });
      return;
    }
    next();
  };
}

/**
 * Compute the CSRF token for the current request's session and set it on the
 * non-HttpOnly CSRF cookie. Used by `GET /csrf`. Returns the token (or null if
 * there is no session to bind to).
 */
export function issueCsrfCookie(req: Request, res: Response, config: AuthConfig): string | null {
  const rawToken = readSessionCookie(req, config.cookieName);
  if (!rawToken) return null;
  const token = csrfTokenForSession(sessionIdFromRawToken(rawToken), config.csrfSecret);
  res.cookie(config.csrfCookieName, token, {
    httpOnly: false, // the SPA must read it (M5) to echo it in the header
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
  return token;
}
