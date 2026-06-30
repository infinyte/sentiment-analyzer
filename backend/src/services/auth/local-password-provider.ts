/**
 * LocalPasswordProvider — self-hosted email+password identity (M1).
 *
 * Implements `IIdentityProvider` over Argon2id hashes stored in `users`.
 *
 * Security properties baked in here:
 *   • Argon2id with OWASP-profile params (configurable via env).
 *   • Overlong-password DoS guard: reject before hashing.
 *   • Constant-time `authenticate`: an unknown email still performs an Argon2
 *     verify against a dummy hash, so response timing cannot reveal account
 *     existence.
 *   • Anti-enumeration `register`: identical outcome whether or not the email
 *     exists, and never a second row for a duplicate.
 *
 * NOT here (later milestones): account lockout / backoff (M2), the
 * password-reset and email-verification *flows* + real mail sending (M4). A
 * verification token row IS created on register; the mailer call is stubbed.
 */

import argon2 from 'argon2';
import crypto from 'node:crypto';
import logger from '../../logger.js';
import type { AuthConfig } from './config.js';
import type { UserRepository, UserRecord } from './user-repository.js';
import type {
  AuthenticatedPrincipal,
  IIdentityProvider,
  PasswordCredentials,
} from './types.js';

/** Verification tokens are short-lived; the confirm flow lands in M4. */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export class LocalPasswordProvider implements IIdentityProvider {
  /**
   * A precomputed Argon2id hash of a random throwaway secret. Verifying against
   * it for unknown accounts equalizes timing with the real-account path.
   * Computed lazily on first miss and cached for the process lifetime.
   */
  private dummyHash: string | null = null;

  constructor(
    private readonly users: UserRepository,
    private readonly config: AuthConfig,
  ) {}

  // ── Registration (anti-enumeration) ──────────────────────────────────────

  async register(credentials: PasswordCredentials): Promise<void> {
    const email = normalizeEmail(credentials.email);
    this.assertPasswordLength(credentials.password);

    const existing = this.users.findByEmail(email);
    if (existing) {
      // Anti-enumeration: do the same amount of work (a real hash) but create
      // nothing and reveal nothing. Caller returns an identical response.
      await this.hashPassword(credentials.password);
      logger.info('auth.register: duplicate email ignored (anti-enumeration)');
      return;
    }

    const passwordHash = await this.hashPassword(credentials.password);
    const user = this.users.create({ email, passwordHash });

    // Create the verification-token row now; the email send + confirm flow is M4.
    const rawToken = crypto.randomBytes(32).toString('base64url');
    this.users.createEmailVerificationToken(user.id, rawToken, EMAIL_VERIFICATION_TTL_MS);
    // M4: send verification email here (e.g. mailer.sendVerification(email, rawToken)).
    // Intentionally a no-op stub in M1 — no transport wired, token row persisted only.
    logger.info('auth.register: user created; verification email stubbed (M4)');
  }

  // ── Authentication (constant-time) ───────────────────────────────────────

  async authenticate(credentials: PasswordCredentials): Promise<AuthenticatedPrincipal | null> {
    const email = normalizeEmail(credentials.email);

    // Overlong input is rejected without hashing (DoS guard). Treated as a
    // generic auth failure — no distinct signal to the caller.
    if (!this.isPasswordLengthAcceptable(credentials.password)) {
      return null;
    }

    const user = this.users.findByEmail(email);

    if (!user) {
      // Constant-time: verify against a dummy hash so timing matches the
      // real-account path, then fail. Result is ignored.
      await this.verifyAgainstDummy(credentials.password);
      return null;
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.passwordHash, credentials.password);
    } catch (err) {
      // A malformed stored hash should fail closed, not 500.
      logger.warn('auth.authenticate: verify error', { error: String(err) });
      return null;
    }

    // M2: increment failed_login_attempts / enforce lockout here. The schema
    // columns exist; the logic is deliberately out of scope for M1.
    if (!valid) return null;

    this.users.touchLastLogin(user.id);
    return toPrincipal(user);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2.memoryCost,
      timeCost: this.config.argon2.timeCost,
      parallelism: this.config.argon2.parallelism,
    });
  }

  private async verifyAgainstDummy(password: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = await this.hashPassword(crypto.randomBytes(32).toString('base64url'));
    }
    try {
      await argon2.verify(this.dummyHash, password);
    } catch {
      /* ignore — purpose is timing, not correctness */
    }
  }

  private isPasswordLengthAcceptable(password: string): boolean {
    // Byte length matters for the Argon2 DoS guard (multibyte chars).
    const byteLength = Buffer.byteLength(password, 'utf8');
    return (
      password.length >= this.config.minPasswordLength &&
      byteLength <= this.config.maxPasswordLength
    );
  }

  /** Throws a typed error used by the register route to return a 400. */
  private assertPasswordLength(password: string): void {
    if (!this.isPasswordLengthAcceptable(password)) {
      throw new WeakPasswordError(this.config.minPasswordLength, this.config.maxPasswordLength);
    }
  }
}

/** Raised when a registration password violates the length policy. */
export class WeakPasswordError extends Error {
  constructor(min: number, max: number) {
    super(`Password must be between ${min} and ${max} characters.`);
    this.name = 'WeakPasswordError';
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPrincipal(user: UserRecord): AuthenticatedPrincipal {
  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    roles: user.roles,
    authTime: new Date(),
  };
}
