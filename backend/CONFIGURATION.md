# Backend Configuration Variables

All environment variables for `backend/.env` organized by category.

## Server Configuration

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `PORT` | TCP port the Express server listens on | Any available port (default: `3000`) | No |
| `NODE_ENV` | Node environment (controls logging) | `development` or `production` | No |
| `LOG_LEVEL` | Winston log level (debug, info, warn, error) | Choose level for your environment | No |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | Your domain(s) or `*` for dev | No |

## Database

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `DATABASE_PATH` | Path to SQLite database file | Local file path (default: `./sentiment_analyzer.db`) | No |

## Authentication & Security

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `BROKER_MASTER_KEY` | AES-256-GCM key for encrypting stored secrets | Generate 64-char hex string or any string (SHA-256 derived); use PowerShell: `[BitConverter]::ToString([byte[]](1..32 \| ForEach-Object { Get-Random -Maximum 256 })) -replace '-'` | **Yes** |
| `CONFIG_ADMIN_PASSWORD` | Password for `/api/admin/config` endpoints | Generate strong random password; use PowerShell: `-join ((48..57) + (65..90) + (97..122) \| Get-Random -Count 24 \| ForEach-Object { [char]$_ })` | **Yes** |
| `API_SECRET_KEY` | Auth token for `POST /api/refresh-sentiment` and MARL broker routes | Generate any strong random string (e.g., `openssl rand -base64 32`) | No |

## Claude AI (Anthropic)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `CLAUDE_API_KEY` | Anthropic API key for AI-powered sentiment analysis | https://console.anthropic.com → API keys | **Yes** |
| `CLAUDE_MODEL` | Model ID for Claude API calls | `claude-3-5-sonnet-20241022` or other Anthropic model | No |

## News & Data APIs

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `NEWSAPI_API_KEY` | NewsAPI key for crypto news headlines | https://newsapi.org → API keys | **Yes** |
| `FINBERT_API_URL` | HuggingFace FinBERT inference endpoint for financial sentiment | `https://api-inference.huggingface.co/models/ProsusAI/finbert` | No |
| `HUGGINGFACE_API_TOKEN` | HuggingFace API token (for FinBERT proxy Bearer header) | https://huggingface.co/settings/tokens | No |
| `LUNARCRUSH_API_KEY` | LunarCrush API key for on-chain/social signal data | https://www.lunarcrush.com/api | No |
| `ONCHAIN_API_KEY` | API key for on-chain metrics service | Your on-chain provider (Glassnode, CryptoQuant, etc.) | No |
| `ONCHAIN_API_URL` | Base URL for on-chain API | Your on-chain provider's API endpoint | No |

## Trading & Exchange Configuration

### General Trading Settings

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `TRADING_MODE` | Trading mode: `paper`, `realistic_paper`, `sandbox`, or `live` | Choose `paper` for dev, `sandbox` for testing, `live` for real money | No |
| `TRADING_PROVIDER` | Exchange provider: `crypto-com`, `binance-us`, `coinbase`, or `alpaca` | Choose based on your preference (Crypto.com is default) | No |
| `SHADOW_MODE` | Upgrade default paper mode to realistic_paper for shadow harness | Set to `true` to include fees/slippage in simulation | No |
| `TRADING_INITIAL_CAPITAL` | Starting USDT capital for paper trading | Any amount (default: `10000`) | No |

### Trading Risk Parameters

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `TRADING_MAX_LOSS_PERCENT` | Kill-switch threshold as % of initial capital | Percentage value (default: `5`) | No |
| `TRADING_MAX_POSITION_PERCENT` | Max notional value of single trade as % of capital | Percentage value (default: `15`) | No |
| `TRADING_MAX_OPEN_POSITIONS` | Maximum concurrent open positions | Number (default: `3`) | No |
| `REQUIRE_MANUAL_APPROVAL` | Require approval before executing trades | `true` or `false` (default: `false`) | No |
| `REALISTIC_PAPER_FEE_PRESET` | Fee preset for realistic_paper mode | `binance-us`, `crypto-com`, `coinbase`, or `alpaca` | No |
| `REALISTIC_PAPER_SLIPPAGE_BUY_PCT` | BUY-side slippage fraction (0.001 = 0.1%) | Decimal value (default: `0.001`) | No |
| `REALISTIC_PAPER_SLIPPAGE_SELL_PCT` | SELL-side slippage fraction (0.001 = 0.1%) | Decimal value (default: `0.001`) | No |

### Crypto.com Exchange (when `TRADING_PROVIDER=crypto-com`)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `CRYPTO_COM_API_KEY` | Crypto.com API key for sandbox/live trading | https://exchange.crypto.com → Account → API | Conditional* |
| `CRYPTO_COM_API_SECRET` | Crypto.com API secret | https://exchange.crypto.com → Account → API | Conditional* |
| `CRYPTO_COM_TRADING_PAIR` | Default trading pair | `BTC_USDT`, `ETH_USDT`, etc. (default: `BTC_USDT`) | No |
| `CRYPTO_COM_REST_URL` | Sandbox API base URL | `https://uat.crypto.com/exchange/v1` (default) | No |
| `CRYPTO_COM_LIVE_URL` | Production API base URL | `https://api.crypto.com/exchange/v1` (default) | No |

### Coinbase Exchange (when `TRADING_PROVIDER=coinbase`)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `COINBASE_API_KEY` | Coinbase Advanced Trade API key | https://coinbase.com/settings/api | Conditional* |
| `COINBASE_API_SECRET` | Coinbase Advanced Trade API secret (base64-encoded) | https://coinbase.com/settings/api (already base64-encoded) | Conditional* |
| `COINBASE_TRADING_PAIR` | Default trading pair | `BTC-USD`, `ETH-USD`, etc. (default: `BTC-USD`) | No |

### Binance.US Exchange (when `TRADING_PROVIDER=binance-us`)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `BINANCE_SANDBOX_API_KEY` | Binance testnet API key | https://testnet.binance.vision → API Management | Conditional* |
| `BINANCE_SANDBOX_API_SECRET` | Binance testnet API secret | https://testnet.binance.vision → API Management | Conditional* |
| `BINANCE_SANDBOX_TEST_NET` | Testnet base URL | `https://testnet.binance.vision` (default) | No |
| `BINANCE_LIVE_API_KEY` | Binance.US live API key (⚠️ real money) | https://www.binance.us → Account → API Management | Conditional* |
| `BINANCE_LIVE_API_SECRET` | Binance.US live API secret (⚠️ real money) | https://www.binance.us → Account → API Management | Conditional* |
| `BINANCE_LIVE_URL` | Live API base URL | `https://api.binance.us` (default) | No |

### Alpaca Exchange (when `TRADING_PROVIDER=alpaca`)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `ALPACA_API_KEY` | Alpaca API key for trading and data | https://app.alpaca.markets/brokerage/account/api-keys | Conditional* |
| `ALPACA_API_SECRET` | Alpaca API secret | https://app.alpaca.markets/brokerage/account/api-keys | Conditional* |
| `ALPACA_PAPER_API_URL` | Alpaca paper trading URL | `https://paper-api.alpaca.markets` (default) | No |
| `ALPACA_LIVE_API_URL` | Alpaca live trading URL | `https://api.alpaca.markets` (default) | No |
| `ALPACA_DATA_URL` | Alpaca market data URL | `https://data.alpaca.markets` (default) | No |

## Scheduled Jobs (Cron)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `SENTIMENT_JOB_CRON` | Cron schedule for nightly sentiment re-scoring | Cron expression (default: `0 2 * * *` = 2 AM daily) | No |
| `SENTIMENT_BATCH_SIZE` | Number of coins per batch during sentiment job | Integer (default: `50`) | No |
| `TRENDING_JOB_CRON` | Cron schedule for trending topic aggregation | Cron expression (default: `*/30 * * * *` = every 30 min) | No |
| `SOCIAL_SCRAPE_CRON` | Cron schedule for social media scraping | Cron expression (default: `0 * * * *` = hourly) | No |
| `TRENDING_WINDOW_HOURS` | Lookback window for trending discovery (hours) | Integer (default: `24`) | No |
| `SOCIAL_HISTORY_DAYS` | Age (days) before pruning social items | Integer (default: `30`) | No |

## Social Media Scrapers

All social scraper variables are **optional**. Scrapers without credentials are silently skipped.

### Twitter / X

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `TWITTER_BEARER_TOKEN` | Twitter API v2 Bearer Token | https://developer.twitter.com → API keys & tokens | No |
| `X_BEARER_TOKEN` | Alternative name for Twitter Bearer Token (takes priority) | https://developer.twitter.com → API keys & tokens | No |

### Reddit

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `REDDIT_CLIENT_ID` | Reddit OAuth2 client ID | https://reddit.com/prefs/apps → create "script" app | No |
| `REDDIT_CLIENT_SECRET` | Reddit OAuth2 client secret | https://reddit.com/prefs/apps → copy from created app | No |
| `REDDIT_USERNAME` | Reddit bot account username | Username of bot account for "script" app | No |
| `REDDIT_PASSWORD` | Reddit bot account password | Password for bot account | No |

### Discord

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot token | https://discord.com/developers/applications → create app → Bot tab | No |
| `DISCORD_CHANNEL_IDS` | Comma-separated Discord channel IDs to monitor | Right-click channel (Developer Mode on) → Copy Channel ID | No |

### Telegram

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | Chat with @BotFather on Telegram → `/newbot` | No |
| `TELEGRAM_CHANNEL_USERNAMES` | Comma-separated public channel usernames | Channel usernames (e.g., `@cryptonews,@bitcoinmagazine`) | No |

### YouTube

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | https://console.cloud.google.com → enable YouTube Data API v3 → create API key | No |

### TikTok (via RapidAPI)

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `RAPIDAPI_KEY` | RapidAPI key for TikTok scraper | https://rapidapi.com → sign up → copy API key from My Apps | No |
| `RAPIDAPI_TIKTOK_HOST` | RapidAPI TikTok endpoint host | `tiktok-scraper7.p.rapidapi.com` (default) | No |

## Social Ingest Pipeline

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `INGEST_QUEUE_CONCURRENCY` | Concurrent items processed by ingest queue | Integer (default: `4`); increase for more cores | No |
| `TRENDING_MIN_MENTIONS` | Minimum mentions for topic to appear in trending | Integer (default: `3`) | No |

## Infrastructure / Queue Workers

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `REDIS_URL` | Redis connection URL for BullMQ job queues | `redis://localhost:6379` or your Redis instance; leave empty to disable queues | No |
| `TOURNAMENT_WORKER_CONCURRENCY` | Max concurrent tournament jobs in worker process | Integer (default: `2`) | No |
| `SCRAPER_WORKER_CONCURRENCY` | Max concurrent scraper jobs in worker process | Integer (default: `1`) | No |

## Observability

| Variable | Purpose | Where to Get It | Required |
|---|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Azure Application Insights connection string | Azure Portal → Application Insights → connection string | No |

---

## Notes

- **Conditional**: Only required if `TRADING_MODE=sandbox` or `TRADING_MODE=live` AND `TRADING_PROVIDER` matches that exchange.
- **Runtime Config**: Most variables can be managed at runtime via the Admin UI (`/api/admin/config/*`) after startup. `.env` values serve as fallbacks.
- **Security**: Never commit `.env` to git. Use `.env.template` for safe defaults. Keep `BROKER_MASTER_KEY` and `CONFIG_ADMIN_PASSWORD` secure.

