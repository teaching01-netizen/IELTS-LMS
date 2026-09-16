import { INGESTION_LIMITS } from "./limits";

export const SAT_IMAGE_POLICY = {
  maxBytes: INGESTION_LIMITS.fileBytes,
  maxDimension: 8_192,
  maxPixels: 25_000_000,
  maxDecodeMs: 5_000,
  maxImagesPerPaste: 5,
  maxPasteBytes: INGESTION_LIMITS.fileBytes * 5,
  allowedMime: ["image/png", "image/jpeg", "image/webp", "image/gif"],
} as const;

export type SatImageMime = (typeof SAT_IMAGE_POLICY.allowedMime)[number];

export function isAllowedSatImageMime(value: string): value is SatImageMime {
  return (SAT_IMAGE_POLICY.allowedMime as readonly string[]).includes(
    value.trim().toLowerCase()
  );
}

export type DurableImageSourceKind = "asset" | "https" | "relative";

export type DurableImageSourceValidation =
  | { ok: true; kind: DurableImageSourceKind }
  | { ok: false; code: "source" };

const UUID_ASSET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDurableImageSource(source: string): DurableImageSourceValidation {
  const value = source.trim();
  if (!value) return { ok: false, code: "source" };
  if (/^https:\/\//i.test(value)) return { ok: true, kind: "https" };
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { ok: true, kind: "relative" };
  }
  if (UUID_ASSET_ID.test(value)) return { ok: true, kind: "asset" };
  return { ok: false, code: "source" };
}
