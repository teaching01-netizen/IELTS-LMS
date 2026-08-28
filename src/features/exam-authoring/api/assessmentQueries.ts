import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentAuthoringApi } from "./assessmentAuthoringApi";
import type {
  BulkQuestionRequest,
  DuplicateQuestionRequest,
  PublishAssessmentRequest,
  ReorderQuestionsRequest,
  UpdateSectionDeliverySettingsRequest,
} from "../contracts/assessment";

export const assessmentKeys = {
  shell: (examId: string) => ["assessment", examId, "shell"] as const,
  readinessRoot: (examId: string) => ["assessment", examId, "readiness"] as const,
  readiness: (examId: string, versionId: string, versionRevision: number) =>
    ["assessment", examId, "readiness", versionId, versionRevision] as const,
  question: (examQuestionId: string) => ["assessment-question", examQuestionId] as const,
};

export function useAuthoringShell(examId: string) {
  return useQuery({
    queryKey: assessmentKeys.shell(examId),
    queryFn: () => assessmentAuthoringApi.getShell(examId),
    staleTime: 30_000,
  });
}

export function useExamQuestion(examQuestionId: string | null) {
  return useQuery({
    queryKey: examQuestionId
      ? assessmentKeys.question(examQuestionId)
      : ["assessment-question", "missing"],
    queryFn: () => assessmentAuthoringApi.getQuestion(examQuestionId ?? ""),
    enabled: Boolean(examQuestionId),
    staleTime: 60_000,
  });
}

export function useCreateAssessmentQuestion(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => assessmentAuthoringApi.createQuestion(moduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    },
  });
}

export function useAssessmentValidation(examId: string) {
  return useMutation({
    mutationFn: () => assessmentAuthoringApi.validateExam(examId),
  });
}

export function useAssessmentReleaseReadiness(
  examId: string,
  versionId: string | undefined,
  versionRevision: number | undefined
) {
  return useQuery({
    queryKey:
      versionId !== undefined && versionRevision !== undefined
        ? assessmentKeys.readiness(examId, versionId, versionRevision)
        : [...assessmentKeys.readinessRoot(examId), "missing"],
    queryFn: () => assessmentAuthoringApi.validateExam(examId),
    enabled: Boolean(versionId) && versionRevision !== undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function usePublishAssessment(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PublishAssessmentRequest) =>
      assessmentAuthoringApi.publishExam(examId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      void queryClient.invalidateQueries({ queryKey: ["exam-authoring"] });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      queryClient.removeQueries({ queryKey: assessmentKeys.shell(examId) });
    },
  });
}

export function useDuplicateAssessmentQuestion(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      examQuestionId,
      request,
    }: {
      examQuestionId: string;
      request: DuplicateQuestionRequest;
    }) => assessmentAuthoringApi.duplicateQuestion(examQuestionId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    },
  });
}

export function useReorderAssessmentQuestions(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, request }: { moduleId: string; request: ReorderQuestionsRequest }) =>
      assessmentAuthoringApi.reorderQuestions(moduleId, request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    },
  });
}

export function useBulkAssessmentQuestions(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: BulkQuestionRequest) => assessmentAuthoringApi.bulkQuestions(request),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    },
  });
}

export function useUpdateSectionDeliverySettings(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sectionId,
      request,
    }: {
      sectionId: string;
      request: UpdateSectionDeliverySettingsRequest;
    }) => assessmentAuthoringApi.updateSectionDeliverySettings(examId, sectionId, request),
    onSuccess: (shell) => {
      queryClient.setQueryData(assessmentKeys.shell(examId), shell);
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
    },
  });
}
