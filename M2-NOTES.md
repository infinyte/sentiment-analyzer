# M2 — Middleware, CSRF, Rate Limiting & Lockout — Handoff Notes

Hardens the M1 request path: a canonical `authenticate()` that binds a request-scoped tenant
context, layered CSRF defense, rate limiting on credential endpoints, and account-associated
exponential-backoff lockout. Additive on top of M1 — **no schema change**, M1 security behaviors
(cookie attributes, anti-enumeration) preserved.

## What was built

### 1. authenticate() + request-scoped tenant context
- `services/auth/tenant-context.ts` — an `AsyncLocalStorage` holding the current `AuthenticatedPrincipal`.
  - `runWithPrincipal(principal, fn)` binds it for the rest of the request (propagates across `await`).
  - `getCurrentUserId()` / `getCurrentPrincipal()` read it and **throw** if called outside an authenticated context; `tryGetCurrentPrincipal()` returns `undefined` instead.
  - `setDatabaseTenant(userId)` is a **no-op for SQLite** with a `// M3/Postgres:` marker — becomes `SET app.current_user_id` per connection so RLS can attach without restructuring.
- `authenticate()` (`authenticate-middleware.ts`) now wraps `next()` in `runWithPrincipal(...)` after resolving the session, so every downstream handler/await can read the current user. This is the seam **M3's `TenantScopedRepository` consumes** — the repository and `user_id` domain columns are **not** built here.

### 2. CSRF protection (layered — `services/auth/csrf.ts`)
1. **SameSite=Lax** on the session cookie — confirmed still set in `routes/auth.ts` (not regressed).
2. **Origin/Referer check** (`createOriginCheck`) on every state-changing method (POST/PUT/PATCH/DELETE) against the configured `ALLOWED_ORIGINS` allow-list (no wildcard) → 403 on mismatch. Skipped only when no allow-list is configured (dev default; production must set `ALLOWED_ORIGINS`).
3. **Session-bound synchronizer token** (`createCsrfGuard`): `token = base64url(HMAC-SHA256(serverSecret, sessionId))` where `sessionId = SHA-256(rawCookieToken)` (the `sessions.id`). Delivered via a non-HttpOnly `__Host-sa_csrf` cookie **and** `GET /api/v1/auth/csrf`; required echoed in `X-CSRF-Token` on state-changing requests; timing-safe compared → 403 on mismatch. Because the HMAC input is the session id, a token minted for one session **fails under any other session** — defeating the naive double-submit bypass the design doc flags.
- **Applied to** the authenticated mutations `/logout` and `/logout-all` (and inherited by future M4 endpoints). `/login` and `/register` are **unauthenticated** (no session exists yet to bind a token to) so they rely on the Origin check + rate limiting instead — per the design doc.
- **Library decision:** implemented explicitly rather than pulling a package. `csurf` is deprecated; most "csrf" libraries do naive double-submit, which the doc explicitly rejects. A session-bound HMAC is ~30 lines, dependency-free, and exactly the prescribed pattern.

### 3. Rate limiting (`services/auth/rate-limiters.ts`)
- `express-rate-limit` (installed unused in M1, now wired). Limiters are built **once per app** in `createRateLimiters(config)` (called from `createAuthRouter`), never per-request — per OWASP.
- `POST /login` — **5 / 15 min**, keyed on **email + IP** (`login:<email>:<ip>`), IP normalized via `ipKeyGenerator`.
- `POST /register` — **10 / hour per IP**.
- `passwordResetRequest` — **5 / hour** per account + IP, **defined but not attached** (`// M4:` — the reset endpoint is M4).
- Light caps on `/logout` (60/15min), `/me` and `/csrf` (120/min) per IP.
- All return **429 + `Retry-After`** with a **generic** body (no account-existence disclosure). Email is read safely from the parsed body (global `express.json()` runs before the router), defaulting to `unknown` so a malformed body can't bypass the account key.
- `// Azure/scale:` `MemoryStore` is per-process; a shared store (rate-limit-redis) is the multi-instance answer — not implemented.

### 4. Account lockout with exponential backoff (`local-password-provider.ts`)
- Uses the **existing M1 columns** — no schema change. ⚠️ The column is **`failed_login_attempts`** (the M2 prompt referenced `failed_login_count`); the real M1 name is used. `locked_until` as in M1.
- **Account-associated** (not IP): unknown emails are never counted (avoids DoS-by-lockout probing and leaks nothing).
- Past `lockoutThreshold` (**5**) failures, lock for `lockoutBackoffBaseMs × 2^(n − threshold)` (Cognito-style `2^(n-5)` seconds with default base = 1000 ms), capped at `lockoutCapMs` (**15 min**).
- A locked account fails **generically** (`401 Invalid credentials.`, no cookie) — the lock is logged server-side only, never disclosed in the public response (chosen approach: no `Retry-After` on the lock either, to avoid any existence signal). A dummy Argon2 verify still runs on the locked path for timing parity.
- **Any successful login resets `failed_login_attempts` to 0** and clears the lock.
- M4 constraint noted in code: the forgot-password path must stay usable even when locked (not built here).

### Final middleware order (documented in `app.ts`)
Global: `helmet` → credentialed `cors` → `express.json()` → `cookieParser()` → routers.
Per protected auth route (in `routes/auth.ts`): `originCheck` (router-wide, state-changing only) → per-route **rate limiter** → **authenticate** (binds tenant context) → **csrfGuard** (mutations) → handler.
Rationale: headers/CORS wrap everything; cookies must be parsed before `authenticate` can read the session; rate limiting precedes auth so floods are shed cheaply; CSRF follows auth so the token binds to the resolved session.

## Tests (the M2 gate) — all green
- `tenant-context.test.ts` — accessor throws outside context; binds sync + across `await`; protected route 401 without / 200 with a session and returns the right `getCurrentUserId()`.
- `csrf.test.ts` — missing token → 403; forged token → 403; **token from a different session → 403** (proves session-binding); cross-origin POST → 403; GET needs no token; correct token + valid Origin → 200 (and destroys the session).
- `rate-limit.test.ts` — 6th `/login` → 429 + `Retry-After` (generic body); `/register` 11th → 429; unknown vs known account both 429 (no enumeration).
- `lockout.test.ts` — 5 failures lock; correct password rejected until the window passes; backoff grows ~2× per lock (`2^(n-5)`); success resets the counter; account-keyed not IP; HTTP locked account → generic 401, no cookie.
- Updated the M1 `/logout` integration test to fetch the CSRF token first (logout is now guarded) — an intended contract change, not a regression of M1 security behavior.

Gate: `lint` ✓, `type-check` ✓, `build` ✓, `npm test` ✓ (**950/950**, +18 M2 tests). Auto-discovered by the existing Jest config.

## Deviations from `multi-user-design.md`
1. **Design doc still absent** from the repo (same as M1). The M2 prompt was used as the spec.
2. **Column name:** prompt said `failed_login_count`; the shipped M1 column is `failed_login_attempts`. Used the real name; no schema change.
3. **CSRF library:** none adopted — explicit session-bound HMAC instead (deprecated/naive alternatives rejected, see above).

## Handoff state for M3
- **Tenant context is ready to consume:** `getCurrentUserId()` returns the current user inside any `authenticate()`-protected request. M3 builds `TenantScopedRepository` to read it and scope queries; adds `user_id` columns to domain tables + data migration; activates RLS (wire `setDatabaseTenant` → `SET app.current_user_id` for Postgres). None of that is done here.
- `authenticate()` is currently applied **per protected route**. M3 can apply it (or a variant) more broadly when domain routes become tenant-scoped — the context-binding is already centralized in the one middleware.
- CSRF guard + limiters are in place for new authenticated mutations to inherit (M4 reset/verify endpoints: add `csrfGuard` + attach the `passwordResetRequest` limiter).
