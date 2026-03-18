/**
 * Frontend types for the MARL Competition system (Phase 2).
 * Mirrors the backend CompetitionResult and related interfaces.
 */

export type RiskProfile = 'CONSERVATIVE' | 'AGGRESSIVE' | 'SCALPING';
export type CompetitionMode = 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
export type SymbolSelectionMode = 'MANUAL' | 'AUTO';
export type ExchangeMode = 'SIMULATED' | 'PAPER' | 'LIVE';

export interface CompetitionAgent {
  id: string;
  riskProfile: RiskProfile;
  initialCapital?: number;
}

export interface CompetitionConfig {
  mode: CompetitionMode;
  agents: CompetitionAgent[];
  symbols: string[];
  symbolSelectionMode?: SymbolSelectionMode;
  autoUniverseSize?: number;
  autoCoinsPerAgent?: number;
  duration: number;
  refreshInterval: number;
  evolutionaryRounds?: number;
  learningEnabled: boolean;
  exchangeMode?: ExchangeMode;
  brokerCredentialId?: string;
}

export interface ScoredCoinEntry {
  symbol: string;
  name: string;
  market_rank: number;
  price_usd: number;
  price_change_7d_percent: number;
  volatility_24h: number;
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  sentiment_confidence: number;
  scores: { CONSERVATIVE: number; AGGRESSIVE: number; SCALPING: number };
}

export interface AgentSelection {
  agentId: string;
  riskProfile: RiskProfile;
  selectedSymbols: string[];
}

export interface CoinUniverseResponse {
  universeSize: number;
  coinsPerAgent: number;
  resolvedSymbols: string[];
  agentSelections: AgentSelection[];
  topCoins: ScoredCoinEntry[];
}

export interface FinalRanking {
  rank: number;
  agentId: string;
  finalCapital: number;
  totalReturn: number;   // as percentage (e.g. 3.14 = 3.14%)
  sharpeRatio: number;
  maxDrawdown: number;   // as percentage
  tradesExecuted: number;
  winRate: number;       // as percentage
}

export interface HeadToHeadMetric {
  agent1: string;
  agent2: string;
  agent1Return: number;  // percentage
  agent2Return: number;  // percentage
  winner: string;
}

export interface EquitySnapshot {
  timestamp: string;
  agentEquities: { agentId: string; equity: number }[];
}

export interface CompetitorImpact {
  agentId: string;
  averageLiquidityImpact: number;
  timesOutbid: number;
  timesOutsold: number;
}

export interface CompetitionResult {
  competitionId: string;
  mode: string;
  duration: number;
  startedAt: string;
  completedAt: string;
  finalRankings: FinalRanking[];
  headToHeadMetrics: HeadToHeadMetric[];
  equityEvolution: EquitySnapshot[];
  competitorImpact: CompetitorImpact[];
}

export interface CompetitionStatus {
  competitionId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  mode: string;
  agentCount: number;
  symbols: string[];
  startedAt: string;
  completedAt?: string;
  topPerformer: string | null;
  topReturn?: string | null;
}

export interface StartCompetitionResponse {
  competitionId: string;
  status: 'STARTED';
  mode: string;
  agentCount: number;
  symbols: string[];
  duration: number;
  learningEnabled: boolean;
  message: string;
}

export interface CompetitionSummary {
  competitionId: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  mode: string;
  agentCount: number;
  symbols: string[];
  duration: number;
  learningEnabled: boolean;
  startedAt: string;
  completedAt: string | null;
  progress: number;
  topPerformer: string | null;
  topReturn: string | null;
}

export interface CompetitionListResponse {
  total: number;
  competitions: CompetitionSummary[];
}

export interface AgentCompareResponse {
  agent1: string;
  agent2: string;
  rounds: number;
  agent1Wins: number;
  agent2Wins: number;
  agent1WinRate: number;
  agent2WinRate: number;
  avgAgent1Return: number;
  avgAgent2Return: number;
  overallWinner: string;
  roundDetails: {
    round: number;
    winner: string;
    agent1Return: number;
    agent2Return: number;
  }[];
}
