/**
 * SAT clock policy: what the student is shown versus what may close the module.
 *
 * The backend applies a personal module deadline only for the legacy timing
 * model (`usesPersonalDeadline()`); cohort models are governed by the shared
 * runtime clock. Keeping the two roles apart is what audit SAT-003 fixed — a
 * cohort-section module whose personal allotment hit zero must NOT auto-submit
 * while the section clock is still live.
 *
 * Everything here is pure: the hook owns the ticking `now`, the authoritative
 * deadline hook, and the payload reads; this module owns the rules.
 */

import {
  isCohortTimingModel,
  isSectionKeyedCohortModel,
} from "../../../types/domain";

/**
 * A string read from a payload or timing snapshot: absent (null/undefined) or
 * present but possibly empty. The rules below treat all three alike, because a
 * projection that omits a key and one that sends "" carry the same meaning here
 * (no identity), and both must land on the safe answer.
 */
type MaybeString = string | null | undefined;

/**
 * Server-vs-device skew shared by every countdown, so personal and section
 * clocks advance together on one correction.
 */
export function satClockOffsetMs(serverNow: MaybeString, snapshotReceivedAt: number): number {
  return serverNow ? Date.parse(serverNow) - snapshotReceivedAt : 0;
}

/**
 * Whether the shared (cohort) clock is running: the runtime must be live *and*
 * the published stage live. A cohort pause stops the section clock, and every
 * countdown that reads it must read this same rule.
 */
export function satSharedClockRunning(input: {
  runtimeStatus: MaybeString;
  stageStatus: MaybeString;
}): boolean {
  return input.runtimeStatus === "live" && input.stageStatus === "live";
}

/**
 * Whether the student's personal module clock is running. A paused cohort stage
 * freezes both clocks, not just the section one; the legacy model has no
 * shared clock, so its personal clock always runs.
 */
export function satPersonalClockRunning(input: {
  timingModel: MaybeString;
  runtimeStatus: MaybeString;
  stageStatus: MaybeString;
}): boolean {
  if (!isCohortTimingModel(input.timingModel)) return true;
  return satSharedClockRunning(input);
}

/**
 * The stage key the server must publish for this module to be enterable:
 * section-keyed cohort models publish the section, stage-keyed models publish
 * `sectionKey:m1|m2` per adaptive role. Null when the module's identity is
 * unknown.
 */
export function satExpectedStageKey(input: {
  timingModel: MaybeString;
  sectionKey: MaybeString;
  adaptiveRole: MaybeString;
}): string | null {
  // Falsy (not just null): a payload that omits the section or the role has no
  // stage identity, and an empty key would otherwise build a key like `:m2`.
  if (!input.sectionKey || !input.adaptiveRole) return null;
  if (isSectionKeyedCohortModel(input.timingModel)) return input.sectionKey;
  return `${input.sectionKey}:${input.adaptiveRole === "base" ? "m1" : "m2"}`;
}

/**
 * Whether the published stage is this module's stage and live. Legacy models
 * have no stage concept, so they are always ready.
 */
export function satStageReady(input: {
  timingModel: MaybeString;
  stageKey: MaybeString;
  stageStatus: MaybeString;
  runtimeStatus: MaybeString;
  expectedStageKey: string | null;
}): boolean {
  if (!isCohortTimingModel(input.timingModel)) return true;
  // No expected stage means no identity to enter on. A cohort frame like that
  // must hold, not open: the server would reject the start (`MODULE_MISMATCH` /
  // `STAGE_SECTION_MISMATCH`), and a payload with no published stage would
  // otherwise look "ready" against a null expectation.
  if (input.expectedStageKey === null) return false;
  return (
    input.stageKey === input.expectedStageKey &&
    input.stageStatus === "live" &&
    input.runtimeStatus === "live"
  );
}

export interface SatCountdown {
  /** The student-facing allotment (may be the smaller of two clocks). */
  displaySeconds: number;
  /** The clock that may close the module; null = no authority for this frame. */
  expirySeconds: number | null;
}

/**
 * The two countdowns, derived together so display and expiry can never drift
 * apart:
 *   legacy         -> personal clock is both;
 *   cohort-stage   -> the published stage clock is both;
 *   cohort-section -> display is min(personal, section) while the stage names
 *                     this module's section; expiry is the section clock, and
 *                     null (inert) when the stage names another section — the
 *                     backend would reject a submit under that stage anyway.
 */
export function satCountdown(input: {
  timingModel: MaybeString;
  stageKey: MaybeString;
  sectionKey: MaybeString;
  personalSeconds: number;
  authoritativeSeconds: number;
}): SatCountdown {
  if (!isCohortTimingModel(input.timingModel)) {
    return { displaySeconds: input.personalSeconds, expirySeconds: input.personalSeconds };
  }
  if (!isSectionKeyedCohortModel(input.timingModel)) {
    return {
      displaySeconds: input.authoritativeSeconds,
      expirySeconds: input.authoritativeSeconds,
    };
  }
  const stageMatchesSection =
    Boolean(input.sectionKey) && input.stageKey === input.sectionKey;
  return {
    displaySeconds: stageMatchesSection
      ? Math.min(input.personalSeconds, input.authoritativeSeconds)
      : 0,
    expirySeconds: stageMatchesSection ? input.authoritativeSeconds : null,
  };
}

/**
 * The between-modules wait: the student finished their module while the shared
 * section clock is still running, so they wait out the section. Zero unless a
 * section-keyed cohort frame names a stage that is not their section.
 */
export function satSectionWaitSeconds(input: {
  timingModel: MaybeString;
  stageKey: MaybeString;
  sectionKey: MaybeString;
  runtimeStatus: MaybeString;
  waitingForNextSection: boolean;
  authoritativeSeconds: number;
}): number {
  if (!input.sectionKey) return 0;
  if (!isSectionKeyedCohortModel(input.timingModel)) return 0;
  if (input.runtimeStatus !== "live") return 0;
  if (input.waitingForNextSection) return 0;
  if (!input.stageKey || input.stageKey === input.sectionKey) return 0;
  return input.authoritativeSeconds;
}

/**
 * The break countdown. Cohort models count to the server's published next
 * section start; legacy models count the authored per-section break.
 */
export function satBreakCountdownSeconds(input: {
  timingModel: MaybeString;
  nextSectionStartAt: MaybeString;
  nextSectionStartSeconds: number;
  legacyBreakSeconds: number;
}): number {
  if (!isCohortTimingModel(input.timingModel)) return input.legacyBreakSeconds;
  return input.nextSectionStartAt ? input.nextSectionStartSeconds : 0;
}
