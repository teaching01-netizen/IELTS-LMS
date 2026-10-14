import { useQuery } from "@tanstack/react-query";
import { backendGet } from "../infrastructure/examAuthoringBackendGateway";
import type { SatConfigDefaults } from "../contracts/satExamConfig";

export const satExamConfigApi = {
  /** Blueprint-derived defaults and limits; the form never hardcodes either. */
  defaults(): Promise<SatConfigDefaults> {
    return backendGet<SatConfigDefaults>("/v1/sat/exam-config/defaults");
  },
};

export function useSatExamConfigDefaults(enabled = true) {
  return useQuery({
    queryKey: ["sat", "exam-config", "defaults"] as const,
    queryFn: () => satExamConfigApi.defaults(),
    enabled,
    // Defaults are stable, but the response also carries a runtime capability.
    staleTime: 60 * 60 * 1000,
    // Room creation mounts this query when its form opens, so a rollout change
    // is reflected without waiting for the cached blueprint defaults to expire.
    refetchOnMount: "always",
  });
}
