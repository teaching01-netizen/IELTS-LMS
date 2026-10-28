import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { filterStudentSubmissions, gradingGateway } from '../infrastructure/gradingGateway';
import {
  parseReviewDraft,
  parseReviewSections,
  parseReviewSubmission,
  parseReviewWritingTasks,
} from '../contracts/reviewSchemas';
import type {
  SessionDetailFilters,
  ReviewDraft,
  StudentSubmission,
} from '../../../types/grading';

type GradingServiceResult<T> = Readonly<{
  success: boolean;
  data?: T;
  error?: unknown;
}>;

// Polling cadence for live grading views. Kept at 30s + jitter so a fleet
// of open grading tabs cannot burn through the polling-tier quota that
// protects auth session reads (see backend rate-limit tiers).
const POLLING_INTERVAL_MS = 30 * 1000;
const POLLING_JITTER_MS = 5 * 1000;

function pollingIntervalWithJitter(): number {
  return POLLING_INTERVAL_MS + Math.floor(Math.random() * POLLING_JITTER_MS);
}

const liveQueryPolicy = {
  staleTime: 15 * 1000,
  gcTime: 2 * 60 * 1000,
} as const;

export const gradingKeys = {
  all: ['grading'] as const,
  sessions: () => [...gradingKeys.all, 'sessions'] as const,
  submissions: (sessionId: string) => [...gradingKeys.all, sessionId, 'submissions'] as const,
  submission: (submissionId: string) => [...gradingKeys.all, 'submission', submissionId] as const,
  reviewDraft: (submissionId: string) => [...gradingKeys.all, 'review-draft', submissionId] as const,
  sections: (submissionId: string) => [...gradingKeys.all, 'sections', submissionId] as const,
  writingTasks: (submissionId: string) => [...gradingKeys.all, 'writing-tasks', submissionId] as const,
  publishedVersion: (versionId: string) => [...gradingKeys.all, 'published-version', versionId] as const,
};

function throwResultError(error: unknown, fallbackMessage: string): never {
  if (error instanceof Error) {
    throw error;
  }
  throw new Error(typeof error === 'string' ? error : fallbackMessage);
}

function requireResultData<T>(result: GradingServiceResult<T>, fallbackMessage: string): T {
  if (result.success && result.data !== undefined) {
    return result.data;
  }
  return throwResultError(result.error, fallbackMessage);
}

export function useGradingSessions() {
  return useQuery({
    queryKey: gradingKeys.sessions(),
    queryFn: async () => requireResultData(await gradingGateway.service.getSessionQueue(), 'Failed to load grading sessions'),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * The submissions response does not depend on the filters (they are applied
 * client-side), so the cache holds the unfiltered list under the session key
 * and each observer derives its own view.
 */
export function useSessionSubmissions(sessionId: string, filters?: SessionDetailFilters) {
  return useQuery({
    queryKey: gradingKeys.submissions(sessionId),
    queryFn: async () =>
      requireResultData(
        await gradingGateway.service.getSessionStudentSubmissions(sessionId),
        'Failed to load session submissions',
      ),
    select: (submissions: StudentSubmission[]) =>
      filters ? filterStudentSubmissions(submissions, filters) : submissions,
    enabled: sessionId.length > 0,
    ...liveQueryPolicy,
    refetchInterval: pollingIntervalWithJitter,
  });
}

/** Review reads: one checked fetcher per cache key, shared by every observer. */
export async function fetchReviewSubmission(submissionId: string) {
  return parseReviewSubmission(submissionId, await gradingGateway.repository.getSubmissionById(submissionId));
}

export async function fetchReviewDraft(submissionId: string) {
  return parseReviewDraft(submissionId, await gradingGateway.repository.getReviewDraftBySubmission(submissionId));
}

export async function fetchReviewSections(submissionId: string) {
  return parseReviewSections(submissionId, await gradingGateway.repository.getSectionSubmissionsBySubmissionId(submissionId));
}

export async function fetchReviewWritingTasks(submissionId: string) {
  return parseReviewWritingTasks(submissionId, await gradingGateway.repository.getWritingSubmissionsBySubmissionId(submissionId));
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
