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
import { SatAnnotationCaret, SAT_ANNOTATION_ROW, SAT_ANNOTATION_ROW_DIVIDED } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationSurface } from './useSatAnnotationSurface';

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
 * placement engine, the same shared chrome, the same float-when-there-is-room
 * and dock-when-there-is-not rule. A mark's controls therefore appear where the
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
  // Opening a mark's editor moves the caret into it: a tap and Enter/Space on
  // the mark must both leave the student able to change the mark without
  // hunting for the controls.
  const { placement, chrome, containerRef } = useSatAnnotationSurface(annotation.anchor, {
    autoFocusKey: annotation.id,
    touch,
  });
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;

  return (
    <div
      ref={containerRef}
      // Present for a student who can act on it, and only then — see the
      // selection surface for why a hidden surface claims no interaction hooks.
      data-sat-annotation-edit-dock={chrome.hidden ? undefined : 'true'}
      data-sat-annotation-id={annotation.id}
      role="toolbar"
      aria-label={SAT_COPY.annotations.editAnnotation}
      className={chrome.className}
      style={chrome.style}
    >
      <SatAnnotationCaret placement={placement} />
      <div className="flex items-center justify-between gap-2">
        <SatAnnotationHeading />
        <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
      </div>
      <div className={SAT_ANNOTATION_ROW}>
        <SatHighlightSwatchButtons
          value={isHighlight ? annotation.color : null}
          disabled={disabled === true}
          onSelect={onColor}
        />
      </div>
      <div className={SAT_ANNOTATION_ROW_DIVIDED}>
        <SatUnderlineControl pressed={!isHighlight} disabled={disabled === true} onSelect={onUnderline} />
        <SatNoteControl hasNote={hasNote} disabled={disabled === true} onSelect={onNote} />
      </div>
      <div className={SAT_ANNOTATION_ROW + ' border-t border-[var(--sat-divider)] pt-[var(--sat-annotation-row-gap)]'}>
        <SatRemoveControl disabled={disabled === true} label={removeLabel} onSelect={onRemove} />
      </div>
    </div>
  );
}
