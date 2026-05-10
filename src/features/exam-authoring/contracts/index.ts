import type { ExamConfig, ExamState } from '../../../types';
import type {
  ExamEntity,
  ExamEvent,
  ExamSchedule,
  ExamVersionSummary,
  VersionDiff,
} from '../../../types/domain';

export interface ExamAuthoringReaderContract {
  getExamById(examId: string): Promise<ExamEntity | null>;
  getVersionById(versionId: string): Promise<{ contentSnapshot: ExamState; configSnapshot: ExamConfig } | null>;
  getVersionSummaries(examId: string): Promise<ExamVersionSummary[]>;
  getEvents(examId: string): Promise<ExamEvent[]>;
  getAllSchedules(): Promise<ExamSchedule[]>;
}

export interface ExamAuthoringLifecycleContract {
  saveDraft(examId: string, state: ExamState, actor: string): Promise<{ success: boolean; error?: string }>;
  compareVersions(examId: string, versionIdA: string, versionIdB: string): Promise<VersionDiff | null>;
}
