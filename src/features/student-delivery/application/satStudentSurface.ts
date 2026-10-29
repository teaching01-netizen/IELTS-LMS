import type { SatRunnerState, SatSectionKey } from "./satRunnerReducer";
import type { SatBreakWindow } from "./satTimingPolicy";

export const SAT_ENTRY_RECOVERY_SURFACE_MS = 5_000;

/**
 * One student-visible stage (Stage model).
 *
 * Normal journey has only three interactive surfaces: WAITING ROOM, EXAM,
 * BREAK. Explicit recovery resolution is a separate exception surface;
 * skew-hold remains an internal technique that holds the previous frame while
 * state catches up, never a student-facing screen.
 */
export type SatStudentStageKind =
  | "exam"
  | "scheduled-break"
  | "section-entry-form"
  | "pre-start"
  | "recovery-exception"
  | "finalizing"
  | "awaiting-route"
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
 *  - `skew-hold`  the phase says module/review but the module is momentarily
 *                 unresolvable; the last frame keeps rendering (internal hold,
 *                 never a separate screen);
 *  - `refreshing` the same moment with no frame to keep — the bare loader.
 */
export type SatExamStageContent = "live" | "skew-hold" | "refreshing";

export interface SatExamStage extends SatStudentStageBase {
  readonly kind: "exam";
  readonly content: SatExamStageContent;
  readonly pendingModuleTitle: string | null;
}

/**
 * The scheduled break is one surface: waiting for it, preparing its
 * server-issued start, counting down, or ending while the next section opens.
 */
export type SatBreakPhase = "waiting" | "preparing" | "active" | "ending";

export interface SatScheduledBreakStage extends SatStudentStageBase {
  readonly kind: "scheduled-break";
  readonly phase: SatBreakPhase;
  /** Seconds the phase counts down, or null when it has no countdown. */
  readonly remainingSeconds: number | null;
  readonly nextSectionKey: SatSectionKey;
}

export type SatPreStartReason = "waiting" | "loading" | "module-entry";

export interface SatPreStartStage extends SatStudentStageBase {
  readonly kind: "pre-start";
  readonly reason: SatPreStartReason;
}

export interface SatRecoveryExceptionStage extends SatStudentStageBase {
  readonly kind: "recovery-exception";
  readonly moduleAttemptId: string;
}

export interface SatFinalizingStage extends SatStudentStageBase {
  readonly kind: "finalizing";
  /** True once a finalization attempt failed: the stage shows its retry panel. */
  readonly failed: boolean;
}

/** Classroom staff_selects: Module 1 is done and staff have not picked Module 2 yet. */
export interface SatAwaitingRouteStage extends SatStudentStageBase {
  readonly kind: "awaiting-route";
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
  | SatRecoveryExceptionStage
  | SatFinalizingStage
  | SatAwaitingRouteStage
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
  /** Server says a staff_selects attempt is waiting for the teacher's Module 2 choice. */
  awaitingStaffRoute?: boolean;
  /** A module is blocked on a server-recorded SAT recovery exception. */
  recoveryModuleAttemptId?: string | null;
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
  /** A recovered policy session requires a deliberate StartModule action. */
  explicitModuleEntryRequired?: boolean;
  /** A retained exam frame exists (the last resolved module/review render). */
  hasExamFrame: boolean;
  /** That frame is inside the bounded skew window. */
  frameFresh: boolean;
  /** The active module resolves (module/review phases only). */
  moduleResolved: boolean;
  /** The module's active question resolves (module phase only; Review needs none). */
  moduleQuestionResolved: boolean;
  pendingBreakSeconds: number;
  /**
   * The derived break window (satBreakWindow). Absent means a shared break
   * described by pendingBreakSeconds alone.
   */
  breakWindow?: SatBreakWindow;
  pendingSectionWaitSeconds: number;
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
 * boundary (the ONE break), then the exam (live, or a skew hold that keeps the
 * last frame). A module handoff never leaves the exam stage: M1→M2 is
 * server-activated, so the client swaps M1 UI → M2 UI with zero mutations.
 * Directions with a retained frame is a skew-hold, never an opening overlay;
 * directions without a frame is the waiting room (initial entry or a transient
 * retry that keeps the waiting room mounted).
 */
export function deriveSatStudentStage({
  runnerPhase,
  hasData,
  loadFailed,
  hasResult,
  terminated,
  terminatedByProctor,
  recoveryModuleAttemptId = null,
  finalizationFailed,
  awaitingStaffRoute,
  allModulesFinal,
  isInitialEntry,
  pendingModule,
  explicitModuleEntryRequired = false,
  hasExamFrame,
  frameFresh,
  moduleResolved,
  moduleQuestionResolved,
  pendingBreakSeconds,
  breakWindow = pendingBreakSeconds > 0
    ? { phase: "active", seconds: pendingBreakSeconds, blocksEntry: true, leadSeconds: null }
    : { phase: "none", seconds: null, blocksEntry: false, leadSeconds: null },
  pendingSectionWaitSeconds,
  attemptKey,
}: DeriveSatStudentStageInput): SatStudentStage {
  if (loadFailed) {
    return { kind: "error", key: `error:${attemptKey}:load`, reason: "load" };
  }
  if (!hasData) {
    return { kind: "pre-start", key: `pre-start:${attemptKey}:loading`, reason: "loading" };
  }
  if (terminated && terminatedByProctor) {
    return { kind: "terminated", key: `terminated:${attemptKey}`, byProctor: true };
  }
  if (hasResult || runnerPhase === "complete") {
    return { kind: "complete", key: `complete:${attemptKey}` };
  }
  if (terminated) {
    return { kind: "terminated", key: `terminated:${attemptKey}`, byProctor: terminatedByProctor };
  }

  if (recoveryModuleAttemptId) {
    return {
      kind: "recovery-exception",
      key: `recovery-exception:${attemptKey}:${recoveryModuleAttemptId}`,
      moduleAttemptId: recoveryModuleAttemptId,
    };
  }

  // Before finalizing: with only Module 1 final the attempt looks finished,
  // but completing it would be refused until staff assign a route.
  if (awaitingStaffRoute) {
    return { kind: "awaiting-route", key: `awaiting-route:${attemptKey}` };
  }

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

  // A skipped/disabled form still leads to the normal recovery-policy entry
  // action when the real break ends, rather than holding the break forever.
  if (explicitModuleEntryRequired && pendingModule && !pendingModule.started && !breakWindow.blocksEntry && pendingSectionWaitSeconds <= 0) {
    return {
      kind: "pre-start",
      key: `pre-start:${attemptKey}:module-entry:${pendingModule.id}`,
      reason: "module-entry",
    };
  }

  // The scheduled break is the ONE between-exam moment, and only at a real
  // section boundary before the next module starts. Once the server marks that
  // module started, a resumed controller must return to its exam surface even
  // if its local runner still says `break`. A Module 1 → Module 2 handoff inside
  // one section never lands here. The same break surface stays mounted until
  // the next active module replaces it — never "Opening Math…".
  const hasUnstartedSectionBoundary =
    Boolean(pendingModule?.startsNewSection) && !pendingModule?.started;
  if ((runnerPhase === "break" && !pendingModule?.started) || hasUnstartedSectionBoundary) {
    const sectionKey = pendingModule?.sectionKey ?? "math";
    const waiting = pendingSectionWaitSeconds > 0 && breakWindow.phase === "none";
    // After the countdown (or once the server completed the break) the same
    // surface reads "Preparing <section>…" until the next module replaces it.
    const phase: SatBreakPhase = waiting
      ? "waiting"
      : breakWindow.phase === "preparing" || breakWindow.phase === "active"
        ? breakWindow.phase
        : "ending";
    return {
      kind: "scheduled-break",
      key: `break:${attemptKey}:${sectionKey}`,
      phase,
      remainingSeconds: waiting ? pendingSectionWaitSeconds : breakWindow.seconds,
      nextSectionKey: sectionKey,
    };
  }


  if (
    runnerPhase === "module" ||
    runnerPhase === "review" ||
    (runnerPhase === "break" && pendingModule?.started)
  ) {
    if (!moduleResolved) {
      return examStage(attemptKey, hasExamFrame && frameFresh ? "skew-hold" : "refreshing");
    }
    if (runnerPhase === "module" && !moduleQuestionResolved) {
      return { kind: "error", key: `error:${attemptKey}:question`, reason: "question" };
    }
    return examStage(attemptKey, "live");
  }

  if (runnerPhase === "loading") {
    return hasExamFrame && frameFresh
      ? examStage(attemptKey, "skew-hold")
      : { kind: "error", key: `error:${attemptKey}:state`, reason: "state" };
  }

  if (runnerPhase === "directions") {
    if (isInitialEntry) {
      return { kind: "pre-start", key: `pre-start:${attemptKey}:waiting`, reason: "waiting" };
    }
    // A handoff with a retained frame holds it (skew-hold, internal only).
    // Without a frame (initial load or transient), keep the waiting room
    // mounted — retries happen automatically with jitter behind it.
    if (hasExamFrame) {
      return examStage(attemptKey, "skew-hold");
    }
    return { kind: "pre-start", key: `pre-start:${attemptKey}:waiting`, reason: "waiting" };
  }

  return { kind: "error", key: `error:${attemptKey}:state`, reason: "state" };
}

/** True while the student is inside the exam itself (any exam stage content). */
export function isSatExamStage(stage: SatStudentStage): stage is SatExamStage {
  return stage.kind === "exam";
}

/** True while the exam frame is showing but not answering (skew/refresh). */
export function isSatExamFrameHeld(stage: SatStudentStage): boolean {
  return stage.kind === "exam" && stage.content !== "live";
}
