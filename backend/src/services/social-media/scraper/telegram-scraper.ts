/**
 * Telegram Scraper
 *
 * Two operating modes — whichever credentials are available:
 *
 * MODE A — Public channel HTML scraping (no auth needed)
 *   Reads t.me/s/{channel} — Telegram's public web view.
 *   Parses message text, view counts, and publication timestamps.
 *   Works for any public channel without a bot token.
 *
 * MODE B — Telegram Bot API (optional, richer metadata)
 *   Requires TELEGRAM_BOT_TOKEN + the bot being a member/admin of each channel.
 *   Uses getUpdates / forwardMessage to pull recent channel posts.
 *   Set TELEGRAM_CHANNEL_USERNAMES=cryptonews,bitcoinnews,...
 *
 * Default public crypto channels (MODE A):
 *   cryptonewscom, bitcoinmagazine, coindesk, cointelegraph, wublockchain
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHANNEL_USERNAMES = (process.env.TELEGRAM_CHANNEL_USERNAMES ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Default public channels to scrape in MODE A when no explicit list is given
const DEFAULT_PUBLIC_CHANNELS = [
  'cryptonewscom',
  'cointelegraph',
  'bitcoinnewscom',
  'theblockresearch',
  'coindeskmarkets',
];

const BOT_API = 'https://api.telegram.org';

interface TelegramBotChat {
  id: number;
  username?: string;
  title?: string;
}

interface TelegramBotUser {
  username?: string;
  first_name?: string;
}

interface TelegramBotMessage {
  message_id: number;
  text?: string;
  views?: number;
  date: number;
  from?: TelegramBotUser;
  chat: TelegramBotChat;
}

interface TelegramBotUpdate {
  message?: TelegramBotMessage;
  channel_post?: TelegramBotMessage;
}

interface TelegramBotApiResponse {
  result?: TelegramBotUpdate[];
}

// ── HTML parser for t.me/s/{channel} ─────────────────────────────────────────

interface TgPublicMessage {
  id: string;
  text: string;
  views: number;
  publishedAt: string;
  url: string;
  channel: string;
}

/** Parse the public Telegram channel HTML page. */
function parsePublicChannelHtml(html: string, channelName: string): TgPublicMessage[] {
  const messages: TgPublicMessage[] = [];

  // Split on message containers
  const blocks = html.split('tgme_widget_message_wrap');
  for (const block of blocks.slice(1)) {
    // Message ID from data-post attribute
    const idMatch = /data-post="[^/]+\/(\d+)"/.exec(block);
    const msgId = idMatch?.[1];
    if (!msgId) continue;

    // Message text
    const textMatch = /<div[^>]+class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const rawText = textMatch?.[1] ?? '';
    const text = rawText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!text) continue;

    // View count
    const viewsMatch = /class="tgme_widget_message_views"[^>]*>([\d,.KM]+)<\/span>/.exec(block);
    let views = 0;
    if (viewsMatch) {
      const raw = viewsMatch[1].replace(/,/g, '');
      if (raw.endsWith('K')) views = parseFloat(raw) * 1_000;
      else if (raw.endsWith('M')) views = parseFloat(raw) * 1_000_000;
      else views = parseInt(raw) || 0;
    }

    // Published time
    const timeMatch = /datetime="([^"]+)"/.exec(block);
    const publishedAt = timeMatch ? new Date(timeMatch[1]).toISOString() : new Date().toISOString();

    messages.push({
      id: msgId,
      text,
      views,
      publishedAt,
      url: `https://t.me/${channelName}/${msgId}`,
      channel: channelName,
    });
  }

  return messages;
}

function tgMessageToItem(msg: TgPublicMessage): SocialMediaItem {
  return {
    id: randomUUID(),
    source: 'telegram',
    source_id: `${msg.channel}-${msg.id}`,
    content: msg.text.slice(0, 2000),
    engagement_likes:    0,
    engagement_shares:   0,
    engagement_comments: 0,
    engagement_views:    msg.views,
    content_created_at: msg.publishedAt,
    fetched_at: new Date().toISOString(),
    url: msg.url,
    coins_mentioned: [],
    metadata: { channel: msg.channel },
  };
}

// ── Scraper ────────────────────────────────────────────────────────────────────

export class TelegramScraper {
  readonly source = 'telegram' as const;
  private readonly channels: string[];

  constructor() {
    this.channels = CHANNEL_USERNAMES.length ? CHANNEL_USERNAMES : DEFAULT_PUBLIC_CHANNELS;
  }

  isConfigured(): boolean { return true; } // MODE A requires no config

  /** Fetch recent posts from all monitored channels, filtered to symbol mentions. */
  async fetch(symbol: string, _coinName: string): Promise<SocialMediaItem[]> {
    const all = await this.fetchAll();
    const symLower = symbol.toLowerCase();
    return all.filter(item =>
      item.content.toLowerCase().includes(symLower) ||
      item.content.toUpperCase().includes(symbol)
    );
  }

  /** Fetch all recent posts across monitored channels (no symbol filter). */
  async fetchAll(): Promise<SocialMediaItem[]> {
    if (BOT_TOKEN) {
      return this.fetchViaBotApi();
    }
    return this.fetchViaPublicWeb();
  }

  // ── MODE A: Public HTML scraping ───────────────────────────────────────────

  private async fetchViaPublicWeb(): Promise<SocialMediaItem[]> {
    const results = await Promise.allSettled(
      this.channels.map(ch => this.fetchPublicChannel(ch))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<SocialMediaItem[]> => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  private async fetchPublicChannel(channelName: string): Promise<SocialMediaItem[]> {
    try {
      const response = await fetch(`https://t.me/s/${channelName}`, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; sentiment-analyzer/1.0)',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.warn('telegram public-web non-ok', { channel: channelName, status: response.status });
        return [];
      }

      const html = await response.text();
      const messages = parsePublicChannelHtml(html, channelName);
      return messages.map(tgMessageToItem);
    } catch (err) {
      logger.warn('telegram public-web error', { channel: channelName, error: String(err) });
      return [];
    }
  }

  // ── MODE B: Bot API (requires token + bot membership) ─────────────────────

  private async fetchViaBotApi(): Promise<SocialMediaItem[]> {
    const items: SocialMediaItem[] = [];
    try {
      // getUpdates pulls messages sent/forwarded to the bot
      const response = await fetch(
        `${BOT_API}/bot${BOT_TOKEN}/getUpdates?limit=100&timeout=0`,
        { headers: { Accept: 'application/json' } }
      );
      if (!response.ok) {
        logger.warn('telegram bot-api non-ok', { status: response.status });
        return items;
      }

      const data = (await response.json()) as TelegramBotApiResponse;
      const updates = data?.result ?? [];

      for (const update of updates) {
        const msg = update.message ?? update.channel_post;
        if (!msg?.text) continue;

        const chatName =
          msg.chat?.username ?? msg.chat?.title ?? String(msg.chat?.id ?? '');

        items.push({
          id: randomUUID(),
          source: 'telegram',
          source_id: `${msg.chat.id}-${msg.message_id}`,
          content: msg.text.slice(0, 2000),
          author: msg.from?.username ?? msg.from?.first_name,
          engagement_likes:    0,
          engagement_shares:   0,
          engagement_comments: 0,
          engagement_views:    msg.views,
          content_created_at: new Date(msg.date * 1000).toISOString(),
          fetched_at: new Date().toISOString(),
          url: msg.chat?.username
            ? `https://t.me/${msg.chat.username}/${msg.message_id}`
            : '',
          coins_mentioned: [],
          metadata: { chat: chatName, chat_id: msg.chat.id },
        });
      }
    } catch (err) {
      logger.warn('telegram bot-api error', { error: String(err) });
    }
    return items;
  }
}
