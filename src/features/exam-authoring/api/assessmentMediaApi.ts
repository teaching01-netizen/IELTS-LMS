import { backendGet, backendPost } from "../infrastructure/examAuthoringBackendGateway";
import { apiClient } from "../../../shared/api/apiClient";

export interface AssessmentMediaAsset {
  id: string;
  contentType: string;
  fileName: string;
  uploadStatus: string;
  downloadUrl: string | null;
}

const mediaAssetCache = new Map<string, Promise<AssessmentMediaAsset>>();

interface UploadIntent {
  asset: AssessmentMediaAsset;
  uploadUrl: string;
  headers: Record<string, string>;
}

function isSameOriginUrl(rawUrl: string): boolean {
  if (typeof window === "undefined") return rawUrl.startsWith("/");
  try {
    return new URL(rawUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadImageAsset(
  file: File,
  ownerKind: "assessment_question" | "assessment_import",
  ownerId: string
): Promise<AssessmentMediaAsset> {
  if (!file.type.startsWith("image/")) throw new Error("Only image files can be inserted here.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");

  const checksumSha256 = await sha256(file);
  if (!checksumSha256) {
    throw new Error("Secure browser cryptography is required for image uploads.");
  }
  const intent = await backendPost<UploadIntent>("/v1/media/uploads", {
    ownerKind,
    ownerId,
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
    checksumSha256,
  });
  const uploadHeaders = { ...intent.headers };
  const csrfToken = apiClient.getCsrfToken();
  if (csrfToken && isSameOriginUrl(intent.uploadUrl)) {
    uploadHeaders["x-csrf-token"] = csrfToken;
  }
  const upload = await fetch(intent.uploadUrl, {
    method: "PUT",
    credentials: "same-origin",
    headers: uploadHeaders,
    body: file,
  });
  if (!upload.ok) throw new Error(`Image upload failed (${upload.status}).`);

  return backendPost<AssessmentMediaAsset>(`/v1/media/uploads/${intent.asset.id}/complete`, {
    sizeBytes: file.size,
    checksumSha256,
  });
}

export function getAssessmentMediaAsset(assetId: string): Promise<AssessmentMediaAsset> {
  const cached = mediaAssetCache.get(assetId);
  if (cached) return cached;

  const request = backendGet<AssessmentMediaAsset>(
    `/v1/media/${encodeURIComponent(assetId)}`
  ).catch((error: unknown) => {
    mediaAssetCache.delete(assetId);
    throw error;
  });
  mediaAssetCache.set(assetId, request);
  return request;
}

export function uploadAssessmentAsset(
  file: File,
  ownerId: string
): Promise<AssessmentMediaAsset> {
  return uploadImageAsset(file, "assessment_question", ownerId);
}

export function uploadAssessmentImportAsset(
  file: File,
  importId: string
): Promise<AssessmentMediaAsset> {
  return uploadImageAsset(file, "assessment_import", importId);
}
