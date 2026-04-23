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
import { backendPost, backendPut, isBackendGradingEnabled } from './backendBridge';
import { getReviewDraftRevision, gradingRepository } from './gradingRepository';
import { examRepository } from './examRepository';
import {
  filterGradingSessions,
  filterStudentSubmissions,
  mapScheduleStatusToGradingStatus,
} from './gradingFilters';
import {
  GradingSession,
  StudentSubmission,
  SectionSubmission,
  WritingTaskSubmission,
  ReviewDraft,
  ReviewEvent,
  GradingQueueFilters,
  SessionDetailFilters,
  RubricAssessment,
  WritingAnnotation,
  StudentResult,
  ReleaseAction,
  ReleaseEvent
} from '../types/grading';

/**
 * Result of a grading service operation
 */
export interface GradingServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
          examTitle: schedule.examTitle,
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
      return { success: false, error: `Failed to build grading sessions: ${error}` };
    }
  }
  
  /**
   * Get grading session queue with optional filters
   */
  async getSessionQueue(filters?: GradingQueueFilters): Promise<GradingServiceResult<GradingSession[]>> {
    try {
      let sessions = await gradingRepository.getAllSessions();
      
      if (filters) {
        sessions = filterGradingSessions(sessions, filters);
      }
      
      // Sort by start time (most recent first)
      sessions.sort((a, b) => this.compareTimestampsDesc(a.startTime, b.startTime));
      
      return { success: true, data: sessions };
    } catch (error) {
      return { success: false, error: `Failed to get session queue: ${error}` };
    }
  }
  
  /**
   * Get session queue summary
   */
  async getSessionQueueSummary(): Promise<GradingServiceResult<SessionQueueSummary>> {
    try {
      const sessions = await gradingRepository.getAllSessions();
      
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
      return { success: false, error: `Failed to get queue summary: ${error}` };
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
      return { success: false, error: `Failed to get session submissions: ${error}` };
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
      
      // Update session counters
      await this.updateSessionCounters(scheduleId);
      
      return { success: true, data: submission };
    } catch (error) {
      return { success: false, error: `Failed to create submission: ${error}` };
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
      if (isBackendGradingEnabled()) {
        const draft = await backendPost<ReviewDraft>(
          `/v1/grading/submissions/${submissionId}/start-review`,
          {
            teacherId,
            teacherName,
          },
        );
        await gradingRepository.saveReviewDraft(draft);
        return { success: true, data: draft };
      }

      // Check if draft already exists
      const existingDraft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (existingDraft) {
        return { success: true, data: existingDraft };
      }
      
      // Get submission to get studentId
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      
      // Create new review draft
      const draft: ReviewDraft = {
        id: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        submissionId,
        studentId: submission.studentId,
        teacherId,
        releaseStatus: 'draft',
        sectionDrafts: {},
        annotations: [],
        drawings: [],
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
      
      // Log review started event
      await this.logReviewEvent(submissionId, teacherId, teacherName, 'review_started');
      
      // Update submission status
      const existingSubmission = await gradingRepository.getSubmissionById(submissionId);
      if (existingSubmission) {
        existingSubmission.gradingStatus = 'in_progress';
        existingSubmission.assignedTeacherId = teacherId;
        existingSubmission.assignedTeacherName = teacherName;
        await gradingRepository.saveSubmission(existingSubmission);
      }
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to start review: ${error}` };
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
      if (isBackendGradingEnabled()) {
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
      }

      draft.updatedAt = new Date().toISOString();
      draft.hasUnsavedChanges = false;
      draft.lastAutoSaveAt = new Date().toISOString();
      
      await gradingRepository.saveReviewDraft(draft);
      
      await this.logReviewEvent(draft.submissionId, teacherId, teacherName, 'draft_saved');
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to save draft: ${error}` };
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
      return { success: false, error: `Failed to add annotation: ${error}` };
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
      
      await this.logReviewEvent(
        submissionId,
        teacherId,
        teacherName,
        'review_finalized',
        { reason }
      );
      
      // Update session counters
      await this.updateSessionCounters(submission.scheduleId);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: `Failed to finalize review: ${error}` };
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
      if (isBackendGradingEnabled()) {
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
      }

      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      
      // Update submission status
      submission.gradingStatus = 'reopened';
      submission.updatedAt = new Date().toISOString();
      await gradingRepository.saveSubmission(submission);
      
      // Create new draft
      const draft: ReviewDraft = {
        id: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        submissionId,
        studentId: submission.studentId,
        teacherId,
        releaseStatus: 'reopened',
        sectionDrafts: {},
        annotations: [],
        drawings: [],
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
      
      await this.logReviewEvent(
        submissionId,
        teacherId,
        teacherName,
        'review_reopened',
        { reason }
      );
      
      // Update session counters
      await this.updateSessionCounters(submission.scheduleId);
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to reopen review: ${error}` };
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
      if (isBackendGradingEnabled()) {
        const draft = await backendPost<ReviewDraft>(
          `/v1/grading/submissions/${submissionId}/mark-grading-complete`,
          {
            actorId: teacherId,
            teacherName,
          },
        );
        await gradingRepository.saveReviewDraft(draft);
        return { success: true, data: draft };
      }

      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      
      draft.releaseStatus = 'grading_complete';
      draft.updatedAt = new Date().toISOString();
      draft.hasUnsavedChanges = false;
      
      await gradingRepository.saveReviewDraft(draft);
      
      await this.logReleaseEvent(submissionId, 'mark_grading_complete', teacherId, teacherName, {
        fromStatus: 'draft',
        toStatus: 'grading_complete'
      });
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to mark grading complete: ${error}` };
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
      if (isBackendGradingEnabled()) {
        const draft = await backendPost<ReviewDraft>(
          `/v1/grading/submissions/${submissionId}/mark-ready-to-release`,
          {
            actorId: teacherId,
            teacherName,
          },
        );
        await gradingRepository.saveReviewDraft(draft);
        return { success: true, data: draft };
      }

      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      
      draft.releaseStatus = 'ready_to_release';
      draft.updatedAt = new Date().toISOString();
      draft.hasUnsavedChanges = false;
      
      await gradingRepository.saveReviewDraft(draft);
      
      await this.logReleaseEvent(submissionId, 'mark_ready_to_release', teacherId, teacherName, {
        fromStatus: 'grading_complete',
        toStatus: 'ready_to_release'
      });
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to mark ready to release: ${error}` };
    }
  }
  
  /**
   * Release result to student now (release workflow step 3)
   */
  async releaseResult(
    submissionId: string,
    teacherId: string,
    teacherName: string
  ): Promise<GradingServiceResult<StudentResult>> {
    try {
      if (isBackendGradingEnabled()) {
        const result = await backendPost<StudentResult>(
          `/v1/grading/submissions/${submissionId}/release-now`,
          {
            actorId: teacherId,
          },
        );
        await gradingRepository.saveStudentResult(result);
        return { success: true, data: result };
      }

      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      const writingTasks = await gradingRepository.getWritingSubmissionsBySubmissionId(submissionId);
      const latestResult = await this.getLatestStudentResult(submissionId);
      const now = new Date().toISOString();
      const result: StudentResult = latestResult && latestResult.releaseStatus === 'ready_to_release'
        ? {
            ...latestResult,
            releaseStatus: 'released',
            releasedAt: now,
            releasedBy: teacherId,
            overallBand: this.calculateOverallBand(draft),
            sectionBands: this.calculateSectionBands(draft),
            writingResults: this.buildWritingResults(draft, writingTasks),
            teacherSummary: draft.teacherSummary || {
              strengths: [],
              improvementPriorities: [],
              recommendedPractice: [],
            },
            updatedAt: now,
          }
        : {
            id: `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            submissionId,
            studentId: submission.studentId,
            studentName: submission.studentName,
            releaseStatus: 'released',
            releasedAt: now,
            releasedBy: teacherId,
            overallBand: this.calculateOverallBand(draft),
            sectionBands: this.calculateSectionBands(draft),
            writingResults: this.buildWritingResults(draft, writingTasks),
            teacherSummary: draft.teacherSummary || {
              strengths: [],
              improvementPriorities: [],
              recommendedPractice: [],
            },
            version: latestResult ? latestResult.version + 1 : 1,
            previousVersionId: latestResult?.id,
            createdAt: now,
            updatedAt: now,
          };
      
      // Save result
      await gradingRepository.saveStudentResult(result);
      
      // Update submission status
      submission.gradingStatus = 'released';
      submission.updatedAt = now;
      await gradingRepository.saveSubmission(submission);
      
      // Update draft status
      draft.releaseStatus = 'released';
      draft.updatedAt = now;
      await gradingRepository.saveReviewDraft(draft);
      
      // Delete draft (review is complete)
      await gradingRepository.deleteReviewDraft(draft.id);
      
      await this.logReleaseEvent(submissionId, 'release_now', teacherId, teacherName, {
        fromStatus: 'ready_to_release',
        toStatus: 'released',
        resultId: result.id
      });
      
      // Update session counters
      await this.updateSessionCounters(submission.scheduleId);
      
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: `Failed to release result: ${error}` };
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
      if (isBackendGradingEnabled()) {
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
      }

      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      const writingTasks = await gradingRepository.getWritingSubmissionsBySubmissionId(submissionId);

      const latestResult = await this.getLatestStudentResult(submissionId);
      const now = new Date().toISOString();
      const result: StudentResult = latestResult && latestResult.releaseStatus === 'ready_to_release'
        ? {
            ...latestResult,
            releaseStatus: 'ready_to_release',
            releasedAt: undefined,
            releasedBy: undefined,
            scheduledReleaseDate: releaseDate,
            overallBand: this.calculateOverallBand(draft),
            sectionBands: this.calculateSectionBands(draft),
            writingResults: this.buildWritingResults(draft, writingTasks),
            teacherSummary: draft.teacherSummary || {
              strengths: [],
              improvementPriorities: [],
              recommendedPractice: [],
            },
            updatedAt: now,
          }
        : {
            id: `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            submissionId,
            studentId: submission.studentId,
            studentName: submission.studentName,
            releaseStatus: 'ready_to_release',
            scheduledReleaseDate: releaseDate,
            overallBand: this.calculateOverallBand(draft),
            sectionBands: this.calculateSectionBands(draft),
            writingResults: this.buildWritingResults(draft, writingTasks),
            teacherSummary: draft.teacherSummary || {
              strengths: [],
              improvementPriorities: [],
              recommendedPractice: [],
            },
            version: latestResult ? latestResult.version + 1 : 1,
            previousVersionId: latestResult?.id,
            createdAt: now,
            updatedAt: now,
          };

      await gradingRepository.saveStudentResult(result);

      draft.releaseStatus = 'ready_to_release';
      draft.updatedAt = now;
      draft.hasUnsavedChanges = false;
      await gradingRepository.saveReviewDraft(draft);

      submission.gradingStatus = 'ready_to_release';
      submission.updatedAt = now;
      await gradingRepository.saveSubmission(submission);
      
      await this.logReleaseEvent(submissionId, 'schedule_release', teacherId, teacherName, {
        fromStatus: 'grading_complete',
        toStatus: 'ready_to_release',
        resultId: result.id,
        scheduledReleaseDate: releaseDate
      });
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to schedule release: ${error}` };
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
      
      await this.logReleaseEvent(submissionId, 'reopen_result', teacherId, teacherName, {
        fromStatus: 'released',
        toStatus: 'reopened',
        resultId,
        reason
      });
      
      // Update session counters
      await this.updateSessionCounters(submission.scheduleId);
      
      return { success: true, data: draft };
    } catch (error) {
      return { success: false, error: `Failed to reopen result: ${error}` };
    }
  }
  
  /**
   * Calculate overall band score from rubric assessments
   */
  private calculateOverallBand(draft: ReviewDraft): number {
    const bands: number[] = [];
    
    if (draft.sectionDrafts.listening?.overallBand) bands.push(draft.sectionDrafts.listening.overallBand);
    if (draft.sectionDrafts.reading?.overallBand) bands.push(draft.sectionDrafts.reading.overallBand);
    if (draft.sectionDrafts.writing?.task1?.overallBand) bands.push(draft.sectionDrafts.writing.task1.overallBand);
    if (draft.sectionDrafts.writing?.task2?.overallBand) bands.push(draft.sectionDrafts.writing.task2.overallBand);
    if (draft.sectionDrafts.speaking?.overallBand) bands.push(draft.sectionDrafts.speaking.overallBand);
    
    if (bands.length === 0) return 0;
    const sum = bands.reduce((a, b) => a + b, 0);
    return Math.round((sum / bands.length) * 2) / 2; // Round to nearest 0.5
  }
  
  /**
   * Calculate section band scores
   */
  private calculateSectionBands(draft: ReviewDraft): { listening: number; reading: number; writing: number; speaking: number } {
    return {
      listening: draft.sectionDrafts.listening?.overallBand || 0,
      reading: draft.sectionDrafts.reading?.overallBand || 0,
      writing: this.calculateWritingBand(draft),
      speaking: draft.sectionDrafts.speaking?.overallBand || 0
    };
  }
  
  /**
   * Calculate writing band (average of task1 and task2)
   */
  private calculateWritingBand(draft: ReviewDraft): number {
    const task1Band = draft.sectionDrafts.writing?.task1?.overallBand || 0;
    const task2Band = draft.sectionDrafts.writing?.task2?.overallBand || 0;
    
    if (task1Band === 0 && task2Band === 0) return 0;
    if (task1Band === 0) return task2Band;
    if (task2Band === 0) return task1Band;
    
    return Math.round(((task1Band + task2Band) / 2) * 2) / 2;
  }
  
  private compareTimestampsDesc(left: string | undefined, right: string | undefined): number {
    return this.parseTimestamp(right) - this.parseTimestamp(left);
  }

  private parseTimestamp(value: string | undefined): number {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private buildWritingResults(
    draft: ReviewDraft,
    writingTasks: WritingTaskSubmission[],
  ): StudentResult['writingResults'] {
    const results: StudentResult['writingResults'] = {};

    for (const task of writingTasks) {
      results[task.taskId as 'task1' | 'task2'] = this.buildWritingResult(task, draft);
    }

    return results;
  }

  /**
   * Build writing result from rubric assessment
   */
  private buildWritingResult(
    task: WritingTaskSubmission,
    draft: ReviewDraft,
  ): import('../types/grading').WritingResult {
    const rubric = draft.sectionDrafts.writing?.[task.taskId as 'task1' | 'task2'];
    const studentVisibleAnnotations = draft.annotations.filter(
      (annotation) =>
        annotation.taskId === task.taskId && annotation.visibility === 'student_visible',
    );
    const studentVisibleDrawings = draft.drawings.filter(
      (drawing) => drawing.taskId === task.taskId && drawing.visibility === 'student_visible',
    );

    return {
      taskId: task.taskId,
      taskLabel: task.taskLabel || (task.taskId === 'task1' ? 'Task 1' : 'Task 2'),
      prompt: task.prompt,
      studentText: task.studentText,
      wordCount: task.wordCount,
      rubricScores: {
        taskResponse: rubric?.taskResponseBand || 0,
        coherence: rubric?.coherenceBand || 0,
        lexical: rubric?.lexicalBand || 0,
        grammar: rubric?.grammarBand || 0
      },
      annotations: studentVisibleAnnotations,
      drawings: studentVisibleDrawings,
      criterionFeedback: {
        taskResponse: rubric?.taskResponseNotes,
        coherence: rubric?.coherenceNotes,
        lexical: rubric?.lexicalNotes,
        grammar: rubric?.grammarNotes
      }
    };
  }
  
  /**
   * Log release event for audit trail
   */
  private async logReleaseEvent(
    submissionId: string,
    action: ReleaseAction,
    teacherId: string,
    teacherName: string,
    payload?: Record<string, any>
  ): Promise<void> {
    const event: ReleaseEvent = {
      id: `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      resultId: submissionId, // Using submissionId as resultId for now
      action,
      actor: teacherId,
      actorName: teacherName,
      timestamp: new Date().toISOString(),
      payload
    };
    
    await gradingRepository.saveReleaseEvent(event);
  }

  private async getLatestStudentResult(submissionId: string): Promise<StudentResult | null> {
    const results = await gradingRepository.getStudentResultsBySubmission(submissionId);
    if (results.length === 0) {
      return null;
    }

    return results.sort(
      (left, right) => this.compareTimestampsDesc(left.updatedAt, right.updatedAt),
    )[0] ?? null;
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
      return { success: false, error: `Failed to get next ungraded student: ${error}` };
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
  
  /**
   * Update session counters
   */
  private async updateSessionCounters(scheduleId: string): Promise<void> {
    const session = await gradingRepository.getSessionById(scheduleId);
    if (!session) return;
    
    const submissions = await gradingRepository.getSubmissionsBySession(scheduleId);
    
    session.totalStudents = submissions.length;
    session.submittedCount = submissions.filter(s => s.gradingStatus !== 'not_submitted').length;
    session.pendingManualReviews = submissions.filter(s => s.gradingStatus === 'submitted').length;
    session.inProgressReviews = submissions.filter(s => s.gradingStatus === 'in_progress').length;
    session.finalizedReviews = submissions.filter(s => s.gradingStatus === 'released').length;
    session.overdueReviews = submissions.filter(s => s.isOverdue && s.gradingStatus !== 'released').length;
    
    await gradingRepository.saveSession(session);
  }
}

/**
 * Singleton instance for app-wide use
 */
export const gradingService = new GradingService();
