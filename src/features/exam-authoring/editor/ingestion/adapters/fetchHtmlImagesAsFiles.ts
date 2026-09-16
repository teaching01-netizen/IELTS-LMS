import { IMAGE_CAPS } from "./imageValidation";
import type { HtmlImageRef } from "./htmlImageRefs";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";

export type HtmlImageRejectReason =
  | "scheme"
  | "fetch"
  | "timeout"
  | "size"
  | "aggregate-size"
  | "content-type"
  | "decode"
  | "count";
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
  maxAggregateBytes?: number;
  maxImages?: number;
}
export interface FetchHtmlImagesOutcome {
  images: FetchedHtmlImage[];
  rejected: RejectedHtmlImage[];
}
const DEFAULT_TIMEOUT_MS = 8_000;

interface ByteBudget {
  remaining: number;
}

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

type DataUrlDecodeResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: "size" | "aggregate-size" | "decode" };

function decodeDataUrl(
  src: string,
  maxBytes: number,
  aggregateBytes: number
): DataUrlDecodeResult {
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
      const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
      const estimatedBytes = Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
      if (estimatedBytes > maxBytes) return { ok: false, reason: "size" };
      if (estimatedBytes > aggregateBytes) return { ok: false, reason: "aggregate-size" };
      const binary =
        typeof atob === "function"
          ? atob(normalized)
          : Buffer.from(normalized, "base64").toString("binary");
      if (binary.length > maxBytes) return { ok: false, reason: "size" };
      if (binary.length > aggregateBytes) return { ok: false, reason: "aggregate-size" };
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return { ok: true, blob: new Blob([bytes], { type: mime }) };
    }
    const decoded = decodeURIComponent(payload);
    const decodedBytes = new TextEncoder().encode(decoded).byteLength;
    if (decodedBytes > maxBytes) return { ok: false, reason: "size" };
    if (decodedBytes > aggregateBytes) return { ok: false, reason: "aggregate-size" };
    return { ok: true, blob: new Blob([decoded], { type: mime }) };
  } catch {
    return { ok: false, reason: "decode" };
  }
}

type BoundedBlobResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: "size" | "aggregate-size" };

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* best effort */
  }
}

async function readBoundedBlob(
  response: Response,
  maxBytes: number,
  budget: ByteBudget
): Promise<BoundedBlobResult> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelResponseBody(response);
    return { ok: false, reason: "size" };
  }
  if (Number.isFinite(declared) && declared > budget.remaining) {
    await cancelResponseBody(response);
    return { ok: false, reason: "aggregate-size" };
  }
  const reserved = Number.isFinite(declared) ? declared : 0;
  if (reserved > 0) budget.remaining -= reserved;
  const settleReservation = (used: number): void => {
    if (reserved > used) budget.remaining += reserved - used;
  };
  if (!response.body || typeof response.body.getReader !== "function") {
    const blob = await response.blob();
    if (blob.size > maxBytes) {
      settleReservation(blob.size);
      return { ok: false, reason: "size" };
    }
    if (blob.size > reserved && blob.size - reserved > budget.remaining) {
      budget.remaining = 0;
      return { ok: false, reason: "aggregate-size" };
    }
    if (blob.size > reserved) budget.remaining -= blob.size - reserved;
    settleReservation(blob.size);
    return { ok: true, blob };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      const extra = Math.max(0, total - reserved) - Math.max(0, total - reserved - next.value.byteLength);
      if (extra > budget.remaining) {
        budget.remaining = 0;
        try {
          await reader.cancel();
        } catch {
          /* best effort */
        }
        return { ok: false, reason: "aggregate-size" };
      }
      if (extra > 0) budget.remaining -= extra;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* best effort */
        }
        settleReservation(total);
        return { ok: false, reason: "size" };
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
  settleReservation(total);
  return {
    ok: true,
    blob: new Blob(chunks, { type: contentType(response.headers.get("content-type") ?? "") }),
  };
}

async function fetchOne(
  ref: HtmlImageRef,
  fetchFn: typeof fetch,
  timeoutMs: number,
  maxBytes: number,
  budget: ByteBudget,
  fallbackIndex: number
): Promise<FetchedHtmlImage | RejectedHtmlImage> {
  const refId = refIdFor(ref, fallbackIndex);
  if (budget.remaining <= 0) return rejected(ref, "aggregate-size", fallbackIndex);
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
    const decoded = decodeDataUrl(ref.src, maxBytes, budget.remaining);
    if (!decoded.ok) return rejected(ref, decoded.reason, fallbackIndex);
    const mime = contentType(decoded.blob.type) || dataMime(ref.src) || "";
    if (decoded.blob.size > maxBytes) return rejected(ref, "size", fallbackIndex);
    if (decoded.blob.size > budget.remaining) {
      return rejected(ref, "aggregate-size", fallbackIndex);
    }
    budget.remaining -= decoded.blob.size;
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
    if (!response.ok) {
      await cancelResponseBody(response);
      return rejected(ref, "fetch", fallbackIndex);
    }
    const declaredMime =
      contentType(response.headers.get("content-type") ?? "") || dataMime(ref.src) || "";
    if (!declaredMime.startsWith("image/")) {
      await cancelResponseBody(response);
      return rejected(ref, "content-type", fallbackIndex);
    }
    const bounded = await readBoundedBlob(response, maxBytes, budget);
    if (!bounded.ok) return rejected(ref, bounded.reason, fallbackIndex);
    const actualMime = contentType(bounded.blob.type);
    if (!actualMime.startsWith("image/")) return rejected(ref, "content-type", fallbackIndex);
    return {
      refId,
      file: new File([bounded.blob], "pasted-image." + extensionForMime(actualMime), {
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
  const maxImages = Math.max(
    0,
    Math.floor(deps.maxImages ?? SAT_IMAGE_POLICY.maxImagesPerPaste)
  );
  const selectedRefs = refs.slice(0, maxImages);
  const countRejected = refs
    .slice(maxImages)
    .map((ref, index) => rejected(ref, "count", maxImages + index));
  const budget: ByteBudget = {
    remaining: Math.max(
      0,
      deps.maxAggregateBytes ?? SAT_IMAGE_POLICY.maxPasteBytes
    ),
  };
  if (typeof fetchFn !== "function")
    return {
      images: [],
      rejected: [
        ...countRejected,
        ...selectedRefs.map((ref, index) => rejected(ref, "fetch", index)),
      ],
    };
  const outcomes = await Promise.allSettled(
    selectedRefs.map((ref, index) =>
      fetchOne(
        ref,
        fetchFn,
        deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        deps.maxBytes ?? IMAGE_CAPS.maxBytes,
        budget,
        index
      )
    )
  );
  return outcomes.reduce<FetchHtmlImagesOutcome>(
    (out, item, index) => {
      if (item.status === "fulfilled") {
        if ("file" in item.value) out.images.push(item.value);
        else out.rejected.push(item.value);
      } else {
        const ref = selectedRefs[index] ?? { src: "", alt: "" };
        out.rejected.push(rejected(ref, "fetch", index));
      }
      return out;
    },
    { images: [], rejected: countRejected }
  );
}
