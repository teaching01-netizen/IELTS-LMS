import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { gradingGateway } from '../infrastructure/gradingGateway';
import type { SessionDetailFilters, ReviewDraft, StudentResult, WritingAnnotation } from '../../../types/grading';

type GradingServiceResult<T> = Readonly<{
  success: boolean;
  data?: T;
  error?: string;
}>;

const liveQueryPolicy = {
  staleTime: 15 * 1000,
  gcTime: 2 * 60 * 1000,
} as const;

export const gradingKeys = {
  all: ['grading'] as const,
  sessions: () => [...gradingKeys.all, 'sessions'] as const,
  sessionSummary: () => [...gradingKeys.sessions(), 'summary'] as const,
  submissions: (sessionId: string) => [...gradingKeys.all, sessionId, 'submissions'] as const,
  submission: (submissionId: string) => [...gradingKeys.all, 'submission', submissionId] as const,
  reviewDraft: (submissionId: string) => [...gradingKeys.all, 'review-draft', submissionId] as const,
};

function requireResultData<T>(result: GradingServiceResult<T>, fallbackMessage: string): T {
  if (!result.success || result.data === undefined) {
    throw new Error(result.error ?? fallbackMessage);
  }
  return result.data;
}

export function useGradingSessions() {
  return useQuery({
    queryKey: gradingKeys.sessions(),
    queryFn: async () => requireResultData(await gradingGateway.service.getSessionQueue(), 'Failed to load grading sessions'),
    staleTime: 2 * 60 * 1000,
  });
}

export function useSessionQueueSummary() {
  return useQuery({
    queryKey: gradingKeys.sessionSummary(),
    queryFn: async () => requireResultData(await gradingGateway.service.getSessionQueueSummary(), 'Failed to load grading summary'),
    staleTime: 60 * 1000,
  });
}

export function useSessionSubmissions(sessionId: string, filters?: SessionDetailFilters) {
  return useQuery({
    queryKey: gradingKeys.submissions(sessionId),
    queryFn: async () =>
      requireResultData(
        await gradingGateway.service.getSessionStudentSubmissions(sessionId, filters),
        'Failed to load session submissions',
      ),
    enabled: sessionId.length > 0,
    ...liveQueryPolicy,
    refetchInterval: 15 * 1000,
  });
}

export function useSubmission(submissionId: string) {
  return useQuery({
    queryKey: gradingKeys.submission(submissionId),
    queryFn: () => gradingGateway.repository.getSubmissionById(submissionId),
    enabled: submissionId.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useReviewDraft(submissionId: string) {
  return useQuery({
    queryKey: gradingKeys.reviewDraft(submissionId),
    queryFn: () => gradingGateway.repository.getReviewDraftBySubmission(submissionId),
    enabled: submissionId.length > 0,
    ...liveQueryPolicy,
  });
}

export function useStartReview(
  options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingGateway.service
        .startReview(submissionId, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to start review')),
    onSuccess: (...args) => {
      const variables = args[1];
      queryClient.invalidateQueries({ queryKey: gradingKeys.reviewDraft(variables.submissionId) });
      queryClient.invalidateQueries({ queryKey: gradingKeys.submission(variables.submissionId) });
      options?.onSuccess?.(...args);
    },
  });
}

export function useSaveReviewDraft(
  options?: UseMutationOptions<ReviewDraft, Error, { draft: ReviewDraft; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ draft, teacherId, teacherName }) =>
      gradingGateway.service
        .saveReviewDraft(draft, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to save review draft')),
    onSuccess: (...args) => {
      const data = args[0];
      const variables = args[1];
      queryClient.setQueryData(gradingKeys.reviewDraft(variables.draft.submissionId), data);
      options?.onSuccess?.(...args);
    },
  });
}

export function useFinalizeReview(
  options?: UseMutationOptions<void, Error, { submissionId: string; teacherId: string; teacherName: string; reason?: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, teacherId, teacherName, reason }) =>
      gradingGateway.service.finalizeReview(submissionId, teacherId, teacherName, reason).then((result) => {
        if (!result.success) throw new Error(result.error ?? 'Failed to finalize review');
      }),
    onSuccess: (...args) => {
      const variables = args[1];
      queryClient.invalidateQueries({ queryKey: gradingKeys.reviewDraft(variables.submissionId) });
      queryClient.invalidateQueries({ queryKey: gradingKeys.submission(variables.submissionId) });
      options?.onSuccess?.(...args);
    },
  });
}

export function useAddWritingAnnotation(
  options?: UseMutationOptions<WritingAnnotation, Error, { submissionId: string; annotation: WritingAnnotation; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, annotation, teacherId, teacherName }) =>
      gradingGateway.service
        .addWritingAnnotation(submissionId, annotation, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to add writing annotation')),
    onSuccess: (...args) => {
      queryClient.invalidateQueries({ queryKey: gradingKeys.reviewDraft(args[1].submissionId) });
      options?.onSuccess?.(...args);
    },
  });
}

export function useMarkGradingComplete(
  options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingGateway.service
        .markGradingComplete(submissionId, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to mark grading complete')),
    onSuccess: (...args) => {
      queryClient.setQueryData(gradingKeys.reviewDraft(args[1].submissionId), args[0]);
      options?.onSuccess?.(...args);
    },
  });
}

export function useMarkReadyToRelease(
  options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingGateway.service
        .markReadyToRelease(submissionId, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to mark ready to release')),
    onSuccess: (...args) => {
      queryClient.setQueryData(gradingKeys.reviewDraft(args[1].submissionId), args[0]);
      options?.onSuccess?.(...args);
    },
  });
}

export function useReleaseResult(
  options?: UseMutationOptions<StudentResult, Error, { submissionId: string; teacherId: string; teacherName: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingGateway.service
        .releaseResult(submissionId, teacherId, teacherName)
        .then((result) => requireResultData(result, 'Failed to release result')),
    onSuccess: (...args) => {
      const variables = args[1];
      queryClient.invalidateQueries({ queryKey: gradingKeys.reviewDraft(variables.submissionId) });
      queryClient.invalidateQueries({ queryKey: gradingKeys.submission(variables.submissionId) });
      options?.onSuccess?.(...args);
    },
  });
}
