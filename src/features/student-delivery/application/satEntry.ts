import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleAttemptSnapshot,
} from "../contracts/assessmentDelivery";
import {
  findAttemptForModule,
  matchesFinalModuleState,
  modulesInExamOrder,
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
 * allow entry, this client automatically opens it after the prior module ends.
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
  | "next-module-entry"
  | "handoff-entry";

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
 * A routed module waiting for this browser to start it (client_start
 * handoff): unstarted, with the server's auto-start backstop set. Its clock
 * starts in the StartModule request that also delivers its content.
 */
export function isAwaitingClientStart(attempt: AssessmentModuleAttemptSnapshot | undefined): boolean {
  return Boolean(attempt && isUnstartedAttempt(attempt) && attempt.autoStartAt);
}

/**
 * Whether `module` is the first base module of the delivered exam. Delivered
 * sections keep their release display order even when Student Access narrows
 * the scope (a math-only session starts at Math, order 1), so "first" is the
 * lowest-ordered delivered section, never a literal order of 0.
 */
function isFirstBaseModule(
  data: AssessmentDeliveryBootstrap,
  module: AssessmentDeliveryModule,
): boolean {
  if (module.adaptiveRole !== "base") return false;
  return modulesInExamOrder(data).find((candidate) => candidate.adaptiveRole === "base")?.id === module.id;
}

/**
 * The proctor's Start: `module` is the first base module of the delivered exam,
 * it has an attempt, and nothing has been started yet. Shared by automatic
 * entry and the student route's waiting-room classification.
 */
export function isSatInitialEntry(
  data: AssessmentDeliveryBootstrap,
  module: AssessmentDeliveryModule | null,
): boolean {
  if (!module || !isFirstBaseModule(data, module)) return false;
  return (
    Boolean(findAttemptForModule(data, module.id)) &&
    data.attempt.moduleAttempts.every(isUnstartedAttempt)
  );
}

/**
 * Tolerance for "this module's clock had run out by the time it ended". The
 * student-facing countdown is ceil-based and driven by a server-clock offset,
 * and the verdict arrives in an authoritative bootstrap after reconciliation,
 * so an exact `deadline <= serverNow` would be brittle by up to a second.
 */
export const SAT_MODULE_TIMEOUT_TOLERANCE_MS = 1_000;

/**
 * Whether one finished module attempt ended on its own clock.
 *
 * This is read from the payload, not from local submit state, so the live
 * session, a poll that discovers a server-side finalization, an offline
 * reconnect, and a page reload all reach the same verdict. `completionReason`
 * alone cannot answer it because historical attempts may still contain
 * `student_submit`.
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
 * The one decision the entry path reads. The first delivered section's first
 * module (the proctor's Start) is client-started: it opens when the proctor
 * starts the runtime, via one idempotent StartModule. Under the personal model
 * later progression is server-driven, EXCEPT a routed module the server left
 * waiting for this browser (client_start handoff): its clock starts in the
 * StartModule that delivers its content, so routing and delivery latency are
 * never charged to it.
 */
export function deriveSatEntryDecision({
  data,
  module,
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
  if (!sectionForModule(data, module.id)) return waiting("unknown-section");

  const attempt = data.attempt.moduleAttempts.find(
    (candidate) => candidate.moduleId === module.id,
  );
  const isBranch = module.adaptiveRole !== "base";

  if (isFirstBaseModule(data, module)) {
    if (phase !== "directions") return waiting("initial-entry-not-on-directions");
    return isSatInitialEntry(data, module)
      ? { shouldStart: true, reason: "initial-entry", autoStartPending: true }
      : waiting("already-started");
  }

  if (breakSeconds > 0) return waiting("break-active");
  if (sectionWaitSeconds > 0) return waiting("section-wait");

  // Personal (sat_personal_v1) is server-driven beyond the initial module:
  // M1→M2 and break→next-M1 activate atomically server-side, so the client
  // waits for authoritative state instead of negotiating entry — unless the
  // server routed the module and left its start to this browser.
  // Cohort/legacy models still enter branches and later sections via client
  // StartModule.
  const personal = (data.timing as { timingModel?: string } | null)?.timingModel === "sat_personal_v1";
  if (personal) {
    const section = sectionForModule(data, module.id);
    const previousFinal = section?.modules.some((previous) =>
      previous.adaptiveRole === "base" && previous.id !== module.id &&
      matchesFinalModuleState(findAttemptForModule(data, previous.id)?.state ?? ""));
    const available = attempt?.availableAt ? Date.parse(attempt.availableAt) <= Date.parse(data.serverNow) : false;
    if (phase === "directions" && isBranch && previousFinal && available && isAwaitingClientStart(attempt)) {
      return { shouldStart: true, reason: "handoff-entry", autoStartPending: true };
    }
    return waiting("already-started");
  }

  if (isBranch) {
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
