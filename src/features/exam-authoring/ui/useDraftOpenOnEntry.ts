import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  consumeAuthoringDraftOnEntry,
  peekAuthoringDraftOnEntry,
} from "../application/authoringEntryIntent";
import type { AuthoringShellState } from "../application/authoringShellLifecycle";

export interface DraftOpenOnEntryInput {
  examId: string;
  /** The shell read's lifecycle state. Loading is not an answer (see below). */
  state: AuthoringShellState;
  /** The role gate for the open command. Same gate the CTA uses. */
  canOpenDraft: boolean;
  /** The open command is in flight. */
  isOpening: boolean;
  /** The open command failed and its error is the current answer. */
  isFailed: boolean;
  /** The open command (POST). Invoked at most once per arrival. */
  openDraft: () => void;
}

export interface DraftOpenOnEntry {
  /**
   * True while an entry gesture is opening the draft, so the caller renders
   * progress instead of the lifecycle surface. A deliberate "edit this exam"
   * click must never land on a "No editable draft" wall, and the CTA is not
   * the answer to a click the author already made.
   */
  opening: boolean;
}

/**
 * Turn an arrival gesture into exactly one draft open.
 *
 * The gesture itself is `authoringEntryIntent`'s business (an in-memory,
 * expiring, one-shot slot a navigation armed). This hook owns the rule for when
 * a gesture becomes a command, which is deliberately narrow:
 *
 *   - only when the read has ANSWERED. Deciding during `loading` would spend
 *     the gesture on a state that carries no answer and drop the author back
 *     onto the wall once the read landed;
 *   - only for NO_DRAFT, where an open is what the author asked for. A READY
 *     exam is left completely alone — this never re-opens a draft that exists;
 *   - only for a role that may write, exactly like the CTA;
 *   - never more than once per arrival. A guarded ref — not the slot — is what
 *     makes the command single-shot, so a re-render, a second effect pass
 *     (StrictMode), or a background refetch cannot issue a second POST, and a
 *     command that FAILS cannot loop: the author gets the lifecycle surface
 *     with its classified error.
 *
 * The slot is spent, not at fire time but as soon as the arrival cannot use it
 * any more — the exam turned out to have a draft, the role may not write, or
 * the command is running or has already run. Spending it at fire time would
 * blank the progress the author is owed; spending it here means progress lasts
 * exactly as long as the gesture does, and a spent gesture can still never fire
 * at a later arrival.
 *
 * `navigationKey` is what lets a gesture arriving while the workspace is
 * already mounted (the author goes back to the library and picks the same
 * exam) be noticed: every navigation carries a new key, so the decision is
 * re-made per arrival rather than per mount.
 */
export function useDraftOpenOnEntry({
  examId,
  state,
  canOpenDraft,
  isOpening,
  isFailed,
  openDraft,
}: DraftOpenOnEntryInput): DraftOpenOnEntry {
  // The workspace re-creates this closure every render; the effect below must
  // fire the current one without depending on its identity.
  const openRef = useRef(openDraft);
  useEffect(() => {
    openRef.current = openDraft;
  }, [openDraft]);

  const navigationKey = useLocation().key;
  // Which arrival already issued the command. Keyed by navigation rather than by
  // exam so that coming back to the same exam is a new, deliberate arrival.
  const firedFor = useRef<string | null>(null);
  const firedThisArrival = firedFor.current === navigationKey;

  useEffect(() => {
    // No answer yet: the gesture stays armed for the answer, because deciding
    // now would spend it on a state that carries no answer.
    if (state.kind === "loading") return;
    if (state.kind !== "no-draft" || !canOpenDraft) {
      // An arrival this gesture cannot serve cannot stay armed either: the exam
      // turned out to have a draft, or this role may not write one.
      consumeAuthoringDraftOnEntry(examId);
      return;
    }
    if (isOpening) {
      // The command is running, so the gesture has done its job. Spending it
      // here (rather than at fire time) is what lets the surface keep showing
      // progress for the command it issued.
      consumeAuthoringDraftOnEntry(examId);
      return;
    }
    // One command per arrival: the arrival's own answer (a shell, or a
    // classified failure) is what the author sees now. A failed arrival
    // therefore cannot loop, and a LATER arrival is deliberately not blocked by
    // its error: choosing the exam again is a fresh attempt, not a retry of the
    // old one.
    if (firedFor.current === navigationKey) {
      consumeAuthoringDraftOnEntry(examId);
      return;
    }
    if (!peekAuthoringDraftOnEntry(examId)) return;
    firedFor.current = navigationKey;
    openRef.current();
  }, [examId, navigationKey, state.kind, canOpenDraft, isOpening]);

  // Progress is the GESTURE's, not the mutation's: the slot stays armed while
  // the command it issued is outstanding, and expires with it, so a surface
  // that never hears back cannot spin past the gesture's window. The pending
  // branch covers the commits after the slot is spent but before the shell (or
  // the failure) arrives, so a background refetch cannot flash the wall over an
  // open that is still running.
  const opening =
    state.kind === "no-draft" &&
    canOpenDraft &&
    !isFailed &&
    (peekAuthoringDraftOnEntry(examId) || (firedThisArrival && isOpening));

  return { opening };
}
