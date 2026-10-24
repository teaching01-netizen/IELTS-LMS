import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormKey, FormResponseFilters, SaveExamFormsRequest } from "../contracts/forms";
import { assessmentFormsApi } from "../infrastructure/assessmentFormsGateway";

export const assessmentFormKeys = {
  exam: (examId: string) => ["assessment-forms", "exam", examId] as const,
  responses: (filters: FormResponseFilters) => ["assessment-forms", "responses", filters] as const,
  detail: (attemptId: string, formKey: FormKey) => ["assessment-forms", "detail", attemptId, formKey] as const,
  schedule: (scheduleId: string) => ["assessment-forms", "schedule", scheduleId] as const,
};

export function useExamForms(examId: string) {
  return useQuery({
    queryKey: assessmentFormKeys.exam(examId),
    queryFn: () => assessmentFormsApi.examForms(examId),
    // Never refetch over an editor on focus; the save path owns freshness.
    refetchOnWindowFocus: false,
  });
}

/**
 * The single save owner for both form sections: one mutation, so section
 * saves serialize and each carries the revision of the last acknowledgement.
 */
export function useSaveExamForms(examId: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `assessment-forms:${examId}` },
    mutationFn: (request: SaveExamFormsRequest) => assessmentFormsApi.saveExamForms(examId, request),
    onSuccess: (doc) => client.setQueryData(assessmentFormKeys.exam(examId), doc),
  });
}

export function useFormResponses(filters: FormResponseFilters) {
  return useInfiniteQuery({
    queryKey: assessmentFormKeys.responses(filters),
    queryFn: ({ pageParam }) => assessmentFormsApi.responses(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useFormResponseDetail(attemptId: string | null, formKey: FormKey) {
  return useQuery({
    queryKey: assessmentFormKeys.detail(attemptId ?? "", formKey),
    queryFn: () => assessmentFormsApi.responseDetail(attemptId ?? "", formKey),
    enabled: Boolean(attemptId),
  });
}

export function useScheduleFormState(scheduleId: string | null | undefined) {
  return useQuery({
    queryKey: assessmentFormKeys.schedule(scheduleId ?? ""),
    queryFn: () => assessmentFormsApi.scheduleFormState(scheduleId ?? ""),
    enabled: Boolean(scheduleId),
    refetchInterval: 15_000,
  });
}
