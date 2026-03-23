/**
 * Twitter / X Scraper
 *
 * Uses the Twitter API v2 recent-search endpoint.
 * Requires X_BEARER_TOKEN or TWITTER_BEARER_TOKEN env var.
 * Rate budget: ~450k tweets/month → 625/hour; we stay well under 100/call.
 *
 * Implements a simple token-bucket rate limiter (1 request/second max).
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem, SocialSource } from '../../../types/social-media.js';
import { appConfigService } from '../../app-config-service.js';

function getBearerToken(): string {
  return appConfigService.get('X_BEARER_TOKEN') ?? appConfigService.get('TWITTER_BEARER_TOKEN') ?? '';
}
const BASE_URL = 'https://api.twitter.com/2';

// Per-symbol query strategies
const QUERY_TEMPLATES = [
  (symbol: string, _name: string) => `($${symbol} OR #${symbol}) lang:en -is:retweet`,
  (symbol: string, name: string) => `${name} crypto lang:en -is:retweet`,
  (symbol: string, _name: string) => `${symbol} price OR ${symbol} market lang:en -is:retweet`,
];

interface TwitterSearchResponse {
  data?: Array<{
    id: string;
    text?: string;
    author_id?: string;
    created_at?: string;
    public_metrics?: {
      like_count?: number;
      retweet_count?: number;
      reply_count?: number;
      impression_count?: number;
    };
  }>;
  includes?: {
    users?: Array<{
      id: string;
      public_metrics?: { followers_count?: number };
    }>;
  };
}

// Simple 1 req/s rate limiter
let lastCallTs = 0;
async function rateLimit(): Promise<void> {
  const wait = 1050 - (Date.now() - lastCallTs);
  if (wait > 0) await new Promise<void>(r => setTimeout(r, wait));
  lastCallTs = Date.now();
}

export class TwitterScraper {
  readonly source: SocialSource = 'twitter';

  isConfigured(): boolean { return getBearerToken().length > 0; }

  async fetch(symbol: string, coinName: string, maxResults = 25): Promise<SocialMediaItem[]> {
    if (!this.isConfigured()) return [];
    const bearerToken = getBearerToken();

    const allItems: SocialMediaItem[] = [];
    // Use first two query templates per symbol to stay within budget
    const queries = QUERY_TEMPLATES.slice(0, 2).map(t => t(symbol, coinName));

    for (const query of queries) {
      await rateLimit();
      try {
        const q = encodeURIComponent(query);
        const url =
          `${BASE_URL}/tweets/search/recent?query=${q}` +
          `&max_results=${Math.min(maxResults, 100)}` +
          `&tweet.fields=created_at,public_metrics,author_id` +
          `&expansions=author_id&user.fields=public_metrics`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' },
        });

        if (response.status === 429) {
          logger.warn('twitter rate limited', { symbol });
          break;
        }
        if (!response.ok) {
          logger.warn('twitter non-ok', { symbol, status: response.status });
          continue;
        }

        const data = (await response.json()) as TwitterSearchResponse;

        // Build author follower lookup
        const userMap = new Map<string, number>();
        for (const user of data?.includes?.users ?? []) {
          userMap.set(user.id, user.public_metrics?.followers_count ?? 0);
        }

        for (const tweet of data?.data ?? []) {
          allItems.push({
            id: randomUUID(),
            source: 'twitter',
            source_id: tweet.id,
            content: tweet.text ?? '',
            author: tweet.author_id,
            author_followers: tweet.author_id ? userMap.get(tweet.author_id) : undefined,
            engagement_likes: tweet.public_metrics?.like_count ?? 0,
            engagement_shares: tweet.public_metrics?.retweet_count ?? 0,
            engagement_comments: tweet.public_metrics?.reply_count ?? 0,
            engagement_views: tweet.public_metrics?.impression_count,
            content_created_at: tweet.created_at ?? new Date().toISOString(),
            fetched_at: new Date().toISOString(),
            url: `https://x.com/i/web/status/${tweet.id}`,
            coins_mentioned: [],
            metadata: { query },
          });
        }
      } catch (err) {
        logger.warn('twitter fetch error', { symbol, error: String(err) });
      }
    }

    return allItems;
  }
}
