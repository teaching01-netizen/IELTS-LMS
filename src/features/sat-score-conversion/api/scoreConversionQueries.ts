import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasBackendStatusCode } from "../infrastructure/scoreConversionBackendGateway";
import { shouldRetryQuery } from "../../../shared/api/queryClient";
import { scoreConversionApi } from "./scoreConversionApi";
import type { LookupRequest, SaveDraftRequest } from "../contracts/scoreConversion";

export const scoreConversionKeys = {
  all: ["sat-score-conversion"] as const,
  settings: () => [...scoreConversionKeys.all, "settings"] as const,
  revisions: () => [...scoreConversionKeys.all, "revisions"] as const,
  revision: (id: string) => [...scoreConversionKeys.all, "revision", id] as const,
};

/** 403/404 are definitive answers; retrying them only repeats the question. */
function retryTransient(failureCount: number, error: unknown): boolean {
  return !hasBackendStatusCode(error, 403) && !hasBackendStatusCode(error, 404) && shouldRetryQuery(failureCount, error);
}

export function useScoreConversionSettings() {
  return useQuery({
    queryKey: scoreConversionKeys.settings(),
    queryFn: () => scoreConversionApi.getSettings(),
    staleTime: 5_000,
    retry: retryTransient,
    // Settings carry the active pointer: refetch when the admin returns so a
    // publish by another administrator is noticed before the next save.
    refetchOnWindowFocus: true,
  });
}

export function useScoreConversionRevisions(enabled = true) {
  return useQuery({
    queryKey: scoreConversionKeys.revisions(),
    queryFn: () => scoreConversionApi.listRevisions(),
    enabled,
    staleTime: 5_000,
    retry: retryTransient,
  });
}

/** Full revision (with content). Published revisions are immutable, drafts are not. */
export function useScoreConversionRevision(id: string | null | undefined) {
  return useQuery({
    queryKey: scoreConversionKeys.revision(id ?? ""),
    queryFn: () => scoreConversionApi.getRevision(id as string),
    enabled: Boolean(id),
    staleTime: 0,
    retry: retryTransient,
  });
}

export function useCreateScoreConversionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fromRevisionId?: string) => scoreConversionApi.createDraft(fromRevisionId),
    retry: false,
    onSuccess: (draft) => {
      queryClient.setQueryData(scoreConversionKeys.revision(draft.id), draft);
      void queryClient.invalidateQueries({ queryKey: scoreConversionKeys.settings() });
    },
  });
}

export function useSaveScoreConversionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; version: number; body: SaveDraftRequest }) =>
      scoreConversionApi.saveDraft(vars.id, vars.version, vars.body),
    retry: false,
    onSuccess: (draft) => {
      queryClient.setQueryData(scoreConversionKeys.revision(draft.id), draft);
      void queryClient.invalidateQueries({ queryKey: scoreConversionKeys.settings() });
    },
  });
}

export function useValidateScoreConversionDraft() {
  return useMutation({ mutationFn: (id: string) => scoreConversionApi.validate(id), retry: false });
}

export function useScoreConversionImpact() {
  return useMutation({ mutationFn: (id: string) => scoreConversionApi.impact(id), retry: false });
}

export function useScoreConversionLookup() {
  return useMutation({ mutationFn: (body: LookupRequest) => scoreConversionApi.lookup(body), retry: false });
}

export function usePublishScoreConversionDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => scoreConversionApi.publish(id),
    retry: false,
    // Everything cached under the feature is stale after an activation.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: scoreConversionKeys.all }),
  });
}
