import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

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

export class AgentStatisticsManager {
  private readonly db: Database.Database;

  constructor(database: Database.Database) {
    this.db = database;
  }

  /** Ensure a statistics row exists for the given agent. Idempotent. */
  initializeStats(agentId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_statistics (agent_id)
      VALUES (?)
    `).run(agentId);
  }

  /**
   * Record a competition result for an agent and update its cumulative stats.
   * Also inserts a row into agent_competitions for historical tracking.
   */
  recordCompetitionResult(agentId: string, result: CompetitionResultInput): void {
    this.initializeStats(agentId);

    const current = this.getStats(agentId);
    const pnl    = result.endingCapital - result.startingCapital;
    const won    = result.rank === 1 ? 1 : 0;

    const newCompetitions = current.total_competitions + 1;
    const newWins         = current.total_wins + won;
    const newLosses       = current.total_losses + (1 - won);
    const newPnl          = current.total_pnl + pnl;
    const newTrades       = current.trades_executed + result.tradesExecuted;
    const newWinRate      = (newWins / newCompetitions) * 100;
    const newSharpe       = (current.sharpe_ratio * (newCompetitions - 1) + result.sharpeRatio) / newCompetitions;
    const newRoi          = result.startingCapital > 0 ? (newPnl / result.startingCapital) * 100 : 0;
    const newMaxDD        = Math.max(current.max_drawdown_percent, result.maxDrawdownPercent);
    const newAvgTrade     = newTrades > 0 ? newPnl / newTrades : 0;

    this.db.prepare(`
      UPDATE agent_statistics SET
        total_competitions   = ?,
        total_wins           = ?,
        total_losses         = ?,
        win_rate_percent     = ?,
        total_pnl            = ?,
        max_drawdown_percent = ?,
        sharpe_ratio         = ?,
        roi_percent          = ?,
        trades_executed      = ?,
        avg_trade_profit     = ?,
        last_updated         = datetime('now')
      WHERE agent_id = ?
    `).run(
      newCompetitions, newWins, newLosses, newWinRate,
      newPnl, newMaxDD, newSharpe, newRoi, newTrades, newAvgTrade,
      agentId,
    );

    // Insert history row
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_competitions (
        id, agent_id, competition_id, rank_position,
        starting_capital, ending_capital, pnl,
        trades_count, win_trades, loss_trades,
        largest_win, largest_loss, sharpe_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      agentId,
      result.competitionId,
      result.rank,
      result.startingCapital,
      result.endingCapital,
      pnl,
      result.tradesExecuted,
      result.winTrades,
      result.lossTrades,
      result.largestWin,
      result.largestLoss,
      result.sharpeRatio,
    );
  }

  getStats(agentId: string): AgentStats {
    const row = this.db
      .prepare('SELECT * FROM agent_statistics WHERE agent_id = ?')
      .get(agentId) as AgentStats | undefined;

    if (!row) throw new Error(`Stats not found for agent: ${agentId}`);
    return row;
  }

  getAllStats(): AgentStats[] {
    return this.db
      .prepare('SELECT * FROM agent_statistics ORDER BY win_rate_percent DESC')
      .all() as AgentStats[];
  }

  getTopAgents(limit = 10): Array<AgentStats & { custom_name: string | null; emoji: string | null }> {
    return this.db.prepare(`
      SELECT s.*, r.custom_name, r.emoji
      FROM agent_statistics s
      JOIN agent_registry r ON s.agent_id = r.id
      WHERE r.status = 'ACTIVE'
      ORDER BY s.win_rate_percent DESC
      LIMIT ?
    `).all(limit) as Array<AgentStats & { custom_name: string | null; emoji: string | null }>;
  }
}
