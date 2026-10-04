import { backendPost } from "./backendBridge";
import { apiClient } from "../shared/api/apiClient";

async function computeSha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure browser cryptography is required for image uploads.");
  }
  // Copy into a local Uint8Array so WebCrypto implementations with strict
  // BufferSource checks (including Node 20 in the jsdom test environment) do
  // not receive an ArrayBuffer created by another realm.
  const fileBytes = new Uint8Array(await readFileBytes(file));
  const digestBytes = new Uint8Array(fileBytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestBytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  if (typeof FileReader === "undefined") throw new Error("This browser cannot read the selected image.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error("Unable to read the selected image."));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsArrayBuffer(file);
  });
}

export const ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES = 1800 * 1024;
export const ACT_SCIENCE_CHOICE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type ActScienceChoiceImageType = (typeof ACT_SCIENCE_CHOICE_IMAGE_TYPES)[number];

interface MediaUploadIntent {
  asset: {
    id: string;
    downloadUrl?: string | null | undefined;
  };
  uploadUrl: string;
  headers?: Record<string, string> | undefined;
}

interface CompletedMediaAsset {
  downloadUrl?: string | null | undefined;
}

function isSameOriginUrl(rawUrl: string): boolean {
  if (typeof window === "undefined") return rawUrl.startsWith("/");
  try {
    return new URL(rawUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function isSupportedImageType(contentType: string): contentType is ActScienceChoiceImageType {
  return (ACT_SCIENCE_CHOICE_IMAGE_TYPES as readonly string[]).includes(contentType);
}

function validateActScienceImage(file: File): void {
  if (!isSupportedImageType(file.type)) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }
}

interface DecodedActScienceImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function decodeActScienceImage(file: File): Promise<DecodedActScienceImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" }).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }));
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("This browser cannot resize the image automatically.");
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  return new Promise<DecodedActScienceImage>((resolve, reject) => {
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        release: () => URL.revokeObjectURL(objectUrl),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read this image for automatic resizing."));
    };
    image.src = objectUrl;
  });
}

async function readJpegExifOrientation(file: File): Promise<number> {
  if (file.type.toLowerCase() !== "image/jpeg") return 1;

  const bytes = new Uint8Array(await readFileBytes(file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = view.getUint16(offset + 2, false);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;

    if (
      marker === 0xe1 &&
      segmentStart + 16 <= segmentEnd &&
      bytes[segmentStart] === 0x45 &&
      bytes[segmentStart + 1] === 0x78 &&
      bytes[segmentStart + 2] === 0x69 &&
      bytes[segmentStart + 3] === 0x66 &&
      bytes[segmentStart + 4] === 0 &&
      bytes[segmentStart + 5] === 0
    ) {
      const tiffStart = segmentStart + 6;
      const byteOrder = String.fromCharCode(bytes[tiffStart] ?? 0, bytes[tiffStart + 1] ?? 0);
      const littleEndian = byteOrder === "II";
      if (!littleEndian && byteOrder !== "MM") return 1;
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return 1;

      const directoryStart = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
      if (directoryStart + 2 > segmentEnd) return 1;
      const entryCount = view.getUint16(directoryStart, littleEndian);
      for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
        const entryStart = directoryStart + 2 + entryIndex * 12;
        if (entryStart + 12 > segmentEnd) break;
        if (view.getUint16(entryStart, littleEndian) !== 0x0112) continue;
        if (
          view.getUint16(entryStart + 2, littleEndian) !== 3 ||
          view.getUint32(entryStart + 4, littleEndian) !== 1
        ) return 1;
        const orientation = view.getUint16(entryStart + 8, littleEndian);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
      return 1;
    }

    if (segmentLength < 2 || segmentEnd > bytes.length) break;
    offset = segmentEnd;
  }

  return 1;
}

async function normalizeJpegExifOrientation(file: File): Promise<File> {
  const decoded = await decodeActScienceImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot correct the image orientation automatically.");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    context.drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.94);
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    decoded.release();
  }
}

export async function rotateImageFile(
  file: File,
  direction: "left" | "right",
): Promise<File> {
  validateActScienceImage(file);
  const decoded = await decodeActScienceImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot rotate the image automatically.");
    canvas.width = decoded.height;
    canvas.height = decoded.width;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((direction === "right" ? 1 : -1) * Math.PI / 2);
    context.drawImage(decoded.source, -decoded.width / 2, -decoded.height / 2);
    const blob = await canvasToBlob(canvas, file.type, file.type === "image/jpeg" ? 0.94 : undefined);
    return new File([blob], file.name, { type: blob.type || file.type, lastModified: file.lastModified });
  } finally {
    decoded.release();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to encode this image for upload."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function readUploadFailureDetail(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    if (!body.trim()) {
      return null;
    }

    try {
      const payload = JSON.parse(body) as {
        message?: unknown;
        error?: { message?: unknown } | unknown;
      };
      if (typeof payload.message === "string" && payload.message.trim()) {
        return payload.message.trim();
      }
      if (
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error &&
        typeof payload.error.message === "string" &&
        payload.error.message.trim()
      ) {
        return payload.error.message.trim();
      }
    } catch {
      // Keep the status-only fallback for non-JSON error responses.
    }
  } catch {
    // Keep the status-only fallback when the response body cannot be read.
  }

  return null;
}

async function resizeActScienceImage(file: File, maxBytes = ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES): Promise<File> {
  const decoded = await decodeActScienceImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser cannot resize the image automatically.");
    }

    const initialScale = Math.min(
      1,
      Math.sqrt(maxBytes / Math.max(file.size, 1))
    );
    let width = Math.max(1, Math.round(decoded.width * initialScale));
    let height = Math.max(1, Math.round(decoded.height * initialScale));
    const outputTypes = Array.from(
      new Set([file.type, ...(file.type === "image/png" ? ["image/webp", "image/jpeg"] : [])])
    );
    const qualityLevels = [0.9, 0.8, 0.7, 0.6, 0.5];

    for (let attempt = 0; attempt < 8; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);

      for (const outputType of outputTypes) {
        for (const quality of qualityLevels) {
          const blob = await canvasToBlob(canvas, outputType, quality);
          if (blob.size <= maxBytes) {
            return new File([blob], file.name, {
              type: blob.type || outputType,
              lastModified: file.lastModified,
            });
          }
        }
      }

      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }

    throw new Error("Unable to resize this image below the upload limit.");
  } finally {
    decoded.release();
  }
}

export async function prepareActScienceImage(file: File): Promise<File> {
  validateActScienceImage(file);
  return file.size <= ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES ? file : resizeActScienceImage(file);
}

export async function prepareActSciencePassageImage(
  file: File,
  normalizeExifOrientation = false,
): Promise<File> {
  validateActScienceImage(file);
  const orientation = normalizeExifOrientation ? await readJpegExifOrientation(file) : 1;
  const orientedFile = orientation === 1 ? file : await normalizeJpegExifOrientation(file);
  return orientedFile.size <= ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES
    ? orientedFile
    : resizeActScienceImage(orientedFile, ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES);
}

export async function uploadActScienceImage(
  file: File,
  ownerKind: "act_science_choice" | "act_science_question" | "assessment_exam",
  ownerId: string,
  maxBytes = ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES,
  normalizeExifOrientation = false,
): Promise<string> {
  const preparedFile = maxBytes === ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES
    ? await prepareActSciencePassageImage(file, normalizeExifOrientation)
    : await prepareActScienceImage(file);
  const checksumSha256 = await computeSha256(preparedFile);

  const intent = await backendPost<MediaUploadIntent>("/v1/media/uploads", {
    ownerKind,
    ownerId,
    contentType: preparedFile.type,
    fileName: preparedFile.name,
    sizeBytes: preparedFile.size,
    checksumSha256,
  });

  const uploadHeaders = { ...(intent.headers ?? {}) };
  const csrfToken = apiClient.getCsrfToken();
  if (csrfToken && isSameOriginUrl(intent.uploadUrl)) {
    uploadHeaders["x-csrf-token"] = csrfToken;
  }
  const uploadRequest: RequestInit = {
    method: "PUT",
    credentials: "same-origin",
    body: preparedFile,
  };
  if (Object.keys(uploadHeaders).length > 0) {
    uploadRequest.headers = uploadHeaders;
  }

  const uploadResponse = await fetch(intent.uploadUrl, uploadRequest);

  if (!uploadResponse.ok) {
    const detail = await readUploadFailureDetail(uploadResponse);
    throw new Error(
      `Image upload failed with status ${uploadResponse.status}${detail ? `: ${detail}` : "."}`
    );
  }

  const completedAsset = await backendPost<CompletedMediaAsset>(
    `/v1/media/uploads/${encodeURIComponent(intent.asset.id)}/complete`,
    {
      sizeBytes: preparedFile.size,
      checksumSha256,
    }
  );
  const downloadUrl = completedAsset.downloadUrl ?? intent.asset.downloadUrl;

  if (!downloadUrl) {
    throw new Error("Image upload completed without a download URL.");
  }

  return downloadUrl;
}

export function uploadActScienceChoiceImage(file: File, ownerId: string): Promise<string> {
  return uploadActScienceImage(file, "act_science_choice", ownerId);
}

export function uploadActScienceQuestionImage(file: File, ownerId: string): Promise<string> {
  return uploadActScienceImage(file, "act_science_question", ownerId);
}

export function uploadAssessmentPassageImage(file: File, examId: string): Promise<string> {
  return uploadActScienceImage(
    file,
    "assessment_exam",
    examId,
    ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES,
  );
}

export function uploadActScienceStimulusImage(file: File, examId: string): Promise<string> {
  return uploadActScienceImage(
    file,
    "assessment_exam",
    examId,
    ACT_SCIENCE_PASSAGE_IMAGE_MAX_BYTES,
    true,
  );
}
