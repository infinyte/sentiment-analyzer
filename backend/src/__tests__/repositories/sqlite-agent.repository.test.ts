/**
 * Tests for SQLiteAgentRepository
 */
import Database from 'better-sqlite3';
import { SQLiteAgentRepository } from '../../repositories/adapters/sqlite/sqlite-agent.repository.js';
import { runMigration003 } from '../../database/migrations/003-agent-identity.js';
import type { AgentGenome } from '../../services/evolutionary/agent-genome.js';

describe('SQLiteAgentRepository', () => {
  let db: Database.Database;
  let repo: SQLiteAgentRepository;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigration003(db);
    
    // Manually create agent_genomes table (not in migration)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_genomes (
        agent_id   TEXT PRIMARY KEY REFERENCES agent_registry(id),
        genome     TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    
    repo = new SQLiteAgentRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('findAgentsPaginated', () => {
    beforeAll(async () => {
      // Clear before test (delete in correct order to respect foreign keys)
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('DELETE FROM agent_competitions');
      db.exec('DELETE FROM agent_statistics');
      db.exec('DELETE FROM agent_genomes');
      db.exec('DELETE FROM agent_registry');
      db.exec('PRAGMA foreign_keys = ON');

      const genome: AgentGenome = {
        epsilon: 0.1,
        learningRate: 0.01,
        gamma: 0.99,
        explorationDecayRate: 0.999,
        entryThreshold: 55,
        exitThreshold: 40,
        stopLossPct: 5,
        takeProfitPct: 10,
        positionSizePct: 15,
        riskPercent: 2,
        holdDurationMax: 5,
      };

      // Create 5 active agents with different win rates
      for (let i = 0; i < 5; i++) {
        const agentId = `agent-${i}`;

        await repo.registerAgent({
          agentId,
          agentType: 'ML_BASED',
          riskProfile: i % 2 === 0 ? 'CONSERVATIVE' : 'AGGRESSIVE',
          initialGenome: genome,
        });

        // Initialize stats with different win rates
        await repo.initializeStats(agentId);
        // Manually update to set different win rates
        const winRate = (i + 1) * 20; // 20%, 40%, 60%, 80%, 100%
        db.prepare(
          'UPDATE agent_statistics SET win_rate_percent = ?, total_competitions = 10 WHERE agent_id = ?'
        ).run(winRate, agentId);
      }

      // Create one retired agent
      const retiredId = 'agent-retired';
      await repo.registerAgent({
        agentId: retiredId,
        agentType: 'ML_BASED',
        riskProfile: 'CONSERVATIVE',
        initialGenome: genome,
      });
      await repo.initializeStats(retiredId);
      await repo.updateAgentStatus(retiredId, 'RETIRED');
      db.prepare(
        'UPDATE agent_statistics SET win_rate_percent = 95, total_competitions = 10 WHERE agent_id = ?'
      ).run(retiredId);
    });

    it('should return paginated active agents sorted by win_rate_percent DESC', async () => {
      const result = await repo.findAgentsPaginated('ACTIVE', 10, 0);

      expect(result.agents).toHaveLength(5);
      expect(result.total).toBe(5);
      // Should be sorted by win_rate_percent descending (100, 80, 60, 40, 20)
      expect(result.agents[0].win_rate_percent).toBe(100);
      expect(result.agents[1].win_rate_percent).toBe(80);
      expect(result.agents[2].win_rate_percent).toBe(60);
      expect(result.agents[3].win_rate_percent).toBe(40);
      expect(result.agents[4].win_rate_percent).toBe(20);
    });

    it('should respect LIMIT and OFFSET', async () => {
      // Get first page
      const page1 = await repo.findAgentsPaginated('ACTIVE', 2, 0);
      expect(page1.agents).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.agents[0].win_rate_percent).toBe(100);
      expect(page1.agents[1].win_rate_percent).toBe(80);

      // Get second page
      const page2 = await repo.findAgentsPaginated('ACTIVE', 2, 2);
      expect(page2.agents).toHaveLength(2);
      expect(page2.total).toBe(5);
      expect(page2.agents[0].win_rate_percent).toBe(60);
      expect(page2.agents[1].win_rate_percent).toBe(40);

      // Get last page
      const page3 = await repo.findAgentsPaginated('ACTIVE', 2, 4);
      expect(page3.agents).toHaveLength(1);
      expect(page3.total).toBe(5);
      expect(page3.agents[0].win_rate_percent).toBe(20);
    });

    it('should exclude RETIRED agents', async () => {
      const result = await repo.findAgentsPaginated('ACTIVE', 100, 0);

      // Only 5 ACTIVE agents, not the 6th retired one
      expect(result.agents).toHaveLength(5);
      expect(result.total).toBe(5);
      expect(result.agents.every(a => a.status === 'ACTIVE')).toBe(true);
    });

    it('should include agent fields', async () => {
      const result = await repo.findAgentsPaginated('ACTIVE', 1, 0);

      const agent = result.agents[0];
      // Check that agent fields are present
      expect(agent.id).toBeDefined();
      expect(agent.agent_type).toBe('ML_BASED');
      expect(agent.risk_profile).toBeDefined();
      expect(agent.status).toBe('ACTIVE');

      // Check that stats fields are present
      expect(agent.total_competitions).toBeDefined();
      expect(agent.win_rate_percent).toBeDefined();
    });

    it('should handle empty result when offset is beyond total', async () => {
      const result = await repo.findAgentsPaginated('ACTIVE', 10, 100);
      expect(result.agents).toHaveLength(0);
      expect(result.total).toBe(5);
    });
  });

  describe('findActiveAgentsWithStats', () => {
    let agentIds: string[];

    beforeAll(async () => {
      // Clear before test (delete in correct order to respect foreign keys)
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec('DELETE FROM agent_competitions');
      db.exec('DELETE FROM agent_statistics');
      db.exec('DELETE FROM agent_genomes');
      db.exec('DELETE FROM agent_registry');
      db.exec('PRAGMA foreign_keys = ON');

      agentIds = [];
      const genome: AgentGenome = {
        epsilon: 0.1,
        learningRate: 0.01,
        gamma: 0.99,
        explorationDecayRate: 0.999,
        entryThreshold: 55,
        exitThreshold: 40,
        stopLossPct: 5,
        takeProfitPct: 10,
        positionSizePct: 15,
        riskPercent: 2,
        holdDurationMax: 5,
      };

      // Create 5 active agents with different win rates
      for (let i = 0; i < 5; i++) {
        const agentId = `agent-${i}`;
        agentIds.push(agentId);

        await repo.registerAgent({
          agentId,
          agentType: 'ML_BASED',
          riskProfile: i % 2 === 0 ? 'CONSERVATIVE' : 'AGGRESSIVE',
          initialGenome: genome,
        });

        // Initialize stats with different win rates
        await repo.initializeStats(agentId);
        // Manually update to set different win rates
        const winRate = (i + 1) * 20; // 20%, 40%, 60%, 80%, 100%
        db.prepare(
          'UPDATE agent_statistics SET win_rate_percent = ?, total_competitions = 10 WHERE agent_id = ?'
        ).run(winRate, agentId);
      }

      // Create one retired agent
      const retiredId = 'agent-retired';
      await repo.registerAgent({
        agentId: retiredId,
        agentType: 'ML_BASED',
        riskProfile: 'CONSERVATIVE',
        initialGenome: genome,
      });
      await repo.initializeStats(retiredId);
      await repo.updateAgentStatus(retiredId, 'RETIRED');
      db.prepare(
        'UPDATE agent_statistics SET win_rate_percent = 95, total_competitions = 10 WHERE agent_id = ?'
      ).run(retiredId);
    });

    it('should return paginated active agents sorted by win_rate_percent DESC', async () => {
      const agents = await repo.findActiveAgentsWithStats(10, 0);

      expect(agents).toHaveLength(5);
      // Should be sorted by win_rate_percent descending (100, 80, 60, 40, 20)
      expect(agents[0].win_rate_percent).toBe(100);
      expect(agents[1].win_rate_percent).toBe(80);
      expect(agents[2].win_rate_percent).toBe(60);
      expect(agents[3].win_rate_percent).toBe(40);
      expect(agents[4].win_rate_percent).toBe(20);
    });

    it('should respect LIMIT and OFFSET', async () => {
      // Get first page
      const page1 = await repo.findActiveAgentsWithStats(2, 0);
      expect(page1).toHaveLength(2);
      expect(page1[0].win_rate_percent).toBe(100);
      expect(page1[1].win_rate_percent).toBe(80);

      // Get second page
      const page2 = await repo.findActiveAgentsWithStats(2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0].win_rate_percent).toBe(60);
      expect(page2[1].win_rate_percent).toBe(40);

      // Get last page
      const page3 = await repo.findActiveAgentsWithStats(2, 4);
      expect(page3).toHaveLength(1);
      expect(page3[0].win_rate_percent).toBe(20);
    });

    it('should exclude RETIRED agents', async () => {
      const agents = await repo.findActiveAgentsWithStats(100, 0);

      // Only 5 ACTIVE agents, not the 6th retired one
      expect(agents).toHaveLength(5);
      expect(agents.every(a => a.status === 'ACTIVE')).toBe(true);
    });

    it('should include full agent details', async () => {
      const agents = await repo.findActiveAgentsWithStats(1, 0);

      const agent = agents[0];
      // Check that all agent record fields are present
      expect(agent.id).toBeDefined();
      expect(agent.agent_type).toBe('ML_BASED');
      expect(agent.risk_profile).toBeDefined();
      expect(agent.status).toBe('ACTIVE');
      expect(agent.created_at).toBeDefined();

      // Check that all stats fields are present
      expect(agent.agent_id).toBeDefined();
      expect(agent.total_competitions).toBeDefined();
      expect(agent.win_rate_percent).toBeDefined();
    });

    it('should handle empty result when offset is beyond total', async () => {
      const agents = await repo.findActiveAgentsWithStats(10, 100);
      expect(agents).toHaveLength(0);
    });
  });
});
