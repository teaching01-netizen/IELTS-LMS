import type { SatRunnerState, SatSectionKey } from "./satRunnerReducer";

export const SAT_ENTRY_RECOVERY_SURFACE_MS = 5_000;

/**
 * One student-visible stage (Stage model, spec docs/sat-student-transitions.md).
 *
 * The route renders exactly one of these at a time, through the one presence
 * host, so "which surface is the student on?" has a single answer that is
 * unit-testable instead of being spread across the route's early returns. The
 * runner's internal phases (`directions`, `break`, `submitting`) are
 * orchestration states: several of them map onto the SAME stage, and a module
 * handoff never leaves the exam stage at all.
 */
export type SatStudentStageKind =
  | "exam"
  | "scheduled-break"
  | "pre-start"
  | "entry-recovery"
  | "finalizing"
  | "complete"
  | "terminated"
  | "error";

export interface SatStudentStageBase {
  readonly kind: SatStudentStageKind;
  /** Presence key: two renders with the same key are the same mounted surface. */
  readonly key: string;
}

/**
 * The exam stage — one stage for the whole attempt.
 *
 * `content` says what the frame is showing, never whether it exists:
 *  - `live`       a resolved module/review frame the student can use;
 *  - `opening`    the next module is opening; the finished frame stays mounted,
 *                 frozen and inert, behind one live status surface;
 *  - `skew-hold`  the phase says module/review but the module is momentarily
 *                 unresolvable; the last frame keeps rendering;
 *  - `refreshing` the same moment with no frame to keep — the bare loader.
 */
export type SatExamStageContent = "live" | "opening" | "skew-hold" | "refreshing";

export interface SatExamStage extends SatStudentStageBase {
  readonly kind: "exam";
  readonly content: SatExamStageContent;
  /** Title of the module being opened; set only while content is `opening`. */
  readonly pendingModuleTitle: string | null;
}

export type SatBreakPhase = "waiting-for-break" | "starting-break" | "on-break" | "opening-next-section";

/** What the automatic entry into the next section is doing (break copy). */
export type SatBreakEntryProgress = "idle" | "starting" | "retrying";

export interface SatScheduledBreakStage extends SatStudentStageBase {
  readonly kind: "scheduled-break";
  readonly phase: SatBreakPhase;
  /** Seconds the phase counts down, or null when it has no countdown. */
  readonly remainingSeconds: number | null;
  readonly nextSectionKey: SatSectionKey;
  readonly entryProgress: SatBreakEntryProgress;
}

export type SatPreStartReason = "initial" | "waiting" | "restoring" | "loading";

export interface SatPreStartStage extends SatStudentStageBase {
  readonly kind: "pre-start";
  readonly reason: SatPreStartReason;
}

export interface SatEntryRecoveryStage extends SatStudentStageBase {
  readonly kind: "entry-recovery";
  readonly moduleId: string | null;
}

export interface SatFinalizingStage extends SatStudentStageBase {
  readonly kind: "finalizing";
  /** True once a finalization attempt failed: the stage shows its retry panel. */
  readonly failed: boolean;
}

export interface SatCompleteStage extends SatStudentStageBase {
  readonly kind: "complete";
}

export interface SatTerminatedStage extends SatStudentStageBase {
  readonly kind: "terminated";
  /** True when the proctor ended the attempt rather than the runtime closing. */
  readonly byProctor: boolean;
}

export type SatStudentErrorReason = "load" | "state" | "question";

export interface SatErrorStage extends SatStudentStageBase {
  readonly kind: "error";
  readonly reason: SatStudentErrorReason;
}

export type SatStudentStage =
  | SatExamStage
  | SatScheduledBreakStage
  | SatPreStartStage
  | SatEntryRecoveryStage
  | SatFinalizingStage
  | SatCompleteStage
  | SatTerminatedStage
  | SatErrorStage;

export interface DeriveSatStudentStageInput {
  runnerPhase: SatRunnerState["phase"];
  /** A committed payload exists (the attempt is known). */
  hasData: boolean;
  /** The first load failed: nothing is renderable at all. */
  loadFailed: boolean;
  hasResult: boolean;
  /** The proctor ended the attempt, or the runtime closed the session. */
  terminated: boolean;
  terminatedByProctor: boolean;
  /** Finalization failed while every module is final (the retry panel). */
  finalizationFailed: boolean;
  /** Every module attempt is submitted/locked. */
  allModulesFinal: boolean;
  /** First module of the exam, still waiting for the proctor's start. */
  isInitialEntry: boolean;
  /** The module the attempt is entering and whether the server has started it. */
  pendingModule: {
    id: string;
    title: string;
    sectionKey: SatSectionKey;
    startsNewSection: boolean;
    started: boolean;
  } | null;
  /** A retained exam frame exists (the last resolved module/review render). */
  hasExamFrame: boolean;
  /** That frame is inside the bounded skew window. */
  frameFresh: boolean;
  /** The active module resolves (module/review phases only). */
  moduleResolved: boolean;
  /** The module's active question resolves (module phase only; Review needs none). */
  moduleQuestionResolved: boolean;
  entryRecoverable: boolean;
  entryBlocked: boolean;
  entryHoldExpired: boolean;
  pendingBreakSeconds: number;
  personalBreakStarting?: boolean;
  pendingSectionWaitSeconds: number;
  entryInFlight: boolean;
  /** Identity of the attempt; every presence key is scoped by it. */
  attemptKey: string;
}

function examStage(
  attemptKey: string,
  content: SatExamStageContent,
  pendingModuleTitle: string | null = null,
): SatExamStage {
  return { kind: "exam", key: `exam:${attemptKey}`, content, pendingModuleTitle };
}

/**
 * The one decision "which stage is the student on".
 *
 * Order matters and is the contract: terminal surfaces win, then a real section
 * boundary, then the exam (live, or a handoff that stays inside the frame). The
 * exam stage is deliberately chosen for `directions` whenever a frame exists —
 * that is what makes a module handoff a content change instead of a screen
 * change — and the pre-start/recovery surfaces are only reachable when there is
 * no frame to keep (first entry, reload mid-handoff).
 */
export function deriveSatStudentStage({
  runnerPhase,
  hasData,
  loadFailed,
  hasResult,
  terminated,
  terminatedByProctor,
  finalizationFailed,
  allModulesFinal,
  isInitialEntry,
  pendingModule,
  hasExamFrame,
  frameFresh,
  moduleResolved,
  moduleQuestionResolved,
  entryRecoverable,
  entryBlocked,
  entryHoldExpired,
  pendingBreakSeconds,
  personalBreakStarting = false,
  pendingSectionWaitSeconds,
  entryInFlight,
  attemptKey,
}: DeriveSatStudentStageInput): SatStudentStage {
  if (loadFailed) {
    return { kind: "error", key: `error:${attemptKey}:load`, reason: "load" };
  }
  if (!hasData) {
    return { kind: "pre-start", key: `pre-start:${attemptKey}:loading`, reason: "loading" };
  }
  // An explicit proctor termination remains visible even if termination also
  // recorded a submission timestamp/result. A student-submitted completion
  // has no proctor termination flag and keeps the normal completion surface.
  if (terminated && terminatedByProctor) {
    return { kind: "terminated", key: `terminated:${attemptKey}`, byProctor: true };
  }
  if (hasResult || runnerPhase === "complete") {
    return { kind: "complete", key: `complete:${attemptKey}` };
  }
  if (terminated) {
    return { kind: "terminated", key: `terminated:${attemptKey}`, byProctor: terminatedByProctor };
  }

  // A finished attempt whose result is still being produced is one stage, with
  // two contents: the progress surface, or its retry panel once a try failed.
  if (
    (runnerPhase === "directions" && allModulesFinal) ||
    runnerPhase === "submitting"
  ) {
    return {
      kind: "finalizing",
      key: `finalizing:${attemptKey}`,
      failed: finalizationFailed,
    };
  }

  // The scheduled break is the ONE between-exam moment, and only at a real
  // section boundary before the next module starts. Once the server marks that
  // module started, a resumed controller must return to its exam surface even
  // if its local runner still says `break`. A Module 1 → Module 2 handoff inside
  // one section never lands here.
  const hasUnstartedSectionBoundary =
    Boolean(pendingModule?.startsNewSection) && !pendingModule?.started;
  if ((runnerPhase === "break" && !pendingModule?.started) || hasUnstartedSectionBoundary) {
    // A break always has a next section to name: an attempt whose modules are all
    // final took the finalizing branch above, so `math` is only the defensive
    // default for a payload that has not hydrated the next attempt yet.
    const sectionKey = pendingModule?.sectionKey ?? "math";
    const phase: SatBreakPhase =
      pendingSectionWaitSeconds > 0
        ? "waiting-for-break"
        : personalBreakStarting
          ? "starting-break"
        : pendingBreakSeconds > 0
          ? "on-break"
          : "opening-next-section";
    return {
      kind: "scheduled-break",
      key: `break:${attemptKey}:${sectionKey}`,
      phase,
      remainingSeconds:
        phase === "waiting-for-break"
          ? pendingSectionWaitSeconds
          : phase === "starting-break"
            ? null
          : phase === "on-break"
            ? pendingBreakSeconds
            : null,
      nextSectionKey: sectionKey,
      entryProgress: entryInFlight ? "starting" : entryRecoverable ? "retrying" : "idle",
    };
  }

  if (
    runnerPhase === "module" ||
    runnerPhase === "review" ||
    (runnerPhase === "break" && pendingModule?.started)
  ) {
    if (!moduleResolved) {
      // One-frame data/state skew: keep the last frame when it is still fresh,
      // otherwise say so — never swap valid exam UI for a spinner on a skew.
      return examStage(attemptKey, hasExamFrame && frameFresh ? "skew-hold" : "refreshing");
    }
    if (runnerPhase === "module" && !moduleQuestionResolved) {
      return { kind: "error", key: `error:${attemptKey}:question`, reason: "question" };
    }
    return examStage(attemptKey, "live");
  }

  if (runnerPhase === "loading") {
    // A payload with the runner still loading is a one-frame window (or an
    // invariant violation), not a wait: a frame keeps the screen for its bounded
    // window, and nothing else is renderable — so the error surface owns it
    // rather than a pre-start that would claim to be preparing an exam the
    // attempt may not even have.
    return hasExamFrame && frameFresh
      ? examStage(attemptKey, "skew-hold")
      : { kind: "error", key: `error:${attemptKey}:state`, reason: "state" };
  }

  if (runnerPhase === "directions") {
    if (isInitialEntry) {
      return { kind: "pre-start", key: `pre-start:${attemptKey}:initial`, reason: "initial" };
    }
    // A proctor/runtime block owns the screen immediately; it never leaves a
    // stale module standing (pause, not-live runtime, stage not ready).
    if (entryBlocked) {
      return { kind: "pre-start", key: `pre-start:${attemptKey}:waiting`, reason: "waiting" };
    }
    if (hasExamFrame) {
      return examStage(attemptKey, "opening", pendingModule?.title ?? null);
    }
    if (!entryHoldExpired) {
      return { kind: "pre-start", key: `pre-start:${attemptKey}:restoring`, reason: "restoring" };
    }
    return {
      kind: "entry-recovery",
      key: `entry-recovery:${attemptKey}:${pendingModule?.id ?? "next"}`,
      moduleId: pendingModule?.id ?? null,
    };
  }

  // Unreachable for a healthy attempt: the phase is one the surfaces above cover.
  return { kind: "error", key: `error:${attemptKey}:state`, reason: "state" };
}

/** True while the student is inside the exam itself (any exam stage content). */
export function isSatExamStage(stage: SatStudentStage): stage is SatExamStage {
  return stage.kind === "exam";
}

/** True while the exam frame is showing but not answering (handoff/skew/refresh). */
export function isSatExamFrameHeld(stage: SatStudentStage): boolean {
  return stage.kind === "exam" && stage.content !== "live";
}
