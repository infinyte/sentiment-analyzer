/**
 * Social Media Intelligence — barrel exports
 */

export { SocialMediaScraperManager }  from './scraper/scraper-manager.js';
export { TrendingTopicDiscoveryEngine } from './trending/trending-discovery-engine.js';
export { MultiSourceTrendingScoreCalculator } from './trending/multi-source-calculator.js';
export { scoreItem, scoreItems }       from './scoring/item-scorer.js';
export { extractCoins, extractHashtags, extractKeywords, extractAll } from './scoring/coin-extractor.js';
export { TwitterScraper }              from './scraper/twitter-scraper.js';
export { RedditScraper }               from './scraper/reddit-scraper.js';
export { RssScraper, DEFAULT_FEEDS }   from './scraper/rss-scraper.js';
export { DiscordScraper }              from './scraper/discord-scraper.js';
export { TelegramScraper }             from './scraper/telegram-scraper.js';
export { YouTubeScraper }              from './scraper/youtube-scraper.js';
export { TikTokScraper }               from './scraper/tiktok-scraper.js';
