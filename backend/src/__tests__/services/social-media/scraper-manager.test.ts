import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { SocialMediaItem } from '../../../types/social-media.js';

const queuePushMock = jest.fn<(payload: unknown) => Promise<{ stored: number; botFiltered: number; latencyMs: number }>>();

const twitterFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const redditFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const rssFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const rssFetchAllMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const discordFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const discordFetchAllMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const telegramFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const telegramFetchAllMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const youtubeFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();
const tiktokFetchMock = jest.fn<() => Promise<SocialMediaItem[]>>();

jest.mock('../../../services/social-media/ingest-queue.js', () => ({
  ingestQueue: {
    push: queuePushMock,
  },
}));

jest.mock('../../../services/social-media/scraper/twitter-scraper.js', () => ({
  TwitterScraper: jest.fn().mockImplementation(() => ({ fetch: twitterFetchMock })),
}));

jest.mock('../../../services/social-media/scraper/reddit-scraper.js', () => ({
  RedditScraper: jest.fn().mockImplementation(() => ({ fetch: redditFetchMock })),
}));

jest.mock('../../../services/social-media/scraper/rss-scraper.js', () => ({
  RssScraper: jest.fn().mockImplementation(() => ({ fetch: rssFetchMock, fetchAll: rssFetchAllMock })),
}));

jest.mock('../../../services/social-media/scraper/discord-scraper.js', () => ({
  DiscordScraper: jest.fn().mockImplementation(() => ({ fetch: discordFetchMock, fetchAll: discordFetchAllMock })),
}));

jest.mock('../../../services/social-media/scraper/telegram-scraper.js', () => ({
  TelegramScraper: jest.fn().mockImplementation(() => ({ fetch: telegramFetchMock, fetchAll: telegramFetchAllMock })),
}));

jest.mock('../../../services/social-media/scraper/youtube-scraper.js', () => ({
  YouTubeScraper: jest.fn().mockImplementation(() => ({ fetch: youtubeFetchMock })),
}));

jest.mock('../../../services/social-media/scraper/tiktok-scraper.js', () => ({
  TikTokScraper: jest.fn().mockImplementation(() => ({ fetch: tiktokFetchMock })),
}));

import { SocialMediaScraperManager } from '../../../services/social-media/scraper/scraper-manager.js';

function makeItem(id: string, source: SocialMediaItem['source'], content: string): SocialMediaItem {
  return {
    id,
    source,
    source_id: `${source}-${id}`,
    content,
    title: content,
    engagement_likes: 10,
    engagement_shares: 2,
    engagement_comments: 1,
    content_created_at: '2026-03-18T00:00:00.000Z',
    fetched_at: '2026-03-18T00:05:00.000Z',
    url: `https://example.com/${source}/${id}`,
    coins_mentioned: [],
    metadata: {},
  };
}

describe('SocialMediaScraperManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queuePushMock.mockImplementation(async (payload: unknown) => {
      const items = (payload as { items: SocialMediaItem[] }).items;
      return { stored: items.length, botFiltered: 0, latencyMs: 5 };
    });

    twitterFetchMock.mockResolvedValue([makeItem('tw-1', 'twitter', 'BTC breakout on X')]);
    redditFetchMock.mockResolvedValue([makeItem('rd-1', 'reddit', 'BTC rally on Reddit')]);
    rssFetchMock.mockResolvedValue([]);
    rssFetchAllMock.mockResolvedValue([makeItem('rss-1', 'rss', 'Macro crypto headline')]);
    discordFetchMock.mockResolvedValue([]);
    discordFetchAllMock.mockResolvedValue([makeItem('dc-1', 'discord', 'Discord BTC chatter')]);
    telegramFetchMock.mockResolvedValue([]);
    telegramFetchAllMock.mockResolvedValue([makeItem('tg-1', 'telegram', 'Telegram BTC post')]);
    youtubeFetchMock.mockResolvedValue([]);
    tiktokFetchMock.mockResolvedValue([]);
  });

  it('routes bulk and per-coin scrape results through IngestQueue via scrapeAll', async () => {
    const manager = new SocialMediaScraperManager();

    const result = await manager.scrapeAll(['BTC']);

    expect(queuePushMock).toHaveBeenCalledTimes(4);
    expect(queuePushMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceCounters: [{ source: 'rss', count: 1 }],
      items: expect.arrayContaining([expect.objectContaining({ source: 'rss' })]),
    }));
    expect(queuePushMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceCounters: [{ source: 'discord', count: 1 }],
      items: expect.arrayContaining([expect.objectContaining({ source: 'discord' })]),
    }));
    expect(queuePushMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      sourceCounters: [{ source: 'telegram', count: 1 }],
      items: expect.arrayContaining([expect.objectContaining({ source: 'telegram' })]),
    }));
    expect(queuePushMock).toHaveBeenNthCalledWith(4, expect.objectContaining({
      targetSymbol: 'BTC',
      sourceCounters: expect.arrayContaining([
        { source: 'twitter', count: 1 },
        { source: 'reddit', count: 1 },
      ]),
      items: expect.arrayContaining([
        expect.objectContaining({ source: 'twitter' }),
        expect.objectContaining({ source: 'reddit' }),
      ]),
    }));

    expect(result).toMatchObject({
      rss_items: 1,
      discord_items: 1,
      telegram_items: 1,
      total_items_scraped: 5,
      total_items_stored: 5,
    });
    expect(result.coin_results).toHaveLength(1);
    expect(result.coin_results[0]).toMatchObject({
      symbol: 'BTC',
      items_scraped: 2,
      items_stored: 2,
    });
  });
});