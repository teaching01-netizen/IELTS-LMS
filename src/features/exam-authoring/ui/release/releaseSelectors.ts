import type {
  AssessmentAuthoringShell,
  AssessmentValidationReport,
} from "../../contracts/assessment";
import type {
  AssessmentReleaseLifecycleState,
  AssessmentReleaseState,
} from "../../contracts/release";

export type ReleaseHeroState =
  | "published"
  | "unpublished"
  | "checking"
  | "ready"
  | "review"
  | "preparing";

export const MAX_PUBLISH_NOTES_LENGTH = 1000;

/** True only when the report was computed for the exact visible draft. */
export function isReadinessFresh(
  readiness: AssessmentValidationReport | null | undefined,
  shell: Pick<AssessmentAuthoringShell, "versionId" | "versionRevision"> | null | undefined,
): boolean {
  if (!readiness || !shell) return false;
  return (
    readiness.versionId === shell.versionId &&
    readiness.versionRevision === shell.versionRevision
  );
}

/**
 * Errors/warnings are only actionable for the visible draft. When the report
 * is stale we intentionally return empty lists and force callers through
 * `getPublishBlockers` (which reports staleness) instead of showing a
 * misleading "0 blockers" state.
 */
export function getFreshBlockers(
  readiness: AssessmentValidationReport | null | undefined,
  fresh: boolean,
): AssessmentValidationReport["errors"] {
  if (!fresh || !readiness) return [];
  return readiness.errors;
}

export function getFreshWarnings(
  readiness: AssessmentValidationReport | null | undefined,
  fresh: boolean,
): AssessmentValidationReport["warnings"] {
  if (!fresh || !readiness) return [];
  return readiness.warnings;
}

export interface PublishGateInput {
  lifecycleState: AssessmentReleaseLifecycleState | null | undefined;
  readinessFresh: boolean;
  readinessValid: boolean;
  blockerCount: number;
  dirtyCount: number;
  isPublishing: boolean;
  canEdit: boolean;
  canPublishExam: boolean;
}

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * Single source of truth for every precondition that blocks publishing.
 * Used by both SatDeliveryReleasePage and ReleaseGateCard so the two
 * surfaces can never drift apart. Order is stable: permissions first
 * (they cannot be fixed on this page), then readiness, then local edits.
 */
export function getPublishBlockers(input: PublishGateInput): string[] {
  const reasons: string[] = [];
  if (!input.canPublishExam) {
    reasons.push("You do not have permission to publish this exam");
  }
  if (!input.canEdit) {
    reasons.push("You do not have permission to edit delivery settings");
  }
  if (input.lifecycleState === "published_current") {
    reasons.push("This draft is already published");
  }
  if (input.blockerCount > 0) {
    reasons.push(
      `${input.blockerCount} blocking ${pluralize(input.blockerCount, "issue")} to resolve`,
    );
  }
  if (!input.readinessFresh) {
    reasons.push("Publish checks are stale \u2014 refresh them on the release page");
  } else if (!input.readinessValid) {
    reasons.push("Publish checks are failing \u2014 resolve the flagged items");
  }
  const safeDirty = Math.max(0, Math.floor(input.dirtyCount));
  if (safeDirty > 0) {
    reasons.push(
      `${safeDirty} unsaved delivery ${pluralize(safeDirty, "section")} \u2014 save before publishing`,
    );
  }
  if (input.isPublishing) {
    reasons.push("Publishing is in progress");
  }
  return reasons;
}

export function canPublishFromBlockers(blockers: readonly string[]): boolean {
  return blockers.length === 0;
}

export interface HeroInput {
  releaseState: AssessmentReleaseState;
  readinessValid: boolean;
  hasReadiness: boolean;
  isChecking: boolean;
  dirtyCount: number;
}

export function getHeroState(input: HeroInput): ReleaseHeroState {
  const publishedCurrent =
    input.releaseState.state === "published_current" && input.dirtyCount === 0;
  if (publishedCurrent) return "published";
  // Mirrors the page's original heading logic exactly: "Unpublished changes"
  // requires a live release to contrast against. A dirty never-published
  // draft falls through to checking/ready/review/preparing (with a
  // save-first description), preserving existing behavior.
  const changed =
    input.releaseState.state === "unpublished_changes" || input.dirtyCount > 0;
  if (changed && input.releaseState.currentPublishedVersion) return "unpublished";
  if (input.isChecking) return "checking";
  if (input.readinessValid && input.dirtyCount === 0 && input.hasReadiness) return "ready";
  if (input.hasReadiness) return "review";
  return "preparing";
}

export function getHeroCopy(
  state: ReleaseHeroState,
  input: Pick<
    HeroInput,
    "releaseState" | "dirtyCount" | "readinessValid"
  >,
): { heading: string; description: string } {
  const publishedVersion = input.releaseState.currentPublishedVersion;
  const dirtyLabel =
    input.dirtyCount === 1 ? "delivery section" : "delivery sections";
  switch (state) {
    case "published":
      return {
        heading: "Published",
        description: publishedVersion
          ? `Version ${publishedVersion.versionNumber} is what students receive.`
          : "This draft is published.",
      };
    case "unpublished":
      if (input.dirtyCount > 0 && publishedVersion) {
        return {
          heading: "Unpublished changes",
          description:
            `Save ${input.dirtyCount} ${dirtyLabel} before publishing. ` +
            `Students still receive Version ${publishedVersion.versionNumber}.`,
        };
      }
      if (input.dirtyCount > 0) {
        return {
          heading: "Unpublished changes",
          description: `Save ${input.dirtyCount} ${dirtyLabel} before publishing.`,
        };
      }
      return {
        heading: "Unpublished changes",
        description: publishedVersion
          ? `Students still receive Version ${publishedVersion.versionNumber}.`
          : "Unpublished changes are waiting to be released.",
      };
    case "checking":
      return {
        heading: "Checking publish readiness\u2026",
        description: "Validating the draft against the publish requirements.",
      };
    case "ready":
      if (input.dirtyCount > 0) {
        return {
          heading: "Ready to publish",
          description: `Save ${input.dirtyCount} ${dirtyLabel} before publishing.`,
        };
      }
      return {
        heading: "Ready to publish",
        description: publishedVersion
          ? `All checks pass. Publishing creates Version ${publishedVersion.versionNumber + 1}.`
          : "Everything required for the first release is ready.",
      };
    case "review":
      if (input.dirtyCount > 0) {
        return {
          heading: "Review required",
          description: `Save ${input.dirtyCount} ${dirtyLabel} before publishing.`,
        };
      }
      return {
        heading: "Review required",
        description: "Resolve blocking issues before publishing.",
      };
    case "preparing":
    default:
      if (input.dirtyCount > 0) {
        return {
          heading: "Preparing release checks",
          description: `Save ${input.dirtyCount} ${dirtyLabel} before publishing.`,
        };
      }
      return {
        heading: "Preparing release checks",
        description: "Run publish checks to evaluate this draft revision.",
      };
  }
}

export type HeroTone = "emerald" | "amber" | "slate";

export function getHeroTone(state: ReleaseHeroState): HeroTone {
  if (state === "published" || state === "ready") return "emerald";
  if (state === "unpublished" || state === "review") return "amber";
  return "slate";
}

export interface IssueLink {
  questionId: string | null;
  field: string | null;
}

/**
 * Parses `examQuestion:<id>:<field>` deep links. Returns nulls for any
 * malformed path instead of navigating to an empty `?question=` URL.
 */
export function parseIssueLink(path: string): IssueLink {
  const match = /^examQuestion:([^:]+):(.*)$/.exec(path);
  if (!match) return { questionId: null, field: null };
  const questionId = (match[1] ?? "").trim() || null;
  const field = (match[2] ?? "").trim() || null;
  return { questionId, field };
}

export function normalizePublishNotes(notes: string | undefined): string | undefined {
  const trimmed = (notes ?? "").trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_PUBLISH_NOTES_LENGTH);
}

const publishedDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatPublishedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  try {
    return publishedDateFormatter.format(date);
  } catch {
    return "recently";
  }
}

/**
 * Floor-based duration formatting: 3599s renders "59 min" (never "60 min"),
 * 3600s renders "1 hr", 3660s renders "1 hr 1 min". Negative/NaN -> "0 min".
 */
export function formatDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds))
    : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/**
 * Candidate-facing section time: base module + the LONGER M2 branch +
 * break. Mirrors the release contentSummary query — a candidate takes M1
 * plus exactly one branch, so summing every authored module would overstate
 * the longest real sitting.
 */
export function candidateSecondsForSection(section: {
  breakAfterSeconds: number;
  modules: Array<{ adaptiveRole: string; durationSeconds: number }>;
}): number {
  const base = section.modules.find((module) => module.adaptiveRole === "base");
  const branches = section.modules.filter((module) =>
    module.adaptiveRole === "lower_branch" || module.adaptiveRole === "higher_branch",
  );
  const branchMax = branches.length
    ? Math.max(...branches.map((module) => module.durationSeconds))
    : 0;
  return (base?.durationSeconds ?? 0) + branchMax + section.breakAfterSeconds;
}

export function candidateSecondsForShell(shell: {
  sections: Array<Parameters<typeof candidateSecondsForSection>[0]>;
}): number {
  return shell.sections.reduce((sum, section) => sum + candidateSecondsForSection(section), 0);
}

export function secondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * SAT blueprint operational counts (target minus pretest) per section.
 * Mirrors backend satBlueprintModule: RW 27-2=25, Math 22-2=20. A known
 * blueprint section always projects the stable provider contract even when
 * the draft is partially authored.
 */
export const SAT_BLUEPRINT_OPERATIONAL: Record<string, number> = {
  "reading-writing": 25,
  math: 20,
};

/**
 * Candidate-facing operational question count for one section: the bound the
 * Higher-route threshold edits against. Prefers the live shell when it is
 * usable (positive stored value), then the SAT blueprint contract, then
 * target-minus-authored-pretest on the base module, floored at 1. This keeps
 * the release page functional on real rows, where policy_config is
 * threshold-only and operationalQuestionCount arrives as 0.
 */
export function operationalCountForSection(section: {
  sectionKey?: string;
  routingPolicy?: { operationalQuestionCount?: number } | null;
  modules?: Array<{
    moduleKey?: string;
    adaptiveRole: string;
    targetQuestionCount?: number;
    questions?: Array<{ isPretest?: boolean } | null | undefined> | null | undefined;
  }>;
}): number {
  const stored = section.routingPolicy?.operationalQuestionCount;
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= 1) {
    return Math.floor(stored);
  }
  const blueprint = typeof section.sectionKey === "string"
    ? SAT_BLUEPRINT_OPERATIONAL[section.sectionKey]
    : undefined;
  if (typeof blueprint === "number" && blueprint >= 1) return blueprint;
  const base = section.modules?.find((module) => module.adaptiveRole === "base");
  const target = typeof base?.targetQuestionCount === "number" && Number.isFinite(base.targetQuestionCount)
    ? base.targetQuestionCount
    : 0;
  const pretest = Array.isArray(base?.questions)
    ? base.questions.filter((question) => question?.isPretest === true).length
    : 0;
  const derived = Math.floor(target - pretest);
  return derived >= 1 ? derived : 1;
}

/**
 * Maps raw transport errors to user-safe copy. Never surfaces raw 5xx
 * bodies; version conflicts get an actionable refresh message.
 */
export function toUserFacingReleaseError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (/40[89]|412/.test(message)) {
      return "The SAT draft changed while you were editing. Publish checks were refreshed; review them and try again.";
    }
    if (/not loaded|unavailable/i.test(message)) return message;
    if (/blocking|publish checks/i.test(message)) return message;
    if (/network|fetch|failed|timeout|offline/i.test(message)) {
      return "The request could not reach the server. Check your connection and try again.";
    }
    return "Delivery settings could not be saved. Try again.";
  }
  return "Delivery settings could not be saved. Try again.";
}

/**
 * Maps publish failures to user-safe copy. Version conflicts name the
 * refresh action; transport failures name connectivity; everything else
 * stays generic so raw 5xx bodies never reach the UI.
 */
export function toUserFacingPublishError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    if (/40[89]|412/.test(message)) {
      return "This release could not be published because the draft changed. Checks were refreshed; review them and try again.";
    }
    if (/not loaded|unavailable|blocking|publish checks/i.test(message)) return message;
    if (/network|fetch|failed|timeout|offline/i.test(message)) {
      return "The release could not reach the server. Check your connection and try again.";
    }
    return "The SAT version could not be published. Try again.";
  }
  return "The SAT version could not be published. Try again.";
}

export function summarizeStaleReadiness(
  readiness: AssessmentValidationReport | null | undefined,
  shell: Pick<AssessmentAuthoringShell, "versionId" | "versionRevision"> | null | undefined,
): { fresh: boolean; checkedLabel: string | null } {
  const fresh = isReadinessFresh(readiness, shell);
  if (fresh || !readiness) return { fresh, checkedLabel: null };
  return {
    fresh,
    checkedLabel: `Checks are for revision ${readiness.versionRevision}; the draft is now revision ${shell?.versionRevision ?? "\u2014"}. Run checks again.`,
  };
}
