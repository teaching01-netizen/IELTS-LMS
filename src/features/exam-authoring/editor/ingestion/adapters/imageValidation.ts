/**
 * Phase 06 — clipboard image validation (PURE).
 *
 * Split-surface rule: this module lives inside the ingestion boundary, so it
 * imports no React, no TipTap/ProseMirror, no KaTeX/MathLive, and touches no
 * host globals on import. Browser file/bitmap/URL access arrives ONLY through
 * injected loaders passed as arguments, which keeps unit tests deterministic
 * and keeps this module import-safe in node.
 *
 * Binding rulings honored here:
 * - allowBase64:false invariant: NEVER persist blob:/data: URLs. Temp
 *   uploading nodes carry an objectURL only transiently; stripTransientImages
 *   is the serialize guard that removes them before persist.
 * - Client validation first (MIME + magic bytes, size, dimensions,
 *   pixel/decompression-bomb caps). The backend media policy stays
 *   authoritative; this mirror only fails fast.
 * - Alt text is NOT fabricated here: temp nodes ship alt '' and the existing
 *   sat.accessibility.alt.required validator owns the publish gate.
 */
import type { RichTextDocument, RichTextNode } from "../../../contracts/assessment";
import { SAT_IMAGE_POLICY, isAllowedSatImageMime } from "../domain/imagePolicy";

export const IMAGE_CAPS = {
  maxBytes: SAT_IMAGE_POLICY.maxBytes,
  allowedMime: SAT_IMAGE_POLICY.allowedMime,
  maxDimension: SAT_IMAGE_POLICY.maxDimension,
  maxPixels: SAT_IMAGE_POLICY.maxPixels,
  bitmapTimeoutMs: SAT_IMAGE_POLICY.maxDecodeMs,
} as const;

export type AllowedImageMime = (typeof IMAGE_CAPS.allowedMime)[number];

export type ImageRejectCode = "type" | "magic" | "size" | "dimensions" | "pixels" | "decode";

export type ImageValidation =
  | { ok: true; file: File; mime: string; width: number; height: number; pixels: number }
  | { ok: false; code: ImageRejectCode; message: string };

export const IMAGE_REJECT_MESSAGES: Record<ImageRejectCode, string> = {
  type: "That file is not a supported image (PNG, JPEG, WebP, GIF).",
  magic: "That file is not a supported image (PNG, JPEG, WebP, GIF).",
  size: "Images must be 10 MiB or smaller.",
  dimensions: "That image is too large to paste (limit 8,192 px per side, 25 megapixels).",
  pixels: "That image is too large to paste (limit 8,192 px per side, 25 megapixels).",
  decode: "That image could not be read. Try re-exporting it.",
};

export type BitmapLoader = ((file: File) => Promise<{
  width: number;
  height: number;
  close?: () => void;
}>) & {
  cancel?: () => void;
};

export type BitmapLoaderFactory = () => BitmapLoader | null;

function isAllowedMime(mime: string): mime is AllowedImageMime {
  return isAllowedSatImageMime(mime);
}

/**
 * Read the first 12 bytes of a file as lowercase hex. Prefers slice +
 * arrayBuffer, falls back to FileReader (jsdom exposes neither text() nor
 * arrayBuffer() on Blob, but FileReader.readAsArrayBuffer works). Resolves
 * to "" when the file cannot be read, letting the caller degrade to a magic
 * reject instead of throwing.
 */
export async function readMagicBytes(file: File): Promise<string> {
  const toHex = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer).slice(0, 12);
    let hex = "";
    for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
    return hex.toLowerCase();
  };
  try {
    const head = file.slice(0, 12) as Blob & {
      arrayBuffer?: () => Promise<ArrayBuffer>;
    };
    if (typeof head.arrayBuffer === "function") {
      return toHex(await head.arrayBuffer());
    }
  } catch {
    return "";
  }
  try {
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsArrayBuffer(file.slice(0, 12));
    });
    return toHex(buffer);
  } catch {
    return "";
  }
}

type MagicFamily = "png" | "jpeg" | "gif" | "webp" | null;

function magicFamily(hex: string): MagicFamily {
  if (hex.startsWith("89504e470d0a1a0a")) return "png";
  if (hex.startsWith("ffd8ff")) return "jpeg";
  if (hex.startsWith("47494638")) return "gif";
  // WEBP: RIFF....WEBP — "52494646" + 4 arbitrary bytes + "57454250".
  if (hex.length >= 24 && hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") {
    return "webp";
  }
  return null;
}

function expectedFamily(mime: string): MagicFamily {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return null;
}

function fail(code: ImageRejectCode): ImageValidation {
  return { ok: false, code, message: IMAGE_REJECT_MESSAGES[code] };
}

interface BitmapSize {
  width: number;
  height: number;
}

/**
 * Race the loader against a timeout. Returns null on throw, timeout, or
 * non-finite/non-positive dimensions. Always closes the bitmap when a close
 * handle is provided. Never throws. timeoutMs is injectable for tests.
 */
export async function loadBitmapSize(
  file: File,
  loader: BitmapLoader | null | undefined,
  timeoutMs: number = IMAGE_CAPS.bitmapTimeoutMs
): Promise<BitmapSize | null> {
  if (!loader) return null;
  let bitmap: { width: number; height: number; close?: () => void } | null = null;
  let finished = false;
  let timedOut = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeBitmap = (candidate: { close?: () => void } | null): void => {
    if (!candidate || closed) return;
    closed = true;
    try {
      candidate.close?.();
    } catch {
      // Bitmap cleanup must never break validation.
    }
  };
  try {
    // Promise.resolve().then() also converts a synchronous loader throw into a
    // settled promise, so late cleanup follows one path for every loader.
    const pending = Promise.resolve().then(() => loader(file));
    const settledPending = pending.then(
      (value) => {
        // A decoder can resolve after the timeout has already returned. The
        // timeout path cannot retain the bitmap, so close it at settlement.
        if (finished) closeBitmap(value);
        return { status: "loaded" as const, value };
      },
      () => ({ status: "failed" as const, value: null })
    );
    const result = await Promise.race([
      settledPending,
      new Promise<{ status: "timeout"; value: null }>((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout", value: null }), timeoutMs);
        if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
          (timer as unknown as { unref: () => void }).unref();
        }
      }),
    ]);
    if (result.status === "timeout") {
      timedOut = true;
      return null;
    }
    if (result.status !== "loaded" || !result.value) return null;
    bitmap = result.value;
    const { width, height } = bitmap;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  } finally {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) {
      try {
        loader.cancel?.();
      } catch {
        // Decoder cancellation is best-effort; late settlement still closes.
      }
    }
    closeBitmap(bitmap);
  }
}

/**
 * Default bitmap loader factory. Reads createImageBitmap off globalThis at
 * CALL time (never at import time). When createImageBitmap is unavailable,
 * fall back to an HTMLImageElement decode path so real browsers can still
 * accept ordinary clipboard images. Returns null only when no browser decoder
 * is available.
 */
export function defaultBitmapLoaderFactory(): BitmapLoader | null {
  const candidate = (globalThis as unknown as Record<string, unknown>)["createImageBitmap"];
  if (typeof candidate === "function") {
    const createBitmap = candidate as (file: File) => Promise<{
      width: number;
      height: number;
      close?: () => void;
    }>;
    return (file: File) => createBitmap(file);
  }

  const ImageCtor = (globalThis as unknown as Record<string, unknown>)["Image"];
  const createUrl = (globalThis as unknown as Record<string, unknown>)["URL"];
  if (typeof ImageCtor !== "function" || typeof createUrl !== "object" || createUrl === null) {
    return null;
  }
  const createObjectURL = (createUrl as { createObjectURL?: unknown }).createObjectURL;
  const revokeObjectURL = (createUrl as { revokeObjectURL?: unknown }).revokeObjectURL;
  if (typeof createObjectURL !== "function" || typeof revokeObjectURL !== "function") return null;
  const ImageClass = ImageCtor as new () => {
    src: string;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  };
  const makeUrl = createObjectURL as (file: File) => string;
  const revokeUrl = revokeObjectURL as (url: string) => void;
  const activeCleanups = new Set<() => void>();
  const loader = ((file: File) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new ImageClass();
      const url = makeUrl(file);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        activeCleanups.delete(release);
        revokeUrl(url);
      };
      activeCleanups.add(release);
      image.onload = () => {
        release();
        resolve({
          width: image.naturalWidth ?? image.width,
          height: image.naturalHeight ?? image.height,
        });
      };
      image.onerror = () => {
        release();
        reject(new Error("image decode failed"));
      };
      image.src = url;
    })) as BitmapLoader;
  loader.cancel = (): void => {
    for (const release of [...activeCleanups]) release();
  };
  return loader;
}

export interface ValidateSatImageFileOptions {
  loader?: BitmapLoader | null | undefined;
  loaderFactory?: BitmapLoaderFactory | undefined;
  timeoutMs?: number | undefined;
}

/** Temporary compatibility name for callers that still describe the source as clipboard-only. */
export type ValidateClipboardImageOptions = ValidateSatImageFileOptions;

/**
 * Synchronously-gated, never-throwing SAT image file validation.
 * Order: MIME allowlist -> size -> magic bytes (family must match MIME) ->
 * dimensions via injected BitmapLoader -> dimension + pixel caps.
 */
export async function validateSatImageFile(
  file: File,
  loaderOrOptions?: BitmapLoader | null | ValidateSatImageFileOptions
): Promise<ImageValidation> {
  try {
    const options: ValidateSatImageFileOptions =
      typeof loaderOrOptions === "function" || loaderOrOptions == null
        ? { loader: (loaderOrOptions as BitmapLoader | null | undefined) ?? undefined }
        : loaderOrOptions;
    const mime = (file.type ?? "").toLowerCase().trim();
    if (!isAllowedMime(mime)) return fail("type");
    if (typeof file.size === "number" && file.size > IMAGE_CAPS.maxBytes) return fail("size");

    const hex = await readMagicBytes(file);
    const family = magicFamily(hex);
    if (family === null || family !== expectedFamily(mime)) return fail("magic");

    const loader =
      options.loader !== undefined
        ? options.loader
        : (options.loaderFactory ?? defaultBitmapLoaderFactory)();
    const size = await loadBitmapSize(file, loader, options.timeoutMs);
    if (!size) return fail("decode");
    if (size.width > IMAGE_CAPS.maxDimension || size.height > IMAGE_CAPS.maxDimension) {
      return fail("dimensions");
    }
    if (size.width * size.height > IMAGE_CAPS.maxPixels) return fail("pixels");
    return {
      ok: true,
      file,
      mime,
      width: size.width,
      height: size.height,
      pixels: size.width * size.height,
    };
  } catch {
    return fail("decode");
  }
}

/**
 * Temporary compatibility export for paste/drop callers while they migrate
 * to the source-agnostic validator name.
 */
export const validateClipboardImage = validateSatImageFile;

/** Dialog-facing name for the same policy and decode pipeline. */
export const validateImageUploadInput = validateSatImageFile;

export interface TransientImageAttrs {
  uploadId: string;
  uploading: true;
  uploadError: null;
  src: string;
  alt: string;
  assetId: null;
  caption: null;
}

export function buildTransientImageAttrs(
  uploadId: string,
  objectUrl: string,
  alt = ""
): TransientImageAttrs {
  return {
    uploadId,
    uploading: true,
    uploadError: null,
    src: objectUrl,
    alt: alt.trim(),
    assetId: null,
    caption: null,
  };
}

export interface ResolvedImageAttrs {
  assetId: string;
  src: string;
  uploading: false;
  uploadError: null;
  uploadId: null;
}

export function buildResolvedImageAttrs(
  asset: { id: string; downloadUrl: string | null },
  _objectUrlFallback: string
): ResolvedImageAttrs {
  return {
    assetId: asset.id,
    // Resolve by assetId when a signed URL is not ready. A revoked object URL
    // must never become the persisted fallback of an uploaded asset.
    src: asset.downloadUrl && !isTransientSource(asset.downloadUrl) ? asset.downloadUrl : "",
    uploading: false,
    uploadError: null,
    uploadId: null,
  };
}

function isTransientSource(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return lower.startsWith("blob:") || lower.startsWith("data:");
}

function isTransientImageNode(node: RichTextNode): boolean {
  if (node.type !== "image") return false;
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  if (attrs["uploading"] === true) return true;
  if (attrs["assetId"] != null) return false;
  return isTransientSource(attrs["src"]);
}

/**
 * Serialize-strip guard (PURE JSON walk): remove any image node that is still
 * transient (uploading===true) or that points at a blob:/data: src without an
 * assetId. Surrounding blocks are preserved; the dropped count feeds a
 * readiness warning upstream (non-blocking). Deterministic: same input doc
 * always yields the same output doc + count.
 */
export function stripTransientImages(doc: RichTextDocument): {
  doc: RichTextDocument;
  dropped: number;
} {
  let dropped = 0;
  const visitNode = (node: RichTextNode): RichTextNode | null => {
    if (node.type === "image" && isTransientImageNode(node)) {
      dropped += 1;
      return null;
    }
    if (node.type === "image" && isTransientSource(node.attrs?.["src"])) {
      return { ...node, attrs: { ...node.attrs, src: "" } };
    }
    if (!node.content) return node;
    const next: RichTextNode[] = [];
    for (const child of node.content) {
      const kept = visitNode(child);
      if (kept) next.push(kept);
    }
    if (
      next.length === node.content.length &&
      next.every((child, index) => child === node.content?.[index])
    )
      return node;
    return { ...node, content: next };
  };
  const source = doc.content;
  if (source === undefined) return { doc, dropped };
  const content = source.map(visitNode).filter((node): node is RichTextNode => node !== null);
  if (content.length === source.length && content.every((node, index) => node === source[index]))
    return { doc, dropped };
  return { doc: { ...doc, content }, dropped };
}
