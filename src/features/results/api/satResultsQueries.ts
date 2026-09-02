import { useQuery } from '@tanstack/react-query';
import { resultsGateway } from '../infrastructure/resultsGateway';

export type SatAssessmentRoute = 'lower' | 'higher';
export type SatResultOutcomeStatus = 'scored' | 'pending' | 'invalidated_proctor' | 'invalidated_timeout';

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
  submittedAt: string;
  totalScore: number | null;
  scoreKind: 'practice';
  releaseStatus: string;
}

export interface SatSectionResult {
  sectionKey: string;
  route: SatAssessmentRoute | null;
  rawCorrect: number;
  operationalQuestionCount: number;
  scaledScore: number | null;
  details: Record<string, unknown>;
}

export interface SatResultDetail {
  summary: SatResultSummary;
  scorePayload: Record<string, unknown>;
  sections: SatSectionResult[];
}

export const satResultKeys = {
  all: ['sat-results'] as const,
  list: () => [...satResultKeys.all, 'list'] as const,
  detail: (resultId: string) => [...satResultKeys.all, 'detail', resultId] as const,
};

export function useSatResultsQuery() {
  return useQuery({
    queryKey: satResultKeys.list(),
    queryFn: () => resultsGateway.get<SatResultSummary[]>('/v1/results/sat'),
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
