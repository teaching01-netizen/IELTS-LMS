import { backendGet, backendPut } from "@services/backendBridge";
import type {
  ExamFormsDocument,
  FormKey,
  FormResponseDetail,
  FormResponseFilters,
  FormResponsePage,
  SaveExamFormsRequest,
  ScheduleFormState,
} from "../contracts/forms";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isForms = (value: unknown): boolean => isRecord(value) && isRecord(value["evaSim"]);

/**
 * The forms editor dereferences `standard.evaSim` and `forms.evaSim`; a
 * malformed document becomes the panel's load error, not a page crash.
 */
function checkExamFormsDocument(value: unknown): ExamFormsDocument {
  if (
    !isRecord(value) ||
    typeof value["versionId"] !== "string" ||
    typeof value["versionRevision"] !== "number" ||
    typeof value["editable"] !== "boolean" ||
    !isForms(value["standard"]) ||
    !(value["forms"] === null || isForms(value["forms"])) ||
    !Array.isArray(value["issues"]) ||
    !isRecord(value["limits"])
  ) {
    throw new Error("The form settings response was incomplete. Try again.");
  }
  return value as unknown as ExamFormsDocument;
}

/** Staff-side form APIs: authoring, response list/detail and room state. */
export const assessmentFormsApi = {
  examForms(examId: string): Promise<ExamFormsDocument> {
    return backendGet<unknown>(`/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/forms`, { retries: 0 }).then(
      checkExamFormsDocument,
    );
  },
  saveExamForms(examId: string, request: SaveExamFormsRequest): Promise<ExamFormsDocument> {
    return backendPut<unknown>(`/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/forms`, request, { retries: 0 }).then(
      checkExamFormsDocument,
    );
  },
  responses(filters: FormResponseFilters, cursor: string | null): Promise<FormResponsePage> {
    const params = new URLSearchParams({ formKey: filters.formKey });
    if (filters.examId) params.set("examId", filters.examId);
    if (filters.scheduleId) params.set("scheduleId", filters.scheduleId);
    if (filters.mode) params.set("mode", filters.mode);
    if (filters.status) params.set("status", filters.status);
    if (cursor) params.set("cursor", cursor);
    return backendGet<FormResponsePage>(`/v1/assessment-forms/responses?${params.toString()}`, { retries: 0 });
  },
  responseDetail(attemptId: string, formKey: FormKey): Promise<FormResponseDetail> {
    return backendGet<FormResponseDetail>(
      `/v1/assessment-forms/attempts/${encodeURIComponent(attemptId)}/responses/${encodeURIComponent(formKey)}`,
      { retries: 0 }
    );
  },
  scheduleFormState(scheduleId: string): Promise<ScheduleFormState> {
    return backendGet<ScheduleFormState>(`/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/forms/state`, { retries: 0 });
  },
};
