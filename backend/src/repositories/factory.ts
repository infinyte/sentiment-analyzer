/**
 * Repository factory.
 *
 * Current driver: sqlite (better-sqlite3, synchronous).
 * Future drivers: postgres | mysql  — add a new bundle class that implements
 * the same interfaces using an async driver; switch via StorageConfig.driver.
 *
 * Usage:
 *   import { createRepositories } from './repositories/factory.js';
 *   const repos = createRepositories({ driver: 'sqlite', db: storage.getDb() });
 *   repos.agents.findAgentById(id);
 */

import type Database from 'better-sqlite3';
import type {
  IAgentRepository,
  ITournamentRepository,
  ISentimentRepository,
  ISocialRepository,
  IBrokerRepository,
  IBacktestRepository,
} from './interfaces/index.js';
import {
  SQLiteAgentRepository,
  SQLiteTournamentRepository,
  SQLiteSentimentRepository,
  SQLiteSocialRepository,
  SQLiteBrokerRepository,
  SQLiteBacktestRepository,
} from './adapters/sqlite/index.js';

// ── Bundle type ───────────────────────────────────────────────────────────────

export interface RepositoryBundle {
  agents:      IAgentRepository;
  tournaments: ITournamentRepository;
  sentiment:   ISentimentRepository;
  social:      ISocialRepository;
  broker:      IBrokerRepository;
  backtest:    IBacktestRepository;
}

// ── Driver configs ────────────────────────────────────────────────────────────

export interface SQLiteConfig {
  driver: 'sqlite';
  /** Raw better-sqlite3 Database handle — typically from storage.getDb(). */
  db: Database.Database;
}

/**
 * Placeholder for future PostgreSQL support.
 * Add connectionString / pool options here when implementing the adapter.
 */
export interface PostgresConfig {
  driver: 'postgres';
  connectionString: string;
}

/**
 * Placeholder for future MySQL support.
 * Add connectionString / pool options here when implementing the adapter.
 */
export interface MySQLConfig {
  driver: 'mysql';
  connectionString: string;
}

export type StorageConfig = SQLiteConfig | PostgresConfig | MySQLConfig;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRepositories(config: StorageConfig): RepositoryBundle {
  switch (config.driver) {
    case 'sqlite':
      return createSQLiteBundle(config.db);

    case 'postgres':
      // TODO: implement PostgresRepositoryBundle and switch here.
      throw new Error('[repository-factory] PostgreSQL adapter not yet implemented.');

    case 'mysql':
      // TODO: implement MySQLRepositoryBundle and switch here.
      throw new Error('[repository-factory] MySQL adapter not yet implemented.');
  }
}

function createSQLiteBundle(db: Database.Database): RepositoryBundle {
  return {
    agents:      new SQLiteAgentRepository(db),
    tournaments: new SQLiteTournamentRepository(db),
    sentiment:   new SQLiteSentimentRepository(db),
    social:      new SQLiteSocialRepository(db),
    broker:      new SQLiteBrokerRepository(db),
    backtest:    new SQLiteBacktestRepository(db),
  };
}
