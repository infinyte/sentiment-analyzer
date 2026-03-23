import type Database from 'better-sqlite3';
import type { SimulationResult } from '../../../services/backtesting-engine.js';
import type { IBacktestRepository, BacktestSummary } from '../../interfaces/backtest.repository.js';

export class SQLiteBacktestRepository implements IBacktestRepository {
  constructor(private readonly db: Database.Database) {}

  async save(result: SimulationResult): Promise<void> {
    const symbols      = result.config.symbols;
    const agentCount   = result.agentResults.length;
    const topPerformer = result.comparison.topPerformerByReturn;

    this.db.prepare(`
      INSERT INTO backtest_results (test_id, symbols, agent_count, top_performer, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(test_id) DO UPDATE SET
        symbols       = excluded.symbols,
        agent_count   = excluded.agent_count,
        top_performer = excluded.top_performer,
        payload       = excluded.payload
    `).run(
      result.testId,
      JSON.stringify(symbols),
      agentCount,
      topPerformer,
      JSON.stringify(result),
      new Date().toISOString(),
    );
  }

  async findById(testId: string): Promise<SimulationResult | null> {
    const row = this.db.prepare(
      'SELECT payload FROM backtest_results WHERE test_id = ?',
    ).get(testId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as SimulationResult) : null;
  }

  async list(): Promise<BacktestSummary[]> {
    const rows = this.db.prepare(`
      SELECT test_id      AS testId,
             symbols,
             agent_count  AS agentCount,
             top_performer AS topPerformer,
             created_at   AS createdAt
      FROM   backtest_results
      ORDER  BY created_at DESC
    `).all() as Array<BacktestSummary & { symbols: string }>;

    return rows.map(r => ({
      ...r,
      symbols: JSON.parse(r.symbols) as string[],
    }));
  }

  async delete(testId: string): Promise<void> {
    this.db.prepare('DELETE FROM backtest_results WHERE test_id = ?').run(testId);
  }
}
