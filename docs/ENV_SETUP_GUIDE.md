# Environment Variables Reference

> **Files:** `backend/.env` · `frontend/.env`
> **Rule:** Never commit `.env` to git. Use `.env.example` or `.env.template` for safe templates.

---

## Backend (`backend/.env`)

Variables are grouped by the subsystem that reads them. Defaults shown are what the code falls back to when the variable is absent.

---

### Server

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `PORT` | No | `3000` | `3000` | TCP port the Express server listens on. |
| `NODE_ENV` | No | `development` | `production` | Node environment. Controls log verbosity and React warnings. Set to `production` for live deployments. |
| `LOG_LEVEL` | No | `info` | `debug` | Winston log level: `debug` · `info` · `warn` · `error`. Use `debug` locally, `info` or higher in production. |
| `ALLOWED_ORIGINS` | No | `*` | `http://localhost:5173` | CORS allowed origins passed to `cors()`. Comma-separate multiple values. Defaults to wildcard in dev. |

---

### Database

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `DATABASE_PATH` | No | `./sentiment_analyzer.db` | `./sentiment_analyzer.db` | Path to the SQLite file shared by `StorageService` and `SocialStorageService`. Both services open connections to the same path. |

---

### Authentication & Security

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `API_SECRET_KEY` | **Yes** | — | `mysecretkey123` | Bearer token that gates `POST /api/refresh-sentiment` and all MARL broker routes (`X-API-Key` header). Without this, those endpoints return 401. |
| `BROKER_MASTER_KEY` | Conditional | — | `aabbccddeeff00112233445566778899` | 32-character hex key used for AES-256-GCM encryption of broker credentials in SQLite. Required whenever `TRADING_MODE` is `sandbox` or `live`. Paper mode does not need it. |

---

### Claude AI (Anthropic)

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `CLAUDE_API_KEY` | **Yes** | — | `sk-ant-api03-...` | Anthropic API key. Used by the `ClaudeSentimentService` for AI-powered sentiment analysis. Without it the service falls back to local keyword scoring. |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | `claude-opus-4-6` | Model ID passed to the Anthropic chat completions call. Override to switch model tier. |

---

### News

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `NEWSAPI_API_KEY` | **Yes** | — | `abc123def456` | NewsAPI.org key used by `ContentSignalsService` to fetch crypto news headlines. The `/health` endpoint reports `misconfigured` if absent. |

---

### FinBERT / ML Scoring

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `FINBERT_API_URL` | No | _(disabled)_ | `https://api-inference.huggingface.co/models/ProsusAI/finbert` | HuggingFace Inference API URL for the FinBERT financial sentiment model. When set, the item scorer sends text to this endpoint instead of using the local keyword analyzer. Leave empty to use local scoring only. |

> **Note:** `HUGGINGFACE_API_TOKEN` is not read by the code directly — add it as an `Authorization: Bearer` header inside your FinBERT proxy if needed.

---

### LunarCrush (On-chain Signals)

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `LUNARCRUSH_API_KEY` | No | _(disabled)_ | `lc_abc123` | LunarCrush API key. Enables richer social/on-chain signal data in the MARL competition engine. The `/api/marl/status` endpoint advertises `advancedSignals: true` when this or `FINBERT_API_URL` is set. |
| `ONCHAIN_API_KEY` | No | _(disabled)_ | `oc_key123` | API key for the on-chain metrics service (`OnchainService`). Without it `getMetrics()` returns `null` and on-chain features are silently skipped. |
| `ONCHAIN_API_URL` | No | _(service default)_ | `https://api.onchain-provider.io/v1` | Base URL for the on-chain API. Falls back to the hardcoded default inside `onchain.ts`. |

---

### Trading Mode & Exchange Selection

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `TRADING_MODE` | No | `paper` | `sandbox` | `paper` — fully simulated, no API calls. `sandbox` — real exchange API with test funds. `live` — real money. ⚠️ Start with `paper`. |
| `TRADING_PROVIDER` | No | `crypto-com` | `binance-us` | Which exchange to use for `sandbox`/`live` modes. `crypto-com` (default) or `binance-us`. Ignored when `TRADING_MODE=paper`. |

---

### Trading Risk Parameters

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `TRADING_INITIAL_CAPITAL` | No | `10000` | `100` | Starting USDT capital for the paper exchange and the kill-switch baseline. |
| `TRADING_MAX_LOSS_PERCENT` | No | `5` | `5` | Kill-switch threshold as a % of initial capital. BUY orders are blocked once cumulative loss exceeds this. SELL orders are never blocked. |
| `TRADING_MAX_POSITION_PERCENT` | No | `15` | `15` | Maximum notional value of a single trade as a % of current capital. |
| `TRADING_MAX_OPEN_POSITIONS` | No | `3` | `3` | Maximum concurrent open positions. New BUY orders are rejected when this limit is reached. |
| `REQUIRE_MANUAL_APPROVAL` | No | `false` | `true` | When `true`, trades are logged as requiring approval before execution. Set to `true` for live trading. |

---

### Crypto.com Exchange

Only needed when `TRADING_PROVIDER=crypto-com` and `TRADING_MODE` is `sandbox` or `live`.

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `CRYPTO_COM_API_KEY` | Conditional | — | `key_abc123` | Crypto.com API key. Get from: exchange.crypto.com → Account → API. |
| `CRYPTO_COM_API_SECRET` | Conditional | — | `secret_xyz789` | Crypto.com API secret paired with the key above. |
| `CRYPTO_COM_TRADING_PAIR` | No | `BTC_USDT` | `ETH_USDT` | Default instrument name used for order history and open-order queries. |
| `CRYPTO_COM_REST_URL` | No | `https://uat.crypto.com/exchange/v1` | `https://uat.crypto.com/exchange/v1` | Base URL for sandbox (UAT) API calls. Used when `TRADING_MODE=sandbox`. |
| `CRYPTO_COM_LIVE_URL` | No | `https://api.crypto.com/exchange/v1` | `https://api.crypto.com/exchange/v1` | Base URL for production API calls. Used when `TRADING_MODE=live`. |

---

### Coinbase Advanced Trade

Only needed when `TRADING_PROVIDER=coinbase` and `TRADING_MODE` is `sandbox` or `live`.

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `COINBASE_API_KEY` | Conditional | — | `key_abc123` | Coinbase Advanced Trade API key. Create at coinbase.com/settings/api. Uses Coinbase Exchange Pro format (CB-ACCESS-KEY scheme). |
| `COINBASE_API_SECRET` | Conditional | — | `base64secret==` | API secret. **Must be base64-encoded** — Coinbase provides it already encoded; paste it as-is. |
| `COINBASE_TRADING_PAIR` | No | `BTC-USD` | `ETH-USD` | Default Coinbase product ID used for order history and open-order queries. Uses hyphen format (`BTC-USD`), not underscore. |

> **Sandbox:** Set `TRADING_MODE=sandbox` and point keys to your Coinbase sandbox account. The client automatically uses `api-sandbox.coinbase.com/api/v3/brokerage`. No additional URL env var needed.

---

### Binance.US Exchange (Legacy)

Only needed when `TRADING_PROVIDER=binance-us`. Crypto.com is the recommended default.

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `BINANCE_SANDBOX_API_KEY` | Conditional | — | `bskey_abc` | Testnet API key from testnet.binance.vision. |
| `BINANCE_SANDBOX_API_SECRET` | Conditional | — | `bssecret_xyz` | Testnet API secret. |
| `BINANCE_SANDBOX_TEST_NET` | No | `https://testnet.binance.vision` | `https://testnet.binance.vision` | Binance testnet base URL. |
| `BINANCE_LIVE_API_KEY` | Conditional | — | `blkey_abc` | Live Binance.US API key. ⚠️ Real money. |
| `BINANCE_LIVE_API_SECRET` | Conditional | — | `blsecret_xyz` | Live Binance.US API secret. |
| `BINANCE_LIVE_URL` | No | `https://api.binance.us` | `https://api.binance.us` | Binance.US production base URL. |

---

### Scheduled Jobs (Cron)

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `SENTIMENT_JOB_CRON` | No | `0 2 * * *` | `0 */6 * * *` | Cron schedule for the nightly sentiment re-score job that refreshes all coins in the database. |
| `SENTIMENT_BATCH_SIZE` | No | `50` | `25` | Number of coins processed per batch during the sentiment cron job and manual refresh. |
| `TRENDING_JOB_CRON` | No | `*/30 * * * *` | `*/15 * * * *` | Cron schedule for trending topic re-aggregation from stored social items. |
| `SOCIAL_SCRAPE_CRON` | No | `0 * * * *` | `0 */2 * * *` | Cron schedule for the social media scraping pipeline (all sources). |
| `TRENDING_WINDOW_HOURS` | No | `24` | `48` | Lookback window (hours) used when the trending cron re-discovers topics. |
| `SOCIAL_HISTORY_DAYS` | No | `30` | `14` | Age (days) after which social media items are pruned from the database. |

---

### Social Media Scrapers

All social scraper variables are optional. Scrapers that lack credentials are silently skipped; the pipeline continues with the remaining sources.

#### Twitter / X

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `TWITTER_BEARER_TOKEN` | No | _(disabled)_ | `AAAA...` | Twitter API v2 Bearer Token. Also accepted as `X_BEARER_TOKEN` — both names are checked, `X_BEARER_TOKEN` takes priority. Get from: developer.twitter.com. |
| `X_BEARER_TOKEN` | No | _(disabled)_ | `AAAA...` | Alias for `TWITTER_BEARER_TOKEN`. Takes priority if both are set. |

#### Reddit

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `REDDIT_CLIENT_ID` | No | _(disabled)_ | `abc123XYZ` | OAuth2 client ID from reddit.com/prefs/apps. |
| `REDDIT_CLIENT_SECRET` | No | _(disabled)_ | `secretABC` | OAuth2 client secret. |
| `REDDIT_USERNAME` | No | _(disabled)_ | `my_bot_account` | Reddit account username used for "script" app authentication. |
| `REDDIT_PASSWORD` | No | _(disabled)_ | `hunter2` | Password for the Reddit account above. |

#### Discord

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `DISCORD_BOT_TOKEN` | No | _(disabled)_ | `MTIz...abc` | Discord bot token. The bot must be added to the target servers with `Read Messages` permission. |
| `DISCORD_CHANNEL_IDS` | No | _(disabled)_ | `123456789,987654321` | Comma-separated list of channel IDs to monitor. |

#### Telegram

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | No | _(disabled)_ | `1234567890:AAF...` | Telegram Bot API token from @BotFather. The bot must be a member of the target channels. |
| `TELEGRAM_CHANNEL_USERNAMES` | No | _(disabled)_ | `@cryptonews,@bitcoinmagazine` | Comma-separated public channel usernames to monitor. |

#### TikTok (via RapidAPI)

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `RAPIDAPI_KEY` | No | _(disabled)_ | `abc123xyz...` | RapidAPI key for the TikTok scraper endpoint. |
| `RAPIDAPI_TIKTOK_HOST` | No | `tiktok-scraper7.p.rapidapi.com` | `tiktok-scraper7.p.rapidapi.com` | RapidAPI host header for the TikTok endpoint. |

#### YouTube

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `YOUTUBE_API_KEY` | No | _(disabled)_ | `AIza...` | YouTube Data API v3 key from Google Cloud Console. |

---

### Social Ingest Pipeline

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `INGEST_QUEUE_CONCURRENCY` | No | `4` | `8` | Number of items the ingest queue processes concurrently (scoring + DB upsert). Increase on machines with more cores. |
| `TRENDING_MIN_MENTIONS` | No | `3` | `5` | Minimum mention count for a topic to appear in trending results. Raise to reduce noise. |

---

### Azure / Observability

| Variable | Required | Default | Example | Description |
|---|---|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No | _(disabled)_ | `InstrumentationKey=xxx;...` | Azure Application Insights connection string. When set, a custom Winston transport ships structured logs to Azure Monitor. |

---

## Frontend (`frontend/.env`)

The frontend uses **Vite** with a dev proxy (`/api` → `http://localhost:3000`). The proxy target is hardcoded in `vite.config.ts` and is not configurable via `.env`.

**The current frontend source code does not read any `import.meta.env` variables.** The `.env` file in `frontend/` is a placeholder for future use if the API URL or feature flags need to be made configurable at build time. No restart or rebuild is required for API access changes — edit `vite.config.ts` instead.

---

### Planned / Future Frontend Variables

The variables below follow Vite naming conventions (`VITE_` prefix). They are documented here for reference but are **not currently consumed by the code**.

| Variable | Example | Intended Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Override the backend target in `vite.config.ts` for custom deployments. |
| `VITE_APP_TITLE` | `Sentiment Analyzer` | Browser tab title and dashboard header. |
| `VITE_ENABLE_DEVTOOLS` | `true` | Toggle React DevTools integration. |

> To make a variable available in React code today, prefix it with `VITE_` and access it via `import.meta.env.VITE_MY_VAR`. Then restart the Vite dev server.

---

## Quick-Start Minimal Config

The smallest `backend/.env` needed to run the full stack locally:

```bash
# Auth
API_SECRET_KEY=localdevkey

# AI & News
CLAUDE_API_KEY=sk-ant-api03-...
NEWSAPI_API_KEY=your_newsapi_key

# Trading (paper mode needs no exchange keys)
TRADING_MODE=paper
```

Everything else uses safe defaults. Add social scraper keys one at a time as you need them.

---

## Security Notes

- `API_SECRET_KEY` — treat like a password; rotate if exposed.
- `BROKER_MASTER_KEY` — losing this key makes stored broker credentials unrecoverable. Back it up securely.
- `CRYPTO_COM_API_SECRET` / `BINANCE_LIVE_API_SECRET` — grant only the minimum permissions needed (`trading.order.create`, `trading.order.cancel`, `trading.order.view`). Never grant withdrawal permissions to a bot key.
- `REDDIT_PASSWORD` — consider using a dedicated throwaway Reddit account for the bot rather than your personal account.
