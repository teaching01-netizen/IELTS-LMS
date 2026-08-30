import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentAccessLinksApi } from "./assessmentAccessLinksApi";
import { assessmentKeys } from "./assessmentQueries";
import type {
  CreateAssessmentAccessLinkRequest,
  DuplicateAssessmentAccessLinkRequest,
  SetAccessLinkLifecycleRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../contracts/accessLinks";

export const accessLinkKeys = {
  root: ["assessment-access-links"] as const,
  overview: (examId: string) => [...accessLinkKeys.root, "overview", examId] as const,
  link: (linkId: string) => [...accessLinkKeys.root, "link", linkId] as const,
  members: (linkId: string) => [...accessLinkKeys.root, "members", linkId] as const,
  activity: (linkId: string) => [...accessLinkKeys.root, "activity", linkId] as const,
  public: (linkId: string) => [...accessLinkKeys.root, "public", linkId] as const,
};

export function useAccessDistributionOverview(examId: string, enabled = true) {
  return useQuery({
    queryKey: accessLinkKeys.overview(examId),
    queryFn: () => assessmentAccessLinksApi.overview(examId),
    enabled: Boolean(examId) && enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
}

export function useAccessLinkMembers(linkId: string | null) {
  return useQuery({
    queryKey: accessLinkKeys.members(linkId ?? "missing"),
    queryFn: () => assessmentAccessLinksApi.members(linkId ?? ""),
    enabled: Boolean(linkId),
    staleTime: 30_000,
  });
}

export function useAccessLinkActivity(linkId: string | null) {
  return useQuery({
    queryKey: accessLinkKeys.activity(linkId ?? "missing"),
    queryFn: () => assessmentAccessLinksApi.activity(linkId ?? ""),
    enabled: Boolean(linkId),
    staleTime: 5_000,
    refetchInterval: linkId ? 15_000 : false,
  });
}

export function usePublicAccessLink(linkId: string) {
  return useQuery({
    queryKey: accessLinkKeys.public(linkId),
    queryFn: () => assessmentAccessLinksApi.publicLink(linkId),
    enabled: Boolean(linkId),
    staleTime: 15_000,
    retry: false,
  });
}

function invalidateOverview(queryClient: ReturnType<typeof useQueryClient>, examId: string) {
  void queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) });
  void queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) });
}

export function useCreateAccessLink(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAssessmentAccessLinkRequest) => assessmentAccessLinksApi.create(examId, request),
    onSuccess: (link) => {
      queryClient.setQueryData(accessLinkKeys.link(link.id), link);
      invalidateOverview(queryClient, examId);
    },
  });
}

export function useUpdateAccessLink(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, request }: { linkId: string; request: UpdateAssessmentAccessLinkRequest }) =>
      assessmentAccessLinksApi.update(linkId, request),
    onSuccess: (link) => {
      queryClient.setQueryData(accessLinkKeys.link(link.id), link);
      void queryClient.invalidateQueries({ queryKey: accessLinkKeys.members(link.id) });
      invalidateOverview(queryClient, examId);
    },
  });
}

export function useSetAccessLinkLifecycle(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, request }: { linkId: string; request: SetAccessLinkLifecycleRequest }) =>
      assessmentAccessLinksApi.setLifecycle(linkId, request),
    onSuccess: (link) => {
      queryClient.setQueryData(accessLinkKeys.link(link.id), link);
      invalidateOverview(queryClient, examId);
    },
  });
}

export function useDuplicateAccessLink(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, request }: { linkId: string; request: DuplicateAssessmentAccessLinkRequest }) =>
      assessmentAccessLinksApi.duplicate(linkId, request),
    onSuccess: (link) => {
      queryClient.setQueryData(accessLinkKeys.link(link.id), link);
      invalidateOverview(queryClient, examId);
    },
  });
}
