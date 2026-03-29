import type { CompetitionConfig } from './marl';

export interface TournamentSchedule {
  id: string;
  name: string;
  cronExpression: string | null;
  runAt: string | null;
  config: CompetitionConfig;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  name: string;
  cronExpression?: string;
  runAt?: string;
  config: CompetitionConfig;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  name?: string;
  cronExpression?: string | null;
  runAt?: string | null;
  config?: CompetitionConfig;
  enabled?: boolean;
}

export interface ScheduleListResponse {
  success: boolean;
  data: TournamentSchedule[];
  total: number;
}

export interface ScheduleResponse {
  success: boolean;
  data: TournamentSchedule;
}

export interface RunNowResponse {
  success: boolean;
  data: { competitionId: string };
}
