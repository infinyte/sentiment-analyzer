export type {
  IAgentRepository,
  AgentRecord,
  AgentStatus,
  RegisterAgentOptions,
  AgentCosmetics,
  AgentStats,
  AgentWithCosmetics,
  CompetitionResultInput,
  AgentCompetitionRecord,
  GenealogyRecord,
} from './agent.repository.js';

export type {
  ITournamentRepository,
  TournamentRecord,
  TournamentSummary,
} from './tournament.repository.js';

export type { ISentimentRepository, Sentiment } from './sentiment.repository.js';
export { DEFAULT_TTL_MS } from './sentiment.repository.js';

export type {
  ISocialRepository,
  SocialItemQuery,
  SocialItemsResult,
  HistoricalSignalPoint,
  SocialStats,
  ScoredSocialItem,
  TrendingTopicRecord,
  SocialSource,
  TopicType,
  SourceMetadata,
} from './social.repository.js';

export type {
  IBrokerRepository,
  BrokerCredentials,
  StoredCredential,
  BrokerOrder,
} from './broker.repository.js';

export type {
  IBacktestRepository,
  BacktestSummary,
  SimulationResult,
} from './backtest.repository.js';
