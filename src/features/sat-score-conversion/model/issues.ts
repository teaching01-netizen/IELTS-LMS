import { ApiError } from "../../../shared/api-client/errors";
import type { ScoreConversionIssue, SectionKey } from "../contracts/scoreConversion";
import { cellKey } from "./quickValidate";

/** Server findings addressed to one table's cells, as `row,col` -> message. */
export function issuesForTable(issues: readonly ScoreConversionIssue[], section: SectionKey, tableId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const issue of issues) {
    if (issue.section !== section || issue.tableId !== tableId || issue.row === undefined) continue;
    const key = cellKey(issue.row, issue.col ?? 0);
    if (!out.has(key)) out.set(key, issue.message);
  }
  return out;
}

/** Findings that are not about one cell (assignments, empty policy, calibration source). */
export function tableLevelIssues(issues: readonly ScoreConversionIssue[]): ScoreConversionIssue[] {
  return issues.filter((issue) => issue.row === undefined);
}

export function mergeFeedback(...maps: ReadonlyArray<ReadonlyMap<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const map of maps) for (const [key, value] of map) if (!out.has(key)) out.set(key, value);
  return out;
}

export type ConversionErrorKind = "stale-draft" | "stale-base" | "superseded" | "not-draft" | "validation" | "forbidden" | "timeout" | "other";

export interface ConversionError {
  kind: ConversionErrorKind;
  message: string;
  issues: ScoreConversionIssue[];
}

/** Server answers -> admin-facing copy and a kind the page reacts to (never the raw backend string). */
export function describeError(error: unknown): ConversionError {
  if (!(error instanceof ApiError)) return { kind: "other", message: "Something went wrong. Try again.", issues: [] };
  const raw = error.details?.["errors"];
  const issues = Array.isArray(raw) ? (raw as ScoreConversionIssue[]) : [];
  switch (error.code) {
    case "PRECONDITION_FAILED":
      return { kind: "stale-draft", message: "This draft was changed in another tab or by another administrator. Reload the latest version before saving.", issues };
    case "STALE_BASE":
      return { kind: "stale-base", message: "Another administrator published a newer version after this draft was created. Start a new draft from the active version and re-apply your edits.", issues };
    case "REVISION_SUPERSEDED":
      return { kind: "superseded", message: "A later version has been activated since. Restore this version as a new draft to activate it again.", issues };
    case "NOT_A_DRAFT":
      return { kind: "not-draft", message: "This version is already published and cannot be edited. Create a new draft instead.", issues };
    case "VALIDATION_ERROR":
      return { kind: "validation", message: issues.length > 0 ? "The table has errors. Fix the highlighted cells and try again." : error.message, issues };
    default:
      break;
  }
  if (error.status === 403) return { kind: "forbidden", message: "Only administrators can change the score conversion.", issues };
  if (error.status === 503) return { kind: "timeout", message: "The impact report took too long. Try again outside exam hours.", issues };
  return { kind: "other", message: error.requestId ? `Something went wrong (ref ${error.requestId}).` : "Something went wrong. Try again.", issues };
}
