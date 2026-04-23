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
  ExamEvent,
  ExamSchedule,
  ExamSessionRuntime,
  CohortControlEvent,
} from '../types/domain';
import { Exam, SessionAuditLog, SessionNote, ViolationRule } from '../types';
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
  saveVersion(version: ExamVersion): Promise<void>;
  
  // Exam Event operations
  getEvents(examId: string, limit?: number): Promise<ExamEvent[]>;
  saveEvent(event: ExamEvent): Promise<void>;
  
  // Schedule operations
  getAllSchedules(): Promise<ExamSchedule[]>;
  getSchedulesByExam(examId: string): Promise<ExamSchedule[]>;
  saveSchedule(schedule: ExamSchedule): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

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
    try {
      const version = await backendGet<any>(`/v1/versions/${id}`);
      return mapBackendExamVersion(version);
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
    const schedules = await backendGet<any[]>('/v1/schedules');
    return schedules.map(mapBackendSchedule);
  }

  async getSchedulesByExam(examId: string): Promise<ExamSchedule[]> {
    const schedules = await this.getAllSchedules();
    return schedules.filter((schedule) => schedule.examId === examId);
  }

  async saveSchedule(schedule: ExamSchedule): Promise<void> {
    const revision = getScheduleRevision(schedule.id);

    if (revision === undefined) {
      await backendPost('/v1/schedules', buildCreateSchedulePayload(schedule));
      return;
    }

    await backendPatch(
      `/v1/schedules/${schedule.id}`,
      buildUpdateSchedulePayload(schedule, revision),
    );
  }

  async deleteSchedule(id: string): Promise<void> {
    await backendDelete(`/v1/schedules/${id}`);
    clearScheduleRevision(id);
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
    return [];
  }

  async saveViolationRule(_rule: ViolationRule): Promise<void> {}

  async deleteViolationRule(_ruleId: string): Promise<void> {}

  async migrateFromLegacy(_legacyExams: Exam[]): Promise<ExamEntity[]> {
    return this.getAllExams();
  }
}

/**
 * Singleton instance for app-wide use.
 * Production backend-only: persists through the backend API.
 */
export const examRepository: IExamRepository = new BackendExamRepository();
