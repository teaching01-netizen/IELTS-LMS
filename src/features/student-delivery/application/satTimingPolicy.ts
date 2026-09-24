/**
 * SAT clock policy: what the student is shown versus what may close the module.
 *
 * The backend reconciles both the personal module deadline and cohort section
 * deadline. The browser uses the same expiry clock only to freeze input, flush
 * pending answers, and request an authoritative refresh; it never closes a
 * module itself.
 *
 * Everything here is pure: the temporal runtime reads the shared clock, the
 * controller owns payload facts and boundary effects, and this module owns the rules.
 */

import type { AssessmentModuleAttemptSnapshot } from "../contracts/assessmentDelivery";
import { drainSinceSnapshot } from "../domain/satTiming";
import {
  isCohortTimingModel,
  isSectionKeyedCohortModel,
  isSatPersonalTimingModel,
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
 *   cohort-section -> the module's own allotment, capped by the shared section
 *                     clock, is both; expiry is null (inert) when the stage
 *                     names another section.
 *
 * Why the section-keyed pair is a minimum: a candidate sits Module 1 plus
 * exactly one Module 2, so the section's authored length is M1 + one branch,
 * and the module's own allotment is the countdown the student is meant to read
 * (Math Module 1 is 35:00, then Module 2 starts a fresh 35:00). The shared
 * section clock is still the cap — it is what stops a late arrival or a stalled
 * device from outliving the section — so the two anchors meet exactly in a
 * normal run: section = M1 + M2, and the module clock governs until the section
 * runs out first. The server closes on the same pair
 * (delivery.reconcileCohortSectionExpiredTx).
 *
 * `personalSeconds` is null when this frame has no module attempt to read (a
 * payload that has not hydrated the row yet). Null must NOT be treated as zero:
 * a 0:00 display would both misinform the student and arm the expiry. An absent
 * personal clock falls back to the section clock alone, which is what a frame
 * with no module identity did before this rule existed.
 */
export function satCountdown(input: {
  timingModel: MaybeString;
  stageKey: MaybeString;
  sectionKey: MaybeString;
  personalSeconds: number | null;
  authoritativeSeconds: number;
}): SatCountdown {
  if (isSatPersonalTimingModel(input.timingModel)) {
    // Personal SAT stages belong to this attempt. The cohort section clock
    // remains a run-sheet projection only; it cannot cap or advance this
    // student's module/break deadline.
    return {
      displaySeconds: input.personalSeconds ?? 0,
      expirySeconds: input.personalSeconds ?? 0,
    };
  }
  if (!isCohortTimingModel(input.timingModel)) {
    // The legacy model has no shared clock at all; a missing attempt reads as
    // no time, exactly as it did before this rule existed.
    return {
      displaySeconds: input.personalSeconds ?? 0,
      expirySeconds: input.personalSeconds ?? 0,
    };
  }
  if (!isSectionKeyedCohortModel(input.timingModel)) {
    return {
      displaySeconds: input.authoritativeSeconds,
      expirySeconds: input.authoritativeSeconds,
    };
  }
  const stageMatchesSection =
    Boolean(input.sectionKey) && input.stageKey === input.sectionKey;
  if (!stageMatchesSection) return { displaySeconds: 0, expirySeconds: null };
  const capped =
    input.personalSeconds === null
      ? input.authoritativeSeconds
      : Math.min(input.personalSeconds, input.authoritativeSeconds);
  return { displaySeconds: capped, expirySeconds: capped };
}

/**
 * The window a pre-entry claim may quote, and where it came from — the single
 * decision point for that claim. A surface that renders it formats the number;
 * it never decides for itself whether the server has one to give.
 */
export interface SatModuleWindow {
  /**
   * The seconds the claim may quote: the window the server published for this
   * module, drained since the payload landed, or the authored allotment when the
   * server published nothing.
   */
  seconds: number;
  /**
   * `granted` — entering this module will hand this candidate this much, per the
   * server's own clamp: a late arrival reads the room's remainder, and 0 once
   * the room has closed the module. `authored` — the server published no window,
   * so the authored length is still the honest claim and no remainder language
   * may be used.
   */
  source: "granted" | "authored";
}

/**
 * What entering the pending module will actually grant this candidate.
 *
 * The pre-entry screen used to quote the AUTHORED module length, which the room
 * may no longer have: delivery clamps a cohort module's window to the room's own
 * boundary (Module 1 ends at the section's start plus its authored length; the
 * branch module ends with the section), so a student who joins late is handed
 * the remainder — or nothing, when the room has already closed that module. The
 * server publishes that clamp ahead of entry (`entryWindowSeconds`), so this
 * resolves the claim from the server's own arithmetic rather than re-deriving
 * the boundary here, and drains it with `drainSinceSnapshot` — the same
 * convention `personalModuleRemainingSeconds` uses — so the promise and the
 * module clock the student lands in cannot diverge.
 *
 * The authored length is the answer for every frame the server said nothing
 * about: no module attempt yet, a non-cohort provider, a payload from before the
 * field existed, or a module that has already started, whose own
 * deadlineAt/remainingSeconds are the truth and whose pre-entry window must not
 * outlive entry. A paused room's clock is stopped, so the published window is
 * returned whole; between polls it drains at real time, exactly as the running
 * countdowns do.
 */
export function satModuleWindow(input: {
  attempt: AssessmentModuleAttemptSnapshot | undefined;
  authoredSeconds: number;
  snapshotReceivedAt: number;
  now: number;
  running: boolean;
}): SatModuleWindow {
  const authored: SatModuleWindow = {
    seconds: Math.max(0, Math.round(input.authoredSeconds)),
    source: "authored",
  };
  const attempt = input.attempt;
  if (!attempt || attempt.startedAt || attempt.state !== "not_started") return authored;
  const published = attempt.entryWindowSeconds;
  if (published === null || published === undefined || !Number.isFinite(published)) {
    return authored;
  }
  return {
    seconds: drainSinceSnapshot(published, input.snapshotReceivedAt, input.now, input.running),
    source: "granted",
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
