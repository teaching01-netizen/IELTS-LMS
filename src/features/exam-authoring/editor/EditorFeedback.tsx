import { useEffect, useState } from "react";
import type { EditorFeedbackItem } from "./editorFeedbackCopy";

/**
 * The editor's one acknowledgement surface: what just happened, plus the way
 * back while it is still cheap.
 *
 * It is deliberately not a toast system. It lives at the bottom of the field
 * being edited, so the message and the object it describes share a frame. The
 * toolbar Undo stays where it is; this surface exists to teach that Undo is
 * there, which is why it holds the way back longer than a plain acknowledgement
 * and stops counting down while the author is reading it.
 */
export function EditorFeedback({
  feedback,
  onDismiss,
}: {
  feedback: EditorFeedbackItem | null;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const id = feedback?.id ?? null;
  const timeoutMs = feedback?.timeoutMs ?? 0;

  useEffect(() => {
    setPaused(false);
  }, [id]);

  useEffect(() => {
    if (id === null || paused || timeoutMs <= 0) return;
    const timer = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [id, paused, timeoutMs, onDismiss]);

  if (!feedback) return null;
  return (
    // The pointer/focus listeners are timer lifecycle signals (stop counting
    // down while the author is reading), not interaction handlers.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="status"
      aria-live="polite"
      data-editor-feedback={feedback.id}
      className="sat-rich-editor__feedback"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className="sat-rich-editor__feedback-message">{feedback.message}</span>
      {feedback.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          aria-label={action.label}
          onClick={action.onSelect}
          onMouseDown={(event) => event.preventDefault()}
          className={action.id === "undo" ? "sat-rich-editor__feedback-undo" : undefined}
          data-feedback-action={action.id}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
