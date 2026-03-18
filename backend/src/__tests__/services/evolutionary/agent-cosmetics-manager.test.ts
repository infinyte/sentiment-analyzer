/**
 * AgentCosmeticsManager unit tests
 *
 * Uses an in-memory SQLite database with the minimal schema required
 * (agent_registry table only).
 */

import Database from 'better-sqlite3';
import { AgentCosmeticsManager } from '../../../services/evolutionary/agent-cosmetics-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agent_registry (
      id                TEXT PRIMARY KEY,
      agent_type        TEXT NOT NULL DEFAULT 'ML_BASED',
      risk_profile      TEXT NOT NULL DEFAULT 'CONSERVATIVE',
      status            TEXT NOT NULL DEFAULT 'ACTIVE',
      custom_name       TEXT,
      emoji             TEXT,
      color             TEXT,
      biography         TEXT,
      personality_traits TEXT,
      nickname          TEXT,
      age_iterations    INTEGER NOT NULL DEFAULT 0,
      generation_number INTEGER NOT NULL DEFAULT 0,
      parent_id_1       TEXT,
      parent_id_2       TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

function insertAgent(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO agent_registry (id) VALUES (?)').run(id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentCosmeticsManager', () => {
  let db: Database.Database;
  let mgr: AgentCosmeticsManager;
  const agentId = 'test-agent-001';

  beforeEach(() => {
    db  = makeDb();
    mgr = new AgentCosmeticsManager(db);
    insertAgent(db, agentId);
  });

  afterEach(() => {
    db.close();
  });

  // ── Generators ──────────────────────────────────────────────────────────────

  it('generateRandomEmoji returns a string from the palette', () => {
    const emoji = mgr.generateRandomEmoji();
    expect(typeof emoji).toBe('string');
    expect(emoji.length).toBeGreaterThan(0);
    expect(AgentCosmeticsManager.emojiPalette).toContain(emoji);
  });

  it('generateRandomColor returns a valid hex color', () => {
    const color = mgr.generateRandomColor();
    expect(/^#[0-9A-Fa-f]{6}$/.test(color)).toBe(true);
    expect(AgentCosmeticsManager.colorPalette).toContain(color);
  });

  it('generateDefaultName uses first 8 chars of agentId uppercased', () => {
    const name = mgr.generateDefaultName('abcdef12-xxxx');
    expect(name).toBe('Agent_ABCDEF12');
  });

  // ── setCustomName ────────────────────────────────────────────────────────────

  it('setCustomName updates the DB', () => {
    mgr.setCustomName(agentId, 'Bull Warrior');
    const row = db.prepare('SELECT custom_name FROM agent_registry WHERE id = ?').get(agentId) as { custom_name: string };
    expect(row.custom_name).toBe('Bull Warrior');
  });

  it('setCustomName throws on empty string', () => {
    expect(() => mgr.setCustomName(agentId, '')).toThrow('Name cannot be empty');
  });

  it('setCustomName throws when name exceeds 255 chars', () => {
    expect(() => mgr.setCustomName(agentId, 'A'.repeat(256))).toThrow('Name too long');
  });

  it('setCustomName throws on invalid characters', () => {
    expect(() => mgr.setCustomName(agentId, 'Bad<Name>')).toThrow('Invalid characters');
  });

  it('setCustomName allows letters, digits, spaces, hyphens, underscores', () => {
    expect(() => mgr.setCustomName(agentId, 'Bull-Warrior_99')).not.toThrow();
  });

  // ── setEmoji ─────────────────────────────────────────────────────────────────

  it('setEmoji accepts a valid palette emoji', () => {
    const validEmoji = AgentCosmeticsManager.emojiPalette[0]!;
    mgr.setEmoji(agentId, validEmoji);
    const row = db.prepare('SELECT emoji FROM agent_registry WHERE id = ?').get(agentId) as { emoji: string };
    expect(row.emoji).toBe(validEmoji);
  });

  it('setEmoji rejects an emoji not in the palette', () => {
    expect(() => mgr.setEmoji(agentId, '🐶')).toThrow('Invalid emoji');
  });

  // ── setColor ─────────────────────────────────────────────────────────────────

  it('setColor accepts a valid hex color', () => {
    mgr.setColor(agentId, '#AABBCC');
    const row = db.prepare('SELECT color FROM agent_registry WHERE id = ?').get(agentId) as { color: string };
    expect(row.color).toBe('#AABBCC');
  });

  it('setColor is case-insensitive', () => {
    expect(() => mgr.setColor(agentId, '#aabbcc')).not.toThrow();
  });

  it('setColor rejects invalid formats', () => {
    expect(() => mgr.setColor(agentId, 'aabbcc')).toThrow('Invalid hex color');
    expect(() => mgr.setColor(agentId, '#GGHHII')).toThrow('Invalid hex color');
    expect(() => mgr.setColor(agentId, '#ABC')).toThrow('Invalid hex color');
  });

  // ── setBiography ─────────────────────────────────────────────────────────────

  it('setBiography updates the DB', () => {
    mgr.setBiography(agentId, 'A legendary trader.');
    const row = db.prepare('SELECT biography FROM agent_registry WHERE id = ?').get(agentId) as { biography: string };
    expect(row.biography).toBe('A legendary trader.');
  });

  it('setBiography throws when biography exceeds 1000 chars', () => {
    expect(() => mgr.setBiography(agentId, 'X'.repeat(1001))).toThrow('Biography too long');
  });

  // ── setNickname ───────────────────────────────────────────────────────────────

  it('setNickname updates the DB', () => {
    mgr.setNickname(agentId, 'The Bull');
    const row = db.prepare('SELECT nickname FROM agent_registry WHERE id = ?').get(agentId) as { nickname: string };
    expect(row.nickname).toBe('The Bull');
  });

  // ── getCosmetics ─────────────────────────────────────────────────────────────

  it('getCosmetics returns all cosmetic fields', () => {
    mgr.setCustomName(agentId, 'Alpha');
    const c = mgr.getCosmetics(agentId);
    expect(c).toHaveProperty('custom_name', 'Alpha');
    expect(c).toHaveProperty('emoji');
    expect(c).toHaveProperty('color');
    expect(c).toHaveProperty('biography');
    expect(c).toHaveProperty('nickname');
  });

  it('getCosmetics throws for unknown agent', () => {
    expect(() => mgr.getCosmetics('nonexistent')).toThrow('Agent not found');
  });

  // ── getDisplayName ────────────────────────────────────────────────────────────

  it('getDisplayName returns "emoji name" when both are set', () => {
    const emoji = AgentCosmeticsManager.emojiPalette[0]!;
    mgr.setEmoji(agentId, emoji);
    mgr.setCustomName(agentId, 'Comet');
    const display = mgr.getDisplayName(agentId);
    expect(display).toBe(`${emoji} Comet`);
  });

  it('getDisplayName falls back to agentId when no cosmetics set', () => {
    const display = mgr.getDisplayName(agentId);
    // emoji and custom_name are null → falls back to agentId
    expect(display).toBe(agentId);
  });

  // ── initializeNewAgent ────────────────────────────────────────────────────────

  it('initializeNewAgent sets emoji, color, custom_name, and biography', () => {
    mgr.initializeNewAgent(agentId, 'ML_BASED');
    const c = mgr.getCosmetics(agentId);
    expect(AgentCosmeticsManager.emojiPalette).toContain(c.emoji);
    expect(c.custom_name).toMatch(/^Agent_/);
    expect(c.biography).toContain('ML_BASED');
  });

  // ── Static palettes ───────────────────────────────────────────────────────────

  it('emojiPalette is non-empty', () => {
    expect(AgentCosmeticsManager.emojiPalette.length).toBeGreaterThan(0);
  });

  it('colorPalette contains only valid hex colors', () => {
    for (const c of AgentCosmeticsManager.colorPalette) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(c)).toBe(true);
    }
  });
});
