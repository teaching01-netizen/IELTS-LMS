import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentAuthoringApi } from "./assessmentAuthoringApi";
import { assessmentReleaseApi } from "./assessmentReleaseApi";
import type {
  AssessmentAuthoringShell,
  BatchCreateQuestionsRequest,
  BulkQuestionRequest,
  DuplicateQuestionRequest,
  LoadSampleExamRequest,
  PublishAssessmentRequest,
  ReorderQuestionsRequest,
  UpdateSectionDeliverySettingsRequest,
} from "../contracts/assessment";

export const assessmentKeys = {
  shell: (examId: string) => ["assessment", examId, "shell"] as const,
  release: (examId: string) => ["assessment", examId, "release"] as const,
  readinessRoot: (examId: string) => ["assessment", examId, "readiness"] as const,
  readiness: (examId: string, versionId: string, versionRevision: number) =>
    ["assessment", examId, "readiness", versionId, versionRevision] as const,
  question: (examQuestionId: string) => ["assessment-question", examQuestionId] as const,
};

export function useAuthoringShell(examId: string) {
  return useQuery({
    queryKey: assessmentKeys.shell(examId),
    queryFn: () => assessmentAuthoringApi.openShell(examId),
    staleTime: 30_000,
  });
}

export function useAssessmentReleaseState(examId: string) {
  return useQuery({
    queryKey: assessmentKeys.release(examId),
    queryFn: () => assessmentReleaseApi.get(examId),
    enabled: Boolean(examId),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
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
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
    },
  });
}

export function useBatchCreateAssessmentQuestions(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      moduleId,
      request,
    }: {
      moduleId: string;
      request: BatchCreateQuestionsRequest;
    }) => assessmentAuthoringApi.batchCreateQuestions(moduleId, request),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<AssessmentAuthoringShell>(assessmentKeys.shell(examId), (current) =>
        current
          ? {
              ...current,
              sections: current.sections.map((section) => ({
                ...section,
                modules: section.modules.map((module) =>
                  module.id === variables.moduleId
                    ? { ...module, questions: result.questions }
                    : module
                ),
              })),
            }
          : current
      );
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.shell(examId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.readinessRoot(examId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: assessmentKeys.release(examId),
        refetchType: "none",
      });
    },
  });
}

export function useLoadSatSampleExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: LoadSampleExamRequest) =>
      assessmentAuthoringApi.loadSampleExam(examId, request),
    onSuccess: (shell) => {
      queryClient.setQueryData(assessmentKeys.shell(examId), shell);
      queryClient.removeQueries({ queryKey: ["assessment-question"] });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
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
  versionRevision: number | undefined,
  enabled = true
) {
  return useQuery({
    queryKey:
      versionId !== undefined && versionRevision !== undefined
        ? assessmentKeys.readiness(examId, versionId, versionRevision)
        : [...assessmentKeys.readinessRoot(examId), "missing"],
    queryFn: () => assessmentAuthoringApi.validateExam(examId),
    enabled: enabled && Boolean(versionId) && versionRevision !== undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function usePublishAssessment(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: PublishAssessmentRequest) => {
      const publishedVersion = await assessmentAuthoringApi.publishExam(examId, request);
      const releaseState = await assessmentReleaseApi.get(examId);
      return { publishedVersion, releaseState };
    },
    onSuccess: ({ releaseState }) => {
      queryClient.setQueryData(assessmentKeys.release(examId), releaseState);
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      void queryClient.invalidateQueries({ queryKey: ["exam-authoring"] });
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) });
      void queryClient.invalidateQueries({ queryKey: ["assessment-access-links", "overview", examId] });
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
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
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
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
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
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
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
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
    },
  });
}
