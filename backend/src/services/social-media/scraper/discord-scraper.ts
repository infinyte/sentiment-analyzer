/**
 * Discord Scraper
 *
 * Reads recent messages from configured Discord channels via the
 * Discord REST API v10 (no discord.js — pure fetch).
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN     — Bot token (Discord Developer Portal)
 *   DISCORD_CHANNEL_IDS   — Comma-separated channel IDs to monitor
 *
 * Rate limits: 50 req/s globally; we stay well under that.
 *
 * To add the bot to a server and grant message-read permission:
 *   1. Developer Portal → OAuth2 → bot scope + "Read Message History" permission
 *   2. Invite bot to relevant crypto servers
 *   3. Set DISCORD_CHANNEL_IDS to the channel snowflake IDs
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';

const BOT_TOKEN   = process.env.DISCORD_BOT_TOKEN   ?? '';
const CHANNEL_IDS = (process.env.DISCORD_CHANNEL_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const API_BASE = 'https://discord.com/api/v10';

// Reaction-to-engagement: total unique emoji reactions across a message
function countReactions(reactions: any[]): number {
  if (!Array.isArray(reactions)) return 0;
  return reactions.reduce((sum: number, r: any) => sum + (r.count ?? 0), 0);
}

// Resolve Discord snowflake → approximate UTC timestamp
function snowflakeToIso(snowflake: string): string {
  const ts = (BigInt(snowflake) >> 22n) + 1420070400000n;
  return new Date(Number(ts)).toISOString();
}

export class DiscordScraper {
  readonly source = 'discord' as const;

  isConfigured(): boolean {
    return BOT_TOKEN.length > 0 && CHANNEL_IDS.length > 0;
  }

  async fetch(symbol: string, _coinName: string, limit = 50): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];

    const items: SocialMediaItem[] = [];
    const symLower = symbol.toLowerCase();

    for (const channelId of CHANNEL_IDS) {
      try {
        const response = await fetch(
          `${API_BASE}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
          {
            headers: {
              Authorization: `Bot ${BOT_TOKEN}`,
              Accept: 'application/json',
            },
          }
        );

        if (response.status === 429) {
          const retryAfter = parseFloat(response.headers.get('Retry-After') ?? '5');
          logger.warn('discord rate limited', { channelId, retryAfter });
          await new Promise<void>(r => setTimeout(r, retryAfter * 1000));
          continue;
        }

        if (!response.ok) {
          logger.warn('discord non-ok', { channelId, status: response.status });
          continue;
        }

        const messages = (await response.json()) as any[];

        for (const msg of messages) {
          if (!msg.id || !msg.content) continue;

          const text = (msg.content as string).trim();
          // Filter to messages that mention the coin
          if (!text.toLowerCase().includes(symLower) &&
              !text.toUpperCase().includes(symbol)) continue;

          const publishedAt = msg.timestamp ?? snowflakeToIso(msg.id);

          items.push({
            id: randomUUID(),
            source: 'discord',
            source_id: msg.id,
            content: text.slice(0, 2000),
            author: msg.author?.username ?? msg.author?.id,
            author_followers: undefined,
            engagement_likes:    countReactions(msg.reactions ?? []),
            engagement_shares:   0,
            engagement_comments: msg.referenced_message ? 1 : 0,
            content_created_at: publishedAt,
            fetched_at: new Date().toISOString(),
            url: `https://discord.com/channels/${msg.guild_id ?? '@me'}/${channelId}/${msg.id}`,
            coins_mentioned: [],
            metadata: {
              channel_id: channelId,
              guild_id: msg.guild_id,
              message_type: msg.type,
            },
          });
        }
      } catch (err) {
        logger.warn('discord fetch error', { channelId, symbol, error: String(err) });
      }
    }

    return items;
  }

  /**
   * Fetch all recent messages across all configured channels,
   * regardless of coin mention. Used for bulk background ingestion.
   */
  async fetchAll(limit = 25): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];

    const all: SocialMediaItem[] = [];
    for (const channelId of CHANNEL_IDS) {
      try {
        const response = await fetch(
          `${API_BASE}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
          { headers: { Authorization: `Bot ${BOT_TOKEN}`, Accept: 'application/json' } }
        );
        if (!response.ok) continue;
        const messages = (await response.json()) as any[];
        for (const msg of messages) {
          if (!msg.id || !msg.content?.trim()) continue;
          all.push({
            id: randomUUID(),
            source: 'discord',
            source_id: msg.id,
            content: (msg.content as string).trim().slice(0, 2000),
            author: msg.author?.username ?? msg.author?.id,
            engagement_likes:    countReactions(msg.reactions ?? []),
            engagement_shares:   0,
            engagement_comments: 0,
            content_created_at: msg.timestamp ?? snowflakeToIso(msg.id),
            fetched_at: new Date().toISOString(),
            url: `https://discord.com/channels/${msg.guild_id ?? '@me'}/${channelId}/${msg.id}`,
            coins_mentioned: [],
            metadata: { channel_id: channelId },
          });
        }
      } catch (err) {
        logger.warn('discord fetchAll error', { channelId, error: String(err) });
      }
    }
    return all;
  }
}
