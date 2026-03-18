CLAUDE CODE: EVOLUTIONARY AGENT SYSTEM - PHASE 1 FOUNDATION
===========================================================

Build the foundation for genetic algorithm-based agent evolution with identity, statistics tracking, and cosmetics customization.

CURRENT STATE:
✅ Agents can learn and compete
✅ SQLite tables exist (but not fully wired)
❌ No persistent agent statistics
❌ No genealogy/breeding logic
❌ No cosmetic customization
❌ No "glue factory" retirement system

PHASE 1 SCOPE: Foundation (Stats + Cosmetics + API)
====================================================

This prompt implements 4 items only (Phase 1):
1. Extend SQLite schema for agent identity
2. Implement agent cosmetics manager
3. Wire agent statistics to competitions
4. Create stats API endpoints

Total effort: ~12 hours
Complexity: Medium (foundation work, non-breaking)

ITEM 1.1: EXTEND SQLITE SCHEMA FOR AGENT IDENTITY
==================================================

Create migration file: backend/src/database/migrations/003-agent-identity.ts

Tasks:
- Add columns to agent_registry table:
  - custom_name (VARCHAR(255), DEFAULT 'Agent_' + generated)
  - emoji (VARCHAR(10), DEFAULT random from palette)
  - color (VARCHAR(7), hex color, DEFAULT '#00FF00')
  - biography (TEXT, DEFAULT empty)
  - personality_traits (JSON, DEFAULT null)
  - nickname (VARCHAR(255), DEFAULT empty, auto-generated)
  - age_iterations (INTEGER, DEFAULT 0)
  - generation_number (INTEGER, DEFAULT 0)
  - parent_id_1 (UUID, FOREIGN KEY, DEFAULT null)
  - parent_id_2 (UUID, FOREIGN KEY, DEFAULT null)

- Run migration safely:
  - Use ALTER TABLE ADD COLUMN
  - All new columns nullable or have defaults
  - No changes to existing columns
  - Verify backward compatibility

Test:
  - Run migration without errors
  - Query existing agents, new columns present
  - Insert new agent, gets random emoji/color

---

ITEM 1.2: IMPLEMENT AGENT COSMETICS MANAGER
============================================

Create file: backend/src/services/evolutionary/agent-cosmetics-manager.ts

```typescript
import { Database } from 'better-sqlite3';

interface AgentCosmetics {
  custom_name: string;
  emoji: string;
  color: string;
  biography: string;
  nickname: string;
}

const EMOJI_PALETTE = ['🟢', '🔴', '🟡', '💎', '🔥', '⚡', '🌟', '🎯', '🚀', '🏆'];
const COLOR_PALETTE = ['#00FF00', '#FF0000', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#800080', '#0099FF'];

export class AgentCosmeticsManager {
  private db: Database;
  
  constructor(database: Database) {
    this.db = database;
  }
  
  generateRandomEmoji(): string {
    return EMOJI_PALETTE[Math.floor(Math.random() * EMOJI_PALETTE.length)];
  }
  
  generateRandomColor(): string {
    return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  }
  
  generateDefaultName(agentId: string): string {
    return `Agent_${agentId.substring(0, 8).toUpperCase()}`;
  }
  
  setCustomName(agentId: string, name: string): void {
    if (!name || name.length === 0) throw new Error('Name cannot be empty');
    if (name.length > 255) throw new Error('Name too long (max 255 chars)');
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) throw new Error('Invalid characters in name');
    
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET custom_name = ? 
      WHERE id = ?
    `);
    stmt.run(name, agentId);
  }
  
  setEmoji(agentId: string, emoji: string): void {
    if (!EMOJI_PALETTE.includes(emoji)) {
      throw new Error(`Invalid emoji. Choose from: ${EMOJI_PALETTE.join(' ')}`);
    }
    
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET emoji = ? 
      WHERE id = ?
    `);
    stmt.run(emoji, agentId);
  }
  
  setColor(agentId: string, hexColor: string): void {
    // Validate hex color format
    if (!/^#[0-9A-F]{6}$/i.test(hexColor)) {
      throw new Error('Invalid hex color format (use #RRGGBB)');
    }
    
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET color = ? 
      WHERE id = ?
    `);
    stmt.run(hexColor, agentId);
  }
  
  setBiography(agentId: string, biography: string): void {
    if (biography.length > 1000) {
      throw new Error('Biography too long (max 1000 chars)');
    }
    
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET biography = ? 
      WHERE id = ?
    `);
    stmt.run(biography, agentId);
  }
  
  setNickname(agentId: string, nickname: string): void {
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET nickname = ? 
      WHERE id = ?
    `);
    stmt.run(nickname, agentId);
  }
  
  getCosmetics(agentId: string): AgentCosmetics {
    const stmt = this.db.prepare(`
      SELECT custom_name, emoji, color, biography, nickname 
      FROM agent_registry 
      WHERE id = ?
    `);
    const row = stmt.get(agentId) as any;
    
    if (!row) throw new Error(`Agent not found: ${agentId}`);
    
    return {
      custom_name: row.custom_name,
      emoji: row.emoji,
      color: row.color,
      biography: row.biography,
      nickname: row.nickname
    };
  }
  
  getDisplayName(agentId: string): string {
    const cosmetics = this.getCosmetics(agentId);
    return `${cosmetics.emoji} ${cosmetics.custom_name}`;
  }
  
  initializeNewAgent(agentId: string, agentType: string): void {
    const emoji = this.generateRandomEmoji();
    const color = this.generateRandomColor();
    const name = this.generateDefaultName(agentId);
    const type = agentType || 'generic';
    
    const stmt = this.db.prepare(`
      UPDATE agent_registry 
      SET emoji = ?, color = ?, custom_name = ?, biography = ?
      WHERE id = ?
    `);
    
    const defaultBio = `Created on ${new Date().toLocaleDateString()}. Type: ${type}. Ready to compete.`;
    stmt.run(emoji, color, name, defaultBio, agentId);
  }
}
```

Test:
- Create cosmetics manager instance
- setCustomName() updates DB
- setEmoji() validates and updates
- getDisplayName() returns "emoji name"
- initializeNewAgent() sets random cosmetics

---

ITEM 1.3: WIRE AGENT STATISTICS TO COMPETITIONS
================================================

Create file: backend/src/services/evolutionary/agent-statistics-manager.ts

```typescript
import { Database } from 'better-sqlite3';

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

export class AgentStatisticsManager {
  private db: Database;
  
  constructor(database: Database) {
    this.db = database;
  }
  
  initializeStats(agentId: string): void {
    const exists = this.db.prepare(`
      SELECT id FROM agent_statistics WHERE agent_id = ?
    `).get(agentId);
    
    if (!exists) {
      const stmt = this.db.prepare(`
        INSERT INTO agent_statistics (
          agent_id, total_competitions, total_wins, total_losses, 
          win_rate_percent, total_pnl, max_drawdown_percent, 
          sharpe_ratio, roi_percent, trades_executed, consistency_score, avg_trade_profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(agentId, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  }
  
  recordCompetitionResult(agentId: string, competitionResult: {
    rank: number;
    starting_capital: number;
    ending_capital: number;
    trades_executed: number;
    win_trades: number;
    loss_trades: number;
    sharpe_ratio: number;
  }): void {
    // Get current stats
    const current = this.getStats(agentId) as any;
    
    const pnl = competitionResult.ending_capital - competitionResult.starting_capital;
    const won = competitionResult.rank === 1 ? 1 : 0;
    const lost = 1 - won;
    
    // Calculate new totals
    const new_competitions = current.total_competitions + 1;
    const new_wins = current.total_wins + won;
    const new_losses = current.total_losses + lost;
    const new_total_pnl = current.total_pnl + pnl;
    const new_trades = current.trades_executed + competitionResult.trades_executed;
    const new_win_rate = (new_wins / new_competitions) * 100;
    const new_roi = (new_total_pnl / competitionResult.starting_capital) * 100;
    
    // Calculate average Sharpe
    const new_sharpe = (current.sharpe_ratio * (new_competitions - 1) + competitionResult.sharpe_ratio) / new_competitions;
    
    // Update stats
    const stmt = this.db.prepare(`
      UPDATE agent_statistics 
      SET total_competitions = ?,
          total_wins = ?,
          total_losses = ?,
          win_rate_percent = ?,
          total_pnl = ?,
          sharpe_ratio = ?,
          roi_percent = ?,
          trades_executed = ?,
          last_updated = CURRENT_TIMESTAMP
      WHERE agent_id = ?
    `);
    
    stmt.run(
      new_competitions,
      new_wins,
      new_losses,
      new_win_rate,
      new_total_pnl,
      new_sharpe,
      new_roi,
      new_trades,
      agentId
    );
  }
  
  getStats(agentId: string): AgentStats {
    const stmt = this.db.prepare(`
      SELECT * FROM agent_statistics WHERE agent_id = ?
    `);
    
    const row = stmt.get(agentId) as any;
    if (!row) throw new Error(`Stats not found for agent: ${agentId}`);
    
    return {
      agent_id: row.agent_id,
      total_competitions: row.total_competitions,
      total_wins: row.total_wins,
      total_losses: row.total_losses,
      win_rate_percent: row.win_rate_percent,
      total_pnl: row.total_pnl,
      max_drawdown_percent: row.max_drawdown_percent,
      sharpe_ratio: row.sharpe_ratio,
      roi_percent: row.roi_percent,
      trades_executed: row.trades_executed,
      consistency_score: row.consistency_score,
      avg_trade_profit: row.avg_trade_profit
    };
  }
  
  getAllStats(): AgentStats[] {
    const stmt = this.db.prepare(`
      SELECT * FROM agent_statistics ORDER BY win_rate_percent DESC
    `);
    
    return stmt.all() as AgentStats[];
  }
  
  getTopAgents(limit: number = 10): AgentStats[] {
    const stmt = this.db.prepare(`
      SELECT s.*, r.custom_name, r.emoji 
      FROM agent_statistics s
      JOIN agent_registry r ON s.agent_id = r.id
      ORDER BY s.win_rate_percent DESC
      LIMIT ?
    `);
    
    return stmt.all(limit) as AgentStats[];
  }
}
```

Integration point - In your existing competition end-event handler:
```typescript
// After competition finishes
const statsManager = new AgentStatisticsManager(db);

for (const agent of competitionResults) {
  statsManager.initializeStats(agent.id); // First time
  statsManager.recordCompetitionResult(agent.id, {
    rank: agent.rank,
    starting_capital: 10000,
    ending_capital: agent.final_capital,
    trades_executed: agent.trade_count,
    win_trades: agent.win_count,
    loss_trades: agent.loss_count,
    sharpe_ratio: agent.sharpe
  });
}
```

Test:
- Initialize stats for new agent
- After competition, stats update
- Win rate = wins / competitions
- Total PnL accumulates

---

ITEM 1.4: CREATE STATS API ENDPOINTS
====================================

Create file: backend/src/routes/agent-stats.ts

```typescript
import { Router } from 'express';
import { Database } from 'better-sqlite3';
import { AgentCosmeticsManager } from '../services/evolutionary/agent-cosmetics-manager';
import { AgentStatisticsManager } from '../services/evolutionary/agent-statistics-manager';

export function createAgentStatsRouter(db: Database): Router {
  const router = Router();
  const cosmeticsManager = new AgentCosmeticsManager(db);
  const statsManager = new AgentStatisticsManager(db);
  
  // GET /api/agents - List all agents with stats
  router.get('/agents', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const stmt = db.prepare(`
        SELECT 
          r.id, r.custom_name, r.emoji, r.color, r.biography,
          r.age_iterations, r.generation_number,
          s.total_competitions, s.total_wins, s.total_losses,
          s.win_rate_percent, s.total_pnl, s.sharpe_ratio, s.roi_percent
        FROM agent_registry r
        LEFT JOIN agent_statistics s ON r.id = s.agent_id
        WHERE r.status = 'ACTIVE'
        ORDER BY COALESCE(s.win_rate_percent, 0) DESC
        LIMIT ? OFFSET ?
      `);
      
      const agents = stmt.all(limit, offset);
      const totalStmt = db.prepare('SELECT COUNT(*) as count FROM agent_registry WHERE status = ?');
      const total = (totalStmt.get('ACTIVE') as any).count;
      
      res.json({
        agents,
        total,
        limit,
        offset
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/agents/:id - Single agent details
  router.get('/agents/:id', (req, res) => {
    try {
      const { id } = req.params;
      
      const agentStmt = db.prepare(`
        SELECT * FROM agent_registry WHERE id = ?
      `);
      const agent = agentStmt.get(id);
      
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      const statsStmt = db.prepare(`
        SELECT * FROM agent_statistics WHERE agent_id = ?
      `);
      const stats = statsStmt.get(id);
      
      res.json({
        ...agent,
        stats: stats || {}
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // PUT /api/agents/:id/customize - Update cosmetics
  router.put('/agents/:id/customize', (req, res) => {
    try {
      const { id } = req.params;
      const { custom_name, emoji, color, biography } = req.body;
      
      if (custom_name) cosmeticsManager.setCustomName(id, custom_name);
      if (emoji) cosmeticsManager.setEmoji(id, emoji);
      if (color) cosmeticsManager.setColor(id, color);
      if (biography) cosmeticsManager.setBiography(id, biography);
      
      const updated = db.prepare(`
        SELECT * FROM agent_registry WHERE id = ?
      `).get(id);
      
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });
  
  // GET /api/agents/stats/leaderboard - Top agents
  router.get('/agents/stats/leaderboard', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      
      const stmt = db.prepare(`
        SELECT 
          r.id, r.custom_name, r.emoji, r.color,
          s.total_competitions, s.total_wins, s.win_rate_percent,
          s.total_pnl, s.sharpe_ratio, s.roi_percent
        FROM agent_statistics s
        JOIN agent_registry r ON s.agent_id = r.id
        WHERE r.status = 'ACTIVE'
        ORDER BY s.win_rate_percent DESC
        LIMIT ?
      `);
      
      const leaderboard = stmt.all(limit);
      res.json(leaderboard);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/agents/:id/history - Competition history
  router.get('/agents/:id/history', (req, res) => {
    try {
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      
      const stmt = db.prepare(`
        SELECT 
          competition_id, rank_position, starting_capital, ending_capital,
          pnl, trades_count, win_trades, loss_trades,
          largest_win, largest_loss, sharpe_ratio, completed_at
        FROM agent_competitions
        WHERE agent_id = ?
        ORDER BY completed_at DESC
        LIMIT ?
      `);
      
      const history = stmt.all(id, limit);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}
```

Add to backend/src/index.ts:
```typescript
import { createAgentStatsRouter } from './routes/agent-stats';

// Register routes (after other route registrations)
app.use('/api', createAgentStatsRouter(db));
```

Test endpoints:
```bash
# List all agents
curl http://localhost:3000/api/agents

# Get single agent
curl http://localhost:3000/api/agents/{agentId}

# Update agent cosmetics
curl -X PUT http://localhost:3000/api/agents/{agentId}/customize \
  -H "Content-Type: application/json" \
  -d '{"custom_name":"Bull Warrior","emoji":"🟢","color":"#00FF00"}'

# Get leaderboard
curl http://localhost:3000/api/agents/stats/leaderboard

# Get competition history
curl http://localhost:3000/api/agents/{agentId}/history
```

---

WHAT THIS GIVES YOU
===================

After implementing Phase 1:

✅ Agents have names, emojis, colors, biographies
✅ Statistics persist across competitions
✅ Win rate calculated automatically
✅ Leaderboard shows top agents
✅ History tracks per-agent performance
✅ APIs ready for UI integration
✅ Foundation for Phase 2 (genealogy)

NO breaking changes to existing code!

---

PHASE 1 ACCEPTANCE CRITERIA
===========================

✅ Migration runs without errors
✅ Existing agents not affected
✅ New agents get random emoji/color
✅ After each competition, stats update
✅ Win rate = wins / competitions * 100
✅ Total PnL accumulates correctly
✅ All API endpoints return 200
✅ Leaderboard sorted by win_rate DESC
✅ Can customize agent name/emoji/color/bio
✅ Test: Run 3 competitions, verify stats accumulate

---

NEXT STEPS AFTER PHASE 1
=========================

When Phase 1 complete, move to Phase 2:
- Item 2.1: Genealogy schema
- Item 2.2: Agent genome representation
- Item 2.3: Genetic crossover (breeding)
- Item 2.4: Mutation engine

For now: Focus on getting Phase 1 items working!

