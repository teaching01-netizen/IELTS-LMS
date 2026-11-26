import type { WordVaultEntry } from "@shared/sat/wordVault";
import { backendGet, backendPost } from "../infrastructure/examAuthoringBackendGateway";

export interface WordVaultStatus {
  draftId: string;
  draftCount: number;
  publishedCount: number;
  staleCount: number;
}

export interface WordVaultPreview {
  draftId: string;
  revision: number;
  digest: string;
  before: number;
  entries: WordVaultEntry[];
  impact: Array<{ module: string; before: number; after: number }>;
  issues: Array<{ row: number; column: string; message: string }>;
}

interface WordVaultReceipt {
  draftId: string;
  revision: number;
  count: number;
}

function path(examId: string) {
  return `/v1/assessment-authoring/exams/${encodeURIComponent(examId)}/sat-word-vault`;
}

export const wordVaultApi = {
  status(examId: string) {
    return backendGet<WordVaultStatus>(path(examId));
  },
  async template(examId: string) {
    const response = await fetch(`/api${path(examId)}/template`, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Couldn’t download the vocabulary template. Try again.");
    return response.blob();
  },
  preview(examId: string, file: File) {
    const form = new FormData();
    form.set("file", file);
    return backendPost<WordVaultPreview, FormData>(`${path(examId)}/preview`, form, { retries: 0, timeout: 45_000 });
  },
  commit(examId: string, file: File, preview: WordVaultPreview, operationKey: string) {
    const form = new FormData();
    form.set("file", file);
    form.set("commit", JSON.stringify({
      draftId: preview.draftId,
      revision: preview.revision,
      digest: preview.digest,
      confirmed: true,
      operationKey,
    }));
    return backendPost<WordVaultReceipt, FormData>(`${path(examId)}/commit`, form, { retries: 0, timeout: 45_000 });
  },
};
