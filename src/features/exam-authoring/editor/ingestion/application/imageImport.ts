import {
  getAssessmentMediaAsset,
  importAssessmentImageUrl,
  type AssessmentMediaAsset,
} from "../../../api/assessmentMediaApi";
import { validateDurableImageSource } from "../domain/imagePolicy";

export type ImageSourceErrorCode = "source" | "import";

export class ImageSourceError extends Error {
  readonly code: ImageSourceErrorCode;

  constructor(code: ImageSourceErrorCode, message: string) {
    super(message);
    this.name = "ImageSourceError";
    this.code = code;
  }
}

export interface ImageImportDeps {
  getAsset?: (assetId: string) => Promise<AssessmentMediaAsset>;
  importUrl?: (url: string, ownerId: string) => Promise<AssessmentMediaAsset>;
}

export interface ImportImageSourceRequest {
  source: string;
  ownerId: string;
  deps?: ImageImportDeps;
}

const SOURCE_MESSAGE = "Use an existing asset ID or an HTTPS image URL.";

export async function importImageSource({
  source,
  ownerId,
  deps,
}: ImportImageSourceRequest): Promise<AssessmentMediaAsset> {
  const value = source.trim();
  const validation = validateDurableImageSource(value);
  if (!validation.ok) throw new ImageSourceError("source", SOURCE_MESSAGE);

  if (validation.kind === "asset") {
    try {
      return await (deps?.getAsset ?? getAssessmentMediaAsset)(value);
    } catch (error) {
      if (error instanceof ImageSourceError) throw error;
      throw new ImageSourceError(
        "import",
        error instanceof Error ? error.message : "The image asset could not be loaded."
      );
    }
  }

  if (validation.kind !== "https" || !ownerId.trim()) {
    throw new ImageSourceError("source", SOURCE_MESSAGE);
  }

  try {
    return await (deps?.importUrl ?? importAssessmentImageUrl)(value, ownerId.trim());
  } catch (error) {
    if (error instanceof ImageSourceError) throw error;
    throw new ImageSourceError(
      "import",
      error instanceof Error ? error.message : "The remote image could not be imported."
    );
  }
}
