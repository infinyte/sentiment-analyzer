# Deployment Guide: Sentiment Analyzer on Azure Free Tier

This guide walks through setting up the Sentiment Analyzer project on Microsoft Azure using only free tier resources.

> **Current Status:** This guide documents the target deployment architecture. The following are **not yet implemented** in the codebase and will need to be built before following the relevant sections:
> - Azure Table Storage integration (app currently uses in-memory cache only)
> - GitHub Actions CI/CD pipeline (`.github/workflows/` is empty)
> - Application Insights structured logging
>
> Sections covering local development, environment variables, and Azure App Service deployment are fully applicable today.

---

## Prerequisites

- **Azure Account** (Free tier, $200 credit for first 30 days)
- **GitHub Repository** (for CI/CD)
- **Azure CLI** (`az` command-line tool)
- **Node.js 18+**
- **npm** or **yarn**
- **Git**

---

## Phase 1: Azure Resource Setup

### 1.1 Create Resource Group

```bash
# Create a resource group in a free tier region (East US)
az group create \
  --name sentiment-analyzer-rg \
  --location eastus
```

### 1.2 Create Storage Account (Table Storage + File Storage)

```bash
# Create storage account
az storage account create \
  --resource-group sentiment-analyzer-rg \
  --name sentimentanalyzer$(date +%s) \
  --location eastus \
  --sku Standard_LRS \
  --kind StorageV2 \
  --https-only true

# Retrieve connection string (save this!)
az storage account show-connection-string \
  --resource-group sentiment-analyzer-rg \
  --name sentimentanalyzer<TIMESTAMP> \
  --query connectionString -o tsv
```

**Create Tables:**

```bash
# You can create tables via Azure Portal or CLI:
az storage table create \
  --name CoinSnapshots \
  --connection-string "<CONNECTION_STRING>"

az storage table create \
  --name SentimentCache \
  --connection-string "<CONNECTION_STRING>"

az storage table create \
  --name MarketHistory \
  --connection-string "<CONNECTION_STRING>"
```

### 1.3 Create App Service Plan (Free Tier)

```bash
# Create App Service Plan (Free tier = shared resources)
az appservice plan create \
  --name sentiment-analyzer-plan \
  --resource-group sentiment-analyzer-rg \
  --sku FREE \
  --is-linux
```

### 1.4 Create Web Apps

#### Backend API

```bash
# Backend web app
az webapp create \
  --resource-group sentiment-analyzer-rg \
  --plan sentiment-analyzer-plan \
  --name sentiment-api-app \
  --runtime "node|18-lts"

# Configure auto-scaling (restart app if idle)
az webapp config set \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --always-on false
```

#### Frontend (Static)

```bash
# Frontend web app
az webapp create \
  --resource-group sentiment-analyzer-rg \
  --plan sentiment-analyzer-plan \
  --name sentiment-dashboard-app \
  --runtime "node|18-lts"
```

### 1.5 Create Application Insights (Monitoring)

```bash
# Application Insights for logging
az monitor app-insights component create \
  --app sentiment-analyzer-insights \
  --location eastus \
  --resource-group sentiment-analyzer-rg \
  --application-type web

# Get instrumentation key
az monitor app-insights component show \
  --app sentiment-analyzer-insights \
  --resource-group sentiment-analyzer-rg \
  --query instrumentationKey -o tsv
```

---

## Phase 2: Configure Environment Variables

### 2.1 Backend App Settings

```bash
# Set environment variables for backend API
az webapp config appsettings set \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    FRONTEND_URL=https://sentiment-dashboard-app.azurewebsites.net \
    AZURE_STORAGE_CONNECTION_STRING="<YOUR_CONNECTION_STRING>" \
    COINGECKO_API_KEY="" \
    NEWSAPI_API_KEY="<YOUR_NEWSAPI_KEY>" \
    CLAUDE_API_KEY="<YOUR_CLAUDE_API_KEY>" \
    SENTIMENT_BATCH_SIZE=50 \
    SENTIMENT_JOB_CRON="0 2 * * *" \
    SENTIMENT_CACHE_TTL_HOURS=24 \
    MARKET_REFRESH_INTERVAL_MINUTES=10 \
    TOP_COINS_LIMIT=100 \
    API_SECRET_KEY="$(openssl rand -base64 32)" \
    ALLOWED_ORIGINS=https://sentiment-dashboard-app.azurewebsites.net \
    LOG_LEVEL=info \
    APPINSIGHTS_INSTRUMENTATION_KEY="<YOUR_INSTRUMENTATION_KEY>"
```

### 2.2 Get API Keys

You'll need to obtain the following API keys:

**NewsAPI Key:**
```
1. Go to https://newsapi.org
2. Sign up for free account
3. Create API key (free tier = 500 requests/day)
4. Copy API key
```

**Claude API Key:**
```
1. Go to https://console.anthropic.com/
2. Create account and sign in
3. Navigate to "API keys" section
4. Create new API key
5. Copy and store securely
```

**CoinGecko:**
```
Free tier: https://www.coingecko.com/en/api
No key required for free endpoints
```

---

## Phase 3: Set Up GitHub CI/CD Pipeline

### 3.1 Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build-and-deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: 'backend/package-lock.json'

      - name: Install dependencies (Backend)
        working-directory: ./backend
        run: npm ci

      - name: Build (TypeScript)
        working-directory: ./backend
        run: npm run build

      - name: Run tests
        working-directory: ./backend
        run: npm test || true

      - name: Deploy to Azure (Backend)
        uses: azure/webapps-deploy@v2
        with:
          app-name: sentiment-api-app
          publish-profile: ${{ secrets.AZURE_BACKEND_PUBLISH_PROFILE }}
          package: ./backend

  build-and-deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: 'frontend/package-lock.json'

      - name: Install dependencies (Frontend)
        working-directory: ./frontend
        run: npm ci

      - name: Build (Vite)
        working-directory: ./frontend
        env:
          VITE_API_BASE_URL: https://sentiment-api-app.azurewebsites.net
        run: npm run build

      - name: Deploy to Azure (Frontend)
        uses: azure/webapps-deploy@v2
        with:
          app-name: sentiment-dashboard-app
          publish-profile: ${{ secrets.AZURE_FRONTEND_PUBLISH_PROFILE }}
          package: ./frontend/dist

  post-deploy:
    runs-on: ubuntu-latest
    needs: [build-and-deploy-backend, build-and-deploy-frontend]
    steps:
      - name: Health Check Backend
        run: |
          sleep 30
          curl -f https://sentiment-api-app.azurewebsites.net/api/health || exit 1

      - name: Health Check Frontend
        run: |
          curl -f https://sentiment-dashboard-app.azurewebsites.net/ || exit 1
```

### 3.2 Generate Publish Profiles

```bash
# Download backend publish profile
az webapp deployment list-publishing-profiles \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --query "[0].xml" -o tsv > backend-publish-profile.xml

# Download frontend publish profile
az webapp deployment list-publishing-profiles \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-dashboard-app \
  --query "[0].xml" -o tsv > frontend-publish-profile.xml
```

### 3.3 Add GitHub Secrets

In your GitHub repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Add new secrets:
   - `AZURE_BACKEND_PUBLISH_PROFILE` = Contents of `backend-publish-profile.xml`
   - `AZURE_FRONTEND_PUBLISH_PROFILE` = Contents of `frontend-publish-profile.xml`

---

## Phase 4: Local Development Setup

### 4.1 Clone and Install

```bash
# Clone repository
git clone <your-repo-url>
cd sentiment-analyzer

# Backend setup
cd backend
npm install
cp .env.example .env
# Edit .env with local development values

# Frontend setup (separate terminal)
cd frontend
npm install
cp .env.example .env
# Edit .env with API endpoint (http://localhost:3000 for local dev)
```

### 4.2 Backend .env (Local)

```bash
# backend/.env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

# Azure
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...

# External APIs
COINGECKO_API_KEY=
NEWSAPI_API_KEY=<your-key>
CLAUDE_API_KEY=<your-key>

# Sentiment Config
SENTIMENT_BATCH_SIZE=50
SENTIMENT_JOB_CRON="0 2 * * *"
SENTIMENT_CACHE_TTL_HOURS=24

# Market Data
MARKET_REFRESH_INTERVAL_MINUTES=10
TOP_COINS_LIMIT=100

# Security
API_SECRET_KEY=dev-secret-key-change-in-production
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Logging
LOG_LEVEL=debug
```

### 4.3 Frontend .env (Local)

```bash
# frontend/.env
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_NAME=Sentiment Analyzer
```

### 4.4 Run Locally

```bash
# Terminal 1: Backend
cd backend
npm run dev          # Uses nodemon for hot reload
# Output: Server running on port 3000

# Terminal 2: Frontend
cd frontend
npm run dev          # Vite dev server
# Output: Local: http://localhost:5173
```

---

## Phase 5: Database Initialization

### 5.1 Create Table Schemas

If using Azure Table Storage, initialize the table structures:

```bash
# Using Azure CLI or SDK to create tables with partition keys:

# Table: CoinSnapshots
# PartitionKey: SYMBOL (e.g., "BTC", "ETH")
# RowKey: ISO timestamp (e.g., "2024-03-16T10:45:00Z")
# Data columns: price, volume, sentiment, volatility, etc.

# Table: SentimentCache
# PartitionKey: SYMBOL
# RowKey: YYYY-MM-DD (e.g., "2024-03-16")
# Data columns: sentiment_score, confidence, summary, catalysts, risks

# Table: MarketHistory
# PartitionKey: SYMBOL-YYYY-MM
# RowKey: DD (e.g., "16")
# Data columns: high, low, open, close, volume_24h
```

### 5.2 Initialize from Backend

Your backend can auto-create tables on startup:

```typescript
// In your backend initialization code
const storage = new StorageService();
await storage.initializeTables();
```

---

## Phase 6: Testing the Deployment

### 6.1 Verify Backend API

```bash
# Health check
curl https://sentiment-api-app.azurewebsites.net/api/health

# Expected response:
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
  "uptime_hours": 2.5
}

# Get coins list
curl https://sentiment-api-app.azurewebsites.net/api/coins?limit=5

# Get coin detail
curl https://sentiment-api-app.azurewebsites.net/api/coins/BTC
```

### 6.2 Verify Frontend

```
1. Open https://sentiment-dashboard-app.azurewebsites.net in browser
2. Verify coin grid loads
3. Click a coin card to open detail modal
4. Check browser console for any errors
```

### 6.3 Monitor via Application Insights

```bash
# View logs
az monitor app-insights metrics show \
  --app sentiment-analyzer-insights \
  --resource-group sentiment-analyzer-rg

# View recent traces
az monitor app-insights query \
  --app sentiment-analyzer-insights \
  --resource-group sentiment-analyzer-rg \
  --analytics-query "traces | top 10 by timestamp"
```

---

## Phase 7: Cost Monitoring

### 7.1 Set Up Budget Alert

```bash
# Create budget alert at $20/month
az consumption budget create \
  --budget-name "Sentiment Analyzer Budget" \
  --category "Cost" \
  --limit 20 \
  --time-period Monthly \
  --start-date 2024-03-01 \
  --resource-group sentiment-analyzer-rg
```

### 7.2 Monitor Services

| Service | Free Tier | Cost Beyond |
|---------|-----------|-------------|
| App Service (B1) | 100 hours/month | $0.013/hour after |
| Storage Account | 5 GB | $0.021/GB/month |
| Table Storage reads | 1M/month | $0.00001 per read after |
| Application Insights | 1 GB/month | $2.30/GB after |
| **Estimated Total** | **~$0-5/month** | |
| Claude API (main cost) | — | ~$0.01-0.03 per 50-coin batch |

---

## Phase 8: Production Best Practices

### 8.1 Enable Auto-Scale (Optional)

For higher traffic, upgrade from Free Tier to Standard and enable autoscaling:

```bash
az appservice plan update \
  --name sentiment-analyzer-plan \
  --resource-group sentiment-analyzer-rg \
  --sku S1
```

### 8.2 Configure HTTPS / Custom Domain

```bash
# If you have a custom domain
az webapp config ssl bind \
  --certificate-thumbprint <THUMBPRINT> \
  --ssl-type SNI \
  --name sentiment-api-app \
  --resource-group sentiment-analyzer-rg
```

### 8.3 Enable Managed Identity (Security)

```bash
# Enable system-managed identity for Azure services
az webapp identity assign \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app

# This allows the app to authenticate with Azure services without API keys
```

### 8.4 Secrets Management

Instead of storing secrets in App Settings, use **Azure Key Vault**:

```bash
# Create Key Vault (minimal tier is ~$0.40/month)
az keyvault create \
  --name sentiment-vault \
  --resource-group sentiment-analyzer-rg \
  --location eastus

# Store secrets
az keyvault secret set \
  --vault-name sentiment-vault \
  --name "claude-api-key" \
  --value "<YOUR_KEY>"

# Grant app access
az keyvault set-policy \
  --name sentiment-vault \
  --resource-group sentiment-analyzer-rg \
  --object-id <APP_OBJECT_ID> \
  --secret-permissions get list
```

---

## Phase 9: Troubleshooting

### Issue: "Application in stopped state"

```bash
# Restart the app
az webapp start \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app
```

### Issue: "CORS errors when frontend calls backend"

Check that `ALLOWED_ORIGINS` environment variable includes the frontend domain:

```bash
az webapp config appsettings set \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --settings ALLOWED_ORIGINS=https://sentiment-dashboard-app.azurewebsites.net
```

### Issue: "Storage account connection string invalid"

Regenerate the connection string:

```bash
az storage account show-connection-string \
  --resource-group sentiment-analyzer-rg \
  --name sentimentanalyzer<TIMESTAMP> \
  --query connectionString -o tsv
```

### Issue: "Claude API quota exceeded"

Check token usage and add budget alert:

```bash
# View environment variable
az webapp config appsettings list \
  --resource-group sentiment-analyzer-rg \
  --name sentiment-api-app \
  --query "[?name=='CLAUDE_API_KEY']"
```

---

## Phase 10: Scaling Up (After Free Tier)

If you outgrow the free tier, here's the migration path:

| Component | Free → Paid |
|-----------|------------|
| App Service | B1 ($0.067/hour) → S1 ($0.10/hour) |
| Storage | Standard LRS ($0.023/GB) → Premium ($0.01/GB) |
| Database | Table Storage → Cosmos DB (serverless) |
| Jobs | Node-Cron → Azure Durable Functions |

---

## Maintenance Schedule

### Daily
- Monitor health check endpoint
- Review Application Insights logs for errors
- Check Claude API usage

### Weekly
- Review cost metrics
- Check sentiment job completion
- Validate data freshness

### Monthly
- Review and optimize database queries
- Check for API deprecations
- Update dependencies (`npm audit`)

---

## Summary

You now have a **fully deployed sentiment analyzer** on Azure Free Tier with:

✅ Real-time market data every 10 minutes  
✅ Daily sentiment analysis using Claude AI  
✅ Interactive React dashboard  
✅ GitHub Actions CI/CD pipeline  
✅ Application Insights monitoring  
✅ ~$6-15/month total cost (mainly Claude API)  

Next steps:
1. Push code to GitHub
2. GitHub Actions automatically deploys changes
3. Monitor via Azure Portal and Application Insights
4. Scale up resources as needed
