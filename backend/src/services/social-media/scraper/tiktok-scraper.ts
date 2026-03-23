/**
 * TikTok Scraper (via RapidAPI)
 *
 * Uses the TikTok Scraper 7 API on RapidAPI — the most commonly available
 * free-tier TikTok search wrapper.
 *
 * Required env vars:
 *   RAPIDAPI_KEY              — RapidAPI subscription key
 *   RAPIDAPI_TIKTOK_HOST      — optional override (default: tiktok-scraper7.p.rapidapi.com)
 *
 * Quota: free tier typically allows ~100–500 req/month; we use 1 req/coin.
 *
 * Endpoint used:
 *   GET /feed/search?keywords={query}&count=20&region=US&publish_time=1&sort_type=0
 *
 * Engagement mapping:
 *   digg_count   → engagement_likes
 *   share_count  → engagement_shares
 *   comment_count → engagement_comments
 *   play_count   → engagement_views
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';
import { appConfigService } from '../../app-config-service.js';

function getRapidApiKey(): string {
  return appConfigService.get('RAPIDAPI_KEY') ?? '';
}

function getRapidApiHost(): string {
  return appConfigService.get('RAPIDAPI_TIKTOK_HOST') ?? 'tiktok-scraper7.p.rapidapi.com';
}

function getBaseUrl(): string {
  return `https://${getRapidApiHost()}`;
}

interface TikTokAuthor {
  unique_id?: string;
  nickname?: string;
  username?: string;
  follower_count?: number;
  fans?: number;
}

interface TikTokStats {
  digg_count?: string | number;
  likeCount?: string | number;
  share_count?: string | number;
  shareCount?: string | number;
  comment_count?: string | number;
  commentCount?: string | number;
  play_count?: string | number;
  playCount?: string | number;
}

interface TikTokHashtag {
  name?: string;
}

interface TikTokMusic {
  title?: string;
}

interface TikTokVideo {
  video_id?: string | number;
  id?: string | number;
  aweme_id?: string | number;
  stats?: TikTokStats;
  statistics?: TikTokStats;
  author?: TikTokAuthor;
  authorMeta?: TikTokAuthor;
  text?: string;
  desc?: string;
  title?: string;
  create_time?: string | number;
  createTime?: string | number;
  created_at?: string;
  music?: TikTokMusic;
  hashtags?: Array<TikTokHashtag | string>;
}

interface TikTokSearchResponse {
  data?: {
    videos?: TikTokVideo[];
  } | TikTokVideo[];
  videos?: TikTokVideo[];
}

function toMetric(value: string | number | undefined): number {
  return Number(value ?? 0) || 0;
}

export class TikTokScraper {
  readonly source = 'tiktok' as const;

  isConfigured(): boolean { return getRapidApiKey().length > 0; }

  async fetch(symbol: string, coinName: string, count = 20): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];
    const rapidApiKey = getRapidApiKey();
    const rapidApiHost = getRapidApiHost();

    const query = encodeURIComponent(`${coinName} ${symbol} crypto`);
    const url = `${getBaseUrl()}/feed/search?keywords=${query}&count=${count}&region=US&publish_time=1&sort_type=0`;

    try {
      const response = await fetch(url, {
        headers: {
          'x-rapidapi-key':  rapidApiKey,
          'x-rapidapi-host': rapidApiHost,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12_000),
      });

      if (response.status === 429) {
        logger.warn('tiktok rate limited', { symbol });
        return [];
      }
      if (response.status === 403) {
        logger.warn('tiktok forbidden — check RAPIDAPI_KEY', { symbol });
        return [];
      }
      if (!response.ok) {
        logger.warn('tiktok non-ok', { symbol, status: response.status });
        return [];
      }

      const data = (await response.json()) as TikTokSearchResponse;
      return this.parse(data);
    } catch (err) {
      logger.warn('tiktok fetch error', { symbol, error: String(err) });
      return [];
    }
  }

  private parse(data: TikTokSearchResponse): SocialMediaItem[] {
    // tiktok-scraper7 returns { data: { videos: [...] } }
    // Some versions return { videos: [...] } directly
    const nestedData = Array.isArray(data.data) ? undefined : data.data;
    const videos: TikTokVideo[] =
      nestedData?.videos ??
      data?.videos ??
      (Array.isArray(data.data) ? data.data : []) ??
      [];

    if (!Array.isArray(videos)) return [];

    return videos
      .filter(v => v && (v.video_id ?? v.id ?? v.aweme_id))
      .map((v): SocialMediaItem => {
        const id    = v.video_id ?? v.id ?? v.aweme_id ?? randomUUID();
        const stats = v.stats ?? v.statistics ?? {};
        const author = v.author ?? v.authorMeta ?? {};
        const text   = (v.text ?? v.desc ?? v.title ?? '').trim();
        const createdAt = v.create_time ?? v.createTime ?? v.created_at;

        return {
          id: randomUUID(),
          source: 'tiktok',
          source_id: String(id),
          content: text.slice(0, 2000),
          author: author.unique_id ?? author.nickname ?? author.username,
          author_followers: author.follower_count ?? author.fans,
          engagement_likes:    toMetric(stats.digg_count ?? stats.likeCount),
          engagement_shares:   toMetric(stats.share_count ?? stats.shareCount),
          engagement_comments: toMetric(stats.comment_count ?? stats.commentCount),
          engagement_views:    toMetric(stats.play_count ?? stats.playCount),
          content_created_at: createdAt
            ? new Date(typeof createdAt === 'number' ? createdAt * 1000 : createdAt).toISOString()
            : new Date().toISOString(),
          fetched_at: new Date().toISOString(),
          url: `https://www.tiktok.com/@${author.unique_id ?? 'user'}/video/${id}`,
          coins_mentioned: [],
          metadata: {
            music_title: v.music?.title,
            hashtags: Array.isArray(v.hashtags)
              ? v.hashtags.map((hashtag) => typeof hashtag === 'string' ? hashtag : (hashtag.name ?? '')).filter(Boolean).slice(0, 10)
              : [],
          },
        };
      });
  }
}
