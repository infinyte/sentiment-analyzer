// Interfaces — import these in services and routes.
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
  ITournamentRepository,
  TournamentRecord,
  TournamentSummary,
  ISentimentRepository,
  Sentiment,
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
  IBrokerRepository,
  BrokerCredentials,
  StoredCredential,
  BrokerOrder,
  IBacktestRepository,
  BacktestSummary,
  SimulationResult,
} from './interfaces/index.js';

export { DEFAULT_TTL_MS } from './interfaces/index.js';

// Factory — use this to obtain a RepositoryBundle from a storage config.
export { createRepositories } from './factory.js';
export type { RepositoryBundle, StorageConfig, SQLiteConfig, PostgresConfig, MySQLConfig } from './factory.js';

// SQLite adapters — only needed if you want to instantiate adapters directly.
export {
  SQLiteAgentRepository,
  SQLiteTournamentRepository,
  SQLiteSentimentRepository,
  SQLiteSocialRepository,
  SQLiteBrokerRepository,
  SQLiteBacktestRepository,
} from './adapters/sqlite/index.js';
