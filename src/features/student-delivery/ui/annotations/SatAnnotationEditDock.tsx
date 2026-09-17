import { useRef } from 'react';
import type { SatHighlightColor, SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import {
  SatAnnotationHeading,
  SatCloseControl,
  SatHighlightSwatchButtons,
  SatNoteControl,
  SatRemoveControl,
  SatUnderlineControl,
} from './SatAnnotationControls';
import { useSatAnnotationAutofocus, useSatAnnotationPlacement } from './useSatAnnotationPlacement';

/**
 * Edit controls for an annotation that already exists.
 *
 * This is where the feature teaches "I can change this later": the student taps
 * a mark they made and gets the same colors back, now with the current one
 * pressed. Recoloring is a single tap — never delete-then-redraw — and removal
 * lives below a divider so it can never be hit while reaching for a color.
 *
 * There is deliberately no "are you sure?" step: removal is immediately
 * undoable instead, which is both kinder and faster.
 *
 * It is the same surface as the selection tools, in edit mode: the same
 * placement engine, the same caret, the same float-when-there-is-room and
 * dock-when-there-is-not rule. A mark's controls therefore appear where the
 * student left them (and where the taps that made them were), on a mouse and on
 * glass alike — `touch` widens the budget so the native selection menu's zone
 * is respected; it does not decide the presentation.
 *
 * Since this dock is also what a mark's controls become the instant a highlight
 * lands (see useSatAnnotationSurface), it is the whole post-highlight surface:
 * the colors recolor the ink that just landed instead of demanding a click on
 * the text first, and Add note opens the note in the Notes pane — one editor for
 * one note, rather than a second textarea that had to agree with the first about
 * autosave, limits, and removal.
 */
export function SatAnnotationEditDock({
  annotation,
  touch,
  disabled,
  onColor,
  onUnderline,
  onNote,
  onRemove,
  onClose,
}: {
  annotation: SatTextAnnotation;
  /** Coarse pointer: reserve the native selection menu's zone and comfort. */
  touch: boolean;
  disabled?: boolean | undefined;
  onColor: (color: SatHighlightColor) => void;
  onUnderline: () => void;
  /** Open this mark's note in the Notes pane, which is where notes are written. */
  onNote: () => void;
  onRemove: () => void;
  /** Dismiss the dock; the mark and its note stay. */
  onClose: () => void;
}) {
  const { placement, containerRef } = useSatAnnotationPlacement(annotation.anchor, { touch });
  // Opening a mark's editor moves the caret into it: a tap and Enter/Space on
  // the mark must both leave the student able to change the mark without
  // hunting for the controls.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useSatAnnotationAutofocus(placement, annotation.id, rootRef);
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;
  const mode = placement?.mode ?? null;
  const docked = mode === 'docked';
  const hidden = mode === null || mode === 'hidden';
  const floating = mode === 'floating';
  const side = placement?.side ?? 'above';
  const dockInset = placement?.left ?? 8;

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        rootRef.current = node;
      }}
      data-sat-annotation-edit-dock="true"
      data-sat-annotation-id={annotation.id}
      data-sat-placement-mode={mode ?? 'none'}
      data-sat-placement-flipped={floating && placement?.flipped ? 'true' : undefined}
      role="toolbar"
      aria-label={SAT_COPY.annotations.editAnnotation}
      className={
        'sat-ui absolute z-[80] '
        + (docked
          ? 'sat-annotation-surface-docked rounded-t-[10px] border-t border-[var(--sat-divider-strong)] bg-[var(--sat-surface)] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[var(--sat-annotation-dock-shadow)]'
          : 'sat-annotation-surface-floating rounded-[10px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] p-2 shadow-[var(--sat-shadow-floating)]')
        + (floating && placement?.animated ? ' sat-annotation-settle' : '')
      }
      style={{
        left: placement ? placement.left : 8,
        right: docked ? dockInset : undefined,
        top: placement ? placement.top : 8,
        width: docked ? undefined : 'min(var(--sat-annotation-surface-max), calc(100% - var(--sat-annotation-edge) * 2))',
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      {floating && placement ? (
        <span
          aria-hidden="true"
          data-sat-annotation-caret={side === 'above' ? 'down' : 'up'}
          className="sat-annotation-caret"
          style={{ left: placement.arrowX }}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <SatAnnotationHeading />
        <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
      </div>
      <div className="mt-1.5">
        <SatHighlightSwatchButtons
          value={isHighlight ? annotation.color : null}
          disabled={disabled === true}
          onSelect={onColor}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-[var(--sat-divider)] pt-1.5">
        <SatUnderlineControl pressed={!isHighlight} disabled={disabled === true} onSelect={onUnderline} />
        <SatNoteControl hasNote={hasNote} disabled={disabled === true} onSelect={onNote} />
      </div>
      <div className="mt-1.5 border-t border-[var(--sat-divider)] pt-1.5">
        <SatRemoveControl disabled={disabled === true} label={removeLabel} onSelect={onRemove} />
      </div>
    </div>
  );
}
