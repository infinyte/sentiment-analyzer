# M1 — Auth Schema & Local Password Provider — Handoff Notes

Self-hosted email+password authentication: schema, password/session services behind a
swappable seam, and the four core endpoints with cookie hardening and a passing test gate.
Purely additive — no existing domain table or behavior was changed.

## What was built

### Foundations
- **Deps added** (`backend/package.json`): `argon2`, `express-rate-limit` (installed, **not wired** — M2),
  `cookie-parser`, `zod`, `uuid`, `helmet` (already present), plus `@types/cookie-parser`.
- **Versioned migration runner** — `backend/src/database/migrations/runner.ts` + `index.ts`.
  Adds a `schema_migrations` (version, name, applied_at) table, applies pending migrations in a
  single synchronous transaction each, and supports reversible rollback (`down()`).
  Invoked from `StorageService.connect()` after the legacy `createTables()`.
- **Swappable auth seam** — `backend/src/services/auth/types.ts`:
  `AuthenticatedPrincipal`, `IIdentityProvider`, `ISessionStore`, `PasswordCredentials`, `SessionContext`.
  Application code above the seam depends only on `AuthenticatedPrincipal`.

### Database (migration 004, version-tracked, reversible)
`backend/src/database/migrations/004-auth-schema.ts` creates exactly five tables:
`users`, `sessions`, `password_reset_tokens`, `email_verification_tokens`, `user_settings`.
- TEXT UUID PKs, INTEGER booleans (0/1), ISO-8601 TEXT timestamps, snake_case identifiers, plural tables.
- `CREATE UNIQUE INDEX … ON users(email COLLATE NOCASE)` for case-insensitive email uniqueness.
- FKs `ON DELETE CASCADE`; indexes on `sessions(user_id)`, `sessions(expires_at)`, token-hash uniqueness.
- `users.failed_login_attempts` / `users.locked_until` columns exist but are **unused** (lockout = M2).
- Pragmas `foreign_keys = ON` + `journal_mode = WAL` are enforced per connection in `storage.ts`
  (and in the test harness) — the connection-open hook, not ad hoc.

### Services (behind the seam)
- **`LocalPasswordProvider`** (`services/auth/local-password-provider.ts`) — Argon2id
  `{ type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }`; env-overridable
  (`AUTH_ARGON2_MEMORY_COST` / `_TIME_COST` / `_PARALLELISM`). Overlong-password DoS guard
  (max 128, byte-length aware) rejected before hashing; NIST min length 8. `authenticate()`
  verifies against a cached dummy hash for unknown emails (constant-time). `register()` is
  anti-enumeration (identical outcome, no second row) and creates an email-verification token
  row; the mailer call is a documented `// M4:` no-op.
- **`DbSessionStore`** (`services/auth/db-session-store.ts`) — 256-bit CSPRNG raw token; only its
  **SHA-256 hash** is persisted (as `sessions.id`); raw token goes to the cookie only.
  `create` / `resolve` / `revoke` / `revokeAllForUser`; `expires_at` authoritative on `resolve`
  (expired → null + pruned). Default session lifetime 7 days (`AUTH_SESSION_TTL_MS`).
- **`UserRepository`** — the snake_case⇄camelCase translation boundary (below the seam only).
- **`createAuthSystem(db, config?)`** (`services/auth/index.ts`) — single wiring point shared by
  `app.ts` and the tests.

### Endpoints & middleware
Mounted under `/api/v1/auth` via `createAuthRouter(db)` (in `app.ts`, DB-healthy block):
- `POST /register` — zod-validated; 201 identical response (anti-enumeration); 400 on invalid input / weak password.
- `POST /login` — generic 401 on failure (no cookie); on success mints a session + sets the cookie.
- `POST /logout` — server-side `revoke` of the current session, then clears the cookie.
- `GET /me` — returns the current `AuthenticatedPrincipal` (the SPA hydrates from this in M5), else 401.
- `authenticate()` middleware (`services/auth/authenticate-middleware.ts`) — resolves the cookie →
  `req.principal`, generic 401 when absent/invalid. Structured so M2 (CSRF/Origin) and M3
  (AsyncLocalStorage tenant binding) extend it without restructuring.

Cookie: name `__Host-sa_session`; `HttpOnly; Secure; SameSite=Lax; Path=/`; **no `Domain`**.
`helmet` already applied app-wide. CORS upgraded to credentialed against an explicit allow-list
**only when `ALLOWED_ORIGINS` is set** (no wildcard with credentials); unset preserves the prior
permissive default — see deviation below.

### Tests (the M1 gate) — all green
- `__tests__/auth/local-password-provider.test.ts` — round-trip, wrong password, unknown-email
  constant-time path, PHC `$argon2id$` storage (never plaintext), anti-enumeration (no 2nd row),
  case-insensitive email, verification-token row, DoS length guards.
- `__tests__/auth/db-session-store.test.ts` — lifecycle, raw token never stored (only SHA-256 = id),
  expired → null + pruned, bogus token → null, `revokeAllForUser`.
- `__tests__/auth/auth-endpoints.test.ts` — supertest against a **real temp-file SQLite DB**:
  register row count + anti-enumeration, hardened-cookie attribute assertions, generic 401s,
  `/me` with/without cookie, logout proves **server-side** destruction (stale cookie → 401),
  password not leaked in the response body.

Gate status: `npm run lint` ✓, `npm run type-check` ✓, `npm run build` ✓, `npm test` ✓ (932/932,
including the 24 new auth tests). Auto-discovered by the existing Jest config — no script wiring needed.

## Deviations from `multi-user-design.md` (with rationale)
1. **The design doc is absent from the repo** (not at root, `docs/`, or any branch in git history).
   The M1 prompt restated the requirements in full, so it was used as the spec. The exact column
   lists for the five tables were therefore **derived** from the prompt's stated constraints
   (UUID PKs, INTEGER booleans, ISO timestamps, `email COLLATE NOCASE`, failed-attempt columns).
   If the canonical DDL surfaces later and differs, reconcile via a follow-up migration (version 5+).
2. **No pre-existing migration framework.** The repo created tables ad hoc via
   `CREATE TABLE IF NOT EXISTS` in `storage.ts` and an untracked `runMigration003` used only in tests.
   Per the prompt, a `schema_migrations`-backed runner was introduced (conforming to the repo's
   `runMigrationNNN(db)` style). Legacy tables remain owned by `createTables()`; the versioned runner
   begins at version 4 (the auth schema). No tool like Drizzle was introduced — the repo already
   standardizes on raw `better-sqlite3`.
3. **Global CORS** was made credential-aware only when `ALLOWED_ORIGINS` is configured (explicit
   allow-list, `credentials: true`), falling back to the prior `origin: '*'` when unset. This satisfies
   the credentialed-CORS requirement for the cookie seam while keeping existing behavior (and all
   existing tests) unchanged by default.

## Benchmarked Argon2 params (on this host)
Spec params `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }` measured via
`npm run auth:benchmark-argon2`: **avg ≈ 41 ms** (min 38, max 45) over 5 samples on this CI/cloud host.
This is **below** the 250–400 ms target because the host is fast. The spec params are kept as the
**defaults** (the documented OWASP baseline) and are env-overridable with no code change. **Action for
the production host:** run the benchmark there and raise `AUTH_ARGON2_MEMORY_COST` (e.g. 65536+) until
avg lands in 250–400 ms. Params were not lowered below spec.

## Handoff state for M2
- `express-rate-limit` is installed but **not wired** — add it to `/register` and `/login` (and globally as desired).
- Account lockout / exponential backoff: the columns (`failed_login_attempts`, `locked_until`) exist
  and are untouched. Inline `// M2:` markers in `local-password-provider.ts` (increment on failure) and
  `routes/auth.ts` (count failed attempt / backoff) mark the insertion points.
- CSRF / double-submit / Origin enforcement: extend the `authenticate()` middleware and the login/register
  handlers — the middleware is the single seam point and already isolated for this.
- Untouched for later: M3 tenant context + `user_id` columns + `TenantScopedRepository`; M4 reset/verify
  confirm flows + real mailer (token rows + a `// M4:` stub already exist); M5 frontend hydration off `/me`.
