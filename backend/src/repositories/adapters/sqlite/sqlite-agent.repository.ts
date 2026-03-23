import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentGenome } from '../../../services/evolutionary/agent-genome.js';
import type {
  IAgentRepository,
  AgentRecord,
  AgentStatus,
  RegisterAgentOptions,
  AgentCosmetics,
  AgentStats,
  AgentWithCosmetics,
  AgentWithStatsDetail,
  CompetitionResultInput,
  AgentCompetitionRecord,
  GenealogyRecord,
} from '../../interfaces/agent.repository.js';

// Allowed cosmetic column names — runtime whitelist prevents dynamic SQL injection.
const COSMETIC_COLUMNS = new Set<string>(['custom_name', 'emoji', 'color', 'biography', 'nickname']);

export class SQLiteAgentRepository implements IAgentRepository {
  constructor(private readonly db: Database.Database) {}

  // ── Registry ───────────────────────────────────────────────────────────────

  async registerAgent(opts: RegisterAgentOptions): Promise<void> {
    const {
      agentId,
      agentType,
      riskProfile,
      generationNumber = 0,
      parentId1,
      parentId2,
      initialGenome,
    } = opts;

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_registry
        (id, agent_type, risk_profile, status, generation_number,
         parent_id_1, parent_id_2, age_iterations, created_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, 0, ?)
    `).run(agentId, agentType, riskProfile, generationNumber, parentId1 ?? null, parentId2 ?? null, now);

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_genomes (agent_id, genome, updated_at)
      VALUES (?, ?, ?)
    `).run(agentId, JSON.stringify(initialGenome), now);
  }

  async findAgentById(id: string): Promise<AgentRecord | null> {
    const row = this.db.prepare('SELECT * FROM agent_registry WHERE id = ?').get(id) as AgentRecord | undefined;
    return row ?? null;
  }

  async findAllAgents(status?: AgentStatus): Promise<AgentRecord[]> {
    if (status) {
      return this.db.prepare(
        'SELECT * FROM agent_registry WHERE status = ? ORDER BY created_at DESC',
      ).all(status) as AgentRecord[];
    }
    return this.db.prepare('SELECT * FROM agent_registry ORDER BY created_at DESC').all() as AgentRecord[];
  }

  async countAgentsByStatus(status: AgentStatus): Promise<number> {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM agent_registry WHERE status = ?',
    ).get(status) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async updateAgentStatus(id: string, status: AgentStatus): Promise<void> {
    this.db.prepare('UPDATE agent_registry SET status = ? WHERE id = ?').run(status, id);
  }

  // ── Cosmetics ──────────────────────────────────────────────────────────────

  async getCosmetics(agentId: string): Promise<AgentCosmetics | null> {
    const row = this.db.prepare(
      'SELECT custom_name, emoji, color, biography, nickname FROM agent_registry WHERE id = ?',
    ).get(agentId) as AgentCosmetics | undefined;
    return row ?? null;
  }

  async updateCosmetics(agentId: string, cosmetics: Partial<AgentCosmetics>): Promise<void> {
    const fields = Object.keys(cosmetics).filter(k => COSMETIC_COLUMNS.has(k));
    if (fields.length === 0) return;
    const setClauses = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (cosmetics as Record<string, unknown>)[f] ?? null);
    this.db.prepare(`UPDATE agent_registry SET ${setClauses} WHERE id = ?`).run(...values, agentId);
  }

  // ── Statistics ─────────────────────────────────────────────────────────────

  async initializeStats(agentId: string): Promise<void> {
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_statistics
        (agent_id, total_competitions, total_wins, total_losses, win_rate_percent,
         total_pnl, max_drawdown_percent, sharpe_ratio, roi_percent,
         trades_executed, consistency_score, avg_trade_profit, last_updated)
      VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
    `).run(agentId, new Date().toISOString());
  }

  async getStats(agentId: string): Promise<AgentStats | null> {
    const row = this.db.prepare(
      'SELECT * FROM agent_statistics WHERE agent_id = ?',
    ).get(agentId) as AgentStats | undefined;
    return row ?? null;
  }

  async getAllStats(): Promise<AgentStats[]> {
    return this.db.prepare(
      'SELECT * FROM agent_statistics ORDER BY win_rate_percent DESC',
    ).all() as AgentStats[];
  }

  async getTopAgents(limit: number): Promise<AgentWithCosmetics[]> {
    return this.db.prepare(`
      SELECT s.*, r.custom_name, r.emoji, r.color
      FROM   agent_statistics s
      JOIN   agent_registry   r ON s.agent_id = r.id
      ORDER  BY s.win_rate_percent DESC
      LIMIT  ?
    `).all(limit) as AgentWithCosmetics[];
  }

  async findActiveAgentsWithStats(limit: number, offset: number): Promise<AgentWithStatsDetail[]> {
    return this.db.prepare(`
      SELECT s.*, r.id, r.agent_type, r.risk_profile, r.status, r.custom_name, r.emoji, r.color,
             r.biography, r.personality_traits, r.nickname, r.age_iterations, r.generation_number,
             r.parent_id_1, r.parent_id_2, r.created_at
      FROM   agent_statistics s
      JOIN   agent_registry   r ON s.agent_id = r.id
      WHERE  r.status = 'ACTIVE'
      ORDER  BY s.win_rate_percent DESC
      LIMIT  ?
      OFFSET ?
    `).all(limit, offset) as AgentWithStatsDetail[];
  }

  async recordCompetitionResult(agentId: string, result: CompetitionResultInput): Promise<void> {
    const isWin = result.rank === 1;
    const pnl   = result.endingCapital - result.startingCapital;
    const roi   = result.startingCapital > 0 ? (pnl / result.startingCapital) * 100 : 0;
    const now   = new Date().toISOString();

    const updateTx = this.db.transaction(() => {
      // Ensure the stats row exists first.
      this.db.prepare(`
        INSERT OR IGNORE INTO agent_statistics
          (agent_id, total_competitions, total_wins, total_losses, win_rate_percent,
           total_pnl, max_drawdown_percent, sharpe_ratio, roi_percent,
           trades_executed, consistency_score, avg_trade_profit, last_updated)
        VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
      `).run(agentId, now);

      const stats = this.db.prepare(
        'SELECT * FROM agent_statistics WHERE agent_id = ?',
      ).get(agentId) as AgentStats;

      const newComps      = stats.total_competitions + 1;
      const newWins       = stats.total_wins + (isWin ? 1 : 0);
      const newLosses     = stats.total_losses + (isWin ? 0 : 1);
      const newWinRate    = (newWins / newComps) * 100;
      const newTotalPnl   = stats.total_pnl + pnl;
      const newTotalTrades = stats.trades_executed + result.tradesExecuted;
      const newAvgProfit  = newTotalTrades > 0 ? newTotalPnl / newTotalTrades : 0;
      const newDrawdown   = Math.max(stats.max_drawdown_percent, result.maxDrawdownPercent);

      this.db.prepare(`
        UPDATE agent_statistics SET
          total_competitions  = ?,
          total_wins          = ?,
          total_losses        = ?,
          win_rate_percent    = ?,
          total_pnl           = ?,
          max_drawdown_percent = ?,
          sharpe_ratio        = ?,
          roi_percent         = ?,
          trades_executed     = ?,
          avg_trade_profit    = ?,
          last_updated        = ?
        WHERE agent_id = ?
      `).run(
        newComps, newWins, newLosses, newWinRate,
        newTotalPnl, newDrawdown, result.sharpeRatio, roi,
        newTotalTrades, newAvgProfit, now,
        agentId,
      );

      this.db.prepare(`
        INSERT INTO agent_competitions
          (id, agent_id, competition_id, rank_position,
           starting_capital, ending_capital, pnl,
           trades_count, win_trades, loss_trades,
           largest_win, largest_loss, sharpe_ratio, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), agentId, result.competitionId, result.rank,
        result.startingCapital, result.endingCapital, pnl,
        result.tradesExecuted, result.winTrades, result.lossTrades,
        result.largestWin, result.largestLoss, result.sharpeRatio, now,
      );
    });

    updateTx();
  }

  async getAgentCompetitions(agentId: string, limit = 20): Promise<AgentCompetitionRecord[]> {
    return this.db.prepare(`
      SELECT * FROM agent_competitions WHERE agent_id = ?
      ORDER BY completed_at DESC LIMIT ?
    `).all(agentId, limit) as AgentCompetitionRecord[];
  }

  // ── Genealogy ──────────────────────────────────────────────────────────────

  async saveGenealogyRecord(record: GenealogyRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO agent_genealogy
        (id, agent_id, parent_1_id, parent_2_id,
         breeding_date, breeding_generation,
         inherited_genes, mutations_applied,
         mutation_severity, offspring_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id ?? randomUUID(),
      record.agent_id,
      record.parent_1_id ?? null,
      record.parent_2_id ?? null,
      record.breeding_date,
      record.breeding_generation,
      JSON.stringify(record.inherited_genes),
      JSON.stringify(record.mutations_applied),
      record.mutation_severity,
      record.offspring_count,
    );
  }

  async getGenealogyForAgent(agentId: string): Promise<GenealogyRecord[]> {
    const rows = this.db.prepare(`
      SELECT * FROM agent_genealogy WHERE agent_id = ? ORDER BY breeding_date DESC
    `).all(agentId) as Array<Record<string, unknown>>;

    return rows.map(r => ({
      ...r,
      inherited_genes:   JSON.parse(r['inherited_genes'] as string),
      mutations_applied: JSON.parse(r['mutations_applied'] as string),
    })) as GenealogyRecord[];
  }

  // ── Genome ─────────────────────────────────────────────────────────────────

  async saveGenome(agentId: string, genome: AgentGenome): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_genomes (agent_id, genome, updated_at)
      VALUES (?, ?, ?)
    `).run(agentId, JSON.stringify(genome), new Date().toISOString());
  }

  async loadGenome(agentId: string): Promise<AgentGenome | null> {
    const row = this.db.prepare(
      'SELECT genome FROM agent_genomes WHERE agent_id = ?',
    ).get(agentId) as { genome: string } | undefined;
    return row ? (JSON.parse(row.genome) as AgentGenome) : null;
  }

  async deleteGenome(agentId: string): Promise<void> {
    this.db.prepare('DELETE FROM agent_genomes WHERE agent_id = ?').run(agentId);
  }

  // ── Learning states ────────────────────────────────────────────────────────

  async saveLearningState(cacheKey: string, snapshot: unknown): Promise<void> {
    this.db.prepare(`
      INSERT INTO agent_learning_states (cache_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload    = excluded.payload,
        updated_at = excluded.updated_at
    `).run(cacheKey, JSON.stringify(snapshot), new Date().toISOString());
  }

  async loadLearningState(cacheKey: string): Promise<unknown> {
    const row = this.db.prepare(
      'SELECT payload FROM agent_learning_states WHERE cache_key = ?',
    ).get(cacheKey) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }

  async getAllLearningStates(): Promise<Map<string, unknown>> {
    const rows = this.db.prepare(
      'SELECT cache_key, payload FROM agent_learning_states',
    ).all() as Array<{ cache_key: string; payload: string }>;

    const map = new Map<string, unknown>();
    for (const row of rows) {
      map.set(row.cache_key, JSON.parse(row.payload));
    }
    return map;
  }

  async deleteLearningState(cacheKey: string): Promise<void> {
    this.db.prepare('DELETE FROM agent_learning_states WHERE cache_key = ?').run(cacheKey);
  }
}
