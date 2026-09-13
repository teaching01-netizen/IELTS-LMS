import type { AuthoringPresence } from "./presenceTypes";

/**
 * Race recovery decisions, isolated from the workspace so every branch is a
 * pure function of (what happened, is it open, is it dirty).
 *
 * Governing rule for all of them: unsaved work is NEVER destroyed, and the
 * editor is never navigated, cleared, re-initialized, or auto-recreated as a
 * side effect of a remote event. Attention matches consequence — a move is a
 * fade, a delete is a recovery surface.
 */
export type RaceRecoveryAction =
  /** Clean-open delete: advance to the next question, drop the draft. */
  | { kind: "advance-selection"; examQuestionId: string }
  /** Dirty-open delete: transform the canvas, keep the draft byte-identical. */
  | {
      kind: "preserve-deleted";
      examQuestionId: string;
      authorName: string | null;
      freezeSavePath: true;
    }
  /** Publish: freeze mutation paths and show the persistent recovery surface. */
  | {
      kind: "preserve-published";
      examQuestionId: string | null;
      freezeMutations: true;
      readOnly: boolean;
    }
  /** Move/reorder: keep the editor open, update the structural binding only. */
  | { kind: "keep-editor-open"; examQuestionId: string; notice: "moved" | "order-updated" }
  /** A background question moved: rail/shell only, nothing to tell the author. */
  | { kind: "background-structural"; examQuestionId: string | null };

/** Author display name for a notice, with the sanctioned neutral fallback. */
export function authorNameOf(
  author: { displayName: string } | null | undefined,
): string | null {
  const name = author?.displayName?.trim() ?? "";
  return name.length > 0 ? name : null;
}

export function decideDeletionRace(args: {
  examQuestionId: string;
  selectedExamQuestionId: string | null;
  isDirty: boolean;
  author?: { displayName: string } | null | undefined;
}): RaceRecoveryAction {
  const isOpen = args.examQuestionId === args.selectedExamQuestionId;
  if (!isOpen) {
    // A background deletion needs no notice: the rail simply stops showing it.
    return { kind: "background-structural", examQuestionId: args.examQuestionId };
  }
  if (!args.isDirty) {
    // Nothing to lose, so the existing delete-selection behavior applies.
    return { kind: "advance-selection", examQuestionId: args.examQuestionId };
  }
  return {
    kind: "preserve-deleted",
    examQuestionId: args.examQuestionId,
    authorName: authorNameOf(args.author),
    freezeSavePath: true,
  };
}

export function decideMoveRace(args: {
  examQuestionId: string | null;
  selectedExamQuestionId: string | null;
  /** Distinguishes a single move from a bulk/reorder announcement. */
  bulk: boolean;
}): RaceRecoveryAction {
  if (!args.examQuestionId || args.examQuestionId !== args.selectedExamQuestionId) {
    return { kind: "background-structural", examQuestionId: args.examQuestionId };
  }
  // Server order always wins, but the editor stays exactly where it is: the
  // draft is not stale just because the row moved.
  return {
    kind: "keep-editor-open",
    examQuestionId: args.examQuestionId,
    notice: args.bulk ? "order-updated" : "moved",
  };
}

export function decidePublishRace(args: {
  selectedExamQuestionId: string | null;
  isDirty: boolean;
}): RaceRecoveryAction {
  if (!args.isDirty) {
    // A clean editor can transition in place: nothing can be lost.
    return {
      kind: "preserve-published",
      examQuestionId: args.selectedExamQuestionId,
      freezeMutations: true,
      readOnly: true,
    };
  }
  // The draft is kept verbatim and the mutation paths are frozen. The recovery
  // surface is persistent because there is no successor draft to assume.
  return {
    kind: "preserve-published",
    examQuestionId: args.selectedExamQuestionId,
    freezeMutations: true,
    readOnly: false,
  };
}

/**
 * Offline / reconnect gate — authoritative first, ALWAYS.
 *
 * The base revision is compared against the server's before any POST. Equality
 * means nobody moved the server and the flush is safe; anything else (including
 * a server that appears older, which should not happen) is conflict recovery.
 * Cheap safety beats clever equality: two textually identical documents still
 * take the conflict path when the revision advanced.
 */
export function decideReconnect(args: {
  baseRevision: number;
  remoteRevision: number;
}): "save" | "conflict-recovery" {
  return args.remoteRevision === args.baseRevision ? "save" : "conflict-recovery";
}

/** Occupants editing the same question, for the subtle header label. */
export function sameQuestionEditors(
  entries: readonly AuthoringPresence[],
  examQuestionId: string | null,
): AuthoringPresence[] {
  if (!examQuestionId) return [];
  return entries.filter(
    (entry) => entry.selectedQuestionId === examQuestionId && entry.state === "editing",
  );
}
