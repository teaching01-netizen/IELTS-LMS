import type { QuestionRevision } from "../contracts/assessment";

/**
 * Phase 05 divergence vocabulary. Four slots per question — base / local /
 * remote revision / remote document — are retained even though this phase only
 * ships wholesale resolution, so a future three-way MERGE can be added without
 * re-plumbing the data flow. The comparison itself (threeWayCompare) only needs
 * the three documents; `remoteRevision` exists so divergence can be detected
 * from an event alone, before any remote document has been fetched.
 */

export type DivergenceStatus =
  | "clean" // local == base, no remote newer
  | "dirty" // local edits, no known remote newer
  | "diverged" // dirty AND a remote revision is newer
  | "remote-newer-clean"; // clean AND remote newer (the refetch-replace case)

/** Display-only attribution for a remote change. Never carries content. */
export interface RemoteChangeAuthor {
  displayName: string;
  savedAt?: string | undefined;
}

export interface QuestionDivergence {
  examQuestionId: string;
  /** Revision the editor last agreed with the server on. */
  baseRevision: number;
  baseDocument: QuestionRevision | null;
  /** Current editor content. Never written by a remote event. */
  localDocument: QuestionRevision | null;
  /** Newest remote revision observed via event or refetch; null when none. */
  remoteRevision: number | null;
  /** Fetched lazily on Compare, never from an event payload. */
  remoteDocument: QuestionRevision | null;
  status: DivergenceStatus;
  remoteAuthor?: RemoteChangeAuthor | undefined;
  /**
   * A remote structural op landed while this question had an unsaved draft.
   * These are flags on an EXISTING status, not new statuses: the local draft
   * remains a draft, it is simply known-obsolete server-side.
   */
  deletedRemotely?: boolean | undefined;
  movedRemotely?: boolean | undefined;
  bulkChangedRemotely?: boolean | undefined;
  /** Client ISO timestamp for TTL/debug. Never an ordering authority. */
  updatedAt: string;
}

export type DivergenceEvent =
  | {
      /**
       * A new question was opened (or refetched). `local` is supplied only when
       * a durable draft was recovered, which correctly starts the question
       * dirty instead of clean.
       */
      type: "INIT_BASELINE";
      examQuestionId: string;
      base: QuestionRevision;
      local?: QuestionRevision | null | undefined;
    }
  | { type: "LOCAL_EDIT"; examQuestionId: string; local: QuestionRevision }
  | { type: "SERVER_ACK"; examQuestionId: string; saved: QuestionRevision }
  | {
      type: "REMOTE_REVISION";
      examQuestionId: string;
      remoteRevision: number;
      author?: RemoteChangeAuthor | undefined;
      /**
       * The caller's autosave truth. Supplied explicitly because dirty is
       * DEFINED as `autosave.hasPendingChanges || content differs from base`,
       * and the document comparison alone cannot see an unsaved-but-identical
       * pending write.
       */
      hasPendingChanges?: boolean | undefined;
    }
  | { type: "REMOTE_DOCUMENT"; examQuestionId: string; remote: QuestionRevision }
  | {
      type: "REMOTE_DELETED";
      examQuestionId: string;
      author?: RemoteChangeAuthor | undefined;
    }
  | { type: "REMOTE_MOVED"; examQuestionId: string }
  | { type: "REMOTE_BULK_CHANGED"; examQuestionId: string }
  | { type: "RESOLVE_USE_LATEST"; examQuestionId: string; remote: QuestionRevision }
  | { type: "RESOLVE_KEEP_EDITING"; examQuestionId: string }
  | { type: "CLOSE_QUESTION"; examQuestionId: string };

/**
 * Dirty derivation — the ONLY sanctioned rule:
 *
 *   dirty = autosave.hasPendingChanges
 *           || (localDocument != null && baseDocument != null
 *               && !documentContentEquals(localDocument, baseDocument))
 *
 * NEVER derived from DOM state, focus, keystroke listeners, or scroll. A
 * keystroke that produces no content change (selecting an option twice, typing
 * then deleting) must not read as dirty.
 */
export function deriveDivergenceStatus(args: {
  hasPendingChanges: boolean;
  contentDiffers: boolean;
  remoteRevision: number | null;
  baseRevision: number;
}): DivergenceStatus {
  const dirty = args.hasPendingChanges || args.contentDiffers;
  const remoteNewer =
    args.remoteRevision !== null && args.remoteRevision > args.baseRevision;
  if (dirty) {
    return remoteNewer ? "diverged" : "dirty";
  }
  return remoteNewer ? "remote-newer-clean" : "clean";
}
