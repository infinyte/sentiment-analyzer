import type { AgentGenome } from '../../services/evolutionary/agent-genome.js';

// ── Agent status ──────────────────────────────────────────────────────────────

export type AgentStatus = 'ACTIVE' | 'RETIRED';

// ── Registry ──────────────────────────────────────────────────────────────────

export interface AgentRecord {
  id: string;
  agent_type: string;
  risk_profile: string;
  status: AgentStatus;
  custom_name: string | null;
  emoji: string | null;
  color: string | null;
  biography: string | null;
  personality_traits: string | null;
  nickname: string | null;
  age_iterations: number;
  generation_number: number;
  parent_id_1: string | null;
  parent_id_2: string | null;
  created_at: string;
}

export interface RegisterAgentOptions {
  agentId: string;
  agentType: string;
  riskProfile: string;
  generationNumber?: number;
  parentId1?: string;
  parentId2?: string;
  initialGenome: AgentGenome;
}

// ── Cosmetics ─────────────────────────────────────────────────────────────────

export interface AgentCosmetics {
  custom_name: string | null;
  emoji: string | null;
  color: string | null;
  biography: string | null;
  nickname: string | null;
}

// ── Statistics ────────────────────────────────────────────────────────────────

export interface AgentStats {
  agent_id: string;
  total_competitions: number;
  total_wins: number;
  total_losses: number;
  win_rate_percent: number;
  total_pnl: number;
  max_drawdown_percent: number;
  sharpe_ratio: number;
  roi_percent: number;
  trades_executed: number;
  consistency_score: number;
  avg_trade_profit: number;
  last_updated?: string;
}

export interface AgentWithCosmetics extends AgentStats {
  custom_name: string | null;
  emoji: string | null;
  color: string | null;
}

export interface CompetitionResultInput {
  competitionId: string;
  rank: number;
  agentCount: number;
  startingCapital: number;
  endingCapital: number;
  tradesExecuted: number;
  winTrades: number;
  lossTrades: number;
  largestWin: number;
  largestLoss: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
}

export interface AgentCompetitionRecord {
  id: string;
  agent_id: string;
  competition_id: string;
  rank_position: number;
  starting_capital: number;
  ending_capital: number;
  pnl: number;
  trades_count: number;
  win_trades: number;
  loss_trades: number;
  largest_win: number;
  largest_loss: number;
  sharpe_ratio: number;
  completed_at: string;
}

// ── Genealogy ─────────────────────────────────────────────────────────────────

export interface GenealogyRecord {
  id?: string;
  agent_id: string;
  parent_1_id: string | null;
  parent_2_id: string | null;
  breeding_date: string;
  breeding_generation: number;
  inherited_genes: Record<string, 'parent1' | 'parent2' | 'blend'>;
  mutations_applied: Array<{ param: string; oldValue: unknown; newValue: unknown }>;
  mutation_severity: string;
  offspring_count: number;
}

// ── Repository interface ──────────────────────────────────────────────────────

export interface AgentPage {
  agents: Array<AgentRecord & Partial<AgentStats>>;
  total: number;
}

export interface IAgentRepository {
  // Registry
  registerAgent(opts: RegisterAgentOptions): Promise<void>;
  findAgentById(id: string): Promise<AgentRecord | null>;
  findAllAgents(status?: AgentStatus): Promise<AgentRecord[]>;
  /** Returns a paginated JOIN of agent_registry + agent_statistics, ordered by win_rate_percent DESC. */
  findAgentsPaginated(status: AgentStatus, limit: number, offset: number): Promise<AgentPage>;
  updateAgentStatus(id: string, status: AgentStatus): Promise<void>;

  // Cosmetics
  getCosmetics(agentId: string): Promise<AgentCosmetics | null>;
  updateCosmetics(agentId: string, cosmetics: Partial<AgentCosmetics>): Promise<void>;

  // Statistics
  initializeStats(agentId: string): Promise<void>;
  getStats(agentId: string): Promise<AgentStats | null>;
  getAllStats(): Promise<AgentStats[]>;
  getTopAgents(limit: number): Promise<AgentWithCosmetics[]>;
  recordCompetitionResult(agentId: string, result: CompetitionResultInput): Promise<void>;
  getAgentCompetitions(agentId: string, limit?: number): Promise<AgentCompetitionRecord[]>;

  // Genealogy
  saveGenealogyRecord(record: GenealogyRecord): Promise<void>;
  getGenealogyForAgent(agentId: string): Promise<GenealogyRecord[]>;

  // Genome
  saveGenome(agentId: string, genome: AgentGenome): Promise<void>;
  loadGenome(agentId: string): Promise<AgentGenome | null>;
  deleteGenome(agentId: string): Promise<void>;

  // Learning states
  saveLearningState(cacheKey: string, snapshot: unknown): Promise<void>;
  loadLearningState(cacheKey: string): Promise<unknown>;
  getAllLearningStates(): Promise<Map<string, unknown>>;
  deleteLearningState(cacheKey: string): Promise<void>;
}
