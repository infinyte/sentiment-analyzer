# Sentiment Analyzer - Project Roadmap

This roadmap outlines the planned development path for Sentiment Analyzer. Timelines are estimates and subject to change based on community feedback and contributions.

---

## 📊 Current Status

**Phase:** Phase 3 Complete + Phase 5 Exchange Layer (partial) / Phase 4 Planned
**Latest Release:** v3.1.0
**Last Updated:** March 2026

---

## 🎯 Phase 1: Foundation + Advanced Intelligence (Completed ✅)

Core sentiment analysis platform with advanced trading intelligence.

### ✅ Completed Features

**Backend:**
- [x] Express.js REST API with 11 endpoints
- [x] CoinGecko market data integration (live prices, OHLCV history)
- [x] NewsAPI news aggregation (headlines per coin)
- [x] Claude API sentiment analysis (BULL/NEUTRAL/BEAR)
- [x] SQLite persistence (backtest results, sentiment cache survive restarts)
- [x] In-memory TTL caching layer (5-min coins, 24-hr sentiment, 15-min history)
- [x] Scheduled sentiment batch job (daily via node-cron)
- [x] Error handling throughout; NEUTRAL fallback on API errors
- [x] Health check endpoint with per-service status

**Advanced Intelligence (Phase 1 Enhancement):**
- [x] `SentimentAnalyzerEngine` — 4 analysis modes (BASIC / ADVANCED / TRADING_SIGNALS / SMART)
- [x] `TradingAgent` framework — RuleBased, MLBased, Hybrid agents + AgentFactory
- [x] 3 risk profiles — Conservative (1%), Aggressive (5%), Scalping (3%)
- [x] `BacktestingEngine` — day-by-day simulation, Sharpe ratio, max drawdown, equity curves
- [x] Slippage models — FIXED / VOLUME_BASED / MARKET_IMPACT
- [x] Coin ranking by composite SMART score

**Frontend:**
- [x] React 18 dashboard with coin cards and sentiment badges
- [x] Interactive detail modals with Chart.js price history chart
- [x] Sorting by market cap, volatility, sentiment
- [x] ESC / backdrop click to close modals
- [x] Polls `/api/coins` every 10 minutes

**Documentation:**
- [x] Architecture documentation (`SENTIMENT_ANALYZER_ARCHITECTURE.md`)
- [x] API endpoint specifications + cURL examples
- [x] Phase 1 detailed docs in `docs/phase1/`
- [x] Azure deployment guide
- [x] Contributing and testing guidelines

---

## 🚀 Phase 2: Multi-Agent Reinforcement Learning (Completed ✅)

Competitive multi-agent trading where AI agents compete for trading opportunities in a shared market environment.

### ✅ Completed Features

**MARL Competition Engine** (`services/marl-competition-engine.ts` — 1247 lines):
- [x] `SharedOrderBook` — price-time FIFO order matching with slippage calculation
- [x] `MarlTradingAgent` — Q-learning + epsilon-greedy exploration + experience replay
- [x] `PolicyNetwork` — feedforward neural net (50→64→32→5) in pure TypeScript
- [x] 3 tournament modes: SINGLE, EVOLUTIONARY (mutation + replacement), CONTINUOUS (live learning)
- [x] 3 risk profiles per agent: CONSERVATIVE, AGGRESSIVE, SCALPING
- [x] Equity evolution snapshots and competitor market impact tracking

**MARL API** (`routes/marl-competition.ts`):
- [x] `POST /api/marl/competition/start` — fire-and-forget; returns 202 + `competitionId`
- [x] `GET /api/marl/competition/:id/status` — real-time progress polling
- [x] `GET /api/marl/competition/:id/results` — full results (rankings, H2H, equity, impact)
- [x] `POST /api/marl/agents/compare` — N-round head-to-head comparison
- [x] `GET /api/marl/competitions` — list all competitions
- [x] `GET /api/marl/info` — static documentation

**Broker / Real Trading** (`routes/marl-real-trading.ts`):
- [x] `POST /api/marl/broker/credentials` — store AES-256-GCM encrypted broker credentials
- [x] `GET /api/marl/broker/credentials` — list metadata (no secrets)
- [x] `GET /api/marl/broker/credentials/picker` — unauthenticated id/label/provider/mode list for UI
- [x] `DELETE /api/marl/broker/credentials/:id` — remove stored credential
- [x] `POST /api/marl/broker/connect/:id` — decrypt + connect adapter into registry
- [x] `GET /api/marl/broker/connected` — list connected adapters
- [x] `GET /api/marl/broker/orders/:competitionId` — order audit trail
- [x] `POST /api/marl/broker/emergency-stop` — cancel all open orders

**Agent Identity & Stats** (`routes/agent-stats.ts`):
- [x] `GET /api/agents` — list active agents with pagination
- [x] `GET /api/agents/stats/leaderboard` — top agents by win rate
- [x] `GET /api/agents/:id` — single agent + stats
- [x] `PUT /api/agents/:id/customize` — update cosmetics (name, emoji, color, bio)
- [x] `GET /api/agents/:id/history` — competition history

**Evolutionary Orchestrator** (`services/evolutionary/`):
- [x] `EvolutionaryOrchestrator` — multi-generation loop: MARL → fitness → selection → crossover → mutation
- [x] `FitnessCalculator` — 0–100 composite score
- [x] `SelectionAlgorithm` — survival partitioning
- [x] `GeneticCrossover` — UNIFORM / BLENDED strategies
- [x] `MutationEngine` — LIGHT / MEDIUM / HEAVY severity
- [x] `GenomeManager` — SQLite-backed genome CRUD
- [x] `POST /api/evolutionary/tournament` — start multi-generation tournament
- [x] `GET /api/evolutionary/tournament` — list tournaments
- [x] `GET /api/evolutionary/tournament/:id` — full status + generation history
- [x] `GET /api/agents/:id/genome` + `GET /api/agents/:id/genealogy`
- [x] `evolutionary_tournaments` SQLite table

**Exchange Layer** (`services/exchange/`):
- [x] `ExchangeInterface` — shared `Order`, `Balance`, `PlaceOrderParams` types
- [x] `PaperExchange` — in-memory paper trading, no real orders
- [x] `CryptoComClient` — Crypto.com REST v2 with HMAC-SHA256 signing
- [x] `CryptoComExchange` — ExchangeInterface adapter (default provider)
- [x] `BinanceUSExchange` — ExchangeInterface adapter (opt-in via `TRADING_PROVIDER`)
- [x] `TradingService` — 4 safety guards: kill switch, max positions, position size cap, $1 min notional
- [x] `ExchangeFactory` — routes PAPER→PaperExchange, SANDBOX/LIVE→selected provider
- [x] `GET/POST /api/trading/*` — 5 REST endpoints for exchange status, price, balances, orders, stats

**MARL Frontend** (`components/MarlCompetitionViewer.tsx`):
- [x] Competition configuration form (mode, agents, symbols, duration, learning)
- [x] Trading mode selector (SIMULATED / PAPER / LIVE) with broker credential dropdown (auto-populated)
- [x] Real-time progress bar and status polling
- [x] Final rankings table, head-to-head metrics, competitor impact table
- [x] Equity evolution chart (multi-agent Chart.js line chart)
- [x] Agent head-to-head comparison form and results

See [`docs/phase2/`](./docs/phase2/) for full specification and game theory analysis.

---

## 📡 Phase 3: Social Media Intelligence (Completed ✅)

Multi-source social scraping, normalized scoring, trending topic discovery, and a dedicated Social Intel frontend tab.

### ✅ Completed Features

**Scraper Suite** (`services/social-media/scraper/`):
- [x] 7-source scraper suite: `TwitterScraper`, `RedditScraper`, `RssScraper`, `DiscordScraper`, `TelegramScraper`, `YouTubeScraper`, `TikTokScraper`
- [x] `ScrapeManager` orchestrates parallel coin-filtered fetches and bulk background refresh
- [x] Deduplication and per-source rate limiting

**Scoring Pipeline** (`services/social-media/scoring/`):
- [x] `CoinExtractor` — 55-coin dictionary with `$BTC`/`#BTC`/name detection
- [x] `ItemScorer` — 4-signal pipeline: sentiment 30%, engagement 25%, authority 25%, recency 20%
- [x] Platform-specific engagement weights; source authority baselines (rss=75, youtube=65, twitter=45, discord=40, reddit=35, telegram=30, tiktok=25)

**Trending & Discovery** (`services/social-media/trending/`):
- [x] `TrendingDiscoveryEngine` — cross-source entity aggregation, velocity vs prior window, composite rank weighting
- [x] `MultiSourceTrendCalculator` — per-symbol `MultiSourceTrendReport` with direction, strength, velocity, sentiment distribution, historical comparison, and acceleration detection

**SQLite Social Store** (`services/social-media/database/sqlite-social-store.ts`):
- [x] 4 tables: `social_media_items`, `trending_topics`, `trending_topic_history`, `source_metadata`
- [x] Cursor-based pagination via base64url-encoded payloads
- [x] Bulk upsert via transactions; `pruneOldItems`, `resetDailyCounters`, `getStats`

**Social Media API** (6 Phase 3 endpoints):
- [x] `GET /api/social-media/trending-topics`
- [x] `GET /api/social-media/items`
- [x] `GET /api/social-media/item/:id`
- [x] `GET /api/social-media/stats`
- [x] `GET /api/trending-score/:symbol`
- [x] `POST /api/social-media/refresh`

**Telemetry:**
- [x] `AppInsightsTransport` — Winston transport batching events to Azure Application Insights REST API; no extra npm deps; enabled via `APPLICATIONINSIGHTS_CONNECTION_STRING`

**Scheduled Jobs:**
- [x] Hourly social scrape cron: RSS + Discord + Telegram bulk, Twitter + Reddit per-coin for top 10, `discoverTrends()`, prune old items
- [x] Midnight cron: `socialStore.resetDailyCounters()`

**Frontend Social Intel Tab:**
- [x] `SocialDashboard` component: trending topics table, trend score panel, items feed with filters, source health table

**Tests:**
- [x] 567 backend Jest tests across 36 suites (unit + integration; includes exchange, trading service, evolutionary, MARL, social media, API routes)
- [x] 36 frontend Vitest tests across 3 suites

---

## 📋 Phase 4: Enhanced Analytics

Add interactive charting, user accounts, and advanced analysis features.

### 🔄 In Progress

- [ ] **Interactive Price Charts**
  - TradingView Lightweight Charts integration
  - Support for multiple timeframes (1h, 4h, 1d, 1w)
  - Technical indicators (MA, EMA, RSI, MACD)
  - Volume and volatility overlays
  - Zoom and pan functionality
  - Estimated effort: 2-3 weeks

- [ ] **User Accounts & Authentication**
  - User registration and login
  - JWT token authentication
  - Email verification
  - Password reset functionality
  - User profile management
  - Estimated effort: 3 weeks

- [ ] **Watchlist Feature**
  - Create custom watchlists
  - Save favorite coins
  - Sync across devices
  - Share watchlists with others
  - Estimated effort: 1-2 weeks

- [ ] **Price Alerts & Notifications**
  - Set price targets (above/below)
  - Email notifications
  - In-app notifications
  - Alert history and management
  - Estimated effort: 2 weeks

### 📋 Planned Features

- [ ] **Advanced Sentiment Indicators**
  - Sentiment trend visualization (7-day history)
  - Confidence score trending
  - Consensus vs. outlier detection
  - Estimated effort: 1 week

- [ ] **Multi-Timeframe Analysis**
  - 1-hour to 1-month sentiment analysis
  - Short-term vs. long-term divergence alerts
  - Estimated effort: 1-2 weeks

- [ ] **Competitor Sentiment Comparison**
  - Compare sentiment across similar coins
  - Market positioning analysis
  - Estimated effort: 1 week

### Dependencies

Requires:
- Azure Cosmos DB (for user data)
- SendGrid or similar (for email notifications)
- JWT library for authentication

### Success Metrics

- User account creation rate > 10/day
- Alert trigger rate > 100/day
- Chart page load time < 2 seconds
- 95% email delivery rate

---

## 🔗 Phase 5: Exchange Integration

Enable live trading and portfolio tracking.

### ✅ Completed (Foundation)

- [x] **Exchange API Integration** (partial)
  - Crypto.com REST v2 adapter (default) with HMAC-SHA256 auth
  - Binance.US adapter (opt-in via `TRADING_PROVIDER=binance-us`)
  - Coinbase + Binance adapters for MARL layer
  - AES-256-GCM encrypted credential storage (`BROKER_MASTER_KEY`)
  - Paper trading mode via `PaperExchange` (in-memory, zero risk)

- [x] **Risk Management** (core guards)
  - `TradingService`: kill switch (max loss %), max open positions, position size cap, $1 minimum notional
  - SELL orders bypass kill switch; only BUY orders blocked on loss threshold
  - `RiskManager` for MARL layer: kill switch, daily-loss limit, order-size guard

- [x] **Trade Execution** (foundation)
  - `POST /api/trading/order` — places orders through TradingService safety guards
  - Order audit trail via `GET /api/marl/broker/orders/:competitionId`
  - Emergency stop: `POST /api/marl/broker/emergency-stop`

### 📋 Remaining Planned Features

- [ ] **Portfolio Tracker**
  - Import holdings from exchange
  - Real-time P&L calculation
  - Historical performance charts
  - Tax reporting tools
  - Estimated effort: 2-3 weeks

- [ ] **Extended Exchange Support**
  - Kraken, additional providers
  - Portfolio data synchronization
  - Estimated effort: 2-3 weeks

### Security Considerations

- ✅ Encrypted API key storage (AES-256-GCM)
- ✅ Audit logging for all trades
- ✅ Rate limiting on order placement
- ✅ Paper trading mode for testing
- [ ] Two-factor authentication (2FA)
- [ ] Full order history UI

### Success Metrics

- 100+ active trading users
- Average portfolio size tracked: $50K+
- Trade execution success rate > 99%
- System uptime > 99.5%

---

## 🧠 Phase 6: Machine Learning

Advanced ML-based sentiment scoring and prediction models.

### Planned Features

- [ ] **Custom ML Sentiment Model**
  - Train on historical crypto sentiment data
  - Support for multiple languages
  - Context-aware sentiment (on-chain vs. social)
  - Confidence scoring improvements
  - Estimated effort: 6-8 weeks

- [ ] **Price Prediction Model**
  - 24-hour price movement prediction
  - Confidence intervals
  - Feature importance analysis
  - Estimated effort: 4-6 weeks

- [ ] **Anomaly Detection**
  - Unusual volume spikes detection
  - Sentiment divergence alerts
  - Whale transaction monitoring
  - Estimated effort: 2-3 weeks

- [ ] **Backtesting Engine**
  - Historical sentiment vs. price correlation
  - Strategy backtesting with real data
  - Performance metrics and reports
  - Estimated effort: 3-4 weeks

### Data Requirements

- 2+ years of historical data
- On-chain metrics (from Glassnode, CryptoQuant)
- Social sentiment data (Twitter, Reddit, Discord)
- Traditional market correlations

### Success Metrics

- Model prediction accuracy > 60%
- Backtested ROI > 15% annualized
- Model inference time < 100ms
- User confidence score > 4/5

---

## 🌍 Phase 7: Community & Scaling

Community features, mobile apps, and global expansion.

### Planned Features

- [ ] **Community Features**
  - Signal sharing platform
  - User-generated watchlists
  - Trading group creation
  - Discussion forums
  - Leaderboards
  - Estimated effort: 4-6 weeks

- [ ] **Mobile Apps**
  - iOS app (React Native)
  - Android app (React Native)
  - Push notifications
  - Offline mode
  - Estimated effort: 10-12 weeks

- [ ] **Advanced Analytics Dashboard**
  - Custom indicators
  - Multi-asset correlation
  - Risk-adjusted returns
  - Heatmaps and flow analysis
  - Estimated effort: 4-6 weeks

- [ ] **API for Third Parties**
  - Public API with rate limits
  - Webhooks for alerts
  - Partner integrations
  - Marketplace for indicators
  - Estimated effort: 3-4 weeks

- [ ] **Internationalization**
  - Multi-language support (12+ languages)
  - Localized sentiment analysis
  - Regional market insights
  - Estimated effort: 2-3 weeks

### Infrastructure Scaling

- Migrate to Cosmos DB (global replication)
- Add Azure CDN for frontend
- Implement caching layer (Redis)
- Database optimization and indexing
- Load testing and performance tuning

---

## 📋 Ongoing Maintenance

### Regular Tasks

- [ ] **Security Updates**
  - Dependency updates (weekly)
  - Security audits (quarterly)
  - Penetration testing (semi-annual)

- [ ] **Performance Optimization**
  - Database query optimization
  - API response time tracking
  - Frontend bundle size monitoring
  - CDN effectiveness metrics

- [ ] **Documentation**
  - API documentation updates
  - User guides and tutorials
  - Video walkthrough creation
  - FAQ expansion

- [ ] **Community Support**
  - GitHub issue response (< 24 hrs)
  - Discussion forum moderation
  - User feedback incorporation
  - Community event hosting

---

## 🤝 Contributing to Roadmap

### How to Help

**Want to contribute?** Here are ways you can help:

1. **Pick a Phase 4 Task**
   - Charts: TradingView integration
   - Auth: User accounts and authentication
   - Notifications: Price alerts system

2. **Improve Earlier Phases**
   - Write unit tests (low effort, high value)
   - Improve error handling
   - Enhance documentation
   - Add new data sources

3. **Research Phase 6**
   - Evaluate ML frameworks
   - Collect training data
   - Prototype models
   - Performance benchmarking

### How to Request Features

1. Check existing [GitHub Issues](https://github.com/yourusername/sentiment-analyzer/issues)
2. Open a [Feature Request](https://github.com/yourusername/sentiment-analyzer/issues/new?template=feature_request.md)
3. Provide:
   - Clear problem statement
   - Proposed solution
   - Use cases
   - Implementation ideas

### Voting on Features

React with 👍 on feature requests to indicate interest. Roadmap priorities consider community voting.

---

## 📊 Success Metrics by Phase

### Phase 1 (Completed)
- ✅ Codebase complete
- ✅ Documentation comprehensive
- ✅ Can deploy to Azure
- ✅ ~50 coin sentiment analysis
- ✅ < $15/month operational cost

### Phase 2 (Completed)
- ✅ MARL Competition Engine (SINGLE/EVOLUTIONARY/CONTINUOUS modes)
- ✅ SharedOrderBook with slippage, Q-learning agents, policy networks
- ✅ 6 MARL API endpoints
- ✅ Full MARL React UI with real-time polling and equity charts

### Phase 3 (Completed)
- ✅ 7-source scraper suite
- ✅ 4-signal social scoring pipeline
- ✅ SQLite social store (4 tables, cursor pagination)
- ✅ Trending topic discovery with velocity
- ✅ Multi-source trend report with historical comparison
- ✅ Application Insights telemetry transport
- ✅ Frontend Social Intel tab
- ✅ Active Sources count fix (per-source items_24h computed from social_media_items table)

### Phase 2 Additions (Completed alongside Phase 3)
- ✅ Broker credentials (encrypted storage, Alpaca adapter, emergency stop)
- ✅ Agent identity + cosmetics + leaderboard (SQLite-backed)
- ✅ EvolutionaryOrchestrator: genome evolution across multi-generation MARL tournaments
- ✅ CryptoComExchange + TradingService with 4 safety guards
- ✅ Broker credential dropdown in MarlCompetitionViewer (auto-populated from API)
- ✅ 567 backend tests across 36 suites, 36 frontend tests across 3 suites

### Phase 4 (Planned)
- 🎯 Trading volume > $1M/month
- 🎯 Portfolio value tracked > $100M
- 🎯 User retention > 40%
- 🎯 Premium tier adoption > 10%

### Phase 5 (Planned)
- 🎯 100+ active trading users
- 🎯 Average portfolio size tracked: $50K+
- 🎯 Trade execution success rate > 99%
- 🎯 System uptime > 99.5%

### Phase 6 (Planned)
- 🎯 Model prediction accuracy > 60%
- 🎯 Backtested ROI > 15% annually
- 🎯 ML feature adoption > 50%
- 🎯 Community-contributed models > 5

### Phase 7 (Planned)
- 🎯 Global users > 10K
- 🎯 Mobile downloads > 50K
- 🎯 API partners > 20
- 🎯 Community size > 1K users

---

## 🗓️ Timeline Estimate

```
2026 Q1 ✅ Phase 1: Foundation + Advanced Intelligence
2026 Q1 ✅ Phase 2: MARL Competitive Framework
2026 Q1 ✅ Phase 3: Social Media Intelligence
2026 Q2  → Phase 4: Enhanced Analytics (interactive charts, user accounts, alerts)
2026 Q4  → Phase 5: Exchange Integration (Binance, Kraken, Coinbase)
2027 Q2  → Phase 6: Machine Learning (custom sentiment model, price prediction)
2027+    → Phase 7: Community & Scaling
```

**Note:** Timeline is flexible and depends on:
- Community contributions
- Funding/resources
- Priority feedback
- Technical challenges

---

## 💰 Funding & Resources

### Current Status
- ✅ Open source (no funding needed)
- ✅ Minimal cloud costs (~$15/month)
- ✅ No external dependencies

### If Phase 4+ Proceeds
May require:
- Infrastructure scaling ($1K-5K/month)
- ML compute resources ($2K-10K/month)
- Team hiring (if community interest warrants)
- Potential funding rounds

---

## 🔮 Long-Term Vision

**Sentiment Analyzer Goal:** Become the **leading open-source platform for crypto sentiment analysis and AI-driven trading intelligence**.

**5-Year Vision:**
- Used by 50K+ traders and investors
- Integrated with major exchanges
- Cutting-edge ML models
- Thriving developer community
- Sustainable business model (if needed)

---

## 📞 Get Involved

- **Code:** Pick an item from Phase 4-6
- **Design:** Improve UI/UX
- **Data:** Contribute training datasets
- **Research:** Help with ML models
- **Docs:** Improve guides and examples
- **Testing:** Find and report bugs
- **Community:** Help others and share knowledge

---

**Questions about the roadmap?**
Open an issue or join the discussion forum!

**Last Updated:** March 2026
**Next Review:** June 2026
