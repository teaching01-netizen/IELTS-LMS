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
  getAllExamsWithLegacyMigration(providerKey?: 'sat' | 'ielts' | 'act'): Promise<ExamEntity[]>;
  getAllExams(providerKey?: 'sat' | 'ielts' | 'act'): Promise<ExamEntity[]>;
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


function isConflictError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { statusCode?: unknown; status?: unknown };
  return record.statusCode === 409 || record.status === 409;
}

export class BackendExamRepository implements IExamRepository {
  private static readonly ALL_SCHEDULES_CACHE_KEY = '__all_schedules__';
  /** Per-exam single-flight GET dedupe for save-path revision hydration. */
  private readonly examRefreshInFlight = new Map<string, Promise<unknown>>();
  /** Per-schedule single-flight GET dedupe for save-path revision hydration. */
  private readonly scheduleRefreshInFlight = new Map<string, Promise<unknown>>();

  /**
   * Only published snapshots are immutable. Draft autosave updates the same
   * version ID, so builder and review reads must fetch drafts fresh.
   */
  private readonly versionCache = createTtlLruCache<string, ExamVersion | null>({
    maxEntries: 50,
    ttlMs: 30 * 60 * 1000,
  });

  private readonly schedulesCache = createTtlLruCache<string, ExamSchedule[]>({
    maxEntries: 1,
    ttlMs: 60 * 1000,
  });

  async getAllExamsWithLegacyMigration(providerKey?: 'sat' | 'ielts' | 'act'): Promise<ExamEntity[]> {
    return this.getAllExams(providerKey);
  }

  async getAllExams(providerKey?: 'sat' | 'ielts' | 'act'): Promise<ExamEntity[]> {
    const query = providerKey ? `?providerKey=${encodeURIComponent(providerKey)}` : '';
    const exams = await backendGet<any[]>(`/v1/exams${query}`);
    return exams.map(mapBackendExamEntity);
  }

  async getExamById(id: string): Promise<ExamEntity | null> {
    try {
      const exam = await backendGet<any>(`/v1/exams/${encodeURIComponent(id)}`);
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
      // Cold revision cache: this id was never read, so it is a create.
      // No hydration GET here — the create path must stay a single POST.
      await backendPost('/v1/exams', buildCreateExamPayload(exam));
      return;
    }

    try {
      await backendPatch(`/v1/exams/${exam.id}`, buildUpdateExamPayload(exam, revision));
    } catch (error) {
      // 409 = stale revision (another writer won the race). Re-read once to
      // refresh the cached revision and retry the PATCH a single time; a
      // second conflict surfaces to the caller instead of looping.
      if (!isConflictError(error)) throw error;
      await this.refreshExamRevision(exam.id, true);
      const freshRevision = getExamRevision(exam.id);
      if (freshRevision === undefined) {
        await backendPost('/v1/exams', buildCreateExamPayload(exam));
        return;
      }
      await backendPatch(`/v1/exams/${exam.id}`, buildUpdateExamPayload(exam, freshRevision));
    }
  }

  /**
   * Re-reads one exam to refresh its cached revision. Concurrent callers for
   * the same id share the in-flight GET; `force` bypasses the share after a
   * 409 so the retry provably observes post-conflict server state.
   */
  private refreshExamRevision(id: string, force = false): Promise<unknown> {
    if (!force) {
      const existing = this.examRefreshInFlight.get(id);
      if (existing) return existing;
    }
    const pending = this.getExamById(id).finally(() => {
      if (this.examRefreshInFlight.get(id) === pending) {
        this.examRefreshInFlight.delete(id);
      }
    });
    this.examRefreshInFlight.set(id, pending);
    return pending;
  }

  private refreshScheduleRevision(id: string, force = false): Promise<unknown> {
    if (!force) {
      const existing = this.scheduleRefreshInFlight.get(id);
      if (existing) return existing;
    }
    // Map through mapBackendSchedule so rememberScheduleRevision runs;
    // a 404 means the schedule is gone (treat as no revision, let the
    // caller fall back to create) instead of throwing.
    const pending = backendGet<unknown>(`/v1/schedules/${id}`)
      .then((payload) => {
        mapBackendSchedule(payload as Parameters<typeof mapBackendSchedule>[0]);
      })
      .catch((error: unknown) => {
        if (isBackendNotFound(error)) {
          return null;
        }
        throw error;
      })
      .finally(() => {
        if (this.scheduleRefreshInFlight.get(id) === pending) {
          this.scheduleRefreshInFlight.delete(id);
        }
      });
    this.scheduleRefreshInFlight.set(id, pending);
    return pending;
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
      if (mapped.isPublished && !mapped.isDraft) {
        this.versionCache.set(id, mapped);
      }
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
      // Cold revision cache: this id was never read, so it is a create.
      // No hydration GET here — the create path must stay a single POST
      // (callers/tests queue exactly one response for it).
      await backendPost('/v1/schedules', buildCreateSchedulePayload(schedule));
      this.schedulesCache.delete(BackendExamRepository.ALL_SCHEDULES_CACHE_KEY);
      return;
    }

    try {
      await backendPatch(
        `/v1/schedules/${schedule.id}`,
        buildUpdateSchedulePayload(schedule, revision),
      );
    } catch (error) {
      // 409 = stale revision. Refresh once (bypassing the share so the retry
      // provably observes post-conflict state) and retry a single time.
      if (!isConflictError(error)) throw error;
      await this.refreshScheduleRevision(schedule.id, true).catch(() => undefined);
      const freshRevision = getScheduleRevision(schedule.id);
      if (freshRevision === undefined) {
        await backendPost('/v1/schedules', buildCreateSchedulePayload(schedule));
      } else {
        await backendPatch(
          `/v1/schedules/${schedule.id}`,
          buildUpdateSchedulePayload(schedule, freshRevision),
        );
      }
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
    const payload = await backendGet<any[]>(`/v1/proctor/sessions/${encodeURIComponent(_scheduleId)}/notes`);
    return (payload ?? []).map((note) => ({
      id: note.id,
      scheduleId: note.scheduleId,
      author: note.author,
      timestamp: note.createdAt,
      content: note.content,
      category: note.category === 'incident' || note.category === 'handover' ? note.category : 'general',
      isResolved: note.isResolved ?? false,
    }));
  }

  async getAllSessionNotes(): Promise<SessionNote[]> {
    const payload = await backendGet<any[]>('/v1/proctor/notes');
    return (payload ?? []).map((note) => ({
      id: note.id,
      scheduleId: note.scheduleId,
      author: note.author,
      timestamp: note.createdAt,
      content: note.content,
      category: note.category === 'incident' || note.category === 'handover' ? note.category : 'general',
      isResolved: note.isResolved ?? false,
    }));
  }

  async saveSessionNote(note: SessionNote): Promise<void> {
    await backendPatch(`/v1/proctor/sessions/${encodeURIComponent(note.scheduleId)}/notes/${encodeURIComponent(note.id)}`, {
      category: note.category,
      content: note.content,
      isResolved: note.isResolved ?? false,
    });
  }

  async deleteSessionNote(noteId: string): Promise<void> {
    await backendDelete(`/v1/proctor/notes/${encodeURIComponent(noteId)}`);
  }

  async getViolationRulesByScheduleId(scheduleId: string): Promise<ViolationRule[]> {
    const payload = await backendGet<any[]>(`/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/violation-rules`);
    return (payload ?? []).map((rule) => ({
      id: rule.id,
      scheduleId: rule.scheduleId,
      triggerType: rule.triggerType,
      threshold: rule.threshold,
      specificViolationType: rule.specificViolationType ?? undefined,
      specificSeverity: rule.specificSeverity ?? undefined,
      action: rule.action,
      isEnabled: rule.isEnabled,
      createdAt: rule.createdAt,
      createdBy: rule.createdBy,
    }));
  }

  async saveViolationRule(rule: ViolationRule): Promise<void> {
    await backendPatch(`/v1/proctor/sessions/${encodeURIComponent(rule.scheduleId)}/violation-rules/${encodeURIComponent(rule.id)}`, {
      triggerType: rule.triggerType,
      threshold: rule.threshold,
      specificViolationType: rule.specificViolationType ?? null,
      specificSeverity: rule.specificSeverity ?? null,
      action: rule.action,
      isEnabled: rule.isEnabled,
    });
  }

  async deleteViolationRule(ruleId: string): Promise<void> {
    await backendDelete(`/v1/proctor/violation-rules/${encodeURIComponent(ruleId)}`);
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
