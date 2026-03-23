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
import { appConfigService } from '../../app-config-service.js';

function getBotToken(): string {
  return appConfigService.get('DISCORD_BOT_TOKEN') ?? '';
}

function getChannelIds(): string[] {
  return (appConfigService.get('DISCORD_CHANNEL_IDS') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const API_BASE = 'https://discord.com/api/v10';

interface DiscordReaction {
  count?: number;
}

interface DiscordAuthor {
  id?: string;
  username?: string;
}

interface DiscordMessage {
  id?: string;
  content?: string;
  timestamp?: string;
  guild_id?: string;
  type?: number;
  author?: DiscordAuthor;
  reactions?: DiscordReaction[];
  referenced_message?: unknown;
}

// Reaction-to-engagement: total unique emoji reactions across a message
function countReactions(reactions: DiscordReaction[]): number {
  if (!Array.isArray(reactions)) return 0;
  return reactions.reduce((sum: number, reaction) => sum + (reaction.count ?? 0), 0);
}

// Resolve Discord snowflake → approximate UTC timestamp
function snowflakeToIso(snowflake: string): string {
  const ts = (BigInt(snowflake) >> 22n) + 1420070400000n;
  return new Date(Number(ts)).toISOString();
}

export class DiscordScraper {
  readonly source = 'discord' as const;

  isConfigured(): boolean {
    return getBotToken().length > 0 && getChannelIds().length > 0;
  }

  async fetch(symbol: string, _coinName: string, limit = 50): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];
    const botToken = getBotToken();
    const channelIds = getChannelIds();

    const items: SocialMediaItem[] = [];
    const symLower = symbol.toLowerCase();

    for (const channelId of channelIds) {
      try {
        const response = await fetch(
          `${API_BASE}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
          {
            headers: {
              Authorization: `Bot ${botToken}`,
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

        const messages = (await response.json()) as DiscordMessage[];

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
    const botToken = getBotToken();
    const channelIds = getChannelIds();

    const all: SocialMediaItem[] = [];
    for (const channelId of channelIds) {
      try {
        const response = await fetch(
          `${API_BASE}/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
          { headers: { Authorization: `Bot ${botToken}`, Accept: 'application/json' } }
        );
        if (!response.ok) continue;
        const messages = (await response.json()) as DiscordMessage[];
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
