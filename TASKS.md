# Sentiment-analyzer Coverage Report


I audited backend endpoints from index.ts:347 plus all route modules in agent-stats.ts:23, evolutionary.ts:192, marl-competition.ts:268, marl-real-trading.ts:42, social-media.ts:90, and trading.ts:32, then mapped them to real frontend calls in App.tsx:133, AgentManagementDashboard.tsx:1483, MarlCompetitionViewer.tsx:212, SocialDashboard.tsx:487, useMarlCompetition.ts:39, and useSocialMedia.ts:20.

## Total backend HTTP endpoints found: 64

## Endpoints with frontend usage/control: 39

## Endpoints with no frontend usage/control: 25

* Findings: Endpoints Not Yet Implemented In Frontend
_ Highest impact first: write/admin/action endpoints with no UI control.

### Trading API missing UI
GET /api/trading/exchange-status (trading.ts:32)
GET /api/trading/price/:symbol (trading.ts:45)
GET /api/trading/balances (trading.ts:55)
POST /api/trading/order (trading.ts:65)
GET /api/trading/stats (trading.ts:92)

MARL advanced/admin controls missing UI
GET /api/marl/agents/learning (marl-competition.ts:793)
DELETE /api/marl/agents/:agentId/learning (marl-competition.ts:808)
POST /api/marl/agents/:agentId/algorithm (marl-competition.ts:1056)
GET /api/marl/competition/:competitionId/stream (marl-competition.ts:1104)

### Broker lifecycle/admin controls missing UI
GET /api/marl/broker/credentials (full list) (marl-real-trading.ts:89)
DELETE /api/marl/broker/credentials/:id (marl-real-trading.ts:130)
POST /api/marl/broker/connect/:id (marl-real-trading.ts:148)
GET /api/marl/broker/connected (marl-real-trading.ts:173)
GET /api/marl/broker/orders/:competitionId (marl-real-trading.ts:191)
POST /api/marl/broker/emergency-stop (marl-real-trading.ts:222)

### Evolutionary endpoints missing UI
POST /api/evolutionary/tournament (evolutionary.ts:192)
GET /api/evolutionary/tournament (list) (evolutionary.ts:299)
GET /api/marl/evolution/history (evolutionary.ts:389)
GET /api/marl/evolution/population (evolutionary.ts:478)

### Social/trending utility endpoints missing UI
GET /api/scrape/social (index.ts:877)
POST /api/scrape/batch (index.ts:904)
GET /api/trending (index.ts:942)
POST /api/trending/ingest (index.ts:959)

## Endpoints/Features That Do Have Frontend Controls

### Coins dashboard
GET /api/coins (App.tsx:133)
GET /api/coins/:symbol (App.tsx:166)

### Dashboard parity additions
POST /api/sentiment/analyze (App.tsx)
POST /api/refresh-sentiment (App.tsx)
GET /api/sentiment/:symbol (App.tsx)
GET /api/rankings/top-coins (App.tsx)
GET /api/info/modes (App.tsx)
GET /api/health (App.tsx)

### Backtesting
POST /api/agents/configure (App.tsx)
POST /api/backtest/run (App.tsx)
GET /api/backtest/results/:testId (App.tsx)

### Agent management
GET /api/agents (AgentManagementDashboard.tsx:1483)
GET /api/agents/stats/leaderboard (AgentManagementDashboard.tsx:1484)
GET /api/agents/:id (AgentManagementDashboard.tsx:1540)
GET /api/agents/:id/history (AgentManagementDashboard.tsx:1541)
PUT /api/agents/:id/customize (AgentManagementDashboard.tsx:1781)
POST /api/agents/:id/retire (AgentManagementDashboard.tsx:1717)
GET /api/agents/:id/genome (AgentManagementDashboard.tsx:1542)
GET /api/agents/:id/genealogy (AgentManagementDashboard.tsx:1543)
MARL competition
POST /api/marl/competition/start (useMarlCompetition.ts:39)
GET /api/marl/competition/:id/status (useMarlCompetition.ts:57)
GET /api/marl/competition/:id/results (useMarlCompetition.ts:70)
POST /api/marl/agents/compare (useMarlCompetition.ts:105)
GET /api/marl/competitions (useMarlCompetition.ts:129)
GET /api/marl/competition/:id/trade-log (MarlCompetitionViewer.tsx:212)
GET /api/marl/info (MarlCompetitionViewer.tsx)
GET /api/marl/competition/:competitionId/equity-curves (MarlCompetitionViewer.tsx)
GET /api/marl/coin-universe (MarlCompetitionViewer.tsx:267)
POST /api/marl/agents/:agentId/pretrain (AgentManagementDashboard.tsx:1816)

### Broker credential creation/picker
GET /api/marl/broker/credentials/picker (MarlCompetitionViewer.tsx:225)
POST /api/marl/broker/credentials (MarlCompetitionViewer.tsx:289)

### Evolutionary dashboard
GET /api/evolutionary/summary (AgentManagementDashboard.tsx:1485)
GET /api/evolutionary/tournament/:id (AgentManagementDashboard.tsx:1595)
POST /api/evolutionary/breed (AgentManagementDashboard.tsx:1745)
GET /api/marl/evolution/best-genome (AgentManagementDashboard.tsx:1486)

### Social intelligence
GET /api/social-media/trending-topics (useSocialMedia.ts:20)
GET /api/social-media/items (useSocialMedia.ts:62)
GET /api/social-media/item/:id (SocialDashboard.tsx)
GET /api/social-media/stats (useSocialMedia.ts:88)
POST /api/social-media/refresh (SocialDashboard.tsx)
GET /api/trending-score/:symbol (useSocialMedia.ts:119)

## Feature-Level Summary

### Implemented and UI-covered: 
 - core coin dashboard
 - MARL competition flows
 - agent management
 - social topic/item analytics
 - breeding
 - pretraining

### Implemented but UI-missing: 
 - general trading panel
 - several MARL admin/learning endpoints
 - broker lifecycle controls beyond create/picker
 - evolutionary analytics history/population workspace
 - raw social scraping and ingest utilities