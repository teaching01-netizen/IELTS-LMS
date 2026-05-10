import type { ExamState } from '../../../types';
import type { ExamSchedule, ExamSessionRuntime, ExamVersion } from '../../../types/domain';
import type { StudentAttempt, StudentAttemptSeed } from '../../../types/studentAttempt';
import { createStudentSessionGateway } from '../infrastructure/studentSessionGateway';

export type StudentSessionStaticPayload = {
  schedule: unknown;
  version: unknown;
  degradedLiveMode?: boolean | undefined;
};

type StudentSessionLiveAttemptPayload = {
  id: string;
  revision?: number | null | undefined;
  updatedAt: string;
  recovery?: {
    syncState?: string | null | undefined;
  } | null | undefined;
  [key: string]: unknown;
};

export type StudentSessionLivePayload = {
  runtime?: Record<string, unknown> | null | undefined;
  attempt?: StudentSessionLiveAttemptPayload | null | undefined;
  publishedVersionId?: string | null | undefined;
  degradedLiveMode?: boolean | undefined;
};

export interface StudentSessionFacade {
  loadStaticSession(scheduleId: string, candidateId: string): Promise<StudentSessionStaticPayload>;
  loadLiveSession(scheduleId: string, candidateId: string): Promise<StudentSessionLivePayload>;
  mapSchedule(schedule: unknown): ExamSchedule;
  mapVersion(version: unknown): ExamVersion;
  hydrateExamState(
    contentSnapshot: ExamVersion['contentSnapshot'],
    configSnapshot: ExamVersion['configSnapshot'],
  ): ExamState;
  mapRuntime(runtime: unknown, schedule: ExamSchedule): ExamSessionRuntime;
  mapAttempt(attempt: unknown): StudentAttempt;
  saveAttempt(attempt: StudentAttempt): Promise<void>;
  getAttemptsByScheduleId(scheduleId: string): Promise<StudentAttempt[]>;
  createAttempt(seed: StudentAttemptSeed): Promise<StudentAttempt>;
}

export const studentSessionFacade: StudentSessionFacade = createStudentSessionGateway();
