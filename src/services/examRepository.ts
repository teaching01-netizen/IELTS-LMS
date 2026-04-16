/**
 * Exam Repository - Data Access Layer
 * 
 * This abstraction handles all data persistence operations.
 * UI components should never access localStorage directly.
 * This allows easy migration to a backend API later.
 */

import {
  ExamEntity,
  ExamVersion,
  ExamEvent,
  ExamSchedule,
  ExamSessionRuntime,
  CohortControlEvent,
  SCHEMA_VERSION,
  ExamStatus
} from '../types/domain';
import { Exam, SessionAuditLog, SessionNote, ViolationRule } from '../types';
import type { ExamConfig, ModuleType } from '../types';
import { migrateExam } from '../utils/examUtils';
import { normalizeExamConfig } from '../constants/examDefaults';

const STORAGE_KEY_EXAMS = 'ielts_exams_v2';
const STORAGE_KEY_VERSIONS = 'ielts_exam_versions';
const STORAGE_KEY_EVENTS = 'ielts_exam_events';
const STORAGE_KEY_SCHEDULES = 'ielts_schedules_v2';
const STORAGE_KEY_LEGACY_SCHEDULES = 'ielts_schedules';
const STORAGE_KEY_RUNTIMES = 'ielts_exam_runtimes_v1';
const STORAGE_KEY_CONTROL_EVENTS = 'ielts_exam_control_events_v1';
const STORAGE_KEY_AUDIT_LOGS = 'ielts_session_audit_logs_v1';
const STORAGE_KEY_SESSION_NOTES = 'ielts_session_notes_v1';
const STORAGE_KEY_VIOLATION_RULES = 'ielts_violation_rules_v1';
const STORAGE_KEY_SCHEMA_VERSION = 'ielts_schema_version';
const MODULE_ORDER: ModuleType[] = ['listening', 'reading', 'writing', 'speaking'];

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
  saveAuditLog(log: SessionAuditLog): Promise<void>;

  // Session note operations
  getSessionNotesByScheduleId(scheduleId: string): Promise<SessionNote[]>;
  saveSessionNote(note: SessionNote): Promise<void>;
  deleteSessionNote(noteId: string): Promise<void>;

  // Violation rule operations
  getViolationRulesByScheduleId(scheduleId: string): Promise<ViolationRule[]>;
  saveViolationRule(rule: ViolationRule): Promise<void>;
  deleteViolationRule(ruleId: string): Promise<void>;

  // Migration
  migrateFromLegacy(legacyExams: Exam[]): Promise<ExamEntity[]>;
}

/**
 * LocalStorage implementation of exam repository
 */
export class LocalStorageExamRepository implements IExamRepository {
  async getAllExamsWithLegacyMigration(): Promise<ExamEntity[]> {
    const legacyRaw = localStorage.getItem('ielts_exams');
    if (!legacyRaw) {
      return this.getAllExams();
    }

    const legacyExams = JSON.parse(legacyRaw) as Exam[];
    if (legacyExams.length === 0) {
      localStorage.removeItem('ielts_exams');
      return this.getAllExams();
    }

    return this.migrateFromLegacy(legacyExams);
  }

  
  // Helper methods for localStorage
  private getItem<T>(key: string): T[] {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : [];
  }
  
  private setItem<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }
  
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Exam Entity operations
  async getAllExams(): Promise<ExamEntity[]> {
    return this.getItem<ExamEntity>(STORAGE_KEY_EXAMS);
  }
  
  async getExamById(id: string): Promise<ExamEntity | null> {
    const exams = await this.getAllExams();
    return exams.find(e => e.id === id) || null;
  }
  
  async saveExam(exam: ExamEntity): Promise<void> {
    const exams = await this.getAllExams();
    const index = exams.findIndex(e => e.id === exam.id);
    
    if (index >= 0) {
      exams[index] = { ...exam, updatedAt: new Date().toISOString() };
    } else {
      exams.push(exam);
    }
    
    this.setItem(STORAGE_KEY_EXAMS, exams);
  }
  
  async deleteExam(id: string): Promise<void> {
    const exams = await this.getAllExams();
    const filtered = exams.filter(e => e.id !== id);
    this.setItem(STORAGE_KEY_EXAMS, filtered);
  }
  
  // Exam Version operations
  async getAllVersions(examId: string): Promise<ExamVersion[]> {
    const versions = this.getItem<ExamVersion>(STORAGE_KEY_VERSIONS);
    return versions
      .filter(v => v.examId === examId)
      .map(version => this.normalizeVersion(version));
  }
  
  async getVersionById(id: string): Promise<ExamVersion | null> {
    const versions = this.getItem<ExamVersion>(STORAGE_KEY_VERSIONS);
    const version = versions.find(v => v.id === id) || null;
    return version ? this.normalizeVersion(version) : null;
  }
  
  async saveVersion(version: ExamVersion): Promise<void> {
    const versions = this.getItem<ExamVersion>(STORAGE_KEY_VERSIONS);
    const normalized = this.normalizeVersion(version);
    const index = versions.findIndex(v => v.id === version.id);
    
    if (index >= 0) {
      versions[index] = normalized;
    } else {
      versions.push(normalized);
    }
    
    this.setItem(STORAGE_KEY_VERSIONS, versions);
  }
  
  // Exam Event operations
  async getEvents(examId: string, limit = 100): Promise<ExamEvent[]> {
    const events = this.getItem<ExamEvent>(STORAGE_KEY_EVENTS);
    return events
      .filter(e => e.examId === examId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }
  
  async saveEvent(event: ExamEvent): Promise<void> {
    const events = this.getItem<ExamEvent>(STORAGE_KEY_EVENTS);
    events.push(event);
    this.setItem(STORAGE_KEY_EVENTS, events);
  }
  
  // Schedule operations
  async getAllSchedules(): Promise<ExamSchedule[]> {
    const schedules = this.getItem<ExamSchedule>(STORAGE_KEY_SCHEDULES);
    if (schedules.length > 0) {
      return schedules.map(schedule => this.normalizeSchedule(schedule));
    }

    const legacyRaw = localStorage.getItem(STORAGE_KEY_LEGACY_SCHEDULES);
    if (!legacyRaw) {
      return [];
    }

    const legacySchedules = JSON.parse(legacyRaw) as Array<{
      id: string;
      examId: string;
      examTitle: string;
      cohortName: string;
      startTime: string;
      endTime: string;
      status?: 'scheduled' | 'live' | 'completed';
    }>;

    if (legacySchedules.length === 0) {
      return [];
    }

    const exams = await this.getAllExams();
    const versions = this.getItem<ExamVersion>(STORAGE_KEY_VERSIONS);
    const migratedSchedules: ExamSchedule[] = legacySchedules.map(schedule => {
      const exam = exams.find(item => item.id === schedule.examId);
      const version = exam?.currentPublishedVersionId
        ? versions.find(item => item.id === exam.currentPublishedVersionId)
        : exam?.currentDraftVersionId
          ? versions.find(item => item.id === exam.currentDraftVersionId)
          : null;
      const config = normalizeExamConfig(version?.configSnapshot);

      return this.normalizeSchedule({
        id: schedule.id,
        examId: schedule.examId,
        examTitle: schedule.examTitle,
        publishedVersionId: version?.id || exam?.currentPublishedVersionId || exam?.currentDraftVersionId || '',
        cohortName: schedule.cohortName,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        plannedDurationMinutes: this.calculatePlannedDurationMinutes(config),
        deliveryMode: 'proctor_start',
        autoStart: false,
        autoStop: false,
        status: schedule.status || 'scheduled',
        createdAt: new Date().toISOString(),
        createdBy: 'Migration',
        updatedAt: new Date().toISOString()
      });
    });

    this.setItem(STORAGE_KEY_SCHEDULES, migratedSchedules);
    localStorage.removeItem(STORAGE_KEY_LEGACY_SCHEDULES);
    return migratedSchedules;
  }
  
  async getSchedulesByExam(examId: string): Promise<ExamSchedule[]> {
    const schedules = await this.getAllSchedules();
    return schedules.filter(s => s.examId === examId);
  }
  
  async saveSchedule(schedule: ExamSchedule): Promise<void> {
    const schedules = await this.getAllSchedules();
    const normalized = {
      ...this.normalizeSchedule(schedule),
      deliveryMode: schedule.deliveryMode || 'proctor_start'
    };
    const index = schedules.findIndex(s => s.id === schedule.id);
    
    if (index >= 0) {
      schedules[index] = { ...normalized, updatedAt: new Date().toISOString() };
    } else {
      schedules.push(normalized);
    }
    
    this.setItem(STORAGE_KEY_SCHEDULES, schedules);
  }
  
  async deleteSchedule(id: string): Promise<void> {
    const schedules = await this.getAllSchedules();
    const filtered = schedules.filter(s => s.id !== id);
    this.setItem(STORAGE_KEY_SCHEDULES, filtered);
  }

  // Runtime operations
  async getRuntimeByScheduleId(scheduleId: string): Promise<ExamSessionRuntime | null> {
    const runtimes = this.getItem<ExamSessionRuntime>(STORAGE_KEY_RUNTIMES);
    return runtimes.find(runtime => runtime.scheduleId === scheduleId) || null;
  }

  async saveRuntime(runtime: ExamSessionRuntime): Promise<void> {
    const runtimes = this.getItem<ExamSessionRuntime>(STORAGE_KEY_RUNTIMES);
    const index = runtimes.findIndex(item => item.scheduleId === runtime.scheduleId);
    if (index >= 0) {
      runtimes[index] = runtime;
    } else {
      runtimes.push(runtime);
    }
    this.setItem(STORAGE_KEY_RUNTIMES, runtimes);
  }

  async deleteRuntime(scheduleId: string): Promise<void> {
    const runtimes = this.getItem<ExamSessionRuntime>(STORAGE_KEY_RUNTIMES);
    this.setItem(STORAGE_KEY_RUNTIMES, runtimes.filter(runtime => runtime.scheduleId !== scheduleId));
  }

  // Control event operations
  async getControlEventsByScheduleId(scheduleId: string): Promise<CohortControlEvent[]> {
    const events = this.getItem<CohortControlEvent>(STORAGE_KEY_CONTROL_EVENTS);
    return events
      .filter(event => event.scheduleId === scheduleId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async saveControlEvent(event: CohortControlEvent): Promise<void> {
    const events = this.getItem<CohortControlEvent>(STORAGE_KEY_CONTROL_EVENTS);
    events.push(event);
    this.setItem(STORAGE_KEY_CONTROL_EVENTS, events);
  }

  // Audit log operations
  async getAuditLogsByScheduleId(scheduleId: string): Promise<SessionAuditLog[]> {
    const logs = this.getItem<SessionAuditLog>(STORAGE_KEY_AUDIT_LOGS);
    return logs
      .filter(log => log.sessionId === scheduleId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async saveAuditLog(log: SessionAuditLog): Promise<void> {
    const logs = this.getItem<SessionAuditLog>(STORAGE_KEY_AUDIT_LOGS);
    logs.push(log);
    this.setItem(STORAGE_KEY_AUDIT_LOGS, logs);
  }

  // Session note operations
  async getSessionNotesByScheduleId(scheduleId: string): Promise<SessionNote[]> {
    const notes = this.getItem<SessionNote>(STORAGE_KEY_SESSION_NOTES);
    return notes
      .filter(note => note.scheduleId === scheduleId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async saveSessionNote(note: SessionNote): Promise<void> {
    const notes = this.getItem<SessionNote>(STORAGE_KEY_SESSION_NOTES);
    const index = notes.findIndex(n => n.id === note.id);
    if (index >= 0) {
      notes[index] = note;
    } else {
      notes.push(note);
    }
    this.setItem(STORAGE_KEY_SESSION_NOTES, notes);
  }

  async deleteSessionNote(noteId: string): Promise<void> {
    const notes = this.getItem<SessionNote>(STORAGE_KEY_SESSION_NOTES);
    const filtered = notes.filter(note => note.id !== noteId);
    this.setItem(STORAGE_KEY_SESSION_NOTES, filtered);
  }

  // Violation rule operations
  async getViolationRulesByScheduleId(scheduleId: string): Promise<ViolationRule[]> {
    const rules = this.getItem<ViolationRule>(STORAGE_KEY_VIOLATION_RULES);
    return rules.filter(rule => rule.scheduleId === scheduleId);
  }

  async saveViolationRule(rule: ViolationRule): Promise<void> {
    const rules = this.getItem<ViolationRule>(STORAGE_KEY_VIOLATION_RULES);
    const index = rules.findIndex(r => r.id === rule.id);

    if (index >= 0) {
      rules[index] = rule;
    } else {
      rules.push(rule);
    }

    this.setItem(STORAGE_KEY_VIOLATION_RULES, rules);
  }

  async deleteViolationRule(ruleId: string): Promise<void> {
    const rules = this.getItem<ViolationRule>(STORAGE_KEY_VIOLATION_RULES);
    const filtered = rules.filter(rule => rule.id !== ruleId);
    this.setItem(STORAGE_KEY_VIOLATION_RULES, filtered);
  }

  // Migration from legacy Exam type to new domain model
  async migrateFromLegacy(legacyExams: Exam[]): Promise<ExamEntity[]> {
    const currentSchemaVersion = parseInt(localStorage.getItem(STORAGE_KEY_SCHEMA_VERSION) || '0');
    
    // If already migrated, return existing exams
    if (currentSchemaVersion >= SCHEMA_VERSION) {
      return this.getAllExams();
    }
    
    const migratedEntities: ExamEntity[] = [];
    const migratedVersions: ExamVersion[] = [];
    
    for (const legacyExam of legacyExams) {
      const normalizedLegacyExam = migrateExam(legacyExam);
      const normalizedConfig = normalizeExamConfig(normalizedLegacyExam.content.config);
      normalizedLegacyExam.content.config = normalizedConfig;

      // Map legacy status to new status (PRESERVE Published status)
      const statusMap: Record<string, ExamStatus> = {
        'Draft': 'draft',
        'Published': 'published',
        'Archived': 'archived'
      };
      
      const status = statusMap[legacyExam.status] || 'draft';
      
      // Create slug from title
      const slug = legacyExam.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      
      // Create exam entity
      const entity: ExamEntity = {
        id: legacyExam.id,
        slug,
        title: legacyExam.title,
        type: legacyExam.type,
        status,
        visibility: 'organization',
        owner: legacyExam.author,
        createdAt: legacyExam.createdAt,
        updatedAt: legacyExam.lastModified,
        publishedAt: status === 'published' ? legacyExam.lastModified : undefined,
        archivedAt: status === 'archived' ? legacyExam.lastModified : undefined,
        currentDraftVersionId: null,
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: SCHEMA_VERSION
      };
      
      // Create initial version
      const versionId = this.generateId('ver');
      const version: ExamVersion = {
        id: versionId,
        examId: entity.id,
        versionNumber: 1,
        parentVersionId: null,
        contentSnapshot: normalizedLegacyExam.content,
        configSnapshot: normalizedConfig,
        validationSnapshot: {
          isValid: true,
          errorCount: 0,
          warningCount: 0,
          lastValidatedAt: new Date().toISOString()
        },
        createdBy: legacyExam.author,
        createdAt: legacyExam.createdAt,
        isDraft: status === 'draft',
        isPublished: status === 'published'
      };
      
      // Set version pointers
      if (status === 'published') {
        entity.currentPublishedVersionId = versionId;
      } else {
        entity.currentDraftVersionId = versionId;
      }
      
      migratedEntities.push(entity);
      migratedVersions.push(version);
    }
    
    // Save migrated data
    this.setItem(STORAGE_KEY_EXAMS, migratedEntities);
    this.setItem(STORAGE_KEY_VERSIONS, migratedVersions);
    
    // Update schema version
    localStorage.setItem(STORAGE_KEY_SCHEMA_VERSION, SCHEMA_VERSION.toString());
    
    // Clear legacy data
    localStorage.removeItem('ielts_exams');
    
    return migratedEntities;
  }

  private normalizeVersion(version: ExamVersion): ExamVersion {
    return {
      ...version,
      contentSnapshot: {
        ...version.contentSnapshot,
        config: normalizeExamConfig(version.contentSnapshot.config)
      },
      configSnapshot: normalizeExamConfig(version.configSnapshot)
    };
  }

  private normalizeSchedule(schedule: ExamSchedule): ExamSchedule {
    return {
      ...schedule,
      deliveryMode: schedule.deliveryMode || 'proctor_start',
      plannedDurationMinutes: schedule.plannedDurationMinutes ?? 0
    };
  }

  private calculatePlannedDurationMinutes(config: ExamConfig): number {
    const normalized = normalizeExamConfig(config);
    const enabledSections = MODULE_ORDER
      .filter(sectionKey => normalized.sections[sectionKey].enabled)
      .map(sectionKey => ({
        sectionKey,
        config: normalized.sections[sectionKey]
      }))
      .sort((a, b) => a.config.order - b.config.order);

    let totalMinutes = 0;
    enabledSections.forEach((entry, index) => {
      totalMinutes += entry.config.duration;
      if (index < enabledSections.length - 1) {
        totalMinutes += entry.config.gapAfterMinutes ?? 0;
      }
    });

    return totalMinutes;
  }
}

/**
 * Singleton instance for app-wide use
 */
export const examRepository = new LocalStorageExamRepository();
