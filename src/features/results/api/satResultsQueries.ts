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
}

export interface SatAttemptRow extends Omit<SatResultSummary, 'id' | 'submissionId' | 'scoreKind'> {
  resultId: string | null;
  attemptId: string;
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
  response: unknown;
  correctAnswer: unknown;
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
  summary: SatResultSummary;
  scorePayload: Record<string, unknown>;
  sections: SatSectionResult[];
  questions: SatQuestionResult[];
}

export const satResultKeys = {
  all: ['sat-results'] as const,
  list: () => [...satResultKeys.all, 'list'] as const,
  attempts: (examId: string, scheduleId: string, offset: number, needle: string, scoreFilter: string) => [...satResultKeys.all, 'attempts', examId, scheduleId, offset, needle, scoreFilter] as const,
  detail: (resultId: string) => [...satResultKeys.all, 'detail', resultId] as const,
};

export function useSatResultsQuery() {
  return useQuery({
    queryKey: satResultKeys.list(),
    queryFn: () => resultsGateway.get<SatAccessGroupSummary[]>('/v1/results/sat/access-groups'),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useSatAttemptsQuery(examId?: string, scheduleId?: string, offset = 0, needle = '', scoreFilter = 'all') {
  return useQuery({
    queryKey: satResultKeys.attempts(examId ?? '', scheduleId ?? '', offset, needle, scoreFilter),
    queryFn: () => resultsGateway.get<SatAttemptPage>(`/v1/results/sat/attempts?examId=${encodeURIComponent(examId ?? '')}&scheduleId=${encodeURIComponent(scheduleId ?? '')}&limit=50&offset=${offset}&q=${encodeURIComponent(needle)}&scoreFilter=${encodeURIComponent(scoreFilter)}`),
    enabled: Boolean(examId && scheduleId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useSatResultQuery(resultId?: string) {
  return useQuery({
    queryKey: satResultKeys.detail(resultId ?? 'missing'),
    queryFn: () => resultsGateway.get<SatResultDetail>(`/v1/results/sat/${encodeURIComponent(resultId ?? '')}`),
    enabled: Boolean(resultId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}
