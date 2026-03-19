ENV SETUP GUIDE - SENTIMENT ANALYZER + EVOLUTIONARY TRADING SYSTEM
==================================================================

QUICK REFERENCE
===============

File Locations:
  Backend:  sentiment-analyzer/backend/.env
  Frontend: sentiment-analyzer/frontend/.env

Copy from templates:
  Backend:  Copy backend.env.template → backend/.env
  Frontend: Copy frontend.env.template → frontend/.env

Never commit to git:
  Add to .gitignore: *.env
  Safe to store: *.env.template, *.env.example, .env.local

---

BACKEND SETUP (.env) - COMPLETE GUIDE
======================================

LOCATION: sentiment-analyzer/backend/.env

SECTION 1: SERVER & APPLICATION (Required, defaults provided)
──────────────────────────────────────────────────────────────

SERVER_PORT=3000
  • What it is: Port the Express server listens on
  • Default: 3000
  • When to change: Only if port 3000 is already in use
  • Example: SERVER_PORT=5000 (use port 5000 instead)

NODE_ENV=development
  • What it is: Node environment (affects logging, error handling)
  • Options: development | staging | production
  • Default: development
  • When to change: Set to 'production' for live deployments

DEBUG=true
  • What it is: Enable verbose logging
  • Options: true | false
  • Default: true (keep on for debugging)
  • Set to false in production to reduce noise

SECTION 2: DATABASE (Required, defaults provided)
──────────────────────────────────────────────────

DATABASE_PATH=backend/sentiment_analyzer.db
  • What it is: Path to SQLite database file
  • Default: backend/sentiment_analyzer.db
  • Don't change unless you know what you're doing

DATABASE_TIMEOUT=5000
  • What it is: Connection timeout in milliseconds
  • Default: 5000 (5 seconds)
  • Increase if you get timeout errors

DATABASE_LOG_QUERIES=false
  • What it is: Log all SQL queries (for debugging)
  • Options: true | false
  • Default: false
  • Set to true only when debugging database issues

SECTION 3: TRADING MODE - CRITICAL ⚠️
──────────────────────────────────────

TRADING_MODE=paper
  • What it is: Which trading mode to use
  • Options: paper | sandbox | live
  
  PAPER MODE (RECOMMENDED):
    • What: Simulated trading, no real API calls
    • API calls: None
    • Real money: No
    • Speed: Instant order execution
    • Use case: Testing, development
    • Setup time: 5 minutes
    • Risk: Zero
    
  SANDBOX MODE:
    • What: Real API calls but with fake test funds
    • API calls: Yes (real Crypto.com API)
    • Real money: No (uses sandbox account)
    • Speed: Real exchange speed (~1-5 seconds)
    • Use case: Pre-live testing, API validation
    • Setup time: 30 minutes (need sandbox account)
    • Risk: Zero (but good API practice)
    
  LIVE MODE (⚠️ DANGEROUS):
    • What: Real API calls with real money
    • API calls: Yes (real Crypto.com API)
    • Real money: YES (⚠️)
    • Speed: Real exchange speed
    • Use case: Actual trading
    • Setup time: 1 hour (need live account + funding)
    • Risk: REAL - you can lose money

TRADING_PROVIDER=crypto-com
  • What it is: Which exchange to use
  • Options: crypto-com | binance-us
  • Default: crypto-com (RECOMMENDED)
  
  CRYPTO.COM (RECOMMENDED):
    • Min order: $1
    • Maker fee: 0.25%
    • Taker fee: 0.50%
    • Positions on $100: 100+
    • US states: All 50 (+ DC)
    • Best for: Genetic algorithms (small orders)
    
  BINANCE.US:
    • Min order: $10
    • Maker fee: 0.10%
    • Taker fee: 0.10%
    • Positions on $100: 10-50
    • US states: Limited
    • Best for: Larger positions

SECTION 4: CRYPTO.COM API CREDENTIALS (Mode-dependent)
───────────────────────────────────────────────────────

HOW TO GET CRYPTO.COM API KEYS:

For Sandbox (Testing):
  1. Go to: https://uat.crypto.com
  2. Create account (separate from live)
  3. Log in
  4. Top right menu → "Account"
  5. "API" section
  6. "Create new key"
  7. Name: something like "SentimentAnalyzer"
  8. Permissions: Check "trading.order.create", "trading.order.view", "account.profile"
  9. Copy API Key and Secret
  10. Paste into .env:
      CRYPTO_COM_API_KEY=your_sandbox_key_here
      CRYPTO_COM_API_SECRET=your_sandbox_secret_here
  11. Set CRYPTO_COM_REST_URL=https://uat.crypto.com/exchange/rest/v2
  12. Set TRADING_MODE=sandbox

For Live (Real Trading):
  1. Go to: https://exchange.crypto.com
  2. Create account
  3. Verify identity (KYC)
  4. Fund account with $100-500 (start small!)
  5. Top right menu → "Account"
  6. "API" section
  7. "Create new key"
  8. Name: "SentimentAnalyzer_Live"
  9. Permissions: Same as sandbox
  10. Copy API Key and Secret
  11. Paste into .env:
      CRYPTO_COM_API_KEY=your_live_key_here
      CRYPTO_COM_API_SECRET=your_live_secret_here
  12. Verify CRYPTO_COM_LIVE_URL=https://exchange.crypto.com/exchange/rest/v2
  13. Set TRADING_MODE=live
  14. Set REQUIRE_MANUAL_APPROVAL=true (very important!)

CRYPTO_COM_API_KEY=
  • What it is: API authentication key
  • Where to get: Crypto.com Exchange → Account → API
  • For development: Leave empty (use TRADING_MODE=paper)
  • For sandbox: Fill with sandbox API key
  • For live: Fill with live API key
  • Security: Never commit to git, never share

CRYPTO_COM_API_SECRET=
  • What it is: API authentication secret
  • Where to get: Crypto.com Exchange → Account → API
  • For development: Leave empty
  • For sandbox: Fill with sandbox secret
  • For live: Fill with live secret
  • Security: Never commit to git, never share

CRYPTO_COM_REST_URL=https://uat.crypto.com/exchange/rest/v2
  • What it is: API endpoint URL
  • For sandbox: https://uat.crypto.com/exchange/rest/v2 (default)
  • For live testing: https://exchange.crypto.com/exchange/rest/v2 (but use TRADING_MODE=sandbox)
  • Do not change unless instructed

CRYPTO_COM_LIVE_URL=https://exchange.crypto.com/exchange/rest/v2
  • What it is: Live production API URL
  • Default: https://exchange.crypto.com/exchange/rest/v2
  • Only used when TRADING_MODE=live

CRYPTO_COM_TRADING_PAIR=BTC_USDT
  • What it is: Main trading pair (what to buy/sell)
  • Default: BTC_USDT (Bitcoin)
  • Other examples:
    • ETH_USDT (Ethereum)
    • SOL_USDT (Solana)
    • DOGE_USDT (Dogecoin)
  • Crypto.com format: BASE_QUOTE (with underscore)

SECTION 5: TRADING PARAMETERS (Risk management)
────────────────────────────────────────────────

TRADING_INITIAL_CAPITAL=100
  • What it is: Starting amount in USDT
  • Default: 100
  • Development: 100 (enough to test)
  • Live: 100-500 (start small, scale after 2 weeks)
  • Never trade with more than you can afford to lose
  • Example: TRADING_INITIAL_CAPITAL=500 (start with $500)

TRADING_MAX_LOSS_PERCENT=5
  • What it is: Kill switch - stop trading if you lose this %
  • Default: 5% (lose $5 on $100 capital)
  • Example calculation:
    • Capital: $100
    • Max loss: 5%
    • Kill switch at: $95
    • Actual loss threshold: $5
  • Lower = more conservative (2-3% good for live)
  • Higher = more risk-taking (5-10% aggressive)

TRADING_MAX_POSITION_PERCENT=15
  • What it is: Max size per single trade
  • Default: 15% of current capital
  • Example calculation:
    • Capital: $100
    • Max position: 15%
    • Max per trade: $15 (can't put more than $15 in one position)
  • Purpose: Prevents over-concentration
  • Recommended: 10-20% for trading

TRADING_MAX_OPEN_POSITIONS=3
  • What it is: How many simultaneous trades allowed
  • Default: 3 (max 3 open trades at once)
  • Example: If 3 positions are open, can't open a 4th
  • Lower = more conservative
  • Higher = more risk but more diversification

REQUIRE_MANUAL_APPROVAL=true
  • What it is: Require human approval before each trade (LIVE mode only)
  • Options: true | false
  • Default: true (STRONGLY RECOMMENDED)
  • For live trading: Keep true (must approve each trade)
  • For sandbox/paper: Can set to false (auto-execute)
  • ⚠️ Set to false only if you understand the risk

SECTION 6: SENTIMENT ANALYSIS (Optional, for external APIs)
──────────────────────────────────────────────────────────

COINGECKO_API_KEY=
  • What it is: CoinGecko API key for better rate limits
  • Where to get: https://www.coingecko.com/api/documentation
  • Required: No (free tier works without key)
  • Optional: Get key if you get rate limited

NEWSAPI_API_KEY=
  • What it is: NewsAPI key for crypto news sentiment
  • Where to get: https://newsapi.org
  • Required: No
  • Optional: Improves news sentiment analysis

SECTION 7: SOCIAL MEDIA (Optional, for social sentiment)
──────────────────────────────────────────────────────

TWITTER_BEARER_TOKEN=
  • What it is: Twitter API token for tweet sentiment
  • Where to get: https://developer.twitter.com/
  • Required: No (social features work without it)
  • Optional: Enables Twitter social sentiment

REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
  • What it is: Reddit API credentials
  • Required: No
  • Optional: Enables Reddit sentiment analysis

TELEGRAM_API_TOKEN=
DISCORD_BOT_TOKEN=
  • What it is: Social platform tokens
  • Required: No
  • Optional: Enables respective platform monitoring

SECTION 8: SCHEDULING (Optional, for automation)
────────────────────────────────────────────────

ENABLE_SENTIMENT_CRON=true
SENTIMENT_CRON_SCHEDULE=0 * * * *
  • What: Run sentiment analysis every hour
  • Default: Every hour
  • "0 * * * *" = at minute 0 of every hour
  • Other examples:
    • "0 */6 * * *" = every 6 hours
    • "0 0 * * *" = daily at midnight
    • "*/15 * * * *" = every 15 minutes

ENABLE_SOCIAL_CRON=true
SOCIAL_CRON_SCHEDULE=0 * * * *
  • What: Run social media scraping every hour
  • Default: Every hour (same as sentiment)

ENABLE_COMPETITION_CRON=false
COMPETITION_CRON_SCHEDULE=0 */6 * * *
  • What: Run MARL competitions every 6 hours
  • Default: Disabled (enable after agent system ready)
  • "0 */6 * * *" = every 6 hours

SECTION 9: MARL AGENT SETTINGS (Optional)
──────────────────────────────────────────

AGENT_POPULATION_SIZE=10
  • What it is: Number of trading agents
  • Default: 10
  • Higher = more diversity, slower
  • Lower = faster, less diversity

COMPETITIONS_PER_BATCH=5
  • What it is: Competitions per scheduler run
  • Default: 5
  • Higher = more training, slower execution

COMPETITION_DURATION_STEPS=100
  • What it is: How long each competition lasts
  • Default: 100 trading steps
  • Longer = better testing, slower

ENABLE_EVOLUTION=false
  • What it is: Enable genetic algorithms
  • Default: false (enable after Phase 1 complete)
  • When enabled: Agents breed and mutate

---

FRONTEND SETUP (.env) - COMPLETE GUIDE
=======================================

LOCATION: sentiment-analyzer/frontend/.env

CRITICAL SETTINGS:
──────────────────

REACT_APP_API_URL=http://localhost:3000/api
  • What it is: Backend API address
  • Development: http://localhost:3000/api (default)
  • Production: Change to your actual backend URL
  • Examples:
    • Local: http://localhost:3000/api
    • Cloud: https://sentiment-analyzer.azurewebsites.net/api
    • Domain: https://api.yourdomain.com
  • NO trailing slash, includes /api
  • This is critical - if wrong, all API calls fail

REACT_APP_ENV=development
  • What it is: Environment mode
  • Options: development | staging | production
  • Development: Shows debug logs, warnings
  • Production: Hides debug output

FEATURE FLAGS:
──────────────

REACT_APP_ENABLE_AGENTS=true
REACT_APP_ENABLE_TRADING=true
REACT_APP_ENABLE_SENTIMENT=true
REACT_APP_ENABLE_SOCIAL_SENTIMENT=true
REACT_APP_ENABLE_EVOLUTION=false
  • What they are: Enable/disable UI sections
  • true = show that section
  • false = hide that section
  • Default: Keep most true, EVOLUTION false until Phase 6

UI CUSTOMIZATION:
─────────────────

REACT_APP_PRIMARY_COLOR=#0070c9
REACT_APP_SECONDARY_COLOR=#6c757d
REACT_APP_SUCCESS_COLOR=#28a745
REACT_APP_DANGER_COLOR=#dc3545
  • What they are: Color scheme
  • Format: Hex color codes (e.g., #FF0000 = red)
  • Safe defaults provided
  • Customize for your brand

REACT_APP_THEME=light
  • What it is: Light or dark mode
  • Options: light | dark
  • Default: light

REACT_APP_TITLE=Sentiment Analyzer
  • What it is: Browser tab title
  • Appears in browser title bar and header
  • Customize as desired

DATA REFRESH INTERVALS:
───────────────────────

REACT_APP_DASHBOARD_REFRESH_INTERVAL=30000
  • What it is: Dashboard updates every 30 seconds
  • Unit: Milliseconds
  • 30000 = 30 seconds
  • Lower = more real-time (more API calls)
  • Higher = slower updates (fewer API calls)
  • Set to 0 to disable auto-refresh

REACT_APP_AGENT_REFRESH_INTERVAL=60000
REACT_APP_SENTIMENT_REFRESH_INTERVAL=60000
REACT_APP_LEADERBOARD_REFRESH_INTERVAL=120000
  • What they are: Update intervals for specific sections
  • Leaderboard slower (120s) than agent data (60s)
  • Adjust based on your API rate limits

PAGINATION SETTINGS:
────────────────────

REACT_APP_DEFAULT_PAGE_SIZE=50
  • What it is: How many agents per page
  • Default: 50
  • Lower = faster loading, more pages
  • Higher = slower loading, fewer pages

REACT_APP_LEADERBOARD_PAGE_SIZE=20
  • What it is: Leaderboard shows top 20
  • Default: 20 (top 20 agents)

OTHER PAGES:
────────────

REACT_APP_SOCIAL_ITEMS_PAGE_SIZE=20
REACT_APP_SENTIMENT_HISTORY_PAGE_SIZE=10
  • What they are: Items per page for different sections
  • Adjust if pages load slowly

CHART SETTINGS:
────────────────

REACT_APP_CHART_ANIMATIONS=true
REACT_APP_CHART_ANIMATION_DURATION=300
  • What they are: Smooth chart animations
  • Set to false if charts stutter on slow devices
  • Duration: 300ms (0.3 seconds) default

NOTIFICATIONS:
────────────────

REACT_APP_ENABLE_NOTIFICATIONS=true
REACT_APP_NOTIFICATION_TIMEOUT=5000
  • What they are: Success/error message popups
  • true = show notifications
  • Timeout: 5000ms (disappear after 5 seconds)

REACT_APP_ENABLE_SOUND_ALERTS=false
  • What it is: Audio alerts for events
  • Default: false (quiet)
  • Set true for audio alerts

DEVELOPMENT SETTINGS:
────────────────────

REACT_APP_DEBUG=true
REACT_APP_LOG_REQUESTS=false
REACT_APP_VERBOSE_ERRORS=false
REACT_APP_MOCK_API=false
  • Debug: true for development, false for production
  • Log_Requests: true to see all API calls
  • Verbose_Errors: true for detailed error messages
  • Mock_API: NEVER set to true in production

---

STEP-BY-STEP SETUP GUIDE
========================

STEP 1: COPY TEMPLATE FILES (5 minutes)
──────────────────────────────────────

In your project directory:

  cd sentiment-analyzer

Copy backend template:
  cp backend.env.template backend/.env

Copy frontend template:
  cp frontend.env.template frontend/.env

Verify files exist:
  ls backend/.env
  ls frontend/.env

STEP 2: DEVELOPMENT SETUP (10 minutes)
──────────────────────────────────────

For PAPER MODE (simulated, no real API):

backend/.env:
  TRADING_MODE=paper
  TRADING_PROVIDER=crypto-com
  TRADING_INITIAL_CAPITAL=100
  TRADING_MAX_LOSS_PERCENT=5
  # Leave all API keys empty
  CRYPTO_COM_API_KEY=
  CRYPTO_COM_API_SECRET=

frontend/.env:
  REACT_APP_API_URL=http://localhost:3000/api
  REACT_APP_ENV=development
  # Keep all other defaults

Start backend:
  cd backend && npm start
  # Should see: "Server listening on port 3000"

Start frontend (new terminal):
  cd frontend && npm start
  # Should open http://localhost:3000 in browser

Test:
  • Navigate to Dashboard
  • Should see empty agent grid
  • No errors in browser console
  • No errors in terminal

STEP 3: SANDBOX SETUP (30 minutes)
──────────────────────────────────

For API TESTING with FAKE MONEY:

Get Sandbox Credentials:
  1. Go to https://uat.crypto.com
  2. Create account
  3. Log in
  4. Account → API
  5. Create key: name="SentimentAnalyzer", permissions="trading.order.create, trading.order.view"
  6. Copy Key and Secret

backend/.env:
  TRADING_MODE=sandbox
  CRYPTO_COM_API_KEY=paste_your_sandbox_key_here
  CRYPTO_COM_API_SECRET=paste_your_sandbox_secret_here
  CRYPTO_COM_REST_URL=https://uat.crypto.com/exchange/rest/v2

Restart backend:
  # Stop current backend (Ctrl+C)
  npm start

Test:
  • Should connect to Crypto.com sandbox
  • No actual money at risk
  • API calls are real but use test account
  • Can place test trades

STEP 4: LIVE SETUP (1 hour, ⚠️ REAL MONEY)
───────────────────────────────────────────

⚠️ CRITICAL: Only do this after testing sandbox for 1-2 weeks

Get Live Credentials:
  1. Go to https://exchange.crypto.com
  2. Create account
  3. Complete KYC verification
  4. Deposit $100-500 (start small!)
  5. Account → API
  6. Create key: name="SentimentAnalyzer_Live"
  7. Copy Key and Secret

backend/.env:
  TRADING_MODE=live
  CRYPTO_COM_API_KEY=paste_your_live_key_here
  CRYPTO_COM_API_SECRET=paste_your_live_secret_here
  TRADING_INITIAL_CAPITAL=100
  REQUIRE_MANUAL_APPROVAL=true  # ⚠️ CRITICAL

Restart backend:
  # Stop current backend
  npm start

SAFETY CHECKLIST BEFORE GOING LIVE:
  ☐ Account funded with $100-500
  ☐ API keys are live keys (not sandbox)
  ☐ REQUIRE_MANUAL_APPROVAL=true
  ☐ TRADING_INITIAL_CAPITAL matches your account
  ☐ Tested sandbox for 1-2 weeks
  ☐ Understand all trading parameters
  ☐ Understand risk management rules
  ☐ Can afford to lose the capital
  ☐ Backend tested with live API connection
  ☐ All team members briefed

---

TROUBLESHOOTING
===============

PROBLEM: "Cannot find API endpoint"
SOLUTION: Check REACT_APP_API_URL in frontend/.env
  • Is it correct? (should be http://localhost:3000/api)
  • Is backend running? (check port 3000)
  • Is there a typo?

PROBLEM: "API Key invalid"
SOLUTION: Check API credentials in backend/.env
  • For sandbox: Is TRADING_MODE=sandbox?
  • Are keys from right environment (sandbox vs live)?
  • Are there extra spaces before/after key?
  • Did you save .env file?
  • Restart backend after changing .env

PROBLEM: "Minimum order validation failed"
SOLUTION: Check TRADING_INITIAL_CAPITAL
  • Must be at least $1 for Crypto.com
  • For live trading: Use $100+
  • Example: TRADING_INITIAL_CAPITAL=100

PROBLEM: "Port 3000 already in use"
SOLUTION: Change port in backend/.env
  • SERVER_PORT=5000
  • Then backend runs on port 5000
  • Update frontend: REACT_APP_API_URL=http://localhost:5000/api

PROBLEM: "No agents appearing in UI"
SOLUTION: Normal in paper mode
  • Paper mode needs to run competitions first
  • Check backend logs for errors
  • Ensure ENABLE_SENTIMENT_CRON=true (for sentiment data)

---

SECURITY BEST PRACTICES
=======================

✅ DO:
  • Keep .env files out of git (add *.env to .gitignore)
  • Use environment variables for all secrets
  • Rotate API keys regularly (monthly)
  • Use read-only API keys where possible
  • Keep live keys separate from sandbox keys
  • Use strong API key names (hard to guess)
  • Monitor API usage for suspicious activity

❌ DON'T:
  • Commit .env to git
  • Share API keys with others
  • Use same API key in multiple projects
  • Log API keys in error messages
  • Put API keys in code (always use .env)
  • Share .env file unencrypted
  • Use default/weak API key names
  • Keep API keys in browser local storage

---

FINAL CHECKLIST
===============

Before running:
  ☐ Backend .env created and filled
  ☐ Frontend .env created and filled
  ☐ API keys added if using sandbox/live
  ☐ Backend port not in use (default 3000)
  ☐ .env files in .gitignore
  ☐ npm dependencies installed
  ☐ All values verified

To start:
  ☐ Terminal 1: cd backend && npm start
  ☐ Terminal 2: cd frontend && npm start
  ☐ Browser opens to http://localhost:3000
  ☐ No errors in console

---

Questions or Issues?
  • Check troubleshooting section above
  • Verify all .env values
  • Check backend logs for specific errors
  • Test API connection: curl http://localhost:3000/api/agents
