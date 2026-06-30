/**
 * authenticate() middleware (M1, upgraded in M2).
 *
 * Resolves the session cookie to an `AuthenticatedPrincipal`, attaches it to
 * `req.principal`, AND binds it into the request-scoped AsyncLocalStorage tenant
 * context for the remainder of the request (M2). Rejects with a generic 401 when
 * the cookie is absent or invalid/expired. This is the single seam point through
 * which the rest of the app learns *who* the caller is.
 *
 * Layered milestones:
 *   • M2 binds the principal into the tenant context here (done below) and hangs
 *     the CSRF guard off the route chain just after this middleware.
 *   • M3's TenantScopedRepository reads getCurrentUserId() from that context.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthConfig } from './config.js';
import type { AuthenticatedPrincipal, ISessionStore } from './types.js';
import { runWithPrincipal, setDatabaseTenant } from './tenant-context.js';

// Make `req.principal` visible to TypeScript across the app.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only after `authenticate()` has run successfully. */
      principal?: AuthenticatedPrincipal;
    }
  }
}

/** Read the raw session token from the hardened cookie (requires cookie-parser). */
export function readSessionCookie(req: Request, cookieName: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[cookieName];
}

/**
 * Build the `authenticate` middleware bound to a session store + config.
 * On success: sets `req.principal` and calls `next()`.
 * On failure: responds `401 { error: 'Unauthorized' }` (generic — no detail).
 */
export function createAuthenticate(
  sessionStore: ISessionStore,
  config: AuthConfig,
): RequestHandler {
  return async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = readSessionCookie(req, config.cookieName);
      const principal = rawToken ? await sessionStore.resolve(rawToken) : null;
      if (!principal) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.principal = principal;
      // Bind the principal into the request-scoped tenant context so everything
      // downstream (handlers + anything they await) can read getCurrentUserId().
      runWithPrincipal(principal, () => {
        // M3/Postgres: no-op on SQLite; becomes SET app.current_user_id for RLS.
        setDatabaseTenant(principal.userId);
        next();
      });
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
