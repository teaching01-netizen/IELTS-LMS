import { backendPost } from "../infrastructure/examAuthoringBackendGateway";

export interface AssessmentMediaAsset {
  id: string;
  contentType: string;
  fileName: string;
  uploadStatus: string;
  downloadUrl: string | null;
}

interface UploadIntent {
  asset: AssessmentMediaAsset;
  uploadUrl: string;
  headers: Record<string, string>;
}

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadAssessmentAsset(
  file: File,
  ownerId: string
): Promise<AssessmentMediaAsset> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files can be inserted here.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");

  const intent = await backendPost<UploadIntent>("/v1/media/uploads", {
    ownerKind: "assessment_question",
    ownerId,
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
  });
  const upload = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: intent.headers,
    body: file,
  });
  if (!upload.ok) throw new Error(`Image upload failed (${upload.status}).`);

  return backendPost<AssessmentMediaAsset>(`/v1/media/uploads/${intent.asset.id}/complete`, {
    sizeBytes: file.size,
    checksumSha256: await sha256(file),
  });
}
