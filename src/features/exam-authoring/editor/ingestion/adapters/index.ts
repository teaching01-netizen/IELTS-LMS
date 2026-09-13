/**
 * Phase 01 — adapters barrel.
 */
export type { SourceAdapter } from "./adapter";
export { TextAdapterStub } from "./textAdapter";
export { HtmlAdapterStub } from "./htmlAdapter";
export { TextHtmlAdapter } from "./textHtmlAdapter";
export {
  detectSpreadsheetPayload,
  parseSpreadsheetCsv,
  parseSpreadsheetHtml,
  parseSpreadsheetTsv,
  promoteFirstRowToHeader,
  spreadsheetClipboardToTable,
  spreadsheetGridToTableNode,
} from "./spreadsheet";
export type {
  SpreadsheetClipboard,
  SpreadsheetGrid,
  SpreadsheetResult,
  SpreadsheetSource,
} from "./spreadsheet";
