/**
 * Grading Service - Business Logic Layer
 * 
 * This service handles grading workflow operations:
 * - Session grouping from schedules
 * - Queue counts and filtering
 * - Draft management
 * - Review finalization and reopening
 * - Results handoff
 */
import {
  backendDeleteWithBody,
  backendGet,
  backendPost,
  backendPut,
  isBackendGradingEnabled,
} from './backendBridge';
import { getReviewDraftRevision, gradingRepository } from './gradingRepository';
import { examRepository } from './examRepository';
import {
  filterGradingSessions,
  filterStudentSubmissions,
  mapScheduleStatusToGradingStatus,
} from './gradingFilters';
import { isPreviewRuntimeCohortName } from '../features/builder/services/previewRuntimeSessionService';
import { ApiError } from '../shared/api-client/errors';
import {
  GradingSession,
  StudentSubmission,
  SectionSubmission,
  WritingTaskSubmission,
  ReviewDraft,
  ReviewEvent,
  GradingQueueFilters,
  SessionDetailFilters,
  SessionQueuePage,
  WritingAnnotation,
  StudentResult,
  GradingScheduleObjectiveOverrideRow,
  ObjectiveGradingSourceResponse,
  ObjectiveOverrideDeleteRequest,
  ObjectiveOverrideMutationResponse,
  ObjectiveLatestDraftRegradeRequest,
  ObjectiveLatestDraftRegradeResponse,
  ObjectiveOverrideUpsertRequest,
  ObjectiveQuestionOverrideRequest,
  ObjectiveIntegrityOverview,
  ActScienceScoreReport,
} from '../types/grading';

/**
 * Result of a grading service operation
 */
export interface GradingServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: unknown;
}

function gradingServiceError(fallback: string, error: unknown): unknown {
  // Preserve only rate-limit ApiErrors for the client retry predicate. Other
  // service failures keep the historical human-readable string contract.
  if (error instanceof ApiError && error.status === 429) {
    return error;
  }
  return `${fallback}: ${error instanceof Error ? error.message : String(error)}`;
}

export function gradingErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

/**
 * Session queue summary
 */
export interface SessionQueueSummary {
  totalSessions: number;
  totalStudents: number;
  pendingManualReviews: number;
  inProgressReviews: number;
  finalizedReviews: number;
  overdueReviews: number;
}

/**
 * Grading Service
 */
export class GradingService {
  
  /**
   * Build grading sessions from exam schedules
   * Groups exam version + cohort + scheduled window
   */
  async buildGradingSessions(): Promise<GradingServiceResult<GradingSession[]>> {
    try {
      const schedules = await examRepository.getAllSchedules();
      const sessions: GradingSession[] = [];
      
      for (const schedule of schedules) {
        if (isPreviewRuntimeCohortName(schedule.cohortName)) {
          continue;
        }

        // Check if session already exists
        const existing = await gradingRepository.getSessionById(schedule.id);
        if (existing) {
          sessions.push(existing);
          continue;
        }
        
        // Create new grading session from schedule
        const session: GradingSession = {
          id: schedule.id,
          scheduleId: schedule.id,
          examId: schedule.examId,
          examTitle: schedule.gradingDisplayName,
          publishedVersionId: schedule.publishedVersionId,
          cohortName: schedule.cohortName,
          institution: schedule.institution,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          status: mapScheduleStatusToGradingStatus(schedule.status),
          totalStudents: 0,
          submittedCount: 0,
          pendingManualReviews: 0,
          inProgressReviews: 0,
          finalizedReviews: 0,
          overdueReviews: 0,
          assignedTeachers: [],
          createdAt: schedule.createdAt,
          createdBy: schedule.createdBy,
          updatedAt: schedule.updatedAt
        };
        
        await gradingRepository.saveSession(session);
        sessions.push(session);
      }
      
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to build grading sessions', error) };
    }
  }
  
  /**
   * Get grading session queue with optional filters
   */
  async getSessionQueue(filters?: GradingQueueFilters): Promise<GradingServiceResult<GradingSession[]>> {
    try {
      let sessions = await gradingRepository.getAllSessions();
      sessions = sessions.filter(
        (session) => !isPreviewRuntimeCohortName(session.cohortName ?? ''),
      );

      if (filters) {
        sessions = filterGradingSessions(sessions, filters);
      }
      
      // Sort by start time (most recent first)
      sessions.sort((a, b) => this.compareTimestampsDesc(a.startTime, b.startTime));
      
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to get session queue', error) };
    }
  }
  
  /**
   * Get one page of the session queue with server-side pagination and search
   */
  async getSessionQueuePage(options?: {
    page?: number;
    pageSize?: number;
    searchQuery?: string;
  }): Promise<GradingServiceResult<SessionQueuePage>> {
    try {
      const page = Math.max(1, Math.floor(options?.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Math.floor(options?.pageSize ?? 10)));
      const data = await gradingRepository.getSessionQueuePage(page, pageSize, options?.searchQuery);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to load grading session queue', error) };
    }
  }

  /**
   * Get session queue summary
   */
  async getSessionQueueSummary(): Promise<GradingServiceResult<SessionQueueSummary>> {
    try {
      const sessions = (await gradingRepository.getAllSessions()).filter(
        (session) => !isPreviewRuntimeCohortName(session.cohortName ?? ''),
      );

      const summary: SessionQueueSummary = {
        totalSessions: sessions.length,
        totalStudents: sessions.reduce((sum, s) => sum + s.totalStudents, 0),
        pendingManualReviews: sessions.reduce((sum, s) => sum + s.pendingManualReviews, 0),
        inProgressReviews: sessions.reduce((sum, s) => sum + s.inProgressReviews, 0),
        finalizedReviews: sessions.reduce((sum, s) => sum + s.finalizedReviews, 0),
        overdueReviews: sessions.reduce((sum, s) => sum + s.overdueReviews, 0)
      };
      
      return { success: true, data: summary };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to get queue summary', error) };
    }
  }
  
  /**
   * Get student submissions for a session
   */
  async getSessionStudentSubmissions(
    sessionId: string,
    filters?: SessionDetailFilters
  ): Promise<GradingServiceResult<StudentSubmission[]>> {
    try {
      let submissions = await gradingRepository.getSubmissionsBySession(sessionId);
      
      if (filters) {
        submissions = filterStudentSubmissions(submissions, filters);
      }
      
      // Sort by submission time (most recent first)
      submissions.sort((a, b) => this.compareTimestampsDesc(a.submittedAt, b.submittedAt));
      
      return { success: true, data: submissions };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to get session submissions', error) };
    }
  }

  async getObjectiveOverrides(
    scheduleId: string,
  ): Promise<GradingServiceResult<GradingScheduleObjectiveOverrideRow[]>> {
    try {
      const overrides = await backendGet<GradingScheduleObjectiveOverrideRow[]>(
        `/v1/grading/schedules/${scheduleId}/objective-overrides`,
      );
      return { success: true, data: overrides };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to load objective overrides', error) };
    }
  }

  async getObjectiveGradingSource(
    scheduleId: string,
  ): Promise<GradingServiceResult<ObjectiveGradingSourceResponse>> {
    try {
      const source = await backendGet<ObjectiveGradingSourceResponse>(
        `/v1/grading/schedules/${scheduleId}/objective-grading-source`,
      );
      return { success: true, data: source };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to load objective grading source', error) };
    }
  }

  async getObjectiveIntegrityOverview(
    scheduleId: string,
  ): Promise<GradingServiceResult<ObjectiveIntegrityOverview>> {
    try {
      const overview = await backendGet<ObjectiveIntegrityOverview>(
        `/v1/grading/schedules/${scheduleId}/objective-integrity`,
      );
      return { success: true, data: overview };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to load objective integrity', error) };
    }
  }

  async getActScienceReports(): Promise<GradingServiceResult<ActScienceScoreReport[]>> {
    try {
      if (!isBackendGradingEnabled()) {
        return { success: false, error: 'ACT Science reports require backend grading.' };
      }

      const reports = await backendGet<ActScienceScoreReport[]>('/v1/results/act-science');
      return { success: true, data: reports };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to load ACT Science reports', error) };
    }
  }

  async upsertObjectiveOverride(
    scheduleId: string,
    questionId: string,
    request: ObjectiveOverrideUpsertRequest,
  ): Promise<GradingServiceResult<ObjectiveOverrideMutationResponse>> {
    try {
      const response = await backendPut<ObjectiveOverrideMutationResponse>(
        `/v1/grading/schedules/${scheduleId}/objective-overrides/${encodeURIComponent(questionId)}`,
        request,
      );
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to update objective override', error) };
    }
  }

  async deleteObjectiveOverride(
    scheduleId: string,
    questionId: string,
    request: ObjectiveOverrideDeleteRequest,
  ): Promise<GradingServiceResult<ObjectiveOverrideMutationResponse>> {
    try {
      const response = await backendDeleteWithBody<ObjectiveOverrideMutationResponse>(
        `/v1/grading/schedules/${scheduleId}/objective-overrides/${encodeURIComponent(questionId)}`,
        request,
      );
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to delete objective override', error) };
    }
  }

  async regradeObjectiveLatestDraft(
    scheduleId: string,
    request: ObjectiveLatestDraftRegradeRequest,
  ): Promise<GradingServiceResult<ObjectiveLatestDraftRegradeResponse>> {
    try {
      const response = await backendPost<ObjectiveLatestDraftRegradeResponse>(
        `/v1/grading/schedules/${scheduleId}/objective-regrade-latest-draft`,
        request,
      );
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to regrade objective sections', error) };
    }
  }

  async overrideObjectiveQuestion(
    submissionId: string,
    section: 'reading' | 'listening',
    questionId: string,
    request: ObjectiveQuestionOverrideRequest,
  ): Promise<GradingServiceResult<SectionSubmission>> {
    try {
      const response = await backendPut<SectionSubmission>(
        `/v1/grading/submissions/${encodeURIComponent(submissionId)}/sections/${section}/questions/${encodeURIComponent(questionId)}/override`,
        request,
      );
      await gradingRepository.saveSectionSubmission(response);
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to update student answer correctness', error) };
    }
  }
  
  /**
   * Create student submission from exam attempt
   */
  async createStudentSubmission(
    scheduleId: string,
    examId: string,
    publishedVersionId: string,
    studentId: string,
    studentName: string,
    studentEmail: string,
    cohortName: string,
    sectionAnswers: {
      listening?: import('../types/grading').ListeningAnswers;
      reading?: import('../types/grading').ReadingAnswers;
      writing?: import('../types/grading').WritingAnswers;
      speaking?: import('../types/grading').SpeakingAnswers;
    }
  ): Promise<GradingServiceResult<StudentSubmission>> {
    try {
      const submissionId = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const submission: StudentSubmission = {
        id: submissionId,
        submissionId,
        scheduleId,
        examId,
        publishedVersionId,
        studentId,
        studentName,
        studentEmail,
        cohortName,
        submittedAt: new Date().toISOString(),
        timeSpentSeconds: 0,
        gradingStatus: 'submitted',
        isFlagged: false,
        isOverdue: false,
        sectionStatuses: {
          listening: 'pending',
          reading: 'pending',
          writing: 'pending',
          speaking: 'pending'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await gradingRepository.saveSubmission(submission);
      
      // Create section submissions
      await this.createSectionSubmissions(submissionId, sectionAnswers);
      
      return { success: true, data: submission };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to create submission', error) };
    }
  }
  
  /**
   * Create section submissions from answers
   */
  private async createSectionSubmissions(
    submissionId: string,
    sectionAnswers: {
      listening?: import('../types/grading').ListeningAnswers;
      reading?: import('../types/grading').ReadingAnswers;
      writing?: import('../types/grading').WritingAnswers;
      speaking?: import('../types/grading').SpeakingAnswers;
    }
  ): Promise<void> {
    const sections: Array<{ section: 'listening' | 'reading' | 'writing' | 'speaking', answers: import('../types/grading').SectionAnswers | null }> = [
      { section: 'listening', answers: sectionAnswers.listening || null },
      { section: 'reading', answers: sectionAnswers.reading || null },
      { section: 'writing', answers: sectionAnswers.writing || null },
      { section: 'speaking', answers: sectionAnswers.speaking || null }
    ];
    
    for (const { section, answers } of sections) {
      if (!answers) continue;
      
      const sectionSubmission: SectionSubmission = {
        id: `sec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        submissionId,
        section,
        answers,
        gradingStatus: 'pending',
        submittedAt: new Date().toISOString()
      };
      
      await gradingRepository.saveSectionSubmission(sectionSubmission);
      
      // Auto-grade objective sections
      if (section === 'listening' || section === 'reading') {
        await this.autoGradeSection(sectionSubmission);
      }
      
      // Create writing task submissions
      if (section === 'writing' && answers.type === 'writing') {
        for (const task of answers.tasks) {
          const writingSubmission: WritingTaskSubmission = {
            id: `wrt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            submissionId,
            taskId: task.taskId,
            taskLabel: task.taskLabel,
            prompt: task.prompt,
            studentText: task.text,
            wordCount: task.wordCount,
            annotations: [],
            gradingStatus: 'needs_review',
            submittedAt: new Date().toISOString()
          };
          
          await gradingRepository.saveWritingSubmission(writingSubmission);
        }
      }
    }
  }
  
  /**
   * Auto-grade objective section (listening/reading)
   */
  private async autoGradeSection(sectionSubmission: SectionSubmission): Promise<void> {
    // Auto-grading logic would go here
    // For now, mark as auto_graded
    sectionSubmission.gradingStatus = 'auto_graded';
    sectionSubmission.autoGradingResults = {
      totalScore: 0,
      maxScore: 0,
      percentage: 0,
      questionResults: [],
      generatedAt: new Date().toISOString()
    };
    
    await gradingRepository.saveSectionSubmission(sectionSubmission);
  }
  
  /**
   * Start review for a student submission
   */
  async startReview(
    submissionId: string,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const draft = await backendPost<ReviewDraft>(
        `/v1/grading/submissions/${submissionId}/start-review`,
        {
          teacherId,
          teacherName,
        },
      );
      await gradingRepository.saveReviewDraft(draft);
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to start review', error) };
    }
  }
  
  /**
   * Save review draft
   */
  async saveReviewDraft(
    draft: ReviewDraft,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const savedDraft = await backendPut<ReviewDraft>(
        `/v1/grading/submissions/${draft.submissionId}/review-draft`,
        {
          teacherId,
          releaseStatus: draft.releaseStatus,
          sectionDrafts: draft.sectionDrafts,
          annotations: draft.annotations,
          drawings: draft.drawings,
          overallFeedback: draft.overallFeedback,
          studentVisibleNotes: draft.studentVisibleNotes,
          internalNotes: draft.internalNotes,
          teacherSummary: draft.teacherSummary ?? {
            strengths: [],
            improvementPriorities: [],
            recommendedPractice: [],
          },
          checklist: draft.checklist,
          hasUnsavedChanges: draft.hasUnsavedChanges,
          revision: getReviewDraftRevision(draft.id),
        },
      );
      await gradingRepository.saveReviewDraft(savedDraft);
      await this.logReviewEvent(draft.submissionId, teacherId, teacherName, 'draft_saved');
      return { success: true, data: savedDraft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to save draft', error) };
    }
  }
  
  /**
   * Add writing annotation
   */
  async addWritingAnnotation(
    submissionId: string,
    annotation: WritingAnnotation,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<WritingAnnotation>> {
    try {
      // Save annotation to the matching writing task for this submission.
      const writingSubmission = (await gradingRepository.getWritingSubmissionsBySubmissionId(submissionId))
        .find((task) => task.taskId === annotation.taskId);

      if (!writingSubmission) {
        return {
          success: false,
          error: `Writing task ${annotation.taskId} not found for submission ${submissionId}`,
        };
      }
      
      writingSubmission.annotations.push(annotation);
      await gradingRepository.saveWritingSubmission(writingSubmission);

      // Update draft
      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (draft) {
        draft.annotations.push(annotation);
        draft.hasUnsavedChanges = true;
        await gradingRepository.saveReviewDraft(draft);
      }
      
      await this.logReviewEvent(
        submissionId,
        teacherId,
        teacherName,
        'comment_added',
        { annotationId: annotation.id, taskId: annotation.taskId }
      );
      
      return { success: true, data: annotation };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to add annotation', error) };
    }
  }
  
  /**
   * Finalize review
   */
  async finalizeReview(
    submissionId: string,
    teacherId: string,
    teacherName: string,
    reason?: string
  ): Promise<GradingServiceResult<void>> {
    try {
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      
      // Update submission status
      submission.gradingStatus = 'released';
      submission.updatedAt = new Date().toISOString();
      await gradingRepository.saveSubmission(submission);
      
      // Update section statuses
      const sections = await gradingRepository.getSectionSubmissionsBySubmissionId(submissionId);
      for (const section of sections) {
        section.gradingStatus = 'finalized';
        section.finalizedBy = teacherId;
        section.finalizedAt = new Date().toISOString();
        await gradingRepository.saveSectionSubmission(section);
      }
      
      // Update writing submissions
      const writings = await gradingRepository.getAllWritingSubmissions();
      for (const writing of writings) {
        if (writing.submissionId === submissionId) {
          writing.gradingStatus = 'finalized';
          writing.finalizedBy = teacherId;
          writing.finalizedAt = new Date().toISOString();
          await gradingRepository.saveWritingSubmission(writing);
        }
      }
      
      // Delete draft (review is finalized)
      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (draft) {
        await gradingRepository.deleteReviewDraft(draft.id);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to finalize review', error) };
    }
  }
  
  /**
   * Reopen finalized review
   */
  async reopenReview(
    submissionId: string,
    teacherId: string,
    teacherName: string,
    reason: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const draft = await backendPost<ReviewDraft>(
        `/v1/grading/submissions/${submissionId}/reopen-review`,
        {
          actorId: teacherId,
          teacherName,
          reason,
        },
      );
      await gradingRepository.saveReviewDraft(draft);
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to reopen review', error) };
    }
  }
  
  /**
   * Mark grading as complete (release workflow step 1)
   */
  async markGradingComplete(
    submissionId: string,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const draft = await backendPost<ReviewDraft>(
        `/v1/grading/submissions/${submissionId}/mark-grading-complete`,
        {
          actorId: teacherId,
          teacherName,
        },
      );
      await gradingRepository.saveReviewDraft(draft);
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to mark grading complete', error) };
    }
  }
  
  /**
   * Mark result as ready to release (release workflow step 2)
   */
  async markReadyToRelease(
    submissionId: string,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const draft = await backendPost<ReviewDraft>(
        `/v1/grading/submissions/${submissionId}/mark-ready-to-release`,
        {
          actorId: teacherId,
          teacherName,
        },
      );
      await gradingRepository.saveReviewDraft(draft);
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to mark ready to release', error) };
    }
  }
  
  /**
   * Release result to student now (release workflow step 3)
   */
  async releaseResult(
    submissionId: string,
    teacherId: string,
    teacherName: string,
    graderOverrideConfirmed = false,
  ): Promise<GradingServiceResult<StudentResult>> {
    try {
      const result = await backendPost<StudentResult>(
        `/v1/grading/submissions/${submissionId}/release-now`,
        {
          actorId: teacherId,
          graderOverrideConfirmed,
        },
      );
      await gradingRepository.saveStudentResult(result);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to release result', error) };
    }
  }
  
  /**
   * Schedule result release for future date
   */
  async scheduleRelease(
    submissionId: string,
    releaseDate: string,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const draft = await backendPost<ReviewDraft>(
        `/v1/grading/submissions/${submissionId}/schedule-release`,
        {
          actorId: teacherId,
          teacherName,
          releaseAt: releaseDate,
        },
      );
      await gradingRepository.saveReviewDraft(draft);
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to schedule release', error) };
    }
  }
  
  /**
   * Reopen released result for revision
   */
  async reopenReleasedResult(
    resultId: string,
    submissionId: string,
    teacherId: string,
    teacherName: string,
    reason: string
  ): Promise<GradingServiceResult<ReviewDraft>> {
    try {
      const result = await gradingRepository.getStudentResultById(resultId);
      if (!result) {
        return { success: false, error: 'Result not found' };
      }
      
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      
      // Update result status
      result.releaseStatus = 'reopened';
      result.updatedAt = new Date().toISOString();
      await gradingRepository.saveStudentResult(result);
      
      // Update submission status
      submission.gradingStatus = 'reopened';
      submission.updatedAt = new Date().toISOString();
      await gradingRepository.saveSubmission(submission);
      
      // Create new draft from result data
      const draft: ReviewDraft = {
        id: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        submissionId,
        studentId: submission.studentId,
        teacherId,
        releaseStatus: 'reopened',
        sectionDrafts: {}, // Would need to reconstruct from result
        annotations: [],
        drawings: [],
        teacherSummary: result.teacherSummary,
        checklist: {
          listeningReviewed: false,
          readingReviewed: false,
          writingTask1Reviewed: false,
          writingTask2Reviewed: false,
          speakingReviewed: false,
          overallFeedbackWritten: false,
          rubricComplete: false,
          annotationsComplete: false
        },
        hasUnsavedChanges: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await gradingRepository.saveReviewDraft(draft);
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to reopen result', error) };
    }
  }
  
  private compareTimestampsDesc(left: string | undefined, right: string | undefined): number {
    return this.parseTimestamp(right) - this.parseTimestamp(left);
  }

  private parseTimestamp(value: string | undefined): number {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  /**
   * Get next ungraded student in session
   */
  async getNextUngradedStudent(
    sessionId: string,
    teacherId?: string
  ): Promise<GradingServiceResult<StudentSubmission | null>> {
    try {
      const submissions = await gradingRepository.getSubmissionsBySession(sessionId);
      
      const nextSubmission = submissions.find(s => {
        if (s.gradingStatus !== 'submitted') return false;
        if (teacherId && s.assignedTeacherId && s.assignedTeacherId !== teacherId) return false;
        return true;
      });
      
      return { success: true, data: nextSubmission || null };
    } catch (error) {
      return { success: false, error: gradingServiceError('Failed to get next ungraded student', error) };
    }
  }
  
  /**
   * Log review event
   */
  private async logReviewEvent(
    submissionId: string,
    teacherId: string,
    teacherName: string,
    action: import('../types/grading').ReviewAction,
    payload?: Record<string, unknown>
  ): Promise<void> {
    const event: ReviewEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      submissionId,
      teacherId,
      teacherName,
      action,
      payload,
      timestamp: new Date().toISOString()
    };
    
    await gradingRepository.saveReviewEvent(event);
  }
}

/**
 * Singleton instance for app-wide use
 */
export const gradingService = new GradingService();
