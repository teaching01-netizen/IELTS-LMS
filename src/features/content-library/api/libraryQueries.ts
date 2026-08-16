import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { libraryGateway } from '../infrastructure/libraryGateway';
import type {
  Passage,
  PassageLibraryItem,
  PassageMetadata,
  QuestionBankItem,
  QuestionBlock,
  QuestionMetadata,
} from '../../../types';

const staticQueryPolicy = {
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
} as const;

export const libraryKeys = {
  all: ['content-library'] as const,
  passages: () => [...libraryKeys.all, 'passages'] as const,
  questions: () => [...libraryKeys.all, 'questions'] as const,
};

export function useLibraryPassagesQuery() {
  return useQuery({
    queryKey: libraryKeys.passages(),
    queryFn: libraryGateway.passages.getAll,
    ...staticQueryPolicy,
  });
}

export function useLibraryQuestionsQuery() {
  return useQuery({
    queryKey: libraryKeys.questions(),
    queryFn: libraryGateway.questions.getAll,
    ...staticQueryPolicy,
  });
}

export function useDeleteLibraryPassageMutation(
  options?: UseMutationOptions<boolean, Error, string>,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: (id) => libraryGateway.passages.delete(id),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.passages() });
      options?.onSuccess?.(...args);
    },
  });
}

export function useDeleteLibraryQuestionMutation(
  options?: UseMutationOptions<boolean, Error, string>,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: (id) => libraryGateway.questions.delete(id),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.questions() });
      options?.onSuccess?.(...args);
    },
  });
}

export function useClearLibraryPassagesMutation(
  options?: UseMutationOptions<void, Error, void>,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: () => libraryGateway.passages.clear(),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.passages() });
      options?.onSuccess?.(...args);
    },
  });
}

export function useClearLibraryQuestionsMutation(
  options?: UseMutationOptions<void, Error, void>,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: () => libraryGateway.questions.clear(),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.questions() });
      options?.onSuccess?.(...args);
    },
  });
}

export function useAddLibraryPassageMutation(
  options?: UseMutationOptions<
    PassageLibraryItem,
    Error,
    { passage: Passage; metadata: Omit<PassageMetadata, 'id' | 'createdAt' | 'usageCount'> }
  >,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: ({ passage, metadata }) => libraryGateway.passages.add(passage, metadata),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.passages() });
      options?.onSuccess?.(...args);
    },
  });
}

export function useAddLibraryQuestionMutation(
  options?: UseMutationOptions<
    QuestionBankItem,
    Error,
    { block: QuestionBlock; metadata: Omit<QuestionMetadata, 'id' | 'createdAt' | 'usageCount'> }
  >,
) {
  const client = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: ({ block, metadata }) => libraryGateway.questions.add(block, metadata),
    onSuccess: (...args) => {
      client.invalidateQueries({ queryKey: libraryKeys.questions() });
      options?.onSuccess?.(...args);
    },
  });
}

export const useLibraryPassages = useLibraryPassagesQuery;
export const useLibraryQuestions = useLibraryQuestionsQuery;
export const useDeleteLibraryPassage = useDeleteLibraryPassageMutation;
export const useDeleteLibraryQuestion = useDeleteLibraryQuestionMutation;
export const useAddLibraryPassage = useAddLibraryPassageMutation;
export const useAddLibraryQuestion = useAddLibraryQuestionMutation;
