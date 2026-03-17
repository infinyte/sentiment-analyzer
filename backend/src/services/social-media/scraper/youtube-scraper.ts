/**
 * YouTube Scraper
 *
 * Uses the YouTube Data API v3 (pure fetch — no google-api-client).
 * Requires: YOUTUBE_API_KEY env var (Google Cloud Console → APIs & Services)
 *
 * Rate budget: 10,000 units/day (free tier)
 *   search.list  = 100 units/call
 *   videos.list  =   1 unit/call
 *   We use:  1 search (100) + 1 videos batch (1) per coin = 101 units/coin
 *   Safe for ~99 coins/day, or ~10 coins per hourly cron cycle.
 *
 * Extracts per video:
 *   title, description (truncated), channel title, publish date,
 *   viewCount, likeCount, commentCount → mapped to engagement fields
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';

const API_KEY  = process.env.YOUTUBE_API_KEY ?? '';
const BASE_URL = 'https://www.googleapis.com/youtube/v3';

// Published-after date: last 7 days
function publishedAfterParam(): string {
  const d = new Date(Date.now() - 7 * 24 * 3_600_000);
  return d.toISOString();
}

interface YtSearchItem { id: { videoId: string }; snippet: any }
interface YtVideoStats { id: string; statistics: any; snippet: any }

export class YouTubeScraper {
  readonly source = 'youtube' as const;

  isConfigured(): boolean { return API_KEY.length > 0; }

  async fetch(symbol: string, coinName: string, maxResults = 10): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];

    try {
      // Step 1: Search for recent videos about the coin
      const videoIds = await this.searchVideos(symbol, coinName, maxResults);
      if (videoIds.length === 0) return [];

      // Step 2: Fetch statistics in one batch call (1 quota unit)
      const details = await this.fetchVideoDetails(videoIds);
      return details.map(v => this.toItem(v));
    } catch (err) {
      logger.warn('youtube fetch error', { symbol, error: String(err) });
      return [];
    }
  }

  private async searchVideos(symbol: string, coinName: string, maxResults: number): Promise<string[]> {
    const query = encodeURIComponent(`${coinName} ${symbol} crypto`);
    const url =
      `${BASE_URL}/search?part=snippet` +
      `&q=${query}` +
      `&type=video` +
      `&order=date` +
      `&publishedAfter=${publishedAfterParam()}` +
      `&maxResults=${Math.min(maxResults, 50)}` +
      `&relevanceLanguage=en` +
      `&key=${API_KEY}`;

    const response = await fetch(url, { headers: { Accept: 'application/json' } });

    if (response.status === 403) {
      logger.warn('youtube quota exceeded or forbidden', { symbol });
      return [];
    }
    if (!response.ok) {
      logger.warn('youtube search non-ok', { symbol, status: response.status });
      return [];
    }

    const data = (await response.json()) as { items?: YtSearchItem[] };
    return (data.items ?? [])
      .map(item => item.id?.videoId)
      .filter(Boolean) as string[];
  }

  private async fetchVideoDetails(videoIds: string[]): Promise<YtVideoStats[]> {
    if (videoIds.length === 0) return [];

    const ids = videoIds.join(',');
    const url =
      `${BASE_URL}/videos?part=snippet,statistics` +
      `&id=${ids}` +
      `&key=${API_KEY}`;

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      logger.warn('youtube videos non-ok', { status: response.status });
      return [];
    }

    const data = (await response.json()) as { items?: YtVideoStats[] };
    return data.items ?? [];
  }

  private toItem(video: YtVideoStats): SocialMediaItem {
    const snippet = video.snippet ?? {};
    const stats   = video.statistics ?? {};

    const description = (snippet.description as string ?? '').slice(0, 500);
    const content = [snippet.title, description].filter(Boolean).join('\n');

    return {
      id: randomUUID(),
      source: 'youtube',
      source_id: video.id,
      content,
      title: snippet.title ?? '',
      author: snippet.channelTitle,
      engagement_likes:    parseInt(stats.likeCount    ?? '0') || 0,
      engagement_shares:   0,
      engagement_comments: parseInt(stats.commentCount ?? '0') || 0,
      engagement_views:    parseInt(stats.viewCount    ?? '0') || 0,
      content_created_at: snippet.publishedAt
        ? new Date(snippet.publishedAt).toISOString()
        : new Date().toISOString(),
      fetched_at: new Date().toISOString(),
      url: `https://www.youtube.com/watch?v=${video.id}`,
      coins_mentioned: [],
      metadata: {
        channel_id: snippet.channelId,
        channel_title: snippet.channelTitle,
        category_id: snippet.categoryId,
        thumbnail: snippet.thumbnails?.medium?.url,
      },
    };
  }
}
