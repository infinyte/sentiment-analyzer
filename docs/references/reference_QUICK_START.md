# Sentiment Analyzer - Quick Start Guide

> Historical reference snapshot: this guide preserves an earlier scaffold-first setup flow and is not the authoritative description of the current repository layout. Use `README.md` for the current quick-start path.

This guide walks you through setting up the project structure and getting started with development.

---

## Step 1: Create Project Directory Structure

```bash
mkdir sentiment-analyzer
cd sentiment-analyzer

# Create main directories
mkdir -p backend/src/{routes,services,jobs,models,utils,middleware,config}
mkdir -p backend/logs
mkdir -p frontend/src/{components,pages,services,styles,types}
mkdir -p .github/workflows
mkdir -p docs

# Create root files
touch .gitignore
touch README.md
touch docker-compose.yml
```

---

## Step 2: Initialize Git Repository

```bash
git init
git branch -M main

# Create .gitignore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Environment
.env
.env.local
.env.*.local

# Build artifacts
dist/
build/
*.js
*.map

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
logs/
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# Temporary
temp/
tmp/
.cache

# Testing
coverage/
.nyc_output/

# Azure
local.settings.json
EOF

git add .gitignore
git commit -m "Initial commit: project structure"
```

---

## Step 3: Set Up Backend

```bash
cd backend

# Initialize npm project
npm init -y

# Install the package.json template content
# (Copy the backend-package.json content into package.json)

npm install

# Create environment file
cp .env.example .env
# Edit .env with your API keys

# Create TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Create jest config
cat > jest.config.js << 'EOF'
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
};
EOF

# Create main app file (use backend-starter.ts content)
touch src/index.ts
```

### Backend .env.example

```bash
cat > .env.example << 'EOF'
# Server
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

# Azure
AZURE_STORAGE_ACCOUNT_NAME=
AZURE_STORAGE_ACCOUNT_KEY=
AZURE_STORAGE_CONNECTION_STRING=

# External APIs
COINGECKO_API_KEY=
NEWSAPI_API_KEY=
CLAUDE_API_KEY=

# Sentiment Analysis
SENTIMENT_BATCH_SIZE=50
SENTIMENT_JOB_CRON=0 2 * * *
SENTIMENT_CACHE_TTL_HOURS=24

# Market Data Refresh
MARKET_REFRESH_INTERVAL_MINUTES=10
TOP_COINS_LIMIT=100

# Security
API_SECRET_KEY=
ALLOWED_ORIGINS=http://localhost:5173

# Logging
LOG_LEVEL=info
APPINSIGHTS_INSTRUMENTATION_KEY=
EOF
```

### Backend Directory Structure (Detailed)

```bash
# Create additional subdirectories and placeholder files

# Config
touch src/config/env.ts
touch src/config/logger.ts

# Routes
touch src/routes/coins.ts
touch src/routes/sentiment.ts
touch src/routes/admin.ts
touch src/routes/health.ts

# Services
touch src/services/coingecko.service.ts
touch src/services/newsapi.service.ts
touch src/services/sentiment.service.ts
touch src/services/storage.service.ts
touch src/services/cache.service.ts

# Jobs
touch src/jobs/marketDataJob.ts
touch src/jobs/sentimentJob.ts

# Models
touch src/models/coin.model.ts
touch src/models/sentiment.model.ts
touch src/models/report.model.ts

# Utils
touch src/utils/volatility.ts
touch src/utils/validators.ts
touch src/utils/transformers.ts

# Middleware
touch src/middleware/errorHandler.ts
touch src/middleware/requestLogger.ts
touch src/middleware/auth.ts
```

---

## Step 4: Set Up Frontend

```bash
cd ../frontend

# Initialize npm project
npm init -y

# Install the package.json template content
# (Copy the frontend-package.json content into package.json)

npm install

# Create environment file
cp .env.example .env
# Edit .env with backend URL

# Create TypeScript config
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForModuleKeywords": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
EOF

cat > tsconfig.node.json << 'EOF'
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
EOF

# Create Vite config
cat > vite.config.ts << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
EOF

# Create main app file (use frontend-starter.tsx content)
touch src/App.tsx
touch src/App.css
touch src/index.tsx

# Create index.html
cat > index.html << 'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sentiment Analyzer - Altcoin Trading Intelligence</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
EOF

# Create main.tsx / index.tsx
cat > src/index.tsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
EOF
```

### Frontend .env.example

```bash
cat > .env.example << 'EOF'
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_NAME=Sentiment Analyzer
EOF
```

### Frontend Directory Structure

```bash
# Create components
mkdir -p src/components/{Layout,Dashboard,CoinCard,DetailModal,Chart,common}

touch src/components/Layout/Header.tsx
touch src/components/Layout/Navigation.tsx
touch src/components/Dashboard/Dashboard.tsx
touch src/components/Dashboard/FilterBar.tsx
touch src/components/CoinCard/CoinCard.tsx
touch src/components/CoinCard/SentimentBadge.tsx
touch src/components/CoinCard/Sparkline.tsx
touch src/components/DetailModal/DetailModal.tsx
touch src/components/DetailModal/SentimentSummary.tsx
touch src/components/Chart/InteractiveChart.tsx
touch src/components/common/PercentageChange.tsx
touch src/components/common/Loading.tsx

# Create pages
mkdir -p src/pages
touch src/pages/DashboardPage.tsx
touch src/pages/DetailPage.tsx

# Create services and hooks
mkdir -p src/services
touch src/services/api.client.ts
touch src/hooks/useCoins.ts
touch src/hooks/useCoinDetail.ts

# Create types
mkdir -p src/types
touch src/types/index.ts

# Create styles
touch src/styles/globals.css
touch src/styles/variables.css
touch src/App.css
```

---

## Step 5: Set Up Root Configuration Files

```bash
cd ..

# Docker Compose for local development
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
    env_file:
      - ./backend/.env
    volumes:
      - ./backend/src:/app/src
    command: npm run dev

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "5173:5173"
    env_file:
      - ./frontend/.env
    volumes:
      - ./frontend/src:/app/src
    command: npm run dev

networks:
  default:
    name: sentiment-analyzer-network
EOF

# GitHub Actions workflow
cat > .github/workflows/deploy.yml << 'EOF'
name: Deploy to Azure

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy Backend
        run: echo "Deploy backend..."
      - name: Deploy Frontend
        run: echo "Deploy frontend..."
EOF

# Root README
cat > README.md << 'EOF'
# Sentiment Analyzer - Altcoin Trading Intelligence Platform

Real-time sentiment analysis and market intelligence for cryptocurrency trading.

## Features

- 📊 Real-time altcoin market data (every 10 minutes)
- 🤖 AI-powered sentiment analysis using Claude
- 📰 News aggregation and trending topics
- 📈 Interactive charts and historical data
- 🎨 Color-coded sentiment indicators
- ⚡ Minimal cost (~$6-15/month on Azure Free Tier)

## Quick Start

### Local Development

```bash
# Backend
cd backend
npm install
cp .env.example .env
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env
npm run dev
```

### Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for Azure setup.

## Architecture

See [SENTIMENT_ANALYZER_ARCHITECTURE.md](./SENTIMENT_ANALYZER_ARCHITECTURE.md) for full system design.

## Project Structure

```
sentiment-analyzer/
├── backend/              # Node.js + Express API
│   ├── src/
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # External API clients
│   │   ├── jobs/        # Scheduled tasks
│   │   ├── models/      # TypeScript interfaces
│   │   └── utils/       # Utilities & helpers
│   └── package.json
│
├── frontend/            # React + TypeScript UI
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page-level components
│   │   ├── services/    # API client & hooks
│   │   ├── types/       # TypeScript types
│   │   └── styles/      # CSS styles
│   └── package.json
│
├── .github/
│   └── workflows/       # GitHub Actions CI/CD
│
└── docs/               # Documentation
```

## API Endpoints

- `GET /api/coins` - Retrieve top coins
- `GET /api/coins/:symbol` - Detailed coin report
- `GET /api/sentiment/:symbol` - Cached sentiment
- `POST /api/refresh-sentiment` - Trigger analysis
- `GET /api/health` - Health check

## Technology Stack

**Backend:**
- Node.js 18+
- Express.js
- TypeScript
- Claude API (Anthropic)
- CoinGecko API
- NewsAPI
- Azure Table Storage

**Frontend:**
- React 18
- TypeScript
- Vite
- Chart.js / TradingView Lite

**Deployment:**
- Azure App Service (Free Tier)
- Azure Table Storage
- GitHub Actions CI/CD

## Environment Variables

See `.env.example` files in `backend/` and `frontend/` directories.

## Cost

Free Tier:
- Azure App Service: $0 (100 hours/month)
- Storage: $0 (5 GB free)
- Claude API: ~$6-15/month

## License

MIT

## Support

For issues or questions, please open a GitHub issue.
EOF
```

---

## Step 6: Initialize Git and GitHub

```bash
cd ..

git add .
git commit -m "feat: initial project structure and configuration"
git remote add origin https://github.com/yourusername/sentiment-analyzer.git
git branch -M main
git push -u origin main
```

---

## Step 7: Add Required API Keys

1. **Get NewsAPI Key**
   - Go to https://newsapi.org
   - Sign up for free tier
   - Copy API key to `backend/.env` as `NEWSAPI_API_KEY`

2. **Get Claude API Key**
   - Go to https://console.anthropic.com
   - Create API key
   - Copy to `backend/.env` as `CLAUDE_API_KEY`

3. **CoinGecko** (no key needed for free tier)

4. **Azure Storage Connection String**
   - Go to Azure Portal
   - Create Storage Account
   - Copy connection string to `backend/.env`

---

## Step 8: Start Development

```bash
# Option 1: Local npm
cd backend && npm run dev
# (separate terminal)
cd frontend && npm run dev

# Option 2: Docker Compose
docker-compose up --build
```

Visit:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- API Health: http://localhost:3000/api/health

---

## Next Steps

1. ✅ Clone/initialize project structure
2. ⏭️ Fill in `.env` files with API keys
3. ⏭️ Run locally and test dashboard
4. ⏭️ Deploy to Azure (see DEPLOYMENT_GUIDE.md)
5. ⏭️ Set up GitHub Actions CI/CD
6. ⏭️ Monitor via Application Insights

---

## Troubleshooting

**Backend won't start:**
```bash
cd backend
npm install
npm run build
npm start
```

**Frontend shows blank page:**
Check browser console for CORS errors. Verify `VITE_API_BASE_URL` matches backend URL.

**API calls failing:**
Verify environment variables are set correctly.

```bash
node -e "console.log(process.env)"
```

---

That's it! You now have a complete project structure ready for development. 🚀
