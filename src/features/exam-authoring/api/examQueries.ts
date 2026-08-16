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
  list: () => [...examKeys.all, 'list'] as const,
  detail: (examId: string) => [...examKeys.all, 'detail', examId] as const,
};

export async function fetchExamList(): Promise<ExamListData> {
  const entities = await examAuthoringFacade.repository.getAllExamsWithLegacyMigration();
  const exams = await examAuthoringFacade.adaptExamEntitiesToLegacyExams(
    entities,
    examAuthoringFacade.repository,
  );

  return { entities, exams };
}

export function useExamListQuery(enabled = true) {
  return useQuery({
    queryKey: examKeys.list(),
    queryFn: fetchExamList,
    enabled,
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

      void queryClient.invalidateQueries({ queryKey: examKeys.list() });
      queryClient.removeQueries({ queryKey: examKeys.detail(examId) });
    },
  });
}

export function invalidateExamList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: examKeys.list() });
}
