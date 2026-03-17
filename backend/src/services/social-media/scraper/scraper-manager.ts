/**
 * SocialMediaScraperManager
 *
 * Orchestrates all scrapers (Twitter, Reddit, RSS, Discord, Telegram, YouTube)
 * for a given coin or batch.
 *
 * Handles:
 *   - Per-source error isolation (one bad source doesn't abort others)
 *   - Source metadata tracking via SocialStorageService
 *   - Coin-mention population + scoring before persistence
 */

import logger from '../../../logger.js';
import { TwitterScraper }  from './twitter-scraper.js';
import { RedditScraper }   from './reddit-scraper.js';
import { RssScraper }      from './rss-scraper.js';
import { DiscordScraper }  from './discord-scraper.js';
import { TelegramScraper } from './telegram-scraper.js';
import { YouTubeScraper }  from './youtube-scraper.js';
import { TikTokScraper }   from './tiktok-scraper.js';
import { scoreItems }      from '../scoring/item-scorer.js';
import { extractCoins }    from '../scoring/coin-extractor.js';
import { socialStore }     from '../../../database/sqlite-social-store.js';
import type { SocialMediaItem, SocialSource } from '../../../types/social-media.js';

// ── Coin name map (symbol → display name for search queries) ──────────────────

const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',   ETH: 'Ethereum',  BNB: 'Binance',   XRP: 'Ripple',
  ADA: 'Cardano',   SOL: 'Solana',    DOT: 'Polkadot',  DOGE: 'Dogecoin',
  AVAX: 'Avalanche', SHIB: 'Shiba',   MATIC: 'Polygon', LTC: 'Litecoin',
  UNI: 'Uniswap',  LINK: 'Chainlink', TRX: 'Tron',      ATOM: 'Cosmos',
  XLM: 'Stellar',  NEAR: 'Near',      ALGO: 'Algorand', VET: 'VeChain',
  AAVE: 'Aave',    ARB: 'Arbitrum',   OP: 'Optimism',   APT: 'Aptos',
  SUI: 'Sui',      TON: 'Toncoin',    PEPE: 'Pepe',     WIF: 'Dogwifhat',
};

function coinName(symbol: string): string {
  return COIN_NAMES[symbol.toUpperCase()] ?? symbol;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScrapeRunResult {
  symbol: string;
  items_scraped: number;
  items_stored: number;
  by_source: Record<SocialSource, number>;
  errors: string[];
  duration_ms: number;
}

// ── Manager ────────────────────────────────────────────────────────────────────

export class SocialMediaScraperManager {
  private readonly twitter  = new TwitterScraper();
  private readonly reddit   = new RedditScraper();
  private readonly rss      = new RssScraper();
  private readonly discord  = new DiscordScraper();
  private readonly telegram = new TelegramScraper();
  private readonly youtube  = new YouTubeScraper();
  private readonly tiktok   = new TikTokScraper();

  // ── Per-coin fetch ─────────────────────────────────────────────────────────

  /** Scrape all configured sources for a single coin symbol. */
  async fetchForCoin(symbol: string): Promise<ScrapeRunResult> {
    const start  = Date.now();
    const upper  = symbol.toUpperCase();
    const name   = coinName(upper);
    const errors: string[] = [];
    const bySource = this.emptyBySource();
    const allRaw: SocialMediaItem[] = [];

    await Promise.allSettled([
      this.twitter.fetch(upper, name).then(items => {
        bySource.twitter = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`twitter: ${String(err)}`)),

      this.reddit.fetch(upper, name).then(items => {
        bySource.reddit = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`reddit: ${String(err)}`)),

      this.rss.fetch(upper, name).then(items => {
        bySource.rss = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`rss: ${String(err)}`)),

      this.discord.fetch(upper, name).then(items => {
        bySource.discord = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`discord: ${String(err)}`)),

      this.telegram.fetch(upper, name).then(items => {
        bySource.telegram = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`telegram: ${String(err)}`)),

      this.youtube.fetch(upper, name).then(items => {
        bySource.youtube = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`youtube: ${String(err)}`)),

      this.tiktok.fetch(upper, name).then(items => {
        bySource.tiktok = items.length; allRaw.push(...items);
      }).catch(err => errors.push(`tiktok: ${String(err)}`)),
    ]);

    this.populateCoins(allRaw, upper);

    const scored = scoreItems(allRaw);
    let stored = 0;
    try {
      stored = socialStore.upsertItems(scored);
      for (const [src, count] of Object.entries(bySource) as [SocialSource, number][]) {
        if (count > 0) socialStore.incrementFetchCount(src, count);
      }
    } catch (err) {
      errors.push(`storage: ${String(err)}`);
    }

    const duration = Date.now() - start;
    logger.info('scrape-manager: coin complete', {
      symbol: upper, items: allRaw.length, stored, duration_ms: duration,
    });

    return { symbol: upper, items_scraped: allRaw.length, items_stored: stored, by_source: bySource, errors, duration_ms: duration };
  }

  /** Scrape multiple coins sequentially. */
  async fetchBatch(symbols: string[]): Promise<ScrapeRunResult[]> {
    const results: ScrapeRunResult[] = [];
    for (const sym of symbols) results.push(await this.fetchForCoin(sym));
    return results;
  }

  // ── Bulk background fetches ────────────────────────────────────────────────

  /** Fetch all RSS feeds (unfiltered) and persist. Best for hourly cron. */
  async refreshRssAll(): Promise<number> {
    return this.refreshBulk('rss', () => this.rss.fetchAll());
  }

  /** Fetch all configured Discord channels (unfiltered) and persist. */
  async refreshDiscordAll(): Promise<number> {
    return this.refreshBulk('discord', () => this.discord.fetchAll());
  }

  /** Fetch all Telegram channels (unfiltered) and persist. */
  async refreshTelegramAll(): Promise<number> {
    return this.refreshBulk('telegram', () => this.telegram.fetchAll());
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async refreshBulk(source: SocialSource, fetcher: () => Promise<SocialMediaItem[]>): Promise<number> {
    try {
      const items = await fetcher();
      this.populateCoins(items);
      const scored = scoreItems(items);
      socialStore.upsertItems(scored);
      if (items.length) socialStore.incrementFetchCount(source, items.length);
      logger.info(`scrape-manager: ${source} bulk refresh`, { count: items.length });
      return items.length;
    } catch (err) {
      logger.warn(`scrape-manager: ${source} bulk error`, { error: String(err) });
      return 0;
    }
  }

  private populateCoins(items: SocialMediaItem[], targetSymbol?: string): void {
    for (const item of items) {
      if (item.coins_mentioned.length === 0) {
        const fullText = [item.title, item.content].filter(Boolean).join(' ');
        item.coins_mentioned = extractCoins(fullText);
      }
      if (targetSymbol && !item.coins_mentioned.includes(targetSymbol)) {
        item.coins_mentioned.unshift(targetSymbol);
      }
    }
  }

  private emptyBySource(): Record<SocialSource, number> {
    return { twitter: 0, reddit: 0, rss: 0, tiktok: 0, discord: 0, telegram: 0, youtube: 0 };
  }
}
