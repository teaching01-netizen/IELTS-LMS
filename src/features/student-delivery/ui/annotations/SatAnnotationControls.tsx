import { Droplet, SquarePlus, Trash2 } from 'lucide-react';
import type { SatHighlightColor, SatUnderlineStyle } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { satHighlightInkList } from './satAnnotationPalette';

/**
 * The annotation action controls, shared by the selection toolbar and a mark's
 * edit controls (which are the same surface in two states).
 *
 * Bluebook's contextual bar, drawn as it is: one row of quiet glyphs on a
 * rounded pill — the three inks as circles (the one in use drawn larger, with
 * the ink drop inside it), an underline whose line shows the style in use, a
 * note, and (on a mark) a removal. There is no heading and no visible word: the
 * surface hangs off the words it acts on, so the relationship is already
 * spatial, and a caption would only add height to a toolbar the student is
 * trying to read past.
 *
 * Everything that made the labelled version trustworthy survives, because the
 * words were never what made it work:
 * - the glyphs shrink to 18–28px, the HIT TARGETS do not: every action keeps
 *   `sat-touch-target` (44px), so touch still needs no precision;
 * - `onMouseDown` is prevented on every control, so reaching for one never
 *   collapses the selection the student is deciding about;
 * - each control keeps an explicit accessible name, because the glyphs are for
 *   the eye and the exam must stay usable without one;
 * - every user-visible string and accessible name comes from SAT_COPY.
 */

/** One action's box: 44px of target around a much smaller drawing. */
export const SAT_ANNOTATION_ACTION =
  'sat-touch-target sat-pressable inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]';

/**
 * The U and its line, in the style that is in use.
 *
 * The line is a real border rather than a drawn stroke: `border-dashed` and
 * `border-dotted` are the browser's own dash patterns, so the menu's three
 * options are three genuinely different lines instead of three near-identical
 * ones. `border-current` keeps the whole glyph on the button's ink, so disabled,
 * hover, and forced-colours treatments move it together.
 */
export function SatUnderlineGlyph({
  style,
  className,
}: {
  style: SatUnderlineStyle;
  className?: string | undefined;
}) {
  const line =
    style === 'dashed' ? 'border-dashed'
      : style === 'dotted' ? 'border-dotted'
        : 'border-solid';
  return (
    <span
      aria-hidden="true"
      data-sat-underline-glyph={style}
      className={'grid place-items-center gap-[1px] ' + (className ?? '')}
    >
      <span className="sat-type-control-secondary font-semibold leading-none">U</span>
      <span data-sat-underline-style-line={style} className={'w-4 border-b-2 border-current ' + line} />
    </span>
  );
}

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
    // The gap between inks is the surface's own row rhythm, not a smaller
    // private one: three 44px targets a finger-width apart are unhittable, and
    // on a narrow surface the row is allowed to wrap rather than crowd.
    <div
      className="flex flex-wrap items-center gap-[var(--sat-annotation-row-gap)]"
      role="group"
      aria-label={SAT_COPY.annotations.highlight}
    >
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
            className={SAT_ANNOTATION_ACTION}
          >
            {/* Size is the state: the ink in use is the larger circle, and it is
                the only one carrying the drop. A ring on all three (rather than
                a ring on one) keeps them reading as the same family of marks. */}
            <span
              aria-hidden="true"
              data-sat-swatch={ink.color}
              data-sat-swatch-state={pressed ? 'current' : 'idle'}
              className={
                'grid shrink-0 place-items-center rounded-full border-2 border-[var(--sat-annotation-active-ring)] '
                + (pressed ? 'h-8 w-8' : 'h-6 w-6')
              }
              style={{ backgroundColor: ink.swatch }}
            >
              {pressed ? (
                <Droplet
                  data-sat-swatch-ink="true"
                  className="h-4 w-4"
                  style={{ color: ink.inkGlyph }}
                  aria-hidden="true"
                />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Add a note to the marked words (or open the one they already wrote).
 *
 * The glyph is a note sheet with a plus, and the name says which of the two
 * things pressing it will do — an icon cannot say "edit" as opposed to "add",
 * and the student should not have to press it to find out.
 */
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
      title={label}
      disabled={disabled === true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={SAT_ANNOTATION_ACTION}
    >
      <SquarePlus className="h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  );
}

/**
 * Take the mark off the words.
 *
 * The only destructive control on the surface, so it is the only one that wears
 * the danger ink — and it still lives here rather than behind a disclosure,
 * because removal is one press plus an undo, which is kinder than a press plus
 * a confirmation and faster than both.
 */
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
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      disabled={disabled === true}
      className={
        SAT_ANNOTATION_ACTION
        + ' text-[var(--sat-danger)] hover:bg-[var(--sat-danger-soft)] hover:text-[var(--sat-danger)]'
      }
    >
      <Trash2 className="h-5 w-5 shrink-0" aria-hidden="true" />
    </button>
  );
}
