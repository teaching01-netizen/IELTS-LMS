import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { BulkOperationResult, ExamEntity, TransitionResult } from '../../../types/domain';
import { examAuthoringFacade } from '../application/examAuthoringFacade';
import type { DeleteExamInput, ExamListData } from '../contracts/examList';

const examListQueryPolicy = {
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
} as const;

export const examKeys = {
  all: ['exam-authoring'] as const,
  list: (providerKey?: 'sat' | 'ielts' | 'act', withContent = true) =>
    [...examKeys.all, 'list', providerKey ?? 'all', withContent ? 'content' : 'entities'] as const,
  detail: (examId: string) => [...examKeys.all, 'detail', examId] as const,
};

/**
 * `withContent: false` skips the per-exam version fetch that builds legacy
 * `exams`; callers that only read `entities` would otherwise issue one version
 * read per exam, which trips the authed-reads limit on large libraries.
 */
export async function fetchExamList(
  providerKey?: 'sat' | 'ielts' | 'act',
  withContent = true,
): Promise<ExamListData> {
  const entities = await examAuthoringFacade.repository.getAllExamsWithLegacyMigration(providerKey);
  if (!withContent) {
    return { entities, exams: [] };
  }
  const exams = await examAuthoringFacade.adaptExamEntitiesToLegacyExams(
    entities,
    examAuthoringFacade.repository,
  );

  return { entities, exams };
}

export function useExamListQuery(
  enabled = true,
  providerKey?: 'sat' | 'ielts' | 'act',
  withContent = true,
) {
  return useQuery({
    queryKey: examKeys.list(providerKey, withContent),
    queryFn: () => fetchExamList(providerKey, withContent),
    enabled,
    ...examListQueryPolicy,
  });
}

export function useExamQuery(examId?: string) {
  return useQuery({
    queryKey: examId ? examKeys.detail(examId) : [...examKeys.all, 'detail', 'missing'],
    queryFn: () => examAuthoringFacade.repository.getExamById(examId ?? ''),
    enabled: Boolean(examId),
    ...examListQueryPolicy,
  });
}

export function useDeleteExamMutation() {
  const queryClient = useQueryClient();

  return useMutation<TransitionResult, Error, DeleteExamInput>({
    mutationFn: ({ examId, actor }) => examAuthoringFacade.lifecycle.deleteExam(examId, actor),
    onSuccess: (result, { examId }) => {
      if (!result.success) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: examKeys.all });
      queryClient.removeQueries({ queryKey: examKeys.detail(examId) });
    },
  });
}

/** Per-exam outcomes; the list refreshes even on partial failure. */
export function useBulkDeleteExamsMutation() {
  const queryClient = useQueryClient();

  return useMutation<BulkOperationResult, Error, { examIds: string[]; actor: string }>({
    mutationFn: ({ examIds, actor }) => examAuthoringFacade.lifecycle.bulkDelete(examIds, actor),
    onSettled: (result) => {
      void queryClient.invalidateQueries({ queryKey: examKeys.all });
      for (const item of result?.results ?? []) {
        if (item.success) queryClient.removeQueries({ queryKey: examKeys.detail(item.examId) });
      }
    },
  });
}

export function useSaveExamMutation() {
  return useMutation<void, Error, ExamEntity>({
    mutationFn: (exam) => examAuthoringFacade.repository.saveExam(exam),
  });
}

export function invalidateExamList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: examKeys.all });
}
