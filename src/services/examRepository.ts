/**
 * Exam Repository - Data Access Layer
 *
 * This abstraction handles all data persistence operations.
 * All data is stored in the backend API for cross-device synchronization.
 */

import {
  ExamEntity,
  ExamVersion,
  ExamVersionSummary,
  ExamVersionMetadata,
  ExamVersionBuilderContent,
  ExamEvent,
  ExamSchedule,
  ExamSessionRuntime,
  CohortControlEvent,
} from '../types/domain';
import { Exam, SessionAuditLog, SessionNote, ViolationRule } from '../types';
import { createTtlLruCache } from '../utils/ttlLruCache';
import {
  backendDelete,
  backendGet,
  backendPatch,
  backendPost,
  buildCreateSchedulePayload,
  buildCreateExamPayload,
  buildUpdateExamPayload,
  buildUpdateSchedulePayload,
  clearExamRevision,
  clearScheduleRevision,
  getExamRevision,
  getScheduleRevision,
  isBackendNotFound,
  mapBackendExamEntity,
  mapBackendExamEvent,
  mapBackendExamVersion,
  mapBackendExamVersionMetadata,
  mapBackendExamVersionSummary,
  mapBackendRuntime,
  mapBackendSchedule,
} from './backendBridge';

/**
 * Repository interface for exam data operations
 */
export interface IExamRepository {
  // Exam Entity operations
  getAllExamsWithLegacyMigration(): Promise<ExamEntity[]>;
  getAllExams(): Promise<ExamEntity[]>;
  getExamById(id: string): Promise<ExamEntity | null>;
  saveExam(exam: ExamEntity): Promise<void>;
  deleteExam(id: string): Promise<void>;
  
  // Exam Version operations
  getAllVersions(examId: string): Promise<ExamVersion[]>;
  getVersionSummaries(examId: string): Promise<ExamVersionSummary[]>;
  getVersionById(id: string): Promise<ExamVersion | null>;
  getVersionMetadata(id: string): Promise<ExamVersionMetadata | null>;
  getVersionBuilderContent(id: string): Promise<ExamVersionBuilderContent | null>;
  saveVersion(version: ExamVersion): Promise<void>;
  
  // Exam Event operations
  getEvents(examId: string, limit?: number): Promise<ExamEvent[]>;
  saveEvent(event: ExamEvent): Promise<void>;
  
  // Schedule operations
  getAllSchedules(): Promise<ExamSchedule[]>;
  getSchedulesByExam(examId: string): Promise<ExamSchedule[]>;
  saveSchedule(schedule: ExamSchedule): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  /** Drops the cached schedule list so the next read refetches. */
  clearScheduleCache(): void;

  // Runtime operations
  getRuntimeByScheduleId(scheduleId: string): Promise<ExamSessionRuntime | null>;
  saveRuntime(runtime: ExamSessionRuntime): Promise<void>;
  deleteRuntime(scheduleId: string): Promise<void>;

  // Control event operations
  getControlEventsByScheduleId(scheduleId: string): Promise<CohortControlEvent[]>;
  saveControlEvent(event: CohortControlEvent): Promise<void>;

  // Audit log operations
  getAuditLogsByScheduleId(scheduleId: string): Promise<SessionAuditLog[]>;
  getAllAuditLogs(): Promise<SessionAuditLog[]>;
  saveAuditLog(log: SessionAuditLog): Promise<void>;

  // Session note operations
  getSessionNotesByScheduleId(scheduleId: string): Promise<SessionNote[]>;
  getAllSessionNotes(): Promise<SessionNote[]>;
  saveSessionNote(note: SessionNote): Promise<void>;
  deleteSessionNote(noteId: string): Promise<void>;

  // Violation rule operations
  getViolationRulesByScheduleId(scheduleId: string): Promise<ViolationRule[]>;
  saveViolationRule(rule: ViolationRule): Promise<void>;
  deleteViolationRule(ruleId: string): Promise<void>;

  // Migration
  migrateFromLegacy(legacyExams: Exam[]): Promise<ExamEntity[]>;
}


export class BackendExamRepository implements IExamRepository {
  private static readonly ALL_SCHEDULES_CACHE_KEY = '__all_schedules__';

  /**
   * Version payloads are append-only (saveVersion is unsupported), so a
   * bounded TTL cache is safe and dedupes the same draft being fetched by
   * the builder, review, and publish-readiness paths within one flow.
   */
  private readonly versionCache = createTtlLruCache<string, ExamVersion | null>({
    maxEntries: 50,
    ttlMs: 30 * 60 * 1000,
  });

  private readonly schedulesCache = createTtlLruCache<string, ExamSchedule[]>({
    maxEntries: 1,
    ttlMs: 60 * 1000,
  });

  async getAllExamsWithLegacyMigration(): Promise<ExamEntity[]> {
    return this.getAllExams();
  }

  async getAllExams(): Promise<ExamEntity[]> {
    const exams = await backendGet<any[]>('/v1/exams');
    return exams.map(mapBackendExamEntity);
  }

  async getExamById(id: string): Promise<ExamEntity | null> {
    try {
      const exam = await backendGet<any>(`/v1/exams/${id}`);
      return mapBackendExamEntity(exam);
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async saveExam(exam: ExamEntity): Promise<void> {
    const revision = getExamRevision(exam.id);
    if (revision === undefined) {
      await backendPost('/v1/exams', buildCreateExamPayload(exam));
      return;
    }

    await backendPatch(`/v1/exams/${exam.id}`, buildUpdateExamPayload(exam, revision));
  }

  async deleteExam(id: string): Promise<void> {
    await backendDelete(`/v1/exams/${id}`);
    clearExamRevision(id);
  }

  async getAllVersions(examId: string): Promise<ExamVersion[]> {
    const versions = await backendGet<any[]>(`/v1/exams/${examId}/versions`);
    return versions.map(mapBackendExamVersion);
  }

  async getVersionSummaries(examId: string): Promise<ExamVersionSummary[]> {
    const versions = await backendGet<any[]>(`/v1/exams/${examId}/versions/summary`);
    return versions.map(mapBackendExamVersionSummary);
  }

  async getVersionById(id: string): Promise<ExamVersion | null> {
    const cached = this.versionCache.get(id);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const version = await backendGet<any>(`/v1/versions/${id}`);
      const mapped = mapBackendExamVersion(version);
      this.versionCache.set(id, mapped);
      return mapped;
    } catch (error) {
      if (isBackendNotFound(error)) {
        this.versionCache.set(id, null);
        return null;
      }

      throw error;
    }
  }

  async getVersionMetadata(id: string): Promise<ExamVersionMetadata | null> {
    try {
      const metadata = await backendGet<any>(`/v1/versions/${id}?projection=metadata`);
      return mapBackendExamVersionMetadata(metadata);
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async getVersionBuilderContent(id: string): Promise<ExamVersionBuilderContent | null> {
    try {
      const content = await backendGet<any>(`/v1/versions/${id}?projection=builder`);
      return content;
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async saveVersion(_version: ExamVersion): Promise<void> {
    throw new Error('Saving versions directly through the backend repository is not supported.');
  }

  async getEvents(examId: string, limit = 100): Promise<ExamEvent[]> {
    const events = await backendGet<any[]>(`/v1/exams/${examId}/events`);
    return events.map(mapBackendExamEvent).slice(0, limit);
  }

  async saveEvent(_event: ExamEvent): Promise<void> {
    throw new Error('Saving events directly through the backend repository is not supported.');
  }

  async getAllSchedules(): Promise<ExamSchedule[]> {
    const cached = this.schedulesCache.get(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY);
    if (cached !== undefined) {
      return cached;
    }

    const schedules = await backendGet<any[]>('/v1/schedules');
    const mapped = schedules.map(mapBackendSchedule);
    this.schedulesCache.set(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY, mapped);
    return mapped;
  }

  async getSchedulesByExam(examId: string): Promise<ExamSchedule[]> {
    const schedules = await this.getAllSchedules();
    return schedules.filter((schedule) => schedule.examId === examId);
  }

  async saveSchedule(schedule: ExamSchedule): Promise<void> {
    const revision = getScheduleRevision(schedule.id);

    if (revision === undefined) {
      await backendPost('/v1/schedules', buildCreateSchedulePayload(schedule));
    } else {
      await backendPatch(
        `/v1/schedules/${schedule.id}`,
        buildUpdateSchedulePayload(schedule, revision),
      );
    }

    this.schedulesCache.delete(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY);
  }

  async deleteSchedule(id: string): Promise<void> {
    await backendDelete(`/v1/schedules/${id}`);
    clearScheduleRevision(id);
    this.schedulesCache.delete(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY);
  }

  clearScheduleCache(): void {
    this.schedulesCache.delete(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY);
  }

  async getRuntimeByScheduleId(scheduleId: string): Promise<ExamSessionRuntime | null> {
    try {
      const [schedulePayload, runtimePayload] = await Promise.all([
        backendGet<any>(`/v1/schedules/${scheduleId}`),
        backendGet<any>(`/v1/schedules/${scheduleId}/runtime`),
      ]);

      return mapBackendRuntime(runtimePayload, mapBackendSchedule(schedulePayload));
    } catch (error) {
      if (isBackendNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async saveRuntime(_runtime: ExamSessionRuntime): Promise<void> {
    throw new Error('Saving runtimes directly through the backend repository is not supported.');
  }

  async deleteRuntime(_scheduleId: string): Promise<void> {}

  async getControlEventsByScheduleId(_scheduleId: string): Promise<CohortControlEvent[]> {
    return [];
  }

  async saveControlEvent(_event: CohortControlEvent): Promise<void> {}

  async getAuditLogsByScheduleId(_scheduleId: string): Promise<SessionAuditLog[]> {
    return [];
  }

  async getAllAuditLogs(): Promise<SessionAuditLog[]> {
    return [];
  }

  async saveAuditLog(_log: SessionAuditLog): Promise<void> {}

  async getSessionNotesByScheduleId(_scheduleId: string): Promise<SessionNote[]> {
    return [];
  }

  async getAllSessionNotes(): Promise<SessionNote[]> {
    return [];
  }

  async saveSessionNote(_note: SessionNote): Promise<void> {}

  async deleteSessionNote(_noteId: string): Promise<void> {}

  async getViolationRulesByScheduleId(_scheduleId: string): Promise<ViolationRule[]> {
    throw new Error('Violation-rule reads through BackendExamRepository are not supported.');
  }

  async saveViolationRule(_rule: ViolationRule): Promise<void> {
    throw new Error('Violation-rule persistence through BackendExamRepository is not supported.');
  }

  async deleteViolationRule(_ruleId: string): Promise<void> {
    throw new Error('Violation-rule deletion through BackendExamRepository is not supported.');
  }

  async migrateFromLegacy(_legacyExams: Exam[]): Promise<ExamEntity[]> {
    return this.getAllExams();
  }
}

/**
 * Singleton instance for app-wide use.
 * Production backend-only: persists through the backend API.
 */
export const examRepository: IExamRepository = new BackendExamRepository();
