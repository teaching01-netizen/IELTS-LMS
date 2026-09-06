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

export const resultKeys = {
  all: ["results"] as const,
  dashboard: (provider: ResultProviderKey | "all" = "all") =>
    [...resultKeys.all, "dashboard", provider] as const,
  analytics: () => [...resultKeys.all, "analytics"] as const,
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

export function useResultsAnalyticsQuery() {
  return useQuery({
    queryKey: resultKeys.analytics(),
    queryFn: () => resultsGateway.get<ResultsAnalytics>("/v1/results/analytics"),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });
}
