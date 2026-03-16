# SENTIMENT ANALYZER - SYSTEM ARCHITECTURE

## OVERVIEW

Real-time cryptocurrency sentiment analysis platform combining:
- Market data polling every 10 minutes (CoinGecko)
- Daily sentiment analysis using Claude AI
- Interactive React dashboard with trading insights
- Deployed on Azure Free Tier (~$10-15/month)

---

## DATA FLOW DIAGRAM

```
REACT FRONTEND (Dashboard)
         |
         | HTTPS API Calls
         v
EXPRESS BACKEND (Node.js)
    |        |        |
    v        v        v
CoinGecko NewsAPI Claude API
    |        |        |
    v        v        v
AZURE TABLE STORAGE (Time-Series Database)
```

---

## KEY COMPONENTS

### 1. FRONTEND
- React 18 with TypeScript
- Responsive coin grid layout (1-4 columns)
- Interactive detail modal
- Real-time status indicators
- Chart.js for price visualization

### 2. BACKEND
- Node.js + Express.js
- TypeScript for type safety
- Winston logging
- Node-Cron for scheduled jobs
- In-memory caching (node-cache)

### 3. DATA SOURCES
- CoinGecko API (free tier, no key needed)
- NewsAPI (free tier, 500 requests/day)
- Claude API (paid, ~$0.01-0.03 per analysis)
- Azure Table Storage (first 5GB free)

### 4. SCHEDULED JOBS

**Every 10 Minutes:**
- Fetch top 50-100 coins from CoinGecko
- Get current price, volume, market cap
- Calculate volatility metrics
- Store snapshot in Table Storage

**Daily @ 2 AM UTC:**
- Analyze sentiment for top 50 coins
- Use Claude API to process news headlines
- Generate Bull/Neutral/Bear scores
- Cache results for 24 hours

---

## API ENDPOINTS

### GET /api/coins
Returns list of top coins with current data

Response:
```
{
  "data": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "price_usd": 43250.50,
      "sentiment_score": "BULL",
      "sentiment_confidence": 0.87,
      "price_change_24h_percent": 2.34,
      "volatility_24h": 2.1
    }
  ],
  "last_updated": "2024-03-16T10:45:00Z"
}
```

### GET /api/coins/:symbol
Returns detailed report for one coin

Includes:
- Current price and market data
- 7-day price history (OHLCV)
- Sentiment analysis
- Recent news articles
- Volatility trends

### GET /api/sentiment/:symbol
Returns cached sentiment data

### POST /api/refresh-sentiment
Admin endpoint to manually trigger analysis

### GET /api/health
Health check for monitoring

---

## DATA MODELS

### CoinSnapshot
Fields:
- id, symbol, name
- price_usd, market_cap_usd, volume_24h_usd
- price_change_24h_percent, price_change_7d_percent
- volatility_24h, volatility_7d
- sentiment_score (BULL/NEUTRAL/BEAR)
- sentiment_confidence (0-1)
- sentiment_summary (text)
- trending_score (headline count)
- timestamp

Storage: Azure Table Storage, partitioned by SYMBOL

### SentimentAnalysis
Fields:
- symbol, analysis_date
- sentiment_score, confidence
- summary (1-2 sentences)
- key_catalysts (array of strings)
- risk_factors (array of strings)
- short_term_outlook
- volatility_warning (boolean)
- generated_at, model, tokens_used

Storage: Azure Table Storage, TTL 24 hours

---

## REFRESH SCHEDULE

```
EVERY 10 MINUTES:
├─ Call CoinGecko API (top 100 coins)
├─ Extract: price, volume, market cap, 24h change, 7d change
├─ Calculate volatility from previous snapshots
├─ Call NewsAPI for headlines
└─ Store snapshot → Table Storage

EVERY 24 HOURS @ 02:00 UTC:
├─ Retrieve past 7 days of articles for top 50 coins
├─ Batch call to Claude API (1-2 minute processing)
├─ Extract sentiment score, catalysts, risks
└─ Cache results for 24 hours
```

---

## COST ESTIMATION (MONTHLY)

| Service | Free Tier | Cost Beyond |
|---------|-----------|------------|
| App Service | 100 hrs/mo | $0 |
| Storage (5GB) | 5 GB | $0 |
| Table Storage | 1M ops/mo | $0 |
| App Insights | 1 GB/mo | $0 |
| **Claude API** | — | **$8-15** |
| **TOTAL** | | **$8-15/month** |

---

## DEPLOYMENT TARGETS

### Development
- Local machine (localhost:3000 backend, localhost:5173 frontend)
- Docker Compose for containerized local dev

### Production
- Azure App Service (B1 free tier)
- Automatic scaling handled by GitHub Actions
- Application Insights monitoring

### Future Scale
- Upgrade to S1 tier (~$45/mo)
- Add Cosmos DB for global replication
- Add Azure CDN for frontend distribution
- Implement Azure Durable Functions for jobs

---

## SECURITY CONSIDERATIONS

- Environment variables for all secrets
- API key stored in env, never in code
- CORS restricted to frontend domain
- Helmet.js for security headers
- Input validation on all endpoints
- Rate limiting (optional: express-rate-limit)
- HTTPS enforced by Azure

---

## MONITORING & ALERTING

### Metrics to Track
- API response time (target: <500ms)
- Sentiment job duration (target: <2 min)
- Cache hit rate (target: >90%)
- Error rate (target: <0.1%)
- Claude API token usage
- Storage usage

### Alerts
- Backend service down
- Claude API quota exceeded
- Sentiment job takes >3 minutes
- Error rate spike

Setup: Azure Application Insights + Azure Portal alerts

---

## FILE STRUCTURE

```
sentiment-analyzer/
├── backend/
│   ├── src/
│   │   ├── index.ts (main server)
│   │   ├── services/ (API clients)
│   │   ├── routes/ (endpoints)
│   │   ├── jobs/ (scheduled tasks)
│   │   ├── models/ (types)
│   │   ├── utils/ (helpers)
│   │   └── middleware/ (auth, logging)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── types/
│   │   └── styles/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── index.html
│
├── .github/
│   └── workflows/
│       └── deploy.yml (CI/CD)
│
└── docs/
    ├── ARCHITECTURE.md
    ├── QUICK_START.md
    └── DEPLOYMENT.md
```

---

## NEXT STEPS

1. Read QUICK_START.md
2. Set up local environment
3. Run backend and frontend locally
4. Test API endpoints
5. Deploy to Azure (see DEPLOYMENT.md)
