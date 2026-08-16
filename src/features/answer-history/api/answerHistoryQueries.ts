import { useQuery } from '@tanstack/react-query';
import type {
  AnswerHistoryExportFormat,
  AnswerHistoryTargetType,
} from '../contracts';
import { answerHistoryGateway } from '../infrastructure/answerHistoryGateway';

const liveQueryPolicy = {
  staleTime: 15_000,
  gcTime: 2 * 60_000,
} as const;

export const answerHistoryKeys = {
  all: ['answer-history'] as const,
  overviewBySubmission: (submissionId: string) =>
    [...answerHistoryKeys.all, 'overview', 'submission', submissionId] as const,
  overviewByAttempt: (attemptId: string) =>
    [...answerHistoryKeys.all, 'overview', 'attempt', attemptId] as const,
  targetDetail: (submissionId: string, targetType: AnswerHistoryTargetType, targetId: string) =>
    [...answerHistoryKeys.all, 'detail', submissionId, targetType, targetId] as const,
  targetDetailByAttempt: (attemptId: string, targetType: AnswerHistoryTargetType, targetId: string) =>
    [...answerHistoryKeys.all, 'detail-attempt', attemptId, targetType, targetId] as const,
};

function requireId(value: string | null): string {
  if (!value) {
    throw new Error('Answer history query requires an identifier');
  }
  return value;
}

export function useAnswerHistoryOverviewBySubmission(submissionId: string | null) {
  return useQuery({
    queryKey: submissionId
      ? answerHistoryKeys.overviewBySubmission(submissionId)
      : [...answerHistoryKeys.all, 'overview', 'submission', 'none'],
    queryFn: () => answerHistoryGateway.fetchOverviewBySubmission(requireId(submissionId)),
    enabled: Boolean(submissionId),
    ...liveQueryPolicy,
  });
}

export function useAnswerHistoryOverviewByAttempt(attemptId: string | null) {
  return useQuery({
    queryKey: attemptId
      ? answerHistoryKeys.overviewByAttempt(attemptId)
      : [...answerHistoryKeys.all, 'overview', 'attempt', 'none'],
    queryFn: () => answerHistoryGateway.fetchOverviewByAttempt(requireId(attemptId)),
    enabled: Boolean(attemptId),
    ...liveQueryPolicy,
  });
}

export function useAnswerHistoryTargetDetail(args: {
  submissionId: string | null;
  targetId: string | null;
  targetType: AnswerHistoryTargetType;
}) {
  const enabled = Boolean(args.submissionId && args.targetId);

  return useQuery({
    queryKey:
      args.submissionId && args.targetId
        ? answerHistoryKeys.targetDetail(args.submissionId, args.targetType, args.targetId)
        : [...answerHistoryKeys.all, 'detail', 'none'],
    queryFn: () =>
      answerHistoryGateway.fetchTargetDetail({
        submissionId: requireId(args.submissionId),
        targetId: requireId(args.targetId),
        targetType: args.targetType,
      }),
    enabled,
    ...liveQueryPolicy,
  });
}

export function useAnswerHistoryTargetDetailByAttempt(args: {
  attemptId: string | null;
  targetId: string | null;
  targetType: AnswerHistoryTargetType;
}) {
  const enabled = Boolean(args.attemptId && args.targetId);

  return useQuery({
    queryKey:
      args.attemptId && args.targetId
        ? answerHistoryKeys.targetDetailByAttempt(args.attemptId, args.targetType, args.targetId)
        : [...answerHistoryKeys.all, 'detail-attempt', 'none'],
    queryFn: () =>
      answerHistoryGateway.fetchTargetDetailByAttempt({
        attemptId: requireId(args.attemptId),
        targetId: requireId(args.targetId),
        targetType: args.targetType,
      }),
    enabled,
    ...liveQueryPolicy,
  });
}

export function fetchAnswerHistoryExport(args: {
  submissionId: string;
  targetId: string;
  targetType: AnswerHistoryTargetType;
  format: AnswerHistoryExportFormat;
}) {
  return answerHistoryGateway.fetchExport(args);
}
