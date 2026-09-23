import type { SatRunnerState, SatSectionKey } from "./satRunnerReducer";

export const SAT_ENTRY_RECOVERY_SURFACE_MS = 5_000;

/** Surfaces that replace the exam shell during a non-module transition. */
export type SatStudentTransitionSurface =
  | { kind: "pre-start"; reason: "initial" | "waiting" | "restoring" }
  | {
      kind: "scheduled-break";
      phase: "waiting-for-break" | "on-break" | "opening-next-section";
      remainingSeconds: number | null;
      nextSectionKey: SatSectionKey;
    }
  | { kind: "hold-exam-frame" }
  | { kind: "entry-recovery" };

export interface DeriveSatStudentTransitionSurfaceInput {
  runnerPhase: SatRunnerState["phase"];
  isInitialEntry: boolean;
  isBetweenSections: boolean;
  hasPreviousExamFrame: boolean;
  nextSectionKey: SatSectionKey | null;
  pendingBreakSeconds: number;
  pendingSectionWaitSeconds: number;
  entryRecoverable: boolean;
  entryBlocked: boolean;
  entryHoldExpired: boolean;
}

/**
 * Derive only the transitional surfaces. The route owns module, review,
 * submitting, and terminal rendering, so those states deliberately return
 * null instead of pretending to be handled by this selector.
 */
export function deriveSatStudentTransitionSurface({
  runnerPhase,
  isInitialEntry,
  isBetweenSections,
  hasPreviousExamFrame,
  nextSectionKey,
  pendingBreakSeconds,
  pendingSectionWaitSeconds,
  entryRecoverable,
  entryBlocked,
  entryHoldExpired,
}: DeriveSatStudentTransitionSurfaceInput): SatStudentTransitionSurface | null {
  if (runnerPhase === "break" || isBetweenSections) {
    const sectionKey = nextSectionKey ?? "math";
    if (pendingSectionWaitSeconds > 0) {
      return {
        kind: "scheduled-break",
        phase: "waiting-for-break",
        remainingSeconds: pendingSectionWaitSeconds,
        nextSectionKey: sectionKey,
      };
    }
    if (pendingBreakSeconds > 0) {
      return {
        kind: "scheduled-break",
        phase: "on-break",
        remainingSeconds: pendingBreakSeconds,
        nextSectionKey: sectionKey,
      };
    }
    return {
      kind: "scheduled-break",
      phase: "opening-next-section",
      remainingSeconds: null,
      nextSectionKey: sectionKey,
    };
  }

  if (runnerPhase !== "directions") return null;

  if (isInitialEntry) {
    return entryRecoverable && entryHoldExpired
      ? { kind: "entry-recovery" }
      : { kind: "pre-start", reason: "initial" };
  }

  if (entryBlocked) {
    return { kind: "pre-start", reason: "waiting" };
  }
  if (hasPreviousExamFrame && !entryHoldExpired) {
    return { kind: "hold-exam-frame" };
  }
  if (!entryHoldExpired) {
    return { kind: "pre-start", reason: "restoring" };
  }
  return { kind: "entry-recovery" };
}
