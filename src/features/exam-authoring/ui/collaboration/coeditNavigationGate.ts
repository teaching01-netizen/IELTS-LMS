import type {
  CoeditFlushOutcome,
  CoeditLifecycleIssue,
  CoeditSaveStateName,
} from "../../realtime/coedit/contracts";
import { COEDIT_STALE_CACHE_MESSAGE } from "../../realtime/coedit/contracts";
import { PUBLISH_COPY } from "./collaborationCopy";

/**
 * Whether a SAT authoring navigation may proceed while an exam room is open.
 *
 * The room is the source of truth for the exam's content, but the builder's
 * neighbours — exam preview, release, the exam library — read the committed
 * MySQL projection. Between an edit landing in the Y.Doc and the service's
 * committed acknowledgement, those screens show an older exam. So the rule is
 * not "did the author stop typing" but "has this tab's exact state reached
 * durability", which is the one fact `flushAndWaitForSaved` can prove.
 *
 * Everything here is pure and structural: the provider's snapshot satisfies
 * `CoeditRoomFacts` without being imported, so the decision can be tested
 * without a socket.
 */
export interface CoeditRoomFacts {
  /** The room reached initial sync (a room that never opened holds nothing). */
  ready: boolean;
  /** The token grants write (see `PromptCoeditSnapshot.writeCapable`). */
  writeCapable: boolean;
  issue: CoeditLifecycleIssue;
  issueMessage: string | null;
  saveState: {
    name: CoeditSaveStateName;
    localStateVector: string | null;
    acknowledgedStateVector: string | null;
  };
}

/**
 * How long a route change waits for the room to prove durability.
 *
 * Long enough for a real commit round trip (transport flush, Go, MySQL, ack)
 * and short enough that a genuinely stuck room hands control back to the author
 * with an explanation instead of a spinner that never ends.
 */
export const COEDIT_ROUTE_FLUSH_TIMEOUT_MS = 8_000;

/**
 * How long an HTTP structural mutation waits behind the room.
 *
 * Shorter than a route change on purpose: the author is mid-click with the
 * editor open in front of them, and the mutation is not the only way forward.
 */
export const COEDIT_MUTATION_FLUSH_TIMEOUT_MS = 2_000;

/** True when this tab is holding room content the server has not confirmed. */
export function coeditRoomHoldsUnconfirmedWork(room: CoeditRoomFacts): boolean {
  const { localStateVector, acknowledgedStateVector } = room.saveState;
  return localStateVector !== null && localStateVector !== acknowledgedStateVector;
}

/**
 * Copy for a blocked navigation, or null when the navigation may proceed.
 *
 * `outcome` is the flush's answer about THIS tab's state vector. Only `saved`
 * is durability; every other outcome is reported as what it is, because the
 * alternative — proceeding and letting the next screen render MySQL without
 * the author's work — is indistinguishable from losing the work.
 *
 * A session whose token cannot write is never blocked. It cannot have authored
 * room content, so there is nothing of its own to strand, and the ordinary case
 * for an observer (a room that never commits while they read) would otherwise
 * trap them on the page.
 */
export function coeditRoomBlockMessage(
  room: CoeditRoomFacts,
  outcome: CoeditFlushOutcome,
): string | null {
  if (outcome === "saved") return null;
  if (!room.writeCapable) return null;
  return COEDIT_ROOM_BLOCK_COPY[outcome];
}

/**
 * One sentence per outcome, in the author's terms.
 *
 * Nothing here says "error" or "failed" for a room that is merely waiting: the
 * work is on this device and the author's problem is what the NEXT screen will
 * show, which is exactly what the copy names.
 */
export const COEDIT_ROOM_BLOCK_COPY: Record<Exclude<CoeditFlushOutcome, "saved">, string> = {
  pending:
    "This exam's latest changes are still being confirmed. Try again in a moment — opening another screen now could show it without them.",
  offline:
    "You are offline. This exam's changes are saved on this device; reconnect before leaving so the next screen can show them.",
  refused:
    "The collaboration service refused your latest changes, so the preview would not show them. Copy them out before leaving.",
  stale_cache: COEDIT_STALE_CACHE_MESSAGE,
  // A room only reports `read_only` to a writer when it was frozen (published)
  // while this tab was open: its local work can never be committed from here.
  read_only: `${PUBLISH_COPY.readOnlyNotice}. Your latest changes could not be saved here. Copy them out before leaving.`,
  ended:
    "This collaboration session has ended, so your latest changes cannot be saved here. Copy them out before leaving.",
};

/**
 * Whether an unload should be questioned at all.
 *
 * Deliberately narrow. `syncing` is not worth interrupting: the service already
 * holds the update and the local copy is in IndexedDB, so an unload mid-commit
 * cannot lose the work. `unsaved` means the transport is down, and `error`
 * covers a refusal, an ended room, and an expired token — the states where the
 * next keystroke would not be saved anywhere. The vector comparison keeps a
 * merely-reported problem (an ended room whose work IS committed) quiet.
 */
export function coeditRoomShouldWarnBeforeUnload(room: CoeditRoomFacts): boolean {
  if (!room.writeCapable || !room.ready) return false;
  if (!coeditRoomHoldsUnconfirmedWork(room)) return false;
  return room.saveState.name === "unsaved" || room.saveState.name === "error";
}
