# Sentiment Analysis Enhancement Action Plan

Derived from: *Advancing Sentiment Analysis for Crypto Trading Platforms* research report.
Each item maps to the existing codebase (`backend/src/services/`, `backend/src/routes/`) and is ordered from highest to lowest impact/feasibility.

---

## Group A — Model Quality (NLP Upgrades)

Current status on this branch:
- #1 is fully implemented: `FinBertService` exists; all three non-BASIC modes (`ADVANCED`, `SMART`, `TRADING_SIGNALS`) now route through FinBERT-enhanced async methods (`analyzeAdvancedSentimentAsync`, `analyzeSmartSentimentAsync`, `generateTradingSignalsAsync`); fallback to keyword scoring when `FINBERT_API_URL` is not set.
- #2 is implemented in both content scoring and async social scoring.
- #3 is partially implemented: context-window extraction exists in `ContentSignalService`, but the main `/api/coins/:symbol` flow does not yet pass `targetCoin` through.
- #4 is partially implemented: language detection and persistence are live, but translation / multilingual routing is still pending.

---

### 1. Integrate FinBERT / Crypto-Fine-Tuned Transformer for Local Sentiment Scoring

**Description:**  
Replace (or supplement) the current Claude API call in `SentimentService` (`services/sentiment.ts`) with a locally hosted or API-proxied call to a FinBERT or `finetuned-finbert-crypto` model (e.g., via Hugging Face Inference API or a self-hosted ONNX runtime). FinBERT achieves 82–90% F1 on crypto text vs ~60–70% for lexicon-based approaches, and eliminates per-request token costs. The existing `SentimentAnalyzerEngine` (`services/sentiment-analyzer.ts`) `ADVANCED` mode should be wired to call this model for per-item scoring.

**Acceptance Criteria:**
- [x] A new `FinBertService` (or adapter) in `services/` wraps the Hugging Face Inference API (or ONNX runtime) and returns `{ label: 'positive' | 'neutral' | 'negative', score: number }` per text input.
- [x] `SentimentAnalyzerEngine.analyzeAdvancedSentiment()` calls `FinBertService` for news/social items when `ADVANCED` or `SMART` mode is requested.
- [x] Fallback to the existing Claude API path when `FinBertService` is unavailable (network error / env var `FINBERT_API_URL` not set).
- [x] Unit tests cover the new service: happy path, fallback path, and malformed API response.
- [ ] Average latency per item does not exceed 300 ms under normal conditions.
- [x] `npm run build` and `npm test` pass with no regressions.

---

### 2. Add Sarcasm and Irony Detection Filter

**Description:**  
Social media posts frequently use irony, memes, and sarcasm that flip the true sentiment (e.g., "great,  another 20% dump 🙄"). Add a lightweight sarcasm-detection step in the `ContentSignalService` (`services/content-signals.ts`) scoring pipeline that down-weights or inverts confidence on flagged items before the sentiment score is aggregated. A fine-tuned DistilBERT sarcasm classifier or a rule-based heuristic (emoji patterns, punctuation features) is acceptable for v1.

**Acceptance Criteria:**
- [x] A `detectSarcasm(text: string): { sarcastic: boolean; confidence: number }` function is added to `ContentSignalService` or a new `sarcasm-detector.ts` utility.
- [x] When sarcasm is detected with confidence ≥ 0.7, the sentiment polarity of that item is inverted and its overall weight reduced by 50%.
- [x] The `scored_items` response field in `GET /api/coins/:symbol` includes a `sarcasm_flagged: boolean` property per item.
- [x] Unit tests cover: clearly sarcastic text, earnest text, edge cases (all-caps, heavy emoji).
- [x] Existing `ContentSignalService` tests continue to pass.

---

### 3. Implement Aspect-Based Sentiment Analysis (ABSA)

**Description:**  
Current document-level sentiment treats an entire post as having a single polarity. Many posts mention multiple coins or events. Implement ABSA in `ContentSignalService` so that only sentiment directed at the target coin is extracted. Use the existing `coin-extractor.ts` entity detection to identify the target mention, then score only the surrounding context window (±50 tokens). For v1, a span-extraction heuristic is sufficient; a full ASQP model can follow in a later iteration.

**Acceptance Criteria:**
- [x] `ContentSignalService.scoreItem()` accepts an optional `targetCoin` parameter and applies contextual sentiment extraction when provided.
- [x] `GET /api/coins/:symbol` passes `targetCoin: symbol` through the scoring pipeline so cross-coin posts yield accurate per-coin scores.
- [x] A `context_window_used: boolean` flag is present in the `scoring_breakdown` of `GET /api/social-media/item/:id`.
- [x] Benchmark: at least 5 manually verified multi-coin posts score correctly (verified in tests with fixture data).
- [x] `npm test` passes.

---

### 4. Add Multilingual Support (Language Detection & Translation Pre-processing)

**Description:**  
Crypto communities are global; non-English posts are currently scored with English-trained models, degrading accuracy. Add a pre-processing step in the social scraper pipeline (`services/social-media/scoring/item-scorer.ts`) that detects language (using `franc` or `langdetect`) and, when non-English, either (a) translates the text via a translation API before scoring or (b) routes it to a multilingual model (DistilBERT-multilingual). Language tag should be persisted on the `SocialMediaItem`.

**Acceptance Criteria:**
- [x] `SocialMediaItem` type (`services/social-media/`) includes a `language: string` field (ISO 639-1 code).
- [x] Language detection runs as the first step of `item-scorer.ts` before sentiment scoring.
- [ ] Non-English items are either translated (when `TRANSLATION_API_KEY` env var is set) or routed to a multilingual model; otherwise, a `language_unsupported: true` flag is set and the item's score weight is halved.
- [x] SQLite schema updated to include the `language` column (`sqlite-social-store.ts`).
- [ ] Unit tests for detection (English, Spanish, Chinese, unknown) pass.
- [x] `npm run build` and `npm test` pass with no regressions.

---

## Group B — Data Sources (New Signal Feeds)

---

### 5. Integrate On-Chain Data Signals (Exchange Flows, Whale Activity, Active Addresses)

**Description:**  
Add a new `OnChainService` (`services/onchain.ts`) that fetches key on-chain metrics from the Glassnode, CryptoQuant, or IntoTheBlock free-tier APIs: exchange inflow/outflow, active addresses (24 h), and large-transaction count (whale proxy). These signals should be incorporated into `SentimentAnalyzerEngine.analyzeAdvancedSentiment()` as additional features, and surfaced in the `/api/coins/:symbol` detail response under a new `on_chain` field.

**Acceptance Criteria:**
- [x] `OnChainService` implements `getMetrics(coinId: string): Promise<OnChainMetrics>` returning `{ exchange_inflow, exchange_outflow, active_addresses_24h, large_tx_count_24h }`.
- [x] Results are cached with a 15-minute TTL using the existing `Cache` class (`services/cache.ts`).
- [x] `analyzeAdvancedSentiment()` in `ADVANCED` and `SMART` modes incorporates on-chain features with a configurable weight (default 15%).
- [x] `GET /api/coins/:symbol` response includes `on_chain: OnChainMetrics` when data is available.
- [x] Graceful degradation: if the provider returns an error or the env var `ONCHAIN_API_KEY` is absent, the field is omitted and analysis proceeds without it.
- [x] Unit tests mock the external API and cover: happy path, missing key fallback, cache hit.

---

### 6. Integrate Derivatives and Market Microstructure Signals (Funding Rates, Open Interest, Long/Short Ratio)

**Description:**  
Fetch perpetual-futures microstructure data (funding rate, open interest, long/short ratio) from exchange public APIs (Binance Futures, Bybit — no API key required for public endpoints). Add a `DerivativesService` (`services/derivatives.ts`) that fetches and normalises these signals. Wire them into the `SMART` analysis mode of `SentimentAnalyzerEngine` and include them in the coin detail response under a `derivatives` field.

**Acceptance Criteria:**
- [ ] `DerivativesService.getSignals(symbol: string): Promise<DerivativesSignals>` returns `{ funding_rate, open_interest_usd, long_short_ratio, oi_change_24h_pct }`.
- [ ] Data is cached at a 5-minute TTL.
- [ ] `SentimentAnalyzerEngine` `SMART` mode incorporates funding-rate polarity (positive → bullish signal, extremes → contrarian warning) and OI direction.
- [ ] `GET /api/coins/:symbol` response includes `derivatives: DerivativesSignals`.
- [ ] Graceful degradation if a symbol is not listed on a futures exchange (e.g., small-cap coins).
- [ ] Unit tests mock HTTP calls; cover: normal data, symbol-not-found (404), rate-limited (429) responses.

---

### 7. Add Commercial Sentiment Data Provider Adapter (LunarCrush / Santiment)

**Description:**  
LunarCrush and Santiment provide aggregated, bot-filtered sentiment and social-volume data that can serve as a high-quality signal baseline. Create a `CommercialSentimentAdapter` interface and a `LunarCrushService` concrete implementation (`services/commercial-sentiment.ts`). When `LUNARCRUSH_API_KEY` is set, the adapter's galaxy score and alt rank signals supplement the existing scraper-derived sentiment in `SentimentAnalyzerEngine`.

**Acceptance Criteria:**
- [ ] `CommercialSentimentAdapter` interface defines `getSentimentMetrics(symbol: string): Promise<CommercialSentimentData>`.
- [ ] `LunarCrushService` implements the interface using LunarCrush v3 API; fields returned: `{ galaxy_score, alt_rank, social_volume_24h, sentiment_relative_to_market }`.
- [ ] When enabled, the signal contributes a maximum 20% weight toward the final composite score in `SMART` mode.
- [ ] The adapter is optional; the system runs identically without `LUNARCRUSH_API_KEY`.
- [ ] `GET /api/coins/:symbol` response includes `commercial_sentiment` when the adapter is active.
- [ ] Unit tests cover the adapter with mocked HTTP; integration is documented in `.env.example`.

---

### 8. Improve TikTok and YouTube Scraper Signal Quality

**Description:**  
The existing `tiktok-scraper.ts` and `youtube-scraper.ts` in `services/social-media/scraper/` are present but likely return minimal content signal. Research-validated findings show TikTok sentiment is ~20% more predictive for short-term speculative moves. Upgrade both scrapers to extract: video caption/title text, comment excerpts, view count, like/share/comment counts, and author follower count (as an authority proxy). Wire these fields into the `item-scorer.ts` engagement and authority signals.

**Acceptance Criteria:**
- [ ] `TikTokScraper` and `YouTubeScraper` return items with `{ text, title, views, likes, comments_count, shares, author_followers }` populated from real scrape runs.
- [ ] `item-scorer.ts` maps `views` and `likes` to the engagement signal (0–1 normalised) for TikTok/YouTube items.
- [ ] `author_followers` maps to the authority signal (log-normalised, baseline 10 k followers = 0.5).
- [ ] Integration test: a mocked scrape response for both sources produces correctly scored items in the full pipeline.
- [ ] `source_health` in `GET /api/social-media/stats` reports successful fetch counts for both sources.

---

## Group C — Data Quality & Robustness

---

### 9. Implement Bot and Coordinated-Manipulation Detection Filter

**Description:**  
Add a `BotDetectionService` (`services/bot-detection.ts`) that scores incoming social items for bot-like behaviour before they are stored or scored. Detection heuristics for v1: posting frequency anomaly (>10 posts/min from same author), duplicate/near-duplicate content (Jaccard similarity >0.85), sudden surge detection (>3× baseline volume for a coin in a 5-minute window), and known bot-account blocklist. Items flagged as bots receive a `bot_score` and are excluded from sentiment aggregation when `bot_score ≥ 0.8`.

**Acceptance Criteria:**
- [x] `BotDetectionService.score(item: SocialMediaItem): BotScore` returns `{ score: number; reasons: string[] }`.
- [x] `ScrapeManager` invokes bot detection before `upsertItems` and attaches `bot_score` to each item.
- [x] `SocialMediaItem` type and SQLite schema include `bot_score: number | null`.
- [x] Items with `bot_score ≥ 0.8` are stored (for auditability) but excluded from trending-topic aggregation and sentiment scoring.
- [x] A `GET /api/social-media/stats` response includes `bot_filtered_24h: number`.
- [x] Unit tests cover each detection heuristic individually and in combination.

---

### 10. Enhanced Data Deduplication and Normalisation Pipeline

**Description:**  
The current deduplication in `SocialScraperService` relies on ID-based matching, missing near-duplicates (reposts with minor edits, cross-platform syndication). Implement fuzzy content deduplication using a MinHash/LSH approach or simple shingling for text similarity in the `scraper-manager.ts` ingest pipeline. Also normalise text: strip URLs, `@mentions`, `#hashtags` (preserve coin references), and HTML entities before scoring.

**Acceptance Criteria:**
- [ ] A `normalizeText(text: string): string` utility in `services/social-media/scoring/` strips URLs, mentions, HTML entities, and redundant whitespace while preserving `$BTC`-style coin tickers.
- [ ] `scraper-manager.ts` runs normalisation and MinHash/Jaccard similarity check (threshold 0.85) before calling `upsertItems`; near-duplicates are discarded with a counter logged.
- [ ] `GET /api/social-media/stats` includes `deduped_24h: number` counter.
- [ ] Unit tests cover: identical text, 90%-similar text, completely different text, text with URLs and mentions.
- [ ] No regression in existing scraper tests.

---

## Group D — Temporal Modeling & Feature Engineering

---

### 11. Add Sentiment Momentum and Lagged Feature Signals

**Description:**  
Implement rolling-window sentiment aggregation in `TrendingDiscoveryEngine` (`services/social-media/trending/trending-discovery-engine.ts`) to produce sentiment momentum signals: 1-hour, 6-hour, and 24-hour rolling average sentiment, rate-of-change (momentum), and sentiment-volume interaction. These features should be returned in the `MultiSourceTrendReport` from `/api/trending-score/:symbol` and exposed as additional inputs to the `SentimentAnalyzerEngine` `TRADING_SIGNALS` mode.

**Acceptance Criteria:**
- [x] `MultiSourceTrendReport` type (`types/social-media.ts`) includes `sentiment_momentum: { h1_avg, h6_avg, h24_avg, roc_1h, roc_6h }`.
- [x] `MultiSourceCalculator.calculate()` computes the above from the SQLite `trending_topic_history` table.
- [x] `SentimentAnalyzerEngine` `TRADING_SIGNALS` mode uses `roc_1h` and `roc_6h` as features (configurable weights).
- [x] `GET /api/trending-score/:symbol` response includes the `sentiment_momentum` block.
- [x] Unit tests: stable sentiment → near-zero ROC; rising sentiment → positive ROC; declining → negative ROC.

---
9. Implement Bot and Coordinated-Manipulation Detection Filter

**Description:**  
Add a `BotDetectionService` (`services/bot-detection.ts`) that scores incoming social items for bot-like behaviour before they are stored or scored. Detection heuristics for v1: posting frequency anomaly (>10 posts/min from same author), duplicate/near-duplicate content (Jaccard similarity >0.85), sudden surge detection (>3× baseline volume for a coin in a 5-minute window), and known bot-account blocklist. Items flagged as bots receive a `bot_score` and are excluded from sentiment aggregation when `bot_score ≥ 0.8`.

**Acceptance Criteria:**
- [ ] `BotDetectionService.score(item: SocialMediaItem): BotScore` returns `{ score: number; reasons: string[] }`.
- [ ] `ScrapeManager` invokes bot detection before `upsertItems` and attaches `bot_score` to each item.
- [ ] `SocialMediaItem` type and SQLite schema include `bot_score: number | null`.
- [ ] Items with `bot_score ≥ 0.8` are stored (for auditability) but excluded from trending-topic aggregation and sentiment scoring.
- [ ] A `GET /api/social-media/stats` response includes `bot_filtered_24h: number`.
- [ ] Unit tests cover each detection heuristic individually and in combination.

### 12. Integrate Sentiment Features into MARL Agent State Vector

**Description:**  
The `MarlTradingAgent` state vector in `MarlCompetitionEngine` (`services/marl-competition-engine.ts`) currently includes price/volume/volatility features. Extend it to include: `sentiment_score`, `sentiment_momentum_1h`, `funding_rate`, and `on_chain_netflow` (from issues #5, #6, #11) when available. Document the new state space dimensions and ensure backward compatibility with existing saved agent learning states.

**Acceptance Criteria:**
- [x] `buildStateVector()` (or equivalent) in `marl-competition-engine.ts` accepts an optional `SentimentFeatures` parameter and appends normalised sentiment fields to the state array.
- [x] The state vector dimension is declared as a constant and updated in comments/docs when new features are added.
- [x] Existing saved `agent_learning_states` with the old state dimension load without crashing (dimension mismatch triggers a reset with a warning log).
- [x] `POST /api/marl/competition/start` accepts an optional `enableSentimentFeatures: boolean` flag (default `true` when `FINBERT_API_URL` or `LUNARCRUSH_API_KEY` is set).
- [x] Unit tests verify the state vector includes sentiment fields when the flag is enabled and omits them when disabled.

---

## Group E — Explainability & Trust

---

### 13. Add SHAP-Style Feature Attribution to Sentiment Score Breakdown

**Description:**  
Users and RL agents benefit from knowing *why* a sentiment score was assigned. Extend the `GET /api/coins/:symbol` and `GET /api/social-media/item/:id` responses with a `feature_attribution` block that shows the additive contribution of each signal (news_score, momentum_score, on_chain_score, etc.) to the final composite score. For v1, a simple weighted-contribution decomposition (not full Shapley values) is sufficient and aligns with SHAP's spirit.

**Acceptance Criteria:**
- [ ] `SentimentAnalyzerEngine.analyzeAdvancedSentiment()` returns a `feature_attribution: Record<string, number>` map alongside the existing fields, where values sum to the composite score.
- [ ] `GET /api/coins/:symbol` includes `sentiment_today.feature_attribution`.
- [ ] `GET /api/social-media/item/:id` includes `scoring_breakdown.feature_attribution`.
- [ ] Frontend `DetailModal` renders the attribution as a small horizontal bar chart or percentage list.
- [ ] Unit tests verify attributions sum to the composite score within floating-point tolerance (±0.001).

---

### 14. Implement Adversarial Robustness Pre-processing (Input Sanitisation)

**Description:**  
NLP sentiment models are vulnerable to adversarial inputs (intentional misspellings, Unicode lookalikes, excessive punctuation) that can manipulate scores. Add input sanitisation to the text pre-processing step: Unicode normalisation (NFKC), repeated-character collapsing (e.g., `"mooooon"` → `"moon"`), and basic spell-correction for known crypto slang using a configurable dictionary. This hardening should run in `normalizeText()` (from issue #10) before model inference.

**Acceptance Criteria:**
- [ ] `normalizeText()` applies NFKC Unicode normalisation, collapses 3+ consecutive repeated characters to 2, and maps a configurable `CRYPTO_SLANG_MAP` (e.g., `hodl`, `wen`, `gm`) to dictionary terms.
- [ ] A `CRYPTO_SLANG_MAP` JSON file is committed to `backend/src/services/social-media/scoring/` and loaded at startup.
- [ ] Unit tests verify: lookalike Unicode is normalised, "mooooon" → "moon", `hodl` → `hold`, clean text passes through unchanged.
- [ ] Processing adds < 5 ms per item (benchmarked in test).

---

## Group F — Infrastructure & MLOps

---

### 15. Event-Driven Social Ingest Pipeline (Replace Polling Cron with Streaming-Ready Architecture)

**Description:**  
The current hourly cron in `index.ts` batches all scraping, creating latency spikes and uneven load. Refactor the social ingest pipeline to use an internal `EventEmitter`-based queue (Node.js `EventEmitter` or a lightweight in-process queue like `p-queue`) so that each scrape result is scored and stored immediately upon arrival rather than in a batch. This is the foundation for a future Kafka/Kinesis migration. RSS and Discord scrapers should be the first converted sources.

**Acceptance Criteria:**
- [x] An `IngestQueue` class (`services/social-media/ingest-queue.ts`) wraps a concurrency-limited async queue and processes `SocialMediaItem[]` payloads through bot detection → normalisation → scoring → upsert, in that order.
- [x] `ScrapeManager.scrapeAll()` is refactored to push results to `IngestQueue` rather than awaiting bulk upsert directly.
- [x] The hourly cron now triggers scraping only; all processing flows through `IngestQueue`.
- [x] Queue depth and processing latency are logged via Winston at `debug` level.
- [x] No regression in existing social scraper tests; a new integration test verifies end-to-end flow through the queue.

---

### 16. Sentiment Model Drift Detection and Alerting

**Description:**  
As market language evolves (new slang, new projects, macro shifts), static sentiment models degrade silently. Implement a lightweight drift-detection mechanism: track a rolling 7-day average `mean_confidence` for each model (Claude API, FinBERT) in SQLite; if the weekly average drops more than 15% from a baseline, emit a `WARN` log and a `GET /api/health` degraded flag. Include a `POST /api/admin/reset-drift-baseline` admin endpoint.

**Acceptance Criteria:**
- [ ] SQLite schema includes a `model_metrics` table with columns `model_id`, `date`, `mean_confidence`, `item_count`.
- [ ] `SentimentService` and `FinBertService` record per-day confidence averages via `storage.recordModelMetrics()`.
- [ ] `GET /api/health` response includes `model_drift: { status: 'ok' | 'degraded', details: { [model]: { current_avg, baseline_avg, delta_pct } } }`.
- [ ] `POST /api/admin/reset-drift-baseline` (requires `x-api-key`) resets the baseline to the current 7-day average.
- [ ] Unit tests cover: normal operation, drift detected (>15% drop), baseline reset.

---

### 17. Continuous Backtesting Evaluation of Sentiment Signal Quality

**Description:**  
Extend the `BacktestingEngine` (`services/backtesting-engine.ts`) to support a `SentimentBacktest` mode that replays historical social data from SQLite and evaluates whether sentiment-driven signals actually preceded correct price moves. Key output metrics: directional accuracy (% of BUY signals followed by price increase within 24 h), precision/recall on BULL/BEAR calls vs CoinGecko price history, and Sharpe ratio improvement over a sentiment-neutral baseline.

**Acceptance Criteria:**
- [ ] `BacktestingEngine.runSentimentBacktest({ symbol, startDate, endDate }): SentimentBacktestResult` is implemented.
- [ ] `SentimentBacktestResult` includes `{ directional_accuracy, precision, recall, f1, sharpe_vs_baseline, sample_count }`.
- [ ] `POST /api/backtest/sentiment` endpoint accepts `{ symbol, startDate, endDate }` and returns `testId`; result retrievable via existing `GET /api/backtest/results/:testId`.
- [ ] The backtest replays `social_media_items` from SQLite bucketed into 1-hour windows, aligning with CoinGecko OHLCV data.
- [ ] Unit tests use fixture social data and mocked CoinGecko history; directional accuracy is asserted within a ±5% range of expected.

---

## Group G — Legal, Ethics & Compliance

---

### 18. Privacy and Compliance Layer for Social Data Collection

**Description:**  
GDPR and CCPA require that personal data scraped from social platforms be handled lawfully. Add a compliance layer to the social scraper pipeline: (a) strip all personally identifiable information (PII) — full names, email-like strings, phone numbers — from scraped post content before storage; (b) add a `data_source_terms_accepted: boolean` config flag in `.env` that must be `true` to enable scraping; (c) honour per-platform robots.txt directives by caching and checking them at scraper startup.

**Acceptance Criteria:**
- [ ] A `piiScrubber(text: string): string` utility redacts email-pattern strings, phone-number patterns, and configurable regex patterns from post content.
- [ ] `ScrapeManager` runs `piiScrubber` on all scraped text before passing to `IngestQueue` / `upsertItems`.
- [ ] `.env.example` includes `DATA_SCRAPING_TERMS_ACCEPTED=false` with documentation; the app logs a `WARN` and disables scrapers if the value is not `true`.
- [ ] `RssScraper` (and other scrapers) check a cached `robots.txt` result for the target domain at startup; disallowed paths are skipped.
- [ ] Unit tests verify PII scrubbing for email, phone, and mixed content.

---

### 19. Market Manipulation Detection and Alerting

**Description:**  
The platform must not amplify pump-and-dump coordination. Extend `BotDetectionService` (issue #9) with a coordinated-campaign detector: identify clusters of posts with high lexical similarity arriving from different accounts in a short time window (< 15 min), flag the cluster, and emit a `manipulation_alert` log event. Flagged items should be excluded from the trending-topics engine and a `manipulation_alerts` counter exposed in `GET /api/social-media/stats`.

**Acceptance Criteria:**
- [ ] `BotDetectionService.detectCoordinatedCampaign(items: SocialMediaItem[]): CoordinationAlert | null` is implemented using Jaccard similarity clustering.
- [ ] `TrendingDiscoveryEngine.discoverTrends()` passes the ingest window to `detectCoordinatedCampaign`; flagged clusters are excluded from trend scores.
- [ ] A `manipulation_alerts_24h: number` field is added to `GET /api/social-media/stats`.
- [ ] When a campaign is detected, a structured `WARN` log is emitted: `{ event: 'manipulation_alert', symbol, cluster_size, similarity_avg }`.
- [ ] Unit tests verify detection on synthetic coordinated posts and correct pass-through of legitimate diverse posts.

---

*Total: 19 issues across 7 groups.*

---

## Suggested Implementation Order

| Priority | Issue | Rationale |
|----------|-------|-----------|
| 1 | #1 — FinBERT Integration | Highest accuracy gain; foundational for downstream issues |
| 2 | #9 — Bot Detection | Data quality gate; improves all downstream scores |
| 3 | #10 — Deduplication / Normalisation | Prerequisite for #14 (adversarial hardening) |
| 4 | #5 — On-Chain Signals | High-value, free-tier data; immediate RL state benefit |
| 5 | #6 — Derivatives Signals | Complements on-chain; high alpha for MARL agents |
| 6 | #11 — Sentiment Momentum | Needed for #12 (MARL state vector extension) |
| 7 | #12 — MARL State Vector | Ties together improved signals into agent decisions |
| 8 | #2 — Sarcasm Detection | Reduces false positives in social scoring |
| 9 | #3 — ABSA | Improves per-coin scoring from multi-coin posts |
| 10 | #13 — Feature Attribution | Explainability; builds operator trust |
| 11 | #15 — Event-Driven Ingest | Infrastructure; reduces latency spikes |
| 12 | #17 — Sentiment Backtesting | Validates signal quality quantitatively |
| 13 | #8 — TikTok/YouTube Quality | Speculative-asset short-term signal improvement |
| 14 | #4 — Multilingual Support | Global coverage; required for non-English markets |
| 15 | #7 — Commercial Provider Adapter | Best used as validation layer after local signals mature |
| 16 | #14 — Adversarial Hardening | Defensive; lower urgency once normalisation (#10) is in place |
| 17 | #16 — Drift Detection | MLOps maturity; important for production stability |
| 18 | #18 — Privacy / Compliance | Legal requirement; implement before any public/scaled deployment |
| 19 | #19 — Manipulation Alerts | Ethics/trust layer; completes the compliance story |
