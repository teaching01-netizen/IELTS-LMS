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

import { gradingRepository } from './gradingRepository';
import { examRepository } from './examRepository';
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
          status: this.mapScheduleStatusToGradingStatus(schedule.status),
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
        sessions = this.applySessionFilters(sessions, filters);
      }
      
      // Sort by start time (most recent first)
      sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      
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
        submissions = this.applySubmissionFilters(submissions, filters);
      }
      
      // Sort by submission time (most recent first)
      submissions.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      
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
      // Save annotation to writing submission
      const writingSubmission = await gradingRepository.getWritingSubmissionById(
        annotation.id.replace('wrt-', '').substring(0, annotation.id.length - 12)
      );
      
      if (writingSubmission) {
        writingSubmission.annotations.push(annotation);
        await gradingRepository.saveWritingSubmission(writingSubmission);
      }
      
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
      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      
      const submission = await gradingRepository.getSubmissionById(submissionId);
      if (!submission) {
        return { success: false, error: 'Submission not found' };
      }
      
      // Create student result from draft
      const result: StudentResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        submissionId,
        studentId: submission.studentId,
        studentName: submission.studentName,
        releaseStatus: 'released',
        releasedAt: new Date().toISOString(),
        releasedBy: teacherId,
        overallBand: this.calculateOverallBand(draft),
        sectionBands: this.calculateSectionBands(draft),
        writingResults: {
          task1: draft.sectionDrafts.writing?.task1 ? this.buildWritingResult(draft.sectionDrafts.writing.task1, 'task1', draft) : undefined,
          task2: draft.sectionDrafts.writing?.task2 ? this.buildWritingResult(draft.sectionDrafts.writing.task2, 'task2', draft) : undefined
        },
        teacherSummary: draft.teacherSummary || {
          strengths: [],
          improvementPriorities: [],
          recommendedPractice: []
        },
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // Save result
      await gradingRepository.saveStudentResult(result);
      
      // Update submission status
      submission.gradingStatus = 'released';
      submission.updatedAt = new Date().toISOString();
      await gradingRepository.saveSubmission(submission);
      
      // Update draft status
      draft.releaseStatus = 'released';
      draft.updatedAt = new Date().toISOString();
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
      const draft = await gradingRepository.getReviewDraftBySubmission(submissionId);
      if (!draft) {
        return { success: false, error: 'Review draft not found' };
      }
      
      // TODO: Implement scheduled release logic
      // For now, just mark as ready_to_release
      draft.releaseStatus = 'ready_to_release';
      draft.updatedAt = new Date().toISOString();
      draft.hasUnsavedChanges = false;
      
      await gradingRepository.saveReviewDraft(draft);
      
      await this.logReleaseEvent(submissionId, 'schedule_release', teacherId, teacherName, {
        fromStatus: 'grading_complete',
        toStatus: 'ready_to_release',
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
  
  /**
   * Build writing result from rubric assessment
   */
  private buildWritingResult(rubric: RubricAssessment, taskId: string, draft: ReviewDraft): import('../types/grading').WritingResult {
    return {
      taskId,
      taskLabel: taskId === 'task1' ? 'Task 1' : 'Task 2',
      prompt: '', // Would need to get from writing submission
      studentText: '', // Would need to get from writing submission
      wordCount: rubric.wordCount || 0,
      rubricScores: {
        taskResponse: rubric.taskResponseBand || 0,
        coherence: rubric.coherenceBand || 0,
        lexical: rubric.lexicalBand || 0,
        grammar: rubric.grammarBand || 0
      },
      annotations: draft.annotations.filter(a => a.taskId === taskId && a.visibility === 'student_visible'),
      drawings: draft.drawings.filter(d => d.taskId === taskId && d.visibility === 'student_visible'),
      criterionFeedback: {
        taskResponse: rubric.taskResponseNotes,
        coherence: rubric.coherenceNotes,
        lexical: rubric.lexicalNotes,
        grammar: rubric.grammarNotes
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
  
  /**
   * Map schedule status to grading session status
   */
  private mapScheduleStatusToGradingStatus(status: string): GradingSession['status'] {
    const map: Record<string, GradingSession['status']> = {
      'scheduled': 'scheduled',
      'live': 'live',
      'completed': 'completed',
      'cancelled': 'cancelled'
    };
    return map[status] || 'scheduled';
  }
  
  /**
   * Apply filters to sessions
   */
  private applySessionFilters(
    sessions: GradingSession[],
    filters: GradingQueueFilters
  ): GradingSession[] {
    let filtered = sessions;
    
    if (filters.cohort && filters.cohort.length > 0) {
      filtered = filtered.filter(s => filters.cohort!.includes(s.cohortName));
    }
    
    if (filters.exam && filters.exam.length > 0) {
      filtered = filtered.filter(s => filters.exam!.includes(s.examTitle));
    }
    
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.examTitle.toLowerCase().includes(query) ||
        s.cohortName.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }
  
  /**
   * Apply filters to submissions
   */
  private applySubmissionFilters(
    submissions: StudentSubmission[],
    filters: SessionDetailFilters
  ): StudentSubmission[] {
    let filtered = submissions;
    
    if (filters.status && filters.status.length > 0) {
      filtered = filtered.filter(s => filters.status!.includes(s.gradingStatus));
    }
    
    if (filters.assignedTeacher) {
      filtered = filtered.filter(s => s.assignedTeacherId === filters.assignedTeacher);
    }
    
    if (filters.isFlagged !== undefined) {
      filtered = filtered.filter(s => s.isFlagged === filters.isFlagged);
    }
    
    if (filters.isOverdue !== undefined) {
      filtered = filtered.filter(s => s.isOverdue === filters.isOverdue);
    }
    
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.studentName.toLowerCase().includes(query) ||
        s.studentEmail?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }
}

/**
 * Singleton instance for app-wide use
 */
export const gradingService = new GradingService();
