/**
 * authenticate() middleware (M1).
 *
 * Resolves the session cookie to an `AuthenticatedPrincipal` and attaches it to
 * `req.principal`. Rejects with a generic 401 when the cookie is absent or
 * invalid/expired. This is the single seam point through which the rest of the
 * app learns *who* the caller is.
 *
 * Deliberately structured so later milestones extend it WITHOUT restructuring:
 *   • M2 hangs CSRF / Origin checks off the same handler.
 *   • M3 binds the resolved principal into AsyncLocalStorage tenant context
 *     right after resolution (TenantScopedRepository consumes it there).
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthConfig } from './config.js';
import type { AuthenticatedPrincipal, ISessionStore } from './types.js';

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
      // M3: bind `principal` into AsyncLocalStorage tenant context here.
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
