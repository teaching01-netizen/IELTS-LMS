import type { SatStatusTone } from "@/src/products/sat/ui/SatPage";
import type { AssessmentReleaseState } from "../../contracts/release";

export interface ExamLifecycleCopy {
  /** Short state name, e.g. "Published · Version 2". */
  label: string;
  /** Extra sentence for the title attribute / secondary text. */
  detail: string | null;
  tone: SatStatusTone;
  /** The release state the copy describes; `null` while it is unknown. Drives the header's primary action. */
  state: AssessmentReleaseState["state"] | null;
}

/**
 * One lifecycle vocabulary for every exam surface (docs/ui-improve.md §1).
 * Saving status is a separate indicator and is NEVER folded into this copy.
 */
export function describeExamLifecycle(
  releaseState: Pick<AssessmentReleaseState, "state" | "currentPublishedVersion" | "access"> | null | undefined,
): ExamLifecycleCopy {
  if (!releaseState) return { label: "Editing", detail: null, tone: "draft", state: null };
  const version = releaseState.currentPublishedVersion?.versionNumber;
  const versionLabel = typeof version === "number" ? `Version ${version}` : null;
  // Staff never publish: a room captures the latest saved exam. The version
  // number is secondary detail, never the headline.
  switch (releaseState.state) {
    case "never_published":
      return { label: "Editing", detail: "Changes are saved automatically. A room uses the latest saved exam.", tone: "draft", state: "never_published" };
    case "unpublished_changes":
      return {
        label: "Editing",
        detail: versionLabel
          ? `Existing rooms keep ${versionLabel}. A new room uses your latest saved changes.`
          : "A new room uses your latest saved changes.",
        tone: "changes",
        state: "unpublished_changes",
      };
    case "published_current":
      if (releaseState.access.totalLinks === 0) {
        return {
          label: "Ready · No rooms yet",
          detail: "Create a room so students can check in",
          tone: "info",
          state: "published_current",
        };
      }
      return {
        label: "Rooms available",
        detail: versionLabel ? `Latest room exam: ${versionLabel}` : null,
        tone: "published",
        state: "published_current",
      };
  }
}

export type ExamWorkspaceTab = "questions" | "delivery" | "responses" | "settings";

/** Delivery keeps the long-standing /access URL so existing links and bookmarks still work. */
const TAB_SEGMENT: Record<ExamWorkspaceTab, string> = {
  questions: "",
  delivery: "/access",
  responses: "/responses",
  settings: "/settings",
};

export function examWorkspacePath(examId: string, tab: ExamWorkspaceTab): string {
  return `/sat/exams/${encodeURIComponent(examId)}${TAB_SEGMENT[tab]}`;
}

/** The exact version a student-access setup should target (the one a publish just returned). */
export interface DeliveryTarget {
  versionId: string;
  versionNumber: number;
  publishScope: "full" | "reading-writing" | "math";
}

/** Where "Create room" leads from any exam surface: Rooms, with the create form open. */
export function deliveryDestination(examId: string): string {
  return `${examWorkspacePath(examId, "delivery")}?new=1`;
}

/**
 * Results are readable by admin, grader and proctor, but the exam workspace is
 * reachable by admin and builder only. A builder therefore must not be shown a
 * Responses tab: the shell never grants access the route table does not.
 */
export function canViewExamResponses(role: string | null | undefined): boolean {
  return role === "admin";
}
