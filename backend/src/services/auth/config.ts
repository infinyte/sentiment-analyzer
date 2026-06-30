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
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
  };
}
