/**
 * Auth configuration — all knobs overridable via env without code change.
 *
 * Argon2id defaults follow OWASP's second recommended profile and the M1 spec:
 *   memoryCost = 19456 KiB (19 MiB), timeCost = 2, parallelism = 1.
 * On the benchmarked host these hash in ~250–400 ms (see M1-NOTES.md and the
 * `benchmark-argon2` helper). Tune via AUTH_ARGON2_* if a target host differs.
 */

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export interface AuthConfig {
  argon2: Argon2Params;
  /** NIST 800-63B minimum acceptable password length. */
  minPasswordLength: number;
  /** Upper bound enforced BEFORE hashing as an Argon2 DoS guard. */
  maxPasswordLength: number;
  /** Session lifetime in milliseconds. */
  sessionTtlMs: number;
  /** Cookie name. `__Host-` prefix mandates Secure + Path=/ + no Domain. */
  cookieName: string;
  /**
   * Whether the session cookie carries the `Secure` attribute. Always true in
   * normal operation (required by the `__Host-` prefix); overridable only so
   * non-TLS local tooling can opt out. Production must leave this true.
   */
  cookieSecure: boolean;

  // ── M2: CSRF ────────────────────────────────────────────────────────────
  /**
   * Explicit allow-list of acceptable request origins for the CSRF Origin/Referer
   * check (state-changing requests). No wildcard. Empty → Origin enforcement is
   * skipped (dev default); production MUST set ALLOWED_ORIGINS.
   */
  allowedOrigins: string[];
  /** Server-side key for the session-bound CSRF HMAC. */
  csrfSecret: string;
  /** Non-HttpOnly cookie carrying the CSRF token (readable by the SPA in M5). */
  csrfCookieName: string;

  // ── M2: Account lockout (exponential backoff) ─────────────────────────────
  /** Failed-attempt count after which backoff begins. */
  lockoutThreshold: number;
  /** Base unit for the 2^(n-threshold) backoff curve, in ms. */
  lockoutBackoffBaseMs: number;
  /** Maximum lock duration (cap on the exponential curve), in ms. */
  lockoutCapMs: number;

  // ── M2: Rate limiting ─────────────────────────────────────────────────────
  rateLimit: {
    loginWindowMs: number;
    loginMax: number;
    registerWindowMs: number;
    registerMax: number;
  };
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

import crypto from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function originsFromEnv(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

/** Build the auth config from environment, applying spec defaults. */
export function loadAuthConfig(): AuthConfig {
  return {
    argon2: {
      memoryCost: intFromEnv('AUTH_ARGON2_MEMORY_COST', 19456),
      timeCost: intFromEnv('AUTH_ARGON2_TIME_COST', 2),
      parallelism: intFromEnv('AUTH_ARGON2_PARALLELISM', 1),
    },
    minPasswordLength: intFromEnv('AUTH_MIN_PASSWORD_LENGTH', 8),
    maxPasswordLength: intFromEnv('AUTH_MAX_PASSWORD_LENGTH', 128),
    sessionTtlMs: intFromEnv('AUTH_SESSION_TTL_MS', 7 * DAY_MS),
    cookieName: process.env.AUTH_COOKIE_NAME ?? '__Host-sa_session',
    // Default true: the `__Host-` prefix is invalid without Secure.
    cookieSecure: process.env.AUTH_COOKIE_SECURE !== 'false',

    // M2: CSRF. The secret falls back to a per-process random value so single-
    // instance deploys work out of the box; set AUTH_CSRF_SECRET (and a shared
    // store) for multi-instance — see the // Azure/scale: note in csrf.ts.
    allowedOrigins: originsFromEnv(),
    csrfSecret: process.env.AUTH_CSRF_SECRET ?? crypto.randomBytes(32).toString('hex'),
    csrfCookieName: process.env.AUTH_CSRF_COOKIE_NAME ?? '__Host-sa_csrf',

    // M2: lockout. Cognito-style 2^(n-threshold) seconds, capped ~15 min.
    lockoutThreshold: intFromEnv('AUTH_LOCKOUT_THRESHOLD', 5),
    lockoutBackoffBaseMs: intFromEnv('AUTH_LOCKOUT_BACKOFF_BASE_MS', 1000),
    lockoutCapMs: intFromEnv('AUTH_LOCKOUT_CAP_MS', 15 * MIN_MS),

    // M2: rate limits (the design doc's suggested starting values).
    rateLimit: {
      loginWindowMs: intFromEnv('AUTH_RL_LOGIN_WINDOW_MS', 15 * MIN_MS),
      loginMax: intFromEnv('AUTH_RL_LOGIN_MAX', 5),
      registerWindowMs: intFromEnv('AUTH_RL_REGISTER_WINDOW_MS', HOUR_MS),
      registerMax: intFromEnv('AUTH_RL_REGISTER_MAX', 10),
    },
  };
}
