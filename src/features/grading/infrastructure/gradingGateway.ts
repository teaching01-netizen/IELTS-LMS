import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
import type { ReviewDraft, SessionDetailFilters, WritingAnnotation } from '../../../types/grading';

export { gradingRepository, gradingService };
export { backendGet, backendPost, isBackendNotFound } from '@services/backendBridge';

export const gradingGateway = {
  service: {
    getSessionQueue: () => gradingService.getSessionQueue(),
    getSessionQueueSummary: () => gradingService.getSessionQueueSummary(),
    getSessionStudentSubmissions: (sessionId: string, filters?: SessionDetailFilters) =>
      gradingService.getSessionStudentSubmissions(sessionId, filters),
    getActScienceReports: () => gradingService.getActScienceReports(),
    startReview: (submissionId: string, teacherId: string, teacherName: string) =>
      gradingService.startReview(submissionId, teacherId, teacherName),
    saveReviewDraft: (draft: ReviewDraft, teacherId: string, teacherName: string) =>
      gradingService.saveReviewDraft(draft, teacherId, teacherName),
    finalizeReview: (submissionId: string, teacherId: string, teacherName: string, reason?: string) =>
      gradingService.finalizeReview(submissionId, teacherId, teacherName, reason),
    addWritingAnnotation: (
      submissionId: string,
      annotation: WritingAnnotation,
      teacherId: string,
      teacherName: string,
    ) => gradingService.addWritingAnnotation(submissionId, annotation, teacherId, teacherName),
    markGradingComplete: (submissionId: string, teacherId: string, teacherName: string) =>
      gradingService.markGradingComplete(submissionId, teacherId, teacherName),
    markReadyToRelease: (submissionId: string, teacherId: string, teacherName: string) =>
      gradingService.markReadyToRelease(submissionId, teacherId, teacherName),
    releaseResult: (submissionId: string, teacherId: string, teacherName: string) =>
      gradingService.releaseResult(submissionId, teacherId, teacherName),
  },
  repository: {
    getSubmissionById: (submissionId: string) => gradingRepository.getSubmissionById(submissionId),
    getReviewDraftBySubmission: (submissionId: string) => gradingRepository.getReviewDraftBySubmission(submissionId),
  },
} as const;
