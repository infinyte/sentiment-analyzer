/**
 * Reddit Scraper
 *
 * Hits the public Reddit JSON API (no auth needed for read-only search).
 * Optional OAuth via REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET for higher
 * rate limits (60 req/min vs ~10 req/min unauthenticated).
 *
 * Searches across the crypto subreddit bundle + coin-specific subreddits.
 */

import { randomUUID } from 'crypto';
import logger from '../../../logger.js';
import type { SocialMediaItem } from '../../../types/social-media.js';

const CLIENT_ID     = process.env.REDDIT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET ?? '';
const REDDIT_USER   = process.env.REDDIT_USERNAME ?? '';
const REDDIT_PASS   = process.env.REDDIT_PASSWORD ?? '';

const CRYPTO_SUBREDDITS = [
  'CryptoCurrency', 'CryptoMarkets', 'Bitcoin', 'ethereum',
  'altcoin', 'CryptoMoonShots', 'SatoshiStreetBets',
].join('+');

// Per-coin subreddit overrides
const COIN_SUBREDDITS: Record<string, string> = {
  BTC:  'Bitcoin',
  ETH:  'ethereum',
  SOL:  'solana',
  ADA:  'cardano',
  DOGE: 'dogecoin',
  SHIB: 'SHIBArmy',
  MATIC: 'maticnetwork',
  DOT:   'dot',
  AVAX:  'Avax',
};

let oauthToken: string | null = null;
let oauthExpiry = 0;

interface RedditOAuthResponse {
  access_token?: string;
  expires_in?: number;
}

interface RedditPost {
  id?: string;
  title?: string;
  selftext?: string;
  author?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  permalink?: string;
  subreddit?: string;
  upvote_ratio?: number;
}

interface RedditListingResponse {
  data?: {
    children?: Array<{ data?: RedditPost }>;
  };
}

async function getOAuthToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;
  if (oauthToken && Date.now() < oauthExpiry) return oauthToken;

  try {
    const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const body   = new URLSearchParams({ grant_type: 'password', username: REDDIT_USER, password: REDDIT_PASS });
    const res    = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${creds}`,
        'User-Agent': 'sentiment-analyzer/1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RedditOAuthResponse;
    oauthToken  = data.access_token ?? null;
    oauthExpiry = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000;
    return oauthToken;
  } catch {
    return null;
  }
}

function buildHeaders(token: string | null): Record<string, string> {
  const base: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'sentiment-analyzer/1.0',
  };
  if (token) base['Authorization'] = `Bearer ${token}`;
  return base;
}

function baseUrl(token: string | null): string {
  return token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
}

function parsePost(p?: RedditPost): SocialMediaItem | null {
  if (!p?.id) return null;
  return {
    id: randomUUID(),
    source: 'reddit',
    source_id: p.id,
    content: [p.title, p.selftext].filter(Boolean).join('\n').slice(0, 2000),
    title: p.title ?? '',
    author: p.author,
    engagement_likes: p.score ?? 0,
    engagement_shares: 0,
    engagement_comments: p.num_comments ?? 0,
    content_created_at: p.created_utc
      ? new Date(p.created_utc * 1000).toISOString()
      : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    url: p.permalink ? `https://www.reddit.com${p.permalink}` : '',
    coins_mentioned: [],
    metadata: { subreddit: p.subreddit, upvote_ratio: p.upvote_ratio },
  };
}

export class RedditScraper {
  readonly source = 'reddit' as const;

  async fetch(symbol: string, coinName: string, limit = 25): Promise<SocialMediaItem[]> {
    const token = await getOAuthToken();
    const base  = baseUrl(token);
    const hdrs  = buildHeaders(token);
    const items: SocialMediaItem[] = [];

    // 1. Search the multi-subreddit bundle
    try {
      const q = encodeURIComponent(`${symbol} OR ${coinName}`);
      const sub = COIN_SUBREDDITS[symbol] ? `${CRYPTO_SUBREDDITS}+${COIN_SUBREDDITS[symbol]}` : CRYPTO_SUBREDDITS;
      const url = `${base}/r/${sub}/search.json?q=${q}&sort=new&t=day&limit=${limit}&restrict_sr=1`;

      const res = await fetch(url, { headers: hdrs });
      if (res.status === 429) {
        logger.warn('reddit rate limited', { symbol });
        return items;
      }
      if (res.ok) {
        const data = (await res.json()) as RedditListingResponse;
        for (const entry of data?.data?.children ?? []) {
          const item = parsePost(entry.data);
          if (item) items.push(item);
        }
      }
    } catch (err) {
      logger.warn('reddit search error', { symbol, error: String(err) });
    }

    // 2. Hot posts from coin-specific subreddit (if it exists)
    if (COIN_SUBREDDITS[symbol]) {
      try {
        const url = `${base}/r/${COIN_SUBREDDITS[symbol]}/hot.json?limit=10`;
        const res = await fetch(url, { headers: hdrs });
        if (res.ok) {
          const data = (await res.json()) as RedditListingResponse;
          for (const entry of data?.data?.children ?? []) {
            const item = parsePost(entry.data);
            if (item) items.push(item);
          }
        }
      } catch (err) {
        logger.warn('reddit hot error', { symbol, error: String(err) });
      }
    }

    // Deduplicate by source_id
    const seen = new Set<string>();
    return items.filter(i => seen.has(i.source_id) ? false : (seen.add(i.source_id), true));
  }
}
