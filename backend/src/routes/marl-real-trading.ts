/**
 * Real-trading routes for the MARL competition system.
 *
 * Endpoints:
 *   POST   /api/marl/broker/credentials        — store encrypted broker credentials
 *   GET    /api/marl/broker/credentials        — list stored credential metadata (no secrets)
 *   DELETE /api/marl/broker/credentials/:id    — remove a stored credential
 *   POST   /api/marl/broker/connect/:id        — decrypt + connect a credential (activate adapter)
 *   GET    /api/marl/broker/connected          — list currently connected adapters
 *   GET    /api/marl/broker/orders/:competitionId — order audit trail
 *   POST   /api/marl/broker/emergency-stop     — cancel all open orders for a competition
 *
 * All mutating endpoints require x-api-key header matching API_SECRET_KEY.
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { storage } from '../storage.js';
import { brokerRegistry } from '../services/brokers/broker-registry.js';
import { createBrokerAdapter } from '../services/brokers/broker-factory.js';
import type { BrokerProvider, ExchangeMode } from '../types/broker.js';
import logger from '../logger.js';

const router = Router();

// ─── Auth guard ────────────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response): boolean {
  if (req.headers['x-api-key'] !== process.env.API_SECRET_KEY) {
    res.status(401).json({ error: 'Unauthorized — x-api-key required' });
    return false;
  }
  return true;
}

// ─── POST /api/marl/broker/credentials ────────────────────────────────────────
// Store encrypted broker credentials. Never returns the raw key/secret.

router.post('/api/marl/broker/credentials', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  const { label, provider, mode, apiKey, apiSecret } = req.body as {
    label?:     string;
    provider?:  string;
    mode?:      string;
    apiKey?:    string;
    apiSecret?: string;
  };

  if (!provider || !mode || !apiKey || !apiSecret) {
    return res.status(400).json({ error: 'provider, mode, apiKey, and apiSecret are required' });
  }
  if (!['ALPACA'].includes(provider)) {
    return res.status(400).json({ error: `unsupported provider: ${provider}` });
  }
  if (!['PAPER', 'LIVE'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be PAPER or LIVE' });
  }

  if (!process.env.BROKER_MASTER_KEY) {
    return res.status(503).json({ error: 'BROKER_MASTER_KEY env var not set — cannot encrypt credentials' });
  }

  try {
    const id = randomUUID();
    storage.saveBrokerCredential({
      id,
      label:     label ?? `${provider} ${mode} ${id.slice(0, 8)}`,
      provider:  provider as BrokerProvider,
      mode:      mode as ExchangeMode,
      apiKey,
      apiSecret,
    });

    logger.info('broker credential stored', { id, provider, mode });
    res.status(201).json({ id, provider, mode, label: label ?? `${provider} ${mode} ${id.slice(0, 8)}` });
  } catch (err) {
    logger.error('broker credential store failed', { error: String(err) });
    res.status(500).json({ error: 'Failed to store credentials' });
  }
});

// ─── GET /api/marl/broker/credentials ─────────────────────────────────────────
// List stored credentials (metadata only — no secrets or encrypted blobs).

router.get('/api/marl/broker/credentials', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  try {
    const creds = storage.listBrokerCredentials().map(c => ({
      id:        c.id,
      label:     c.label,
      provider:  c.provider,
      mode:      c.mode,
      createdAt: c.createdAt,
      lastUsed:  c.lastUsed,
      connected: brokerRegistry.has(c.id),
    }));
    res.json({ credentials: creds, count: creds.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/marl/broker/credentials/picker ──────────────────────────────────
// Unauthenticated endpoint that returns only id + label + provider + mode.
// Used by the frontend dropdown so the user never has to copy-paste UUIDs.
// No secrets or encrypted blobs are included.

router.get('/api/marl/broker/credentials/picker', (_req: Request, res: Response) => {
  try {
    const creds = storage.listBrokerCredentials().map(c => ({
      id:       c.id,
      label:    c.label,
      provider: c.provider,
      mode:     c.mode,
    }));
    res.json({ credentials: creds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── DELETE /api/marl/broker/credentials/:id ──────────────────────────────────

router.delete('/api/marl/broker/credentials/:id', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  const { id } = req.params;

  // Disconnect active adapter if connected
  await brokerRegistry.unregister(id).catch(() => {});

  const deleted = storage.deleteBrokerCredential(id);
  if (!deleted) return res.status(404).json({ error: 'Credential not found' });

  logger.info('broker credential deleted', { id });
  res.json({ deleted: true, id });
});

// ─── POST /api/marl/broker/connect/:id ────────────────────────────────────────
// Decrypt credentials and connect the adapter into the in-process registry.
// Must be called after a server restart before any PAPER/LIVE competition can run.

router.post('/api/marl/broker/connect/:id', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  const { id } = req.params;

  if (!process.env.BROKER_MASTER_KEY) {
    return res.status(503).json({ error: 'BROKER_MASTER_KEY env var not set' });
  }

  try {
    const decrypted = storage.decryptBrokerCredential(id);
    if (!decrypted) return res.status(404).json({ error: 'Credential not found' });

    const storedList = storage.listBrokerCredentials();
    const stored = storedList.find(c => c.id === id);
    if (!stored) return res.status(404).json({ error: 'Credential metadata not found' });

    const adapter = createBrokerAdapter({
      id:        stored.id,
      label:     stored.label,
      provider:  stored.provider,
      mode:      stored.mode,
      apiKey:    decrypted.apiKey,
      apiSecret: decrypted.apiSecret,
    });

    await brokerRegistry.register(adapter);

    logger.info('broker adapter connected', { id, provider: stored.provider, mode: stored.mode });
    res.json({ connected: true, id, provider: stored.provider, mode: stored.mode });
  } catch (err) {
    logger.error('broker connect failed', { id, error: String(err) });
    res.status(500).json({ error: `Connection failed: ${(err as Error).message}` });
  }
});

// ─── GET /api/marl/broker/connected ───────────────────────────────────────────

router.get('/api/marl/broker/connected', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  const ids = brokerRegistry.listIds();
  const creds = storage.listBrokerCredentials();
  const result = ids.map(id => {
    const meta = creds.find(c => c.id === id);
    return { id, provider: meta?.provider, mode: meta?.mode, label: meta?.label };
  });
  res.json({ connected: result, count: result.length });
});

// ─── GET /api/marl/broker/orders/:competitionId ───────────────────────────────
// Retrieve the order audit trail for a competition. Never exposes broker_response raw.

router.get('/api/marl/broker/orders/:competitionId', (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
  const { competitionId } = req.params;
  const agentId = req.query.agentId as string | undefined;

  try {
    const orders = storage.getBrokerOrders(competitionId, agentId).map(o => ({
      clientOrderId:  o.clientOrderId,
      brokerOrderId:  o.brokerOrderId,
      agentId:        o.agentId,
      symbol:         o.symbol,
      side:           o.side,
      quantity:       o.quantity,
      limitPrice:     o.limitPrice,
      status:         o.status,
      filledQuantity: o.filledQuantity,
      avgFillPrice:   o.avgFillPrice,
      submittedAt:    o.submittedAt,
      updatedAt:      o.updatedAt,
      // brokerResponse intentionally omitted from API response
    }));
    res.json({ competitionId, orders, count: orders.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/marl/broker/emergency-stop ─────────────────────────────────────
// Cancel all open orders for a competition and log the action.

router.post('/api/marl/broker/emergency-stop', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  const { competitionId, credentialId } = req.body as {
    competitionId?:  string;
    credentialId?:   string;
  };

  if (!competitionId || !credentialId) {
    return res.status(400).json({ error: 'competitionId and credentialId are required' });
  }

  const adapter = brokerRegistry.get(credentialId);
  if (!adapter) {
    return res.status(404).json({ error: `No connected adapter for credentialId: ${credentialId}` });
  }

  try {
    const cancelled = await adapter.cancelAllOrders(competitionId);
    logger.warn('broker emergency stop executed', { competitionId, credentialId, cancelled });
    res.json({ emergencyStop: true, competitionId, cancelled });
  } catch (err) {
    logger.error('emergency stop failed', { competitionId, error: String(err) });
    res.status(500).json({ error: `Emergency stop failed: ${(err as Error).message}` });
  }
});

export default router;
