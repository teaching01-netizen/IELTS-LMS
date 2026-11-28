import type { PdfTarget } from "@shared/sat/pdfLayout";

/**
 * One vocabulary for the exam PDF layout editor. The staff member places
 * printed SLIDES around printed SECTIONS; the file itself is the report, not
 * a document they edit.
 */

/** Top-level report sections, in print order. */
export const PDF_SECTION_LABELS: Readonly<Record<string, string>> = {
  cover: "Cover",
  scoreReport: "Score report",
  answerSummary: "Answer summary",
  answerKey: "Answer key",
  examReview: "Exam review",
};

export const PDF_SLIDE_NOUN = "slide";

/**
 * What a conditional section depends on, in plain words. A conditional
 * section is printed for some attempts and skipped for others, so the editor
 * says which condition decides it.
 */
export function targetCondition(target: PdfTarget): string | null {
  switch (target.kind) {
    case "scoreReport":
    case "answerKey":
      return "When released";
    default:
      return null;
  }
}

/** The same condition, in full, for the place where there is room for it. */
export function targetConditionDetail(target: PdfTarget): string | null {
  switch (target.kind) {
    case "scoreReport":
      return "Only when the score report is released to the student.";
    case "answerKey":
      return "Only when the answer key is released to the student.";
    default:
      return null;
  }
}

/** The report section a placement belongs to. */
export function targetSectionLabel(target: PdfTarget): string {
  if (target.kind === "reviewSubject" || target.kind === "reviewModule") return "Exam review";
  return PDF_SECTION_LABELS[target.kind] ?? "Section";
}

/**
 * Label for a placement whose section no longer exists in this exam. The raw
 * key never reaches the screen: it is an implementation detail, and staff act
 * on the sentence, not the slug.
 */
export function unavailableTargetLabel(target: PdfTarget): string {
  if (target.kind === "reviewModule") {
    return `${humanize(target.sectionKey)} · ${humanize(target.moduleKey)}`;
  }
  if (target.kind === "reviewSubject") return humanize(target.sectionKey);
  return PDF_SECTION_LABELS[target.kind] ?? "Section";
}

function humanize(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** Where a slide prints, in words. */
export function slidePlacementLabel(side: "before" | "after", sectionLabel: string): string {
  return side === "before" ? `Before ${sectionLabel}` : `After ${sectionLabel}`;
}

/** How many slides print at one placement, in words. */
export function slideCountLabel(count: number): string {
  if (count <= 0) return "No slides";
  return count === 1 ? "1 slide" : `${count} slides`;
}
