import { Highlighter, StickyNote, Trash2, Underline, X } from 'lucide-react';
import type { SatHighlightColor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { satHighlightInkList } from './satAnnotationPalette';

/**
 * The annotation action controls, shared by the desktop toolbar, the touch
 * dock, and the edit dock.
 *
 * House rules encoded here (they are the whole reason these are one component
 * instead of three copies):
 * - every action keeps a written label — an unlabeled glyph is a puzzle, and
 *   the whole feature is meant to be understood without instruction;
 * - the visible swatch stays 18–22px while the hit target stays >= 44px, so
 *   touch requires no precision;
 * - the three inks are PRIMARY and underline/note are SECONDARY, matching how
 *   students actually annotate;
 * - every user-visible string and accessible name comes from SAT_COPY, so the
 *   words live in one table and never drift from what the tests assert.
 */

const ACTION_BASE =
  'sat-touch-target sat-pressable inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-[6px] px-2 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]';

export function SatHighlightSwatchButtons({
  value,
  onSelect,
  disabled,
  current,
}: {
  /** Ink currently applied to the target mark, when editing an existing one. */
  value?: SatHighlightColor | null | undefined;
  /** Ink the NEXT action will use (drives the pressed state on a fresh selection). */
  current?: SatHighlightColor | undefined;
  onSelect: (color: SatHighlightColor) => void;
  disabled?: boolean | undefined;
}) {
  const active = value ?? current;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={SAT_COPY.annotations.highlight}>
      {satHighlightInkList.map((ink) => {
        const pressed = active === ink.color;
        return (
          <button
            key={ink.color}
            type="button"
            data-sat-annotation-action={'highlight-' + ink.color}
            // The ink's own name plus the action it belongs to: the group
            // already says "Highlight", so the name is unique and readable.
            aria-label={`${SAT_COPY.annotations.highlight} ${ink.label}`}
            aria-pressed={pressed}
            disabled={disabled === true}
            // Keep the native selection visually intact: mousedown would
            // otherwise collapse it the instant the student reaches for a
            // color, and the toolbar would disappear under their finger.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(ink.color)}
            className={ACTION_BASE + (pressed ? ' bg-[var(--sat-surface-selected,rgba(0,0,0,0.06))]' : '')}
          >
            <span
              aria-hidden="true"
              data-sat-swatch={ink.color}
              className="h-[20px] w-[20px] shrink-0 rounded-full border border-[var(--sat-divider-strong)]"
              style={{ backgroundColor: ink.swatch }}
            />
            <span className="whitespace-nowrap">{ink.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SatUnderlineControl({
  onSelect,
  disabled,
  pressed,
}: {
  onSelect: () => void;
  disabled?: boolean | undefined;
  pressed?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      data-sat-annotation-action="underline"
      aria-label={SAT_COPY.annotations.underline}
      aria-pressed={pressed === true}
      disabled={disabled === true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={ACTION_BASE}
    >
      <Underline className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{SAT_COPY.annotations.underline}</span>
    </button>
  );
}

export function SatNoteControl({
  onSelect,
  disabled,
  hasNote,
}: {
  onSelect: () => void;
  disabled?: boolean | undefined;
  hasNote: boolean;
}) {
  const label = hasNote ? SAT_COPY.annotations.editNote : SAT_COPY.annotations.addNote;
  return (
    <button
      type="button"
      data-sat-annotation-action="note"
      aria-label={label}
      disabled={disabled === true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={ACTION_BASE}
    >
      <StickyNote className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function SatRemoveControl({
  onSelect,
  disabled,
  label,
}: {
  onSelect: () => void;
  disabled?: boolean | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      data-sat-annotation-action="remove"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      disabled={disabled === true}
      className={ACTION_BASE + ' w-full justify-start text-[var(--sat-danger)] hover:bg-[var(--sat-danger-soft)]'}
    >
      <Trash2 className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

/**
 * The way out of a popover, written and labeled like every other action.
 *
 * Esc, a new selection, and (on desktop) a click outside already close these
 * tools, but none of them is visible: a student who does not want the toolbar
 * anymore needs a control they can see rather than a gesture they must guess.
 * It stays at full target size while reading as secondary, so it is easy to hit
 * and hard to mistake for an annotation action.
 */
export function SatCloseControl({
  onSelect,
  disabled,
  label,
}: {
  onSelect: () => void;
  disabled?: boolean | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      data-sat-annotation-action="close"
      // Marked as a dismissal so the shared autofocus skips it: the caret
      // belongs on the action the student opened these tools for, and the first
      // button in the markup is now the way out rather than a way in.
      data-sat-annotation-dismiss="true"
      aria-label={label}
      disabled={disabled === true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={ACTION_BASE + ' text-[var(--sat-text-secondary)]'}
    >
      <X className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
    </button>
  );
}

/** Small heading the spec insists on: it links selection -> these colors -> highlight. */
export function SatAnnotationHeading() {
  return (
    <p className="flex items-center gap-1.5 sat-type-metadata font-semibold uppercase tracking-wide text-[var(--sat-text-secondary)]">
      <Highlighter className="h-[15px] w-[15px]" aria-hidden="true" />
      {SAT_COPY.annotations.highlight}
    </p>
  );
}
