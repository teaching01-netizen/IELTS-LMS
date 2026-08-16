import type { Exam, ExamConfig } from '../../../types';
import type { ExamEntity, ExamSchedule, ExamSessionRuntime, ExamVersion } from '../../../types/domain';

export interface DerivedScheduleWindow {
  startTime: string;
  endTime: string;
  plannedDurationMinutes: number;
}

export interface ScheduleWindowOptions {
  config: ExamConfig;
  now?: Date | string;
  existingSchedule?: Pick<ExamSchedule, 'startTime' | 'endTime' | 'plannedDurationMinutes'> | null;
}

export interface ScheduleRuntimeMutationResult {
  success: boolean;
  runtime?: ExamSessionRuntime | null;
  error?: string;
}

export interface AdminSchedulingProps {
  schedules: ExamSchedule[];
  exams: Exam[];
  examEntities: ExamEntity[];
  onCreateSchedule: (schedule: ExamSchedule) => Promise<void> | void;
  onUpdateSchedule: (schedule: ExamSchedule) => Promise<void> | void;
  onDeleteSchedule: (scheduleId: string) => Promise<void> | void;
  onStartScheduledSession: (scheduleId: string) => Promise<void> | void;
  getVersionById?: (versionId: string) => Promise<ExamVersion | null>;
  resolveScheduleWindow?: (options: ScheduleWindowOptions) => DerivedScheduleWindow;
  getPlannedDuration?: (config: ExamConfig) => number;
  initialExamId?: string;
  autoOpenCreate?: boolean;
}
