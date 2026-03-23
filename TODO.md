
## Final Combined TODO List


### Issue 1
- Issue Number: 1
- Title: Frontend Live Tournament Monitor Panel
- Priority: High
- Status: Completed
- Description: Build real-time tournament monitoring UI in the MARL viewer using stream events, including live equity chart and trade feed.
- Acceptance Criteria:
  1. Add a live tournament hook using stream subscription for progress, equity snapshot, trade executed, completed, and failed events. ✅
  2. Render live equity chart updates while running. ✅
  3. Render latest trade feed entries with agent, symbol, side, quantity, price, and time. ✅
  4. Hide manual equity reload while live mode is active. ✅
  5. Fall back to polling if stream is unavailable. ✅
  6. Add frontend tests for stream open, event rendering, and stream close behavior. ✅
  7. Frontend type-check and tests pass. ✅

### Issue 2
- Issue Number: 2
- Title: Backend Tournament Scheduler (DB + Service + API)
- Priority: High
- Status: Not started
- Description: Add schedule persistence and execution engine for one-shot and recurring tournaments.
- Acceptance Criteria:
  1. Add tournament schedules table and migration.
  2. Add schedule CRUD and run-now endpoints.
  3. Validate required schedule inputs.
  4. Implement scheduler service with recurring cron and one-shot timing execution.
  5. Update lifecycle startup/shutdown for scheduler service.
  6. Add backend tests for create, list, get, update, delete, run-now, and validation.
  7. Backend type-check and tests pass.

### Issue 3
- Issue Number: 3
- Title: Frontend Tournament Scheduler UI
- Priority: High
- Status: Not started
- Depends On: Issue 2
- Description: Provide a scheduler workspace for managing tournament schedules from the UI.
- Acceptance Criteria:
  1. Add schedule list with key fields and actions.
  2. Add create/edit form for one-shot and recurring schedules.
  3. Add enable/disable, run-now, and delete with confirmation.
  4. Integrate as a scheduled sub-tab in MARL competition view.
  5. Add frontend tests for list, create, and delete flows.
  6. Frontend type-check and tests pass.

### Issue 4
- Issue Number: 4
- Title: Backend Realistic Paper Exchange
- Priority: Medium
- Status: Not started
- Description: Implement realistic paper trading with live pricing fallback, fees, and slippage.
- Acceptance Criteria:
  1. Add RealisticPaperExchange implementing exchange interface.
  2. Use live quote source with fallback behavior.
  3. Support provider fee presets.
  4. Apply slippage by side.
  5. Deduct fees and return commission details in orders.
  6. Add backend unit tests for fee and slippage behavior and fallback.
  7. Backend type-check and tests pass.

### Issue 5
- Issue Number: 5
- Title: Backend REALISTIC_PAPER Mode Wiring
- Priority: Medium
- Status: Not started
- Depends On: Issue 4
- Description: Add realistic paper mode to trading mode enum, factory routing, and config catalog.
- Acceptance Criteria:
  1. Add REALISTIC_PAPER mode value.
  2. Route factory to realistic paper exchange in this mode.
  3. Add config keys for fee preset and slippage.
  4. Keep existing paper mode behavior unchanged.
  5. Accept REALISTIC_PAPER in tournament start validation.
  6. Backend type-check and tests pass.

### Issue 6
- Issue Number: 6
- Title: Frontend Realistic Paper Mode UI
- Priority: Medium
- Status: Not started
- Depends On: Issue 5
- Description: Add realistic paper option to MARL mode selector and update display labeling.
- Acceptance Criteria:
  1. Extend frontend exchange mode type with REALISTIC_PAPER.
  2. Add mode selector button in correct order.
  3. Show explanatory note for fees/slippage config and hide broker credentials in this mode.
  4. Send REALISTIC_PAPER in start payload.
  5. Show friendly mode label in history/results.
  6. Add frontend tests for mode selection and UI behavior.
  7. Frontend type-check and tests pass.

### Issue 7
- Issue Number: 7
- Title: Frontend Raw Social Scraping and Ingest Utilities
- Priority: Low
- Status: Partial (backend endpoints exist, UI missing)
- Description: Expose advanced raw social/trending utility endpoints in a dedicated UI section.
- Acceptance Criteria:
  1. Add per-symbol scrape UI.
  2. Add batch scrape UI.
  3. Add trending recompute trigger UI.
  4. Add manual trending ingest form UI.
  5. Group under a collapsed advanced utilities section.
  6. Add frontend tests for endpoint submissions and loading/error states.
  7. Frontend type-check and tests pass.

