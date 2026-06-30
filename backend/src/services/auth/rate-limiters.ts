/**
 * Rate limiters for the credential endpoints (M2).
 *
 * Built with `express-rate-limit`. Limiters are constructed ONCE per app (inside
 * `createRateLimiters`, called from `createAuthRouter`), never per-request — per
 * OWASP, a limiter rebuilt per request would reset its counter every time and
 * provide no protection. Each is independently config-overridable.
 *
 * Responses: 429 with a `Retry-After` header and a GENERIC body — rate-limit
 * responses must not reveal whether an account exists (anti-enumeration holds).
 *
 * Azure/scale: `MemoryStore` is per-process. A multi-instance deployment needs a
 * shared store (e.g. rate-limit-redis) so limits are enforced cluster-wide —
 * not implemented here.
 */

import { rateLimit, ipKeyGenerator, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { AuthConfig } from './config.js';

export interface AuthRateLimiters {
  login: RateLimitRequestHandler;
  register: RateLimitRequestHandler;
  /** M4: attach to POST /password-reset/request once that endpoint exists. */
  passwordResetRequest: RateLimitRequestHandler;
  /** Light caps to prevent abuse of the authenticated/utility endpoints. */
  logout: RateLimitRequestHandler;
  me: RateLimitRequestHandler;
  csrf: RateLimitRequestHandler;
}

/** Normalize the IP portion of a key (handles IPv6 per express-rate-limit). */
function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '');
}

/** Best-effort, safe extraction of the submitted email for account-keyed limits. */
function emailKey(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : 'unknown';
}

/** Shared 429 handler: generic message + explicit Retry-After (seconds). */
function tooMany(windowMs: number) {
  return (_req: Request, res: Response): void => {
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  };
}

function base(windowMs: number, limit: number, keyGenerator: (req: Request) => string): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: tooMany(windowMs),
    // Keys are constructed explicitly (and IPs via ipKeyGenerator), so the
    // library's environment validations add only noise here.
    validate: false,
  });
}

export function createRateLimiters(config: AuthConfig): AuthRateLimiters {
  const { rateLimit: rl } = config;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  return {
    // Login: keyed on BOTH account (email) and source IP, so neither a single IP
    // hammering many accounts nor distributed attempts on one account slip past.
    login: base(rl.loginWindowMs, rl.loginMax, req => `login:${emailKey(req)}:${ipKey(req)}`),

    // Register: per-IP (no account exists yet to key on).
    register: base(rl.registerWindowMs, rl.registerMax, req => `register:${ipKey(req)}`),

    // M4: password-reset request — keyed on account + IP, 5/hour. Defined now,
    // attached when the M4 reset endpoint lands.
    passwordResetRequest: base(HOUR, 5, req => `pwreset:${emailKey(req)}:${ipKey(req)}`),

    // Utility endpoints: generous per-IP caps that don't impede normal use.
    logout: base(15 * MIN, 60, req => `logout:${ipKey(req)}`),
    me: base(MIN, 120, req => `me:${ipKey(req)}`),
    csrf: base(MIN, 120, req => `csrf:${ipKey(req)}`),
  };
}
