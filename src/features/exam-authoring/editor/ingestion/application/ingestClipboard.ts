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
import { extractHtmlImageRefs } from "../adapters/htmlImageRefs";
import { fetchHtmlImagesAsFiles } from "../adapters/fetchHtmlImagesAsFiles";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";

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
  pendingImages: File[];
  pendingImageAlts: string[];
  rejectedImages: number;
  warnings: Array<{ code: string; message: string }>;
  transformations: string[];
  stats: { blockCount: number; imageCount: number; mathCount: number; tableCount: number };
}

const EMPTY_DOC: ImportDocument = {
  version: 1,
  nodes: [],
  sourceMeta: { source: "text", confidence: 0, transformations: [] },
};

function statsOf(doc: ImportDocument, imageCount = 0): IngestClipboardResult["stats"] {
  let tables = 0;
  let equations = 0;
  const visit = (nodes: ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "table") tables += 1;
      if (node.kind === "paragraph" || node.kind === "heading") {
        for (const inline of node.children)
          if (inline.kind === "inlineMath" || inline.kind === "blockMath") equations += 1;
      } else if (node.kind === "bulletList" || node.kind === "orderedList") {
        for (const item of node.items) visit(item);
      }
    }
  };
  visit(doc.nodes);
  return { blockCount: doc.nodes.length, imageCount, mathCount: equations, tableCount: tables };
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
function warning(code: string, count = 1): { code: string; message: string } {
  const message =
    DIAGNOSTIC_MESSAGES[code as keyof typeof DIAGNOSTIC_MESSAGES] ??
    "Some pasted content could not be imported.";
  return { code, message: count > 1 ? message + " (" + count + ")" : message };
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
  enabled: boolean
): Promise<{
  files: File[];
  alts: string[];
  rejected: number;
  transformations: string[];
  warnings: Array<{ code: string; message: string }>;
}> {
  if (!html || !enabled)
    return { files: [], alts: [], rejected: 0, transformations: [], warnings: [] };
  const extracted = extractHtmlImageRefs(html);
  if (extracted.refs.length === 0 && extracted.truncated === 0)
    return { files: [], alts: [], rejected: 0, transformations: [], warnings: [] };
  const fetched = await fetchHtmlImagesAsFiles(extracted.refs);
  const rejected = fetched.rejected.length + extracted.truncated;
  const transformations = [
    ...(fetched.images.length > 0 ? ["html.image-extracted:" + fetched.images.length] : []),
    ...(rejected > 0 ? ["html.image-rejected:" + rejected] : []),
  ];
  return {
    files: fetched.images.map((item) => item.file),
    alts: fetched.images.map((item) => item.alt),
    rejected,
    transformations,
    warnings: rejected > 0 ? [warning("import.image.rejected", rejected)] : [],
  };
}

function result(
  document: ImportDocument,
  source: IngestSource,
  pendingImages: File[],
  pendingImageAlts: string[],
  rejectedImages: number,
  warnings: Array<{ code: string; message: string }>,
  transformations: string[]
): IngestClipboardResult {
  return {
    document,
    source,
    pendingImages,
    pendingImageAlts,
    rejectedImages,
    warnings,
    transformations,
    stats: statsOf(document, pendingImages.length),
  };
}

export async function ingestClipboard(
  req: IngestClipboardRequest,
  ctx: PipelineContext
): Promise<IngestClipboardResult> {
  const flags = req.flags ?? {};
  const empty: IngestClipboardResult = {
    document: EMPTY_DOC,
    source: "empty",
    pendingImages: [],
    pendingImageAlts: [],
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
  const imageAlts = imageFiles.map(() => "");
  const target = req.target.inChoiceEditor ? "choice" : "rich";
  let htmlImageResult = {
    files: [] as File[],
    alts: [] as string[],
    rejected: 0,
    transformations: [] as string[],
    warnings: [] as Array<{ code: string; message: string }>,
  };
  let pendingImages: File[] = [...imageFiles];
  let pendingImageAlts: string[] = [...imageAlts];
  let baseWarnings: Array<{ code: string; message: string }> = [];
  let baseTransformations: string[] =
    imageFiles.length > 0 ? ["clipboard.files:" + imageFiles.length] : [];
  let imageResultLoaded = false;
  const loadHtmlImages = async (): Promise<void> => {
    if (imageResultLoaded) return;
    htmlImageResult = await htmlImages(req.html, flags.images !== false);
    pendingImages = [...imageFiles, ...htmlImageResult.files];
    pendingImageAlts = [...imageAlts, ...htmlImageResult.alts];
    baseWarnings = [...htmlImageResult.warnings];
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
        const rejectedImages = htmlImageResult.rejected;
        return result(
          upgraded.document,
          "spreadsheet",
          pendingImages,
          pendingImageAlts,
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
          pendingImages,
          pendingImageAlts,
          rejectedImages: htmlImageResult.rejected,
          warnings: [...baseWarnings, ...sheet.warnings],
          transformations: [...baseTransformations, ...sheet.transformations].filter(
            (item) => item !== "clipboard.files:0"
          ),
          stats: statsOf(EMPTY_DOC, pendingImages.length),
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
    const parsed = parseTextHtml({ kind: "html", html: req.html }, { target }, ctx);
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
    upgraded.document,
    source,
    pendingImages,
    pendingImageAlts,
    htmlImageResult.rejected,
    warnings,
    transformations
  );
}
