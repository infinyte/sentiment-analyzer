import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import { encryptWithMasterKey, decryptWithMasterKey } from './crypto-utils.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfigCatalogEntry {
  key: string;
  category: string;
  description: string;
  isSecret: boolean;
  defaultValue: string;
}

export interface ConfigRow {
  key: string;
  value: string | null;  // null = use env fallback; "***" for secrets in getAll()
  category: string;
  description: string;
  isSecret: boolean;
  updatedAt: string;
}

// ── Config catalog ────────────────────────────────────────────────────────────
// All configurable env vars. BROKER_MASTER_KEY, CONFIG_ADMIN_PASSWORD, PORT,
// DATABASE_PATH, REDIS_URL, NODE_ENV are intentionally excluded — they are
// infrastructure/security vars that must remain in the environment file.

const CONFIG_CATALOG: ConfigCatalogEntry[] = [
  // ── Claude / AI ──────────────────────────────────────────────────────────
  { key: 'CLAUDE_API_KEY',          category: 'AI',      description: 'Anthropic Claude API key',                           isSecret: true,  defaultValue: '' },
  { key: 'CLAUDE_MODEL',            category: 'AI',      description: 'Claude model to use (e.g. claude-3-5-sonnet-20241022)', isSecret: false, defaultValue: 'claude-3-5-sonnet-20241022' },
  { key: 'HUGGINGFACE_API_TOKEN',   category: 'AI',      description: 'HuggingFace API token for FinBERT calls',            isSecret: true,  defaultValue: '' },
  { key: 'FINBERT_API_URL',         category: 'AI',      description: 'Remote FinBERT scoring endpoint URL',                isSecret: false, defaultValue: '' },

  // ── News / Market data ───────────────────────────────────────────────────
  { key: 'NEWSAPI_API_KEY',         category: 'News',    description: 'NewsAPI.org API key',                                isSecret: true,  defaultValue: '' },
  { key: 'LUNARCRUSH_API_KEY',      category: 'News',    description: 'LunarCrush API key',                                 isSecret: true,  defaultValue: '' },
  { key: 'ONCHAIN_API_KEY',         category: 'News',    description: 'On-chain data API key',                              isSecret: true,  defaultValue: '' },
  { key: 'ONCHAIN_API_URL',         category: 'News',    description: 'On-chain data API base URL',                        isSecret: false, defaultValue: '' },

  // ── Social scrapers ──────────────────────────────────────────────────────
  { key: 'TWITTER_BEARER_TOKEN',    category: 'Social',  description: 'Twitter/X bearer token for API v2',                 isSecret: true,  defaultValue: '' },
  { key: 'X_BEARER_TOKEN',          category: 'Social',  description: 'Alias for TWITTER_BEARER_TOKEN',                    isSecret: true,  defaultValue: '' },
  { key: 'REDDIT_CLIENT_ID',        category: 'Social',  description: 'Reddit OAuth2 client ID',                           isSecret: false, defaultValue: '' },
  { key: 'REDDIT_CLIENT_SECRET',    category: 'Social',  description: 'Reddit OAuth2 client secret',                       isSecret: true,  defaultValue: '' },
  { key: 'REDDIT_USERNAME',         category: 'Social',  description: 'Reddit account username for auth',                   isSecret: false, defaultValue: '' },
  { key: 'REDDIT_PASSWORD',         category: 'Social',  description: 'Reddit account password for auth',                   isSecret: true,  defaultValue: '' },
  { key: 'DISCORD_BOT_TOKEN',       category: 'Social',  description: 'Discord bot token',                                  isSecret: true,  defaultValue: '' },
  { key: 'DISCORD_CHANNEL_IDS',     category: 'Social',  description: 'Comma-separated Discord channel IDs to monitor',    isSecret: false, defaultValue: '' },
  { key: 'TELEGRAM_BOT_TOKEN',      category: 'Social',  description: 'Telegram bot token',                                 isSecret: true,  defaultValue: '' },
  { key: 'TELEGRAM_CHANNEL_USERNAMES', category: 'Social', description: 'Comma-separated Telegram channel usernames',      isSecret: false, defaultValue: '' },
  { key: 'YOUTUBE_API_KEY',         category: 'Social',  description: 'YouTube Data API v3 key',                           isSecret: true,  defaultValue: '' },
  { key: 'RAPIDAPI_KEY',            category: 'Social',  description: 'RapidAPI subscription key (for TikTok scraper)',     isSecret: true,  defaultValue: '' },
  { key: 'RAPIDAPI_TIKTOK_HOST',    category: 'Social',  description: 'RapidAPI TikTok host override',                     isSecret: false, defaultValue: 'tiktok-scraper7.p.rapidapi.com' },

  // ── Sentiment / Trending ─────────────────────────────────────────────────
  { key: 'SENTIMENT_JOB_CRON',      category: 'Scheduler', description: 'Cron schedule for sentiment refresh job',         isSecret: false, defaultValue: '0 */4 * * *' },
  { key: 'TRENDING_JOB_CRON',       category: 'Scheduler', description: 'Cron schedule for trending coins job',            isSecret: false, defaultValue: '*/30 * * * *' },
  { key: 'SOCIAL_SCRAPE_CRON',      category: 'Scheduler', description: 'Cron schedule for social media scraping',         isSecret: false, defaultValue: '*/15 * * * *' },
  { key: 'SENTIMENT_BATCH_SIZE',    category: 'Scheduler', description: 'Number of coins processed per sentiment batch',   isSecret: false, defaultValue: '10' },
  { key: 'SENTIMENT_TTL_MS',        category: 'Scheduler', description: 'Sentiment cache TTL in milliseconds',             isSecret: false, defaultValue: '3600000' },
  { key: 'TRENDING_MIN_MENTIONS',   category: 'Scheduler', description: 'Minimum mentions to be considered trending',      isSecret: false, defaultValue: '3' },
  { key: 'TRENDING_WINDOW_HOURS',   category: 'Scheduler', description: 'Time window (hours) for trending calculation',    isSecret: false, defaultValue: '24' },
  { key: 'SOCIAL_HISTORY_DAYS',     category: 'Scheduler', description: 'Days of social media history to retain',         isSecret: false, defaultValue: '7' },
  { key: 'SOCIAL_PRUNE_RETAIN_DAYS', category: 'Scheduler', description: 'Days of social data to keep when pruning',      isSecret: false, defaultValue: '30' },
  { key: 'INGEST_QUEUE_CONCURRENCY', category: 'Scheduler', description: 'Concurrent ingest queue workers',               isSecret: false, defaultValue: '5' },

  // ── Auth ─────────────────────────────────────────────────────────────────
  { key: 'API_SECRET_KEY',          category: 'Auth',    description: 'Secret key for POST /api/refresh-sentiment auth',   isSecret: true,  defaultValue: '' },

  // ── Trading ──────────────────────────────────────────────────────────────
  { key: 'TRADING_MODE',            category: 'Trading', description: 'Trading mode: paper | sandbox | live',              isSecret: false, defaultValue: 'paper' },
  { key: 'TRADING_PROVIDER',        category: 'Trading', description: 'Exchange provider: crypto-com | binance-us | coinbase | alpaca', isSecret: false, defaultValue: 'crypto-com' },
  { key: 'TRADING_INITIAL_CAPITAL', category: 'Trading', description: 'Starting capital for paper/simulated trading (USD)',isSecret: false, defaultValue: '10000' },
  { key: 'TRADING_MAX_LOSS_PERCENT', category: 'Trading', description: 'Kill-switch: max daily drawdown percentage',      isSecret: false, defaultValue: '5' },
  { key: 'TRADING_MAX_POSITION_PERCENT', category: 'Trading', description: 'Max percentage of capital in one position',  isSecret: false, defaultValue: '15' },
  { key: 'TRADING_MAX_OPEN_POSITIONS', category: 'Trading', description: 'Max number of concurrent open positions',      isSecret: false, defaultValue: '3' },
  { key: 'REQUIRE_MANUAL_APPROVAL', category: 'Trading', description: 'Require manual approval for live orders (true/false)', isSecret: false, defaultValue: 'false' },

  // ── Crypto.com exchange ───────────────────────────────────────────────────
  { key: 'CRYPTO_COM_API_KEY',      category: 'Crypto.com', description: 'Crypto.com Exchange API key',                   isSecret: true,  defaultValue: '' },
  { key: 'CRYPTO_COM_API_SECRET',   category: 'Crypto.com', description: 'Crypto.com Exchange API secret',                isSecret: true,  defaultValue: '' },
  { key: 'CRYPTO_COM_TRADING_PAIR', category: 'Crypto.com', description: 'Default trading pair (e.g. BTC_USDT)',          isSecret: false, defaultValue: 'BTC_USDT' },
  { key: 'CRYPTO_COM_REST_URL',     category: 'Crypto.com', description: 'Crypto.com sandbox REST URL',                   isSecret: false, defaultValue: 'https://uat.crypto.com/exchange/v1' },
  { key: 'CRYPTO_COM_LIVE_URL',     category: 'Crypto.com', description: 'Crypto.com live REST URL',                      isSecret: false, defaultValue: 'https://api.crypto.com/exchange/v1' },

  // ── Coinbase exchange ─────────────────────────────────────────────────────
  { key: 'COINBASE_API_KEY',        category: 'Coinbase', description: 'Coinbase Advanced Trade API key',                  isSecret: true,  defaultValue: '' },
  { key: 'COINBASE_API_SECRET',     category: 'Coinbase', description: 'Coinbase Advanced Trade API secret',               isSecret: true,  defaultValue: '' },
  { key: 'COINBASE_TRADING_PAIR',   category: 'Coinbase', description: 'Default Coinbase product ID (e.g. BTC-USD)',       isSecret: false, defaultValue: 'BTC-USD' },

  // ── Alpaca broker ─────────────────────────────────────────────────────────
  { key: 'ALPACA_API_KEY',          category: 'Alpaca',  description: 'Alpaca API key',                                    isSecret: true,  defaultValue: '' },
  { key: 'ALPACA_API_SECRET',       category: 'Alpaca',  description: 'Alpaca API secret',                                 isSecret: true,  defaultValue: '' },
  { key: 'ALPACA_DATA_URL',         category: 'Alpaca',  description: 'Alpaca market data base URL',                       isSecret: false, defaultValue: 'https://data.alpaca.markets' },
  { key: 'ALPACA_PAPER_API_URL',    category: 'Alpaca',  description: 'Alpaca paper trading base URL',                     isSecret: false, defaultValue: 'https://paper-api.alpaca.markets' },
  { key: 'ALPACA_LIVE_API_URL',     category: 'Alpaca',  description: 'Alpaca live trading base URL',                      isSecret: false, defaultValue: 'https://api.alpaca.markets' },

  // ── Binance.US exchange ───────────────────────────────────────────────────
  { key: 'BINANCE_SANDBOX_API_KEY',    category: 'Binance', description: 'Binance.US sandbox API key',                    isSecret: true,  defaultValue: '' },
  { key: 'BINANCE_SANDBOX_API_SECRET', category: 'Binance', description: 'Binance.US sandbox API secret',                 isSecret: true,  defaultValue: '' },
  { key: 'BINANCE_SANDBOX_TEST_NET',   category: 'Binance', description: 'Binance.US sandbox API base URL',               isSecret: false, defaultValue: 'https://testnet.binance.vision' },
  { key: 'BINANCE_LIVE_API_KEY',    category: 'Binance', description: 'Binance.US live API key',                          isSecret: true,  defaultValue: '' },
  { key: 'BINANCE_LIVE_API_SECRET', category: 'Binance', description: 'Binance.US live API secret',                       isSecret: true,  defaultValue: '' },
  { key: 'BINANCE_LIVE_URL',        category: 'Binance', description: 'Binance.US live REST base URL',                    isSecret: false, defaultValue: 'https://api.binance.us' },

  // ── Telemetry ─────────────────────────────────────────────────────────────
  { key: 'APPLICATIONINSIGHTS_CONNECTION_STRING', category: 'Telemetry', description: 'Azure Application Insights connection string', isSecret: true, defaultValue: '' },
];

// ── AppConfigService ──────────────────────────────────────────────────────────

export class AppConfigService extends EventEmitter {
  private db: Database.Database | null = null;
  /** In-memory cache: key → raw plaintext value (or null if row has no value) */
  private cache = new Map<string, string | null>();
  /** Keys that are marked secret in the catalog */
  private secretKeys = new Set<string>(
    CONFIG_CATALOG.filter(e => e.isSecret).map(e => e.key)
  );

  // ── Init ────────────────────────────────────────────────────────────────

  init(db: Database.Database): void {
    this.db = db;
    this.seed();
    this.loadCache();
  }

  /** Insert any catalog keys that don't yet have a DB row. */
  private seed(): void {
    if (!this.db) return;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO app_config (key, value, category, description, is_secret, updated_at)
      VALUES (?, NULL, ?, ?, ?, datetime('now'))
    `);

    const upsertMeta = this.db.prepare(`
      UPDATE app_config
      SET category = ?, description = ?, is_secret = ?
      WHERE key = ?
    `);

    const seedAll = this.db.transaction(() => {
      for (const entry of CONFIG_CATALOG) {
        insert.run(entry.key, entry.category, entry.description, entry.isSecret ? 1 : 0);
        // Refresh metadata (category/description may have changed in code) without
        // clobbering an existing user-set value.
        upsertMeta.run(entry.category, entry.description, entry.isSecret ? 1 : 0, entry.key);
      }
    });
    seedAll();
  }

  /** Load all rows from DB into the in-memory cache (decrypting secrets). */
  private loadCache(): void {
    if (!this.db) return;
    this.cache.clear();

    const rows = this.db.prepare('SELECT key, value, is_secret FROM app_config').all() as Array<{
      key: string; value: string | null; is_secret: number;
    }>;

    for (const row of rows) {
      if (row.value === null) {
        this.cache.set(row.key, null);
        continue;
      }
      if (row.is_secret) {
        try {
          const blob = JSON.parse(row.value);
          this.cache.set(row.key, decryptWithMasterKey(blob));
        } catch {
          // Corrupted or unencrypted value — treat as null.
          this.cache.set(row.key, null);
        }
      } else {
        this.cache.set(row.key, row.value);
      }
    }
  }

  // ── Read ────────────────────────────────────────────────────────────────

  /**
   * Returns the config value for `key`.
   * Priority: DB cache → process.env fallback → catalog default → undefined.
   */
  get(key: string): string | undefined {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (cached !== null && cached !== undefined) return cached;
    }
    // Fall back to environment (supports safe migration: existing .env still works)
    const env = process.env[key];
    if (env !== undefined && env !== '') return env;

    // Fall back to catalog default
    const catalogEntry = CONFIG_CATALOG.find(e => e.key === key);
    if (catalogEntry?.defaultValue) return catalogEntry.defaultValue;

    return undefined;
  }

  /**
   * Returns all config rows, with secret values masked as "***".
   * Includes the resolved value (DB or env fallback) for display.
   */
  getAll(): ConfigRow[] {
    if (!this.db) return [];

    const rows = this.db.prepare(`
      SELECT key, value, category, description, is_secret, updated_at
      FROM app_config
      ORDER BY category, key
    `).all() as Array<{
      key: string; value: string | null; category: string;
      description: string; is_secret: number; updated_at: string;
    }>;

    return rows.map(row => {
      const isSecret = row.is_secret === 1;
      let displayValue: string | null;

      if (isSecret) {
        // Never expose plaintext; show *** if a value is set (DB or env)
        const resolved = this.get(row.key);
        displayValue = resolved ? '***' : null;
      } else {
        // For non-secrets show the resolved value (may be env fallback)
        displayValue = this.get(row.key) ?? null;
      }

      return {
        key: row.key,
        value: displayValue,
        category: row.category,
        description: row.description,
        isSecret,
        updatedAt: row.updated_at,
      };
    });
  }

  // ── Write ───────────────────────────────────────────────────────────────

  /**
   * Persists a value for `key`. Secrets are AES-256-GCM encrypted at rest.
   * Updates the in-memory cache and emits a 'change' event.
   */
  set(key: string, value: string): void {
    if (!this.db) throw new Error('AppConfigService not initialized');

    let storedValue: string;
    if (this.secretKeys.has(key)) {
      const blob = encryptWithMasterKey(value);
      storedValue = JSON.stringify(blob);
    } else {
      storedValue = value;
    }

    this.db.prepare(`
      UPDATE app_config
      SET value = ?, updated_at = datetime('now')
      WHERE key = ?
    `).run(storedValue, key);

    // Refresh cache for this key
    this.cache.set(key, value);

    this.emit('change', key, value);
  }

  /**
   * Clears the DB value for `key`, reverting to env/default fallback.
   */
  clear(key: string): void {
    if (!this.db) throw new Error('AppConfigService not initialized');

    this.db.prepare(`
      UPDATE app_config SET value = NULL, updated_at = datetime('now')
      WHERE key = ?
    `).run(key);

    this.cache.set(key, null);
    this.emit('change', key, undefined);
  }

  /**
   * Subscribe to changes on a specific key.
   */
  onChange(key: string, handler: (newValue: string | undefined) => void): void {
    this.on('change', (changedKey: string, newValue: string | undefined) => {
      if (changedKey === key) handler(newValue);
    });
  }

  getCatalog(): ConfigCatalogEntry[] {
    return CONFIG_CATALOG;
  }
}

export const appConfigService = new AppConfigService();
