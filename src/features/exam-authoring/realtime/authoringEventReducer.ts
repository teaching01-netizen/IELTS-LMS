import type {
  AuthoringEventV1,
  AuthoringInboundFrame,
  AuthoringSnapshotReason,
} from "./contracts";

/**
 * Pure ordering / dedupe reducer over the transport cursor. No I/O, no React,
 * and NO mutation: every transition returns a fresh state alongside the action,
 * so replay tests, property tests, and React integration can all share it
 * without aliasing surprises.
 *
 * CRITICAL: the cursor is an opaque, NON-CONTIGUOUS position. Skipped values
 * belong to other exams, kinds, and origins, so the client must NEVER infer a
 * gap from arithmetic (`cursor === last + 1` is meaningless here). Loss is
 * signalled EXPLICITLY by the server as `authoring.snapshot_required`
 * (cursor_too_old / replay_too_large / delivery_gap / unsupported_event), and
 * that frame is what drives authoritative HTTP refetch.
 *
 * Therefore the transition table is tiny and total:
 *   last === null or cursor > last  -> process (advance)
 *   cursor === last                 -> ignore-duplicate (never re-apply)
 *   cursor < last                   -> ignore-out-of-order (never rewind)
 */

export interface AuthoringReducerState {
  lastProcessedCursor: number | null;
}

export function createAuthoringEventState(
  initialLastSeen: number | null = null,
): AuthoringReducerState {
  return { lastProcessedCursor: initialLastSeen };
}

/**
 * Seed the baseline from the HANDSHAKE rather than from the first arbitrary
 * event. A fresh subscribe replays nothing, so the server's barrier cursor is
 * the position the stream is guaranteed complete from; without this, an event
 * that lands between the last HTTP read and the subscribe is silently lost and
 * never even looks like a gap.
 *
 * Monotonic: a stale/duplicate ack can never rewind an established cursor.
 */
export function seedAuthoringBaseline(
  state: Readonly<AuthoringReducerState>,
  barrierCursor: number,
): AuthoringReducerState {
  const last = state.lastProcessedCursor;
  if (last !== null && last >= barrierCursor) {
    return state;
  }
  return { lastProcessedCursor: barrierCursor };
}

/**
 * Consume a transport cursor WITHOUT executing business behavior — used for a
 * structurally valid frame whose event kind this build does not know. Forward
 * compatibility must not create phantom loss, and it must not let the resume
 * cursor lag behind events the server already sent.
 *
 * Monotonic: never rewinds.
 */
export function advanceAuthoringCursor(
  state: Readonly<AuthoringReducerState>,
  cursor: number,
): AuthoringReducerState {
  const last = state.lastProcessedCursor;
  if (last !== null && last >= cursor) {
    return state;
  }
  return { lastProcessedCursor: cursor };
}

/** Lifecycle kinds survive the stale-draft filter so the workspace can re-resolve. */
const LIFECYCLE_REBIND_KINDS: ReadonlySet<string> = new Set([
  "draft.replaced",
  "exam.published",
]);

export type AuthoringReduceAction =
  | { action: "process"; event: AuthoringEventV1; cursor: number }
  | { action: "ignore-duplicate"; event: AuthoringEventV1; cursor: number }
  | { action: "ignore-out-of-order"; event: AuthoringEventV1; cursor: number }
  | { action: "ignore-stale-draft"; event: AuthoringEventV1; cursor: number }
  | {
      action: "snapshot-required";
      reason: AuthoringSnapshotReason;
      examId: string;
      draftVersionId: string;
    }
  | { action: "ignore-unknown"; rawType: string };

export interface AuthoringReduceResult {
  state: AuthoringReducerState;
  action: AuthoringReduceAction;
}

/**
 * Reduce one validated inbound frame. Pure: the returned `state` is the new
 * cursor state (the input is never touched), and `action` describes what the
 * caller should do with the frame.
 */
export function reduceAuthoringFrame(
  state: Readonly<AuthoringReducerState>,
  frame: AuthoringInboundFrame,
  boundDraftVersionId: string | null,
): AuthoringReduceResult {
  if (frame.type === "authoring.snapshot_required") {
    return {
      state,
      action: {
        action: "snapshot-required",
        reason: frame.reason,
        examId: frame.examId,
        draftVersionId: frame.draftVersionId,
      },
    };
  }
  if (frame.type !== "authoring.event") {
    // subscribed / capabilities / error are connection-level; the client owns
    // them. A re-subscribe ack in particular must never move the cursor.
    return { state, action: { action: "ignore-unknown", rawType: frame.type } };
  }

  const { event, cursor } = frame;
  const bound = boundDraftVersionId?.trim() ?? "";
  if (
    bound &&
    event.scope.draftVersionId !== bound &&
    !LIFECYCLE_REBIND_KINDS.has(event.kind)
  ) {
    // A different working draft produced this content event: the state it
    // describes does not apply to the bound draft. Lifecycle kinds still flow.
    return { state, action: { action: "ignore-stale-draft", event, cursor } };
  }

  const last = state.lastProcessedCursor;
  if (last === null || cursor > last) {
    return {
      state: { lastProcessedCursor: cursor },
      action: { action: "process", event, cursor },
    };
  }
  if (cursor === last) {
    return { state, action: { action: "ignore-duplicate", event, cursor } };
  }
  return { state, action: { action: "ignore-out-of-order", event, cursor } };
}
