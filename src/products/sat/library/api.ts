import { backendDelete, backendGet, backendPatch, backendPost } from "@services/backendBridge";
import type { LibraryEntry, LibraryFolder } from "./types";

interface LibraryResponse {
  folders: LibraryFolder[];
  entries: LibraryEntry[];
}

export async function fetchSatLibrary(): Promise<LibraryResponse> {
  const payload = await backendGet<LibraryResponse>("/v1/exam-library?providerKey=sat", { retries: 0 });
  return { folders: payload.folders ?? [], entries: payload.entries ?? [] };
}

export type CreateFolderInput = { name: string; parentId?: string | null; contextExamId?: string | null };

export async function createLibraryFolder(input: CreateFolderInput & { operationKey: string }): Promise<LibraryFolder> {
  return backendPost<LibraryFolder>(
    "/v1/exam-library/folders",
    {
      ...(input.name ? { name: input.name } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.contextExamId ? { contextExamId: input.contextExamId } : {}),
    },
    { headers: { "Idempotency-Key": input.operationKey } },
  );
}

export async function renameLibraryFolder(id: string, name: string, revision: number): Promise<LibraryFolder> {
  return backendPatch<LibraryFolder>(`/v1/exam-library/folders/${id}`, { name, revision });
}

export async function moveLibraryFolder(id: string, parentId: string | null, revision: number): Promise<LibraryFolder> {
  return backendPatch<LibraryFolder>(`/v1/exam-library/folders/${id}`, { parentId, revision });
}

export async function deleteLibraryFolder(id: string, revision: number): Promise<void> {
  await backendDelete(`/v1/exam-library/folders/${id}?revision=${encodeURIComponent(String(revision))}`);
}

export async function moveLibraryExams(items: Array<{ examId: string; revision: number }>, folderId: string | null): Promise<{ entries: LibraryEntry[] }> {
  return backendPost<{ entries: LibraryEntry[] }>("/v1/exam-library/move-exams", {
    items,
    folderId,
  });
}
