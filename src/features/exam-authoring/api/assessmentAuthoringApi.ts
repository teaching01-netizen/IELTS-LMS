import {
  backendDelete,
  backendGet,
  backendPatch,
  backendPost,
} from "../infrastructure/examAuthoringBackendGateway";
import type {
  AssessmentAuthoringShell,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  AssessmentValidationReport,
  BulkQuestionRequest,
  DuplicateQuestionRequest,
  ReorderQuestionsRequest,
  PublishedAssessmentVersion,
  PublishAssessmentRequest,
  QuestionRevision,
  SaveQuestionRevisionRequest,
  UpdateSectionDeliverySettingsRequest,
} from "../contracts/assessment";

export const assessmentAuthoringApi = {
  getShell(examId: string): Promise<AssessmentAuthoringShell> {
    return backendGet<AssessmentAuthoringShell>(`/v1/assessment-authoring/exams/${examId}/shell`);
  },

  listQuestions(moduleId: string): Promise<AssessmentQuestionSummary[]> {
    return backendGet<AssessmentQuestionSummary[]>(
      `/v1/assessment-authoring/modules/${moduleId}/questions`
    );
  },

  createQuestion(moduleId: string): Promise<AssessmentQuestionDetail> {
    return backendPost<AssessmentQuestionDetail>(
      `/v1/assessment-authoring/modules/${moduleId}/questions`
    );
  },

  getQuestion(examQuestionId: string): Promise<AssessmentQuestionDetail> {
    return backendGet<AssessmentQuestionDetail>(
      `/v1/assessment-authoring/exam-questions/${examQuestionId}`
    );
  },

  saveQuestionRevision(
    revisionId: string,
    request: SaveQuestionRevisionRequest
  ): Promise<QuestionRevision> {
    return backendPatch<QuestionRevision>(
      `/v1/assessment-authoring/question-revisions/${revisionId}`,
      request
    );
  },

  deleteQuestion(examQuestionId: string): Promise<void> {
    return backendDelete(`/v1/assessment-authoring/exam-questions/${examQuestionId}`);
  },

  duplicateQuestion(
    examQuestionId: string,
    request: DuplicateQuestionRequest
  ): Promise<AssessmentQuestionDetail> {
    return backendPost<AssessmentQuestionDetail>(
      `/v1/assessment-authoring/exam-questions/${examQuestionId}/duplicate`,
      request
    );
  },

  reorderQuestions(
    moduleId: string,
    request: ReorderQuestionsRequest
  ): Promise<AssessmentQuestionSummary[]> {
    return backendPatch<AssessmentQuestionSummary[]>(
      `/v1/assessment-authoring/modules/${moduleId}/question-order`,
      request
    );
  },

  bulkQuestions(request: BulkQuestionRequest): Promise<{
    affectedQuestionIds: string[];
    createdQuestionIds: string[];
  }> {
    return backendPost(`/v1/assessment-authoring/questions/bulk`, request);
  },

  updateSectionDeliverySettings(
    examId: string,
    sectionId: string,
    request: UpdateSectionDeliverySettingsRequest
  ): Promise<AssessmentAuthoringShell> {
    return backendPatch<AssessmentAuthoringShell>(
      `/v1/assessment-authoring/exams/${examId}/sections/${sectionId}/delivery-settings`,
      request
    );
  },

  validateExam(examId: string): Promise<AssessmentValidationReport> {
    return backendPost<AssessmentValidationReport>(
      `/v1/assessment-authoring/exams/${examId}/validate`
    );
  },

  publishExam(
    examId: string,
    request: PublishAssessmentRequest
  ): Promise<PublishedAssessmentVersion> {
    return backendPost<PublishedAssessmentVersion, PublishAssessmentRequest>(
      `/v1/exams/${examId}/publish`,
      request
    );
  },
};
