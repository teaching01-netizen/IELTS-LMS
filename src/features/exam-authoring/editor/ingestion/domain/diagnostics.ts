/**
 * Phase 01 — diagnostic code constants plus static message templates.
 *
 * Templates are fixed strings. Counts travel in ImportWarning.count;
 * pasted input is never interpolated into a message.
 */
import type { DiagnosticCode } from "./importResult";

export const DIAGNOSTIC_CODES = {
  OK: "import.ok",
  EMPTY: "import.empty",
  TRUNCATED_ROWS: "import.truncated.rows",
  TRUNCATED_COLS: "import.truncated.cols",
  TRUNCATED_CELLS: "import.truncated.cells",
  TRUNCATED_NODES: "import.truncated.nodes",
  TRUNCATED_DEPTH: "import.truncated.depth",
  TRUNCATED_SIZE: "import.truncated.size",
  TRUNCATED_TEXT: "import.truncated.text",
  LATEX_INVALID: "import.latex.invalid",
  LATEX_EMPTY: "import.latex.empty",
  IMAGE_STAGED: "import.image.staged",
  IMAGE_REJECTED: "import.image.rejected",
  IMAGE_ALT_REQUIRED: "import.image.alt-required",
  SCRIPT_STRIPPED: "import.script.stripped",
  OBJECT_STRIPPED: "import.object.stripped",
  STYLE_STRIPPED: "import.style.stripped",
  TABLE_SPLIT: "import.table.split",
  LIST_FLATTENED: "import.list.flattened",
  HEADING_CLAMPED: "import.heading.clamped",
  CHOICE_FILTERED: "import.choice.filtered",
  BLOCK_DEGRADED: "import.block.degraded",
  BUDGET_EXCEEDED: "import.budget.exceeded",
  TIMEOUT: "import.timeout",
} as const satisfies Record<string, DiagnosticCode>;

export const ALL_DIAGNOSTIC_CODES: readonly DiagnosticCode[] = Object.freeze([
  "import.ok",
  "import.empty",
  "import.truncated.rows",
  "import.truncated.cols",
  "import.truncated.cells",
  "import.truncated.nodes",
  "import.truncated.depth",
  "import.truncated.size",
  "import.truncated.text",
  "import.latex.invalid",
  "import.latex.empty",
  "import.image.staged",
  "import.image.rejected",
  "import.image.alt-required",
  "import.script.stripped",
  "import.object.stripped",
  "import.style.stripped",
  "import.table.split",
  "import.list.flattened",
  "import.heading.clamped",
  "import.choice.filtered",
  "import.block.degraded",
  "import.budget.exceeded",
  "import.timeout",
]);

export const DIAGNOSTIC_MESSAGES: Record<DiagnosticCode, string> = {
  "import.ok": "Import completed without loss.",
  "import.empty": "Nothing to import.",
  "import.truncated.rows": "Table rows exceeded the supported limit and were truncated.",
  "import.truncated.cols": "Table columns exceeded the supported limit and were truncated.",
  "import.truncated.cells": "Table cells exceeded the supported limit and were truncated.",
  "import.truncated.nodes": "Content nodes exceeded the supported limit and were truncated.",
  "import.truncated.depth": "Nested content exceeded the supported depth and was flattened.",
  "import.truncated.size": "Input exceeded the supported size and was truncated.",
  "import.truncated.text": "Text exceeded the supported length and was truncated.",
  "import.latex.invalid": "An equation could not be validated and was kept as plain text.",
  "import.latex.empty": "An empty equation was removed.",
  "import.image.staged": "An image was staged for upload.",
  "import.image.rejected": "An image could not be staged and was replaced with a placeholder.",
  "import.image.alt-required": "An image needs alternative text before the question is valid.",
  "import.script.stripped": "Executable content was removed.",
  "import.object.stripped": "Unsupported embedded content was removed.",
  "import.style.stripped": "Inline styling content was removed.",
  "import.table.split": "An oversized table was split.",
  "import.list.flattened": "A deeply nested list was flattened.",
  "import.heading.clamped": "A heading level was clamped to the supported range.",
  "import.choice.filtered": "Block content was flagged for choice-field filtering.",
  "import.block.degraded": "An unsupported block was degraded to plain text.",
  "import.budget.exceeded": "An ingestion budget was exceeded.",
  "import.timeout": "Ingestion exceeded its time budget.",
};

export function diagnosticMessage(code: DiagnosticCode): string {
  return DIAGNOSTIC_MESSAGES[code];
}
