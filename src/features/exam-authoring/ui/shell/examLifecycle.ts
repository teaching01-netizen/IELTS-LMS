import type { SatStatusTone } from "@/src/products/sat/ui/SatPage";
import type { AssessmentReleaseState } from "../../contracts/release";

export interface ExamLifecycleCopy {
  /** Short state name, e.g. "Published · Version 2". */
  label: string;
  /** Extra sentence for the title attribute / secondary text. */
  detail: string | null;
  tone: SatStatusTone;
}

/**
 * One lifecycle vocabulary for every exam surface (docs/ui-improve.md §1).
 * Saving status is a separate indicator and is NEVER folded into this copy.
 */
export function describeExamLifecycle(
  releaseState: Pick<AssessmentReleaseState, "state" | "currentPublishedVersion" | "access"> | null | undefined,
): ExamLifecycleCopy {
  if (!releaseState) return { label: "Draft", detail: null, tone: "draft" };
  const version = releaseState.currentPublishedVersion?.versionNumber;
  const versionLabel = typeof version === "number" ? `Version ${version}` : null;
  switch (releaseState.state) {
    case "never_published":
      return { label: "Draft", detail: "Not published yet", tone: "draft" };
    case "unpublished_changes":
      return {
        label: "Unpublished changes",
        detail: versionLabel ? `${versionLabel} remains available to students` : "The published version remains available",
        tone: "changes",
      };
    case "published_current":
      if (releaseState.access.totalLinks === 0) {
        return {
          label: versionLabel ? `Published · ${versionLabel} · No rooms yet` : "Published · No rooms yet",
          detail: "Create a room so students can check in",
          tone: "info",
        };
      }
      return {
        label: versionLabel ? `Published · ${versionLabel}` : "Published",
        detail: null,
        tone: "published",
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

/** Delivery, optionally opening the create form for a specific just-published version. */
export function examDeliveryPath(examId: string, create?: DeliveryTarget): string {
  const base = examWorkspacePath(examId, "delivery");
  if (!create) return base;
  const params = new URLSearchParams({
    new: "1",
    version: create.versionId,
    versionNumber: String(create.versionNumber),
    scope: create.publishScope,
  });
  return `${base}?${params.toString()}`;
}

/**
 * Where "Create room" leads from any exam surface. With a target it pins
 * the setup to the exact version a publish just returned.
 */
export function deliveryDestination(examId: string, target?: DeliveryTarget): string {
  return target ? examDeliveryPath(examId, target) : `${examWorkspacePath(examId, "delivery")}?new=1`;
}

export function parseDeliveryCreate(params: URLSearchParams): DeliveryTarget | "any" | null {
  if (params.get("new") !== "1") return null;
  const versionId = params.get("version");
  const versionNumber = Number(params.get("versionNumber"));
  const scope = params.get("scope");
  if (!versionId || !Number.isInteger(versionNumber) || versionNumber < 1) return "any";
  if (scope !== "full" && scope !== "reading-writing" && scope !== "math") return "any";
  return { versionId, versionNumber, publishScope: scope };
}

/**
 * Results are readable by admin, grader and proctor, but the exam workspace is
 * reachable by admin and builder only. A builder therefore must not be shown a
 * Responses tab: the shell never grants access the route table does not.
 */
export function canViewExamResponses(role: string | null | undefined): boolean {
  return role === "admin";
}
