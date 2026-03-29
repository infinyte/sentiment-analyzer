/**
 * Frontend tournament types — mirrors backend TournamentService types exactly.
 *
 * Audit findings:
 *  - No prior tournament types existed in frontend/src/types/.
 *  - Existing MARL types live in frontend/src/types/marl.ts (CompetitionStatus,
 *    FinalRanking, EquitySnapshot, etc.) — those are NOT redefined here.
 *  - Created from scratch to match backend tournament-service.ts exports.
 */

// ── Status ────────────────────────────────────────────────────────────────────

/** Lifecycle states for a tournament as returned by /api/tournaments. */
export type TournamentStatus =
  | 'QUEUED'     // Created but not yet started
  | 'RUNNING'    // Actively executing
  | 'PAUSED'     // Execution halted; resumable
  | 'STOPPED'    // Manually terminated; not resumable
  | 'COMPLETED'  // Finished naturally
  | 'ERROR';     // Crashed with an error

// ── AgentSnapshot ─────────────────────────────────────────────────────────────

/** Per-agent performance snapshot, updated on every stats tick. */
export interface AgentSnapshot {
  agentId: string;
  /** Agent architecture type (e.g. 'HYBRID', 'RULE_BASED', 'ML_BASED'). */
  agentType: string;
  /** Risk profile: 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING'. */
  riskProfile: string;
  portfolioValueUsd: number;
  initialCapitalUsd: number;
  pnlUsd: number;
  /** PnL expressed as a percentage of initial capital. */
  pnlPercent: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** Win rate as a fraction 0–1. */
  winRate: number;
  /** Null when not yet calculable (insufficient trade history). */
  sharpeRatio: number | null;
  maxDrawdownPercent: number;
  currentSignal: 'BUY' | 'SELL' | 'HOLD' | null;
  currentSentiment: 'BULL' | 'BEAR' | 'NEUTRAL' | null;
  lastUpdatedAt: string; // ISO-8601 (dates serialised to strings over the wire)
}

// ── Tournament ────────────────────────────────────────────────────────────────

/** Full tournament record as returned by GET /api/tournaments/:id. */
export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  /** Null when not an EVOLUTIONARY competition. */
  generationNumber: number | null;
  agents: AgentSnapshot[];
  startedAt: string | null;   // ISO-8601
  pausedAt: string | null;
  resumedAt: string | null;
  stoppedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  coinsUnderAnalysis: string[];
  /** Accumulated run time in ms, excluding paused intervals. */
  totalElapsedMs: number;
  progress: number; // 0–100
}

// ── API response wrappers ─────────────────────────────────────────────────────

/** Standard envelope returned by all /api/tournaments endpoints. */
export interface TournamentApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

// ── SSE event payloads ────────────────────────────────────────────────────────

/** Payload for SSE 'stats' events. */
export interface TournamentStatsEvent {
  type: 'stats';
  tournamentId: string;
  agents: AgentSnapshot[];
  status: TournamentStatus;
  progress: number;
  timestamp: string;
}

/** Payload for SSE 'status' events. */
export interface TournamentStatusEvent {
  type: 'status';
  tournamentId: string;
  status: TournamentStatus;
  timestamp: string;
}

/** Payload for SSE 'heartbeat' events. */
export interface TournamentHeartbeatEvent {
  type: 'heartbeat';
  timestamp: string;
}

export type TournamentStreamEvent =
  | TournamentStatsEvent
  | TournamentStatusEvent
  | TournamentHeartbeatEvent;
