# Sentiment Analyzer - Altcoin Trading Intelligence Platform

## Executive Summary

A full-stack sentiment analysis and market intelligence platform that aggregates crypto market data, performs web-based sentiment analysis using Claude AI, and surfaces actionable trading insights through an interactive dashboard. Deployed on Azure Free Tier with hybrid refresh strategy: **real-time market data (5-15 min) + daily sentiment analysis + server-side orchestration**.

---

## 1. System Architecture

### 1.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    REACT FRONTEND (Azure App Service)            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Coin Dashboard Grid                                      │   │
│  │  - Color-coded sentiment indicators (🟢 🟡 🔴)           │   │
│  │  - 7-day trend sparklines                                 │   │
│  │  - Price change % + volatility metrics                    │   │
│  │  - Summary outlook text                                   │   │
│  │  - Click → Detail view in modal/new tab                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           ↕ HTTPS
┌─────────────────────────────────────────────────────────────────┐
│              NODE.JS/EXPRESS BACKEND (Azure App Service)         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  API Routes                                               │   │
│  │  - GET /api/coins          (aggregated coin snapshots)   │   │
│  │  - GET /api/coins/:symbol  (detail + historical)         │   │
│  │  - GET /api/sentiment/:symbol (cached sentiment data)    │   │
│  │  - POST /api/refresh-sentiment (trigger daily job)       │   │
│  │  - GET /api/health        (monitoring)                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Scheduled Tasks (Node-Cron)                             │   │
│  │  - Every 10 min: Fetch market data from CoinGecko        │   │
│  │  - Every 10 min: Fetch trending topics (NewsAPI)         │   │
│  │  - Daily @ 2 AM UTC: Trigger sentiment analysis batch    │   │
│  │  - Store snapshots → Table Storage                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Sentiment Analysis Engine (Claude AI)                   │   │
│  │  - Batch process top 20-50 coins daily                   │   │
│  │  - Score: Bull (🟢), Neutral (🟡), Bear (🔴)             │   │
│  │  - Extract key catalysts & risks from web sources        │   │
│  │  - Cache results 24 hours                                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    ↕ (Multiple Data Sources)
    ┌───────────────┬───────────────┬─────────────────┐
    ↓               ↓               ↓
┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
│ CoinGecko   │ │ NewsAPI      │ │ Claude API      │
│ (Free API)  │ │ (Free tier)  │ │ (Pay-per-call)  │
│             │ │              │ │                 │
│ - Market    │ │ - Headlines  │ │ - Sentiment     │
│   data      │ │ - Trending   │ │   analysis      │
│ - OHLCV     │ │   topics     │ │ - Catalyst ID   │
│ - Metadata  │ │              │ │ - Risk factors  │
└─────────────┘ └──────────────┘ └─────────────────┘
        ↓               ↓               ↓
    ┌──────────────────────────────────────────┐
    │      AZURE TABLE STORAGE (Time-Series)   │
    │  ┌──────────────────────────────────────┐│
    │  │ Partition: CoinSymbol-YYYY-MM-DD    ││
    │  │ Row: HH:MM timestamp                ││
    │  │ Data: {price, volume, sentiment,    ││
    │  │        headline_count, volatility}   ││
    │  └──────────────────────────────────────┘│
    │  ┌──────────────────────────────────────┐│
    │  │ Sentiment Cache Table                ││
    │  │ Partition: SYMBOL                    ││
    │  │ Row: YYYY-MM-DD                      ││
    │  │ Data: {score, summary, catalysts}    ││
    │  └──────────────────────────────────────┘│
    └──────────────────────────────────────────┘
```

### 1.2 Component Breakdown

| Component | Technology | Purpose | Azure Resource |
|-----------|-----------|---------|-----------------|
| **Frontend** | React 18 + TypeScript | Interactive UI, real-time updates via polling | App Service (B1) |
| **Backend** | Node.js + Express | API routes, data orchestration, cron jobs | App Service (B1) |
| **Market Data** | CoinGecko API | Real-time OHLCV, metadata (top 100-200 coins) | External API |
| **Headlines** | NewsAPI | Trending crypto topics, sentiment context | External API |
| **Sentiment Analysis** | Claude API | Advanced NLP sentiment + catalyst extraction | External API |
| **Time-Series DB** | Azure Table Storage | Cheap, scalable coin snapshots & sentiment history | Storage Account |
| **Caching** | Node-Cache (in-memory) | Reduce API calls, cache sentiment 24h | Backend Memory |
| **Monitoring** | Application Insights | Logs, performance metrics, alerts | Insights |

---

## 2. Data Models

### 2.1 Coin Snapshot (Real-Time, Stored Every 10 min)

```typescript
interface CoinSnapshot {
  id: string;                          // e.g., "bitcoin", "ethereum"
  symbol: string;                      // e.g., "BTC", "ETH"
  name: string;                        // e.g., "Bitcoin"
  
  // Market Data
  price_usd: number;
  market_cap_usd: number;
  volume_24h_usd: number;
  price_change_24h_percent: number;
  price_change_7d_percent: number;
  
  // Volatility Metrics
  volatility_24h: number;              // std dev of hourly returns
  volatility_7d: number;
  rsi_14: number;                      // Relative Strength Index (optional)
  
  // Sentiment Data (cached from daily run)
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';  // Color coding
  sentiment_confidence: number;         // 0-1
  sentiment_summary: string;           // "Strong bullish momentum from..."
  
  // News Context
  trending_score: number;              // Count of headlines in last 24h
  headline_sample: string[];           // Top 3 headlines
  
  // Metadata
  timestamp: Date;
  source: 'coingecko';
  market_rank: number;
}
```

### 2.2 Sentiment Analysis Result (Cached Daily)

```typescript
interface SentimentAnalysis {
  symbol: string;
  analysis_date: string;               // YYYY-MM-DD
  
  // Claude-generated insights
  sentiment_score: 'BULL' | 'NEUTRAL' | 'BEAR';
  confidence: number;                  // 0-1
  
  // Detailed breakdown
  summary: string;                     // 1-2 sentence overview
  key_catalysts: string[];             // ["Upcoming ETF approval", "Dev activity up 30%"]
  risk_factors: string[];              // ["High volatility", "Regulatory uncertainty"]
  
  // Raw data used for analysis
  sources_analyzed: number;            // Count of articles/posts
  data_range: { start: Date; end: Date };
  
  // Recommendations
  short_term_outlook: string;          // "Likely to trend up due to..."
  volatility_warning: boolean;         // High instability flag
  
  // Metadata
  generated_at: Date;
  model: 'claude-opus' | 'claude-sonnet';
  tokens_used: number;
}
```

### 2.3 Detail Report (Full Historical Context)

```typescript
interface DetailReport {
  coin: CoinSnapshot;
  sentiment_today: SentimentAnalysis;
  
  // Historical 7-day time series
  price_history: {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  
  // Sentiment trend
  sentiment_history: {
    date: string;
    score: 'BULL' | 'NEUTRAL' | 'BEAR';
    confidence: number;
  }[];
  
  // News timeline
  recent_articles: {
    title: string;
    url: string;
    source: string;
    published_at: Date;
    sentiment: 'positive' | 'neutral' | 'negative';
  }[];
  
  // Metrics
  volatility_trend: number[];          // Last 7 days
  volume_trend: number[];
  
  // Visualization data for chart
  chart_ready: true;
}
```

---

## 3. Refresh Strategy & Scheduling

### 3.1 Data Refresh Timeline

```
EVERY 10 MINUTES:
├─ CoinGecko API call → top 50-100 coins
│  └─ Extract: price, volume, 24h/7d change, market cap
│  └─ Store snapshot → Table Storage
│
├─ NewsAPI query → "Bitcoin", "Ethereum", trending altcoins
│  └─ Aggregate headlines count per coin
│  └─ Cache 3-5 top headlines per coin
│
└─ Calculate volatility metrics
   └─ RMA of price returns (use 10-min snapshots)
   └─ Update in-memory cache

DAILY @ 02:00 UTC (configurable):
├─ Retrieve past 3-7 days of articles for top 50 coins
├─ BATCH CALL to Claude API (efficient):
│  └─ Sentiment analysis for each coin
│  └─ Extract catalysts + risks
│  └─ Generate short-term outlook
│
└─ Store results → Sentiment Cache Table
   └─ 24-hour TTL before next refresh
```

### 3.2 Cost Estimation (Azure Free Tier)

| Operation | Frequency | Cost | Notes |
|-----------|-----------|------|-------|
| CoinGecko API | 6/hour (every 10 min) | $0 | Free tier |
| NewsAPI | 6/hour | $0 | Free tier (500 req/day) |
| Claude API | 1x daily (batch 50 coins) | ~$0.20-0.50/day | ~$6-15/month |
| Table Storage reads | ~100K/month | $0 | First 1M ops free |
| Table Storage writes | ~25K/month | $0 | First 1M ops free |
| App Service | Continuous | $0 | B1 free tier (1 instance) |
| **Monthly Total** | | **~$6-15** | Minimal cost |

---

## 4. API Endpoints Specification

### 4.1 Core Routes

#### **GET /api/coins**
Retrieve list of top coins with current snapshots and cached sentiment.

```
Query Parameters:
  - limit: number (default: 50, max: 200)
  - sort_by: 'market_cap' | 'volatility' | 'sentiment' | 'price_change' (default: market_cap)
  - sentiment_filter: 'BULL' | 'NEUTRAL' | 'BEAR' | 'all' (default: all)

Response: 200 OK
{
  "data": [
    {
      "id": "bitcoin",
      "symbol": "BTC",
      "name": "Bitcoin",
      "price_usd": 43250.50,
      "price_change_24h_percent": 2.34,
      "price_change_7d_percent": 5.67,
      "sentiment_score": "BULL",
      "sentiment_confidence": 0.87,
      "sentiment_summary": "Positive momentum from institutional adoption...",
      "volatility_24h": 2.1,
      "trending_score": 127,  // headline count
      "timestamp": "2024-03-16T10:45:00Z"
    },
    // ... more coins
  ],
  "last_updated": "2024-03-16T10:45:00Z",
  "cache_age_minutes": 2
}
```

#### **GET /api/coins/:symbol**
Fetch detailed report for a specific coin (6 historical data + chart).

```
Path Parameters:
  - symbol: string (e.g., "BTC", "ETH")

Query Parameters:
  - days: number (default: 7, max: 30)

Response: 200 OK
{
  "coin": { ...CoinSnapshot },
  "sentiment_today": { ...SentimentAnalysis },
  "price_history": [
    { "timestamp": "...", "open": 43000, "high": 43500, "low": 42900, "close": 43250, "volume": 28e9 },
    // ... 7 days of OHLCV
  ],
  "sentiment_history": [
    { "date": "2024-03-16", "score": "BULL", "confidence": 0.87 },
    // ... past 7 days
  ],
  "recent_articles": [
    { "title": "Bitcoin ETF approval...", "url": "...", "source": "Reuters", "published_at": "...", "sentiment": "positive" },
    // ... top 10
  ],
  "volatility_trend": [1.8, 2.1, 2.3, 2.0, 1.9, 2.2, 2.1],
  "recommendations": {
    "short_term": "Watch for breakout above $43,500...",
    "risk_level": "MODERATE",
    "volatility_warning": false
  }
}
```

#### **GET /api/sentiment/:symbol**
Get cached sentiment data without full detail report.

```
Response: 200 OK
{
  "symbol": "BTC",
  "analysis_date": "2024-03-16",
  "sentiment_score": "BULL",
  "confidence": 0.87,
  "summary": "Strong bullish momentum...",
  "key_catalysts": ["Institutional adoption", "Technical breakout"],
  "risk_factors": ["Regulatory headwinds"],
  "volatility_warning": false,
  "cached_at": "2024-03-16T02:00:00Z"
}
```

#### **POST /api/refresh-sentiment**
Manually trigger sentiment analysis (admin/scheduled task only).

```
Headers: Authorization: Bearer <SECRET_TOKEN>

Body:
{
  "symbols": ["BTC", "ETH", "SOL"],  // specific coins, or null for all top 50
  "force_refresh": false             // ignore cache
}

Response: 202 Accepted
{
  "job_id": "job_abc123",
  "status": "queued",
  "coins_to_process": 3,
  "estimated_completion": "2024-03-16T02:15:00Z"
}
```

#### **GET /api/health**
Monitoring endpoint for Azure Application Insights.

```
Response: 200 OK
{
  "status": "healthy",
  "services": {
    "coingecko": "ok",
    "newsapi": "ok",
    "claude_api": "ok",
    "table_storage": "ok"
  },
  "last_market_update": "2024-03-16T10:45:00Z",
  "last_sentiment_update": "2024-03-16T02:00:00Z",
  "uptime_hours": 24.5
}
```

---

## 5. Sentiment Analysis Prompt Engineering

### 5.1 Claude Batch Prompt (Daily)

The sentiment engine processes 3-7 days of collected headlines/articles per coin:

```
System Prompt:
You are an expert cryptocurrency market analyst specializing in sentiment analysis.
Your task is to analyze collected market data and news for a specific cryptocurrency
and provide a structured sentiment assessment.

You will classify sentiment as:
- BULL: Strong positive indicators suggesting upward price pressure
- NEUTRAL: Mixed signals or insufficient catalysts
- BEAR: Negative indicators suggesting downward pressure or risk

Provide actionable insights for a trading dashboard.

---

User Prompt (per coin):
Analyze the following data for [SYMBOL]:

RECENT NEWS HEADLINES (past 7 days):
1. "Bitcoin ETF approval expected in Q2" - Reuters
2. "Regulatory crackdown concerns..." - Bloomberg
3. "Network upgrades improve scalability" - TechCrunch

MARKET METRICS:
- Price change (7d): +8.5%
- Volatility (24h): 2.1%
- Trading volume: +15% vs avg
- Network activity: +22% address growth

SOCIAL SENTIMENT:
- Twitter mentions: +45%
- Reddit discussion score: 0.72/1.0

Please provide:
1. SENTIMENT_SCORE: [BULL|NEUTRAL|BEAR]
2. CONFIDENCE: [0.5-1.0]
3. SUMMARY: [1-2 sentences max]
4. KEY_CATALYSTS: [List 2-4 bullish factors]
5. RISK_FACTORS: [List 2-3 concerns]
6. SHORT_TERM_OUTLOOK: [1-2 sentence forecast for next 24-48h]
7. VOLATILITY_WARNING: [true|false] - is this coin unstable?
```

---

## 6. Frontend Architecture

### 6.1 React Component Hierarchy

```
App
├─ Layout
│  ├─ Header (Anthropic branding, refresh status)
│  └─ Navigation (Dashboard, Settings, About)
│
├─ Dashboard (Main View)
│  ├─ FilterBar (Sentiment filter, sort options, date range)
│  ├─ CoinGrid
│  │  └─ CoinCard (repeating)
│  │     ├─ Coin name + symbol
│  │     ├─ Price + 7d chart sparkline
│  │     ├─ Sentiment badge (🟢 🟡 🔴 with confidence %)
│  │     ├─ Key metrics (vol, volatility, trending score)
│  │     ├─ Summary text ("Strong bullish...")
│  │     └─ [CLICK] → DetailModal
│  │
│  └─ LastUpdated (timestamp + next refresh countdown)
│
├─ DetailModal / DetailPage
│  ├─ CoinHeader (name, symbol, current price)
│  ├─ SentimentSummary
│  │  ├─ Score badge + confidence bar
│  │  ├─ Key catalysts chips
│  │  ├─ Risk factors chips
│  │  └─ Volatility warning alert
│  │
│  ├─ InteractiveChart (TradingViewLite or Chart.js)
│  │  ├─ OHLCV candlestick (7 days)
│  │  ├─ Volume bars
│  │  ├─ MA/EMA overlays (optional)
│  │  └─ Zoom/pan controls
│  │
│  ├─ Tabs
│  │  ├─ Overview (recommendations, outlook)
│  │  ├─ Sentiment History (7-day sentiment trend + chart)
│  │  ├─ News Timeline (articles + sentiment tags)
│  │  └─ Metrics (volatility, volume trends)
│  │
│  └─ Actions (Set alert, export report, visit exchange)
│
└─ Settings / Admin
   ├─ Refresh interval config
   ├─ Coin watchlist management
   ├─ Notification preferences
   └─ API usage monitoring

```

### 6.2 Styling & Color Scheme

```css
/* Sentiment Colors */
--sentiment-bull: #10b981;    /* Green */
--sentiment-neutral: #f59e0b; /* Amber */
--sentiment-bear: #ef4444;    /* Red */

/* Neutral Palette (Anthropic-inspired) */
--primary: #1f2937;           /* Dark gray */
--secondary: #6b7280;         /* Medium gray */
--accent: #3b82f6;            /* Blue (highlights) */
--background: #f9fafb;        /* Off-white */
--border: #e5e7eb;            /* Light gray border */

/* Responsive Grid */
--grid-cols-mobile: 1;
--grid-cols-tablet: 2;
--grid-cols-desktop: 3;
--grid-cols-wide: 4;
```

---

## 7. Backend Implementation Checklist

### 7.1 Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.2",
    "node-cron": "^3.0.3",
    "node-cache": "^5.1.2",
    "@azure/data-tables": "^13.2.1",
    "@azure/identity": "^3.3.2",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "winston": "^3.11.0",
    "anthropic": "^0.13.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.10.6",
    "@types/express": "^4.17.21",
    "ts-node": "^10.9.2",
    "nodemon": "^3.0.2"
  }
}
```

### 7.2 Project Structure

```
sentiment-analyzer/
├─ backend/
│  ├─ src/
│  │  ├─ index.ts                 (Express app entry)
│  │  ├─ config/
│  │  │  ├─ env.ts               (environment validation)
│  │  │  └─ logger.ts            (Winston setup)
│  │  │
│  │  ├─ routes/
│  │  │  ├─ coins.ts             (GET /api/coins, /api/coins/:symbol)
│  │  │  ├─ sentiment.ts         (GET /api/sentiment/:symbol)
│  │  │  ├─ admin.ts             (POST /api/refresh-sentiment)
│  │  │  └─ health.ts            (GET /api/health)
│  │  │
│  │  ├─ services/
│  │  │  ├─ coingecko.service.ts (CoinGecko API client)
│  │  │  ├─ newsapi.service.ts   (NewsAPI client)
│  │  │  ├─ sentiment.service.ts (Claude API orchestration)
│  │  │  ├─ storage.service.ts   (Table Storage CRUD)
│  │  │  └─ cache.service.ts     (In-memory caching layer)
│  │  │
│  │  ├─ jobs/
│  │  │  ├─ marketDataJob.ts     (Every 10 min)
│  │  │  ├─ newsJob.ts           (Every 10 min)
│  │  │  └─ sentimentJob.ts      (Daily @ 2 AM)
│  │  │
│  │  ├─ models/
│  │  │  ├─ coin.model.ts        (TypeScript interfaces)
│  │  │  ├─ sentiment.model.ts
│  │  │  └─ report.model.ts
│  │  │
│  │  ├─ utils/
│  │  │  ├─ volatility.ts        (Volatility calculations)
│  │  │  ├─ validators.ts        (Input validation)
│  │  │  └─ transformers.ts      (Data shape transformations)
│  │  │
│  │  └─ middleware/
│  │     ├─ errorHandler.ts
│  │     ├─ requestLogger.ts
│  │     └─ auth.ts              (API key validation)
│  │
│  ├─ .env.example
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ Dockerfile                 (For containerization)
│
├─ frontend/
│  ├─ src/
│  │  ├─ index.tsx
│  │  ├─ App.tsx
│  │  ├─ components/
│  │  │  ├─ Layout/
│  │  │  ├─ Dashboard/
│  │  │  ├─ CoinCard/
│  │  │  ├─ DetailModal/
│  │  │  ├─ Chart/
│  │  │  └─ common/
│  │  │
│  │  ├─ pages/
│  │  │  ├─ DashboardPage.tsx
│  │  │  └─ DetailPage.tsx
│  │  │
│  │  ├─ services/
│  │  │  ├─ api.client.ts        (HTTP client)
│  │  │  └─ useCoins.ts          (React hook)
│  │  │
│  │  ├─ styles/
│  │  │  ├─ globals.css
│  │  │  └─ variables.css
│  │  │
│  │  └─ types/
│  │     └─ index.ts             (Shared TypeScript types)
│  │
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vite.config.ts
│  └─ index.html
│
├─ .github/
│  └─ workflows/
│     └─ deploy.yml              (CI/CD for Azure)
│
├─ docker-compose.yml            (Local dev environment)
├─ README.md
└─ DEPLOYMENT.md                 (Azure setup guide)
```

---

## 8. Environment Variables

### 8.1 Backend `.env` Template

```bash
# Server
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://yourdomain.azurewebsites.net

# Azure
AZURE_STORAGE_ACCOUNT_NAME=sentimentanalyzer
AZURE_STORAGE_ACCOUNT_KEY=<key>
AZURE_STORAGE_CONNECTION_STRING=<connection>

# External APIs
COINGECKO_API_KEY=            # Optional (free tier)
NEWSAPI_API_KEY=<key>         # From newsapi.org
CLAUDE_API_KEY=<key>          # From Anthropic

# Sentiment Analysis
SENTIMENT_BATCH_SIZE=50       # Coins per daily batch
SENTIMENT_JOB_CRON="0 2 * * *" # Daily @ 2 AM UTC
SENTIMENT_CACHE_TTL_HOURS=24

# Market Data Refresh
MARKET_REFRESH_INTERVAL_MINUTES=10
TOP_COINS_LIMIT=100           # Fetch top N coins

# Security
API_SECRET_KEY=<generated>    # For /refresh-sentiment admin endpoint
ALLOWED_ORIGINS=https://yourdomain.azurewebsites.net

# Logging
LOG_LEVEL=info
APPINSIGHTS_INSTRUMENTATION_KEY=<key>
```

---

## 9. Deployment Strategy (Azure Free Tier)

### 9.1 Resource Setup

```bash
# Create Resource Group
az group create --name sentiment-analyzer-rg --location eastus

# Create Storage Account
az storage account create \
  --name sentimentanalyzer \
  --resource-group sentiment-analyzer-rg \
  --location eastus \
  --sku Standard_LRS

# Create App Service Plan (Free tier)
az appservice plan create \
  --name sentiment-analyzer-plan \
  --resource-group sentiment-analyzer-rg \
  --sku FREE

# Create Web App (Backend)
az webapp create \
  --resource-group sentiment-analyzer-rg \
  --plan sentiment-analyzer-plan \
  --name sentiment-api-app
  --runtime "node|18-lts"

# Create Web App (Frontend - static)
az webapp create \
  --resource-group sentiment-analyzer-rg \
  --plan sentiment-analyzer-plan \
  --name sentiment-dashboard-app
  --runtime "node|18-lts"

# Configure environment variables
az webapp config appsettings set \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --settings @backend/.env
```

### 9.2 GitHub Actions CI/CD Pipeline

See `DEPLOYMENT.md` section for full pipeline.

---

## 10. Monitoring & Observability

### 10.1 Key Metrics to Track

```
Business Metrics:
- Coin count in dashboard
- Average sentiment confidence
- Sentiment distribution (% BULL/NEUTRAL/BEAR)
- Headlines per coin per day

Technical Metrics:
- API response times (target: <500ms)
- Sentiment job duration (target: <2 min for 50 coins)
- Table Storage query latency
- Cache hit rate (target: >90%)
- Error rate (target: <0.1%)

Cost Metrics:
- Claude API costs (target: <$20/month)
- Storage usage
- Egress bandwidth
```

### 10.2 Alerts to Configure

```
Critical:
- Backend service down
- Claude API quota exceeded
- Table Storage errors

Warning:
- Sentiment job takes >3 min
- Cache hit rate <80%
- API response time >1s
```

---

## 11. Security Considerations

### 11.1 Best Practices

- ✅ All external APIs use environment variables (never commit keys)
- ✅ `/api/refresh-sentiment` protected by bearer token
- ✅ CORS restricted to frontend domain only
- ✅ Helmet.js for security headers
- ✅ Input validation on all routes (validator library)
- ✅ Rate limiting on public endpoints (optional: use express-rate-limit)
- ✅ HTTPS enforced (App Service auto-redirects)
- ✅ Storage account keys rotated periodically

### 11.2 Cost Control

- ✅ Set monthly budget alert ($50 max)
- ✅ Monitor Claude API token usage daily
- ✅ Cache sentiment results (24h TTL) to avoid re-analysis
- ✅ Limit historical data retention (keep 7 days snapshots, 30 days sentiment)

---

## 12. Future Enhancements

### 12.1 Phase 2 Features

- [ ] User accounts & watchlists (Cosmos DB)
- [ ] Price alerts & notifications (Twilio/SendGrid)
- [ ] Advanced charting (TradingView Lightweight Charts library)
- [ ] ML-based sentiment confidence scoring (custom model)
- [ ] Multi-timeframe analysis (hourly, daily, weekly)
- [ ] Integration with exchange APIs (limit orders, portfolio tracking)
- [ ] Anomaly detection (unusual volume spikes, sentiment divergences)
- [ ] Community features (shared watchlists, discussion forums)

### 12.2 Scaling Strategy

If you move beyond Azure Free Tier:
- **Backend**: App Service → Azure Container Instances (containers)
- **Database**: Table Storage → Cosmos DB (global replication, stronger querying)
- **Cache**: In-memory → Azure Cache for Redis
- **Jobs**: Node-Cron → Azure Durable Functions (serverless)
- **Frontend**: Static → Azure CDN (global distribution)

---

## 13. Development Workflow

### 13.1 Local Setup

```bash
# Clone repo
git clone <repo>
cd sentiment-analyzer

# Backend
cd backend
npm install
cp .env.example .env          # Configure locally
npm run dev                   # Start with nodemon

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # Vite dev server @ localhost:5173
```

### 13.2 Testing Strategy

- Unit tests (Jest): services, utils, validators
- Integration tests: API routes + mocked CoinGecko/NewsAPI
- E2E tests: Dashboard flows with Playwright
- Manual testing: Local dev before Azure deployment

---

## Conclusion

This architecture delivers **production-ready sentiment analysis at minimal cost** while remaining **highly scalable** for future growth. The hybrid refresh strategy (real-time market data + daily sentiment analysis) balances **API costs with data freshness**, and the modular design makes it easy to swap components or add new data sources.

**Next Steps:**
1. Review this architecture with your team
2. Set up local development environment
3. Begin backend service implementation
4. Create React component scaffolding
5. Configure Azure resources
6. Deploy to staging → production
