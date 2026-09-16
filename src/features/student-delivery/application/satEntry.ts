import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleAttemptSnapshot,
} from "../contracts/assessmentDelivery";

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
 */

export type SatEntryReason =
  | "phase-not-entering"
  | "no-data"
  | "no-module"
  | "runtime-not-live"
  | "proctor-blocked"
  | "stage-not-ready"
  | "not-base-module"
  | "unknown-section"
  | "initial-entry-not-on-directions"
  | "already-started"
  | "break-active"
  | "section-wait"
  | "initial-entry"
  | "next-section-entry";

export interface SatEntryDecision {
  shouldStart: boolean;
  reason: SatEntryReason;
}

/** The gates shared by auto-entry and the directions screen's start button. */
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
 * The one decision both entry paths read. Section 0 is the first module (the
 * proctor's Start opens it); a later section only opens once the authoritative
 * break and the previous section's clock are both over.
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
    return { shouldStart: false, reason: "phase-not-entering" };
  }
  if (!data) return { shouldStart: false, reason: "no-data" };

  const blocked = satEntryBlockedReason({
    module,
    runtimeStatus: data.scheduleRuntimeStatus,
    proctorStatus: data.proctorStatus,
    stageReady,
  });
  if (blocked) return { shouldStart: false, reason: blocked };
  if (!module) return { shouldStart: false, reason: "no-module" };

  if (module.adaptiveRole !== "base") return { shouldStart: false, reason: "not-base-module" };
  if (sectionDisplayOrder === null) return { shouldStart: false, reason: "unknown-section" };

  if (sectionDisplayOrder === 0) {
    // First module: only from the directions screen, and only while nothing in
    // the attempt has started (the backend seeds just the entry module row).
    if (phase !== "directions") {
      return { shouldStart: false, reason: "initial-entry-not-on-directions" };
    }
    return data.attempt.moduleAttempts.every(isUnstartedAttempt)
      ? { shouldStart: true, reason: "initial-entry" }
      : { shouldStart: false, reason: "already-started" };
  }

  if (breakSeconds > 0) return { shouldStart: false, reason: "break-active" };
  if (sectionWaitSeconds > 0) return { shouldStart: false, reason: "section-wait" };

  const attempt = data.attempt.moduleAttempts.find(
    (candidate) => candidate.moduleId === module.id,
  );
  return attempt && isUnstartedAttempt(attempt)
    ? { shouldStart: true, reason: "next-section-entry" }
    : { shouldStart: false, reason: "already-started" };
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
