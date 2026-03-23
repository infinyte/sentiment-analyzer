import { Router, type Request, type Response, type NextFunction } from 'express';
import { appConfigService } from '../services/app-config-service.js';
import logger from '../logger.js';

// ── Auth middleware ───────────────────────────────────────────────────────────
// CONFIG_ADMIN_PASSWORD stays in process.env only — never stored in the DB.

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = process.env['CONFIG_ADMIN_PASSWORD'];
  if (!adminPassword) {
    res.status(503).json({ error: 'Admin config endpoint not enabled (CONFIG_ADMIN_PASSWORD not set)' });
    return;
  }

  const authHeader = req.headers.authorization;
  const provided = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : (req.body as Record<string, string> | undefined)?.['password'];

  if (!provided || provided !== adminPassword) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

// ── Protected keys ────────────────────────────────────────────────────────────
// These can never be written via the API — they must stay in the environment.

const PROTECTED_KEYS = new Set([
  'BROKER_MASTER_KEY',
  'CONFIG_ADMIN_PASSWORD',
  'PORT',
  'DATABASE_PATH',
  'REDIS_URL',
  'NODE_ENV',
]);

// ── Router ────────────────────────────────────────────────────────────────────

export function createAdminConfigRouter(): Router {
  const router = Router();

  /**
   * GET /api/admin/config
   * Returns all config rows. Secret values are masked as "***".
   */
  router.get('/', requireAdminAuth, (_req: Request, res: Response) => {
    try {
      const rows = appConfigService.getAll();
      res.json({ config: rows });
    } catch (err) {
      logger.error('admin-config GET error', { error: String(err) });
      res.status(500).json({ error: 'Failed to retrieve config' });
    }
  });

  /**
   * PATCH /api/admin/config/:key
   * Sets a single config value. Body: { value: string }
   */
  router.patch('/:key', requireAdminAuth, (req: Request, res: Response) => {
    const { key } = req.params;
    const { value } = req.body as { value?: unknown };

    if (PROTECTED_KEYS.has(key)) {
      res.status(403).json({ error: `Key "${key}" is protected and cannot be set via the API` });
      return;
    }

    if (typeof value !== 'string') {
      res.status(400).json({ error: 'Body must contain a "value" string field' });
      return;
    }

    // Verify key exists in catalog
    const catalog = appConfigService.getCatalog();
    const entry = catalog.find(e => e.key === key);
    if (!entry) {
      res.status(404).json({ error: `Config key "${key}" not found in catalog` });
      return;
    }

    try {
      appConfigService.set(key, value);
      logger.info('admin-config key updated', { key });

      // Return the updated row with secret masked
      const rows = appConfigService.getAll();
      const updated = rows.find(r => r.key === key);
      res.json({ config: updated });
    } catch (err) {
      logger.error('admin-config PATCH error', { key, error: String(err) });
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  /**
   * DELETE /api/admin/config/:key
   * Clears a config value (reverts to env/default fallback).
   */
  router.delete('/:key', requireAdminAuth, (req: Request, res: Response) => {
    const { key } = req.params;

    if (PROTECTED_KEYS.has(key)) {
      res.status(403).json({ error: `Key "${key}" is protected and cannot be cleared via the API` });
      return;
    }

    const catalog = appConfigService.getCatalog();
    if (!catalog.find(e => e.key === key)) {
      res.status(404).json({ error: `Config key "${key}" not found in catalog` });
      return;
    }

    try {
      appConfigService.clear(key);
      logger.info('admin-config key cleared', { key });
      res.json({ message: `Config key "${key}" cleared — will fall back to env/default` });
    } catch (err) {
      logger.error('admin-config DELETE error', { key, error: String(err) });
      res.status(500).json({ error: 'Failed to clear config' });
    }
  });

  return router;
}
