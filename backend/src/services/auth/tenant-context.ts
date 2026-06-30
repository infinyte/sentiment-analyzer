/**
 * Request-scoped tenant context (M2).
 *
 * A single `AsyncLocalStorage` holds the current request's authenticated
 * principal. `authenticate()` binds it once per request via `runWithPrincipal`;
 * downstream code reads it through `getCurrentUserId()` / `getCurrentPrincipal()`
 * without threading the user through every call signature.
 *
 * This is the seam **M3's `TenantScopedRepository` consumes** — it will read
 * `getCurrentUserId()` to scope every query. M2 builds the context + accessors
 * ONLY; it does not build the repository or touch domain tables.
 *
 * The `setDatabaseTenant` hook is a deliberate no-op for SQLite. On Postgres it
 * becomes `SET app.current_user_id = ...` per connection so row-level security
 * can enforce isolation in the database — see the `// M3/Postgres:` marker.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthenticatedPrincipal } from './types.js';

interface TenantStore {
  principal: AuthenticatedPrincipal;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Run `fn` with the given principal bound as the current tenant context.
 * Everything awaited inside `fn` observes the same context (AsyncLocalStorage
 * propagates across async boundaries).
 */
export function runWithPrincipal<T>(principal: AuthenticatedPrincipal, fn: () => T): T {
  return storage.run({ principal }, fn);
}

/** The current principal, or `undefined` outside an authenticated context. */
export function tryGetCurrentPrincipal(): AuthenticatedPrincipal | undefined {
  return storage.getStore()?.principal;
}

/** The current principal; throws if called outside an authenticated request. */
export function getCurrentPrincipal(): AuthenticatedPrincipal {
  const store = storage.getStore();
  if (!store) {
    throw new Error(
      '[tenant-context] No authenticated context. getCurrentPrincipal() must run inside authenticate().',
    );
  }
  return store.principal;
}

/** The current user id; throws if called outside an authenticated request. */
export function getCurrentUserId(): string {
  return getCurrentPrincipal().userId;
}

/**
 * Bind the database connection to the current tenant for the duration of a
 * request. No-op on SQLite (single-file, no RLS).
 *
 * M3/Postgres: issue `SET app.current_user_id = $userId` (or `SET LOCAL` inside
 * a transaction) on the checked-out connection so Postgres row-level security
 * policies filter rows by the current user. Wire it here without restructuring
 * callers — the userId is already in the AsyncLocalStorage store above.
 */
export function setDatabaseTenant(_userId: string): void {
  // Intentionally empty for SQLite. See doc comment.
}
