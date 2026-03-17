# Testing Strategy for Sentiment Analyzer

## Executive Summary

This document outlines a comprehensive testing strategy for the Sentiment Analyzer project covering unit tests, integration tests, component tests, and end-to-end tests. The strategy addresses the current gap in test coverage and provides prioritized, actionable tasks with clear acceptance criteria.

**Current State:**
- ✅ Postman integration tests exist (manual/CLI)
- ✅ Jest configured in backend
- ❌ No unit tests implemented
- ❌ No backend integration tests
- ❌ No frontend component tests
- ❌ No E2E tests

**Testing Stack:**
- **Backend Unit/Integration:** Jest + ts-jest + supertest
- **Frontend Components:** Vitest + React Testing Library
- **API Mocking:** MSW (Mock Service Worker) or Jest mocks
- **E2E:** Playwright
- **API Infrastructure:** Postman (existing - maintain as reference)

---

## Part 1: Backend Unit Tests

### 1.1 Cache Service Unit Tests

**Purpose:** Validate TTL caching mechanism works correctly for market data and sentiment caching.

**Location:** `backend/src/__tests__/services/cache.test.ts`

**Tests to Implement:**

| # | Test Name | Description | Acceptance Criteria |
|---|-----------|-------------|-------------------|
| 1.1.1 | Set and retrieve value | Cache stores and retrieves values correctly | Value retrieved equals value set |
| 1.1.2 | TTL expiration | Cached value expires after TTL | Value returns `undefined` after TTL elapsed |
| 1.1.3 | Update existing key | Resetting same key updates value and TTL | New value returned; TTL counter resets |
| 1.1.4 | Delete operation | Deleting key removes from cache | Subsequent retrieval returns `undefined` |
| 1.1.5 | Clear all | Clear operation removes all entries | Cache size = 0 after clear |
| 1.1.6 | Get expiration time | Method returns time until expiration | Returned value in milliseconds, decreases over time |
| 1.1.7 | Multiple concurrent sets | Multiple parallel sets work correctly | All values stored without race conditions |
| 1.1.8 | Large value storage | Cache handles large objects | No performance degradation; memory bounded |

**Mock Requirements:** None (pure logic)

**Estimated Effort:** 2-3 hours

**Success Criteria:**
- ✅ 8 unit tests pass
- ✅ Code coverage > 95% for Cache class
- ✅ All TTL edge cases covered (0ms, very large TTL)

---

### 1.2 CoinGeckoService Unit Tests

**Purpose:** Validate CoinGecko API data transformation and error handling.

**Location:** `backend/src/__tests__/services/coingecko.test.ts`

**Tests to Implement:**

| # | Test Name | Description | Acceptance Criteria |
|---|-----------|-------------|-------------------|
| 1.2.1 | getTopCoins success | Fetches and transforms coin data | Returns array with correct structure (Coin[]) |
| 1.2.2 | getTopCoins limit param | Respects limit parameter | Returned array length ≤ limit |
| 1.2.3 | Volatility calculation | Correctly calculates volatility from high/low | `volatility_24h = ((high-low)/price)*100` |
| 1.2.4 | Handle null prices | Handles missing/null price data gracefully | Volatility = 0 when price is null |
| 1.2.5 | Symbol uppercase | Symbols converted to uppercase | All symbols in [A-Z] format |
| 1.2.6 | Timestamp set | Each coin has current timestamp | timestamp ≤ Date.now() + 1000ms |
| 1.2.7 | Market rank assignment | Market rank from API mapped correctly | market_rank > 0 for top 50 |
| 1.2.8 | API error handling | Network/API errors throw | Exception propagated; no silent failures |
| 1.2.9 | Response validation | Invalid API response rejected | Throws error instead of returning malformed data |
| 1.2.10 | getCoinHistory success | Fetches historical OHLCV data | Returns array of {timestamp, open, high, low, close} |
| 1.2.11 | getCoinHistory default days | Default days parameter = 7 | Correct number of candles returned |
| 1.2.12 | getCoinHistory max days | Caps days at 365 | Never requests more than 1 year |

**Mock Requirements:**
- Mock `fetch` to return CoinGecko API response
- Provide fixtures for: valid response, empty array, malformed data, API error

**Estimated Effort:** 4-5 hours

**Success Criteria:**
- ✅ 12 unit tests pass
- ✅ 100% coverage of transformations (lines 40-90)
- ✅ All error paths covered
- ✅ Volatility calculation verified against manual examples

---

### 1.3 NewsAPIService Unit Tests

**Purpose:** Validate news headline fetching and error handling.

**Location:** `backend/src/__tests__/services/newsapi.test.ts`

**Tests to Implement:**

| # | Test Name | Description | Acceptance Criteria |
|---|-----------|-------------|-------------------|
| 1.3.1 | getHeadlines success | Fetches headlines for symbol | Returns array of strings |
| 1.3.2 | Headline filtering | Filters out irrelevant headlines | Only crypto-relevant articles included |
| 1.3.3 | Headline limit | Respects max headlines | Returns ≤ 10 headlines |
| 1.3.4 | Missing API key | Handles missing NEWSAPI_API_KEY | Throws specific error; doesn't make request |
| 1.3.5 | API rate limit error | Handles 429 response | Throws "Rate limit exceeded" error |
| 1.3.6 | Empty results | Handles symbol with no news | Returns empty array (not error) |
| 1.3.7 | Symbol normalization | Converts symbol to searchable format | "BTC" → searches "Bitcoin" or similar |
| 1.3.8 | Duplicate headlines | Removes duplicate headlines | No repeated strings in result |
| 1.3.9 | Date sorting | Headlines sorted by recency | Most recent first |

**Mock Requirements:**
- Mock `fetch` for NewsAPI responses
- Fixtures: valid response (5+ articles), rate limit error, empty response

**Estimated Effort:** 3-4 hours

**Success Criteria:**
- ✅ 9 unit tests pass
- ✅ Headline filtering logic covered
- ✅ API error scenarios handled
- ✅ Empty data cases don't crash

---

### 1.4 SentimentService Unit Tests

**Purpose:** Validate Claude API integration and sentiment parsing.

**Location:** `backend/src/__tests__/services/sentiment.test.ts`

**Tests to Implement:**

| # | Test Name | Description | Acceptance Criteria |
|---|-----------|-------------|-------------------|
| 1.4.1 | analyzeSentiment BULL | Generates BULL sentiment correctly | sentiment_score = "BULL"; confidence > 0.5 |
| 1.4.2 | analyzeSentiment NEUTRAL | Generates NEUTRAL sentiment | sentiment_score = "NEUTRAL" |
| 1.4.3 | analyzeSentiment BEAR | Generates BEAR sentiment | sentiment_score = "BEAR" |
| 1.4.4 | Confidence score range | Confidence is 0-1 | 0 ≤ confidence ≤ 1 |
| 1.4.5 | Missing API key | Handles missing CLAUDE_API_KEY | Returns NEUTRAL instead of crashing |
| 1.4.6 | Invalid JSON response | Handles malformed Claude response | Returns NEUTRAL; logs error |
| 1.4.7 | Response timeout | Handles slow Claude API | Throws timeout error after 30s |
| 1.4.8 | Prompt structure | Prompt includes headlines | Prompt contains ≥ 3 headlines or notes lack of news |
| 1.4.9 | Key catalysts parsing | Extracts key_catalysts array | Array length > 0 for non-NEUTRAL |
| 1.4.10 | Risk factors parsing | Extracts risk_factors array | Array contains strings, length ≥ 1 |
| 1.4.11 | Outlook parsing | Extract short_term_outlook string | String length > 10 chars |
| 1.4.12 | Volatility warning | Sets warning flag based on volatility | volatility_warning = true when volatility > 50% |

**Mock Requirements:**
- Mock Anthropic SDK (`@anthropic-ai/sdk`)
- Fix response with various sentiment scores
- Error responses: timeout, rate limit, invalid JSON

**Estimated Effort:** 5-6 hours

**Success Criteria:**
- ✅ 12 unit tests pass
- ✅ Claude API error handling robust
- ✅ JSON parsing edge cases covered
- ✅ Defaults to NEUTRAL on any error
- ✅ Prompt structure validated

---

## Part 2: Backend Integration Tests

### 2.1 API Endpoint Integration Tests

**Purpose:** Test API endpoints with mocked external services; verify routing, caching, error responses.

**Location:** `backend/src/__tests__/integration/api.test.ts`

**Tests to Implement:**

| Endpoint | Test Cases | Details |
|----------|-----------|---------|
| `GET /api/coins` | 1. Default (limit=50, sort=market_cap) | Status 200; returns array of 50 coins |
| | 2. Custom limit (e.g., limit=10) | Returns 10 coins; validates sorting |
| | 3. Volatility sort | Coins sorted by volatility descending |
| | 4. Sentiment sort | Coins sorted BULL→NEUTRAL→BEAR |
| | 5. Limit exceeds max (limit=300) | Capped to 200; status 200 |
| | 6. Invalid sort param | Defaults to market_cap; no error |
| `GET /api/coins/:symbol` | 1. Valid symbol (e.g., BTC) | Status 200; includes price_history, headlines |
| | 2. Invalid symbol (e.g., INVALID123) | Status 404; error message |
| | 3. Custom days (e.g., days=14) | Returns 14 days of history |
| | 4. Days exceeds max | Capped to 30; no error |
| | 5. Caching works | 2nd request < 100ms (cached) |
| `GET /api/sentiment/:symbol` | 1. Cached sentiment exists | Status 200; returns sentiment object |
| | 2. Not cached yet | Status 404; does NOT trigger analysis |
| | 3. Sentiment data complete | Includes all fields (score, confidence, catalysts, etc.) |
| `POST /api/refresh-sentiment` | 1. With valid auth key | Status 202; returns job_id |
| | 2. Without auth key | Status 401; error message |
| | 3. With invalid key | Status 401 |
| | 4. Specific symbol in body | Only that symbol processed |
| | 5. Empty body | All 50 top coins processed |
| | 6. Job status tracking | job_id can be queried (extended test) |
| `GET /api/health` | 1. Server running | Status 200; returns {status: "ok"} |
| | 2. All services available | Includes service health details |

**Mock Requirements:**
- Mock external services: CoinGeckoService, NewsAPIService, SentimentService
- Use supertest for HTTP assertions
- Provide realistic response fixtures

**Estimated Effort:** 6-8 hours

**Success Criteria:**
- ✅ 23 integration tests pass
- ✅ All endpoints respond with correct status codes
- ✅ Response schemas validated
- ✅ Sorting and filtering verified
- ✅ Caching behavior confirmed
- ✅ Error cases handled gracefully

---

### 2.2 End-to-End API Flow Tests

**Purpose:** Test realistic user workflows combining multiple endpoints.

**Location:** `backend/src/__tests__/integration/e2e-flows.test.ts`

**Workflows to Test:**

| # | Workflow | Steps | Assertion |
|---|----------|-------|-----------|
| 2.2.1 | User views dashboard | 1. GET /api/coins<br>2. Verify 50 coins returned<br>3. All have sentiment scores | All coins populated; no NEUTRAL-only coins |
| 2.2.2 | User views coin detail | 1. GET /api/coins (get symbol)<br>2. GET /api/coins/:symbol<br>3. Verify price_history & headlines | Detail includes 7 days history; 3-10 headlines |
| 2.2.3 | Admin refreshes sentiment | 1. POST /api/refresh-sentiment<br>2. Receive job_id<br>3. Wait 2s<br>4. GET /api/sentiment/:symbol | Sentiment updated; confidence > 0 |
| 2.2.4 | Cache invalidation | 1. GET /api/coins (1st - slow)<br>2. GET /api/coins (2nd - fast)<br>3. Verify timing difference | 1st: 800-2000ms; 2nd: <100ms |
| 2.2.5 | Error recovery | 1. newsapi returns error<br>2. Still get sentiment (headlines [])<br>3. No app crash | BULL/NEUTRAL/BEAR still assigned |

**Estimated Effort:** 4-5 hours

**Success Criteria:**
- ✅ 5 end-to-end flows pass
- ✅ No unexpected errors during workflows
- ✅ Data consistency across endpoints
- ✅ Cache behavior verified

---

## Part 3: Frontend Component Tests

### 3.1 Setup React Testing Environment

**Purpose:** Configure Vitest + React Testing Library for frontend unit tests.

**Location:** `frontend/vitest.config.ts` (new), `frontend/src/__tests__/setup.ts` (new)

**Configuration Tasks:**

| Task | Details | Acceptance Criteria |
|------|---------|-------------------|
| 3.1.1 | Install Vitest | `npm install --save-dev vitest @vitest/ui` | Package installed; can run `npm run test` |
| 3.1.2 | Install testing libraries | `npm install --save-dev @testing-library/react @testing-library/jest-dom` | Libraries available for import |
| 3.1.3 | Configure vitest.config.ts | Setup jsdom environment; path aliases | Config file imports without errors |
| 3.1.4 | Create test setup file | Import jest-dom; configure MSW (if using) | Each test file doesn't need setup boilerplate |
| 3.1.5 | Add npm scripts | Add `test`, `test:watch`, `test:ui` | Commands executable: `npm run test` |
| 3.1.6 | Mock fetch globally | Setup MSW or manual mocks for `/api/` | Tests can mock API responses |

**Estimated Effort:** 2-3 hours

**Success Criteria:**
- ✅ `npm run test` executes without errors
- ✅ Test runner identifies `.test.tsx` files
- ✅ Can write tests that render React components
- ✅ fetch can be mocked in tests

---

### 3.2 Custom Hooks Unit Tests

**Purpose:** Test `useCoins()` and `useCoinDetail()` hooks without rendering.

**Location:** `frontend/src/__tests__/hooks/useCoins.test.tsx`

**Tests to Implement:**

| Hook | Test Name | Description | Acceptance Criteria |
|------|-----------|-------------|-------------------|
| useCoins | 3.2.1 | fetchCoins on mount | Hook calls `/api/coins` on first render | API called once; coins state updated |
| | 3.2.2 | Polling every 10 min | setInterval set correctly | Interval = 600,000ms (10 min) |
| | 3.2.3 | Cleanup on unmount | setInterval cleared | No memory leak; interval cleared |
| | 3.2.4 | Error handling | API error caught and stored | error state populated; coins = [] |
| | 3.2.5 | Loading state | loading=true during fetch | loading=false after response |
| | 3.2.6 | lastUpdated timestamp | Timestamp updated after fetch | lastUpdated = current Date |
| useCoinDetail | 3.2.7 | Fetch on symbol change | Hook calls `/api/coins/:symbol` when symbol prop changes | API called with correct symbol |
| | 3.2.8 | Merge price_history | detail includes price_history array | detail.price_history.length > 0 |
| | 3.2.9 | Merge headlines | detail includes headlines array | detail.headlines is array of strings |
| | 3.2.10 | Clear on null symbol | detail=null when symbol=null | No API call; detail cleared |
| | 3.2.11 | Error on invalid symbol | Sets error; detail=null | Error message contains "404" or "not found" |
| | 3.2.12 | Request parameters | API called with ?days=7 | Query string includes days parameter |

**Mock Requirements:**
- Mock fetch responses for `/api/coins` and `/api/coins/:symbol`
- Use React Testing Library `renderHook` + `waitFor`
- Fixtures: successful response, error response, empty data

**Estimated Effort:** 4-5 hours

**Success Criteria:**
- ✅ 12 hook tests pass
- ✅ useCoins polling verified
- ✅ useCoinDetail data merging verified
- ✅ Error handling in both hooks
- ✅ No act() warnings

---

### 3.3 Component Unit Tests

**Purpose:** Test UI components in isolation.

**Location:** `frontend/src/__tests__/components/*.test.tsx`

**Components to Test:**

| Component | Test Cases | Details |
|-----------|-----------|---------|
| SentimentBadge | 1. BULL badge styling | Background color = green; text = "BULL" |
| | 2. NEUTRAL badge styling | Background = gray |
| | 3. BEAR badge styling | Background = red |
| | 4. Confidence display | Shows confidence as percentage |
| PercentChange | 1. Positive change (green) | Color = green; includes +% |
| | 2. Negative change (red) | Color = red; includes -% |
| | 3. Zero change (gray) | Color = gray; shows "0.00%" |
| CoinCard | 1. Renders coin data | Symbol, name, price displayed |
| | 2. Sentiment badge shown | SentimentBadge component rendered |
| | 3. Click handler | onSelect callback called with symbol |
| | 4. Volatility warning | Red highlighting if volatility > 50% |
| Dashboard | 1. Renders coin list | Maps coins array to CoinCard components |
| | 2. Sort dropdown works | Clicking option updates displayed coins |
| | 3. Limit input works | Changing limit value updates coin count |
| | 4. Loading state shown | Spinner/message while loading=true |
| | 5. Error message shown | Error text displayed when error is set |
| DetailModal | 1. Displays when open | Modal visible; backdrop shows |
| | 2. Closes on X click | onClose callback called |
| | 3. Shows coin detail | Symbol, name, price_history, headlines |
| | 4. Chart rendered | Chart.js component mounted |
| | 5. Loading state | Spinner while detail loading |

**Estimated Effort:** 6-7 hours

**Success Criteria:**
- ✅ 19 component tests pass
- ✅ All UI elements render correctly
- ✅ Event handlers called appropriately
- ✅ Conditional rendering works

---

### 3.4 Integration Tests (Frontend)

**Purpose:** Test components working together (above unit level but below E2E).

**Location:** `frontend/src/__tests__/integration/dashboard.test.tsx`

**Tests to Implement:**

| # | Test Name | Steps | Assertion |
|---|-----------|-------|-----------|
| 3.4.1 | Dashboard loads coins | 1. Render Dashboard<br>2. useCoins fetches<br>3. CoinCards render | 50 coins visible |
| 3.4.2 | View coin detail | 1. Dashboard with coins<br>2. Click CoinCard<br>3. DetailModal opens | Modal visible; detail loaded |
| 3.4.3 | Sort by sentiment | 1. Dashboard rendered<br>2. Select "Sentiment" sort<br>3. Coins reorder | First coin has BULL sentiment |
| 3.4.4 | Change limit | 1. Dashboard rendered<br>2. Change limit to 10<br>3. Re-fetch triggered | Only 10 coins displayed |
| 3.4.5 | Close detail modal | 1. Open DetailModal<br>2. Click X or backdrop<br>3. Modal closes | Modal hidden; Dashboard still visible |

**Estimated Effort:** 3-4 hours

**Success Criteria:**
- ✅ 5 integration tests pass
- ✅ User workflows work end-to-end (at component level)
- ✅ State management correct across components

---

## Part 4: End-to-End Tests

### 4.1 Setup Playwright E2E Environment

**Purpose:** Configure Playwright for automated browser testing.

**Location:** `playwright.config.ts` (new)

**Configuration Tasks:**

| Task | Details | Acceptance Criteria |
|------|---------|-------------------|
| 4.1.1 | Install Playwright | `npm install --save-dev @playwright/test` | Package installed in root or backend |
| 4.1.2 | Setup base URL | Configure baseURL = http://localhost:3000 | Tests don't hardcode localhost URLs |
| 4.1.3 | Configure browsers | Chrome, Firefox, Safari (optional) | Can run on multiple browsers |
| 4.1.4 | Headless/UI modes | Support --ui flag for debugging | `npx playwright test --ui` works |
| 4.1.5 | Reporters | JSON + HTML reporters configured | Can view results: report.html |
| 4.1.6 | Retry logic | Flaky tests retry 1-2 times | Reduces false failures |

**Estimated Effort:** 1-2 hours

**Success Criteria:**
- ✅ `npx playwright test` executes
- ✅ Can write and run a basic test
- ✅ API server running is a prerequisite
- ✅ HTML report generated after tests

---

### 4.2 User Flow E2E Tests

**Purpose:** Test complete user scenarios in real browser.

**Location:** `e2e/workflows.spec.ts` (new)

**Scenarios to Test:**

| # | Scenario | Steps | Assertions |
|---|----------|--------|-----------|
| 4.2.1 | View dashboard | 1. Navigate to app<br>2. Wait for coins list<br>3. Scroll down | ✓ 50 coins visible<br>✓ Each has symbol, price, sentiment badge<br>✓ "Last updated" timestamp shown |
| 4.2.2 | Sort by volatility | 1. Open sort dropdown<br>2. Select "Volatility"<br>3. First coin changes | ✓ Coins reorder by volatility desc.<br>✓ High volatility on top |
| 4.2.3 | Filter with limit | 1. Open limit dropdown<br>2. Change to 10<br>3. Wait for re-fetch | ✓ Only 10 coins shown<br>✓ Page loaded (not hung) |
| 4.2.4 | Click coin detail | 1. Click on any coin card<br>2. Modal opens<br>3. Wait for price_history load | ✓ Modal visible<br>✓ Chart renders (or placeholder)<br>✓ Headlines listed |
| 4.2.5 | Close modal with X | 1. Detail modal open<br>2. Click X button<br>3. Modal should close | ✓ Modal hidden<br>✓ Dashboard visible again |
| 4.2.6 | Close modal with Esc | 1. Detail modal open<br>2. Press Escape key<br>3. Modal closes | ✓ Modal hidden<br>✓ Keyboard event handled |
| 4.2.7 | Close modal on backdrop | 1. Detail modal open<br>2. Click outside modal area<br>3. Modal closes | ✓ Modal hidden<br>✓ Click outside works |
| 4.2.8 | Polling updates | 1. Dashboard loaded<br>2. Wait 10 min 01 sec<br>3. Data refreshes | ✓ "Last updated" timestamp changes<br>✓ Some coin prices may change |
| 4.2.9 | Error handling | 1. Backend offline<br>2. Try to load coins<br>3. Error message shown | ✓ Error displayed<br>✓ User can see error message<br>✓ No blank screen |

**Estimated Effort:** 6-8 hours

**Success Criteria:**
- ✅ 9 E2E scenarios pass
- ✅ Tests run in headless mode (CI-ready)
- ✅ All user workflows functional
- ✅ No console errors (exclude controlled errors)

---

## Part 5: Performance & Load Testing

### 5.1 Performance Benchmarks

**Purpose:** Establish baseline performance metrics.

**Location:** `backend/src/__tests__/performance/metrics.test.ts`

**Metrics to Track:**

| Metric | Target | Test Method |
|--------|--------|-----------|
| `/api/coins` uncached response | < 2s | Measure time; clear cache first |
| `/api/coins` cached response | < 100ms | Measure time; make 2nd request |
| `/api/coins/:symbol` uncached | < 3s | Measure time; new symbol |
| `/api/coins/:symbol` cached detail | < 300ms | Measure time; 2nd request |
| `/api/sentiment/:symbol` cache hit | < 1ms | Measure LocalCache lookup |
| Full dashboard load (frontend) | < 4s | Lighthouse; E2E measurement |
| Memory footprint | < 150MB | Monitor during operation |
| Cache hit rate | > 80% | Log cache hits vs misses |

**Estimated Effort:** 3-4 hours

**Success Criteria:**
- ✅ Benchmarks established for all endpoints
- ✅ Baseline metrics documented
- ✅ Performance regression tests added to CI
- ✅ Alerts trigger if targets exceeded

---

## Part 6: Continuous Integration

### 6.1 CI Pipeline Configuration

**Purpose:** Automate all tests in CI/CD workflow.

**Location:** `.github/workflows/test.yml` (or Azure Pipelines)

**Pipeline Stages:**

| Stage | Steps | Acceptance Criteria |
|-------|-------|-------------------|
| **Lint** | 1. Install dependencies<br>2. Run `npm run lint` | ✓ No ESLint errors<br>✓ Code formatted |
| **Type Check** | 1. Run `npm run type-check` | ✓ No TypeScript errors |
| **Unit Tests** | 1. Backend: `npm run test`<br>2. Frontend: `npm run test` | ✓ All unit tests pass<br>✓ Coverage > 80% |
| **Integration Tests** | 1. Start backend<br>2. Run integration suite<br>3. Stop backend | ✓ All integration tests pass |
| **E2E Tests** | 1. Start backend + frontend<br>2. Run Playwright tests<br>3. Upload report | ✓ All E2E tests pass<br>✓ Report uploaded |
| **Build** | 1. Backend: `npm run build`<br>2. Frontend: `npm run build` | ✓ No build errors<br>✓ dist/ generated |
| **Artifact Upload** | 1. Upload coverage reports<br>2. Upload E2E videos | ✓ Artifacts available in CI |

**Estimated Effort:** 2-3 hours

**Success Criteria:**
- ✅ All stages pass on green commits
- ✅ Pipeline fails fast on lint/type errors
- ✅ Coverage reports uploaded
- ✅ E2E videos available for debugging

---

## Implementation Priority & Timeline

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Get basic test infrastructure in place.

| Task | Effort | Owner |
|------|--------|-------|
| 6.1 Setup CI Pipeline | 2-3h | DevOps |
| 3.1 Setup Frontend Testing | 2-3h | Frontend |
| 1.1 Cache Unit Tests | 2-3h | Backend |
| 1.2 CoinGeckoService Tests | 4-5h | Backend |

**Total:** ~11-14 hours  
**Deliverable:** Test infrastructure ready; 20+ unit tests passing

---

### Phase 2: Service Tests (Weeks 2-3)

**Goal:** Complete all backend service unit tests.

| Task | Effort | Owner |
|------|--------|-------|
| 1.3 NewsAPIService Tests | 3-4h | Backend |
| 1.4 SentimentService Tests | 5-6h | Backend |
| 3.2 Custom Hooks Tests | 4-5h | Frontend |

**Total:** ~12-15 hours  
**Deliverable:** 30+ unit tests; >80% service coverage

---

### Phase 3: Integration Tests (Weeks 3-4)

**Goal:** Full API coverage; endpoint + flow tests.

| Task | Effort | Owner |
|------|--------|-------|
| 2.1 API Endpoint Tests | 6-8h | Backend |
| 2.2 E2E Flow Tests | 4-5h | Backend |
| 3.3 Component Tests | 6-7h | Frontend |
| 3.4 Frontend Integration Tests | 3-4h | Frontend |

**Total:** ~19-24 hours  
**Deliverable:** 50+ integration tests; all endpoints covered

---

### Phase 4: E2E & Polish (Weeks 4-5)

**Goal:** User workflow validation; performance baselines.

| Task | Effort | Owner |
|------|--------|-------|
| 4.1 Playwright Setup | 1-2h | DevOps |
| 4.2 E2E User Workflows | 6-8h | QA |
| 5.1 Performance Benchmarks | 3-4h | Backend |

**Total:** ~10-14 hours  
**Deliverable:** 9 E2E test scenarios; performance baselines documented

---

## Success Metrics & KPIs

### Coverage Targets

```
Backend Unit Test Coverage:  > 85%
  - Services:               > 90%
  - Utilities:              > 80%
  - Routes:                 > 75%

Frontend Component Coverage: > 80%
  - Custom Hooks:           > 90%
  - Components:             > 75%

Integration Test Coverage:   > 70%
  - API Endpoints:          > 95%
  - Critical Flows:         > 80%

E2E Coverage:                > 90%
  - User Workflows:         > 90%
```

### Execution Speed Targets

```
Unit Tests:        < 30 seconds (full suite)
Integration Tests: < 60 seconds (with mocked services)
E2E Tests:         < 5 minutes (9 scenarios)
Full CI Pipeline:  < 15 minutes
```

### Quality Gates

```
✓ All tests pass on PR
✓ Code coverage maintained/increased
✓ No console errors (except expected)
✓ No memory leaks (Jest leak detection)
✓ Performance within baseline ±10%
```

---

## Monitoring & Maintenance

### Test Health Dashboard

Monitor in CI/CD:
- Total tests: target 200+
- Pass rate: target 100%
- Execution time trends
- Coverage trends
- Flaky test detection

### Quarterly Reviews

- Review test effectiveness
- Remove redundant tests
- Refactor brittle tests
- Update benchmarks if needed
- Add new scenarios for new features

---

## Tools & Dependencies Reference

### Backend Tests

```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "@types/jest": "^29.5.0",
    "supertest": "^6.3.0",
    "@types/supertest": "^2.0.12"
  }
}
```

**Install:**
```bash
cd backend
npm install --save-dev ts-jest supertest @types/supertest
```

---

### Frontend Tests

```json
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0",
    "@testing-library/react": "^14.1.0",
    "@testing-library/jest-dom": "^6.1.0",
    "jsdom": "^23.0.0",
    "msw": "^2.0.0"
  }
}
```

**Install:**
```bash
cd frontend
npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom msw
```

---

### E2E Tests

```json
{
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  }
}
```

**Install:**
```bash
npm install --save-dev @playwright/test
```

---

## Appendix: Running Tests

### Local Development

```bash
# Backend unit tests
cd backend
npm run test
npm run test:watch

# Frontend component tests
cd frontend
npm run test
npm run test:watch

# E2E tests (requires servers running)
npm run dev:backend &
npm run dev:frontend &
npx playwright test
npx playwright test --ui  # Debug mode
```

### Creating Test Files

**Backend Unit Test Template:**
```typescript
import { Cache } from '../../../src/services/cache';

describe('Cache Service', () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache({ ttl: 1000 });
  });

  afterEach(() => {
    cache.clear();
  });

  test('should store and retrieve values', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });
});
```

**Frontend Component Test Template:**
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoinCard } from '../../../src/components/CoinCard';

describe('CoinCard Component', () => {
  const mockCoin = {
    symbol: 'BTC',
    name: 'Bitcoin',
    price_usd: 45000,
    sentiment_score: 'BULL' as const,
    sentiment_confidence: 0.85,
    // ... other fields
  };

  test('should render coin data', () => {
    render(<CoinCard coin={mockCoin} onSelect={() => {}} />);
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });
});
```

**E2E Test Template:**
```typescript
import { test, expect } from '@playwright/test';

test.describe('Dashboard User Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should load coins on dashboard', async ({ page }) => {
    const coins = await page.locator('[data-testid="coin-card"]');
    expect(await coins.count()).toBeGreaterThan(0);
  });
});
```

---

## Questions & Next Steps

**After approving this strategy:**

1. **Assign ownership** — Which team members own each phase?
2. **Sequence work** — Follow Phase 1 → Phase 4 timeline?
3. **Tools decisions** — Approved to install Vitest, Playwright, etc.?
4. **CI/CD platform** — GitHub Actions or Azure Pipelines?
5. **Coverage gates** — Are the targets acceptable?

---

**Document Version:** 1.1
**Last Updated:** 2026-03-17
**Author:** Architecture Review

---

## Phase 1 Testing — Advanced Services

### SentimentAnalyzerEngine

File: `backend/src/__tests__/services/sentiment-analyzer.test.ts`

```typescript
describe('SentimentAnalyzerEngine', () => {
  const engine = new SentimentAnalyzerEngine();

  it('BASIC mode: bull keywords → BULL sentiment', () => {
    const result = engine.analyzeBasicSentiment('BTC', ['Bitcoin surges to record high', 'ETF adoption rally']);
    expect(result.sentiment).toBe('BULL');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('BASIC mode: no headlines → NEUTRAL with 0 confidence', () => {
    const result = engine.analyzeBasicSentiment('ETH', []);
    expect(result.sentiment).toBe('NEUTRAL');
    expect(result.confidence).toBe(0);
  });

  it('calcRSI: returns 50 when insufficient data', () => {
    expect(engine.calcRSI([100, 101, 99], 14)).toBe(50);
  });

  it('calcRSI: returns > 70 in strong uptrend', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    expect(engine.calcRSI(rising)).toBeGreaterThan(70);
  });

  it('SMART mode: high-momentum market weights momentum factor highest', () => {
    const market = { symbol: 'SOL', price_usd: 150, price_change_24h_percent: 8,
      price_change_7d_percent: 25, volatility_24h: 5, volatility_7d: 15,
      volume_24h_usd: 5e9, market_cap_usd: 60e9, market_rank: 5 };
    const news = { headlines: [], sentiment_score: 'NEUTRAL' as const,
      sentiment_confidence: 0, sentiment_summary: '' };
    const result = engine.analyzeSmartSentiment(market, news);
    expect(result.factor_weights.momentum).toBeGreaterThan(result.factor_weights.news);
  });

  it('rankCoinsForTimeframe: returns all coins sorted by composite score desc', () => {
    const coins = [makeCoin('BTC', 'BULL', 0.9), makeCoin('DOGE', 'BEAR', 0.2)];
    const ranked = engine.rankCoinsForTimeframe(coins);
    expect(ranked[0].composite_score).toBeGreaterThanOrEqual(ranked[1].composite_score);
    expect(ranked[0].rank).toBe(1);
  });
});
```

### TradingAgent Framework

File: `backend/src/__tests__/services/trading-agent.test.ts`

```typescript
describe('RuleBasedAgent', () => {
  it('enters BUY when signal strength exceeds threshold', () => {
    const agent = AgentFactory.create({ type: 'RULE_BASED', riskProfile: 'CONSERVATIVE', initialCapital: 10000 });
    const signal = makeBuySignal(0.8); // strength > minStrength
    const decision = agent.makeDecision({ symbol: 'BTC', signal, currentPrice: 50000, date: new Date() });
    expect(decision).toBe('BUY');
  });

  it('holds when no position and signal is weak', () => {
    const agent = AgentFactory.create({ type: 'RULE_BASED', riskProfile: 'CONSERVATIVE', initialCapital: 10000 });
    const signal = makeBuySignal(0.3); // below minStrength
    const decision = agent.makeDecision({ symbol: 'BTC', signal, currentPrice: 50000, date: new Date() });
    expect(decision).toBe('HOLD');
  });

  it('position sizing respects maxRiskPct', () => {
    const agent = AgentFactory.create({ type: 'RULE_BASED', riskProfile: 'CONSERVATIVE', initialCapital: 10000 });
    const signal = makeBuySignalWithStopLoss(50000, 49000); // $1000 risk per unit
    agent.executeOrder({ symbol: 'BTC', signal, currentPrice: 50000, date: new Date() }, 'BUY');
    // Risk: 10000 * 0.01 = $100; qty = 100/1000 = 0.1; cost = 0.1 * 50000 = $5000 < $10000 ✓
  });
});

describe('HybridAgent', () => {
  it('holds when rule and ML agents disagree', () => {
    // Test that disagreement → HOLD
  });
});
```

### BacktestingEngine

File: `backend/src/__tests__/services/backtesting-engine.test.ts`

```typescript
describe('BacktestingEngine', () => {
  it('compareAgents: identifies top performer correctly', () => {
    const engine = new BacktestingEngine();
    const results = [
      makeAgentResult('A', { totalReturnPct: 0.15, winRate: 0.65, sharpeRatio: 1.2 }),
      makeAgentResult('B', { totalReturnPct: 0.08, winRate: 0.70, sharpeRatio: 0.9 }),
    ];
    const report = engine.compareAgents(results);
    expect(report.topPerformerByReturn).toBe('A');
    expect(report.topPerformerByWinRate).toBe('B');
  });

  it('applySlippage: FIXED adds ~0.1% to price', () => {
    // Access via a minimal subclass or make private method testable
  });
});
```

### StorageService

File: `backend/src/__tests__/services/storage.test.ts`

```typescript
describe('StorageService', () => {
  let storage: StorageService;

  beforeEach(() => {
    storage = new StorageService({ dbPath: ':memory:' }); // SQLite in-memory for tests
    storage.connect();
  });
  afterEach(() => storage.close());

  it('saveSentiment / getSentiment round-trip', () => {
    const s = makeSentiment('BTC', 'BULL');
    storage.saveSentiment('BTC', s);
    const retrieved = storage.getSentiment('BTC');
    expect(retrieved?.sentiment_score).toBe('BULL');
  });

  it('getSentiment returns undefined for expired entries', () => {
    const s = makeSentiment('ETH', 'BULL');
    storage.saveSentiment('ETH', s, -1); // already expired
    expect(storage.getSentiment('ETH')).toBeUndefined();
  });

  it('saveBacktestResult / getBacktestResult round-trip preserves Date objects', () => {
    const result = makeSimulationResult('test_123');
    storage.saveBacktestResult(result);
    const retrieved = storage.getBacktestResult('test_123');
    expect(retrieved?.startedAt).toBeInstanceOf(Date);
  });
});
```

### Backtesting Validation Checklist

When validating backtest results manually:

- **Equity curve monotonicity:** Should never jump by more than `maxRiskPct × initialCapital` in a single day
- **Win rate sanity:** For random signals, expect ~40–60% win rate; significantly outside this range suggests a bug
- **Profit factor:** Should be > 1.0 for a profitable strategy; exactly 0 means no trades
- **Max drawdown:** Should be bounded by `stopLossPct`; larger drawdowns indicate stop-losses aren't triggering
- **Sharpe ratio:** Values > 1 are good; < 0 means losing money risk-adjusted; Inf means no losing days (check for data issues)
