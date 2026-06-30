/**
 * Auth seam — swappable identity/session contracts.
 *
 * This file defines the *only* auth-related types that application code above
 * the seam is allowed to depend on. The cardinal rule (M1 → M6):
 *
 *   Application code above the seam depends ONLY on `AuthenticatedPrincipal`.
 *   It must never see password hashes, raw session tokens, DB rows, or any
 *   provider-specific detail. Swapping `LocalPasswordProvider` for an OIDC
 *   provider (out of scope, seam only) must not require touching callers.
 *
 * Implementations (M1): `LocalPasswordProvider`, `DbSessionStore`.
 */

/**
 * The authenticated caller, as seen by everything above the auth seam.
 * Deliberately minimal — no secrets, no storage internals.
 */
export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  /** When this principal last proved their identity (session creation time). */
  authTime: Date;
}

/** Credentials presented at the email+password boundary. */
export interface PasswordCredentials {
  email: string;
  password: string;
}

/**
 * Identity provider seam.
 *
 * `register` and `authenticate` are intentionally anti-enumeration friendly:
 * neither reveals whether an email is already registered. `register` returns
 * the same shape regardless; `authenticate` returns `null` for both
 * "no such user" and "wrong password".
 */
export interface IIdentityProvider {
  /**
   * Register a new identity. Anti-enumeration: the result is identical whether
   * or not the email already exists, and a second row is never created for a
   * duplicate. Side effects (verification-token row, mailer) are M1/M4 concerns
   * handled by the implementation, not surfaced here.
   */
  register(credentials: PasswordCredentials): Promise<void>;

  /**
   * Verify credentials. Returns a principal on success, `null` on any failure
   * (unknown email or bad password). Runs in constant time w.r.t. account
   * existence so timing cannot be used to enumerate accounts.
   */
  authenticate(credentials: PasswordCredentials): Promise<AuthenticatedPrincipal | null>;
}

/** Metadata captured when a session is minted (best-effort, non-authoritative). */
export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Session store seam.
 *
 * `create` returns the RAW token destined for the cookie. The store persists
 * only a one-way hash of it — the raw value is never written to disk.
 * `resolve` treats `expires_at` as authoritative; expired/missing → `null`.
 */
export interface ISessionStore {
  /** Mint a new session for a user; returns the raw (un-hashed) session token. */
  create(principal: AuthenticatedPrincipal, context?: SessionContext): Promise<string>;

  /** Resolve a raw session token to a principal, or `null` if invalid/expired. */
  resolve(rawToken: string): Promise<AuthenticatedPrincipal | null>;

  /** Revoke a single session by its raw token. No-op if it does not exist. */
  revoke(rawToken: string): Promise<void>;

  /** Revoke every session belonging to a user (e.g. password change, M4). */
  revokeAllForUser(userId: string): Promise<void>;
}
