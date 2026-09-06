import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { TransitionResult } from '../../../types/domain';
import { examAuthoringFacade } from '../application/examAuthoringFacade';
import type { DeleteExamInput, ExamListData } from '../contracts/examList';

const examListQueryPolicy = {
  staleTime: 5 * 60 * 1000,
  gcTime: 10 * 60 * 1000,
} as const;

export const examKeys = {
  all: ['exam-authoring'] as const,
  list: (providerKey?: 'sat' | 'ielts' | 'act') => [...examKeys.all, 'list', providerKey ?? 'all'] as const,
  detail: (examId: string) => [...examKeys.all, 'detail', examId] as const,
};

export async function fetchExamList(providerKey?: 'sat' | 'ielts' | 'act'): Promise<ExamListData> {
  const entities = await examAuthoringFacade.repository.getAllExamsWithLegacyMigration(providerKey);
  const exams = await examAuthoringFacade.adaptExamEntitiesToLegacyExams(
    entities,
    examAuthoringFacade.repository,
  );

  return { entities, exams };
}

export function useExamListQuery(enabled = true, providerKey?: 'sat' | 'ielts' | 'act') {
  return useQuery({
    queryKey: examKeys.list(providerKey),
    queryFn: () => fetchExamList(providerKey),
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

export function invalidateExamList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: examKeys.all });
}
