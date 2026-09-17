/**
 * Phase 07 — clipboard/drop orchestration service (thin, framework-free).
 *
 * Reads each clipboard representation once, normalizes text into the canonical
 * ImportDocument, and stages image files for the editor-owned upload pipe.
 * This module never touches the editor.
 */
import type { ImportDocument, ImportNode, InlineNode } from "../domain/importDocument";
import type { PipelineContext } from "./pipelineContext";
import { parseTextHtml } from "../adapters/textHtml";
import { pdfCopyToNodes } from "../adapters/pdfCopy";
import { detectSpreadsheetPayload, spreadsheetClipboardToTable } from "../adapters/spreadsheet";
import { stitchDisplayMathParagraphs, upgradeMathInDocument } from "../mathIngest";
import { applyMarkdownInlineToInlines } from "../normalization/markdownInline";
import {
  extractHtmlImageRefs,
  markHtmlImageRefsWithOccurrences,
  type HtmlImageRef,
} from "../adapters/htmlImageRefs";
import { fetchHtmlImagesAsFiles } from "../adapters/fetchHtmlImagesAsFiles";
import {
  reconcileClipboardImageRepresentations,
  type ClipboardImageReconciliationDeps,
} from "./reconcileClipboardImages";
import type { TextHtmlImageRef } from "../adapters/textHtml";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";

export type IngestSource =
  "files" | "spreadsheet" | "html+text" | "html" | "text" | "pdf-text" | "empty";

export interface IngestClipboardRequest {
  files: File[];
  html: string | null;
  text: string | null;
  ownerId: string | null;
  target: { inTable: boolean; inCodeBlock: boolean; inChoiceEditor: boolean };
  flags?:
    { smartPaste?: boolean; latex?: boolean; spreadsheet?: boolean; images?: boolean } | undefined;
}

export interface IngestClipboardResult {
  document: ImportDocument;
  source: IngestSource;
  pendingImages: PendingImage[];
  rejectedImages: number;
  warnings: IngestWarning[];
  transformations: string[];
  stats: { blockCount: number; imageCount: number; mathCount: number; tableCount: number };
}

export interface IngestWarning {
  code: string;
  message: string;
  count?: number | undefined;
  reason?: string | undefined;
}

/** File bytes stay at the application/editor boundary, never in ImportDocument. */
export interface PendingImage {
  refId: string;
  file: File;
  alt: string;
}

const REPRESENTATION_RECONCILED_TRANSFORMATION = "image.representation-reconciled";
const REPRESENTATION_RECONCILED_VISUAL_TRANSFORMATION = "image.representation-reconciled-visual";

/** Injectable boundaries of the clipboard pipeline (browser primitives by default). */
export type IngestClipboardDeps = ClipboardImageReconciliationDeps;

const EMPTY_DOC: ImportDocument = {
  version: 1,
  nodes: [],
  sourceMeta: { source: "text", confidence: 0, transformations: [] },
};

function statsOf(doc: ImportDocument): IngestClipboardResult["stats"] {
  let tables = 0;
  let equations = 0;
  let images = 0;
  const visit = (nodes: ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "table") tables += 1;
      if (node.kind === "image") images += 1;
      if (node.kind === "paragraph" || node.kind === "heading") {
        for (const inline of node.children)
          if (inline.kind === "inlineMath" || inline.kind === "blockMath") equations += 1;
      } else if (node.kind === "bulletList" || node.kind === "orderedList") {
        for (const item of node.items) visit(item);
      }
    }
  };
  visit(doc.nodes);
  return {
    blockCount: doc.nodes.length,
    imageCount: images,
    mathCount: equations,
    tableCount: tables,
  };
}

function imageNodeFor(pending: PendingImage): ImportNode {
  return {
    kind: "image",
    blobRef: { id: pending.refId, mimeType: pending.file.type, sizeBytes: pending.file.size },
    url: null,
    alt: pending.alt,
    caption: null,
    meta: { source: "image", confidence: 2, transformations: [] },
  };
}

function imageIdsIn(nodes: ImportNode[], ids: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "image") {
      if (node.blobRef?.id) ids.add(node.blobRef.id);
    } else if (node.kind === "bulletList" || node.kind === "orderedList") {
      for (const item of node.items) imageIdsIn(item, ids);
    }
  }
}

/** Appends only file references that have no positional HTML AST node. */
function appendMissingImages(
  doc: ImportDocument,
  pending: readonly PendingImage[]
): ImportDocument {
  if (pending.length === 0) return doc;
  const present = new Set<string>();
  imageIdsIn(doc.nodes, present);
  const missing = pending.filter((item) => !present.has(item.refId)).map(imageNodeFor);
  if (missing.length === 0) return doc;
  return { ...doc, nodes: [...doc.nodes, ...missing] };
}

function normalizeMarkdownInlines(inlines: InlineNode[]): {
  inlines: InlineNode[];
  applied: number;
} {
  return applyMarkdownInlineToInlines(inlines);
}
function normalizeMarkdownNodes(nodes: ImportNode[]): { nodes: ImportNode[]; applied: number } {
  let applied = 0;
  const visit = (items: ImportNode[]): ImportNode[] =>
    // Complete split display delimiters before Markdown can read LaTeX
    // subscripts/asterisks as emphasis. Reuse the math pipeline's safe stitch.
    stitchDisplayMathParagraphs(items).map((node) => {
      if (node.kind === "paragraph" || node.kind === "heading") {
        const normalized = normalizeMarkdownInlines(node.children);
        applied += normalized.applied;
        return { ...node, children: normalized.inlines };
      }
      if (node.kind === "bulletList" || node.kind === "orderedList")
        return { ...node, items: node.items.map((item) => visit(item)) };
      if (node.kind === "table")
        return {
          ...node,
          rows: node.rows.map((row) =>
            row.map((cell) => {
              const normalized = normalizeMarkdownInlines(cell.children);
              applied += normalized.applied;
              return { ...cell, children: normalized.inlines };
            })
          ),
        };
      return node;
    });
  return { nodes: visit(nodes), applied };
}
function withMarkdown(doc: ImportDocument): {
  document: ImportDocument;
  transformations: string[];
} {
  const normalized = normalizeMarkdownNodes(doc.nodes);
  if (normalized.applied === 0) return { document: doc, transformations: [] };
  const transformation = "text.markdown-inline";
  return {
    document: {
      ...doc,
      nodes: normalized.nodes,
      sourceMeta: {
        ...doc.sourceMeta,
        transformations: [...doc.sourceMeta.transformations, transformation],
      },
    },
    transformations: [transformation],
  };
}
const IMAGE_COUNT_LIMIT_MESSAGE =
  DIAGNOSTIC_MESSAGES["import.image.count-limit"];
const IMAGE_AGGREGATE_LIMIT_MESSAGE = DIAGNOSTIC_MESSAGES["import.image.aggregate-size"];

function imageLimitWarning(
  code: string,
  message: string,
  count: number,
  reason: string
): IngestWarning {
  return { code, message, count, reason };
}

function imageRejectionWarning(count: number, reason: string): IngestWarning {
  const noun = count === 1 ? "image" : "images";
  return {
    code: "import.image.rejected",
    message: count + " " + noun + " could not be imported (" + reason + ").",
    count,
    reason,
  };
}

interface DirectImageSelection {
  files: File[];
  rejected: number;
  bytes: number;
  warnings: IngestWarning[];
}

function selectDirectImages(files: File[]): DirectImageSelection {
  const maxImages = SAT_IMAGE_POLICY.maxImagesPerPaste;
  const countLimited = Math.max(0, files.length - maxImages);
  const candidates = files.slice(0, maxImages);
  const bytes = candidates.reduce((total, file) => total + Math.max(0, file.size), 0);
  if (bytes > SAT_IMAGE_POLICY.maxPasteBytes) {
    return {
      files: [],
      rejected: files.length,
      bytes: SAT_IMAGE_POLICY.maxPasteBytes,
      warnings: [
        ...(countLimited > 0
          ? [imageLimitWarning("import.image.count-limit", IMAGE_COUNT_LIMIT_MESSAGE, countLimited, "count")]
          : []),
        imageLimitWarning(
          "import.image.aggregate-size",
          IMAGE_AGGREGATE_LIMIT_MESSAGE,
          files.length,
          "aggregate-size"
        ),
      ],
    };
  }
  return {
    files: candidates,
    rejected: countLimited,
    bytes,
    warnings:
      countLimited > 0
        ? [imageLimitWarning("import.image.count-limit", IMAGE_COUNT_LIMIT_MESSAGE, countLimited, "count")]
        : [],
  };
}

export function looksLikePdfCopy(text: string): boolean {
  const lines = text.split("\n");
  if (lines.length < 2) return false;
  let shortLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length < 100 && !/[.!?]$/.test(trimmed)) shortLines += 1;
  }
  return shortLines >= 2;
}

async function htmlImages(
  html: string | null,
  enabled: boolean,
  maxImages: number,
  maxBytes: number
): Promise<{
  refs: HtmlImageRef[];
  markedHtml: string | null;
  pendingImages: PendingImage[];
  imageRefs: ReadonlyMap<string, TextHtmlImageRef>;
  rejected: number;
  transformations: string[];
  warnings: IngestWarning[];
}> {
  if (!html || !enabled)
    return {
      refs: [],
      markedHtml: null,
      pendingImages: [],
      imageRefs: new Map(),
      rejected: 0,
      transformations: [],
      warnings: [],
    };
  const limited = extractHtmlImageRefs(html, maxImages);
  const refs = limited.refs;
  if (limited.refs.length === 0 && limited.truncated === 0)
    return {
      refs: [],
      markedHtml: html,
      pendingImages: [],
      imageRefs: new Map(),
      rejected: 0,
      transformations: [],
      warnings: [],
    };
  const marked = markHtmlImageRefsWithOccurrences(html, refs, maxImages);
  const fetched = await fetchHtmlImagesAsFiles(refs, {
    maxImages,
    maxAggregateBytes: maxBytes,
  });
  const fetchedBySource = new Map(fetched.images.map((item) => [item.src, item]));
  const rejectedBySource = new Map(fetched.rejected.map((item) => [item.src, item.reason]));
  const imageRefs = new Map<string, TextHtmlImageRef>();
  for (const ref of marked.refs) {
    if (!ref.refId) continue;
    const image = fetchedBySource.get(ref.src);
    imageRefs.set(ref.refId, {
      refId: ref.refId,
      blobRef: image
        ? { id: ref.refId, mimeType: image.file.type, sizeBytes: image.file.size }
        : null,
      alt: ref.alt,
    });
  }
  const rejectionCounts = new Map<string, number>();
  for (const ref of marked.refs) {
    if (!fetchedBySource.has(ref.src)) {
      const reason = rejectedBySource.get(ref.src) ?? "fetch";
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
    }
  }
  const countLimited = limited.truncated + marked.truncated;
  if (countLimited > 0) rejectionCounts.set("count", countLimited);
  const rejected = Array.from(rejectionCounts.values()).reduce((total, count) => total + count, 0);
  const warnings: IngestWarning[] = [];
  const countRejected = rejectionCounts.get("count") ?? 0;
  if (countRejected > 0) {
    warnings.push(imageLimitWarning("import.image.count-limit", IMAGE_COUNT_LIMIT_MESSAGE, countRejected, "count"));
  }
  for (const [reason, count] of rejectionCounts) {
    if (reason === "count") continue;
    warnings.push(
      reason === "aggregate-size"
        ? imageLimitWarning(
            "import.image.aggregate-size",
            IMAGE_AGGREGATE_LIMIT_MESSAGE,
            count,
            reason
          )
        : imageRejectionWarning(count, reason)
    );
  }
  const transformations = [
    ...(marked.refs.filter((ref) => fetchedBySource.has(ref.src)).length > 0
      ? [
          "html.image-extracted:" +
            String(marked.refs.filter((ref) => fetchedBySource.has(ref.src)).length),
        ]
      : []),
    ...(rejected > 0 ? ["html.image-rejected:" + rejected] : []),
  ];
  return {
    refs: marked.refs,
    markedHtml: marked.html,
    pendingImages: marked.refs.flatMap((ref) => {
      const image = fetchedBySource.get(ref.src);
      return image ? [{ refId: ref.refId ?? image.refId, file: image.file, alt: ref.alt }] : [];
    }),
    imageRefs,
    rejected,
    transformations,
    warnings,
  };
}

function result(
  // Deliberately NOT named `document`: this is an imported ImportDocument, and
  // shadowing the DOM global with it reads as a browser dependency to the
  // architecture guard (and to a human reader).
  importedDocument: ImportDocument,
  source: IngestSource,
  pendingImages: PendingImage[],
  rejectedImages: number,
  warnings: IngestWarning[],
  transformations: string[]
): IngestClipboardResult {
  return {
    document: importedDocument,
    source,
    pendingImages,
    rejectedImages,
    warnings,
    transformations,
    stats: statsOf(importedDocument),
  };
}

export async function ingestClipboard(
  req: IngestClipboardRequest,
  ctx: PipelineContext,
  deps: IngestClipboardDeps = {}
): Promise<IngestClipboardResult> {
  const flags = req.flags ?? {};
  const empty: IngestClipboardResult = {
    document: EMPTY_DOC,
    source: "empty",
    pendingImages: [],
    rejectedImages: 0,
    warnings: [],
    transformations: [],
    stats: { blockCount: 0, imageCount: 0, mathCount: 0, tableCount: 0 },
  };
  if (flags.smartPaste === false) return empty;
  const imageFiles =
    flags.images === false
      ? []
      : req.files.filter((file) => file.type.toLowerCase().startsWith("image/"));
  const directSelection = selectDirectImages(imageFiles);
  // Reassigned by reconciliation: a direct file adopts the alt text of the HTML
  // representation that turned out to be the same bytes.
  let fileImages: PendingImage[] = directSelection.files.map((file, index) => ({
    refId: "clipboard-image-" + String(index),
    file,
    alt: "",
  }));
  const target = req.target.inChoiceEditor ? "choice" : "rich";
  let htmlImageResult = {
    refs: [] as HtmlImageRef[],
    markedHtml: null as string | null,
    pendingImages: [] as PendingImage[],
    imageRefs: new Map<string, TextHtmlImageRef>() as ReadonlyMap<string, TextHtmlImageRef>,
    rejected: 0,
    transformations: [] as string[],
    warnings: [] as IngestWarning[],
  };
  let pendingImages: PendingImage[] = [...fileImages];
  let baseWarnings: IngestWarning[] = [...directSelection.warnings];
  let baseTransformations: string[] =
    imageFiles.length > 0 ? ["clipboard.files:" + imageFiles.length] : [];
  let imageResultLoaded = false;
  const loadHtmlImages = async (): Promise<void> => {
    if (imageResultLoaded) return;
    htmlImageResult = await htmlImages(
      req.html,
      flags.images !== false,
      Math.max(0, SAT_IMAGE_POLICY.maxImagesPerPaste - fileImages.length),
      Math.max(0, SAT_IMAGE_POLICY.maxPasteBytes - directSelection.bytes)
    );
    // Both representations of the SAME clipboard image arrive here: the direct
    // file and the HTML <img> that was just fetched. Fold them into one staged
    // image before the pending lists merge, or the paste inserts the visual
    // twice and uploads it twice.
    const reconciled = await reconcileClipboardImageRepresentations(
      {
        files: fileImages,
        refs: htmlImageResult.refs,
        htmlImages: htmlImageResult.pendingImages,
        imageRefs: htmlImageResult.imageRefs,
      },
      deps
    );
    fileImages = reconciled.files;
    htmlImageResult = {
      ...htmlImageResult,
      pendingImages: reconciled.htmlImages,
      imageRefs: reconciled.imageRefs,
      transformations: [
        ...htmlImageResult.transformations,
        ...(reconciled.reconciled > 0
          ? [REPRESENTATION_RECONCILED_TRANSFORMATION + ":" + String(reconciled.reconciled)]
          : []),
        // A fold justified only by the visual fingerprint, never by bytes —
        // the one reconciliation an operator may want to audit later.
        ...(reconciled.reconciledByVisualFingerprint > 0
          ? [
              REPRESENTATION_RECONCILED_VISUAL_TRANSFORMATION +
                ":" +
                String(reconciled.reconciledByVisualFingerprint),
            ]
          : []),
      ],
    };
    pendingImages = [...fileImages, ...htmlImageResult.pendingImages];
    baseWarnings = [...directSelection.warnings, ...htmlImageResult.warnings];
    baseTransformations = [
      ...htmlImageResult.transformations,
      ...(imageFiles.length > 0 ? ["clipboard.files:" + imageFiles.length] : []),
    ];
    imageResultLoaded = true;
  };

  if ((req.html || req.text) && flags.spreadsheet !== false) {
    const payload = detectSpreadsheetPayload({
      "text/html": req.html ?? undefined,
      "text/plain": req.text ?? undefined,
    });
    if (payload !== "none") {
      const sheet = spreadsheetClipboardToTable(
        { "text/html": req.html ?? undefined, "text/plain": req.text ?? undefined },
        ctx
      );
      if (sheet.document) {
        await loadHtmlImages();
        const mathOn = flags.latex !== false;
        const upgraded = mathOn
          ? upgradeMathInDocument(sheet.document, target)
          : { document: sheet.document, warnings: [], transformations: [] as string[] };
        const rejectedImages = directSelection.rejected + htmlImageResult.rejected;
        return result(
          appendMissingImages(upgraded.document, pendingImages),
          "spreadsheet",
          pendingImages,
          rejectedImages,
          [...baseWarnings, ...sheet.warnings, ...upgraded.warnings],
          [...baseTransformations, ...sheet.transformations, ...upgraded.transformations].filter(
            (item) => item !== "clipboard.files:0"
          )
        );
      }
      if (sheet.tooLarge) {
        await loadHtmlImages();
        return {
          ...empty,
          source: "spreadsheet",
          document: appendMissingImages(EMPTY_DOC, pendingImages),
          pendingImages,
          rejectedImages: directSelection.rejected + htmlImageResult.rejected,
          warnings: [...baseWarnings, ...sheet.warnings],
          transformations: [...baseTransformations, ...sheet.transformations].filter(
            (item) => item !== "clipboard.files:0"
          ),
          stats: statsOf(appendMissingImages(EMPTY_DOC, pendingImages)),
        };
      }
    }
  }

  await loadHtmlImages();

  let parsedDocument: ImportDocument = EMPTY_DOC;
  let source: IngestSource = imageFiles.length > 0 && !req.html && !req.text ? "files" : "empty";
  let parseWarnings: Array<{ code: string; message: string }> = [];
  let parseTransformations: string[] = [];
  if (req.html) {
    const parsed = parseTextHtml(
      { kind: "html", html: htmlImageResult.markedHtml ?? req.html },
      { target },
      ctx,
      { imageRefs: htmlImageResult.imageRefs }
    );
    parsedDocument = parsed.document;
    source = req.text ? "html+text" : "html";
    parseWarnings = parsed.warnings;
    parseTransformations = parsed.transformations;
  } else if (req.text) {
    if (looksLikePdfCopy(req.text)) {
      const pdf = pdfCopyToNodes(req.text, ctx, {});
      parsedDocument = {
        version: 1,
        nodes: pdf.nodes,
        sourceMeta: { source: "pdf-text", confidence: 2, transformations: [] },
      };
      source = "pdf-text";
      parseWarnings = pdf.warnings;
      parseTransformations = [];
    } else {
      const parsed = parseTextHtml({ kind: "text", text: req.text }, { target }, ctx);
      parsedDocument = parsed.document;
      source = "text";
      parseWarnings = parsed.warnings;
      parseTransformations = parsed.transformations;
    }
  }
  // Browsers often supply HTML alongside literal Markdown. Normalize the
  // sanitized text runs too; code marks/blocks and math remain shielded.
  const markdown = req.target.inCodeBlock
    ? { document: parsedDocument, transformations: [] }
    : withMarkdown(parsedDocument);
  const mathOn = flags.latex !== false;
  const upgraded = mathOn
    ? upgradeMathInDocument(markdown.document, target)
    : { document: markdown.document, warnings: [], transformations: [] as string[] };
  const transformations = [
    ...baseTransformations,
    ...parseTransformations,
    ...markdown.transformations,
    ...upgraded.transformations,
  ];
  const warnings = [...baseWarnings, ...parseWarnings, ...upgraded.warnings];
  // Image validation is intentionally deferred to the editor-owned upload pipe.
  return result(
    appendMissingImages(upgraded.document, pendingImages),
    source,
    pendingImages,
    directSelection.rejected + htmlImageResult.rejected,
    warnings,
    transformations
  );
}
