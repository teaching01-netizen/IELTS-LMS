/**
 * Phase 01 — exam barrel.
 */
export type { ExamSemanticSlice } from "./examSemantics";
export { NoopExamSemantics } from "./examSemantics";
export {
  capSpreadsheetGrid,
  isOverCaps,
  oversizeMessage,
  SPREADSHEET_CAPS,
} from "./tableCaps";
export type { CappedGrid } from "./tableCaps";
export {
  BULLET_LINE_RE,
  CHOICE_LINE_RE,
  ORDERED_LIST_LINE_RE,
  QUESTION_LINE_RE,
  classifyLine,
} from "./choiceBoundaries";
export type { LineKind } from "./choiceBoundaries";
export { mapUnicodeMathToLatex } from "../adapters/pdfCopy";
export { analyzeWholeQuestion, bandForConfidence } from "./analyzeWholeQuestion";
export { buildSplitQuestion, type SplitBuilderOptions } from "./applyWholeQuestionSplit";
export {
  toOutcome,
  type AnalyzeWholeQuestionInput,
  type SuggestionOutcome,
  type WholeQuestionAnalysis,
  type WholeQuestionChoice,
  type WholeQuestionConfidenceBand,
} from "./wholeQuestionTypes";
