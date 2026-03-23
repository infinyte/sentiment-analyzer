# Sentiment-analyzer Frontend Parity Tasks

## Overview
This task list translates the API/UI parity audit into actionable delivery work.

Priority model:
- Phase 1: Must-have user-facing parity.
- Phase 2: Admin controls and protected workflows.
- Phase 3: Advanced analytics and power-user tooling.

Definition of done for this document:
- Each task has a clear description.
- Each task has acceptance criteria that can be validated in QA.
- Task placement is tied to existing or proposed UI tabs.


## Phase 1 - Must-Have Controls

### Completed

#### P1-T1: Add Sentiment Lab to Dashboard tab
Status: Done

Delivered:
- Dashboard Sentiment Lab with Analyze, Lookup, Rankings, and Modes subtabs
- Coverage for `POST /api/sentiment/analyze`, `GET /api/sentiment/:symbol`, `GET /api/rankings/top-coins`, and `GET /api/info/modes`

#### P1-T2: Add Refresh Sentiment action
Status: Done

Delivered:
- Header-level refresh action for `POST /api/refresh-sentiment`
- API-key entry, pending state, success/error feedback, and session persistence for the key

#### P1-T3: Add System Health indicator
Status: Done

Delivered:
- Global app-header health pill backed by `GET /api/health`
- Polling every 30 seconds with expandable service-level detail and non-blocking fallback behavior

#### P1-T4: Create Backtesting tab and run flow
Status: Done

Delivered:
- Dedicated Backtesting tab in `frontend/src/App.tsx`
- Agent configuration, backtest submission, stored test-id persistence, KPI cards, and equity chart retrieval

#### P1-T5: Enhance MARL tab with info and equity reload
Status: Done

Delivered:
- Lazy-loaded MARL info panel from `GET /api/marl/info`
- Equity-curve reload control in the existing chart area using `GET /api/marl/competition/:competitionId/equity-curves`

#### P1-T6: Add Social refresh + item detail drill-in
Status: Done

Delivered:
- Social refresh controls for `POST /api/social-media/refresh`
- Feed-item detail panel for `GET /api/social-media/item/:id`
- Tests confirming refresh and detail flows preserve filter state


## Phase 2 - Admin Controls

### P2-T1: Broker credential management console
Description:
Add protected broker admin controls for credential lifecycle operations.

Endpoints:
- GET /api/marl/broker/credentials
- DELETE /api/marl/broker/credentials/:id
- POST /api/marl/broker/connect/:id
- GET /api/marl/broker/connected

UI placement:
- MARL tab, new Broker Admin accordion in frontend/src/components/MarlCompetitionViewer.tsx.

Acceptance criteria:
1. Admin user can list credentials and active connections.
2. Admin user can connect a selected credential.
3. Admin user can delete a credential after confirmation.
4. Non-admin mode hides this section entirely.

### P2-T2: Broker order audit + emergency stop
Description:
Add protected controls for order audit visibility and emergency-stop execution.

Endpoints:
- GET /api/marl/broker/orders/:competitionId
- POST /api/marl/broker/emergency-stop

UI placement:
- MARL tab, Broker Admin accordion in frontend/src/components/MarlCompetitionViewer.tsx.

Acceptance criteria:
1. Admin user can fetch and view orders by competition id.
2. Optional agent filter is supported if provided by API.
3. Emergency stop requires explicit confirmation and valid required inputs.
4. Emergency stop action emits high-visibility warning/success/error feedback.

### P2-T3: Agent learning-state management
Description:
Expose learning state list and reset operations in Agent Management.

Endpoints:
- GET /api/marl/agents/learning
- DELETE /api/marl/agents/:agentId/learning

UI placement:
- Agents tab in frontend/src/components/AgentManagementDashboard.tsx.

Acceptance criteria:
1. Learning states are listed with agent and risk-profile context.
2. Admin can reset learning for one profile or all profiles per agent.
3. Reset action requires confirmation and shows irreversible warning.
4. Data refreshes after successful reset.

### P2-T4: Agent algorithm controls
Description:
Add algorithm query/update controls in selected agent detail context.

Endpoint:
- POST /api/marl/agents/:agentId/algorithm

UI placement:
- Agents tab detail pane in frontend/src/components/AgentManagementDashboard.tsx.

Acceptance criteria:
1. User can view current algorithm state for selected agent.
2. User can submit supported algorithm changes where allowed.
3. Unsupported values show a clear API-driven error message.
4. Resulting state is reflected without full page reload.

### P2-T5: Build Trading tab for execution and monitoring
Description:
Create dedicated Trading tab covering exchange status, quotes, balances, order ticket, and performance stats.

Endpoints:
- GET /api/trading/exchange-status
- GET /api/trading/price/:symbol
- GET /api/trading/balances
- POST /api/trading/order
- GET /api/trading/stats

UI placement:
- New Trading top-level tab in frontend/src/App.tsx.

Acceptance criteria:
1. Trading tab shows live exchange connection state.
2. User can fetch symbol quote on demand.
3. Balances and account stats render in summary widgets.
4. Order ticket validates required fields before submission.
5. API guardrail errors are clearly surfaced to user.

## Phase 3 - Advanced Analytics

### P3-T1: Evolution analytics workspace
Description:
Add tournament index/history/population analytics views and start-tournament wizard.

Endpoints:
- GET /api/evolutionary/tournament
- GET /api/marl/evolution/history
- GET /api/marl/evolution/population
- POST /api/evolutionary/tournament

UI placement:
- Agents tab, new Evolution Analytics section in frontend/src/components/AgentManagementDashboard.tsx.

Acceptance criteria:
1. User can browse tournament list and select historical runs.
2. History view charts generation-level trends.
3. Population view shows latest population snapshot and key metrics.
4. Start tournament wizard validates all required fields.

### P3-T2: Real-time MARL stream transport option
Description:
Offer optional SSE-based live updates for competitions with automatic fallback to polling.

Endpoint:
- GET /api/marl/competition/:competitionId/stream

UI placement:
- MARL tab controls in frontend/src/components/MarlCompetitionViewer.tsx.

Acceptance criteria:
1. User can enable/disable live stream mode.
2. SSE events update progress/results in near-real-time.
3. On SSE failure, app falls back to polling without data loss.
4. Stream disconnect/reconnect states are visible to user.

### P3-T3: Advanced Social utilities drawer
Description:
Add admin-oriented scraping and raw trending utilities for diagnostics and manual operations.

Endpoints:
- GET /api/scrape/social
- POST /api/scrape/batch
- GET /api/trending
- POST /api/trending/ingest

UI placement:
- Social tab, collapsed Advanced Tools drawer in frontend/src/components/SocialDashboard.tsx.

Acceptance criteria:
1. Admin can trigger single-symbol scrape and inspect response.
2. Admin can run batch scrape with bounded input validation.
3. Raw trending endpoint data can be viewed in inspector table/json.
4. Ingest tool is disabled by default and requires explicit admin capability.

## Cross-Cutting Tasks

### X-T1: Admin capability and API-key UX pattern
Description:
Standardize admin gating and key-entry behavior across Phase 2 and Phase 3 controls.

Acceptance criteria:
1. Protected controls are hidden/disabled when capability is absent.
2. API key capture supports secure entry and optional session memory with expiry.
3. Destructive actions require confirmation dialog and clear warning copy.
4. Unauthorized errors route users to corrective guidance.

### X-T2: Error, loading, and toast consistency
Description:
Align async state handling across all new parity surfaces using existing frontend patterns.

Acceptance criteria:
1. Every API action has consistent loading UI.
2. Success and failure messaging follows shared style/placement.
3. Empty states exist for every new data view.
4. Retries are available for transient failures where appropriate.

### X-T3: Test coverage expansion
Description:
Add tests for new controls, endpoint calls, and admin guard behavior.

Acceptance criteria:
1. New tab-level flows have component tests for happy/error paths.
2. Admin-only sections have visibility/permission tests.
3. Endpoint invocation contracts are asserted in tests.
4. Existing tests continue to pass without regressions.

## Proposed UI Layout Changes and Additions (Design Review)

### Navigation model
- Keep existing tabs and add two new primary tabs: Backtesting and Trading.
- Proposed top nav order: Dashboard | Agents | MARL | Social | Backtesting | Trading.

Rationale:
- Preserves current user mental model.
- Avoids overloading MARL with non-MARL trading tasks.
- Gives Backtesting a dedicated workflow surface.

### Dashboard updates
- Add Sentiment Lab as a full-width module below coin summary cards.
- Keep coin list/detail as primary left-to-right flow.
- Add compact Health status pill in app header, not inside content grid.

Design notes:
- Sentiment Lab should use card-with-subtabs pattern: Analyze | Lookup | Rankings | Modes.
- Keep forms concise with progressive disclosure for advanced inputs.

### Agents tab updates
- Split right detail column into stacked sections: Agent Detail, Learning State, Algorithm, Evolution Analytics.
- Evolution Analytics should include filters, timeline chart, and population table.

Design notes:
- Preserve current dense-data style.
- Add sticky section headers for long-scroll readability.

### MARL tab updates
- Keep existing competition builder as top priority area.
- Add a collapsible Broker Admin accordion below competition controls.
- Add optional live stream toggle near status/progress region.
- Add MARL Info drawer triggered by help icon next to tab title.

Design notes:
- Broker Admin area should visually communicate elevated-risk actions.
- Emergency Stop button should use danger styling and confirmation workflow.

### Social tab updates
- Keep existing trending/feed two-column layout.
- Add item detail side sheet (slide-over) on item click.
- Add Advanced Tools drawer at bottom/right, collapsed by default.

Design notes:
- Maintain analyst workflow speed; avoid modal interruptions for frequent actions.
- Advanced tools should be clearly marked Admin and experimental where applicable.

### Backtesting tab (new)
- Layout structure:
  - Top: configuration form.
  - Middle: run controls and status timeline.
  - Bottom: results panel with metrics and equity chart.

Design notes:
- Form should support templates/presets for common backtest scenarios.
- Results area should support comparison view between runs in later iteration.

### Trading tab (new)
- Layout structure:
  - Left column: exchange status, quote lookup, balances.
  - Right column: order ticket and execution feedback.
  - Footer: account stats and recent activity.

Design notes:
- Guardrail warnings should be visible before order submission.
- Use explicit mode chips (paper/sandbox/live) in header.

### Responsiveness and accessibility
- Ensure all new modules degrade to single-column on small screens.
- Preserve keyboard navigation for all forms and dialogs.
- Use consistent aria labeling for admin-only controls and warnings.

### Visual hierarchy and risk signaling
- Introduce three semantic action tiers: Normal, Admin, Destructive.
- Use color and iconography consistently: Admin actions (amber), destructive actions (red), informational actions (blue/neutral).

## Suggested Execution Order
1. Build navigation scaffolding for Backtesting and Trading tabs.
2. Deliver all Phase 1 tasks end-to-end.
3. Add admin capability framework (X-T1).
4. Deliver Phase 2 tasks by parallel streams:
   - Stream A: MARL broker admin + agent learning/algorithm.
   - Stream B: Trading tab.
5. Deliver Phase 3 analytics and advanced utilities.
6. Finish with cross-cutting test and UX consistency pass.

## Out of Scope
- Internal cron schedule controls.
- Direct worker-process management UIs.
- Non-HTTP internals not exposed via public API routes.