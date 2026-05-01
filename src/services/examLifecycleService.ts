/**
 * Exam Lifecycle Service - Business Logic Layer
 * 
 * This service handles all exam lifecycle operations including:
 * - Status transitions with guards
 * - Version management
 * - Audit logging
 * - Publish readiness validation
 * 
 * UI components should call this service, not the repository directly.
 */

import { examRepository, type IExamRepository } from './examRepository';
import {
  ExamEntity,
  ExamVersion,
  ExamEvent,
  ExamStatus,
  ExamAction,
  StatusTransition,
  TransitionResult,
  PublishReadiness,
  SCHEMA_VERSION,
  CloneResult,
  RestoreResult,
  VersionDiff,
  BulkOperationResult
} from '../types/domain';
import { ExamState, ModuleType } from '../types';
import {
  validateReadingModule,
  validateListeningModule,
  getReadingTotalQuestions,
  getListeningTotalQuestions
} from '../utils/examUtils';
import { normalizeExamStateTableCompletionBlocks } from '../utils/tableCompletion';
import { hydrateExamState } from './examAdapterService';
import { getWritingTaskContent } from '../utils/writingTaskUtils';
import { getExamIdCollisionIssues } from '../utils/examIdCollisionCheck';
import {
  backendDelete,
  backendGet,
  backendPatch,
  backendPost,
  getExamRevision,
  isBackendBuilderEnabled,
  mapBackendExamVersion,
  rememberExamRevision,
} from './backendBridge';
import { canTransition } from './policies/examStatusTransitions';

/**
 * Generate a slug from a title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Generate a unique ID
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Exam Lifecycle Service
 */
export class ExamLifecycleService {
  constructor(private repository: IExamRepository = examRepository) {}

  private useBackendBuilder(): boolean {
    // Production path: the default repository is backend-only.
    // Unit tests can inject an in-memory mock repository; those should not
    // attempt to hit backend endpoints.
    return this.repository === examRepository;
  }

  private async ensureBackendExamRevision(examId: string): Promise<number | null> {
    const cached = getExamRevision(examId);
    if (cached !== undefined) {
      return cached;
    }

    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return null;
    }

    return getExamRevision(examId) ?? null;
  }

  private async refreshBackendExamRevision(examId: string): Promise<number | null> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return null;
    }

    return getExamRevision(examId) ?? null;
  }
  
  /**
   * Create a new exam
   */
  async createExam(
    title: string,
    type: 'Academic' | 'General Training',
    initialState: ExamState,
    owner: string = 'System'
  ): Promise<TransitionResult> {
    if (this.useBackendBuilder()) {
      try {
        const slug = generateSlug(title);
        const createdExam = await backendPost<any>('/v1/exams', {
          slug,
          title,
          examType: type,
          visibility: 'organization',
        });

        rememberExamRevision(createdExam.id, createdExam.revision);

        const savedVersion = await backendPatch<any>(`/v1/exams/${createdExam.id}/draft`, {
          contentSnapshot: initialState,
          configSnapshot: initialState.config,
          revision: getExamRevision(createdExam.id) ?? createdExam.revision ?? 0,
        });

        const exam = await this.repository.getExamById(createdExam.id);
        const version = savedVersion ? mapBackendExamVersion(savedVersion) : null;

        return {
          success: true,
          exam: exam ?? undefined,
          version: version ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create exam',
        };
      }
    }

    const examId = generateId('exam');
    const slug = generateSlug(title);
    const now = new Date().toISOString();
    
    // Create exam entity
    const exam: ExamEntity = {
      id: examId,
      slug,
      title,
      type,
      status: 'draft',
      visibility: 'organization',
      owner,
      createdAt: now,
      updatedAt: now,
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: SCHEMA_VERSION
    };
    
    // Create initial version
    const version: ExamVersion = {
      id: generateId('ver'),
      examId,
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: initialState,
      configSnapshot: initialState.config,
      validationSnapshot: {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        lastValidatedAt: now
      },
      createdBy: owner,
      createdAt: now,
      isDraft: true,
      isPublished: false
    };
    
    exam.currentDraftVersionId = version.id;
    
    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: version.id,
      actor: owner,
      action: 'created',
      timestamp: now
    };
    
    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(version);
    await this.repository.saveEvent(event);
    
    return {
      success: true,
      exam,
      version,
      event
    };
  }
  
  /**
   * Save a draft version
   * If exam is published, editing creates a new draft version without affecting the published version
   */
  async saveDraft(
    examId: string,
    content: ExamState,
    actor: string = 'System'
  ): Promise<TransitionResult> {
    const normalizedContent = normalizeExamStateTableCompletionBlocks(content);

    if (this.useBackendBuilder()) {
      try {
        const revision = await this.ensureBackendExamRevision(examId);
        if (revision === null) {
          return { success: false, error: 'Exam not found' };
        }

        const savedVersion = await backendPatch<any>(`/v1/exams/${examId}/draft`, {
          contentSnapshot: normalizedContent,
          configSnapshot: normalizedContent.config,
          revision,
        });
        const exam = await this.repository.getExamById(examId);
        const desiredTitle = (normalizedContent.config?.general?.title ?? normalizedContent.title ?? '').trim();

        if (exam && desiredTitle && exam.title !== desiredTitle) {
          const nextRevision = getExamRevision(examId);
          if (nextRevision === undefined) {
            throw new Error('Missing exam revision after draft save.');
          }

          await backendPatch(`/v1/exams/${examId}`, {
            title: desiredTitle,
            revision: nextRevision,
          });
          await this.repository.getExamById(examId);
        }
        const version = savedVersion ? mapBackendExamVersion(savedVersion) : null;

        return {
          success: true,
          exam: exam ?? undefined,
          version: version ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save draft',
        };
      }
    }

    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    const now = new Date().toISOString();

    // Get current version to determine next version number
    const allVersions = await this.repository.getAllVersions(examId);
    const maxVersion = Math.max(...allVersions.map(v => v.versionNumber), 0);

    // Determine parent version - if published, parent should be the published version
    let parentVersionId: string | null;
    if (exam.status === 'published' && exam.currentPublishedVersionId) {
      parentVersionId = exam.currentPublishedVersionId;
    } else {
      parentVersionId = exam.currentDraftVersionId;
    }

    // Create new draft version
    const version: ExamVersion = {
      id: generateId('ver'),
      examId,
      versionNumber: maxVersion + 1,
      parentVersionId,
      contentSnapshot: normalizedContent,
      configSnapshot: normalizedContent.config,
      validationSnapshot: {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        lastValidatedAt: now
      },
      createdBy: actor,
      createdAt: now,
      isDraft: true,
      isPublished: false
    };

    // Update exam - always point draft version to the new version
    exam.currentDraftVersionId = version.id;
    exam.updatedAt = now;

    // If exam was published, it stays published but now has a draft version for editing
    // If exam was in another non-published state, it stays in that state
    // The published version remains immutable

    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: version.id,
      actor,
      action: exam.status === 'published' ? 'version_created' : 'draft_saved',
      timestamp: now,
      payload: exam.status === 'published' ? { editingPublished: true } : undefined
    };

    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(version);
    await this.repository.saveEvent(event);

    return {
      success: true,
      exam,
      version,
      event
    };
  }
  
  /**
   * Transition exam status
   */
  async transitionStatus(
    examId: string,
    toStatus: ExamStatus,
    actor: string = 'System',
    notes?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    if (this.useBackendBuilder()) {
      if (toStatus === 'published') {
        return this.publishExam(examId, actor, notes);
      }

      // Check if transition is allowed before calling the backend.
      if (!canTransition(exam.status, toStatus)) {
        return {
          success: false,
          error: `Cannot transition from ${exam.status} to ${toStatus}`,
        };
      }

      try {
        const revision = await this.ensureBackendExamRevision(examId);
        if (revision === null) {
          return { success: false, error: 'Exam not found' };
        }

        await backendPatch(`/v1/exams/${examId}`, {
          status: toStatus,
          revision,
        });

        const updatedExam = await this.repository.getExamById(examId);
        return {
          success: true,
          exam: updatedExam ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update exam',
        };
      }
    }
    
    // Check if transition is allowed
    if (!canTransition(exam.status, toStatus)) {
      return {
        success: false,
        error: `Cannot transition from ${exam.status} to ${toStatus}`
      };
    }
    
    const fromStatus = exam.status;
    const now = new Date().toISOString();
    
    // Update exam status and timestamps
    exam.status = toStatus;
    exam.updatedAt = now;
    
    if (toStatus === 'published') {
      exam.publishedAt = now;
    } else if (toStatus === 'archived') {
      exam.archivedAt = now;
    }
    
    // Determine action type
    let action: ExamAction;
    switch (toStatus) {
      case 'in_review':
        action = 'submitted_for_review';
        break;
      case 'approved':
        action = 'approved';
        break;
      case 'rejected':
        action = 'rejected';
        break;
      case 'published':
        action = 'published';
        break;
      case 'unpublished':
        action = 'unpublished';
        break;
      case 'archived':
        action = 'archived';
        break;
      default:
        action = 'draft_saved';
    }
    
    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      actor,
      action,
      fromState: fromStatus,
      toState: toStatus,
      timestamp: now,
      payload: notes ? { notes } : undefined
    };
    
    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveEvent(event);
    
    return {
      success: true,
      exam,
      event
    };
  }
  
  /**
   * Publish an exam (creates an immutable published version)
   */
  async publishExam(
    examId: string,
    actor: string = 'System',
    publishNotes?: string
  ): Promise<TransitionResult> {
    if (this.useBackendBuilder()) {
      const readiness = await this.getPublishReadiness(examId);
      if (!readiness.canPublish) {
        const exam = await this.repository.getExamById(examId);
        return {
          success: false,
          error: 'Exam is not ready for publication',
          exam: exam ?? undefined,
        };
      }

      try {
        const revision = await this.refreshBackendExamRevision(examId);
        if (revision === null) {
          return { success: false, error: 'Exam not found' };
        }

        const publishedVersion = await backendPost<any>(`/v1/exams/${examId}/publish`, {
          publishNotes,
          revision,
        });
        const exam = await this.repository.getExamById(examId);
        const version = publishedVersion ? mapBackendExamVersion(publishedVersion) : null;

        return {
          success: true,
          exam: exam ?? undefined,
          version: version ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to publish exam',
        };
      }
    }

    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }
    
    // Check if exam can be published
    const readiness = await this.getPublishReadiness(examId);
    if (!readiness.canPublish) {
      return {
        success: false,
        error: 'Exam is not ready for publication',
        exam
      };
    }
    
    const now = new Date().toISOString();
    
    // Get current draft version
    if (!exam.currentDraftVersionId) {
      return { success: false, error: 'No draft version to publish' };
    }
    
    const draftVersion = await this.repository.getVersionById(exam.currentDraftVersionId);
    if (!draftVersion) {
      return { success: false, error: 'Draft version not found' };
    }
    
    // Create published version (immutable copy)
    const publishedVersion: ExamVersion = {
      ...draftVersion,
      id: generateId('ver'),
      versionNumber: draftVersion.versionNumber,
      parentVersionId: draftVersion.id,
      isDraft: false,
      isPublished: true,
      publishNotes,
      createdAt: now
    };
    
    // Update exam
    const previousStatus = exam.status;
    exam.currentPublishedVersionId = publishedVersion.id;
    exam.status = 'published';
    exam.publishedAt = now;
    exam.updatedAt = now;
    
    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: publishedVersion.id,
      actor,
      action: 'published',
      fromState: previousStatus,
      toState: 'published',
      timestamp: now,
      payload: publishNotes ? { notes: publishNotes } : undefined
    };
    
    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(publishedVersion);
    await this.repository.saveEvent(event);
    
    return {
      success: true,
      exam,
      version: publishedVersion,
      event
    };
  }
  
  /**
   * Unpublish an exam (withdraw from live)
   */
  async unpublishExam(
    examId: string,
    actor: string = 'System',
    reason?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }
    
    if (exam.status !== 'published') {
      return { success: false, error: 'Exam is not published' };
    }
    
    const now = new Date().toISOString();
    
    // Update exam status
    exam.status = 'unpublished';
    exam.updatedAt = now;
    
    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      actor,
      action: 'unpublished',
      fromState: 'published',
      toState: 'unpublished',
      timestamp: now,
      payload: reason ? { reason } : undefined
    };
    
    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveEvent(event);
    
    return {
      success: true,
      exam,
      event
    };
  }
  
  /**
   * Submit exam for review
   */
  async submitForReview(
    examId: string,
    actor: string = 'System'
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    // Check if exam is in draft status
    if (exam.status !== 'draft') {
      return {
        success: false,
        error: `Cannot submit exam for review from status: ${exam.status}. Only draft exams can be submitted.`
      };
    }

    // Check publish readiness before allowing review submission
    const readiness = await this.getPublishReadiness(examId);
    if (!readiness.canPublish) {
      return {
        success: false,
        error: 'Exam has validation errors that must be fixed before submission',
        exam
      };
    }

    return this.transitionStatus(examId, 'in_review', actor);
  }

  /**
   * Approve exam for publication
   */
  async approveExam(
    examId: string,
    actor: string = 'System',
    notes?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    if (exam.status !== 'in_review') {
      return {
        success: false,
        error: `Cannot approve exam from status: ${exam.status}. Only exams in review can be approved.`
      };
    }

    const result = await this.transitionStatus(examId, 'approved', actor, notes);
    return result;
  }

  /**
   * Reject exam during review
   */
  async rejectExam(
    examId: string,
    actor: string = 'System',
    reason?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    if (exam.status !== 'in_review') {
      return {
        success: false,
        error: `Cannot reject exam from status: ${exam.status}. Only exams in review can be rejected.`
      };
    }

    return this.transitionStatus(examId, 'rejected', actor, reason);
  }

  /**
   * Schedule exam for publication (marks as scheduled status)
   */
  async schedulePublish(
    examId: string,
    actor: string = 'System',
    scheduledTime?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    // Check if exam is approved or published
    if (exam.status !== 'approved' && exam.status !== 'published') {
      return {
        success: false,
        error: `Cannot schedule exam from status: ${exam.status}. Exam must be approved or published first.`
      };
    }

    // Check publish readiness
    const readiness = await this.getPublishReadiness(examId);
    if (!readiness.canPublish) {
      return {
        success: false,
        error: 'Exam has validation errors that must be fixed before scheduling',
        exam
      };
    }

    const now = new Date().toISOString();

    // Update exam status
    const previousStatus = exam.status;
    exam.status = 'scheduled';
    exam.updatedAt = now;

    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      actor,
      action: 'scheduled',
      fromState: previousStatus,
      toState: 'scheduled',
      timestamp: now,
      payload: scheduledTime ? { scheduledTime } : undefined
    };

    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveEvent(event);

    return {
      success: true,
      exam,
      event
    };
  }

  /**
   * Archive an exam
   */
  async archiveExam(
    examId: string,
    actor: string = 'System'
  ): Promise<TransitionResult> {
    return this.transitionStatus(examId, 'archived', actor);
  }
  
  /**
   * Delete an exam
   */
  async deleteExam(
    examId: string,
    actor: string = 'System'
  ): Promise<TransitionResult> {
    if (this.useBackendBuilder()) {
      try {
        await backendDelete(`/v1/exams/${examId}`);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete exam',
        };
      }
    }

    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }
    
    // Check if exam can be deleted (only draft or archived)
    if (exam.status === 'published' || exam.status === 'scheduled') {
      return {
        success: false,
        error: 'Cannot delete published or scheduled exams. Unpublish or archive first.'
      };
    }
    
    const now = new Date().toISOString();
    
    // Create audit event before deletion
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      actor,
      action: 'permissions_updated', // Using this as a proxy for deletion
      timestamp: now,
      payload: { deleted: true }
    };
    
    // Delete exam
    await this.repository.deleteExam(examId);
    await this.repository.saveEvent(event);
    
    return {
      success: true,
      event
    };
  }
  
  /**
   * Check if exam is ready for publication with comprehensive validation
   */
  async getPublishReadiness(examId: string): Promise<PublishReadiness> {
    if (this.useBackendBuilder()) {
      try {
        const summary = await backendGet<{
          canPublish: boolean;
          errors: Array<{ field: string; message: string }>;
          warnings: Array<{ field: string; message: string }>;
        }>(`/v1/exams/${examId}/validation`);

        let questionCounts = { reading: 0, listening: 0, total: 0 };
        let integrityIssues: ReturnType<typeof getExamIdCollisionIssues> = [];
        try {
          const exam = await this.repository.getExamById(examId);
          const versionId = exam?.currentDraftVersionId ?? exam?.currentPublishedVersionId ?? null;
          if (versionId) {
            const version = await this.repository.getVersionById(versionId);
            if (version) {
              const content = hydrateExamState(version.contentSnapshot);
              const config = content.config;
              const readingQuestions = config.sections.reading.enabled
                ? getReadingTotalQuestions(content.reading.passages)
                : 0;
              const listeningQuestions = config.sections.listening.enabled
                ? getListeningTotalQuestions(content.listening.parts)
                : 0;
              integrityIssues = getExamIdCollisionIssues(content);
              questionCounts = {
                reading: readingQuestions,
                listening: listeningQuestions,
                total: readingQuestions + listeningQuestions,
              };
            }
          }
        } catch {
          // Ignore local readiness failures in backend mode; retain summary.
        }

        const mappedIntegrityErrors = integrityIssues.map((issue) => ({
          field: issue.field,
          message: issue.message,
          severity: issue.severity,
        }));

        const combinedErrors = [
          ...summary.errors.map((error) => ({
            field: error.field,
            message: error.message,
            severity: 'error' as const,
          })),
          ...mappedIntegrityErrors,
        ];

        const hasIntegrityError = mappedIntegrityErrors.some((issue) => issue.severity === 'error');
        return {
          canPublish: summary.canPublish && !hasIntegrityError,
          errors: combinedErrors,
          warnings: summary.warnings,
          missingFields: [
            ...summary.errors.map((error) => error.field),
            ...mappedIntegrityErrors.filter((issue) => issue.severity === 'error').map((issue) => issue.field),
          ],
          questionCounts,
        };
      } catch (error) {
        return {
          canPublish: false,
          errors: [
            {
              field: 'exam',
              message: error instanceof Error ? error.message : 'Failed to validate exam',
              severity: 'error',
            },
          ],
          warnings: [],
          missingFields: ['exam'],
          questionCounts: { reading: 0, listening: 0, total: 0 },
        };
      }
    }

    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return {
        canPublish: false,
        errors: [{ field: 'exam', message: 'Exam not found', severity: 'error' }],
        warnings: [],
        missingFields: ['exam'],
        questionCounts: { reading: 0, listening: 0, total: 0 }
      };
    }

    const version = exam.currentDraftVersionId
      ? await this.repository.getVersionById(exam.currentDraftVersionId)
      : null;

    if (!version) {
      return {
        canPublish: false,
        errors: [{ field: 'version', message: 'No draft version found', severity: 'error' }],
        warnings: [],
        missingFields: ['draft_version'],
        questionCounts: { reading: 0, listening: 0, total: 0 }
      };
    }

    const errors: Array<{ field: string; message: string; severity: 'error' | 'warning' }> = [];
    const warnings: Array<{ field: string; message: string }> = [];
    const missingFields: string[] = [];
    const content = hydrateExamState(version.contentSnapshot);
    const config = content.config;

    // 1. Title validation
    if (!exam.title.trim()) {
      errors.push({ field: 'title', message: 'Exam title is required', severity: 'error' });
      missingFields.push('title');
    }

    // 2. General config validation
    if (!config.general.summary.trim()) {
      warnings.push({ field: 'summary', message: 'Exam summary is empty' });
    }

    // 3. Enabled module completeness check
    const enabledModules: ModuleType[] = [];
    if (config.sections.reading.enabled) enabledModules.push('reading');
    if (config.sections.listening.enabled) enabledModules.push('listening');
    if (config.sections.writing.enabled) enabledModules.push('writing');
    if (config.sections.speaking.enabled) enabledModules.push('speaking');

    if (enabledModules.length === 0) {
      errors.push({ field: 'modules', message: 'At least one module must be enabled', severity: 'error' });
      missingFields.push('modules');
    }

    // 4. Reading module validation
    if (config.sections.reading.enabled) {
      const readingErrors = validateReadingModule(content.reading.passages);
      readingErrors.forEach(e => {
        errors.push({ field: e.field || 'reading', message: e.message, severity: e.type });
        if (e.type === 'error') missingFields.push(e.field || 'reading');
      });

      const readingQCount = getReadingTotalQuestions(content.reading.passages);
      if (readingQCount === 0) {
        errors.push({ field: 'reading.questions', message: 'Reading module has no questions', severity: 'error' });
        missingFields.push('reading.questions');
      } else if (readingQCount < 20) {
        warnings.push({ field: 'reading.questions', message: `Reading has only ${readingQCount} questions (recommended: 40)` });
      }

      // Band table validation
      const bandTable = config.sections.reading.bandScoreTable;
      if (!bandTable || Object.keys(bandTable).length === 0) {
        errors.push({ field: 'reading.bandTable', message: 'Reading band score table is missing', severity: 'error' });
        missingFields.push('reading.bandTable');
      }
    }

    // 5. Listening module validation
    if (config.sections.listening.enabled) {
      const listeningErrors = validateListeningModule(content.listening.parts);
      listeningErrors.forEach(e => {
        errors.push({ field: e.field || 'listening', message: e.message, severity: e.type });
        if (e.type === 'error') missingFields.push(e.field || 'listening');
      });

      const listeningQCount = getListeningTotalQuestions(content.listening.parts);
      if (listeningQCount === 0) {
        errors.push({ field: 'listening.questions', message: 'Listening module has no questions', severity: 'error' });
        missingFields.push('listening.questions');
      } else if (listeningQCount < 20) {
        warnings.push({ field: 'listening.questions', message: `Listening has only ${listeningQCount} questions (recommended: 40)` });
      }

      // Band table validation
      const bandTable = config.sections.listening.bandScoreTable;
      if (!bandTable || Object.keys(bandTable).length === 0) {
        errors.push({ field: 'listening.bandTable', message: 'Listening band score table is missing', severity: 'error' });
        missingFields.push('listening.bandTable');
      }
    }

    // 6. Writing module validation
    if (config.sections.writing.enabled) {
      if (!config.sections.writing.tasks || config.sections.writing.tasks.length === 0) {
        errors.push({ field: 'writing.config', message: 'Writing task configuration is missing', severity: 'error' });
        missingFields.push('writing.config');
      } else {
        config.sections.writing.tasks.forEach((task) => {
          const prompt = getWritingTaskContent(content.writing, config.sections.writing.tasks, task.id).prompt;

          if (!prompt.trim()) {
            errors.push({ field: `writing.${task.id}`, message: `${task.label} prompt is empty`, severity: 'error' });
            missingFields.push(`writing.${task.id}`);
          }
        });
      }
    }

    // 7. Speaking module validation
    if (config.sections.speaking.enabled) {
      if (!content.speaking.part1Topics || content.speaking.part1Topics.length === 0) {
        errors.push({ field: 'speaking.part1', message: 'Speaking Part 1 topics are empty', severity: 'error' });
        missingFields.push('speaking.part1');
      }
      if (!content.speaking.cueCard.trim()) {
        errors.push({ field: 'speaking.cueCard', message: 'Speaking cue card prompt is empty', severity: 'error' });
        missingFields.push('speaking.cueCard');
      }
      if (!content.speaking.part3Discussion || content.speaking.part3Discussion.length === 0) {
        errors.push({ field: 'speaking.part3', message: 'Speaking Part 3 discussion topics are empty', severity: 'error' });
        missingFields.push('speaking.part3');
      }

      // Validate speaking config
      if (!config.sections.speaking.parts || config.sections.speaking.parts.length === 0) {
        errors.push({ field: 'speaking.config', message: 'Speaking part configuration is missing', severity: 'error' });
        missingFields.push('speaking.config');
      }
    }

    // 8. Visibility and permissions check
    if (exam.visibility === 'private') {
      warnings.push({ field: 'visibility', message: 'Exam visibility is set to private - it will not be visible to other users' });
    }

    if (!exam.canPublish) {
      errors.push({ field: 'permissions', message: 'You do not have permission to publish this exam', severity: 'error' });
      missingFields.push('permissions');
    }

    // 9. Schedule conflicts check
    const schedules = await this.repository.getSchedulesByExam(examId);
    const activeSchedules = schedules.filter(s => s.status === 'scheduled' || s.status === 'live');
    if (activeSchedules.length > 0 && exam.status === 'published') {
      warnings.push({
        field: 'schedules',
        message: `Exam has ${activeSchedules.length} active schedule(s). Publishing a new version may affect scheduled sessions.`
      });
    }

    // Calculate question counts
    const readingQuestions = config.sections.reading.enabled ? getReadingTotalQuestions(content.reading.passages) : 0;
    const listeningQuestions = config.sections.listening.enabled ? getListeningTotalQuestions(content.listening.parts) : 0;

    const integrityIssues = getExamIdCollisionIssues(content);
    integrityIssues.forEach((issue) => {
      errors.push({
        field: issue.field,
        message: issue.message,
        severity: issue.severity,
      });
      if (issue.severity === 'error') {
        missingFields.push(issue.field);
      }
    });

    const hasErrors = errors.some(e => e.severity === 'error');

    return {
      canPublish: !hasErrors,
      errors,
      warnings,
      missingFields,
      questionCounts: {
        reading: readingQuestions,
        listening: listeningQuestions,
        total: readingQuestions + listeningQuestions
      }
    };
  }
  
  /**
   * Get exam history
   */
  async getExamHistory(examId: string, limit = 50): Promise<ExamEvent[]> {
    return this.repository.getEvents(examId, limit);
  }
  
  /**
   * Get all exams
   */
  async getAllExams(): Promise<ExamEntity[]> {
    return this.repository.getAllExams();
  }
  
  /**
   * Get exam by ID
   */
  async getExamById(examId: string): Promise<ExamEntity | null> {
    return this.repository.getExamById(examId);
  }
  
  /**
   * Get exam versions
   */
  async getExamVersions(examId: string): Promise<ExamVersion[]> {
    return this.repository.getAllVersions(examId);
  }

  /**
   * Compare two exam versions and return detailed differences
   */
  async compareVersions(
    examId: string,
    versionIdA: string,
    versionIdB: string
  ): Promise<VersionDiff | null> {
    const versionA = await this.repository.getVersionById(versionIdA);
    const versionB = await this.repository.getVersionById(versionIdB);

    if (!versionA || !versionB) {
      return null;
    }

    if (versionA.examId !== examId || versionB.examId !== examId) {
      return null;
    }

    // Metadata diffs
    const metadataDiff = {
      versionNumberChanged: versionA.versionNumber !== versionB.versionNumber,
      parentVersionChanged: versionA.parentVersionId !== versionB.parentVersionId,
      creatorChanged: versionA.createdBy !== versionB.createdBy,
      createdAtChanged: versionA.createdAt !== versionB.createdAt,
      publishNotesChanged: versionA.publishNotes !== versionB.publishNotes
    };

    // Config diffs - deep compare
    const configA = versionA.configSnapshot;
    const configB = versionB.configSnapshot;

    const configDiff = {
      generalChanged: JSON.stringify(configA.general) !== JSON.stringify(configB.general),
      sectionsChanged: {
        listening: JSON.stringify(configA.sections.listening) !== JSON.stringify(configB.sections.listening),
        reading: JSON.stringify(configA.sections.reading) !== JSON.stringify(configB.sections.reading),
        writing: JSON.stringify(configA.sections.writing) !== JSON.stringify(configB.sections.writing),
        speaking: JSON.stringify(configA.sections.speaking) !== JSON.stringify(configB.sections.speaking)
      },
      progressionChanged: JSON.stringify(configA.progression) !== JSON.stringify(configB.progression),
      scoringChanged: JSON.stringify(configA.scoring) !== JSON.stringify(configB.scoring),
      securityChanged: JSON.stringify(configA.security) !== JSON.stringify(configB.security)
    };

    // Content counts diff
    const contentA = hydrateExamState(versionA.contentSnapshot);
    const contentB = hydrateExamState(versionB.contentSnapshot);

    const readingPassagesA = contentA.reading.passages.length;
    const readingPassagesB = contentB.reading.passages.length;
    const readingQuestionsA = getReadingTotalQuestions(contentA.reading.passages);
    const readingQuestionsB = getReadingTotalQuestions(contentB.reading.passages);

    const listeningPartsA = contentA.listening.parts.length;
    const listeningPartsB = contentB.listening.parts.length;
    const listeningQuestionsA = getListeningTotalQuestions(contentA.listening.parts);
    const listeningQuestionsB = getListeningTotalQuestions(contentB.listening.parts);

    const countsDiff = {
      readingPassages: {
        a: readingPassagesA,
        b: readingPassagesB,
        changed: readingPassagesA !== readingPassagesB
      },
      readingQuestions: {
        a: readingQuestionsA,
        b: readingQuestionsB,
        changed: readingQuestionsA !== readingQuestionsB
      },
      listeningParts: {
        a: listeningPartsA,
        b: listeningPartsB,
        changed: listeningPartsA !== listeningPartsB
      },
      listeningQuestions: {
        a: listeningQuestionsA,
        b: listeningQuestionsB,
        changed: listeningQuestionsA !== listeningQuestionsB
      }
    };

    // Determine if there are any changes
    const hasChanges =
      metadataDiff.versionNumberChanged ||
      metadataDiff.parentVersionChanged ||
      metadataDiff.creatorChanged ||
      metadataDiff.createdAtChanged ||
      metadataDiff.publishNotesChanged ||
      configDiff.generalChanged ||
      configDiff.sectionsChanged.listening ||
      configDiff.sectionsChanged.reading ||
      configDiff.sectionsChanged.writing ||
      configDiff.sectionsChanged.speaking ||
      configDiff.progressionChanged ||
      configDiff.scoringChanged ||
      configDiff.securityChanged ||
      countsDiff.readingPassages.changed ||
      countsDiff.readingQuestions.changed ||
      countsDiff.listeningParts.changed ||
      countsDiff.listeningQuestions.changed;

    return {
      versionA,
      versionB,
      hasChanges,
      metadataDiff,
      configDiff,
      countsDiff
    };
  }

  /**
   * Save current state as a new version explicitly
   * This is different from auto-save - it creates a named version point
   */
  async saveAsNewVersion(
    examId: string,
    actor: string = 'System',
    notes?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    const now = new Date().toISOString();

    // Get current draft version to save from
    const currentVersionId = exam.currentDraftVersionId;
    if (!currentVersionId) {
      return { success: false, error: 'No current version to save from' };
    }

    const currentVersion = await this.repository.getVersionById(currentVersionId);
    if (!currentVersion) {
      return { success: false, error: 'Current version not found' };
    }

    // Get all versions to determine next version number
    const allVersions = await this.repository.getAllVersions(examId);
    const maxVersion = Math.max(...allVersions.map(v => v.versionNumber), 0);

    // Create new version as a snapshot
    const newVersion: ExamVersion = {
      id: generateId('ver'),
      examId,
      versionNumber: maxVersion + 1,
      parentVersionId: currentVersion.id,
      contentSnapshot: currentVersion.contentSnapshot,
      configSnapshot: currentVersion.configSnapshot,
      validationSnapshot: currentVersion.validationSnapshot,
      createdBy: actor,
      createdAt: now,
      publishNotes: notes,
      isDraft: true,
      isPublished: false
    };

    // Update exam to point to new version as draft
    exam.currentDraftVersionId = newVersion.id;
    exam.updatedAt = now;

    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: newVersion.id,
      actor,
      action: 'version_created',
      timestamp: now,
      payload: notes ? { notes, explicitSave: true } : { explicitSave: true }
    };

    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(newVersion);
    await this.repository.saveEvent(event);

    return {
      success: true,
      exam,
      version: newVersion,
      event
    };
  }

  /**
   * Clone an exam to create a new exam with the same content
   */
  async cloneExam(
    examId: string,
    newTitle: string,
    actor: string = 'System'
  ): Promise<CloneResult> {
    const sourceExam = await this.repository.getExamById(examId);
    if (!sourceExam) {
      return { success: false, error: 'Source exam not found' };
    }

    const now = new Date().toISOString();
    const newExamId = generateId('exam');
    const newSlug = generateSlug(newTitle);

    // Get current version to clone from
    const versionId = sourceExam.currentDraftVersionId || sourceExam.currentPublishedVersionId;
    if (!versionId) {
      return { success: false, error: 'No version to clone from' };
    }

    const sourceVersion = await this.repository.getVersionById(versionId);
    if (!sourceVersion) {
      return { success: false, error: 'Source version not found' };
    }

    // Create new exam entity
    const newExam: ExamEntity = {
      id: newExamId,
      slug: newSlug,
      title: newTitle,
      type: sourceExam.type,
      status: 'draft',
      visibility: sourceExam.visibility,
      owner: actor,
      createdAt: now,
      updatedAt: now,
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      canEdit: true,
      canPublish: true,
      canDelete: true,
      schemaVersion: SCHEMA_VERSION
    };

    // Create new version with cloned content
    const newVersion: ExamVersion = {
      id: generateId('ver'),
      examId: newExamId,
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: JSON.parse(JSON.stringify(sourceVersion.contentSnapshot)),
      configSnapshot: JSON.parse(JSON.stringify(sourceVersion.configSnapshot)),
      validationSnapshot: sourceVersion.validationSnapshot ? {
        ...sourceVersion.validationSnapshot,
        lastValidatedAt: now
      } : {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        lastValidatedAt: now
      },
      createdBy: actor,
      createdAt: now,
      isDraft: true,
      isPublished: false
    };

    newExam.currentDraftVersionId = newVersion.id;

    // Create audit event for source exam
    const sourceEvent: ExamEvent = {
      id: generateId('evt'),
      examId: sourceExam.id,
      actor,
      action: 'cloned',
      timestamp: now,
      payload: { clonedTo: newExamId, newTitle }
    };

    // Create audit event for new exam
    const newEvent: ExamEvent = {
      id: generateId('evt'),
      examId: newExamId,
      versionId: newVersion.id,
      actor,
      action: 'created',
      timestamp: now,
      payload: { clonedFrom: examId, sourceTitle: sourceExam.title }
    };

    // Persist
    await this.repository.saveExam(newExam);
    await this.repository.saveVersion(newVersion);
    await this.repository.saveEvent(sourceEvent);
    await this.repository.saveEvent(newEvent);

    return {
      success: true,
      exam: newExam,
      version: newVersion,
      event: newEvent
    };
  }

  /**
   * Create a new exam from a template
   * Similar to clone but marks the source as a template reference
   */
  async createFromTemplate(
    templateExamId: string,
    newTitle: string,
    actor: string = 'System'
  ): Promise<CloneResult> {
    const result = await this.cloneExam(templateExamId, newTitle, actor);

    if (result.success && result.exam) {
      // Override the event to indicate template usage
      const now = new Date().toISOString();
      const templateEvent: ExamEvent = {
        id: generateId('evt'),
        examId: result.exam.id,
        versionId: result.version?.id,
        actor,
        action: 'created',
        timestamp: now,
        payload: { createdFromTemplate: templateExamId }
      };

      await this.repository.saveEvent(templateEvent);
      result.event = templateEvent;
    }

    return result;
  }

  /**
   * Restore a version as a new draft (non-destructive)
   * This creates a new draft version from an older version's content
   */
  async restoreVersionAsDraft(
    examId: string,
    versionId: string,
    actor: string = 'System',
    notes?: string
  ): Promise<RestoreResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    const versionToRestore = await this.repository.getVersionById(versionId);
    if (!versionToRestore) {
      return { success: false, error: 'Version not found' };
    }

    if (versionToRestore.examId !== examId) {
      return { success: false, error: 'Version does not belong to this exam' };
    }

    const now = new Date().toISOString();

    // Get all versions to determine next version number
    const allVersions = await this.repository.getAllVersions(examId);
    const maxVersion = Math.max(...allVersions.map(v => v.versionNumber), 0);

    // Create new draft version from the restored version's content
    const restoredVersion: ExamVersion = {
      id: generateId('ver'),
      examId,
      versionNumber: maxVersion + 1,
      parentVersionId: versionToRestore.id,
      contentSnapshot: JSON.parse(JSON.stringify(versionToRestore.contentSnapshot)),
      configSnapshot: JSON.parse(JSON.stringify(versionToRestore.configSnapshot)),
      validationSnapshot: versionToRestore.validationSnapshot ? {
        ...versionToRestore.validationSnapshot,
        lastValidatedAt: now
      } : {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        lastValidatedAt: now
      },
      createdBy: actor,
      createdAt: now,
      isDraft: true,
      isPublished: false
    };

    // Update exam to point to restored version as draft
    exam.currentDraftVersionId = restoredVersion.id;
    exam.updatedAt = now;

    // If exam was published, it stays published with its published version intact
    // If exam was in another state, transition to draft
    if (exam.status !== 'published') {
      exam.status = 'draft';
    }

    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: restoredVersion.id,
      actor,
      action: 'version_restored',
      fromState: exam.status,
      toState: exam.status,
      timestamp: now,
      payload: {
        restoredFromVersion: versionToRestore.versionNumber,
        notes
      }
    };

    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(restoredVersion);
    await this.repository.saveEvent(event);

    return {
      success: true,
      exam,
      version: restoredVersion,
      event
    };
  }

  /**
   * Republish an older version as a new published version
   * This creates a new published version from an older version's content
   */
  async republishVersion(
    examId: string,
    versionId: string,
    actor: string = 'System',
    publishNotes?: string
  ): Promise<TransitionResult> {
    const exam = await this.repository.getExamById(examId);
    if (!exam) {
      return { success: false, error: 'Exam not found' };
    }

    const versionToRepublish = await this.repository.getVersionById(versionId);
    if (!versionToRepublish) {
      return { success: false, error: 'Version not found' };
    }

    if (versionToRepublish.examId !== examId) {
      return { success: false, error: 'Version does not belong to this exam' };
    }

    // Check publish readiness
    const readiness = await this.getPublishReadiness(examId);
    if (!readiness.canPublish) {
      return {
        success: false,
        error: 'Exam content is not ready for publication',
        exam
      };
    }

    const now = new Date().toISOString();

    // Get all versions to determine next version number
    const allVersions = await this.repository.getAllVersions(examId);
    const maxVersion = Math.max(...allVersions.map(v => v.versionNumber), 0);

    // Create new published version from the version's content
    const republishedVersion: ExamVersion = {
      id: generateId('ver'),
      examId,
      versionNumber: maxVersion + 1,
      parentVersionId: versionToRepublish.id,
      contentSnapshot: JSON.parse(JSON.stringify(versionToRepublish.contentSnapshot)),
      configSnapshot: JSON.parse(JSON.stringify(versionToRepublish.configSnapshot)),
      validationSnapshot: versionToRepublish.validationSnapshot ? {
        ...versionToRepublish.validationSnapshot,
        lastValidatedAt: now
      } : {
        isValid: true,
        errorCount: 0,
        warningCount: 0,
        lastValidatedAt: now
      },
      createdBy: actor,
      createdAt: now,
      publishNotes,
      isDraft: false,
      isPublished: true
    };

    // Update exam
    const previousStatus = exam.status;
    exam.currentPublishedVersionId = republishedVersion.id;
    exam.status = 'published';
    exam.publishedAt = now;
    exam.updatedAt = now;

    // Create audit event
    const event: ExamEvent = {
      id: generateId('evt'),
      examId,
      versionId: republishedVersion.id,
      actor,
      action: 'published',
      fromState: previousStatus,
      toState: 'published',
      timestamp: now,
      payload: {
        republishedFromVersion: versionToRepublish.versionNumber,
        notes: publishNotes
      }
    };

    // Persist
    await this.repository.saveExam(exam);
    await this.repository.saveVersion(republishedVersion);
    await this.repository.saveEvent(event);

    return {
      success: true,
      exam,
      version: republishedVersion,
      event
    };
  }

  /**
   * Bulk publish multiple exams
   * Returns per-item success/failure with reasons
   */
  async bulkPublish(
    examIds: string[],
    actor: string = 'System'
  ): Promise<BulkOperationResult> {
    const results: BulkOperationResult['results'] = [];
    
    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found'
        });
        continue;
      }

      const result = await this.publishExam(examId, actor);
      results.push({
        examId,
        examTitle: exam.title,
        success: result.success,
        error: result.error
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * Bulk unpublish multiple exams
   * Returns per-item success/failure with reasons
   */
  async bulkUnpublish(
    examIds: string[],
    actor: string = 'System'
  ): Promise<BulkOperationResult> {
    const results: BulkOperationResult['results'] = [];
    
    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found'
        });
        continue;
      }

      const result = await this.unpublishExam(examId, actor);
      results.push({
        examId,
        examTitle: exam.title,
        success: result.success,
        error: result.error
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * Bulk archive multiple exams
   * Returns per-item success/failure with reasons
   */
  async bulkArchive(
    examIds: string[],
    actor: string = 'System'
  ): Promise<BulkOperationResult> {
    const results: BulkOperationResult['results'] = [];
    
    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found'
        });
        continue;
      }

      const result = await this.archiveExam(examId, actor);
      results.push({
        examId,
        examTitle: exam.title,
        success: result.success,
        error: result.error
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * Bulk delete multiple exams
   * Returns per-item success/failure with reasons
   */
  async bulkDelete(
    examIds: string[],
    actor: string = 'System'
  ): Promise<BulkOperationResult> {
    const results: BulkOperationResult['results'] = [];

    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found',
        });
        continue;
      }

      const result = await this.deleteExam(examId, actor);
      results.push({
        examId,
        examTitle: exam.title,
        success: result.success,
        error: result.error,
      });
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Bulk duplicate (clone) multiple exams
   * Returns per-item success/failure with reasons
   */
  async bulkDuplicate(
    examIds: string[],
    actor: string = 'System'
  ): Promise<BulkOperationResult> {
    const results: BulkOperationResult['results'] = [];
    
    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found'
        });
        continue;
      }

      const result = await this.cloneExam(examId, `${exam.title} (Copy)`, actor);
      results.push({
        examId,
        examTitle: exam.title,
        success: result.success,
        error: result.error
      });
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results
    };
  }

  /**
   * Bulk export multiple exams as JSON
   * Returns per-item success/failure with reasons and export data
   */
  async bulkExport(
    examIds: string[],
    actor: string = 'System'
  ): Promise<{
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
      examId: string;
      examTitle: string;
      success: boolean;
      error?: string;
      data?: {
        schemaVersion: number;
        exportedAt: string;
        exportedBy: string;
        exam: import('../types/domain').ExamEntity;
        versions: import('../types/domain').ExamVersion[];
        events: import('../types/domain').ExamEvent[];
      };
    }>;
  }> {
    const results = [];
    
    for (const examId of examIds) {
      const exam = await this.repository.getExamById(examId);
      if (!exam) {
        results.push({
          examId,
          examTitle: 'Unknown',
          success: false,
          error: 'Exam not found'
        });
        continue;
      }

      try {
        // Get exam versions
        const versions = await this.repository.getAllVersions(examId);
        // Get exam events
        const events = await this.repository.getEvents(examId);
        
        const exportData = {
          schemaVersion: SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          exportedBy: actor,
          exam,
          versions,
          events
        };

        results.push({
          examId,
          examTitle: exam.title,
          success: true,
          data: exportData
        });
      } catch (error) {
        results.push({
          examId,
          examTitle: exam.title,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return {
      success: succeeded > 0,
      total: examIds.length,
      succeeded,
      failed,
      results
    };
  }
}

/**
 * Singleton instance for app-wide use
 */
export const examLifecycleService = new ExamLifecycleService();
