/**
 * Tests for Exam Lifecycle Service - Phase 3: Versioning, Clone, Rollback, Audit
 * 
 * Note: Run with `npm test` - vitest types are available at runtime
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExamLifecycleService } from '../examLifecycleService';
import { IExamRepository } from '../examRepository';
import {
  ExamEntity,
  ExamEvent,
  ExamStatus,
  ExamVersion,
  ExamVersionSummary,
  SCHEMA_VERSION,
} from '../../types/domain';
import { ExamState } from '../../types';
import { createDefaultConfig } from '../../constants/examDefaults';

// Mock repository
class MockExamRepository implements IExamRepository {
  private exams: ExamEntity[] = [];
  private versions: ExamVersion[] = [];
  private events: ExamEvent[] = [];

  async getAllExamsWithLegacyMigration(): Promise<ExamEntity[]> {
    return this.exams;
  }

  async getAllExams(): Promise<ExamEntity[]> {
    return this.exams;
  }

  async getExamById(id: string): Promise<ExamEntity | null> {
    return this.exams.find(e => e.id === id) || null;
  }

  async saveExam(exam: ExamEntity): Promise<void> {
    const index = this.exams.findIndex(e => e.id === exam.id);
    if (index >= 0) {
      this.exams[index] = exam;
    } else {
      this.exams.push(exam);
    }
  }

  async deleteExam(id: string): Promise<void> {
    this.exams = this.exams.filter(e => e.id !== id);
  }

  async getAllVersions(examId: string): Promise<ExamVersion[]> {
    return this.versions.filter(v => v.examId === examId);
  }

  async getVersionSummaries(examId: string): Promise<ExamVersionSummary[]> {
    return this.versions
      .filter((version) => version.examId === examId)
      .map(({ contentSnapshot: _content, configSnapshot: _config, ...summary }) => summary);
  }

  async getVersionById(id: string): Promise<ExamVersion | null> {
    return this.versions.find(v => v.id === id) || null;
  }

  async saveVersion(version: ExamVersion): Promise<void> {
    const index = this.versions.findIndex(v => v.id === version.id);
    if (index >= 0) {
      this.versions[index] = version;
    } else {
      this.versions.push(version);
    }
  }

  async getEvents(examId: string, limit = 100): Promise<ExamEvent[]> {
    return this.events
      .filter(e => e.examId === examId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async saveEvent(event: ExamEvent): Promise<void> {
    this.events.push(event);
  }

  async getAllSchedules(): Promise<any[]> {
    return [];
  }

  async getSchedulesByExam(examId: string): Promise<any[]> {
    return [];
  }

  async saveSchedule(schedule: any): Promise<void> {}

  async deleteSchedule(id: string): Promise<void> {}

  async getRuntimeByScheduleId(scheduleId: string): Promise<any | null> {
    return null;
  }

  async saveRuntime(runtime: any): Promise<void> {}

  async deleteRuntime(scheduleId: string): Promise<void> {}

  async getControlEventsByScheduleId(scheduleId: string): Promise<any[]> {
    return [];
  }

  async saveControlEvent(event: any): Promise<void> {}

  async migrateFromLegacy(legacyExams: any[]): Promise<ExamEntity[]> {
    return [];
  }

  // Test helpers
  getStoredExams() {
    return this.exams;
  }

  getStoredVersions() {
    return this.versions;
  }

  getStoredEvents() {
    return this.events;
  }

  clear() {
    this.exams = [];
    this.versions = [];
    this.events = [];
  }
}

// Helper to create a minimal ExamState
function createMockExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.general.title = 'Test Exam';
  config.general.summary = 'Test summary';
  config.general.instructions = 'Test instructions';
  config.sections.listening.enabled = false;
  config.sections.listening.order = 1;
  config.sections.listening.bandScoreTable = { 30: 9.0, 25: 8.0, 20: 7.0 };
  config.sections.reading.enabled = true;
  config.sections.reading.order = 2;
  config.sections.reading.bandScoreTable = { 30: 9.0, 25: 8.0, 20: 7.0 };
  config.sections.writing.enabled = false;
  config.sections.writing.order = 3;
  config.sections.writing.tasks = [];
  config.sections.speaking.enabled = false;
  config.sections.speaking.order = 4;
  config.sections.speaking.parts = [];

  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: '',
    activeListeningPartId: '',
    config,
    reading: {
      passages: [
        {
          id: 'p1',
          title: 'Test Passage',
          content: 'Test content with sufficient length',
          blocks: [
            {
              id: 'b1',
              type: 'TFNG',
              mode: 'TFNG',
              instruction: 'Test instruction',
              questions: [
                { id: 'q1', statement: 'Test statement 1', correctAnswer: 'T' },
                { id: 'q2', statement: 'Test statement 2', correctAnswer: 'F' }
              ]
            }
          ]
        }
      ]
    },
    listening: {
      parts: [
        {
          id: 'l1',
          title: 'Part 1',
          pins: [],
          blocks: [
            {
              id: 'b2',
              type: 'TFNG',
              mode: 'TFNG',
              instruction: 'Test instruction',
              questions: [
                { id: 'q3', statement: 'Test statement 3', correctAnswer: 'T' }
              ]
            }
          ]
        }
      ]
    },
    writing: {
      task1Prompt: '',
      task2Prompt: ''
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: []
    }
  };
}

describe('ExamLifecycleService - Phase 3: Versioning', () => {
  let mockRepo: MockExamRepository;
  let service: ExamLifecycleService;

  beforeEach(() => {
    mockRepo = new MockExamRepository();
    service = new ExamLifecycleService(mockRepo);
  });

  describe('saveAsNewVersion', () => {
    it('should create a new version with incremented version number', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      expect(result.success).toBe(true);
      expect(result.exam).toBeDefined();
      expect(result.version).toBeDefined();
      expect(result.version?.versionNumber).toBe(1);

      // Save as new version
      const saveResult = await service.saveAsNewVersion(result.exam!.id, 'TestUser', 'Checkpoint 1');
      
      expect(saveResult.success).toBe(true);
      expect(saveResult.version).toBeDefined();
      expect(saveResult.version?.versionNumber).toBe(2);
      expect(saveResult.version?.publishNotes).toBe('Checkpoint 1');
    });

    it('should create audit event for version creation', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.saveAsNewVersion(result.exam!.id, 'TestUser', 'Checkpoint 1');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const versionEvent = events.find(e => e.action === 'version_created');
      
      expect(versionEvent).toBeDefined();
      expect(versionEvent?.actor).toBe('TestUser');
      expect(versionEvent?.payload).toEqual({ notes: 'Checkpoint 1', explicitSave: true });
    });

    it('should update exam draft version pointer', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      const oldDraftId = result.exam!.currentDraftVersionId;
      
      const saveResult = await service.saveAsNewVersion(result.exam!.id, 'TestUser');
      
      expect(saveResult.exam?.currentDraftVersionId).not.toBe(oldDraftId);
      expect(saveResult.exam?.currentDraftVersionId).toBe(saveResult.version?.id);
    });
  });

  describe('deleteExam', () => {
    it('deletes a draft exam and records an audit event', async () => {
      const initialState = createMockExamState();
      const created = await service.createExam('Delete Me', 'Academic', initialState, 'TestUser');

      expect(created.success).toBe(true);
      const examId = created.exam!.id;

      const deleted = await service.deleteExam(examId, 'Admin');
      expect(deleted.success).toBe(true);

      expect(mockRepo.getStoredExams().some((e) => e.id === examId)).toBe(false);

      const events = mockRepo.getStoredEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.examId === examId && (e.payload as any)?.deleted === true)).toBe(true);
    });

    it('rejects deletion of published exams', async () => {
      const initialState = createMockExamState();
      const created = await service.createExam('Published Exam', 'Academic', initialState, 'TestUser');
      const examId = created.exam!.id;

      const exam = await mockRepo.getExamById(examId);
      expect(exam).toBeTruthy();
      if (exam) {
        exam.status = 'published';
        await mockRepo.saveExam(exam);
      }

      const deleted = await service.deleteExam(examId, 'Admin');
      expect(deleted.success).toBe(false);
      expect(deleted.error).toMatch(/cannot delete/i);
      expect(mockRepo.getStoredExams().some((e) => e.id === examId)).toBe(true);
    });
  });

  describe('bulkDelete', () => {
    it('deletes eligible exams and reports per-item failures', async () => {
      const initialState = createMockExamState();

      const a = await service.createExam('Draft A', 'Academic', initialState, 'TestUser');
      const b = await service.createExam('Published B', 'Academic', initialState, 'TestUser');

      const aId = a.exam!.id;
      const bId = b.exam!.id;

      const bExam = await mockRepo.getExamById(bId);
      expect(bExam).toBeTruthy();
      if (bExam) {
        bExam.status = 'published';
        await mockRepo.saveExam(bExam);
      }

      const result = await service.bulkDelete([aId, bId, 'missing'], 'Admin');

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.success).toBe(true);

      expect(mockRepo.getStoredExams().some((e) => e.id === aId)).toBe(false);
      expect(mockRepo.getStoredExams().some((e) => e.id === bId)).toBe(true);

      const missingRow = result.results.find((r) => r.examId === 'missing');
      expect(missingRow?.success).toBe(false);
      expect(missingRow?.error).toMatch(/not found/i);
    });
  });

  describe('cloneExam', () => {
    it('should create a new exam with cloned content', async () => {
      const initialState = createMockExamState();
      const originalResult = await service.createExam('Original Exam', 'Academic', initialState, 'TestUser');
      
      const result = await service.cloneExam(originalResult.exam!.id, 'Cloned Exam', 'Cloner');
      
      expect(result.success).toBe(true);
      expect(result.exam).toBeDefined();
      expect(result.exam?.id).not.toBe(originalResult.exam?.id);
      expect(result.exam?.title).toBe('Cloned Exam');
      expect(result.exam?.status).toBe('draft');
    });

    it('should create a new version for cloned exam', async () => {
      const initialState = createMockExamState();
      const originalResult = await service.createExam('Original Exam', 'Academic', initialState, 'TestUser');
      
      const result = await service.cloneExam(originalResult.exam!.id, 'Cloned Exam', 'Cloner');
      
      expect(result.version).toBeDefined();
      expect(result.version?.versionNumber).toBe(1);
      expect(result.version?.isDraft).toBe(true);
    });

    it('should create audit events for both source and cloned exam', async () => {
      const initialState = createMockExamState();
      const originalResult = await service.createExam('Original Exam', 'Academic', initialState, 'TestUser');
      
      const result = await service.cloneExam(originalResult.exam!.id, 'Cloned Exam', 'Cloner');
      
      const sourceEvents = await mockRepo.getEvents(originalResult.exam!.id);
      const clonedEvent = sourceEvents.find(e => e.action === 'cloned');
      
      expect(clonedEvent).toBeDefined();
      expect(clonedEvent?.payload).toEqual({
        clonedTo: result.exam?.id,
        newTitle: 'Cloned Exam'
      });

      const newExamEvents = await mockRepo.getEvents(result.exam!.id);
      const createdEvent = newExamEvents.find(e => e.action === 'created');
      
      expect(createdEvent).toBeDefined();
      expect(createdEvent?.payload).toEqual({
        clonedFrom: originalResult.exam?.id,
        sourceTitle: 'Original Exam'
      });
    });

    it('should return error if source exam not found', async () => {
      const result = await service.cloneExam('non-existent-id', 'Cloned Exam', 'Cloner');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Source exam not found');
    });
  });

  describe('createFromTemplate', () => {
    it('should clone exam with template-specific audit event', async () => {
      const initialState = createMockExamState();
      const templateResult = await service.createExam('Template Exam', 'Academic', initialState, 'TestUser');
      
      const result = await service.createFromTemplate(templateResult.exam!.id, 'Exam from Template', 'User');
      
      expect(result.success).toBe(true);
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const templateEvents = events.filter(e => e.payload?.createdFromTemplate);
      
      expect(templateEvents.length).toBeGreaterThan(0);
    });
  });

  describe('restoreVersionAsDraft', () => {
    it('should create a new draft version from restored content', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      // Create version 2
      await service.saveAsNewVersion(result.exam!.id, 'TestUser', 'Version 2');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      
      const restoreResult = await service.restoreVersionAsDraft(result.exam!.id, version1!.id, 'Restorer', 'Rollback to v1');
      
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.version).toBeDefined();
      expect(restoreResult.version?.versionNumber).toBe(3);
      expect(restoreResult.version?.parentVersionId).toBe(version1?.id);
      expect(restoreResult.version?.isDraft).toBe(true);
    });

    it('should update exam draft version pointer', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.saveAsNewVersion(result.exam!.id, 'TestUser', 'Version 2');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      
      const restoreResult = await service.restoreVersionAsDraft(result.exam!.id, version1!.id, 'Restorer');
      
      expect(restoreResult.exam?.currentDraftVersionId).toBe(restoreResult.version?.id);
    });

    it('should create audit event for restore', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      
      await service.restoreVersionAsDraft(result.exam!.id, version1!.id, 'Restorer', 'Rollback reason');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const restoreEvent = events.find(e => e.action === 'version_restored');
      
      expect(restoreEvent).toBeDefined();
      expect(restoreEvent?.actor).toBe('Restorer');
      expect(restoreEvent?.payload).toEqual({
        restoredFromVersion: 1,
        notes: 'Rollback reason'
      });
    });

    it('should return error if version not found', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      const restoreResult = await service.restoreVersionAsDraft(result.exam!.id, 'non-existent-version', 'Restorer');
      
      expect(restoreResult.success).toBe(false);
      expect(restoreResult.error).toBe('Version not found');
    });

    it('should return error if version belongs to different exam', async () => {
      const initialState = createMockExamState();
      const result1 = await service.createExam('Exam 1', 'Academic', initialState, 'TestUser');
      const result2 = await service.createExam('Exam 2', 'Academic', initialState, 'TestUser');
      
      const versions1 = await mockRepo.getAllVersions(result1.exam!.id);
      const version1 = versions1[0];
      
      const restoreResult = await service.restoreVersionAsDraft(result2.exam!.id, version1.id, 'Restorer');
      
      expect(restoreResult.success).toBe(false);
      expect(restoreResult.error).toBe('Version does not belong to this exam');
    });
  });

  describe('republishVersion', () => {
    it('should create a new published version from existing version', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      // Publish original
      await service.publishExam(result.exam!.id, 'TestUser', 'Initial publish');
      
      // Create draft changes
      await service.saveDraft(result.exam!.id, initialState, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const publishedVersion = versions.find(v => v.isPublished);
      
      const republishResult = await service.republishVersion(result.exam!.id, publishedVersion!.id, 'Republisher', 'Republishing v1');
      
      expect(republishResult.success).toBe(true);
      expect(republishResult.version).toBeDefined();
      expect(republishResult.version?.isPublished).toBe(true);
      expect(republishResult.version?.publishNotes).toBe('Republishing v1');
    });

    it('should update exam published version pointer', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.publishExam(result.exam!.id, 'TestUser', 'Initial publish');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const publishedVersion = versions.find(v => v.isPublished);
      
      const oldPublishedId = result.exam!.currentPublishedVersionId;
      const republishResult = await service.republishVersion(result.exam!.id, publishedVersion!.id, 'Republisher');
      
      expect(republishResult.exam?.currentPublishedVersionId).not.toBe(oldPublishedId);
      expect(republishResult.exam?.currentPublishedVersionId).toBe(republishResult.version?.id);
    });

    it('should update exam status to published', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.publishExam(result.exam!.id, 'TestUser');
      
      // Unpublish
      await service.unpublishExam(result.exam!.id, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const publishedVersion = versions.find(v => v.isPublished);
      
      const republishResult = await service.republishVersion(result.exam!.id, publishedVersion!.id, 'Republisher');
      
      expect(republishResult.exam?.status).toBe('published');
    });

    it('should create audit event for republish', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.publishExam(result.exam!.id, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const publishedVersion = versions.find(v => v.isPublished);
      
      await service.republishVersion(result.exam!.id, publishedVersion!.id, 'Republisher', 'Republish reason');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const republishEvents = events.filter(e => e.action === 'published' && e.payload?.republishedFromVersion);
      
      expect(republishEvents.length).toBeGreaterThan(0);
      expect(republishEvents[0].payload).toEqual({
        republishedFromVersion: publishedVersion!.versionNumber,
        notes: 'Republish reason'
      });
    });

    it('should return error if version not found', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      const republishResult = await service.republishVersion(result.exam!.id, 'non-existent-version', 'Republisher');
      
      expect(republishResult.success).toBe(false);
      expect(republishResult.error).toBe('Version not found');
    });
  });

  describe('compareVersions', () => {
    it('should return null if versions not found', async () => {
      const result = await service.compareVersions('exam-id', 'version-a', 'version-b');
      
      expect(result).toBeNull();
    });

    it('should compare version metadata', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.saveAsNewVersion(result.exam!.id, 'TestUser', 'Version 2');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      const version2 = versions.find(v => v.versionNumber === 2);
      
      const diff = await service.compareVersions(result.exam!.id, version1!.id, version2!.id);
      
      expect(diff).not.toBeNull();
      expect(diff?.metadataDiff.versionNumberChanged).toBe(true);
      expect(diff?.metadataDiff.creatorChanged).toBe(false);
    });

    it('should detect content count changes', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      // Modify content
      const modifiedState = JSON.parse(JSON.stringify(initialState)) as ExamState;
      modifiedState.reading.passages = [
        { id: 'p1', title: 'Passage 1', content: 'Content', blocks: [] },
        { id: 'p2', title: 'Passage 2', content: 'Content 2', blocks: [] }
      ];
      
      await service.saveDraft(result.exam!.id, modifiedState, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      const version2 = versions.find(v => v.versionNumber === 2);
      
      const diff = await service.compareVersions(result.exam!.id, version1!.id, version2!.id);
      
      expect(diff?.countsDiff.readingPassages.changed).toBe(true);
      expect(diff?.countsDiff.readingPassages.a).toBe(1);
      expect(diff?.countsDiff.readingPassages.b).toBe(2);
    });

    it('should calculate change count', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.saveAsNewVersion(result.exam!.id, 'TestUser');
      
      const versions = await mockRepo.getAllVersions(result.exam!.id);
      const version1 = versions.find(v => v.versionNumber === 1);
      const version2 = versions.find(v => v.versionNumber === 2);
      
      const diff = await service.compareVersions(result.exam!.id, version1!.id, version2!.id);
      
      expect(diff?.hasChanges).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log all lifecycle events', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.saveDraft(result.exam!.id, initialState, 'TestUser');
      await service.publishExam(result.exam!.id, 'TestUser', 'Publish notes');
      await service.unpublishExam(result.exam!.id, 'TestUser', 'Unpublish reason');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      
      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events.some(e => e.action === 'created')).toBe(true);
      expect(events.some(e => e.action === 'draft_saved')).toBe(true);
      expect(events.some(e => e.action === 'published')).toBe(true);
      expect(events.some(e => e.action === 'unpublished')).toBe(true);
    });

    it('should include actor and timestamp in events', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestActor');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const createEvent = events.find(e => e.action === 'created');
      
      expect(createEvent?.actor).toBe('TestActor');
      expect(createEvent?.timestamp).toBeDefined();
      expect(new Date(createEvent!.timestamp)).toBeInstanceOf(Date);
    });

    it('should include payload data when provided', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.publishExam(result.exam!.id, 'TestUser', 'Publish with notes');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const publishEvent = events.find(e => e.action === 'published');
      
      expect(publishEvent?.payload).toEqual({ notes: 'Publish with notes' });
    });

    it('should include state transitions in events', async () => {
      const initialState = createMockExamState();
      const result = await service.createExam('Test Exam', 'Academic', initialState, 'TestUser');
      
      await service.publishExam(result.exam!.id, 'TestUser');
      
      const events = await mockRepo.getEvents(result.exam!.id);
      const publishEvent = events.find(e => e.action === 'published');
      
      expect(publishEvent?.fromState).toBe('draft');
      expect(publishEvent?.toState).toBe('published');
    });
  });

  describe('getPublishReadiness', () => {
    it('does not crash when the stored draft content is missing module containers', async () => {
      const config = createDefaultConfig('Academic', 'Academic');
      const exam: ExamEntity = {
        id: 'exam-corrupt',
        slug: 'corrupt-exam',
        title: 'Corrupt Exam',
        type: 'Academic',
        status: 'draft',
        visibility: 'organization',
        owner: 'TestUser',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        currentDraftVersionId: 'ver-corrupt',
        currentPublishedVersionId: null,
        canEdit: true,
        canPublish: true,
        canDelete: true,
        schemaVersion: SCHEMA_VERSION,
      };

      const version: ExamVersion = {
        id: 'ver-corrupt',
        examId: 'exam-corrupt',
        versionNumber: 1,
        parentVersionId: null,
        contentSnapshot: { config } as any,
        configSnapshot: config,
        validationSnapshot: {
          isValid: false,
          errorCount: 0,
          warningCount: 0,
          lastValidatedAt: '2026-01-01T00:00:00.000Z',
        },
        createdBy: 'TestUser',
        createdAt: '2026-01-01T00:00:00.000Z',
        isDraft: true,
        isPublished: false,
      };

      await mockRepo.saveExam(exam);
      await mockRepo.saveVersion(version);

      const readiness = await service.getPublishReadiness('exam-corrupt');

      expect(readiness.canPublish).toBe(false);
      expect(readiness.questionCounts).toEqual({
        reading: 0,
        listening: 0,
        total: 0,
      });
      expect(
        readiness.errors.some((error) => error.field === 'reading.questions'),
      ).toBe(true);
      expect(
        readiness.errors.some((error) => error.field === 'listening.questions'),
      ).toBe(true);
    });
  });
});
