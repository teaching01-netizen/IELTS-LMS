import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleAttemptSnapshot,
} from "../contracts/assessmentDelivery";
import {
  findAttemptForModule,
  matchesFinalModuleState,
  sectionForModule,
} from "./satRuntimeSelectors";

/**
 * Single owner for SAT entry policy (Phase 2).
 *
 * The controller used to run two near-duplicate auto-start effects with two
 * separate gate selectors, and they drifted: only the next-section path had a
 * retry window, so one failed start of the first module stranded the student on
 * the manual button. Everything about "may the student enter now" lives here:
 * the shared predicate the directions screen also gates its button on
 * (`canEnterModule`), the pure decision both entry paths read
 * (`deriveSatEntryDecision`), and the attempt bookkeeping the entry hook keeps
 * (`canAttemptEntry` / `settleEntry`).
 *
 * An adaptive branch module is selected by the server when Module 1 closes.
 * Once that server-supplied attempt is unstarted and the timing/proctor gates
 * allow entry, this client automatically opens it whether Module 1 timed out
 * or was submitted early.
 */

export type SatEntryReason =
  | "phase-not-entering"
  | "no-data"
  | "no-module"
  | "runtime-not-live"
  | "proctor-blocked"
  | "stage-not-ready"
  | "unknown-section"
  | "initial-entry-not-on-directions"
  | "already-started"
  | "break-active"
  | "section-wait"
  | "initial-entry"
  | "next-section-entry"
  | "next-module-entry";

export interface SatEntryDecision {
  shouldStart: boolean;
  reason: SatEntryReason;
  /**
   * The automatic path owns this module: it starts as soon as the gates open.
   */
  autoStartPending: boolean;
}

/** The gates shared by automatic entry and its recovery action. */
export interface SatEntryGateInput {
  module: AssessmentDeliveryModule | null;
  runtimeStatus: string;
  proctorStatus: string;
  stageReady?: boolean | undefined;
}

export interface SatEntryDecisionInput {
  data: AssessmentDeliveryBootstrap | null;
  module: AssessmentDeliveryModule | null;
  sectionDisplayOrder: number | null;
  stageReady: boolean;
  breakSeconds: number;
  sectionWaitSeconds: number;
  phase: string;
}

/**
 * The proctor statuses that permit answering. `idle` and `connecting` are legal
 * attempt statuses (migrations/0006_delivery.sql) but are not a live exam, and
 * the entry guard used to be narrower than the button's — so a student could be
 * refused automatic entry while the manual button still worked. Both now read
 * this one predicate.
 */
function proctorAllowsEntry(proctorStatus: string): boolean {
  return proctorStatus === "active" || proctorStatus === "warned";
}

/**
 * Why the student may not enter a module right now, or null when they may.
 * Shared so the automatic path and the manual button can never disagree.
 */
export function satEntryBlockedReason({
  module,
  runtimeStatus,
  proctorStatus,
  stageReady,
}: SatEntryGateInput): SatEntryReason | null {
  if (!module) return "no-module";
  if (runtimeStatus !== "live") return "runtime-not-live";
  if (!proctorAllowsEntry(proctorStatus)) return "proctor-blocked";
  if (stageReady === false) return "stage-not-ready";
  return null;
}

export function canEnterModule(input: SatEntryGateInput): boolean {
  return satEntryBlockedReason(input) === null;
}

function isUnstartedAttempt(attempt: AssessmentModuleAttemptSnapshot): boolean {
  return !attempt.startedAt && !attempt.completionReason && attempt.state === "not_started";
}

/**
 * Tolerance for "this module's clock had run out by the time it ended". The
 * student-facing countdown is ceil-based and driven by a server-clock offset,
 * and the verdict is read from the submit response a round trip later, so an
 * exact `deadline <= serverNow` would be brittle by up to a second either way.
 */
export const SAT_MODULE_TIMEOUT_TOLERANCE_MS = 1_000;

/**
 * Whether one finished module attempt ended on its own clock rather than by a
 * student submit.
 *
 * This is read from the payload, not from local submit state, so the live
 * session, a poll that discovers a server-side finalization, an offline
 * reconnect, and a page reload all reach the same verdict. `completionReason`
 * cannot answer it: the client's own expiry submit goes through SubmitModule,
 * which records `student_submit` for every client-driven module close, and only
 * the server reconciler writes `time_expired`.
 */
export function moduleAttemptEndedByOwnClock(
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  serverNow: string,
): boolean {
  if (!attempt || !matchesFinalModuleState(attempt.state)) return false;
  if (!attempt.deadlineAt) return false;
  const deadline = Date.parse(attempt.deadlineAt);
  const now = Date.parse(serverNow);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return false;
  return deadline <= now + SAT_MODULE_TIMEOUT_TOLERANCE_MS;
}

/**
 * Whether the module that precedes `module` inside its own section ended on its
 * own clock. This is retained for entry observability only; server routing and
 * entry eligibility do not depend on it.
 */
export function previousModuleTimedOut(
  payload: AssessmentDeliveryBootstrap,
  module: AssessmentDeliveryModule,
): boolean {
  const section = sectionForModule(payload, module.id);
  if (!section) return false;
  return section.modules.some(
    (candidate) =>
      candidate.id !== module.id &&
      moduleAttemptEndedByOwnClock(
        findAttemptForModule(payload, candidate.id),
        payload.serverNow,
      ),
  );
}

/** Not enterable, but the automatic path still owns the module. */
function waiting(reason: SatEntryReason): SatEntryDecision {
  return { shouldStart: false, reason, autoStartPending: true };
}

/**
 * The one decision both entry paths read. Section 0 is the first module (it
 * opens when the proctor starts the runtime); a later section only opens once
 * the authoritative break and the previous section's clock are both over. A
 * branch module is selected by the server and opens automatically once its
 * unstarted attempt exists.
 */
export function deriveSatEntryDecision({
  data,
  module,
  sectionDisplayOrder,
  stageReady,
  breakSeconds,
  sectionWaitSeconds,
  phase,
}: SatEntryDecisionInput): SatEntryDecision {
  if (phase !== "directions" && phase !== "break") {
    return waiting("phase-not-entering");
  }
  if (!data) return waiting("no-data");

  const blocked = satEntryBlockedReason({
    module,
    runtimeStatus: data.scheduleRuntimeStatus,
    proctorStatus: data.proctorStatus,
    stageReady,
  });
  if (blocked) return waiting(blocked);
  if (!module) return waiting("no-module");
  if (sectionDisplayOrder === null) return waiting("unknown-section");

  const attempt = data.attempt.moduleAttempts.find(
    (candidate) => candidate.moduleId === module.id,
  );
  const isBranch = module.adaptiveRole !== "base";

  // Section 0's first module keeps its own rule, still checked before the break
  // gates: only the directions screen opens it, and only while nothing in the
  // attempt has started (the backend seeds just the entry module row).
  if (sectionDisplayOrder === 0 && !isBranch) {
    if (phase !== "directions") return waiting("initial-entry-not-on-directions");
    return data.attempt.moduleAttempts.every(isUnstartedAttempt)
      ? { shouldStart: true, reason: "initial-entry", autoStartPending: true }
      : waiting("already-started");
  }

  if (breakSeconds > 0) return waiting("break-active");
  if (sectionWaitSeconds > 0) return waiting("section-wait");

  if (isBranch) {
    // Module 2 of a section. The rows exist only because the server already
    // scored Module 1 and wrote its routing decision in the same transaction
    // that created this one, so there is nothing left to decide here — the only
    // question is who opens it.
    if (!attempt || !isUnstartedAttempt(attempt)) return waiting("already-started");
    return { shouldStart: true, reason: "next-module-entry", autoStartPending: true };
  }

  return attempt && isUnstartedAttempt(attempt)
    ? { shouldStart: true, reason: "next-section-entry", autoStartPending: true }
    : waiting("already-started");
}

/**
 * How long an unconfirmed entry attempt waits before the runner tries again,
 * and the record that keeps it retryable. Only a confirmed open is terminal.
 */
export const SAT_ENTRY_RETRY_WINDOW_MS = 2_000;

export type SatEntryOutcome = "opened" | "noop" | "failed";

export interface SatEntryAttempt {
  key: string;
  inFlight: boolean;
  attemptedAt: number;
  succeededAt: number | null;
}

export function canAttemptEntry(
  attempt: SatEntryAttempt | null,
  key: string,
  now: number,
): boolean {
  if (!attempt) return true;
  // One start at a time whatever the key: inFlight is written synchronously,
  // unlike the isStarting state it backs up.
  if (attempt.inFlight) return false;
  if (attempt.key !== key) return true;
  if (attempt.succeededAt !== null) return false;
  return now - attempt.attemptedAt >= SAT_ENTRY_RETRY_WINDOW_MS;
}

export function settleEntry(
  attempt: SatEntryAttempt,
  outcome: SatEntryOutcome,
  at: number,
): SatEntryAttempt {
  return {
    key: attempt.key,
    inFlight: false,
    attemptedAt: attempt.attemptedAt,
    succeededAt: outcome === "opened" ? at : null,
  };
}
