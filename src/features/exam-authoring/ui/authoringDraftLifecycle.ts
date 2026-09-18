/**
 * The open draft's lifecycle, as ONE state.
 *
 * WHY THIS EXISTS
 * ---------------
 * "What is happening to the draft I am editing?" used to be answered by four
 * independent booleans that every reader recombined for itself:
 *
 *   - `publishedFrozen`      — the exam draft was published elsewhere
 *   - `divergence.deletedRemotely` — the question was deleted elsewhere
 *   - `diverged`             — a newer server revision exists while local work is held
 *   - `hasPendingChanges`    — unacknowledged local work exists
 *
 * Each was declared wherever its first reader happened to sit, mirrored into a
 * ref by its own effect, and re-read by the save router, the autosave queue, the
 * refetch guard and five surfaces. Nothing prevented the combinations the plan
 * names as impossible — `deleted remotely + editable + network saving +
 * published` was representable, and the only reason it did not surface was that
 * each reader happened to check its own flag first.
 *
 * This module makes the precedence explicit and total: exactly one state is
 * derived from the conditions, the conditions stay readable for the questions
 * that genuinely ask about one of them ("is this question gone?", "is this exam
 * published?"), and the refs the imperative seams read are PROJECTIONS of the
 * derived state rather than independently-set mirrors.
 *
 * Scope, deliberately: this is the DRAFT's lifecycle, not the workspace's. The
 * selection, the mode, the row-mutation flight flag and the collaboration
 * connection are separate machines with separate owners; folding them in here
 * would produce the one enormous reducer the plan warns against.
 */
import type { QuestionRevision } from "../contracts/assessment";
import type { QuestionSaveStatus } from "../hooks/useQuestionAutosave";

/**
 * The precedence-resolved summary.
 *
 * Order matters and is locked by `authoringDraftLifecycle.test.ts`. It is the
 * order the save router already used (the published target is checked before
 * the deleted one, because a published draft answers the write with "open the
 * new draft" while a deleted question answers 404), extended to the remaining
 * conditions:
 *
 *   loading → published-readonly → deleted-remotely → conflicted → saving → editing
 */
export type DraftLifecycleState =
  | "loading"
  | "editing"
  | "saving"
  | "conflicted"
  | "deleted-remotely"
  | "published-readonly";

export interface DraftLifecycleInput {
  /** The local document, exactly as the workspace owns it. */
  draft: QuestionRevision | null;
  saveStatus: QuestionSaveStatus;
  hasPendingChanges: boolean;
  /** The author's content differs from the revision it was authored against. */
  divergedFromBase: boolean;
  /** The exam draft was published elsewhere: this revision is no longer a write target. */
  publishedReadOnly: boolean;
  /** The question was deleted elsewhere: this revision can only answer 404. */
  deletedRemotely: boolean;
}

export interface DraftLifecycle {
  state: DraftLifecycleState;
  /**
   * The local document. A REFERENCE to the workspace's draft, never a copy: the
   * content has one owner (the workspace's `draft` state) and this model only
   * describes what is happening to it.
   */
  local: QuestionRevision | null;
  /** The condition, independent of the resolved state (a published draft can also be deleted). */
  publishedReadOnly: boolean;
  deletedRemotely: boolean;
  /** A newer server revision exists while local work is held. */
  conflicted: boolean;
  /** Unacknowledged local work exists (pending write, or content diverged from its base). */
  dirty: boolean;
}

export function deriveDraftLifecycle(input: DraftLifecycleInput): DraftLifecycle {
  const dirty = input.hasPendingChanges || input.divergedFromBase;
  // The 409 fence and a socket-delivered newer revision are the same product
  // condition: the author holds work and the server has moved past its base.
  // The fence arrives over HTTP with no socket at all, which is why it has to
  // be folded in here rather than left to the divergence store.
  const conflicted = input.divergedFromBase || input.saveStatus === "conflict";

  const state: DraftLifecycleState =
    input.draft === null
      ? "loading"
      : input.publishedReadOnly
        ? "published-readonly"
        : input.deletedRemotely
          ? "deleted-remotely"
          : conflicted
            ? "conflicted"
            : input.saveStatus === "saving"
              ? "saving"
              : "editing";

  return {
    state,
    local: input.draft,
    publishedReadOnly: input.publishedReadOnly,
    deletedRemotely: input.deletedRemotely,
    conflicted,
    dirty,
  };
}

/**
 * What the imperative seams read.
 *
 * The save router, the autosave queue and the refetch guard are not React
 * consumers — they read at call time, after awaits, so they read refs. Those
 * refs are the ONLY thing this function produces: one projection of one state,
 * written by one effect, so no seam can observe a combination the state says is
 * impossible.
 */
export interface DraftSeams {
  /** The write target is invalid (published elsewhere). */
  mutationFrozen: boolean;
  /** The write target is gone (deleted elsewhere). */
  deletedRemotely: boolean;
  /** A refetch may not adopt the server document over held local work. */
  protectLocalCopy: boolean;
  /** HTTP writes are held back: a newer revision exists and the local copy is the durable one. */
  networkSavePaused: boolean;
}

export function resolveDraftSeams(lifecycle: DraftLifecycle): DraftSeams {
  return {
    mutationFrozen: lifecycle.publishedReadOnly,
    deletedRemotely: lifecycle.deletedRemotely,
    // Gated on a local document existing: a pending flag that arrived BEFORE the
    // editor had anything in it (a recovered device draft) must not block the
    // seed, or the question would never open at all.
    protectLocalCopy: lifecycle.local !== null && lifecycle.dirty,
    // Pausing while conflicted is the point of the state: a fenced draft that
    // kept retrying would re-send a payload the server has already refused.
    networkSavePaused: lifecycle.conflicted,
  };
}
