# Postman Test Suite for Sentiment Analyzer

Complete API test suite for testing the Sentiment Analyzer backend. All endpoints are covered with comprehensive test cases, error scenarios, and performance checks.

## Quick Start

### Prerequisites
- **Postman** v11.0+ (or Newman CLI)
- **Backend running** on `http://localhost:3000`
- API credentials:
  - `API_SECRET_KEY` from your `.env` file
- **Optional:** `REDIS_URL` in `backend/.env` — when set, tournament jobs and social-media scraping are offloaded to BullMQ worker processes instead of running in-process. All endpoints behave identically either way; the only observable difference is that `POST /api/social-media/refresh` returns immediately (job enqueued) rather than waiting for the scrape to complete.

### Import into Postman

1. Open Postman
2. Click **Import** (top-left)
3. Select **File** tab
4. Choose `sentiment-analyzer.postman_collection.json`
5. Repeat for environment: `sentiment-analyzer.postman_environment.json`

### Configure Environment

1. In Postman, click the **Environment** dropdown (top-right)
2. Select **Sentiment Analyzer - Development**
3. Click the **Edit** icon
4. Update these variables:
   - **`base_url`**: `http://localhost:3000` (or your backend URL)
   - **`api_secret_key`**: Copy value from `backend/.env` `API_SECRET_KEY`
5. Save and close

## Test Suite Structure

### 00 - Setup & Health ✅
Initial server connectivity and service health check.

**Tests:**
- `GET /api/health` - Verify server is running
- Health check response format
- All services accessible

**Run:** Execute first to verify server setup.

---

### 01 - Coins List Endpoint ✅
Test `/api/coins` with various parameters and sorting options.

**Tests:**
- `GET /api/coins` - Default top 50
- `GET /api/coins?limit=10` - Limit parameter
- `GET /api/coins?sort_by=volatility` - Volatility sorting
- `GET /api/coins?sort_by=sentiment` - Sentiment sorting

**Validations:**
- ✓ Response structure (data array, count, metadata)
- ✓ Coin data completeness (all 14 required fields)
- ✓ Sentiment scores are BULL/NEUTRAL/BEAR with 0-1 confidence
- ✓ Volatility values are numeric and realistic
- ✓ Sorting order correctness

**Expected:** All tests pass, first coin symbol stored for later use.

---

### 02 - Coin Detail Endpoint ✅
Test `/api/coins/:symbol` for detailed coin information.

**Tests:**
- `GET /api/coins/BTC` - Standard detail view
- `GET /api/coins/BTC?days=14` - Custom time period
- `GET /api/coins/INVALID123` - Error handling (404)

**Validations:**
- ✓ Response has coin, price_history, headlines, `sentiment_today`, and scored signal data
- ✓ Price history contains OHLCV (Open, High, Low, Close, timestamp)
- ✓ Headlines is array of strings
- ✓ `scored_items` is an array of normalized scored content items
- ✓ `source_breakdown` and `collection_stats` are present inside `sentiment_today`
- ✓ Sentiment consistency with list endpoint
- ✓ Proper 404 for invalid symbols

**Performance:**
- First request: ~1-3s (includes API calls and analysis)
- Subsequent requests: ~100-300ms (cached)

---

### 03 - Sentiment Cache Endpoint ✅
Test read-only `/api/sentiment/:symbol` endpoint.

**Tests:**
- `GET /api/sentiment/BTC` - Cached sentiment lookup

**Expected Response:**
- **200**: If sentiment already analyzed
  ```json
  {
    "symbol": "BTC",
    "sentiment_score": "BULL",
    "confidence": 0.85,
    "summary": "Strong positive outlook...",
    "analysis_date": "2026-03-16",
    "key_catalysts": [...],
    "risk_factors": [...],
    "short_term_outlook": "...",
    "volatility_warning": false,
    "trending_score": 44.5,
    "scored_items": [],
    "source_breakdown": [],
    "collection_stats": {
      "total_items": 8,
      "source_count": 2,
      "weighted_frequency": 5.8,
      "average_recency_score": 0.71,
      "trending_score": 44.5,
      "collected_at": "2026-03-17T08:00:00.000Z"
    }
  }
  ```
- **404**: If not yet analyzed (run `/api/coins` first)

**Note:** This endpoint never triggers new analysis; it's read-only cache lookup.

---

### 04 - Sentiment Refresh Endpoint (Admin) 🔐
Test background job endpoint for forcing sentiment re-analysis.

**Prerequisites:**
- Valid `x-api-key` header required
- Backend must have `CLAUDE_API_KEY` and `NEWSAPI_API_KEY` configured

**Tests:**
- `POST /api/refresh-sentiment` (no auth) - Should return 401
- `POST /api/refresh-sentiment` (with auth) - Single coin refresh
- `POST /api/refresh-sentiment` (with auth) - All coins refresh

**Request Format:**
```bash
POST /api/refresh-sentiment
x-api-key: your-secret-key
Content-Type: application/json

{
  "symbols": ["BTC", "ETH"]  // Optional, omit for all 50
}
```

**Response (202 Accepted - Job Queued):**
```json
{
  "job_id": "job_1710643200000",
  "status": "processing",
  "coins_to_process": 2
}
```

**Important:** Jobs run in background. Check `/api/sentiment/:symbol` after ~30-60 seconds to see results.

**Cost Note:** Each coin = 1 Claude API call (~$0.001-0.003). Budget accordingly.

---

### 05 - Performance Testing ⚡
Measure API response times and verify caching efficiency.

**Tests:**
- `/api/coins` response time
- `/api/coins/:symbol` response time
- Cache hit detection (sequential requests)

**Benchmarks:**
- Uncached list: 800ms - 2s
- Cached list: 50-100ms
- Uncached detail: 1-3s
- Cached detail: 100-300ms

**Optimization Tips:**
- List endpoint caches for 5 minutes
- Sentiment caches for 24 hours
- Price history caches for 15 minutes

---

### 06 - Error Handling 🛡️
Test invalid inputs and boundary conditions.

**Tests:**
- Limit over max (500) → Capped to 200
- Invalid sort parameter → Defaults to market_cap
- Days over max (999) → Capped to 30
- Invalid symbol → 404 error

**Expected Behavior:**
- Invalid parameters default to safe values (no errors)
- Capping prevents API abuse
- Clear error messages for genuine invalid requests

---

### 07 - Data Consistency ✓
Verify data matches across endpoints.

**Tests:**
- Fetch coin from list
- Fetch same coin from detail endpoint
- Verify: symbol, sentiment, price consistency

**Tolerance:** 1% price variance (accounts for real-time updates).

---

## Running Tests

### In Postman UI
1. Click collection name → **Run** button (top-right)
2. Select environment from dropdown
3. Click **Run Sentiment Analyzer Full Test Suite**
4. View live test results as they execute

### Via Command Line (Newman)

```bash
npm install -g newman
```

**Run all tests:**
```bash
newman run postman/sentiment-analyzer.postman_collection.json \
  -e postman/sentiment-analyzer.postman_environment.json
```

**Run specific collection:**
```bash
newman run postman/sentiment-analyzer.postman_collection.json \
  -e postman/sentiment-analyzer.postman_environment.json \
  --folder "01 - Coins List Endpoint"
```

**Export results to HTML:**
```bash
newman run postman/sentiment-analyzer.postman_collection.json \
  -e postman/sentiment-analyzer.postman_environment.json \
  -r html --reporter-html-export results.html
```

---

### 08 - Social Media Intelligence 🧠
Test the SQLite-backed social-media endpoints.

**Tests:**
- `GET /api/social-media/trending-topics` - clustered topic view
- `GET /api/social-media/items` - scored items with cursor pagination
- `POST /api/social-media/refresh` - trigger an immediate scrape (enqueues to BullMQ scraper queue when `REDIS_URL` is set; runs in-process via `setImmediate` otherwise)

**Validations:**
- ✓ Related topics that share a `coin_symbol` can be returned as one clustered topic entry
- ✓ Clustered topic payload includes `primary_topic`, `cluster_size`, and `clustered_topics`
- ✓ Item feed returns `next_cursor` for keyset pagination
- ✓ `offset` remains available for backward compatibility

**Response Notes:**
- Trending topics are clustered at the API layer, so entries like `BTC` and `#bitcoin` may appear as a single topic with `clustered_topics: ["#bitcoin", "BTC"]`
- `/api/social-media/items` now supports `cursor=<opaque_token>` and returns `next_cursor` when another page is available

---

## Test Execution Flow

### Recommended Order

1. **Setup & Health** → Verify backend works
2. **Coins List (default)** → Populate test data
3. **Coins Detail** → Verify price history and headlines
4. **Performance** → Check caching
5. **Error Handling** → Test boundaries
6. **Sentiment Refresh** → Trigger analysis (costs Claude API)
7. **Sentiment Cache** → Verify stored results
8. **Data Consistency** → Final validation
9. **Social Media Intelligence** → Validate clustered topics and cursor paging

---

## Environment Variables Reference

| Variable | Purpose | Example |
|----------|---------|---------|
| `base_url` | Backend server URL | `http://localhost:3000` |
| `api_secret_key` | Admin auth key | Saved from `.env` |
| `test_symbol` | First coin from /api/coins | Auto-populated (e.g., "BTC") |
| `test_coin_id` | CoinGecko ID | Auto-populated |
| `last_job_id` | Latest refresh job | Auto-populated |
| `consistency_symbol` | For consistency tests | Auto-populated |

---

## Common Issues & Fixes

### ❌ "Could not resolve host"
- Verify backend is running: `npm run dev` in `backend/` folder
- Check `base_url` = `http://localhost:3000`

### ❌ "401 Unauthorized" on /api/refresh-sentiment
- Verify `api_secret_key` matches `API_SECRET_KEY` in `.env`
- Check header is `x-api-key` (lowercase), not `Authorization`

### ❌ "No sentiment data" (404) on /api/sentiment/:symbol
- Run `/api/coins` first to generate sentiment cache
- Wait 30-60s after `/api/refresh-sentiment` before checking cache

### ❌ "Claude API error" or "NewsAPI error"
- Verify `CLAUDE_API_KEY` in `backend/.env`
- Verify `NEWSAPI_API_KEY` in `backend/.env`
- Check free tier limits not exceeded

### ⚠️ Slow response times
- First request always slower (external API calls)
- Second request should be much faster (cached)
- Clear server cache and restart if needed

---

## Performance Expectations

| Endpoint | First Request | Cached | Components |
|----------|---------------|--------|-----------|
| `/api/coins` | 1-2s | 50ms | CoinGecko + Sentiment (parallel) |
| `/api/coins/:symbol` | 2-3s | 100ms | CoinGecko history + NewsAPI + Sentiment |
| `/api/sentiment/:symbol` | N/A | <1ms | Cache lookup only |
| `/api/health` | 10ms | 10ms | Local checks |

---

## API Cost Implications

Each endpoint's cost (approximately):

| Endpoint | Cost | Notes |
|----------|------|-------|
| `/api/coins` | $0 | Uses free CoinGecko tier |
| `/api/coins/:symbol` | ~$0.001-0.003 | First sentiment lookup only |
| `/api/refresh-sentiment` (1 coin) | ~$0.001-0.003 | One Claude API call |
| `/api/refresh-sentiment` (50 coins) | ~$0.05-0.15 | Daily refresh job cost |

**Budget:** Free tier Claude = 5M input tokens/month ≈ $1.50

---

## Debugging Tips

### Enable Postman Console
- Press `Ctrl+Alt+C` (Windows) or `Cmd+Option+C` (Mac)
- See request/response details and test failures

### Check Sentiment Cache Status
```bash
curl http://localhost:3000/api/sentiment/BTC
# Returns 200 if cached, 404 if not cached
```

### Monitor Backend Logs
```bash
# In backend folder
npm run dev
# Watch for: "[job_ID]" prefix for async jobs
```

### Test with curl
```bash
# Get coins
curl http://localhost:3000/api/coins?limit=5

# Get coin detail
curl http://localhost:3000/api/coins/BTC

# Trigger sentiment refresh (requires auth)
curl -X POST http://localhost:3000/api/refresh-sentiment \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["BTC"]}'
```

---

## Extended Test Scenarios

### Scenario 1: Full User Flow
1. Open dashboard → `/api/coins`
2. Click coin → `/api/coins/BTC`
3. View sentiment detail → `/api/sentiment/BTC`
4. Re-run sentiment analysis → `POST /api/refresh-sentiment`

### Scenario 2: Performance Optimization
1. Run `/api/coins` twice → Measure cache speedup
2. Run `/api/coins/:symbol` → Check price_history caching
3. Open multiple coins → Verify no repeated API calls

### Scenario 3: Load Testing
Use Newman with `--iteration-count` for multi-run tests:
```bash
newman run sentiment-analyzer.postman_collection.json \
  -e sentiment-analyzer.postman_environment.json \
  --iteration-count 5
```

---

## Contributing

To add new tests:
1. Open collection in Postman
2. Add request under appropriate folder
3. Add test scripts in **Tests** tab
4. Export to JSON: **...** → **Export**
5. Commit updated collection

---

## References

- **Postman Docs:** https://learning.postman.com/docs/getting-started/overview/
- **API Spec:** See `QUICK_START.md` → API Endpoints section
- **Backend Code:** `backend/src/index.ts`
- **Environment Setup:** `backend/.env.example`

---

**Last Updated:** 2026-03-17  
**Version:** 1.0  
**Test Coverage:** 40+ test cases across 8 functional areas
