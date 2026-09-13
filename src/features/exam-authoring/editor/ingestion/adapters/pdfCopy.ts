/**
 * Phase 04 — PDF-copy normalizer (paste from PDF readers).
 *
 * Repairs hard visual-line breaks before text reaches the Phase-02
 * builders: soft-wrapped lines join with one space; true paragraph
 * boundaries survive. Choice/question/list marker lines NEVER merge into a
 * preceding line (exam semantics via exam/choiceBoundaries). Unicode math
 * passes through as text by default; convertObviousMath converts ONLY
 * whole-expression segments via a fixed symbol map. Hyphenation joins
 * conservatively (ASCII letter-hyphen + lowercase continuation, marker and
 * digit guards). Idempotent, bounded, never throws. Pure, DOM-free.
 *
 * pdfCopyToNodes maps every segment kind to plain Phase-02 paragraphs in
 * THIS phase — kind metadata travels in `segments` for Phase 08; the kind
 * split into options/fields belongs to Phase 08, not here.
 */
import type { ImportMetadata, ImportNode } from "../domain/importDocument";
import type { ImportWarning } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import type { PipelineContext } from "../application/pipelineContext";
import { parseTextHtml } from "./textHtml";
import { classifyLine, type LineKind } from "../exam/choiceBoundaries";

export interface PdfCopyOptions {
  convertObviousMath?: boolean;
  maxInputChars?: number;
  maxBlocks?: number;
}

export interface PdfCopySegment {
  text: string;
  kind: Exclude<LineKind, "blank">;
}

export interface PdfCopyResult {
  segments: PdfCopySegment[];
  appliedJoins: number;
  truncated: boolean;
  warnings: ImportWarning[];
  transformations: string[];
}

export const PDF_MAX_INPUT_CHARS = 100_000;
export const PDF_MAX_OUTPUT_BLOCKS = 300;

const TERMINAL_PUNCT_RE = /[.!?\u2026:;]['")\]\u201d\u2019]*\s*$/;
const HYPHEN_BREAK_RE = /[A-Za-z]-$/;
const LIGATURES: ReadonlyArray<readonly [string, string]> = [
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB00", "ff"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
];

const WHOLE_EXPRESSION_RE =
  /^[A-Za-z0-9+\-*/=()[\]{}\u005e_.,\s\u00d7\u00f7\u2212\u03c0\u221a\u2264\u2265\u2260\u00b1\u00b0\u00b2\u00b3\u00bd\u00bc\u00be]+$/;

const SYMBOL_TO_LATEX: ReadonlyArray<readonly [string, string]> = [
  ["\u00d7", "\\times"],
  ["\u00f7", "\\div"],
  ["\u2212", "-"],
  ["\u03c0", "\\pi"],
  ["\u221a", "\\sqrt"],
  ["\u2264", "\\le"],
  ["\u2265", "\\ge"],
  ["\u2260", "\\ne"],
  ["\u00b1", "\\pm"],
  ["\u00b0", "^{\\circ}"],
  ["\u00b2", "^{2}"],
  ["\u00b3", "^{3}"],
  ["\u00bd", "\\frac{1}{2}"],
  ["\u00bc", "\\frac{1}{4}"],
  ["\u00be", "\\frac{3}{4}"],
];

const FORM_FEED_RE = new RegExp(String.fromCharCode(12), "g");

type DisplayMathDelimiter = "bracket" | "dollar";

function isEscapedDollar(text: string, at: number): boolean {
  let backslashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/**
 * Track explicit display delimiters while repairing soft-wrapped PDF lines.
 * This deliberately ignores inline \(..\) delimiters: only display regions
 * must survive the line/paragraph normalization boundary.
 */
function nextDisplayMathDelimiter(
  text: string,
  initial: DisplayMathDelimiter | null,
): DisplayMathDelimiter | null {
  let state = initial;
  let i = 0;
  while (i < text.length) {
    if (state === "bracket") {
      if (text.startsWith("\\]", i)) {
        state = null;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (state === "dollar") {
      if (text.startsWith("$$", i) && !isEscapedDollar(text, i)) {
        state = null;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (text.startsWith("\\[", i)) {
      state = "bracket";
      i += 2;
    } else if (text.startsWith("$$", i) && !isEscapedDollar(text, i)) {
      state = "dollar";
      i += 2;
    } else {
      i += 1;
    }
  }
  return state;
}

function sanitizePdfCopy(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(FORM_FEED_RE, "\n");
  text = text.replace(/\u00ad/g, "").replace(/[\u200b-\u200d\ufeff]/g, "");
  for (const [from, to] of LIGATURES) text = text.split(from).join(to);
  const lines = text.split("\n").map((line) => line.replace(/[\u00a0]+/g, " ").replace(/[ \t]+$/g, ""));
  try {
    return lines.join("\n").normalize("NFC");
  } catch {
    return lines.join("\n");
  }
}

export function mapUnicodeMathToLatex(segment: string): string | null {
  const trimmed = segment.trim();
  if (!WHOLE_EXPRESSION_RE.test(trimmed)) return null;
  let latex = trimmed;
  for (const [symbol, replacement] of SYMBOL_TO_LATEX) latex = latex.split(symbol).join(replacement);
  const nonAscii = new RegExp("[^" + String.fromCharCode(0) + "-" + String.fromCharCode(127) + "]");
  if (nonAscii.test(latex)) return null;
  return latex;
}

export function normalizePdfLineWrap(raw: string, options: PdfCopyOptions = {}): PdfCopyResult {
  const warnings: ImportWarning[] = [];
  const transformations: string[] = [];
  const { convertObviousMath = false, maxInputChars = PDF_MAX_INPUT_CHARS, maxBlocks = PDF_MAX_OUTPUT_BLOCKS } = options;
  let truncated = false;
  let appliedJoins = 0;
  try {
    let text = sanitizePdfCopy(raw);
    if (text.length > maxInputChars) {
      const cut = text.lastIndexOf("\n", maxInputChars);
      text = text.slice(0, cut > 0 ? cut : maxInputChars);
      truncated = true;
      transformations.push("pdf.truncated-input");
      warnings.push({ code: "import.truncated.size", message: "Pasted text was truncated to " + maxInputChars + " characters.", count: 1 });
    }
    const lines = text.split("\n");
    const kinds = lines.map((line) => classifyLine(line));
    const segments: PdfCopySegment[] = [];
    let current = "";
    let currentKind: PdfCopySegment["kind"] = "text";
    let displayMath: DisplayMathDelimiter | null = null;
    const push = (): void => {
      const collapsed = current.replace(/\s+/g, " ").trim();
      if (collapsed) segments.push({ text: collapsed, kind: currentKind });
      current = "";
      currentKind = "text";
      displayMath = null;
    };
    lines.forEach((line, index) => {
      const kind = kinds[index] ?? "text";
      if (kind === "blank") {
        // Blank lines are paragraph boundaries for prose, but display math is
        // allowed to span them (common Markdown/LaTeX formatting).
        if (displayMath) {
          current += " ";
        } else if (current) {
          push();
        }
        return;
      }
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!current) {
        current = trimmed;
        currentKind = kind;
        displayMath = nextDisplayMathDelimiter(current, null);
        return;
      }
      if (HYPHEN_BREAK_RE.test(current) && kind === "text" && currentKind === "text" && !/\d$/.test(current.slice(0, -1))) {
        const beforeHyphen = current.slice(0, -1);
        if (!/ $/.test(beforeHyphen) && /^[a-z]/.test(trimmed)) {
          current = beforeHyphen + trimmed;
          displayMath = nextDisplayMathDelimiter(current, displayMath);
          appliedJoins += 1;
          return;
        }
        if (displayMath) {
          current += " " + trimmed;
          displayMath = nextDisplayMathDelimiter(current, displayMath);
          appliedJoins += 1;
          return;
        }
        push();
        current = trimmed;
        currentKind = kind;
        displayMath = nextDisplayMathDelimiter(current, null);
        return;
      }
      if (/\d-$/.test(current) && kind === "text" && currentKind === "text") {
        if (displayMath) {
          current += " " + trimmed;
          displayMath = nextDisplayMathDelimiter(current, displayMath);
          appliedJoins += 1;
          return;
        }
        push();
        current = trimmed;
        currentKind = kind;
        displayMath = nextDisplayMathDelimiter(current, null);
        return;
      }
      if (displayMath) {
        current += " " + trimmed;
        displayMath = nextDisplayMathDelimiter(current, displayMath);
        appliedJoins += 1;
        return;
      }
      if (kind !== "text" || currentKind !== "text") {
        push();
        current = trimmed;
        currentKind = kind;
        return;
      }
      if (TERMINAL_PUNCT_RE.test(current)) {
        push();
        current = trimmed;
        currentKind = kind;
        displayMath = nextDisplayMathDelimiter(current, null);
      } else {
        current += " " + trimmed;
        displayMath = nextDisplayMathDelimiter(current, displayMath);
        appliedJoins += 1;
      }
    });
    if (current) push();
    let outSegments = segments;
    if (outSegments.length > maxBlocks) {
      outSegments = outSegments.slice(0, maxBlocks);
      truncated = true;
      transformations.push("pdf.truncated-blocks");
      warnings.push({ code: "import.truncated.nodes", message: DIAGNOSTIC_MESSAGES["import.truncated.nodes"], count: 1 });
    }
    if (appliedJoins > 0) transformations.push("pdf.soft-wrap-joined:" + appliedJoins);
    void convertObviousMath;
    return { segments: outSegments, appliedJoins, truncated, warnings, transformations };
  } catch {
    return { segments: [], appliedJoins, truncated, warnings, transformations };
  }
}

export function segmentsToRaw(segments: PdfCopySegment[]): string {
  return segments.map((s) => s.text).join("\n\n");
}

export function pdfCopyToNodes(
  raw: string,
  ctx?: PipelineContext,
  options: PdfCopyOptions = {},
): { nodes: ImportNode[]; segments: PdfCopySegment[]; warnings: ImportWarning[]; truncated: boolean } {
  const normalized = normalizePdfLineWrap(raw, options);
  const target = ctx?.field === "choice" ? "choice" : "rich";
  const nodes: ImportNode[] = [];
  const meta: ImportMetadata = { source: "pdf-text", confidence: 2, transformations: [...normalized.transformations] };
  for (const segment of normalized.segments) {
    if (options.convertObviousMath === true) {
      const latex = mapUnicodeMathToLatex(segment.text);
      if (latex) {
        nodes.push({ kind: "paragraph", children: [{ kind: "inlineMath", latex, meta }], meta });
        continue;
      }
    }
    const built = parseTextHtml({ kind: "text", text: segment.text }, { target });
    nodes.push(...built.document.nodes);
  }
  return { nodes, segments: normalized.segments, warnings: [...normalized.warnings], truncated: normalized.truncated };
}
