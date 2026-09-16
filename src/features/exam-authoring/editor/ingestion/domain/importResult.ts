/**
 * Phase 01 — ImportResult contract.
 *
 * Every pipeline path (adapted, empty, guarded) returns a full ImportResult:
 * AST plus confidence, transformations, suggestions, warnings, and metrics.
 * Message strings live in diagnostics.ts; this module holds shapes only.
 */
import type { ImportDocument } from "./importDocument";

export type DiagnosticCode =
  | "import.ok"
  | "import.empty"
  | "import.truncated.rows"
  | "import.truncated.cols"
  | "import.truncated.cells"
  | "import.truncated.nodes"
  | "import.truncated.depth"
  | "import.truncated.size"
  | "import.truncated.text"
  | "import.latex.invalid"
  | "import.latex.empty"
  | "import.image.staged"
  | "import.image.rejected"
  | "import.image.count-limit"
  | "import.image.aggregate-size"
  | "import.image.alt-required"
  | "import.script.stripped"
  | "import.object.stripped"
  | "import.style.stripped"
  | "import.table.split"
  | "import.list.flattened"
  | "import.heading.clamped"
  | "import.choice.filtered"
  | "import.block.degraded"
  | "import.budget.exceeded"
  | "import.timeout";

export interface ImportSuggestion {
  id: string;
  code: DiagnosticCode;
  message: string;
  fieldHint?: "prompt" | "stimulus" | "rationale" | "choices" | undefined;
}

export interface ImportWarning {
  code: DiagnosticCode;
  message: string;
  count?: number | undefined;
}

export interface ImportMetrics {
  parseMs: number;
  nodeCount: number;
  tableCells: number;
  images: number;
  equations: number;
  truncated: boolean;
}

export interface ImportResult {
  document: ImportDocument;
  confidence: 0 | 1 | 2;
  transformations: string[];
  suggestions: ImportSuggestion[];
  warnings: ImportWarning[];
  metrics: ImportMetrics;
}
