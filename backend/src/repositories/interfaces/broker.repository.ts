import type { BrokerCredentials, StoredCredential, BrokerOrder } from '../../types/broker.js';

export type { BrokerCredentials, StoredCredential, BrokerOrder };

// ── Repository interface ──────────────────────────────────────────────────────

export interface IBrokerRepository {
  // Credentials — stored AES-256-GCM encrypted at rest
  saveCredential(credential: BrokerCredentials): Promise<void>;
  listCredentials(): Promise<StoredCredential[]>;
  /** Decrypt and return plaintext credentials. Throws if BROKER_MASTER_KEY missing. */
  getDecryptedCredential(id: string): Promise<BrokerCredentials>;
  deleteCredential(id: string): Promise<void>;

  // Order audit trail
  insertOrder(order: BrokerOrder): Promise<void>;
  updateOrder(
    clientOrderId: string,
    updates: Partial<
      Pick<
        BrokerOrder,
        | 'status'
        | 'filledQuantity'
        | 'avgFillPrice'
        | 'brokerOrderId'
        | 'updatedAt'
        | 'brokerResponse'
      >
    >,
  ): Promise<void>;
  getOrders(competitionId: string, agentId?: string): Promise<BrokerOrder[]>;
  getOpenOrders(): Promise<BrokerOrder[]>;
}
