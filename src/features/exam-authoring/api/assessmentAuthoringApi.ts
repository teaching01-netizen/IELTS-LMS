import {
  backendDelete,
  backendGet,
  backendPatch,
  backendPost,
} from "../infrastructure/examAuthoringBackendGateway";
import type { ApiRequestConfig } from "../infrastructure/examAuthoringBackendGateway";
import type {
  AssessmentAuthoringShell,
  AssessmentAuthoringShellResult,
  AssessmentPreviewProjection,
  AssessmentQuestionDetail,
  AssessmentQuestionSummary,
  AssessmentValidationReport,
  BatchCreateQuestionsRequest,
  BatchCreateQuestionsResult,
  BulkQuestionRequest,
  BulkQuestionResult,
  DuplicateQuestionRequest,
  LoadSampleExamRequest,
  ReorderQuestionsRequest,
  SatWorkbookCommitRequest,
  SatWorkbookCommitResult,
  SatWorkbookPreview,
  SatWorkbookUndoState,
  PublishedAssessmentVersion,
  PublishAssessmentRequest,
  QuestionRevision,
  SaveQuestionRevisionFieldsRequest,
  SaveQuestionRevisionRequest,
  UpdateSectionDeliverySettingsRequest,
} from "../contracts/assessment";

/**
 * Idempotency wiring: effect-creating routes accept `operationKey` in the
 * body AND an `Idempotency-Key` header. The header covers clients that do
 * not echo unknown body fields; the body field covers proxies that strip
 * unknown headers. Both carry the same value; the backend prefers the body.
 */
function withIdempotency(operationKey: string | undefined, base?: ApiRequestConfig): ApiRequestConfig | undefined {
  const key = operationKey?.trim();
  if (!key) return base;
  return { ...base, headers: { ...base?.headers, "Idempotency-Key": key } };
}

export const assessmentAuthoringApi = {
  /**
   * The explicit shell lifecycle. A pre-draft exam answers
   * `200 {state: "NO_DRAFT", shell: null}` — a normal state, not a failed
   * request — so nothing on this path produces a console error. Only a missing
   * exam answers 404 (`EXAM_NOT_FOUND`), and that is a real error the caller
   * renders differently from NO_DRAFT.
   *
   * This read never opens a draft. Opening stays an explicit command
   * (`openShell`) driven by a user gesture.
   */
  getShell(examId: string): Promise<AssessmentAuthoringShellResult> {
    return backendGet<AssessmentAuthoringShellResult>(
      `/v1/assessment-authoring/exams/${examId}/shell`,
    );
  },

  openShell(examId: string): Promise<AssessmentAuthoringShell> {
    return backendPost<AssessmentAuthoringShell>(`/v1/assessment-authoring/exams/${examId}/shell`);
  },

  getPreview(examId: string): Promise<AssessmentPreviewProjection> {
    return backendGet<AssessmentPreviewProjection>(
      `/v1/assessment-authoring/exams/${examId}/preview`
    );
  },

  loadSampleExam(
    examId: string,
    request: LoadSampleExamRequest
  ): Promise<AssessmentAuthoringShell> {
    return backendPost<AssessmentAuthoringShell, LoadSampleExamRequest>(
      `/v1/assessment-authoring/exams/${examId}/load-sample`,
      request
    );
  },

  async getSatWorkbookTemplate(examId: string): Promise<Blob> {
    const response = await fetch(
      `/api/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/sat-workbook-template`,
      { credentials: "same-origin" }
    );
    if (!response.ok) {
      throw new Error(`SAT workbook template could not be downloaded (${response.status}).`);
    }
    return response.blob();
  },

  previewSatWorkbook(examId: string, file: File): Promise<SatWorkbookPreview> {
    const form = new FormData();
    form.append("file", file, file.name);
    return backendPost<SatWorkbookPreview, FormData>(
      `/v1/assessment-authoring/exams/${examId}/sat-workbook-preview`,
      form,
      { timeout: 45_000, retries: 0 }
    );
  },

  commitSatWorkbook(
    examId: string,
    request: SatWorkbookCommitRequest
  ): Promise<SatWorkbookCommitResult> {
    return backendPost<SatWorkbookCommitResult, SatWorkbookCommitRequest>(
      `/v1/assessment-authoring/exams/${examId}/sat-workbook-commit`,
      request,
      withIdempotency(request.operationKey, { timeout: 45_000, retries: 0 })
    );
  },

  getSatWorkbookUndoState(examId: string): Promise<SatWorkbookUndoState | null> {
    return backendGet<SatWorkbookUndoState | null>(
      `/v1/assessment-authoring/exams/${examId}/sat-workbook-undo`
    );
  },

  undoSatWorkbookImport(examId: string, importId: string): Promise<AssessmentAuthoringShell> {
    return backendPost<AssessmentAuthoringShell>(
      `/v1/assessment-authoring/exams/${examId}/sat-workbook-imports/${importId}/undo`
    );
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

  batchCreateQuestions(
    moduleId: string,
    request: BatchCreateQuestionsRequest
  ): Promise<BatchCreateQuestionsResult> {
    return backendPost<BatchCreateQuestionsResult, BatchCreateQuestionsRequest>(
      `/v1/assessment-authoring/modules/${moduleId}/questions/batch`,
      request,
      withIdempotency(request.operationKey)
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

  /**
   * Partial, prompt-free save used while prompt co-editing is active. Writes
   * only the fields present on the request; `prompt` is not expressible, so a
   * collaborative prompt can never be overwritten by a field save (design
   * 2026-09-13, "Non-collaborative field saves").
   */
  saveQuestionRevisionFields(
    revisionId: string,
    request: SaveQuestionRevisionFieldsRequest
  ): Promise<QuestionRevision> {
    return backendPatch<QuestionRevision>(
      `/v1/assessment-authoring/question-revisions/${revisionId}/fields`,
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
      request,
      withIdempotency(request.operationKey)
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

  bulkQuestions(request: BulkQuestionRequest): Promise<BulkQuestionResult> {
    return backendPost<BulkQuestionResult, BulkQuestionRequest>(
      `/v1/assessment-authoring/questions/bulk`,
      request,
      withIdempotency(request.operationKey)
    );
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
      request,
      withIdempotency(request.operationKey)
    );
  },
};
