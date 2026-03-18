import Database from 'better-sqlite3';

export interface AgentCosmetics {
  custom_name: string | null;
  emoji: string | null;
  color: string | null;
  biography: string | null;
  nickname: string | null;
}

const EMOJI_PALETTE = ['🟢', '🔴', '🟡', '💎', '🔥', '⚡', '🌟', '🎯', '🚀', '🏆'];
const COLOR_PALETTE = ['#00FF00', '#FF0000', '#FFFF00', '#00FFFF', '#FF00FF', '#FFA500', '#800080', '#0099FF'];

export class AgentCosmeticsManager {
  private readonly db: Database.Database;

  constructor(database: Database.Database) {
    this.db = database;
  }

  generateRandomEmoji(): string {
    return EMOJI_PALETTE[Math.floor(Math.random() * EMOJI_PALETTE.length)]!;
  }

  generateRandomColor(): string {
    return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]!;
  }

  generateDefaultName(agentId: string): string {
    return `Agent_${agentId.substring(0, 8).toUpperCase()}`;
  }

  setCustomName(agentId: string, name: string): void {
    if (!name || name.length === 0) throw new Error('Name cannot be empty');
    if (name.length > 255) throw new Error('Name too long (max 255 chars)');
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) throw new Error('Invalid characters in name');

    this.db.prepare('UPDATE agent_registry SET custom_name = ? WHERE id = ?').run(name, agentId);
  }

  setEmoji(agentId: string, emoji: string): void {
    if (!EMOJI_PALETTE.includes(emoji)) {
      throw new Error(`Invalid emoji. Choose from: ${EMOJI_PALETTE.join(' ')}`);
    }
    this.db.prepare('UPDATE agent_registry SET emoji = ? WHERE id = ?').run(emoji, agentId);
  }

  setColor(agentId: string, hexColor: string): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hexColor)) {
      throw new Error('Invalid hex color format (use #RRGGBB)');
    }
    this.db.prepare('UPDATE agent_registry SET color = ? WHERE id = ?').run(hexColor, agentId);
  }

  setBiography(agentId: string, biography: string): void {
    if (biography.length > 1000) throw new Error('Biography too long (max 1000 chars)');
    this.db.prepare('UPDATE agent_registry SET biography = ? WHERE id = ?').run(biography, agentId);
  }

  setNickname(agentId: string, nickname: string): void {
    this.db.prepare('UPDATE agent_registry SET nickname = ? WHERE id = ?').run(nickname, agentId);
  }

  getCosmetics(agentId: string): AgentCosmetics {
    const row = this.db
      .prepare('SELECT custom_name, emoji, color, biography, nickname FROM agent_registry WHERE id = ?')
      .get(agentId) as AgentCosmetics | undefined;

    if (!row) throw new Error(`Agent not found: ${agentId}`);
    return row;
  }

  getDisplayName(agentId: string): string {
    const { emoji, custom_name } = this.getCosmetics(agentId);
    const parts = [emoji, custom_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : agentId;
  }

  initializeNewAgent(agentId: string, agentType: string): void {
    const emoji = this.generateRandomEmoji();
    const color = this.generateRandomColor();
    const name  = this.generateDefaultName(agentId);
    const bio   = `Created on ${new Date().toLocaleDateString()}. Type: ${agentType || 'generic'}. Ready to compete.`;

    this.db.prepare(`
      UPDATE agent_registry
      SET emoji = ?, color = ?, custom_name = ?, biography = ?
      WHERE id = ?
    `).run(emoji, color, name, bio, agentId);
  }

  /** Palette accessors (for API responses) */
  static get emojiPalette(): string[] { return [...EMOJI_PALETTE]; }
  static get colorPalette(): string[] { return [...COLOR_PALETTE]; }
}
