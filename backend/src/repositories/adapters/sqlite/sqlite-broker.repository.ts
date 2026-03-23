import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BrokerCredentials, StoredCredential, BrokerOrder, EncryptedBlob } from '../../../types/broker.js';
import type { IBrokerRepository } from '../../interfaces/broker.repository.js';

// ── AES-256-GCM helpers ───────────────────────────────────────────────────────
// Key derivation mirrors storage.ts: 64-char hex → use directly; else SHA-256.

function getMasterKey(): Buffer {
  const raw = process.env['BROKER_MASTER_KEY'];
  if (!raw) throw new Error('[broker-repository] BROKER_MASTER_KEY env var is not set');
  return /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : createHash('sha256').update(raw).digest();
}

function encrypt(plaintext: string): EncryptedBlob {
  const key        = getMasterKey();
  const iv         = randomBytes(12);
  const cipher     = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv:         iv.toString('hex'),
    authTag:    cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

function decrypt(blob: EncryptedBlob): string {
  const key      = getMasterKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'hex'));
  return (
    decipher.update(Buffer.from(blob.ciphertext, 'hex')).toString('utf8') +
    decipher.final('utf8')
  );
}

// ── Order row → BrokerOrder mapper ───────────────────────────────────────────

type OrderRow = {
  id: string;
  competitionId: string;
  agentId: string;
  clientOrderId: string;
  brokerOrderId: string | null;
  credentialId: string;
  provider: BrokerOrder['provider'];
  mode: BrokerOrder['mode'];
  symbol: string;
  side: BrokerOrder['side'];
  quantity: number;
  limitPrice: number | null;
  status: BrokerOrder['status'];
  filledQuantity: number;
  avgFillPrice: number;
  submittedAt: string;
  updatedAt: string;
  brokerResponse: string | null;
};

function mapOrder(r: OrderRow): BrokerOrder {
  return {
    ...r,
    brokerOrderId:  r.brokerOrderId  ?? undefined,
    limitPrice:     r.limitPrice     ?? undefined,
    brokerResponse: r.brokerResponse ? JSON.parse(r.brokerResponse) : undefined,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class SQLiteBrokerRepository implements IBrokerRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Credentials ────────────────────────────────────────────────────────────

  async saveCredential(credential: BrokerCredentials): Promise<void> {
    const payload   = JSON.stringify({ apiKey: credential.apiKey, apiSecret: credential.apiSecret });
    const encrypted = encrypt(payload);
    const now       = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO broker_credentials (id, label, provider, mode, encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label     = excluded.label,
        provider  = excluded.provider,
        mode      = excluded.mode,
        encrypted = excluded.encrypted
    `).run(
      credential.id,
      credential.label,
      credential.provider,
      credential.mode,
      JSON.stringify(encrypted),
      now,
    );
  }

  async listCredentials(): Promise<StoredCredential[]> {
    const rows = this.db.prepare(`
      SELECT id, label, provider, mode, encrypted,
             created_at AS createdAt, last_used AS lastUsed
      FROM   broker_credentials
      ORDER  BY created_at DESC
    `).all() as Array<StoredCredential & { encrypted: string }>;

    return rows.map(r => ({
      ...r,
      encrypted: JSON.parse(r.encrypted) as EncryptedBlob,
    }));
  }

  async getDecryptedCredential(id: string): Promise<BrokerCredentials | null> {
    const row = this.db.prepare(`
      SELECT id, label, provider, mode, encrypted
      FROM   broker_credentials
      WHERE  id = ?
    `).get(id) as { id: string; label: string; provider: BrokerCredentials['provider']; mode: BrokerCredentials['mode']; encrypted: string } | undefined;

    if (!row) return null;

    const blob      = JSON.parse(row.encrypted) as EncryptedBlob;
    const plaintext = decrypt(blob);
    const { apiKey, apiSecret } = JSON.parse(plaintext) as { apiKey: string; apiSecret: string };

    // Touch last_used.
    this.db.prepare('UPDATE broker_credentials SET last_used = ? WHERE id = ?').run(new Date().toISOString(), id);

    return { id: row.id, label: row.label, provider: row.provider, mode: row.mode, apiKey, apiSecret };
  }

  async deleteCredential(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM broker_credentials WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Order audit ────────────────────────────────────────────────────────────

  async insertOrder(order: BrokerOrder): Promise<void> {
    this.db.prepare(`
      INSERT OR IGNORE INTO broker_order_audit (
        id, competition_id, agent_id, client_order_id, broker_order_id,
        credential_id, provider, mode, symbol, side, quantity, limit_price,
        status, filled_quantity, avg_fill_price,
        submitted_at, updated_at, broker_response
      ) VALUES (
        @id, @competitionId, @agentId, @clientOrderId, @brokerOrderId,
        @credentialId, @provider, @mode, @symbol, @side, @quantity, @limitPrice,
        @status, @filledQuantity, @avgFillPrice,
        @submittedAt, @updatedAt, @brokerResponse
      )
    `).run({
      ...order,
      limitPrice:     order.limitPrice     ?? null,
      brokerOrderId:  order.brokerOrderId  ?? null,
      brokerResponse: order.brokerResponse ? JSON.stringify(order.brokerResponse) : null,
    });
  }

  async updateOrder(
    clientOrderId: string,
    updates: Partial<Pick<BrokerOrder, 'status' | 'filledQuantity' | 'avgFillPrice' | 'brokerOrderId' | 'updatedAt' | 'brokerResponse'>>,
  ): Promise<void> {
    const fields: string[]                   = ['updated_at = @updatedAt'];
    const params: Record<string, unknown>    = {
      clientOrderId,
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
    };

    if (updates.status         !== undefined) { fields.push('status = @status');                   params['status']         = updates.status; }
    if (updates.filledQuantity !== undefined) { fields.push('filled_quantity = @filledQuantity');   params['filledQuantity'] = updates.filledQuantity; }
    if (updates.avgFillPrice   !== undefined) { fields.push('avg_fill_price = @avgFillPrice');      params['avgFillPrice']   = updates.avgFillPrice; }
    if (updates.brokerOrderId  !== undefined) { fields.push('broker_order_id = @brokerOrderId');    params['brokerOrderId']  = updates.brokerOrderId; }
    if (updates.brokerResponse !== undefined) { fields.push('broker_response = @brokerResponse');   params['brokerResponse'] = JSON.stringify(updates.brokerResponse); }

    this.db.prepare(
      `UPDATE broker_order_audit SET ${fields.join(', ')} WHERE client_order_id = @clientOrderId`,
    ).run(params);
  }

  async getOrders(competitionId: string, agentId?: string): Promise<BrokerOrder[]> {
    const select = `
      SELECT id,
             competition_id  AS competitionId,
             agent_id        AS agentId,
             client_order_id AS clientOrderId,
             broker_order_id AS brokerOrderId,
             credential_id   AS credentialId,
             provider, mode, symbol, side, quantity,
             limit_price     AS limitPrice,
             status,
             filled_quantity AS filledQuantity,
             avg_fill_price  AS avgFillPrice,
             submitted_at    AS submittedAt,
             updated_at      AS updatedAt,
             broker_response AS brokerResponse
      FROM   broker_order_audit
      WHERE  competition_id = ?
    `;
    const rows = agentId
      ? this.db.prepare(`${select} AND agent_id = ? ORDER BY submitted_at DESC`).all(competitionId, agentId)
      : this.db.prepare(`${select} ORDER BY submitted_at DESC`).all(competitionId);

    return (rows as OrderRow[]).map(mapOrder);
  }

  async getOpenOrders(): Promise<BrokerOrder[]> {
    const rows = this.db.prepare(`
      SELECT id,
             competition_id  AS competitionId,
             agent_id        AS agentId,
             client_order_id AS clientOrderId,
             broker_order_id AS brokerOrderId,
             credential_id   AS credentialId,
             provider, mode, symbol, side, quantity,
             limit_price     AS limitPrice,
             status,
             filled_quantity AS filledQuantity,
             avg_fill_price  AS avgFillPrice,
             submitted_at    AS submittedAt,
             updated_at      AS updatedAt,
             broker_response AS brokerResponse
      FROM   broker_order_audit
      WHERE  status IN ('PENDING', 'SUBMITTED', 'PARTIALLY_FILLED')
      ORDER  BY submitted_at DESC
    `).all();

    return (rows as OrderRow[]).map(mapOrder);
  }
}
