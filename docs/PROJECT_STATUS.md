# Crypto Sentiment Analyzer — Master Project Status

> **Last updated:** 2026-03-17
> **Build:** passing · **Tests:** 291 backend / 36 frontend · **Coverage:** all suites green

This single file supersedes all previous planning and summary documents across `docs/phase1/`, `docs/phase2/`, `docs/references/`, and the standalone enhancement files. It is the living source of truth for architecture, implementation status, and roadmap.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Current Architecture](#2-current-architecture)
3. [Implementation Status — All Phases](#3-implementation-status--all-phases)
4. [Sentiment Enhancement Roadmap (Issues #1–#19)](#4-sentiment-enhancement-roadmap-issues-119)
5. [API Reference](#5-api-reference)
6. [Data Models](#6-data-models)
7. [Development Guide](#7-development-guide)
8. [Environment Variables](#8-environment-variables)
9. [Testing](#9-testing)
10. [Deployment](#10-deployment)
11. [Cost & Operations](#11-cost--operations)

---

## 1. Project Overview

A full-stack crypto sentiment analysis and trading simulation platform. The system ingests live market data, news, and social media; scores content using NLP; runs multi-agent reinforcement learning tournaments on a shared order book; and exposes results through an interactive React dashboard.

### Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Chart.js |
| Backend | Node.js + Express + TypeScript (ESM) |
| Database | SQLite via `better-sqlite3` |
| AI/NLP | Claude API (Anthropic), FinBERT (Hugging Face) |
| Market Data | CoinGecko (free tier), NewsAPI |
| Social Data | Twitter/X, Reddit, RSS, Discord, Telegram, YouTube, TikTok |
| Logging | Winston + Azure Application Insights transport |
| CI/CD | GitHub Actions |
| Container | Docker + docker-compose |

---

## 2. Current Architecture

### Data Flow

```
React (localhost:5173)
  └─ /api/* proxied to Express (localhost:3000)
       ├─ CoinGeckoService      → top-50 coins, OHLCV history
       ├─ NewsAPIService         → structured articles + headlines
       ├─ SentimentService       → Claude API → BULL/NEUTRAL/BEAR + summary
  ├─ ContentSignalService   → per-item scoring (newsapi, reddit, X)
  │    ├─ Optional context-window extraction for target-coin scoring
  │    └─ Sarcasm detection → sentiment inversion / down-weighting
       ├─ SocialMediaScraperManager
       │    ├─ 7 scrapers (Twitter, Reddit, RSS, Discord, Telegram, YouTube, TikTok)
       │    └─ scoreItemsAsync() pipeline
       │         ├─ FinBertService   (FINBERT_API_URL → HF Inference API)
       │         ├─ SarcasmDetector  (heuristic, no external API)
  │         └─ detectLanguage() (Unicode script heuristic, ISO 639-1)
       ├─ TrendingDiscoveryEngine → cross-source entity clustering, velocity
       ├─ MultiSourceCalculator  → per-symbol trend report
       ├─ SentimentAnalyzerEngine → 4-mode local engine (no API calls)
       ├─ TradingAgent framework → Rule / ML / Hybrid agents
       ├─ BacktestingEngine      → day-by-day simulation, Sharpe, drawdown
       └─ MarlCompetitionEngine  → SINGLE / EVOLUTIONARY / CONTINUOUS tournaments
            ├─ SharedOrderBook    → price-time FIFO matching + synthetic MM
            ├─ PolicyNetwork      → feedforward net (pure TypeScript)
            └─ MarlTradingAgent   → Q-learning + ε-greedy + experience replay

SQLite (persistent)
  ├─ sentiment_cache          (24 hr TTL)
  ├─ backtest_results
  ├─ agent_learning_states    (cross-competition Q-table persistence)
  ├─ broker_credentials
  ├─ broker_orders
  ├─ social_media_items       + language, sarcasm_flagged columns
  ├─ trending_topics
  ├─ trending_topic_history
  └─ source_metadata

In-Memory Cache (Map, TTL)
  ├─ coins          5-min TTL
  ├─ sentiment      24-hr TTL
  └─ price history  15-min TTL
```

### Cron Jobs

| Schedule | Job |
|---|---|
| `0 * * * *` (hourly) | RSS + Discord + Telegram bulk refresh; Twitter + Reddit for top-10 coins; `discoverTrends()`; prune stale items |
| `0 0 * * *` (midnight) | `socialStore.resetDailyCounters()` |
| `0 2 * * *` (02:00 UTC) | Daily sentiment refresh for top-50 coins |

### Frontend Views

| Tab | Components |
|---|---|
| **Dashboard** | `CoinCard`, `SentimentBadge`, `PercentChange`, `DetailModal` (price chart, scored items, source breakdown) |
| **MARL Competition** | `MarlCompetitionViewer` (config form, progress poll, rankings, H2H, equity chart, market impact) |
| **Social Intel** | `SocialDashboard` (trending topics, trend score panel, items feed, source health) |

---

## 3. Implementation Status — All Phases

### Phase 0 — Core Platform ✅ Complete

- [x] Express API server with structured Winston logging
- [x] React dashboard with polling, filtering, detail modal
- [x] CoinGeckoService — top-50 coins + OHLCV history
- [x] NewsAPIService — articles + headline helper
- [x] SentimentService — Claude API, BULL/NEUTRAL/BEAR, 24-hr cache
- [x] In-memory TTL cache (`Map`-based)
- [x] SQLite persistence layer (`storage.ts`)
- [x] Azure Application Insights Winston transport
- [x] Docker + docker-compose (frontend on :80, backend on :3000)
- [x] GitHub Actions CI/CD (lint → type-check → test → build, parallel jobs)
- [x] ESLint configs (backend + frontend)

### Phase 1 — Analysis & Trading Engines ✅ Complete

- [x] **SentimentAnalyzerEngine** (`services/sentiment-analyzer.ts`) — 4 modes:
  - `BASIC` — keyword scoring, no external calls
  - `ADVANCED` — multi-factor: news + momentum + volatility + volume + RSI
  - `TRADING_SIGNALS` — BUY/SELL/HOLD with target prices, stop-loss, risk/reward
  - `SMART` — adaptive weights based on market regime (trending vs. consolidating)
- [x] **TradingAgent framework** (`services/trading-agent.ts`) — abstract base + `RuleBasedAgent`, `MLBasedAgent`, `HybridAgent`; `AgentFactory`; 3 risk profiles (AGGRESSIVE / MODERATE / CONSERVATIVE)
- [x] **BacktestingEngine** (`services/backtesting-engine.ts`) — day-by-day CoinGecko OHLCV simulation; Sharpe ratio, max drawdown, win rate, equity curve; in-memory result store
- [x] Phase 1 API endpoints (`POST /api/sentiment/analyze`, `POST /api/agents/configure`, `POST /api/backtest/run`, `GET /api/backtest/results/:id`, `GET /api/rankings/top-coins`, `GET /api/info/modes`)

### Phase 2 — MARL Competitive Framework ✅ Complete

- [x] **MarlCompetitionEngine** (`services/marl-competition-engine.ts`) — 3 tournament modes:
  - `SINGLE` — fixed-step simulated price series, all agents compete simultaneously
  - `EVOLUTIONARY` — agents sorted and replaced each round; evolutionary pressure
  - `CONTINUOUS` — wall-clock interval loop, real or simulated prices
- [x] **SharedOrderBook** — price-time FIFO matching; synthetic market-maker seeding at each step for guaranteed liquidity
- [x] **PolicyNetwork** — feedforward neural net (pure TypeScript, no external ML library); Adam-like optimizer
- [x] **MarlTradingAgent** — Q-learning, ε-greedy exploration, experience replay, scale-invariant state space, normalised % reward signals
- [x] Cross-competition learning persistence via SQLite `agent_learning_states`
- [x] **Real trading broker system** (`services/brokers/`) — Alpaca adapter, broker registry, risk guard, emergency stop
- [x] MARL React UI — config form, progress polling, rankings table, H2H table, equity chart, market impact table
- [x] MARL API endpoints (8 core + 7 broker endpoints — see §5)

### Phase 3 — Social Media Intelligence ✅ Complete

- [x] **7-source scraper suite** (`services/social-media/scraper/`): Twitter, Reddit, RSS, Discord, Telegram, YouTube, TikTok
- [x] **SocialMediaScraperManager** — per-source error isolation, coin mention population, coin name lookup map
- [x] **CoinExtractor** (`scoring/coin-extractor.ts`) — 55-coin dictionary; `$BTC`, `#BTC`, full-name detection
- [x] **ItemScorer** (`scoring/item-scorer.ts`) — 4-signal pipeline: sentiment 30%, engagement 25%, authority 25%, recency 20%; platform-specific engagement weights; RSS domain tier map; log-normalised follower authority
- [x] **TrendingDiscoveryEngine** (`trending/trending-discovery-engine.ts`) — cross-source entity aggregation, velocity vs. prior window, persists to DB
- [x] **MultiSourceCalculator** (`trending/multi-source-calculator.ts`) — per-symbol trend report with historical comparison, trend acceleration
- [x] **SQLite social store** (`database/sqlite-social-store.ts`) — tables: `social_media_items`, `trending_topics`, `trending_topic_history`, `source_metadata`; cursor-based pagination; bulk upsert via transactions
- [x] Social Dashboard React UI — trending topics, trend score panel, items feed, source health
- [x] Social Media API endpoints (6 — see §5)

### Phase 4 — Sentiment Enhancements 🔄 In Progress

See full roadmap in §4 below.

| # | Feature | Status |
|---|---|---|
| 1 | FinBERT / Hugging Face integration | 🔄 Partial |
| 2 | Sarcasm & irony detection | ✅ Done |
| 3 | Aspect-based sentiment analysis (ABSA) | 🔄 Partial |
| 4 | Multilingual support (language detection) | 🔄 Partial |
| 5 | On-chain data signals | ❌ Not started |
| 6 | Derivatives / microstructure signals | ❌ Not started |
| 7 | Commercial sentiment adapter (LunarCrush) | ❌ Not started |
| 8 | TikTok & YouTube scraper quality | ❌ Not started |
| 9 | Bot & coordinated manipulation detection | ❌ Not started |
| 10 | Deduplication & text normalisation | ❌ Not started |
| 11 | Sentiment momentum & lagged features | ❌ Not started |
| 12 | MARL state vector — sentiment features | ❌ Not started |
| 13 | SHAP-style feature attribution | ❌ Not started |
| 14 | Adversarial robustness pre-processing | ❌ Not started |
| 15 | Event-driven ingest pipeline | ❌ Not started |
| 16 | Sentiment model drift detection | ❌ Not started |
| 17 | Sentiment backtesting evaluation | ❌ Not started |
| 18 | Privacy & compliance layer | ❌ Not started |
| 19 | Market manipulation detection & alerting | ❌ Not started |

---

## 4. Sentiment Enhancement Roadmap (Issues #1–#19)

*Derived from the Advanced Sentiment Analysis research report. Ordered by recommended implementation priority.*

---

### Group A — Model Quality

#### 🔄 #1 — FinBERT / Hugging Face Integration
**File:** `backend/src/services/finbert.ts`

Wraps the Hugging Face Inference API (default: `ProsusAI/finbert`). Returns `{ label: 'positive'|'neutral'|'negative', score: number }`. Wired into:
- `item-scorer.ts` → `scoreItemAsync()` (social pipeline async path)
- `sentiment-analyzer.ts` → `scoreTextAsync()` helper for optional advanced-analysis callers

Fallback: graceful null return → keyword scoring whenever `FINBERT_API_URL` is unset or the API is unreachable.

Current limitation: `analyzeAdvancedSentiment()` and the Claude-backed `SentimentService` path are not yet directly invoking FinBERT.

**Acceptance Criteria — partially met:**
- [x] `FinBertService` wraps HF Inference API
- [ ] `analyzeAdvancedSentiment()` and `scoreItemAsync()` call FinBERT when available
- [x] Fallback to keyword path on error / missing env var
- [x] Unit tests: happy path, fallback, malformed response, 2048-char truncation
- [x] Build and tests pass

---

#### ✅ #2 — Sarcasm & Irony Detection
**File:** `backend/src/services/social-media/scoring/sarcasm-detector.ts`

Heuristic detector (no external API). 6 rules: explicit markers (`/s`), irony emoji (🙄😂🤣🤦🫠), negated positives (`not great`), sarcastic-starter + bear-term co-occurrence, excessive punctuation (`!!!!`), multiple non-acronym ALL-CAPS words. Confidence = `reasons.length / 3`, capped at 1.

Integrated in:
- `content-signals.ts` `scoreItem()` — when confidence ≥ 0.67: invert `rawKeywordScore` and halve magnitude; sets `sarcasm_flagged: boolean` on scored items
- `item-scorer.ts` `scoreItemAsync()` — same inversion applied to both FinBERT and keyword paths

**Acceptance Criteria — all met:**
- [x] `detectSarcasm(text)` returns `{ sarcastic, confidence, reasons }`
- [x] Confidence ≥ 0.67 → invert + halve sentiment weight
- [x] `sarcasm_flagged` on `ScoredSentimentItem` and `ScoredSocialItem`
- [x] Unit tests: sarcastic, earnest, all-caps, heavy emoji
- [x] Existing `ContentSignalService` tests pass

---

#### 🔄 #3 — Aspect-Based Sentiment Analysis (ABSA)
**File:** `backend/src/services/content-signals.ts`

`extractContextWindow(text, target, windowSize=50)` finds the first token matching `target` and returns a ±50-token window. `scoreItem()` accepts an optional `targetCoin` parameter; when provided and found in the text, scoring uses the context window instead of the full document.

`context_window_used: boolean` is set on `ScoredSentimentItem` and surfaced in API responses.

Current limitation: the main `/api/coins/:symbol` flow still calls `contentSignals.collect(coin.name, coin.symbol, 7)` without passing `targetCoin`, so the new context-window path is not yet exercised everywhere.

**Acceptance Criteria — partially met:**
- [x] `scoreItem()` accepts optional `targetCoin`
- [ ] `GET /api/coins/:symbol` passes `targetCoin` through scoring pipeline
- [x] `context_window_used` flag present on `ScoredSentimentItem` API payloads
- [ ] Tests with multi-coin fixture data pass

---

#### 🔄 #4 — Multilingual Support
**Files:** `backend/src/services/social-media/scoring/item-scorer.ts`, `backend/src/types/social-media.ts`, `backend/src/database/sqlite-social-store.ts`

`detectLanguage(text)` uses Unicode script ranges to return an ISO 639-1 language code without depending on a pure-ESM detection package at runtime. It falls back to `'en'` for short or Latin-script text.

`SocialMediaItem.language?: string` field added. SQLite migration adds `language TEXT` column (guarded by try/catch for existing DBs). `sarcasm_flagged` column also migrated.

`scoreItemAsync()` detects language on every item and stores it.

> **Note:** Translation routing and multilingual model switching (the `language_unsupported` weight halving) are not yet wired — the language is detected and persisted but downstream routing is a future step.

**Acceptance Criteria — partially met:**
- [x] `language` field on `SocialMediaItem`
- [x] Language detection runs in `scoreItemAsync()` before scoring
- [x] SQLite schema updated with `language` column
- [ ] Unit tests for detection (English, Spanish, Chinese, unknown)
- [ ] Non-English items routed to translation API or multilingual model
- [ ] `language_unsupported: true` flag + weight halving

---

### Group B — Data Sources

#### ❌ #5 — On-Chain Data Signals
New `OnChainService` (`services/onchain.ts`) fetching exchange inflow/outflow, active addresses 24h, large-tx count from Glassnode / CryptoQuant / IntoTheBlock free tier. Results cached 15 min. Incorporated into `ADVANCED` and `SMART` modes at 15% weight. Surfaced in `GET /api/coins/:symbol` as `on_chain` field. Graceful degradation when `ONCHAIN_API_KEY` absent.

#### ❌ #6 — Derivatives & Microstructure Signals
New `DerivativesService` (`services/derivatives.ts`) fetching funding rate, open interest, long/short ratio from Binance Futures / Bybit public endpoints (no key required). 5-min TTL cache. Wired into `SMART` mode. Surfaced as `derivatives` field in coin detail. Graceful degradation for non-futures coins.

#### ❌ #7 — Commercial Sentiment Adapter (LunarCrush / Santiment)
`CommercialSentimentAdapter` interface + `LunarCrushService` implementation (`services/commercial-sentiment.ts`). Returns `{ galaxy_score, alt_rank, social_volume_24h, sentiment_relative_to_market }`. Contributes max 20% weight in `SMART` mode when `LUNARCRUSH_API_KEY` is set. Documented in `.env.example`.

#### ❌ #8 — TikTok & YouTube Scraper Quality
`TikTokScraper` and `YouTubeScraper` to return `{ text, title, views, likes, comments_count, shares, author_followers }`. `item-scorer.ts` to map `views`/`likes` → engagement signal; `author_followers` → log-normalised authority (10k = 0.5). Integration test with mocked scrape.

---

### Group C — Data Quality & Robustness

#### ❌ #9 — Bot & Coordinated Manipulation Detection
New `BotDetectionService` (`services/bot-detection.ts`) scoring items for: posting frequency anomaly (>10/min same author), near-duplicate content (Jaccard > 0.85), sudden volume surge (>3× baseline in 5 min), known-bot blocklist. Items with `bot_score ≥ 0.8` stored for audit but excluded from trending and sentiment aggregation. `GET /api/social-media/stats` to include `bot_filtered_24h`.

#### ❌ #10 — Deduplication & Text Normalisation
`normalizeText(text)` utility in `services/social-media/scoring/` stripping URLs, `@mentions`, HTML entities, redundant whitespace while preserving `$BTC`-style tickers. MinHash/Jaccard similarity (threshold 0.85) deduplication in `scraper-manager.ts` before `upsertItems`. `deduped_24h` counter in stats.

---

### Group D — Temporal Modeling

#### ❌ #11 — Sentiment Momentum & Lagged Features
Rolling-window sentiment in `TrendingDiscoveryEngine`: 1h, 6h, 24h rolling average, rate-of-change, sentiment-volume interaction. Surfaced in `MultiSourceTrendReport.sentiment_momentum` and `GET /api/trending-score/:symbol`. Used as features in `TRADING_SIGNALS` mode.

#### ❌ #12 — MARL State Vector — Sentiment Features
`buildStateVector()` in `marl-competition-engine.ts` to accept optional `SentimentFeatures` and append normalised `sentiment_score`, `sentiment_momentum_1h`, `funding_rate`, `on_chain_netflow`. Dimension mismatch with saved states → reset with warning. `POST /api/marl/competition/start` accepts `enableSentimentFeatures: boolean`.

---

### Group E — Explainability & Trust

#### ❌ #13 — SHAP-Style Feature Attribution
`analyzeAdvancedSentiment()` to return `feature_attribution: Record<string, number>` showing additive contribution of each signal summing to composite score. Surfaced in `GET /api/coins/:symbol` and `GET /api/social-media/item/:id`. Frontend `DetailModal` to render as horizontal bar chart.

#### ❌ #14 — Adversarial Robustness Pre-processing
Extend `normalizeText()` (from #10) with NFKC Unicode normalisation, repeated-character collapsing (`mooooon` → `moon`), crypto-slang dictionary mapping (`hodl` → `hold`). `CRYPTO_SLANG_MAP` JSON file committed to `scoring/`. Adds < 5 ms per item.

---

### Group F — Infrastructure & MLOps

#### ❌ #15 — Event-Driven Ingest Pipeline
`IngestQueue` class (`services/social-media/ingest-queue.ts`) wrapping a concurrency-limited async queue. `ScrapeManager.scrapeAll()` pushes results to queue instead of bulk awaiting. Pipeline order: bot detection → normalisation → scoring → upsert. Queue depth and latency logged at `debug` level.

#### ❌ #16 — Sentiment Model Drift Detection
SQLite `model_metrics` table (`model_id`, `date`, `mean_confidence`, `item_count`). `SentimentService` and `FinBertService` record daily confidence averages. `GET /api/health` includes `model_drift` block. `POST /api/admin/reset-drift-baseline` (requires `x-api-key`) resets baseline.

---

### Group G — Legal, Ethics & Compliance

#### ❌ #17 — Sentiment Backtesting Evaluation
`BacktestingEngine.runSentimentBacktest({ symbol, startDate, endDate })` replaying SQLite `social_media_items` in 1-hour buckets aligned to CoinGecko OHLCV. Returns `{ directional_accuracy, precision, recall, f1, sharpe_vs_baseline, sample_count }`. `POST /api/backtest/sentiment` endpoint; result retrievable via existing `GET /api/backtest/results/:id`.

#### ❌ #18 — Privacy & Compliance Layer
`piiScrubber(text)` redacting email patterns, phone numbers, configurable regexes before storage. `DATA_SCRAPING_TERMS_ACCEPTED` env var gate (app disables scrapers if not `true`). `robots.txt` caching and path-check at scraper startup.

#### ❌ #19 — Market Manipulation Detection & Alerting
`BotDetectionService.detectCoordinatedCampaign(items)` using Jaccard clustering on <15-min windows across different accounts. Flagged clusters excluded from `TrendingDiscoveryEngine`. `manipulation_alerts_24h` counter in stats. Structured `WARN` log on detection.

---

### Recommended Next Implementation Order

| Priority | Issue | Rationale |
|---|---|---|
| 1 | **#9 Bot Detection** | Data quality gate — improves all downstream scores |
| 2 | **#10 Deduplication / Normalisation** | Prerequisite for #14 (adversarial hardening) |
| 3 | **#5 On-Chain Signals** | Free-tier, high alpha; immediate MARL state benefit |
| 4 | **#6 Derivatives Signals** | Complements on-chain; strong signal for MARL |
| 5 | **#11 Sentiment Momentum** | Needed for #12 MARL state extension |
| 6 | **#12 MARL State Vector** | Ties improved signals into agent decisions |
| 7 | **#13 Feature Attribution** | Explainability; builds operator trust |
| 8 | **#15 Event-Driven Ingest** | Reduces hourly latency spikes |
| 9 | **#17 Sentiment Backtesting** | Validates signal quality quantitatively |
| 10 | **#8 TikTok/YouTube Quality** | Speculative-asset short-term signal |
| 11 | **#4 Multilingual (routing)** | Complete the partial implementation above |
| 12 | **#7 Commercial Adapter** | Best as validation layer once local signals mature |
| 13 | **#14 Adversarial Hardening** | Defensive; lower urgency post-#10 |
| 14 | **#16 Drift Detection** | MLOps maturity; production stability |
| 15 | **#18 Privacy / Compliance** | Legal requirement before public/scaled deployment |
| 16 | **#19 Manipulation Alerts** | Completes the ethics/compliance story |

---

## 5. API Reference

### Core Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check; `model_drift` block planned (#16) |
| `GET` | `/api/coins` | Top-50 coins with sentiment scores |
| `GET` | `/api/coins/:symbol` | Detailed report: `sentiment_today`, `scored_items`, `source_breakdown`, `on_chain` (planned) |
| `GET` | `/api/sentiment/:symbol` | Cached sentiment object with scored content metadata |
| `POST` | `/api/refresh-sentiment` | Admin trigger (requires `x-api-key` header = `API_SECRET_KEY`) |

### Analysis Endpoints (Phase 1)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/sentiment/analyze` | 4-mode analysis; `BASIC` works without `marketData` |
| `POST` | `/api/agents/configure` | Register agents in memory registry |
| `POST` | `/api/backtest/run` | Run simulation; symbols must be CoinGecko IDs (e.g. `"bitcoin"`) |
| `GET` | `/api/backtest/results/:testId` | Full report from in-memory store |
| `GET` | `/api/rankings/top-coins` | SMART-ranked coin list |
| `GET` | `/api/info/modes` | Static documentation for analysis modes |

### MARL Endpoints (Phase 2)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/marl/competition/start` | Fire-and-forget; returns 202 with `competitionId` |
| `GET` | `/api/marl/competition/:id/status` | Poll running / completed / failed + progress % |
| `GET` | `/api/marl/competition/:id/results` | Full `CompetitionResult` (rankings, H2H, equity curve, impact) |
| `POST` | `/api/marl/agents/compare` | N-round head-to-head |
| `GET` | `/api/marl/competitions` | List all competitions (in-memory) |
| `GET` | `/api/marl/agents/learning` | List persisted agent learning states |
| `DELETE` | `/api/marl/agents/:agentId/learning` | Reset Q-table + weights; requires `x-api-key` |
| `GET` | `/api/marl/info` | Static documentation |

### MARL Broker Endpoints (Phase 2)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/marl/broker/credentials` | Register broker credential; requires `x-api-key` |
| `GET` | `/api/marl/broker/credentials` | List stored credentials; requires `x-api-key` |
| `DELETE` | `/api/marl/broker/credentials/:id` | Delete credential; requires `x-api-key` |
| `POST` | `/api/marl/broker/connect/:id` | Connect adapter for credential |
| `GET` | `/api/marl/broker/connected` | List connected adapters; requires `x-api-key` |
| `GET` | `/api/marl/broker/orders/:competitionId` | Get broker orders for competition |
| `POST` | `/api/marl/broker/emergency-stop` | Cancel all open orders for a competition |

### Social Media Endpoints (Phase 3)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/social-media/trending-topics` | Top trending topics; query: `timeWindow`, `limit`, `type` |
| `GET` | `/api/social-media/items` | Paginated scored items; query: `coin`, `source`, `sort`, `limit`, `offset`, `cursor`, `min_score`, `since_hours` |
| `GET` | `/api/social-media/item/:id` | Single item with `scoring_breakdown` |
| `GET` | `/api/social-media/stats` | Source health counters and item totals |
| `GET` | `/api/trending-score/:symbol` | `MultiSourceTrendReport`; query: `interval` |
| `POST` | `/api/social-media/refresh` | Fire-and-forget scrape; body: `{ symbols?, rss_only? }`; returns 202 |
| `GET` | `/api/scrape/social` | Scrape one symbol from all social sources |
| `POST` | `/api/scrape/batch` | Batch social scrape for up to 20 symbols |
| `GET` | `/api/trending` | Ranked trending topics |
| `POST` | `/api/trending/ingest` | Manual ingestion endpoint |

---

## 6. Data Models

### SocialMediaItem
```typescript
{
  id: string;                    // UUID
  source: SocialSource;          // twitter | reddit | rss | tiktok | discord | telegram | youtube
  source_id: string;             // platform-native ID
  content: string;
  title?: string;
  author?: string;
  author_followers?: number;
  engagement_likes: number;
  engagement_shares: number;
  engagement_comments: number;
  engagement_views?: number;
  content_created_at: string;    // ISO 8601
  fetched_at: string;
  url: string;
  coins_mentioned: string[];
  metadata: Record<string, unknown>;
  language?: string;             // ISO 639-1 — added Phase 4 (#4)
}
```

### ScoredSocialItem (extends SocialMediaItem)
```typescript
{
  sentiment_score: number;       // [-1, 1]
  sentiment_confidence: number;  // [0, 1]
  score_sentiment: number;       // [0, 100]
  score_engagement: number;      // [0, 100]
  score_recency: number;         // [0, 100]
  score_authority: number;       // [0, 100]
  score_composite: number;       // [0, 100]
  last_updated: string;
  sarcasm_flagged?: boolean;     // added Phase 4 (#2)
  finbert_used?: boolean;        // added Phase 4 (#1)
  // planned: bot_score, language_unsupported (#4/#9)
}
```

### ScoredSentimentItem (NewsAPI / Reddit / X pipeline)
```typescript
{
  id: string;
  source: 'newsapi' | 'reddit' | 'x';
  source_label: string;
  title: string;
  body: string;
  url: string;
  author?: string;
  published_at?: string;
  engagement_score: number;
  recency_score: number;
  relevance_score: number;
  keyword_score: number;
  sentiment_score: number;
  weighted_score: number;
  source_weight: number;
  sarcasm_flagged?: boolean;     // added Phase 4 (#2)
  context_window_used?: boolean; // added Phase 4 (#3)
}
```

### CompetitionConfig
```typescript
{
  mode: 'SINGLE' | 'EVOLUTIONARY' | 'CONTINUOUS';
  agents: CompetitionAgentSpec[];   // min 2, max 20
  symbols: string[];                // coin symbols
  duration: number;                 // seconds (REAL/PAPER) or steps (SIMULATED)
  refreshInterval: number;          // ms between ticks
  evolutionaryRounds?: number;
  learningEnabled: boolean;
  exchangeMode?: 'SIMULATED' | 'PAPER' | 'LIVE';
  brokerCredentialId?: string;
  riskConfig?: RiskConfig;
}
```

---

## 7. Development Guide

### Setup
```bash
git clone <repo>
cp backend/.env.example backend/.env
# Edit backend/.env with your API keys
cd backend && npm install
cd ../frontend && npm install
```

### Running locally
```bash
# Terminal 1 — backend (hot-reload)
cd backend && npm run dev        # :3000

# Terminal 2 — frontend (hot-reload)
cd frontend && npm run dev       # :5173
```

### Backend Commands
```bash
npm run dev          # Start with nodemon + tsx hot-reload
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled dist/index.js
npm test             # Run Jest tests (291 tests)
npm run test:watch   # Jest watch mode
npm run lint         # ESLint
npm run type-check   # tsc without emit
npm run clean        # Remove dist/ and logs/
```

### Frontend Commands
```bash
npm run dev          # Vite dev server on :5173
npm run build        # tsc + vite build → dist/
npm run preview      # Preview production build
npm run lint         # ESLint
npm run type-check   # tsc without emit
npm test             # Vitest (36 tests)
npm run test:watch   # Vitest watch mode
```

---

## 8. Environment Variables

```bash
# backend/.env

# Required
NEWSAPI_API_KEY=            # newsapi.org — 500 req/day free
CLAUDE_API_KEY=             # console.anthropic.com
API_SECRET_KEY=             # any string — used for admin endpoint auth

# Optional — data sources
COINGECKO_API_KEY=          # free tier works without this
X_BEARER_TOKEN=             # Twitter/X API v2 bearer token (supported in content-signals)
TWITTER_BEARER_TOKEN=       # Twitter/X API v2 bearer token (used by social-media scrapers)
FINBERT_API_URL=            # e.g. https://api-inference.huggingface.co/models/ProsusAI/finbert
HUGGINGFACE_API_TOKEN=      # token for FINBERT_API_URL
TRANSLATION_API_KEY=        # reserved for future multilingual routing

# Optional — observability
APPLICATIONINSIGHTS_CONNECTION_STRING=   # Azure App Insights

# Optional — cron overrides
SOCIAL_SCRAPE_CRON=0 * * * *   # default: hourly
```

---

## 9. Testing

### Current Test Counts

| Suite | Count | Framework |
|---|---|---|
| Backend | **291 tests, 20 suites** | Jest |
| Frontend | **36 tests, 3 suites** | Vitest |

### Backend Test Suites

| File | Focus |
|---|---|
| `services/finbert.test.ts` | FinBertService — all paths, truncation, response parsing |
| `services/social-media/sarcasm-detector.test.ts` | All 6 detection rules |
| `services/social-media/item-scorer.test.ts` | 4-signal sync pipeline, authority/engagement/recency composition |
| `services/social-media/coin-extractor.test.ts` | Ticker extraction, `$BTC`, `#BTC`, name variants |
| `services/social-media/multi-source-calculator.test.ts` | Trend report computation |
| `services/cache.test.ts` | TTL cache get/set/delete/expiry |
| `services/newsapi.test.ts` | Article fetch, error paths |
| `services/sentiment.test.ts` | Claude API call, fallback, cache |
| `services/content-signals.test.ts` | ContentSignalService scoring, sarcasm, ABSA |
| `services/sqlite-social-store.test.ts` | Schema, upsert, pagination |
| `services/social-media/sqlite-social-store.test.ts` | Social store specific |
| `services/trending-discovery-engine.test.ts` | Trend discovery, velocity |
| `services/social-media/trending-discovery.test.ts` | Discovery engine |
| `services/marl-competition-engine.test.ts` | MARL engine, learning persistence, order book |
| `api/core.test.ts` | Core API endpoints, health, error paths |
| `api/marl.test.ts` | MARL competition API |
| `api/marl-broker.test.ts` | Broker credential + emergency stop API |
| `api/social-media.test.ts` | Social media API |
| `api/social-media-route-helpers.test.ts` | Route helper utilities |
| `services/coingecko.test.ts` | CoinGecko fetch, rate limit, history |

### Running Tests
```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# Backend with coverage
cd backend && npx jest --coverage

# Single suite
cd backend && npx jest --config jest.config.cjs src/__tests__/services/finbert.test.ts
```

### Known Console Log Behaviour in Tests

All `error` and `warn` level logs that appear during test runs are **intentional** — they come from test cases that exercise error paths (mocked 401/404/429/503 responses, network failures, malformed API responses). There are no spurious error logs.

---

## 10. Deployment

### Docker (recommended)
```bash
# Full stack (frontend :80, backend :3000)
docker compose up --build

# Backend only
docker compose up backend

# One-off backend image
docker build -t sentiment-backend ./backend
```

`docker-compose.yml` wires frontend → nginx → backend. SQLite data persists in a named volume (`sqlite_data`). Set secrets in `backend/.env` before running.

### CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs on every push/PR to `main`:
- **backend job:** `npm ci` → lint → type-check → test → build
- **frontend job:** `npm ci` → lint → type-check → build (parallel)

Both jobs use Node 20 with npm cache enabled.

### Production (Azure App Service)
- Backend deployed as Node.js app on Azure App Service
- SQLite volume mounted as persistent storage
- Environment variables set in App Service configuration
- Application Insights enabled via `APPLICATIONINSIGHTS_CONNECTION_STRING`

---

## 11. Cost & Operations

### API Cost Estimates

| Service | Usage | Estimated Cost |
|---|---|---|
| Claude API | Top-50 coins × 1/day × ~$0.01–0.03/req | ~$8–15/month |
| NewsAPI | 500 req/day free tier | $0 (free tier) |
| CoinGecko | Free tier, no key required | $0 |
| Hugging Face | Free Inference API (rate-limited) | $0 (or self-host) |

### Monitoring

Key metrics to watch in production:
- API response time (target: < 200ms p95 for cached responses)
- Sentiment job duration (target: < 30s for 50 coins)
- Cache hit rate (target: > 90% for coin list)
- Social scrape error rate per source
- FinBERT inference latency (target: < 300ms per item)

### SQLite Maintenance

```bash
# Prune old social items (auto-runs in hourly cron)
POST /api/social-media/refresh

# Reset daily counters (auto-runs at midnight)
# Triggered automatically

# Reset agent learning state
DELETE /api/marl/agents/:agentId/learning   # requires x-api-key header
```

---

*This document consolidates: `docs/phase1/PHASE1_EXECUTIVE_SUMMARY.md`, `docs/phase1/PHASE1_ARCHITECTURE_OVERVIEW.md`, `docs/phase1/PHASE1_INTEGRATION_GUIDE.md`, `docs/phase1/PHASE1_SYSTEM_ARCHITECTURE.md`, `docs/phase1/PHASE1_INDEX.md`, `docs/phase2/MARL_EXECUTIVE_SUMMARY.md`, `docs/phase2/MARL_DOCS_INDEX.md`, `docs/phase2/MARL_ARCHITECTURE_DETAILED.md`, `docs/phase2/MARL_COMPETITIVE_GAME_THEORY.md`, `docs/phase2/MARL_COMPLETE_GUIDE.md`, `docs/phase2/MARL_INTEGRATION_GUIDE.md`, `docs/phase2/CLAUDE_CODE_KICKOFF_PHASE2_MARL.md`, `docs/AdvancedSentimentAnalysis_Upgrades.md`, `docs/SENTIMENT_ENHANCEMENT_ACTION_PLAN.md`, `docs/dependency.mmd`, `docs/references/*`.*
