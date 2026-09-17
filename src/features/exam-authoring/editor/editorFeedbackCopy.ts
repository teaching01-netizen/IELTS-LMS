/**
 * One feedback vocabulary for the editor.
 *
 * The composer has a single in-editor surface that says what just happened and
 * offers the way back. This module owns the words and the shapes (no React), so
 * the presenter stays dumb, the copy stays testable on its own, and every
 * action that touches the document can raise the same, undoable signal.
 *
 * Timings follow the product's promise that mistakes stay cheap: anything the
 * author can undo is held for six seconds, plain acknowledgements for four.
 */
export const FEEDBACK_UNDO_MS = 6000;
export const FEEDBACK_INFO_MS = 4000;

export interface EditorFeedbackAction {
  id: string;
  label: string;
  onSelect: () => void;
}

export interface EditorFeedbackItem {
  /** Changes on every raise, so the presenter restarts its timer. */
  id: string;
  message: string;
  /** Rendered in order; the undo action is always last. */
  actions: EditorFeedbackAction[];
  /** True when the last action takes the document back. */
  undoable: boolean;
  timeoutMs: number;
}

export interface EditorFeedbackInput {
  message: string;
  /** Offer the way back. The editor has history; the surface teaches it. */
  undoable?: boolean;
  undoLabel?: string | undefined;
  actions?: EditorFeedbackAction[];
  timeoutMs?: number;
}

export type EditorFeedbackPublisher = (input: EditorFeedbackInput) => void;

/**
 * Builds the surface payload for an author action. The undo command is injected
 * by the composer, which owns the editor — the publisher only describes what
 * happened.
 */
export function buildActionFeedback(
  input: EditorFeedbackInput,
  id: string,
  undo: () => void
): EditorFeedbackItem {
  const actions = [...(input.actions ?? [])];
  if (input.undoable) {
    actions.push({ id: "undo", label: input.undoLabel ?? "Undo", onSelect: undo });
  }
  return {
    id,
    message: input.message,
    actions,
    undoable: Boolean(input.undoable),
    timeoutMs: input.timeoutMs ?? (input.undoable ? FEEDBACK_UNDO_MS : FEEDBACK_INFO_MS),
  };
}

export interface PasteFeedbackSource {
  visible: boolean;
  imageCount: number;
  mathCount: number;
  needsAltText: boolean;
  canUndo?: boolean;
  rejectedImageCount?: number;
}

export interface PasteFeedbackHandlers {
  onUndo: () => void;
  onAddAltText?: (() => void) | undefined;
}

/**
 * Paste copy is unchanged from the surface this replaced: one sentence, the
 * count that matters, and the one action worth offering. Undo is withheld for
 * rejected-only imports because there is nothing to take back.
 */
export function buildPasteFeedback(
  status: PasteFeedbackSource,
  handlers: PasteFeedbackHandlers,
  id: string
): EditorFeedbackItem | null {
  if (!status.visible) return null;
  const rejectedCopy =
    (status.rejectedImageCount ?? 0) > 0
      ? " " +
        status.rejectedImageCount +
        " visual" +
        (status.rejectedImageCount === 1 ? " was" : "s were") +
        " not imported."
      : "";
  const message =
    status.imageCount > 0
      ? "Pasted " +
        status.imageCount +
        " visual" +
        (status.imageCount === 1 ? "" : "s") +
        " \u2014 add alt text in the image dialog" +
        rejectedCopy
      : (status.rejectedImageCount ?? 0) > 0
        ? rejectedCopy.trim()
        : status.mathCount > 0
          ? status.mathCount + " equation" + (status.mathCount === 1 ? "" : "s") + " formatted"
          : "Pasted formatted content";
  const actions: EditorFeedbackAction[] =
    status.needsAltText && handlers.onAddAltText
      ? [{ id: "alt", label: "Add alt text", onSelect: handlers.onAddAltText }]
      : [];
  const undoable = status.canUndo !== false;
  if (undoable) actions.push({ id: "undo", label: "Undo paste", onSelect: handlers.onUndo });
  return { id, message, actions, undoable, timeoutMs: FEEDBACK_UNDO_MS };
}
