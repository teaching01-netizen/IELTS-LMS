/**
 * Phase 01 — ingestion orchestration (pure).
 *
 * Order is load-bearing and frozen: detect is implicit in RawSource.kinds,
 * then adapt (first canHandle wins over a fixed priority), then normalize
 * (composed callables), then guards, then executable strip, then aggregate.
 * Conversion to StructuredContent is out of scope and lives in conversion/.
 */
import type {
  ImportDocument,
  ImportMetadata,
} from "../domain/importDocument";
import type {
  DiagnosticCode,
  ImportMetrics,
  ImportResult,
  ImportWarning,
} from "../domain/importResult";
import { DIAGNOSTIC_MESSAGES } from "../domain/diagnostics";
import { enforceLimits } from "../security/guards";
import { stripExecutables } from "../security/policy";
import type { Normalizer } from "../normalization/normalizer";
import type { SourceAdapter } from "../adapters/adapter";
import type { PipelineContext } from "./pipelineContext";

export interface RawFileRef {
  name: string;
  mimeType: string;
  sizeBytes: number;
  refId: string;
}

export interface RawSource {
  kinds: Array<"text" | "html" | "file">;
  text?: string | undefined;
  html?: string | undefined;
  files?: RawFileRef[] | undefined;
}

export interface PipelineDeps {
  adapters: SourceAdapter[];
  normalizers: Normalizer[];
  clock?: () => number;
}

export class ImportNotImplemented extends Error {
  readonly sourceKind: string;
  constructor(sourceKind: string) {
    super("ingestion adapter not implemented: " + sourceKind);
    this.name = "ImportNotImplemented";
    this.sourceKind = sourceKind;
  }
}

const ADAPTER_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  text: 0,
  html: 1,
  spreadsheet: 2,
  image: 3,
  "pdf-text": 4,
  "pdf-file": 5,
});

function priorityOf(adapter: SourceAdapter): number {
  const rank = (ADAPTER_PRIORITY as Record<string, number>)[adapter.sourceKind];
  return typeof rank === "number" ? rank : 99;
}

function orderedAdapters(adapters: SourceAdapter[]): SourceAdapter[] {
  return [...adapters].sort((a, b) => priorityOf(a) - priorityOf(b));
}

function emptyMetadata(): ImportMetadata {
  return { source: "text", confidence: 0, transformations: [] };
}

function emptyDocument(): ImportDocument {
  return { version: 1, nodes: [], sourceMeta: emptyMetadata() };
}

function emptyResult(
  t0: number,
  clock: () => number,
  code: DiagnosticCode,
): ImportResult {
  const message = DIAGNOSTIC_MESSAGES[code];
  const warnings: ImportWarning[] =
    code === "import.empty" ? [] : [{ code, message, count: 1 }];
  return {
    document: emptyDocument(),
    confidence: 0,
    transformations: [],
    suggestions: [],
    warnings,
    metrics: {
      parseMs: clock() - t0,
      nodeCount: 0,
      tableCells: 0,
      images: 0,
      equations: 0,
      truncated: false,
    },
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function minConfidence(doc: ImportDocument): 0 | 1 | 2 {
  let min: 0 | 1 | 2 = 2;
  const visit = (level: 0 | 1 | 2): void => {
    if (level < min) min = level;
  };
  visit(doc.sourceMeta.confidence);
  return min;
}

function countNodes(doc: ImportDocument): number {
  let count = doc.nodes.length;
  const visit = (nodes: ImportDocument["nodes"]): void => {
    for (const node of nodes) {
      if (node.kind === "bulletList" || node.kind === "orderedList") {
        for (const item of node.items) {
          count += item.length;
          visit(item);
        }
      }
    }
  };
  visit(doc.nodes);
  return count;
}

function countCells(doc: ImportDocument): number {
  let cells = 0;
  for (const node of doc.nodes) {
    if (node.kind === "table") {
      for (const row of node.rows) cells += row.length;
    }
  }
  return cells;
}

function countImages(doc: ImportDocument): number {
  let images = 0;
  const visit = (nodes: ImportDocument["nodes"]): void => {
    for (const node of nodes) {
      if (node.kind === "image") images += 1;
      if (node.kind === "bulletList" || node.kind === "orderedList") {
        for (const item of node.items) visit(item);
      }
    }
  };
  visit(doc.nodes);
  return images;
}

function countEquations(doc: ImportDocument): number {
  let equations = 0;
  const visitInline = (nodes: ImportDocument["nodes"]): void => {
    for (const node of nodes) {
      if (node.kind === "paragraph" || node.kind === "heading") {
        for (const inline of node.children) {
          if (inline.kind === "inlineMath" || inline.kind === "blockMath") {
            equations += 1;
          }
        }
      } else if (node.kind === "table") {
        for (const row of node.rows) {
          for (const cell of row) {
            for (const inline of cell.children) {
              if (inline.kind === "inlineMath" || inline.kind === "blockMath") {
                equations += 1;
              }
            }
          }
        }
      } else if (node.kind === "bulletList" || node.kind === "orderedList") {
        for (const item of node.items) visitInline(item);
      }
    }
  };
  visitInline(doc.nodes);
  return equations;
}

function withMetrics(
  result: ImportResult,
  t0: number,
  clock: () => number,
  truncated: boolean,
): ImportMetrics {
  return {
    parseMs: clock() - t0,
    nodeCount: countNodes(result.document),
    tableCells: countCells(result.document),
    images: countImages(result.document),
    equations: countEquations(result.document),
    truncated: truncated || result.metrics.truncated,
  };
}

/**
 * Run detect -> adapt -> normalize -> guard -> strip -> aggregate.
 * Same input plus same context yields byte-identical JSON output.
 */
export function runIngestionPipeline(
  source: RawSource,
  ctx: PipelineContext,
  deps: PipelineDeps,
): ImportResult {
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const ordered = orderedAdapters(deps.adapters);
  const adapter = ordered.find((candidate) => {
    try {
      return candidate.canHandle(source);
    } catch {
      return false;
    }
  });
  if (!adapter) return emptyResult(t0, clock, "import.empty");

  const adapted = adapter.adapt(source, ctx);

  let normalized: ImportDocument = adapted.document;
  for (const normalizer of deps.normalizers) {
    normalized = normalizer.normalize(normalized, ctx);
  }

  const guarded = enforceLimits(normalized);
  const stripped = stripExecutables(guarded.doc);

  const mergedTransformations = dedupe([
    ...adapted.transformations,
    ...guarded.transformations,
    ...stripped.transformations,
  ]);
  const mergedWarnings: ImportWarning[] = [
    ...adapted.warnings,
    ...guarded.warnings,
    ...stripped.warnings,
  ];

  const interim: ImportResult = {
    document: stripped.doc,
    confidence: minConfidence(stripped.doc),
    transformations: mergedTransformations,
    suggestions: [...adapted.suggestions],
    warnings: mergedWarnings,
    metrics: adapted.metrics,
  };
  const truncated =
    guarded.truncated || stripped.truncated || adapted.metrics.truncated;
  return {
    ...interim,
    metrics: withMetrics(interim, t0, clock, truncated),
  };
}
