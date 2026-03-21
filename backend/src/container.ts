/**
 * DI container (tsyringe) — wires all application services.
 *
 * Design notes
 * ────────────
 * • `reflect-metadata` MUST be the first import; the Reflect polyfill must be
 *   installed before tsyringe processes any class metadata.
 * • Services are registered via `container.registerInstance()` rather than
 *   `registerSingleton()` / `useClass`.  This avoids adding `@injectable()`
 *   decorators to every service class (tsyringe requires them for class-based
 *   resolution).  Pre-building the instances at module load time preserves the
 *   same eager-singleton semantics the application had before this refactor.
 * • Because Jest hoists `jest.mock()` above all `import` statements, any mock
 *   set up by a test file is already in place when this module loads.  The
 *   `new ServiceClass()` calls here therefore produce mock instances in test
 *   contexts, so existing `jest.mock()` patterns continue to work unchanged.
 * • String tokens (TOKENS) are used throughout so that call sites never need
 *   to import the concrete class solely to resolve it.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { Cache } from './services/cache.js';
import { CoinGeckoService } from './services/coingecko.js';
import { ContentSignalService } from './services/content-signals.js';
import { SentimentService } from './services/sentiment.js';
import { SentimentAnalyzerEngine } from './services/sentiment-analyzer.js';
import { BacktestingEngine } from './services/backtesting-engine.js';
import { SocialScraperService } from './services/social-scraper.js';
import { TrendingTopicsEngine } from './services/trending-topics.js';
import { SocialMediaScraperManager } from './services/social-media/scraper/scraper-manager.js';
import { TrendingTopicDiscoveryEngine } from './services/social-media/trending/trending-discovery-engine.js';
import { MultiSourceTrendingScoreCalculator } from './services/social-media/trending/multi-source-calculator.js';

// ── Token registry ─────────────────────────────────────────────────────────────
// Two Cache tokens are required because index.ts uses independent cache
// instances for coin data and sentiment data respectively.

export const TOKENS = {
  Cache:                              'Cache',
  SentimentCache:                     'SentimentCache',
  CoinGeckoService:                   'CoinGeckoService',
  ContentSignalService:               'ContentSignalService',
  SentimentService:                   'SentimentService',
  SentimentAnalyzerEngine:            'SentimentAnalyzerEngine',
  BacktestingEngine:                  'BacktestingEngine',
  SocialScraperService:               'SocialScraperService',
  TrendingTopicsEngine:               'TrendingTopicsEngine',
  SocialMediaScraperManager:          'SocialMediaScraperManager',
  TrendingTopicDiscoveryEngine:       'TrendingTopicDiscoveryEngine',
  MultiSourceTrendingScoreCalculator: 'MultiSourceTrendingScoreCalculator',
} as const;

// ── Service registrations ──────────────────────────────────────────────────────
// Each call to registerInstance() stores a pre-built singleton that is returned
// verbatim on every subsequent container.resolve() for that token.

container.registerInstance(TOKENS.Cache,                              new Cache());
container.registerInstance(TOKENS.SentimentCache,                     new Cache());
container.registerInstance(TOKENS.CoinGeckoService,                   new CoinGeckoService());
container.registerInstance(TOKENS.ContentSignalService,               new ContentSignalService());
container.registerInstance(TOKENS.SentimentService,                   new SentimentService());
container.registerInstance(TOKENS.SentimentAnalyzerEngine,            new SentimentAnalyzerEngine());
container.registerInstance(TOKENS.BacktestingEngine,                  new BacktestingEngine());
container.registerInstance(TOKENS.SocialScraperService,               new SocialScraperService());
container.registerInstance(TOKENS.TrendingTopicsEngine,               new TrendingTopicsEngine());
container.registerInstance(TOKENS.SocialMediaScraperManager,          new SocialMediaScraperManager());
container.registerInstance(TOKENS.TrendingTopicDiscoveryEngine,       new TrendingTopicDiscoveryEngine());
container.registerInstance(TOKENS.MultiSourceTrendingScoreCalculator, new MultiSourceTrendingScoreCalculator());

export { container };
