import Database from 'better-sqlite3';
import type { Database as BetterSqliteDb } from 'better-sqlite3';
import { AppConfigService } from '../../services/app-config-service.js';

describe('AppConfigService', () => {
  let db: BetterSqliteDb;
  let service: AppConfigService;
  const originalMasterKey = process.env.BROKER_MASTER_KEY;

  beforeEach(() => {
    process.env.BROKER_MASTER_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT,
        category TEXT NOT NULL DEFAULT 'General',
        description TEXT NOT NULL DEFAULT '',
        is_secret INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    service = new AppConfigService();
    service.init(db);
  });

  afterEach(() => {
    db.close();
    delete process.env.CLAUDE_API_KEY;
    delete process.env.SENTIMENT_BATCH_SIZE;
  });

  afterAll(() => {
    if (originalMasterKey === undefined) delete process.env.BROKER_MASTER_KEY;
    else process.env.BROKER_MASTER_KEY = originalMasterKey;
  });

  it('masks secret values in getAll()', () => {
    service.set('CLAUDE_API_KEY', 'secret-key');

    const rows = service.getAll();
    const row = rows.find(r => r.key === 'CLAUDE_API_KEY');

    expect(row).toBeDefined();
    expect(row?.isSecret).toBe(true);
    expect(row?.value).toBe('***');
  });

  it('stores encrypted secret values at rest', () => {
    service.set('CLAUDE_API_KEY', 'top-secret-value');

    const stored = db.prepare('SELECT value FROM app_config WHERE key = ?').get('CLAUDE_API_KEY') as { value: string };
    expect(stored).toBeDefined();
    expect(stored.value).not.toContain('top-secret-value');

    const parsed = JSON.parse(stored.value) as { iv?: string; authTag?: string; ciphertext?: string };
    expect(parsed.iv).toBeDefined();
    expect(parsed.authTag).toBeDefined();
    expect(parsed.ciphertext).toBeDefined();
  });

  it('uses env fallback when DB value is null', () => {
    process.env.SENTIMENT_BATCH_SIZE = '77';

    const value = service.get('SENTIMENT_BATCH_SIZE');
    expect(value).toBe('77');
  });

  it('notifies onChange listeners when watched key changes', () => {
    const handler = jest.fn();
    service.onChange('SENTIMENT_BATCH_SIZE', handler);

    service.set('SENTIMENT_BATCH_SIZE', '88');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('88');
  });
});
