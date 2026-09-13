/**
 * Phase 01 — domain barrel (pure types plus budget/message constants).
 */
export type {
  BlobRef,
  ImportConfidence,
  ImportDocument,
  ImportMetadata,
  ImportNode,
  ImportSourceKind,
  InlineNode,
  TableCell,
  TextMark,
} from "./importDocument";
export { IMPORT_DOCUMENT_VERSION } from "./importDocument";
export type {
  DiagnosticCode,
  ImportMetrics,
  ImportResult,
  ImportSuggestion,
  ImportWarning,
} from "./importResult";
export { INGESTION_LIMITS, IngestionBudgetExceededError } from "./limits";
export type { BudgetExceeded, IngestionBudgetKey } from "./limits";
export {
  ALL_DIAGNOSTIC_CODES,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_MESSAGES,
  diagnosticMessage,
} from "./diagnostics";
