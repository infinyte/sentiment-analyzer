/**
 * Migration registry.
 *
 * The ordered list of version-tracked migrations applied by `runMigrations`.
 * Legacy tables (backtest_results, agent_registry, …) remain owned by
 * `storage.ts#createTables()` and are intentionally NOT re-declared here; the
 * versioned runner begins at version 4 (the M1 auth schema). Append new
 * migrations in ascending version order.
 */

import type { Migration } from './runner.js';
import { migration004AuthSchema } from './004-auth-schema.js';

export const ALL_MIGRATIONS: Migration[] = [
  migration004AuthSchema,
];

export { runMigrations, rollbackMigrations } from './runner.js';
export type { Migration } from './runner.js';
