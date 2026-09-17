/**
 * Fold duplicate clipboard representations of one image into a single staged
 * image (application layer; framework-free).
 *
 * A "copy image" clipboard payload carries one picture twice: as a direct image
 * `File` and as an HTML `<img>` that ingestion fetches/decodes again. The HTML
 * representation owns the document POSITION and the source ALT text; the file
 * representation owns the bytes without a network round-trip. Staging both
 * inserts the image twice and uploads it twice, so before the pending lists are
 * merged this module redirects the HTML image reference onto the direct file's
 * reference. The AST node then carries the file's reference id (one prepared
 * node, one upload) while keeping its position and alt text.
 *
 * Two passes, strongest evidence first:
 *
 *   1. byte-identical representations (provable) — every ref gets a chance to
 *      match its exact bytes before any heuristic runs;
 *   2. visually identical representations (heuristic, see
 *      domain/clipboardImageIdentity) — for the common browser behavior of
 *      re-encoding the clipboard file, where the picture is the same but the
 *      bytes are not.
 *
 * Guardrails that keep pass 2 from collapsing genuinely different images: a
 * fingerprint is only consulted between the two representations of one paste,
 * equal decoded dimensions and tight hash/luminance bounds are required, each
 * direct file absorbs at most one HTML representation, and a missing or failing
 * fingerprinter simply leaves the pair alone. Repeated HTML occurrences of one
 * source keep their own reference so repeated images stay repeated.
 */
import type { PendingImage } from "./ingestClipboard";
import type { HtmlImageRef } from "../adapters/htmlImageRefs";
import type { TextHtmlImageRef } from "../adapters/textHtml";
import {
  isSameClipboardImageBytes,
  isSameClipboardImageFingerprint,
  type ClipboardImageBytes,
  type ClipboardImageFingerprint,
} from "../domain/clipboardImageIdentity";
import { fingerprintClipboardImage } from "../adapters/clipboardImageFingerprint";

export type ClipboardImageFingerprintFn = (
  file: File
) => Promise<ClipboardImageFingerprint | null>;

export interface ClipboardImageReconciliationInput {
  /** Direct clipboard image files (refIds `clipboard-image-N`). */
  files: readonly PendingImage[];
  /** Marked HTML image refs in document order. */
  refs: readonly HtmlImageRef[];
  /** Fetched/decoded HTML images, one per marked ref that survived fetching. */
  htmlImages: readonly PendingImage[];
  /** AST image metadata, keyed by marked ref id. */
  imageRefs: ReadonlyMap<string, TextHtmlImageRef>;
}

export interface ClipboardImageReconciliation {
  /** Direct files, with alt text adopted from the matching HTML image. */
  files: PendingImage[];
  /** HTML images with reconciled duplicates removed. */
  htmlImages: PendingImage[];
  /** Image refs whose duplicate refIds now point at the surviving file ref. */
  imageRefs: ReadonlyMap<string, TextHtmlImageRef>;
  /** Number of HTML representations folded into a direct file. */
  reconciled: number;
  /** How many of those folds rested on the visual fingerprint, not the bytes. */
  reconciledByVisualFingerprint: number;
}

export interface ClipboardImageReconciliationDeps {
  /** Overrides the browser fingerprinter (tests, and hosts without canvas). */
  fingerprint?: ClipboardImageFingerprintFn | undefined;
}

/**
 * Read clipboard file bytes. `Blob.arrayBuffer` is the browser path; FileReader
 * covers older DOM implementations (and the jsdom test environment) where the
 * promise helper does not exist.
 */
async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  if (typeof FileReader !== "function") throw new Error("Image bytes cannot be read here.");
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error("Image bytes could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Image bytes could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

/** Adapt a clipboard `File` to the byte reference the identity rule compares. */
function fileBytes(file: File): ClipboardImageBytes {
  return { size: file.size, type: file.type, readBytes: () => readFileBytes(file) };
}

/** Same declared format, so a byte comparison is meaningful in the first place. */
function isSameDeclaredFormat(file: PendingImage, htmlImage: PendingImage): boolean {
  return (
    file.file.size === htmlImage.file.size &&
    file.file.type.trim().toLowerCase() === htmlImage.file.type.trim().toLowerCase()
  );
}

interface FoldCandidate {
  /** Marked HTML ref being folded away. */
  refId: string;
  /** Direct file ref that survives and owns the bytes. */
  fileRefId: string;
  alt: string;
  byFingerprint: boolean;
}

export async function reconcileClipboardImageRepresentations(
  input: ClipboardImageReconciliationInput,
  deps: ClipboardImageReconciliationDeps = {}
): Promise<ClipboardImageReconciliation> {
  const unchanged: ClipboardImageReconciliation = {
    files: [...input.files],
    htmlImages: [...input.htmlImages],
    imageRefs: input.imageRefs,
    reconciled: 0,
    reconciledByVisualFingerprint: 0,
  };
  if (input.files.length === 0 || input.refs.length === 0 || input.htmlImages.length === 0) {
    return unchanged;
  }
  const htmlByRefId = new Map(input.htmlImages.map((image) => [image.refId, image]));
  if (htmlByRefId.size === 0) return unchanged;

  const consumedFileRefs = new Set<string>();
  const folds: FoldCandidate[] = [];
  const foldAlt = (htmlImage: PendingImage, ref: HtmlImageRef): string =>
    (htmlImage.alt || ref.alt).trim();

  // Pass 1 — provable: identical bytes with the same declared MIME type.
  for (const ref of input.refs) {
    if (!ref.refId) continue;
    const htmlImage = htmlByRefId.get(ref.refId);
    if (!htmlImage) continue;
    const file = input.files.find(
      (candidate) => !consumedFileRefs.has(candidate.refId) && isSameDeclaredFormat(candidate, htmlImage)
    );
    if (!file) continue;
    let identical = false;
    try {
      identical = await isSameClipboardImageBytes(
        fileBytes(file.file),
        fileBytes(htmlImage.file)
      );
    } catch {
      identical = false;
    }
    if (!identical) continue;
    consumedFileRefs.add(file.refId);
    folds.push({
      refId: ref.refId,
      fileRefId: file.refId,
      alt: foldAlt(htmlImage, ref),
      byFingerprint: false,
    });
  }

  // Pass 2 — heuristic: same picture, different encoding. Only consulted when
  // the fingerprinter is available and the pair has not already been folded.
  const fingerprint = deps.fingerprint ?? fingerprintClipboardImage;
  const fingerprinted = new Map<File, Promise<ClipboardImageFingerprint | null>>();
  const fingerprintOf = (file: File): Promise<ClipboardImageFingerprint | null> => {
    const cached = fingerprinted.get(file);
    if (cached) return cached;
    let pending: Promise<ClipboardImageFingerprint | null>;
    try {
      pending = Promise.resolve(fingerprint(file)).catch(() => null);
    } catch {
      pending = Promise.resolve(null);
    }
    fingerprinted.set(file, pending);
    return pending;
  };
  const foldedRefIds = new Set(folds.map((fold) => fold.refId));
  for (const ref of input.refs) {
    if (!ref.refId || foldedRefIds.has(ref.refId)) continue;
    const htmlImage = htmlByRefId.get(ref.refId);
    if (!htmlImage) continue;
    const htmlFingerprint = await fingerprintOf(htmlImage.file);
    if (!htmlFingerprint) continue;
    // Document order decides: the same-format candidate first, then the rest.
    const available = input.files.filter((item) => !consumedFileRefs.has(item.refId));
    const candidates = [
      ...available.filter((item) => isSameDeclaredFormat(item, htmlImage)),
      ...available.filter((item) => !isSameDeclaredFormat(item, htmlImage)),
    ];
    for (const candidate of candidates) {
      const candidateFingerprint = await fingerprintOf(candidate.file);
      if (!candidateFingerprint) continue;
      if (!isSameClipboardImageFingerprint(candidateFingerprint, htmlFingerprint)) continue;
      consumedFileRefs.add(candidate.refId);
      foldedRefIds.add(ref.refId);
      folds.push({
        refId: ref.refId,
        fileRefId: candidate.refId,
        alt: foldAlt(htmlImage, ref),
        byFingerprint: true,
      });
      break;
    }
  }

  if (folds.length === 0) return unchanged;

  const altForFileRef = new Map<string, string>();
  const redirects = new Map<string, string>();
  for (const fold of folds) {
    redirects.set(fold.refId, fold.fileRefId);
    if (fold.alt && !altForFileRef.has(fold.fileRefId)) altForFileRef.set(fold.fileRefId, fold.alt);
  }

  const files = input.files.map((file) => {
    const alt = altForFileRef.get(file.refId);
    return alt && !file.alt.trim() ? { ...file, alt } : file;
  });
  const htmlImages = input.htmlImages.filter((image) => !redirects.has(image.refId));
  const imageRefs = new Map<string, TextHtmlImageRef>();
  for (const [refId, value] of input.imageRefs) {
    const survivingRefId = redirects.get(refId);
    if (!survivingRefId) {
      imageRefs.set(refId, value);
      continue;
    }
    const file = input.files.find((candidate) => candidate.refId === survivingRefId);
    // The AST node must reference the bytes that will actually be staged, so
    // the blob reference follows the surviving direct file.
    imageRefs.set(refId, {
      refId: survivingRefId,
      blobRef: file
        ? { id: survivingRefId, mimeType: file.file.type, sizeBytes: file.file.size }
        : value.blobRef,
      alt: value.alt || (altForFileRef.get(survivingRefId) ?? ""),
    });
  }

  return {
    files,
    htmlImages,
    imageRefs,
    reconciled: folds.length,
    reconciledByVisualFingerprint: folds.filter((fold) => fold.byFingerprint).length,
  };
}
