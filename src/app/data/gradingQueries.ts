/**
 * React Query hooks for grading data fetching
 * Provides type-safe, cached, and optimized data fetching for grading operations
 */

import { useQuery, useMutation, useQueryClient, UseMutationOptions } from '@tanstack/react-query';
import { gradingService } from '../../services/gradingService';
import { gradingRepository } from '../../services/gradingRepository';
import { queryKeys } from './queryClient';
import { SessionDetailFilters, ReviewDraft, StudentResult, WritingAnnotation } from '../../types/grading';

function requireResultData<T>(
  result: { success: boolean; data?: T; error?: string },
  fallbackMessage: string
): T {
  if (!result.success || result.data === undefined) {
    throw new Error(result.error ?? fallbackMessage);
  }

  return result.data;
}

/**
 * Hook to fetch all grading sessions
 */
export function useGradingSessions() {
  return useQuery({
    queryKey: queryKeys.grading.sessions(),
    queryFn: () => gradingService.getSessionQueue().then(r => r.data || []),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch session queue summary
 */
export function useSessionQueueSummary() {
  return useQuery({
    queryKey: [...queryKeys.grading.sessions(), 'summary'],
    queryFn: () => gradingService.getSessionQueueSummary().then(r => r.data),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

/**
 * Hook to fetch student submissions for a session
 */
export function useSessionSubmissions(sessionId: string, filters?: SessionDetailFilters) {
  return useQuery({
    queryKey: queryKeys.grading.submissions(sessionId),
    queryFn: () => gradingService.getSessionStudentSubmissions(sessionId, filters).then(r => r.data || []),
    enabled: !!sessionId,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000, // Poll every 30 seconds
  });
}

/**
 * Hook to fetch a single submission
 */
export function useSubmission(submissionId: string) {
  return useQuery({
    queryKey: queryKeys.grading.submission(submissionId),
    queryFn: () => gradingRepository.getSubmissionById(submissionId),
    enabled: !!submissionId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Hook to fetch review draft for a submission
 */
export function useReviewDraft(submissionId: string) {
  return useQuery({
    queryKey: ['review-draft', submissionId],
    queryFn: () => gradingRepository.getReviewDraftBySubmission(submissionId),
    enabled: !!submissionId,
    staleTime: 30 * 1000,
  });
}

/**
 * Mutation to start a review
 */
export function useStartReview(options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingService
        .startReview(submissionId, teacherId, teacherName)
        .then(result => requireResultData(result, 'Failed to start review')),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['review-draft', variables.submissionId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.grading.submission(variables.submissionId) });
    },
    ...options,
  });
}

/**
 * Mutation to save review draft
 */
export function useSaveReviewDraft(options?: UseMutationOptions<ReviewDraft, Error, { draft: ReviewDraft; teacherId: string; teacherName: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ draft, teacherId, teacherName }) =>
      gradingService
        .saveReviewDraft(draft, teacherId, teacherName)
        .then(result => requireResultData(result, 'Failed to save review draft')),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['review-draft', variables.draft.submissionId], data);
    },
    ...options,
  });
}

/**
 * Mutation to finalize review
 */
export function useFinalizeReview(options?: UseMutationOptions<void, Error, { submissionId: string; teacherId: string; teacherName: string; reason?: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ submissionId, teacherId, teacherName, reason }) => 
      gradingService.finalizeReview(submissionId, teacherId, teacherName, reason).then(r => r.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['review-draft', variables.submissionId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.grading.submission(variables.submissionId) });
    },
    ...options,
  });
}

/**
 * Mutation to add writing annotation
 */
export function useAddWritingAnnotation(options?: UseMutationOptions<WritingAnnotation, Error, { submissionId: string; annotation: WritingAnnotation; teacherId: string; teacherName: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ submissionId, annotation, teacherId, teacherName }) =>
      gradingService
        .addWritingAnnotation(submissionId, annotation, teacherId, teacherName)
        .then(result => requireResultData(result, 'Failed to add writing annotation')),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['review-draft', variables.submissionId] });
    },
    ...options,
  });
}

/**
 * Mutation to mark grading complete
 */
export function useMarkGradingComplete(options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingService
        .markGradingComplete(submissionId, teacherId, teacherName)
        .then(result => requireResultData(result, 'Failed to mark grading complete')),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['review-draft', variables.submissionId], data);
    },
    ...options,
  });
}

/**
 * Mutation to mark ready to release
 */
export function useMarkReadyToRelease(options?: UseMutationOptions<ReviewDraft, Error, { submissionId: string; teacherId: string; teacherName: string }>) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ submissionId, teacherId, teacherName }) =>
      gradingService
        .markReadyToRelease(submissionId, teacherId, teacherName)
        .then(result => requireResultData(result, 'Failed to mark ready to release')),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['review-draft', variables.submissionId], data);
    },
    ...options,
  });
}

/**
 * Mutation to release result
 */
export function useReleaseResult(
  options?: UseMutationOptions<StudentResult, Error, { submissionId: string; teacherId: string; teacherName: string }>
) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ submissionId, teacherId, teacherName }) => {
      const result = await gradingService.releaseResult(submissionId, teacherId, teacherName);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to release result');
      }
      return result.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['review-draft', variables.submissionId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.grading.submission(variables.submissionId) });
    },
    ...options,
  });
}
