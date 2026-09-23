import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentAccessLinksApi } from "./assessmentAccessLinksApi";
import { accessLinkKeys } from "./accessLinkKeys";
import { authoringEffects } from "./authoringQueryEffects";
import type {
  CreateAssessmentAccessLinkRequest,
  DeleteAssessmentAccessLinkRequest,
  DuplicateAssessmentAccessLinkRequest,
  SetAccessLinkLifecycleRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../contracts/accessLinks";

export function useAccessDistributionOverview(examId: string, enabled = true) {
  return useQuery({
    queryKey: accessLinkKeys.overview(examId),
    queryFn: () => assessmentAccessLinksApi.overview(examId),
    enabled: Boolean(examId) && enabled,
    staleTime: 30_000,
    // Window-focus refetch caused request storms when switching back to a
    // tab farm; the interval poll already keeps this view fresh.
    refetchOnWindowFocus: false,
    refetchInterval: () => 30_000 + Math.floor(Math.random() * 5_000),
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
    staleTime: 15_000,
    refetchInterval: linkId ? () => 30_000 + Math.floor(Math.random() * 5_000) : false,
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

export function useCreateAccessLink(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAssessmentAccessLinkRequest) => assessmentAccessLinksApi.create(examId, request),
    onSuccess: (link) => {
      queryClient.setQueryData(accessLinkKeys.link(link.id), link);
      authoringEffects.accessChanged(queryClient, examId);
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
      authoringEffects.accessChanged(queryClient, examId, link.id);
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
      authoringEffects.accessChanged(queryClient, examId);
    },
  });
}

export function useDeleteAccessLink(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, request }: { linkId: string; request: DeleteAssessmentAccessLinkRequest }) =>
      assessmentAccessLinksApi.delete(linkId, request),
    onSuccess: (_result, { linkId }) => {
      void authoringEffects.accessDeleted(queryClient, examId, linkId);
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
      authoringEffects.accessChanged(queryClient, examId);
    },
  });
}
