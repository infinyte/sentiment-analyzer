# Sentiment Analyzer - AI-Powered Altcoin Trading Intelligence Platform

> Historical reference snapshot: this file preserves an earlier README draft and does not fully reflect the current repository layout or runtime behavior. Use the root `README.md` as the current source of truth.

[![Sentiment Analysis](https://img.shields.io/badge/sentiment-analysis-blue)](https://github.com)
[![Cryptocurrency](https://img.shields.io/badge/crypto-trading-green)](https://github.com)
[![Claude API](https://img.shields.io/badge/Claude-API-ff69b4)](https://console.anthropic.com)
[![React](https://img.shields.io/badge/react-18-61dafb?logo=react)](https://react.dev)
[![Node.js](https://img.shields.io/badge/node.js-18+-green?logo=node.js)](https://nodejs.org)
[![Azure](https://img.shields.io/badge/azure-cloud-0078d4?logo=microsoft-azure)](https://azure.microsoft.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Open Source](https://img.shields.io/badge/open-source-blue)](https://github.com)

---

## 📋 Overview

Real-time cryptocurrency sentiment analysis platform combining market data aggregation, AI-powered natural language processing, and interactive visualization. Built as an **educational resource** for developers learning full-stack development, machine learning integration, and cloud deployment.

**Key Features:**
- 🤖 AI-powered sentiment analysis using Claude API
- 📊 Real-time market data every 10 minutes (CoinGecko)
- 📰 News aggregation and trending topic analysis (NewsAPI)
- 📈 Interactive React dashboard with color-coded indicators
- ☁️ Azure Free Tier deployment ($8-15/month)
- 🎓 Production-grade code with detailed documentation
- 📚 Complete learning resource for full-stack development

---

## 🏗️ System Architecture

### Data Flow

```
┌─────────────────────────────────────────────────┐
│  REACT FRONTEND (Interactive Dashboard)          │
│  - Coin grid with sentiment badges              │
│  - Detail modals with charts                    │
│  - Real-time status indicators                  │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS API
                  ↓
┌─────────────────────────────────────────────────┐
│  EXPRESS BACKEND (Node.js API Server)            │
│  - 5 REST API endpoints                         │
│  - Scheduled jobs (every 10 min + daily)       │
│  - Service layer for external APIs              │
│  - In-memory caching layer                      │
└─────────────────┬───────────────────────────────┘
        ┌────────┼────────┬────────────┐
        ↓        ↓        ↓            ↓
   ┌─────────┐ ┌────────┐ ┌──────────┐
   │CoinGecko│ │NewsAPI │ │ Claude   │
   │(Market) │ │(News)  │ │(Sentiment)
   └─────────┘ └────────┘ └──────────┘
        ↓        ↓            ↓
   ┌──────────────────────────────────┐
   │ AZURE TABLE STORAGE (Time-Series)│
   │ - Coin snapshots (every 10 min)  │
   │ - Sentiment cache (daily)        │
   │ - Market history (7 days)        │
   └──────────────────────────────────┘
```

### Refresh Schedule

```
EVERY 10 MINUTES:
├─ Fetch top 50-100 coins from CoinGecko
├─ Extract: price, volume, market cap, volatility
├─ Retrieve news headlines (NewsAPI)
└─ Store snapshot in Table Storage

EVERY 24 HOURS @ 02:00 UTC:
├─ Analyze sentiment for top 50 coins
├─ Process 3-7 days of news articles
├─ Use Claude API for sentiment classification
├─ Generate Bull/Neutral/Bear scores
└─ Cache results for 24 hours
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript | Interactive dashboard |
| **Backend** | Node.js + Express.js | REST API + orchestration |
| **Languages** | TypeScript | Type-safe development |
| **Market Data** | CoinGecko API | Free real-time data |
| **Headlines** | NewsAPI | News aggregation |
| **AI/NLP** | Claude API (Anthropic) | Sentiment analysis |
| **Database** | Azure Table Storage | Time-series snapshots |
| **Cloud** | Azure App Service | Serverless hosting |
| **CI/CD** | GitHub Actions | Automated deployment |
| **Monitoring** | Application Insights | Logging & alerts |

### Data Models

**CoinSnapshot** (Stored Every 10 Minutes)
```
{
  symbol: "BTC",
  name: "Bitcoin",
  price_usd: 43250.50,
  market_cap_usd: 850000000000,
  volume_24h_usd: 28000000000,
  price_change_24h_percent: 2.34,
  price_change_7d_percent: 5.67,
  volatility_24h: 2.1,
  sentiment_score: "BULL",
  sentiment_confidence: 0.87,
  sentiment_summary: "Strong bullish momentum...",
  market_rank: 1,
  timestamp: "2024-03-16T10:45:00Z"
}
```

**SentimentAnalysis** (Cached Daily)
```
{
  symbol: "BTC",
  analysis_date: "2024-03-16",
  sentiment_score: "BULL",
  confidence: 0.87,
  summary: "Positive institutional adoption signals...",
  key_catalysts: ["ETF approval", "Technical breakout"],
  risk_factors: ["Regulatory headwinds"],
  short_term_outlook: "Likely to trend up...",
  volatility_warning: false
}
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/coins` | GET | List top 50-200 coins with sentiment |
| `/api/coins/:symbol` | GET | Detailed coin report + history |
| `/api/sentiment/:symbol` | GET | Cached sentiment data |
| `/api/refresh-sentiment` | POST | Admin trigger for analysis |
| `/api/health` | GET | Health check for monitoring |

---

## 💰 Cost Structure (Azure Free Tier)

| Service | Free Tier | Beyond Free | Estimated Monthly |
|---------|-----------|------------|-------------------|
| App Service | 100 hrs/mo | $0.013/hr | $0 |
| Storage (5GB) | 5 GB | $0.021/GB | $0 |
| Table Storage | 1M ops/mo | $0.00001/op | $0 |
| App Insights | 1 GB/mo | $2.30/GB | $0 |
| **Claude API** | — | $0.01-0.03/req | **$8-15** |
| **TOTAL** | | | **$8-15/month** |

**Scaling Path:**
- Free Tier → B1 App Service: +$45/mo
- Table Storage → Cosmos DB: +$25-100/mo
- Static files → Azure CDN: variable

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Git
- API Keys (free):
  - [NewsAPI](https://newsapi.org) (500 requests/day)
  - [Claude API](https://console.anthropic.com) (pay-per-use: $8-15/month)
  - CoinGecko (no key needed)

### Local Development (5 minutes)

**1. Clone and setup:**
```bash
git clone https://github.com/yourusername/sentiment-analyzer.git
cd sentiment-analyzer

# Backend
cd backend
npm install
cp .env.example .env
# Edit .env with your API keys

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

**2. Start servers:**
```bash
# Terminal 1: Backend
cd backend
npm run dev
# Output: ✓ Server running on port 3000

# Terminal 2: Frontend
cd frontend
npm run dev
# Output: ➜ Local: http://localhost:5173/
```

**3. Open dashboard:**
Navigate to `http://localhost:5173` and see:
- Dashboard with 50 coin cards
- Real-time sentiment badges (🟢 🟡 🔴)
- Click any coin to see detail modal
- Check console for errors

**4. Test API:**
```bash
# Get coins list
curl http://localhost:3000/api/coins

# Health check
curl http://localhost:3000/api/health

# Get specific coin
curl http://localhost:3000/api/coins/BTC
```

---

## 📖 Detailed Setup Guide

### Backend Setup

**File: `backend/tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

**File: `backend/.env`**
```
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173
NEWSAPI_API_KEY=your_key_here
CLAUDE_API_KEY=your_key_here
ALLOWED_ORIGINS=http://localhost:5173
API_SECRET_KEY=dev-secret
```

**Install and run:**
```bash
cd backend
npm install
npm run dev
```

### Frontend Setup

**File: `frontend/vite.config.ts`**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

**File: `frontend/index.html`**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sentiment Analyzer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Install and run:**
```bash
cd frontend
npm install
npm run dev
```

---

## ☁️ Azure Deployment

### Step 1: Create Azure Resources

```bash
# Create resource group
az group create --name sentiment-rg --location eastus

# Create storage account
az storage account create \
  --name sentiment$(date +%s) \
  --resource-group sentiment-rg \
  --location eastus \
  --sku Standard_LRS

# Create app service plan (free tier)
az appservice plan create \
  --name sentiment-plan \
  --resource-group sentiment-rg \
  --sku FREE --is-linux

# Create backend web app
az webapp create \
  --resource-group sentiment-rg \
  --plan sentiment-plan \
  --name sentiment-api-app \
  --runtime "node|18-lts"

# Create frontend web app
az webapp create \
  --resource-group sentiment-rg \
  --plan sentiment-plan \
  --name sentiment-dashboard-app \
  --runtime "node|18-lts"
```

### Step 2: Configure Environment Variables

```bash
az webapp config appsettings set \
  --resource-group sentiment-rg \
  --name sentiment-api-app \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    NEWSAPI_API_KEY=your_key \
    CLAUDE_API_KEY=your_key \
    ALLOWED_ORIGINS=https://sentiment-dashboard-app.azurewebsites.net
```

### Step 3: Set Up GitHub Actions CI/CD

**File: `.github/workflows/deploy.yml`**
```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Build Backend
        working-directory: ./backend
        run: npm install && npm run build
      
      - name: Build Frontend
        working-directory: ./frontend
        run: npm install && npm run build
      
      - name: Deploy Backend
        uses: azure/webapps-deploy@v2
        with:
          app-name: sentiment-api-app
          publish-profile: ${{ secrets.AZURE_BACKEND_PUBLISH }}
          package: ./backend
      
      - name: Deploy Frontend
        uses: azure/webapps-deploy@v2
        with:
          app-name: sentiment-dashboard-app
          publish-profile: ${{ secrets.AZURE_FRONTEND_PUBLISH }}
          package: ./frontend/dist
```

### Step 4: Get Publish Profiles

```bash
# Download and save as GitHub secret
az webapp deployment list-publishing-profiles \
  --resource-group sentiment-rg \
  --name sentiment-api-app \
  --query "[0]" -o json > backend-profile.json

az webapp deployment list-publishing-profiles \
  --resource-group sentiment-rg \
  --name sentiment-dashboard-app \
  --query "[0]" -o json > frontend-profile.json
```

Add to GitHub Secrets:
- `AZURE_BACKEND_PUBLISH` = contents of `backend-profile.json`
- `AZURE_FRONTEND_PUBLISH` = contents of `frontend-profile.json`

### Step 5: Deploy

```bash
git add .
git commit -m "Deploy to Azure"
git push origin main
```

Watch GitHub Actions workflow execute automatically!

**Verify deployment:**
- Backend: `https://sentiment-api-app.azurewebsites.net/api/health`
- Frontend: `https://sentiment-dashboard-app.azurewebsites.net`

---

## 📁 Project Structure

```
sentiment-analyzer/
├── backend/
│   ├── src/
│   │   └── index.ts (main server)
│   ├── dist/ (built files)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.html
│   ├── dist/ (built files)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── index.html
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── .gitignore
├── README.md
└── LICENSE
```

---

## 🔧 Available Scripts

### Backend
```bash
npm run dev      # Start development server with hot reload
npm run build    # Compile TypeScript to JavaScript
npm start        # Run compiled production build
npm test         # Run tests (if configured)
```

### Frontend
```bash
npm run dev      # Start Vite dev server (localhost:5173)
npm run build    # Build for production (dist/)
npm run preview  # Preview production build locally
```

---

## 🎓 Learning Value

This project teaches:

**Full-Stack Development:**
- Express.js REST API patterns
- React hooks and component architecture
- TypeScript type safety
- State management with React

**Machine Learning Integration:**
- Claude API integration
- Prompt engineering
- Sentiment analysis classification
- NLP with large language models

**Cloud & DevOps:**
- Azure Free Tier resource management
- GitHub Actions CI/CD pipelines
- Environment configuration
- Cloud monitoring and logging

**Real-World APIs:**
- CoinGecko market data integration
- NewsAPI news aggregation
- Rate limiting and caching
- Error handling and retries

**Best Practices:**
- Code organization and modularity
- Environment variable management
- Input validation and security
- Logging and monitoring

---

## 🤝 Contributing

Contributions welcome! Areas for enhancement:
- Advanced charting (TradingView, Chart.js)
- User accounts and watchlists
- Price alerts and notifications
- ML-based confidence scoring
- Additional data sources
- Mobile app (React Native)
- Automated trading integration

**To contribute:**
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Claude API](https://console.anthropic.com) - Sentiment analysis
- [CoinGecko](https://www.coingecko.com) - Market data
- [NewsAPI](https://newsapi.org) - News aggregation
- [Microsoft Azure](https://azure.microsoft.com) - Cloud hosting
- [Anthropic](https://www.anthropic.com) - AI research

---

## 📞 Support

For questions or issues:
1. Check existing [GitHub Issues](https://github.com/yourusername/sentiment-analyzer/issues)
2. Review [API Documentation](./docs/API.md)
3. See [Quick Start Guide](./04_QUICK_START.txt)
4. Check [Architecture](./01_ARCHITECTURE.md)

---

## 🗺️ Roadmap

### Phase 1 (Complete)
- [x] Core sentiment analysis engine
- [x] Real-time market data fetching
- [x] Interactive React dashboard
- [x] Azure deployment guide

### Phase 2 (Planned)
- [ ] Interactive charting with TradingView
- [ ] User accounts and watchlists
- [ ] Email/SMS price alerts
- [ ] ML model training on crypto data

### Phase 3 (Future)
- [ ] Exchange API integration
- [ ] Automated trading bot
- [ ] Portfolio tracking
- [ ] Community features (shared watchlists)
- [ ] Mobile app

---

**Happy trading! 📈🚀**
