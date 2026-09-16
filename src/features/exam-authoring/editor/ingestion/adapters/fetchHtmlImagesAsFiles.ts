import { IMAGE_CAPS } from "./imageValidation";
import type { HtmlImageRef } from "./htmlImageRefs";

export type HtmlImageRejectReason =
  "scheme" | "fetch" | "timeout" | "size" | "content-type" | "decode";
export interface FetchedHtmlImage {
  refId: string;
  file: File;
  alt: string;
  src: string;
}
export interface RejectedHtmlImage {
  refId: string;
  src: string;
  alt: string;
  reason: HtmlImageRejectReason;
}
export interface FetchHtmlImagesDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}
export interface FetchHtmlImagesOutcome {
  images: FetchedHtmlImage[];
  rejected: RejectedHtmlImage[];
}
const DEFAULT_TIMEOUT_MS = 8_000;

function refIdFor(ref: HtmlImageRef, fallbackIndex: number): string {
  return ref.refId ?? "html-image-" + String(fallbackIndex);
}

function rejected(
  ref: HtmlImageRef,
  reason: HtmlImageRejectReason,
  fallbackIndex: number
): RejectedHtmlImage {
  return { refId: refIdFor(ref, fallbackIndex), src: ref.src, alt: ref.alt, reason };
}
function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}
function contentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}
function dataMime(src: string): string | null {
  return /^data:([^;,]+)(?:;[^,]*)?,/i.exec(src)?.[1]?.toLowerCase() ?? null;
}

type DataUrlDecodeResult = { ok: true; blob: Blob } | { ok: false; reason: "size" | "decode" };

function decodeDataUrl(src: string, maxBytes: number): DataUrlDecodeResult {
  const match = /^data:([^;,]+)((?:;[^,]*)*),(.*)$/is.exec(src);
  if (!match) return { ok: false, reason: "decode" };
  const mime = contentType(match[1] ?? "");
  if (!mime.startsWith("image/")) return { ok: false, reason: "decode" };
  const metadata = match[2] ?? "";
  const payload = match[3] ?? "";
  try {
    if (/;base64/i.test(metadata)) {
      const normalized = payload.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1)
        return { ok: false, reason: "decode" };
      const binary =
        typeof atob === "function"
          ? atob(normalized)
          : Buffer.from(normalized, "base64").toString("binary");
      if (binary.length > maxBytes) return { ok: false, reason: "size" };
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return { ok: true, blob: new Blob([bytes], { type: mime }) };
    }
    const decoded = decodeURIComponent(payload);
    if (new TextEncoder().encode(decoded).byteLength > maxBytes)
      return { ok: false, reason: "size" };
    return { ok: true, blob: new Blob([decoded], { type: mime }) };
  } catch {
    return { ok: false, reason: "decode" };
  }
}

async function readBoundedBlob(response: Response, maxBytes: number): Promise<Blob | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body || typeof response.body.getReader !== "function") {
    const blob = await response.blob();
    return blob.size <= maxBytes ? blob : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* best effort */
        }
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* best effort */
    }
  }
  return new Blob(chunks, { type: contentType(response.headers.get("content-type") ?? "") });
}

async function fetchOne(
  ref: HtmlImageRef,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxBytes: number,
  fallbackIndex: number
): Promise<FetchedHtmlImage | RejectedHtmlImage> {
  const refId = refIdFor(ref, fallbackIndex);
  let url: URL;
  if (!/^https:\/\//i.test(ref.src) && !/^data:/i.test(ref.src))
    return rejected(ref, "scheme", fallbackIndex);
  try {
    url = new URL(ref.src);
  } catch {
    return rejected(ref, "scheme", fallbackIndex);
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "https:" && scheme !== "data:") return rejected(ref, "scheme", fallbackIndex);
  if (ref.src.length > maxBytes * 2 + 128) return rejected(ref, "size", fallbackIndex);
  if (scheme === "data:") {
    const decoded = decodeDataUrl(ref.src, maxBytes);
    if (!decoded.ok) return rejected(ref, decoded.reason, fallbackIndex);
    const mime = contentType(decoded.blob.type) || dataMime(ref.src) || "";
    return {
      refId,
      file: new File([decoded.blob], "pasted-image." + extensionForMime(mime), { type: mime }),
      alt: ref.alt,
      src: ref.src,
    };
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const request = fetchFn(
      ref.src,
      controller ? { signal: controller.signal, credentials: "same-origin" } : undefined
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const response = await Promise.race([request, timeout]);
    if (!response.ok) return rejected(ref, "fetch", fallbackIndex);
    const declaredMime =
      contentType(response.headers.get("content-type") ?? "") || dataMime(ref.src) || "";
    if (!declaredMime.startsWith("image/")) return rejected(ref, "content-type", fallbackIndex);
    const blob = await readBoundedBlob(response, maxBytes);
    if (!blob) return rejected(ref, "size", fallbackIndex);
    const actualMime = contentType(blob.type);
    if (!actualMime.startsWith("image/")) return rejected(ref, "content-type", fallbackIndex);
    return {
      refId,
      file: new File([blob], "pasted-image." + extensionForMime(actualMime), {
        type: actualMime,
      }),
      alt: ref.alt,
      src: ref.src,
    };
  } catch (error) {
    return rejected(
      ref,
      error instanceof Error && error.message === "timeout" ? "timeout" : "fetch",
      fallbackIndex
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function fetchHtmlImagesAsFiles(
  refs: HtmlImageRef[],
  deps: FetchHtmlImagesDeps = {}
): Promise<FetchHtmlImagesOutcome> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function")
    return {
      images: [],
      rejected: refs.map((ref, index) => rejected(ref, "fetch", index)),
    };
  const outcomes = await Promise.all(
    refs.map((ref, index) =>
      fetchOne(
        ref,
        fetchFn,
        deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        deps.maxBytes ?? IMAGE_CAPS.maxBytes,
        index
      )
    )
  );
  return outcomes.reduce<FetchHtmlImagesOutcome>(
    (out, item) => {
      if ("file" in item) out.images.push(item);
      else out.rejected.push(item);
      return out;
    },
    { images: [], rejected: [] }
  );
}
