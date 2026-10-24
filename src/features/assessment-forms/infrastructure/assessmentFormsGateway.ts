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

/** Staff-side form APIs: authoring, response list/detail and room state. */
export const assessmentFormsApi = {
  examForms(examId: string): Promise<ExamFormsDocument> {
    return backendGet<ExamFormsDocument>(`/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/forms`, { retries: 0 });
  },
  saveExamForms(examId: string, request: SaveExamFormsRequest): Promise<ExamFormsDocument> {
    return backendPut<ExamFormsDocument>(`/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/forms`, request, { retries: 0 });
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
