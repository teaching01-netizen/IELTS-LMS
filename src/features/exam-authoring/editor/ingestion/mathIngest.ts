/**
 * Phase 03 — paragraph mixed text+math upgrade.
 *
 * splitParagraphMixed runs the explicit-delimiter scan per paragraph, after
 * safely stitching compatible paragraphs that contain one split display block,
 * then judgeRawLatex ONLY on remaining text
 * segments, skipping code-marked spans. Every latex candidate passes
 * validateLatex: ok -> inlineMath/blockMath inline nodes; fail -> text
 * (original bytes preserved) plus an import.latex.invalid warning quoting
 * the KaTeX error (capped 120 chars). WIRING NOTE (phase 07): call
 * upgradeMathInDocument on Phase-02 output before conversion; standalone
 * parseMathText covers the raw-text path. Choice-target display math
 * downgrades to inline (capability rule); downgrade failures stay text.
 */
import type {
  ImportDocument,
  ImportMetadata,
  ImportNode,
  InlineNode,
  TextMark,
} from "./domain/importDocument";
import type { ImportWarning } from "./domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "./domain/diagnostics";
import { INGESTION_LIMITS } from "./domain/limits";
import { scanDelimitersWithUnclosed } from "./mathDelimiters";
import { judgeRawLatex, validateLatex } from "./mathConfidence";

export type MathTarget = "rich" | "choice";

export interface MathUpgradeOutcome {
  document: ImportDocument;
  warnings: ImportWarning[];
  transformations: string[];
}

function meta(source: ImportMetadata["source"]): ImportMetadata {
  return { source, confidence: 2, transformations: [] };
}

function latexWarning(latex: string, error: string): ImportWarning {
  return {
    code: "import.latex.invalid",
    message: DIAGNOSTIC_MESSAGES["import.latex.invalid"] + " " + error.slice(0, 120),
    count: 1,
  };
}

interface TextSegment {
  text: string;
  marks: TextMark[];
  code: boolean;
}

function splitInlineToSegments(inlines: InlineNode[]): TextSegment[] {
  const out: TextSegment[] = [];
  for (const inline of inlines) {
    if (inline.kind !== "text") {
      out.push({ text: "", marks: [], code: true });
      continue;
    }
    out.push({ text: inline.text, marks: [...inline.marks], code: inline.marks.includes("code") });
  }
  return out;
}

function sameMarks(left: TextMark[], right: TextMark[]): boolean {
  return left.length === right.length && left.every((mark, index) => mark === right[index]);
}

interface StitchableParagraph {
  node: Extract<ImportNode, { kind: "paragraph" }>;
  text: string;
  marks: TextMark[];
  meta: ImportMetadata;
}

function getStitchableParagraph(node: ImportNode): StitchableParagraph | null {
  if (node.kind !== "paragraph" || node.children.length === 0) return null;
  const first = node.children[0];
  if (first?.kind !== "text" || first.marks.includes("code")) return null;
  for (const child of node.children) {
    if (
      child.kind !== "text" ||
      child.marks.includes("code") ||
      !sameMarks(child.marks, first.marks)
    )
      return null;
  }
  return {
    node,
    text: node.children.map((child) => (child.kind === "text" ? child.text : "")).join(""),
    marks: [...first.marks],
    meta: first.meta,
  };
}

function hasUnclosedDisplayDelimiter(text: string): boolean {
  // Cross-block stitching is intentionally limited to \[...\]. The existing
  // ingestion contract keeps $$...$$ pairing within one source block, while
  // PDF normalization handles multi-line dollar displays before this stage.
  return scanDelimitersWithUnclosed(text).unclosed.some(
    (delimiter) => delimiter.kind === "display-bracket"
  );
}

/**
 * HTML paste can represent one LaTeX display as several block elements, for
 * example <p>\\[</p><p>formula.</p><p>\\]</p>. Join only compatible,
 * non-code text paragraphs while a display delimiter is open so the explicit
 * scanner receives one stable source string. All other block boundaries stay
 * intact.
 */
export function stitchDisplayMathParagraphs(nodes: ImportNode[]): ImportNode[] {
  const out: ImportNode[] = [];
  let pending: StitchableParagraph[] = [];
  let pendingText = "";

  const flushPending = (): void => {
    if (pending.length === 0) return;
    out.push(...pending.map((entry) => entry.node));
    pending = [];
    pendingText = "";
  };

  for (const node of nodes) {
    const stitchable = getStitchableParagraph(node);
    if (pending.length === 0) {
      if (stitchable && hasUnclosedDisplayDelimiter(stitchable.text)) {
        pending = [stitchable];
        pendingText = stitchable.text;
      } else {
        out.push(node);
      }
      continue;
    }

    if (!stitchable) {
      flushPending();
      out.push(node);
      continue;
    }

    const candidateText = pendingText + " " + stitchable.text;
    pending.push(stitchable);
    pendingText = candidateText;
    if (hasUnclosedDisplayDelimiter(pendingText)) continue;

    const first = pending[0];
    if (!first) {
      flushPending();
      continue;
    }
    out.push({
      ...first.node,
      children: [{ kind: "text", text: pendingText.trim(), marks: first.marks, meta: first.meta }],
    });
    pending = [];
    pendingText = "";
  }

  flushPending();
  return out;
}

export function upgradeInlineList(
  inlines: InlineNode[],
  target: MathTarget,
  source: ImportMetadata["source"]
): { inlines: InlineNode[]; warnings: ImportWarning[]; mathCount: number } {
  const warnings: ImportWarning[] = [];
  const out: InlineNode[] = [];
  let mathCount = 0;
  for (const inline of inlines) {
    if (inline.kind !== "text") {
      out.push(inline);
      continue;
    }
    if (inline.marks.includes("code")) {
      out.push(inline);
      continue;
    }
    const { matches, unclosed } = scanDelimitersWithUnclosed(inline.text);
    for (const u of unclosed) {
      void u;
      warnings.push({
        code: "import.latex.invalid",
        message: "An unclosed equation delimiter was kept as plain text.",
        count: 1,
      });
    }
    if (matches.length === 0) {
      const verdict = judgeRawLatex(inline.text);
      if (verdict && verdict.latex !== inline.text.trim()) {
        out.push(inline);
        continue;
      }
      if (verdict) {
        if (verdict.latex.length > INGESTION_LIMITS.latexChars) {
          warnings.push({
            code: "import.truncated.text",
            message: DIAGNOSTIC_MESSAGES["import.truncated.text"],
            count: 1,
          });
          out.push(inline);
          continue;
        }
        const validation = validateLatex(verdict.latex);
        if (validation.ok) {
          out.push({ kind: "inlineMath", latex: verdict.latex, meta: meta(source) });
          mathCount += 1;
        } else {
          warnings.push(latexWarning(verdict.latex, validation.error));
          out.push(inline);
        }
        continue;
      }
      out.push(inline);
      continue;
    }
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        out.push({
          kind: "text",
          text: inline.text.slice(cursor, match.start),
          marks: [...inline.marks],
          meta: meta(source),
        });
      }
      const latex = match.latex.trim();
      if (latex.length > INGESTION_LIMITS.latexChars) {
        warnings.push({
          code: "import.truncated.text",
          message: DIAGNOSTIC_MESSAGES["import.truncated.text"],
          count: 1,
        });
        out.push({
          kind: "text",
          text: inline.text.slice(match.start, match.end),
          marks: [...inline.marks],
          meta: meta(source),
        });
      } else {
        const validation = validateLatex(latex);
        if (validation.ok) {
          const display = match.display && target === "rich";
          out.push({ kind: display ? "blockMath" : "inlineMath", latex, meta: meta(source) });
          mathCount += 1;
        } else {
          warnings.push(latexWarning(match.latex, validation.error));
          out.push({
            kind: "text",
            text: inline.text.slice(match.start, match.end),
            marks: [...inline.marks],
            meta: meta(source),
          });
        }
      }
      cursor = match.end;
    }
    if (cursor < inline.text.length) {
      out.push({
        kind: "text",
        text: inline.text.slice(cursor),
        marks: [...inline.marks],
        meta: meta(source),
      });
    }
  }
  void splitInlineToSegments;
  return {
    inlines: out.filter((n) => n.kind !== "text" || n.text.length > 0),
    warnings,
    mathCount,
  };
}

export function upgradeMathInDocument(
  doc: ImportDocument,
  target: MathTarget = "rich"
): MathUpgradeOutcome {
  const warnings: ImportWarning[] = [];
  const transformations: string[] = [];
  let total = 0;
  const upgradeNodes = (nodes: ImportNode[]): ImportNode[] =>
    stitchDisplayMathParagraphs(nodes).map((node) => {
      if (node.kind === "paragraph" || node.kind === "heading") {
        const upgraded = upgradeInlineList(node.children, target, node.meta.source);
        warnings.push(...upgraded.warnings);
        total += upgraded.mathCount;
        return { ...node, children: upgraded.inlines };
      }
      if (node.kind === "bulletList" || node.kind === "orderedList") {
        return { ...node, items: node.items.map((item) => upgradeNodes(item)) };
      }
      if (node.kind === "table") {
        return {
          ...node,
          rows: node.rows.map((row) =>
            row.map((cell) => {
              const upgraded = upgradeInlineList(cell.children, target, node.meta.source);
              warnings.push(...upgraded.warnings);
              total += upgraded.mathCount;
              return { ...cell, children: upgraded.inlines };
            })
          ),
        };
      }
      if (node.kind === "codeBlock") return node;
      return node;
    });
  const nodes = upgradeNodes(doc.nodes);
  if (total > 0) transformations.push("math.upgraded:" + total);
  return {
    document: {
      ...doc,
      nodes,
      sourceMeta: {
        ...doc.sourceMeta,
        transformations: [...doc.sourceMeta.transformations, ...transformations],
      },
    },
    warnings,
    transformations,
  };
}

export function parseMathText(text: string, target: MathTarget = "rich"): MathUpgradeOutcome {
  const sourceMeta: ImportMetadata = { source: "text", confidence: 2, transformations: [] };
  const doc: ImportDocument = {
    version: 1,
    nodes: text.trim()
      ? [
          {
            kind: "paragraph",
            children: [{ kind: "text", text, marks: [], meta: sourceMeta }],
            meta: sourceMeta,
          },
        ]
      : [],
    sourceMeta,
  };
  return upgradeMathInDocument(doc, target);
}
