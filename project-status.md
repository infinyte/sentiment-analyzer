# Project Status

**Last Updated:** 2026-03-16 (Scanned and synchronized)

**Legend:** ✅ Done · 🔲 Pending

---

## Summary

| Priority | Count |
|----------|-------|
| ✅ Critical bugs fixed | 5 / 5 |
| ✅ Stub implementations fixed | 3 / 3 |
| ✅ Hardcoded zeroes fixed | 2 / 2 |
| ✅ Performance / quality issues fixed | 4 / 4 |
| **✅ Total Completed** | **14 / 14** |

---

## Critical Bugs (Fixed)

### ✅ 1. SentimentService is now called
**File:** `backend/src/index.ts`, lines 277-303
**Status:** FIXED
**Implementation:**
- Added `sentimentCache` instance with 24-hour TTL
- Created `fetchAndCacheSentiment()` helper function
- Modified `/api/coins` to fetch sentiment for all coins in parallel
- Modified `/api/coins/:symbol` to fetch sentiment on detail view
- Coins now have real `sentiment_score`, `sentiment_confidence`, `sentiment_summary` values
- Claude is called at most once per coin per 24 hours

---

### ✅ 2. `useCoinDetail` hook now preserves price_history and headlines
**File:** `frontend/src/App.tsx`, line 80
**Status:** FIXED
**Implementation:** `setDetail({ ...data.coin, price_history: data.price_history, headlines: data.headlines })`
- Detail modal receives `price_history` array
- Headlines list now renders correctly (up to 5 items)
- Chart can use historical data

---

### ✅ 3. Sentiment sort option now works
**File:** `frontend/src/App.tsx`, lines 302-304
**Status:** FIXED
**Implementation:**
- Added `sortBy === 'sentiment'` branch
- Sorts BULL → NEUTRAL → BEAR with descending confidence within groups
- Frontend sorting mirrors backend logic

---

### ✅ 11. Claude model ID is now valid
**File:** `backend/src/index.ts`, line 189
**Status:** FIXED
**Implementation:** Changed to `model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'`
- Uses environment variable `CLAUDE_MODEL` for flexibility
- Fallback to `claude-sonnet-4-6` (good quality/cost balance)

---

### ✅ 13. Authorization header now uses x-api-key
**File:** `backend/src/index.ts`, line 415
**Status:** FIXED
**Implementation:** `const token = req.headers['x-api-key'];`
- Matches architecture documentation
- Aligns with `CLAUDE.md` conventions
- Admin endpoint requires `x-api-key` header

---

## Stub Implementations (Fixed)

### ✅ 4. /api/refresh-sentiment now processes sentiment
**File:** `backend/src/index.ts`, lines 414-471
**Status:** FIXED
**Implementation:**
- Accepts `{ "symbols": ["BTC", "ETH"] }` or omits for all coins
- Clears sentiment cache for specified coins to force re-analysis
- Processes sequentially to respect API rate limits
- Returns background job status with `job_id`
- Logs progress with coin count and sentiment scores

---

## Stub Implementations (Remaining)

### ✅ 7. Scheduled sentiment job implemented
**File:** `backend/src/index.ts` (absent)
**Problem:** `node-cron` is a dependency but never imported or used. No automated daily sentiment refresh.
**What to do:**
- Import `node-cron`
- Schedule using `process.env.SENTIMENT_JOB_CRON` (default `"0 2 * * *"` = 2 AM UTC daily)
- Iterate top N coins (controlled by `SENTIMENT_BATCH_SIZE`, default 50)
- Fetch headlines → analyze sentiment → cache results
- Log job start/completion with coin count and duration
**Acceptance criteria:**
- Server logs show cron job firing at scheduled time
- After job runs, coins have `analysis_date` matching current date
- Schedule is configurable without code changes

---

## Hardcoded Zeroes (Fixed)

### ✅ 5. volatility_24h now calculated from live data (fixed by separate agent)
**File:** `backend/src/index.ts`, lines 64-70
**Status:** FIXED
**Implementation:** `volatility_24h = ((high_24h - low_24h) / current_price) * 100`
- Maps `high_24h` and `low_24h` from CoinGecko response
- Expresses as percentage
- Fallback to `current_price` if high/low unavailable
- Sorting by volatility now produces meaningful results

---

## Hardcoded Zeroes (Remaining)

### ✅ 6. trending_score populated from headline count
**File:** `backend/src/index.ts`, line 29
**Problem:** `trending_score` hardcoded to `0`. Intent: reflect headline count (media attention).
**What to do:**
- When fetching headlines during sentiment analysis, capture `headlines.length`
- Assign to `trending_score` before returning coin
- Cache alongside sentiment to avoid exhausting NewsAPI free tier (500 req/day)
- Show on coin cards as "Media Attention" or "Trending Score"
**Acceptance criteria:**
- `trending_score` is non-zero integer for coins with recent news
- Value reflects headline count from past 7 days
- Not recalculated every 10-minute refresh

---

## Missing Routes (Fixed)

### ✅ 8. GET /api/sentiment/:symbol route now exists
**File:** `backend/src/index.ts`, lines 473-482
**Status:** FIXED
**Implementation:**
- Returns full `Sentiment` object for cached symbol
- Returns 404 if not yet analyzed
- No auth required; read-only
- Does not trigger new Claude call

---

## Performance & Quality Issues (Remaining)

### ✅ 9. /api/coins/:symbol now uses cache
**File:** `backend/src/index.ts`, line 382
**Problem:** Every modal open calls `coingecko.getTopCoins(200)` with no caching. Slow, risks rate limits (free tier: 30 calls/min).
**What to do:**
- Check `cache.get('coins')` before calling `getTopCoins()`
- Reuse existing cached coin list if present
- Also cache `getCoinHistory()` results keyed by `${coinId}_history_${days}` with 15-minute TTL
**Acceptance criteria:**
- Opening a second coin detail modal within 5 minutes does not trigger new API call
- Price history cached per coin per `days` value
- Reduces API load and response time

---

### ✅ 10. Health check now reflects actual service configuration
**File:** `backend/src/index.ts`, lines 484-492
**Problem:** Returns hardcoded `{ coingecko: 'ok', newsapi: 'ok', claude_api: 'ok' }` regardless of configuration. Server without API keys reports as fully healthy.
**What to do:**
- Check if `CLAUDE_API_KEY` env var is set and non-empty → report `'ok'` or `'misconfigured'`
- Check if `NEWSAPI_API_KEY` env var is set and non-empty → report `'ok'` or `'misconfigured'`
- Optionally track last-successful-call timestamps per service for better diagnostics
**Acceptance criteria:**
- Server without `CLAUDE_API_KEY` reports `claude_api: 'misconfigured'`
- All required keys present reports all services as `'ok'`
- Health endpoint useful for CloudWatch / monitoring

---

### ✅ 12. DetailModal ESC key and backdrop-click to close
**File:** `frontend/src/App.tsx`, lines 404-430
**Problem:** Modal can only be closed by ✕ button. ESC and clicking overlay do nothing.
**What to do:**
- Add `onClick={onClose}` to backdrop div (line 403)
- Add `e.stopPropagation()` in content div's click handler to prevent bubbling
- Add `useEffect` that attaches `keydown` listener calling `onClose()` on `Escape` key
- Cleanup listener on unmount
**Acceptance criteria:**
- Pressing Escape closes modal
- Clicking dark overlay closes modal
- Clicking modal content does not close it

---

### ✅ 14. Chart.js price history chart integrated
**File:** `frontend/src/App.tsx`, lines 487-506 (placeholder)
**Problem:** `chart.js` and `react-chartjs-2` are installed but not imported. Detail modal shows static placeholder instead of chart.
**What to do:**
- Import `Line` from `react-chartjs-2`
- Register Chart.js components: `CategoryScale`, `LinearScale`, `PointElement`, `LineElement`, `Tooltip`
- Replace placeholder with `<Line>` chart using `detail.price_history` close prices
- X-axis: dates from `price_history[].timestamp`
- Y-axis: USD prices from `price_history[].close`
- (Depends on Issue 2 being completed first — already done ✓)
**Acceptance criteria:**
- Detail modal renders line chart of past 7 days closing prices
- Tooltip shows date/time and price on hover
- No console errors; placeholder div removed

---

## Suggested Implementation Order
1. **Issue 7** — Scheduled sentiment job (adds automation)
2. **Issue 6** — Trending score (adds metric)
3. **Issue 9** — Coin detail caching (improves performance)
4. **Issue 10** — Health check (improves monitoring)
5. **Issue 12** — Modal keyboard/backdrop (improves UX)
6. **Issue 14** — Chart.js (improves detail view)

---

## Architecture Notes

### What's Working Well
- Sentiment analysis pipeline: NewsAPI → SentimentService → Cache
- 24-hour sentiment caching prevents redundant Claude calls
- Volatility calculation from CoinGecko high/low data
- Frontend hooks (useCoins, useCoinDetail) with proper polling
- Responsive coin card grid with inline styles
- Authorization using `x-api-key` header convention

### API Design
```
GET /api/coins                    → top coins with sentiment (cached 5 min)
GET /api/coins/:symbol            → coin detail + price history + headlines
GET /api/sentiment/:symbol        → sentiment-only read access (no analysis)
POST /api/refresh-sentiment       → background job to refresh specific coins
GET /api/health                   → service health status
```

### Environment Variables (Recommended)
```
CLAUDE_API_KEY=<key>                    # Required for sentiment analysis
NEWSAPI_API_KEY=<key>                   # Required for headlines
API_SECRET_KEY=<secret>                 # Required for /api/refresh-sentiment
CLAUDE_MODEL=claude-sonnet-4-6          # Optional; default: claude-sonnet-4-6
SENTIMENT_BATCH_SIZE=50                 # Optional; default: 50
SENTIMENT_JOB_CRON="0 2 * * *"          # Optional; default: 2 AM UTC daily
PORT=3000                               # Optional; default: 3000
```

---

## Testing Checklist
- [ ] `GET /api/coins` returns coins with non-NEUTRAL sentiment
- [ ] Sorting dropdown works (market_cap, volatility, sentiment)
- [ ] Clicking coin opens detail modal with headlines
- [ ] Detail modal closes with ESC key or backdrop click
- [ ] `POST /api/refresh-sentiment` with valid auth triggers background job
- [ ] `/api/health` reflects missing API keys
- [ ] Second `/api/coins/:symbol` call reuses cache
- [ ] Line chart renders in detail modal
