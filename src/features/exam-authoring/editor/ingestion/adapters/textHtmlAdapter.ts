/**
 * Phase 02 — SourceAdapter wiring for text + HTML.
 *
 * Thin bridge between parseTextHtml and the Phase-01 pipeline: selects the
 * RawSource representation (html preferred when both present), runs the
 * Phase-02 path, then maps the outcome onto ImportResult. enforceLimits
 * and stripExecutables still run inside runIngestionPipeline afterwards —
 * this adapter never duplicates them. Math-looking text stays verbatim for
 * phase 03; choice-field filtering is conversion-time (phase 07), never
 * destruction here.
 */
import type { PipelineContext } from "../application/pipelineContext";
import type { RawSource } from "../application/pipeline";
import type { ImportResult } from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import type { SourceAdapter } from "./adapter";
import { parseTextHtml } from "./textHtml";

export class TextHtmlAdapter implements SourceAdapter {
  readonly sourceKind = "html" as const;

  canHandle(source: RawSource): boolean {
    if (source.kinds.includes("html") && typeof source.html === "string") return true;
    return source.kinds.includes("text") && typeof source.text === "string";
  }

  adapt(source: RawSource, ctx: PipelineContext): ImportResult {
    const t0 = Date.now();
    const useHtml = source.kinds.includes("html") && typeof source.html === "string";
    const outcome = useHtml
      ? parseTextHtml(
          { kind: "html", html: source.html as string },
          { target: ctx.field === "choice" ? "choice" : "rich" },
          ctx,
        )
      : parseTextHtml(
          { kind: "text", text: (source.text as string) ?? "" },
          { target: ctx.field === "choice" ? "choice" : "rich" },
          ctx,
        );
    const doc = outcome.document;
    let tableCells = 0;
    let images = 0;
    for (const node of doc.nodes) {
      if (node.kind === "table") {
        for (const row of node.rows) tableCells += row.length;
      }
      if (node.kind === "image") images += 1;
    }
    return {
      document: doc,
      confidence: doc.sourceMeta.confidence,
      transformations: [...outcome.transformations],
      suggestions: [],
      warnings: [...outcome.warnings],
      metrics: {
        parseMs: Date.now() - t0,
        nodeCount: doc.nodes.length,
        tableCells,
        images,
        equations: 0,
        truncated: outcome.warnings.some((w) => w.code.startsWith("import.truncated")),
      },
    };
  }
}

export function textHtmlEmptyResult(): ImportResult {
  return {
    document: {
      version: 1,
      nodes: [],
      sourceMeta: { source: "text", confidence: 0, transformations: [] },
    },
    confidence: 0,
    transformations: [],
    suggestions: [],
    warnings: [{ code: "import.empty", message: DIAGNOSTIC_MESSAGES["import.empty"] }],
    metrics: { parseMs: 0, nodeCount: 0, tableCells: 0, images: 0, equations: 0, truncated: false },
  };
}
