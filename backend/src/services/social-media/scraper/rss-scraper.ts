/**
 * RSS Feed Scraper
 *
 * Fetches multiple crypto news RSS feeds in parallel and parses them
 * using a lightweight hand-rolled XML parser (no new npm deps).
 *
 * Supports standard RSS 2.0 and Atom feeds.
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';

// ── Feed registry ─────────────────────────────────────────────────────────────

export interface FeedConfig {
  url: string;
  name: string;
  authority: 'tier1' | 'tier2' | 'tier3';
}

export const DEFAULT_FEEDS: FeedConfig[] = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',     name: 'CoinDesk',      authority: 'tier1' },
  { url: 'https://cointelegraph.com/rss',                        name: 'CoinTelegraph',  authority: 'tier2' },
  { url: 'https://cryptonews.com/news/feed',                     name: 'CryptoNews',    authority: 'tier2' },
  { url: 'https://decrypt.co/feed',                              name: 'Decrypt',       authority: 'tier2' },
  { url: 'https://thedefiant.io/api/feeds/rss.xml',              name: 'TheDefiant',    authority: 'tier2' },
  { url: 'https://cryptopotato.com/feed/',                       name: 'CryptoPotato',  authority: 'tier3' },
  { url: 'https://ambcrypto.com/feed/',                          name: 'AMBCrypto',     authority: 'tier3' },
  { url: 'https://bitcoinmagazine.com/feed',                     name: 'BitcoinMagazine', authority: 'tier2' },
];

// ── Simple RSS/Atom XML parser ────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // CDATA
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const cdataMatch = cdataRe.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  // Regular
  const tagRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const tagMatch = tagRe.exec(xml);
  if (tagMatch) return tagMatch[1].replace(/<[^>]+>/g, '').trim();

  return '';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

interface ParsedEntry {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  author: string;
}

function parseRssItems(xml: string): ParsedEntry[] {
  // Support both RSS <item> and Atom <entry>
  const itemTag = xml.includes('<item>') ? 'item' : 'entry';
  const blocks = xml.split(new RegExp(`<${itemTag}[\\s>]`)).slice(1);

  return blocks.map(block => {
    const closedAt = block.indexOf(`</${itemTag}>`);
    const chunk = closedAt > 0 ? block.slice(0, closedAt) : block;

    const title = decodeEntities(extractTag(chunk, 'title'));
    const description = decodeEntities(
      extractTag(chunk, 'description') || extractTag(chunk, 'summary') || extractTag(chunk, 'content')
    );
    const link =
      extractTag(chunk, 'link') ||
      (/<link[^>]*href="([^"]+)"/.exec(chunk)?.[1] ?? '');
    const pubDate =
      extractTag(chunk, 'pubDate') ||
      extractTag(chunk, 'published') ||
      extractTag(chunk, 'updated') || '';
    const author =
      extractTag(chunk, 'author') ||
      extractTag(chunk, 'dc:creator') || '';

    return { title, description, link, pubDate, author };
  }).filter(e => e.title.length > 0);
}

// ── RSS Scraper ───────────────────────────────────────────────────────────────

export class RssScraper {
  readonly source = 'rss' as const;
  private readonly feeds: FeedConfig[];

  constructor(feeds: FeedConfig[] = DEFAULT_FEEDS) {
    this.feeds = feeds;
  }

  /** Fetch all feeds and filter by keyword relevance to the given symbol / name. */
  async fetch(symbol: string, coinName: string): Promise<SocialMediaItem[]> {
    const results = await Promise.allSettled(this.feeds.map(f => this.fetchFeed(f)));
    const allItems: SocialMediaItem[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value);
    }

    // Filter to articles that mention the coin
    const symLower  = symbol.toLowerCase();
    const nameLower = coinName.toLowerCase();
    return allItems.filter(item => {
      const text = `${item.title ?? ''} ${item.content}`.toLowerCase();
      return text.includes(symLower) || text.includes(nameLower);
    });
  }

  /** Fetch all feeds unconditionally (for bulk ingestion / background job). */
  async fetchAll(): Promise<SocialMediaItem[]> {
    const results = await Promise.allSettled(this.feeds.map(f => this.fetchFeed(f)));
    const allItems: SocialMediaItem[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value);
    }
    return allItems;
  }

  private async fetchFeed(feed: FeedConfig): Promise<SocialMediaItem[]> {
    try {
      const res = await fetch(feed.url, {
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, text/xml, */*',
          'User-Agent': 'sentiment-analyzer/1.0',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        logger.warn('rss fetch non-ok', { feed: feed.name, status: res.status });
        return [];
      }

      const xml  = await res.text();
      const entries = parseRssItems(xml);

      return entries.map((e): SocialMediaItem => ({
        id: randomUUID(),
        source: 'rss',
        source_id: e.link || `${feed.name}-${Buffer.from(e.title).toString('base64').slice(0, 16)}`,
        content: e.description.slice(0, 1000),
        title: e.title,
        author: e.author || undefined,
        engagement_likes: 0,
        engagement_shares: 0,
        engagement_comments: 0,
        content_created_at: e.pubDate ? new Date(e.pubDate).toISOString() : new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        url: e.link,
        coins_mentioned: [],
        metadata: { feed_name: feed.name, feed_authority: feed.authority },
      }));
    } catch (err) {
      logger.warn('rss fetch error', { feed: feed.name, error: String(err) });
      return [];
    }
  }
}
