import type { ReactNode } from "react";
import { EditorTooltip } from "./EditorTooltip";

/**
 * One control contract for every editor surface: same hit area, same pressed
 * state, same delayed hover label, same refusal to steal the selection on
 * mousedown. The toolbar, the table strip, the selection bubble, and the object
 * surfaces all render through this, so a control behaves identically wherever it
 * appears and only its placement changes.
 *
 * This is deliberately the *only* button recipe in the editor: a second,
 * slightly different one is how the toolbar and its contextual surfaces drift
 * apart without anyone deciding to.
 */
export function EditorControl({
  label,
  tooltipLabel,
  shortcut,
  onSelect,
  active,
  disabled,
  className,
  children,
}: {
  /** Accessible name. Never shortened for space, and it may carry the shortcut. */
  label: string;
  /** Visible hover label, when the name a screen reader needs is too long for one. */
  tooltipLabel?: string | undefined;
  /** Keyboard equivalent, shown with the hover label. */
  shortcut?: string | undefined;
  onSelect: () => void;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const visible = tooltipLabel ?? label;
  return (
    <EditorTooltip {...(shortcut ? { label: visible, shortcut } : { label: visible })}>
      <button
        type="button"
        className={className ?? "sat-rich-editor__toolbar-button"}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
      >
        {children}
      </button>
    </EditorTooltip>
  );
}
