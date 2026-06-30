/**
 * Auth subsystem wiring.
 *
 * `createAuthSystem` assembles the below-the-seam pieces over a single DB handle
 * and returns the seam implementations plus the bound `authenticate` middleware.
 * Both `app.ts` (production) and the integration tests construct the subsystem
 * through this one function, so wiring stays in lockstep.
 */

import type Database from 'better-sqlite3';
import type { RequestHandler } from 'express';
import { loadAuthConfig, type AuthConfig } from './config.js';
import { UserRepository } from './user-repository.js';
import { LocalPasswordProvider } from './local-password-provider.js';
import { DbSessionStore } from './db-session-store.js';
import { createAuthenticate } from './authenticate-middleware.js';
import type { IIdentityProvider, ISessionStore } from './types.js';

export interface AuthSystem {
  config: AuthConfig;
  identityProvider: IIdentityProvider;
  sessionStore: ISessionStore;
  authenticate: RequestHandler;
}

export function createAuthSystem(db: Database.Database, config: AuthConfig = loadAuthConfig()): AuthSystem {
  const users = new UserRepository(db);
  const identityProvider = new LocalPasswordProvider(users, config);
  const sessionStore = new DbSessionStore(db, config);
  const authenticate = createAuthenticate(sessionStore, config);
  return { config, identityProvider, sessionStore, authenticate };
}

export { loadAuthConfig } from './config.js';
export type { AuthConfig } from './config.js';

// M2 surface: tenant context (the seam M3's TenantScopedRepository consumes) + CSRF.
export {
  runWithPrincipal,
  getCurrentUserId,
  getCurrentPrincipal,
  tryGetCurrentPrincipal,
  setDatabaseTenant,
} from './tenant-context.js';
export { csrfTokenForSession, createOriginCheck, createCsrfGuard, issueCsrfCookie } from './csrf.js';
export { createRateLimiters } from './rate-limiters.js';
export type {
  AuthenticatedPrincipal,
  IIdentityProvider,
  ISessionStore,
  PasswordCredentials,
  SessionContext,
} from './types.js';
