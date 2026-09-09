import { backendPost } from "./backendBridge";

export const ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
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
    return createImageBitmap(file).then((bitmap) => ({
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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
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

async function resizeActScienceImage(file: File): Promise<File> {
  const decoded = await decodeActScienceImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("This browser cannot resize the image automatically.");
    }

    const initialScale = Math.min(
      1,
      Math.sqrt(ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES / Math.max(file.size, 1))
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
          if (blob.size <= ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES) {
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

    throw new Error("Unable to resize this image below the 5 MB upload limit.");
  } finally {
    decoded.release();
  }
}

export async function prepareActScienceImage(file: File): Promise<File> {
  validateActScienceImage(file);
  return file.size <= ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES ? file : resizeActScienceImage(file);
}

export async function uploadActScienceImage(
  file: File,
  ownerKind: "act_science_choice" | "act_science_question",
  ownerId: string
): Promise<string> {
  const preparedFile = await prepareActScienceImage(file);

  const intent = await backendPost<MediaUploadIntent>("/v1/media/uploads", {
    ownerKind,
    ownerId,
    contentType: preparedFile.type,
    fileName: preparedFile.name,
  });

  const uploadRequest: RequestInit = {
    method: "PUT",
    body: preparedFile,
  };
  if (intent.headers) {
    uploadRequest.headers = intent.headers;
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
