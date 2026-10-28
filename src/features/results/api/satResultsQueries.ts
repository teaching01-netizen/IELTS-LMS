import { useQuery } from '@tanstack/react-query';
import { resultsGateway } from '../infrastructure/resultsGateway';

export type SatAssessmentRoute = 'lower' | 'higher';
export type SatResultOutcomeStatus = 'scored' | 'pending' | 'invalidated_proctor' | 'invalidated_timeout' | 'unscored';

export interface SatAccessGroupSummary {
  scheduleId: string;
  accessLinkId: string | null;
  accessLinkName: string;
  accessLinkState: string | null;
  examId: string;
  examTitle: string;
  versionNumber: number;
  cohortName: string;
  attemptCount: number;
  submittedCount: number;
  scoredCount: number;
  pendingCount: number;
  invalidatedCount: number;
  latestSubmittedAt: string | null;
  /** Optional while older servers omit them. Test start = first module start. */
  latestTestStartedAt?: string | null;
  earliestTestStartedAt?: string | null;
  completedCount?: number;
  runningCount?: number;
  endedCount?: number;
  otherCount?: number;
}

export interface SatAttemptRow extends Omit<SatResultSummary, 'id' | 'submissionId' | 'scoreKind'> {
  resultId: string | null;
  attemptId: string;
  attemptStatus?: string;
  testStartedAt?: string | null;
  rawCorrect?: number;
  rawTotal?: number;
  estimatedTotal?: { low: number; high: number } | null;
}

export interface SatAttemptPage {
  items: SatAttemptRow[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface SatResultSummary {
  id: string;
  submissionId: string | null;
  outcomeStatus: SatResultOutcomeStatus;
  scheduleId: string;
  examId: string;
  examTitle: string;
  versionNumber: number;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  cohortName: string;
  submittedAt: string | null;
  totalScore: number | null;
  scoreKind: 'practice';
  releaseStatus: string;
}

export type SatModuleAdaptiveRole = 'base' | 'lower_branch' | 'higher_branch' | 'none';

export interface SatModuleResult {
  moduleKey: string;
  adaptiveRole: SatModuleAdaptiveRole | string;
  rawCorrect: number;
  operationalQuestionCount: number;
  state: string;
  isAdministered: boolean;
  displayOrder: number;
}

export interface SatQuestionResult {
  questionId: string;
  displayOrder: number;
  moduleKey: string;
  sectionKey: string;
  kind?: string;
  response: unknown;
  responseLabel?: string;
  correctAnswer: unknown;
  correctLabel?: string;
  /** Null verdict = pretest, unanswered, missing key, or unscored outcome. Never render null as incorrect. */
  isCorrect: boolean | null;
  isPretest: boolean;
  markedForReview: boolean;
}

export interface SatSectionResult {
  sectionKey: string;
  route: SatAssessmentRoute | null;
  rawCorrect: number;
  operationalQuestionCount: number;
  scaledScore: number | null;
  details: Record<string, unknown>;
  modules: SatModuleResult[];
}

export interface SatResultDetail {
  summary: SatResultSummary & { attemptId: string };
  scorePayload: Record<string, unknown>;
  sections: SatSectionResult[];
  questions: SatQuestionResult[];
  testStartedAt?: string | null;
}

export interface SatAttemptAnswer {
  questionId: string;
  sectionKey: string;
  moduleKey: string;
  displayOrder: number;
  response: unknown;
  responseLabel?: string;
  markedForReview: boolean;
}

export interface SatAttemptAnswers {
  attemptId: string;
  examTitle: string;
  versionNumber: number;
  studentId: string;
  studentName: string;
  cohortName: string;
  status: string;
  protocolVersion: number;
  responseRevision: number | null;
  savedAnswerCount: number;
  lastSavedAt: string | null;
  testStartedAt?: string | null;
  submittedAt?: string | null;
  questions: SatAttemptAnswer[];
}

export const satResultKeys = {
  all: ['sat-results'] as const,
  list: () => [...satResultKeys.all, 'list'] as const,
  attempts: (examId: string, scheduleId: string, offset: number, needle: string, scoreFilter: string, filters: SatAttemptFilters) => [...satResultKeys.all, 'attempts', examId, scheduleId, offset, needle, scoreFilter, filters] as const,
  detail: (resultId: string) => [...satResultKeys.all, 'detail', resultId] as const,
  attemptAnswers: (attemptId: string) => [...satResultKeys.all, 'attempt-answers', attemptId] as const,
};

export function useSatResultsQuery() {
  return useQuery({
    queryKey: satResultKeys.list(),
    queryFn: ({ signal }) => resultsGateway.get<SatAccessGroupSummary[]>('/v1/results/sat/access-groups', { signal }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export interface SatAttemptFilters {
  status?: 'all' | 'completed' | 'running' | 'ended' | 'other';
  /** RFC 3339 instants; half-open interval over the actual test start. */
  from?: string;
  to?: string;
}

export function useSatAttemptsQuery(examId?: string, scheduleId?: string, offset = 0, needle = '', scoreFilter = 'all', filters: SatAttemptFilters = {}) {
  return useQuery({
    queryKey: satResultKeys.attempts(examId ?? '', scheduleId ?? '', offset, needle, scoreFilter, filters),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ examId: examId ?? '', scheduleId: scheduleId ?? '', limit: '50', offset: String(offset), q: needle, scoreFilter });
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      return resultsGateway.get<SatAttemptPage>(`/v1/results/sat/attempts?${params.toString()}`, { signal });
    },
    enabled: Boolean(examId && scheduleId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Views index these collections directly; an incomplete payload is a load error, not a crash. */
function checkSatResultDetail(value: unknown): SatResultDetail {
  if (
    !isRecord(value) ||
    !isRecord(value['summary']) ||
    typeof value['summary']['outcomeStatus'] !== 'string' ||
    !Array.isArray(value['sections']) ||
    !Array.isArray(value['questions'])
  ) {
    throw new Error('The result response was incomplete. Try again.');
  }
  return value as unknown as SatResultDetail;
}

function checkSatAttemptAnswers(value: unknown): SatAttemptAnswers {
  if (!isRecord(value) || typeof value['attemptId'] !== 'string' || !Array.isArray(value['questions'])) {
    throw new Error('The saved answers response was incomplete. Try again.');
  }
  return value as unknown as SatAttemptAnswers;
}

export function useSatResultQuery(resultId?: string) {
  return useQuery({
    queryKey: satResultKeys.detail(resultId ?? 'missing'),
    queryFn: ({ signal }) =>
      resultsGateway.get<unknown>(`/v1/results/sat/${encodeURIComponent(resultId ?? '')}`, { signal }).then(checkSatResultDetail),
    enabled: Boolean(resultId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useSatAttemptAnswersQuery(attemptId?: string) {
  return useQuery({
    queryKey: satResultKeys.attemptAnswers(attemptId ?? 'missing'),
    queryFn: ({ signal }) =>
      resultsGateway
        .get<unknown>(`/v1/results/sat/attempts/${encodeURIComponent(attemptId ?? '')}/answers`, { signal })
        .then(checkSatAttemptAnswers),
    enabled: Boolean(attemptId),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * The keyless print projection of a terminal attempt (docs/sat-result.md §4–5),
 * scoped like the answers read. The shape is student-delivery's
 * AssessmentAnsweredExam, which the caller names.
 */
export function fetchSatAnsweredExam<T>(attemptId: string): Promise<T> {
  return resultsGateway.get<T>(`/v1/results/sat/attempts/${encodeURIComponent(attemptId)}/answered-exam`);
}
