import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleEntryStateAck,
} from "../contracts/assessmentDelivery";
import { isEntryAck } from "./satEntryAck";

/**
 * Entry-ack control-epoch adoption for the live StartModule path.
 *
 * Why this exists: the server bumps `student_attempts.control_epoch` inside the
 * same transaction that opens (or confirms) a module, then answers the
 * transition command with a compact ack carrying the POST-commit epoch. The
 * client used to drop it — `applyEntryAck` merges the ack into a bootstrap
 * payload that has no epoch field — so the first answer after entry still rode
 * the pre-bump fence and the server refused it 409 CONTROL_EPOCH_STALE. The
 * engine could only recover by spending a heal round trip (snapshot fetch +
 * re-issue under a new writeId/version) on a keystroke the student made seconds
 * after the module appeared.
 *
 * This module owns only what the wire can prove: whether the response is an
 * entry ack, whether that ack belongs to this attempt, whether the epoch is a
 * usable integer, and raising the caller's belief with `Math.max`. WHETHER the
 * epoch may actually be adopted is the engine's decision (idle, pre-recovery,
 * conflict posture, monotonicity) — see
 * `DurableResponseEngine.adoptControlEpochIfIdle`.
 *
 * Personal timing also uses the single-operation `startModule`. The old
 * `enterModule` offer/confirm endpoint and the `entry-state` recovery read have
 * no SAT client caller. If either is wired later, its raw ack must pass through
 * this helper before the payload is merged. The `source` label identifies the
 * path that offered the epoch.
 */

export type EntryControlEpochSkipReason =
  "not_entry_ack" | "ack_identity_mismatch" | "invalid_epoch";

export type EntryControlEpochOffer =
  { offered: true; controlEpoch: number } | { offered: false; reason: EntryControlEpochSkipReason };

export interface EntryControlEpochContext {
  scheduleId: string;
  attemptId: string;
  /**
   * The highest epoch the caller already believes it holds (the request fence
   * carried on transition commands). May be unknown before the first ack.
   */
  currentControlEpoch: number | null | undefined;
  /** Hand the raised epoch to the durability engine. */
  adopt: (epoch: number, source: string) => void;
  /**
   * Reason-coded telemetry for the refusals this seam owns. Not called for a
   * plain bootstrap response: that carries no epoch on the wire and is the
   * normal shape of every non-entry payload, so reporting it would be noise.
   */
  onSkipped?: (reason: EntryControlEpochSkipReason, source: string) => void;
}

/**
 * Offer an entry ack's control epoch to the engine, before the payload is
 * merged or committed.
 *
 * A refused offer is never a failure: the engine's own guards and the existing
 * 409 -> heal path remain authoritative, so this can only ever skip.
 */
export function adoptEntryControlEpochFromAck(
  response: AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck,
  context: EntryControlEpochContext,
  source: string
): EntryControlEpochOffer {
  if (!isEntryAck(response)) return { offered: false, reason: "not_entry_ack" };
  // Validate the ack ITSELF, never a merged payload: an ack for another attempt
  // or schedule is not this engine's fence.
  if (response.attemptId !== context.attemptId || response.scheduleId !== context.scheduleId) {
    context.onSkipped?.("ack_identity_mismatch", source);
    return { offered: false, reason: "ack_identity_mismatch" };
  }
  const epoch = response.controlEpoch;
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch <= 0) {
    context.onSkipped?.("invalid_epoch", source);
    return { offered: false, reason: "invalid_epoch" };
  }
  // Raise the caller's belief monotonically (the same rule the conflict-retry
  // path uses), then offer it. Offering a value at or below the current belief
  // is deliberate: the belief tracks what this client has SEEN, which can run
  // ahead of what the engine holds when a previous offer was refused as
  // not-idle — and the engine's own clamp decides.
  const controlEpoch = Math.max(epoch, context.currentControlEpoch ?? 0);
  context.adopt(controlEpoch, source);
  return { offered: true, controlEpoch };
}
