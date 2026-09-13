/**
 * Phase 04 — exam line-boundary semantics (choice / question / list).
 *
 * Exam knowledge lives here, not in the pdfCopy adapter: which line shapes
 * must NEVER merge into a preceding soft-wrapped line. Order matters:
 * choice is tested before ordered-list ("B. text" is a choice, not item 2).
 * Pure, DOM-free.
 */

export type LineKind = "blank" | "choice" | "question" | "list" | "text";

const CHOICE_TRAIL = "[.)" + ":" + "\\-\u2013\u2014\\s]";
const QUESTION_TRAIL = "[.)" + ":" + "\\-\u2013\u2014]";
const ORDERED_TRAIL = "[.)" + ":" + "]";
export const CHOICE_LINE_RE = new RegExp(
  "^\\s*(?:\\(?([A-Da-d])\\)?" + CHOICE_TRAIL + "\\s*|\\[([A-Da-d])\\]\\s*)",
);
export const QUESTION_LINE_RE = new RegExp(
  "^\\s*(?:Q(?:uestion)?\\s*)?\\d{1,3}\\s*" + QUESTION_TRAIL + "\\s+\\S",
);
export const BULLET_LINE_RE = /^[\s\u00a0]*[\u2022\u25aa\u2023*\-\u2013\u2014]\s+\S/;
export const ORDERED_LIST_LINE_RE = new RegExp("^[\\s\u00a0]*\\d{1,3}" + ORDERED_TRAIL + "\\s+\\S");

export function classifyLine(line: string): LineKind {
  if (line.replace(/[\s\u00a0]/g, "").length === 0) return "blank";
  if (CHOICE_LINE_RE.test(line)) return "choice";
  if (QUESTION_LINE_RE.test(line)) return "question";
  if (BULLET_LINE_RE.test(line) || ORDERED_LIST_LINE_RE.test(line)) return "list";
  return "text";
}
