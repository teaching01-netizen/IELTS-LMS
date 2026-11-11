import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { examKeys } from "../../../features/exam-authoring/api/examQueries";
import { createLibraryFolder, deleteLibraryFolder, fetchSatLibrary, moveLibraryExams, moveLibraryFolder, renameLibraryFolder, type CreateFolderInput } from "./api";
import { entryMap } from "./types";

export const libraryKeys = {
  all: [...examKeys.all, "library", "sat"] as const,
};

export function useSatLibraryQuery(enabled = true) {
  return useQuery({
    queryKey: libraryKeys.all,
    queryFn: async () => {
      const payload = await fetchSatLibrary();
      return { folders: payload.folders, entries: payload.entries, byExam: entryMap(payload.entries) };
    },
    enabled,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}

function invalidateLibrary(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: examKeys.all });
}

export function useCreateFolderMutation() {
  const queryClient = useQueryClient();
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (input: CreateFolderInput) => {
      const fingerprint = JSON.stringify([input.name.trim(), input.parentId ?? null, input.contextExamId ?? null]);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      }
      return createLibraryFolder({ ...input, operationKey: attempt.current.key });
    },
    onSuccess: () => { attempt.current = null; },
    onSettled: () => invalidateLibrary(queryClient),
  });
  return {
    ...mutation,
    reset: () => {
      attempt.current = null;
      mutation.reset();
    },
  };
}

export function useRenameFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string; revision: number }) => renameLibraryFolder(input.id, input.name, input.revision),
    onSettled: () => invalidateLibrary(queryClient),
  });
}

export function useMoveFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; parentId: string | null; revision: number }) => moveLibraryFolder(input.id, input.parentId, input.revision),
    onSettled: () => invalidateLibrary(queryClient),
  });
}

export function useDeleteFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; revision: number }) => deleteLibraryFolder(input.id, input.revision),
    onSettled: () => invalidateLibrary(queryClient),
  });
}

export function useMoveExamsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { items: Array<{ examId: string; revision: number }>; folderId: string | null }) =>
      moveLibraryExams(input.items, input.folderId),
    onSettled: () => invalidateLibrary(queryClient),
  });
}
