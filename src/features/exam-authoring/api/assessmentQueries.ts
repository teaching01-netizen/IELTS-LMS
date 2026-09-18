import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shouldRetryQuery } from "../../../shared/api/queryClient";
import { hasBackendStatusCode, isBackendNotFound } from "../infrastructure/examAuthoringBackendGateway";
import { assessmentAuthoringApi } from "./assessmentAuthoringApi";
import { assessmentReleaseApi } from "./assessmentReleaseApi";
import { assessmentKeys, authoringEffects } from "./authoringQueryEffects";
import type {
  AssessmentAuthoringShellResult,
  BatchCreateQuestionsRequest,
  BulkQuestionRequest,
  DuplicateQuestionRequest,
  LoadSampleExamRequest,
  PublishAssessmentRequest,
  ReorderQuestionsRequest,
  UpdateSectionDeliverySettingsRequest,
} from "../contracts/assessment";

/**
 * Authoring queries and mutations.
 *
 * This module owns exactly four things: the query functions, their retry
 * policy, the mutation functions, and which SEMANTIC effect each mutation
 * reports. It never enumerates cache keys — `authoringQueryEffects` owns that.
 */

export const AUTHORING_SHELL_STALE_TIME_MS = 30_000;

export function useAuthoringShell(examId: string) {
  return useQuery({
    queryKey: assessmentKeys.shell(examId),
    // Refresh/remount/focus reads use GET /shell (5 stmts, no write Tx).
    // POST /shell is reserved for the explicit draft-open in useEnsureDraftShell.
    // The response carries the lifecycle state, so "no editable draft" arrives
    // as a success and never as an error.
    queryFn: () => assessmentAuthoringApi.getShell(examId),
    staleTime: AUTHORING_SHELL_STALE_TIME_MS,
    // A 404 here is a definitive answer (the exam does not exist), and 403 is a
    // permission answer. Neither is transient, so retrying them would only
    // re-ask the same question while multiplying network and console noise.
    retry: (failureCount, error) =>
      !isBackendNotFound(error) &&
      !hasBackendStatusCode(error, 403) &&
      shouldRetryQuery(failureCount, error),
  });
}

/**
 * Explicit draft-open: the ONLY sanctioned POST /shell caller. Callers render an
 * explicit CTA and invoke this mutation from a user gesture — a refresh can
 * never reach it.
 *
 * - retry:false: never blindly retry a write.
 * - onSuccess installs the shell via `draftOpened` so the workspace renders
 *   without waiting for a refetch.
 * - onError only classifies; the caller owns display and must NEVER auto-loop.
 */
export function useEnsureDraftShell(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => assessmentAuthoringApi.openShell(examId),
    retry: false,
    // `void`: a mutation reports the effect, it does not wait for the refresh.
    onSuccess: (shell) => void authoringEffects.draftOpened(queryClient, examId, shell),
  });
}

export function useAssessmentReleaseState(examId: string) {
  return useQuery({
    queryKey: assessmentKeys.release(examId),
    queryFn: () => assessmentReleaseApi.get(examId),
    enabled: Boolean(examId),
    staleTime: 5_000,
    // The release page drives refreshes explicitly (publish/save/run-checks).
    // Window-focus refetch caused publish-race refetch storms on this page.
    refetchOnWindowFocus: false,
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
    // A row was added: the tree changed, but no specific cached question detail
    // is affected, so this is a structure effect rather than questionChanged.
    onSuccess: () => void authoringEffects.shellChanged(queryClient, examId),
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
      // The batch response carries the module's new question list, so apply it
      // instead of refetching the whole tree: an active refetch here would race
      // the author's next edit.
      queryClient.setQueryData<AssessmentAuthoringShellResult>(
        assessmentKeys.shell(examId),
        (current) => {
          if (!current || current.state !== "READY" || !current.shell) return current;
          const shell = current.shell;
          return {
            ...current,
            shell: {
              ...shell,
              sections: shell.sections.map((section) => ({
                ...section,
                modules: section.modules.map((module) =>
                  module.id === variables.moduleId
                    ? { ...module, questions: result.questions }
                    : module
                ),
              })),
            },
          };
        }
      );
      void authoringEffects.shellChanged(queryClient, examId, { refetchType: "none" });
    },
  });
}

export function useLoadSatSampleExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: LoadSampleExamRequest) =>
      assessmentAuthoringApi.loadSampleExam(examId, request),
    onSuccess: (shell) => void authoringEffects.questionsReplaced(queryClient, examId, shell),
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
    // validateExam is expensive: manual "Run checks" is the source of truth.
    // A short stale window plus no focus refetch avoids hammering it while
    // still keeping the current draft's report reasonably fresh.
    staleTime: 15_000,
    retry: 1,
    refetchOnWindowFocus: false,
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
    onSuccess: ({ releaseState }) => void authoringEffects.published(queryClient, examId, releaseState),
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
    // The duplicate is a NEW row: nothing cached describes it yet, so the
    // effect is the structure change, not a change to an existing question.
    onSuccess: () => void authoringEffects.shellChanged(queryClient, examId),
  });
}

export function useReorderAssessmentQuestions(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, request }: { moduleId: string; request: ReorderQuestionsRequest }) =>
      assessmentAuthoringApi.reorderQuestions(moduleId, request),
    onSettled: () => void authoringEffects.shellChanged(queryClient, examId),
  });
}

export function useBulkAssessmentQuestions(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: BulkQuestionRequest) => assessmentAuthoringApi.bulkQuestions(request),
    onSettled: () => void authoringEffects.shellChanged(queryClient, examId),
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
    onSuccess: (shell) => void authoringEffects.deliveryChanged(queryClient, examId, shell),
  });
}
