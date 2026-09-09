import { useQuery } from "@tanstack/react-query";
import { resultsGateway } from "../infrastructure/resultsGateway";

export type ResultProviderKey = "ielts" | "sat" | "act";
export type ResultOutcomeStatus =
  "scored" | "pending" | "invalidated_proctor" | "invalidated_timeout";

export interface AdminResultRow {
  id: string;
  submissionId: string | null;
  attemptId: string;
  providerKey: ResultProviderKey;
  outcomeStatus: ResultOutcomeStatus;
  releaseStatus: string;
  // Provider-neutral numeric fields are omitted by the Go API when no score
  // exists; keep the wire type honest so callers cannot assume JSON null.
  totalScore?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  overallBand?: number | null;
  sectionBands?: Record<string, number> | null;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  scheduleId: string;
  examId: string;
  examTitle: string;
  cohortName: string;
  institution: string | null;
  versionNumber: number;
  submittedAt: string | null;
}

export interface ResultsAnalytics {
  totalResults: number;
  releasedResults: number;
  readyToRelease: number;
  averageOverallBand: number;
}

export interface ActScienceQuestion {
  questionId: string;
  displayOrder: number;
  response: unknown;
  correctAnswer: unknown;
  /** Null verdict = unanswered or missing key. Never render null as incorrect. */
  isCorrect: boolean | null;
  answered: boolean;
}

export interface ActScienceDetail {
  attemptId: string;
  scheduleId: string;
  studentId: string;
  studentName: string;
  totalScore: number;
  maxScore: number;
  percentage: number;
  outcomeStatus: string;
  releaseStatus: string;
  submittedAt?: string | null | undefined;
  questions: ActScienceQuestion[];
}

export const resultKeys = {
  all: ["results"] as const,
  dashboard: (provider: ResultProviderKey | "all" = "all") =>
    [...resultKeys.all, "dashboard", provider] as const,
  analytics: () => [...resultKeys.all, "analytics"] as const,
  actDetail: (attemptId: string) =>
    [...resultKeys.all, "act", "detail", attemptId] as const,
};

export function useAdminResultsQuery(provider: ResultProviderKey | "all" = "all") {
  const queryString = provider === "all" ? "" : `?provider=${encodeURIComponent(provider)}`;
  return useQuery({
    queryKey: resultKeys.dashboard(provider),
    queryFn: () => resultsGateway.get<AdminResultRow[]>(`/v1/results/dashboard${queryString}`),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });
}

export function useActScienceDetailQuery(attemptId?: string | null) {
  return useQuery({
    queryKey: resultKeys.actDetail(attemptId ?? "missing"),
    queryFn: () =>
      resultsGateway.get<ActScienceDetail>(
        `/v1/results/act-science/${encodeURIComponent(attemptId ?? "")}`,
      ),
    enabled: Boolean(attemptId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useResultsAnalyticsQuery() {
  return useQuery({
    queryKey: resultKeys.analytics(),
    queryFn: () => resultsGateway.get<ResultsAnalytics>("/v1/results/analytics"),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });
}
