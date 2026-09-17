import type { ReactNode } from "react";
import { EditorTooltip } from "./EditorTooltip";

/**
 * One control contract for every editor surface: same hit area, same pressed
 * state, same delayed hover label, same refusal to steal the selection on
 * mousedown. The toolbar, the selection bubble, and the object surfaces all
 * render through this, so a control behaves identically wherever it appears.
 */
export function EditorControl({
  label,
  shortcut,
  onSelect,
  active,
  disabled,
  className,
  children,
}: {
  /** Accessible name. Never shortened for space. */
  label: string;
  /** Keyboard equivalent, shown in the hover label where one exists. */
  shortcut?: string | undefined;
  onSelect: () => void;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <EditorTooltip {...(shortcut ? { label, shortcut } : { label })}>
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
