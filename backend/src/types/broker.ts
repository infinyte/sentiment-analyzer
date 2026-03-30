/**
 * Broker / exchange types shared across the real-trading layer.
 *
 * Rule: nothing in this file may import from runtime modules.
 * It is a pure type manifest — safe to import anywhere without side-effects.
 */

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type ExchangeMode   = 'SIMULATED' | 'PAPER' | 'REALISTIC_PAPER' | 'LIVE';
export type BrokerProvider = 'ALPACA';
export type OrderStatus    = 'PENDING' | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type OrderSide      = 'BUY' | 'SELL';

// ─── Credentials ──────────────────────────────────────────────────────────────

/** Raw (decrypted) credentials — never persisted in this form. */
export interface BrokerCredentials {
  id:        string;
  label:     string;
  provider:  BrokerProvider;
  mode:      ExchangeMode;
  apiKey:    string;   // NEVER log or serialise
  apiSecret: string;   // NEVER log or serialise
}

/** AES-256-GCM ciphertext envelope stored in SQLite. */
export interface EncryptedBlob {
  iv:         string;  // hex, 12 bytes
  authTag:    string;  // hex, 16 bytes
  ciphertext: string;  // hex
}

/** Row shape returned from the broker_credentials table. */
export interface StoredCredential {
  id:        string;
  label:     string;
  provider:  BrokerProvider;
  mode:      ExchangeMode;
  encrypted: EncryptedBlob;
  createdAt: string;
  lastUsed?: string;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

/** Request object passed to IBrokerAdapter.placeOrder(). */
export interface PlaceOrderRequest {
  competitionId:  string;
  agentId:        string;
  credentialId:   string;
  clientOrderId:  string;  // UUID we generate; sent to broker for idempotency
  symbol:         string;  // normalised (e.g. "BTC" — adapter maps to exchange format)
  side:           OrderSide;
  quantity:       number;
  limitPrice?:    number;  // omit for market orders
}

/** Full order record — stored in broker_order_audit. */
export interface BrokerOrder {
  id:             string;
  competitionId:  string;
  agentId:        string;
  clientOrderId:  string;
  brokerOrderId?: string;
  credentialId:   string;
  provider:       BrokerProvider;
  mode:           ExchangeMode;
  symbol:         string;
  side:           OrderSide;
  quantity:       number;
  limitPrice?:    number;
  status:         OrderStatus;
  filledQuantity: number;
  avgFillPrice:   number;
  submittedAt:    string;
  updatedAt:      string;
  brokerResponse?: unknown;  // raw broker JSON; credentials stripped before storage
}

/** Lightweight fill notification emitted by the adapter. */
export interface FillEvent {
  clientOrderId:  string;
  brokerOrderId:  string;
  filledQuantity: number;
  avgFillPrice:   number;
  status:         OrderStatus;
  timestamp:      Date;
}

// ─── Account / positions ──────────────────────────────────────────────────────

export interface BrokerPosition {
  symbol:        string;
  quantity:      number;
  avgEntryPrice: number;
  marketValue:   number;
}

export interface BrokerAccount {
  cash:        number;
  equity:      number;
  buyingPower: number;
  positions:   BrokerPosition[];
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface IBrokerAdapter {
  readonly provider:     BrokerProvider;
  readonly mode:         ExchangeMode;
  readonly credentialId: string;

  /** Establish connection (HTTP + optional WebSocket). */
  connect(): Promise<void>;

  /** Gracefully disconnect WebSocket and flush any pending state. */
  disconnect(): Promise<void>;

  /**
   * Confirm which of the requested symbols are tradeable on this broker.
   * Returns the validated subset (unknown symbols are dropped with a warning).
   */
  validateSymbols(symbols: string[]): Promise<string[]>;

  /** Fetch current account balances. */
  getAccount(): Promise<BrokerAccount>;

  /** Fetch open positions. */
  getPositions(): Promise<BrokerPosition[]>;

  /** Place a limit order. Returns a BrokerOrder in SUBMITTED status. */
  placeOrder(req: PlaceOrderRequest): Promise<BrokerOrder>;

  /** Poll for the latest fill status of a single order. */
  pollOrderStatus(clientOrderId: string): Promise<Pick<BrokerOrder, 'status' | 'filledQuantity' | 'avgFillPrice' | 'brokerOrderId'>>;

  /** Cancel a single order. Returns true if cancelled, false if already terminal. */
  cancelOrder(clientOrderId: string): Promise<boolean>;

  /** Cancel all open orders for a competition. Returns count cancelled. */
  cancelAllOrders(competitionId: string): Promise<number>;

  /** Register a fill-event handler (EventEmitter pattern). */
  onFill(handler: (event: FillEvent) => void): void;

  /** Deregister a fill-event handler. */
  offFill(handler: (event: FillEvent) => void): void;
}

// ─── Risk configuration ───────────────────────────────────────────────────────

export interface RiskConfig {
  /** Max fraction of portfolio allocated to any single symbol (0–1). Default 0.10. */
  maxPositionPct: number;
  /** Halt an agent for the step if equity drop vs step-open exceeds this. Default 0.02. */
  maxLossPerStepPct: number;
  /** Emergency-stop the competition if any agent is down more than this from day open. Default 0.10. */
  maxDailyDrawdownPct: number;
  /** Whitelist of allowed symbols. Empty array = all symbols allowed. */
  allowedSymbols: string[];
  /** If true, each agent's cash is ring-fenced in software. Default true. */
  capitalIsolation: boolean;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionPct:      0.10,
  maxLossPerStepPct:   0.02,
  maxDailyDrawdownPct: 0.10,
  allowedSymbols:      [],
  capitalIsolation:    true,
};
