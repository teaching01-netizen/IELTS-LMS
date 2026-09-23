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
import { SatAnnotationCaret, SatAnnotationSurfaceBody, SAT_ANNOTATION_ROW, SAT_ANNOTATION_ROW_DIVIDED } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationSurface } from './useSatAnnotationSurface';
import { useSatExamZoom } from '../zoom/SatExamZoomContext';

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
 * placement engine, the same shared chrome, the same one presentation and the
 * same clamp-when-there-is-no-room rule. A mark's controls therefore appear
 * where the student left them (and where the taps that made them were), on a
 * mouse and on glass alike — `touch` reserves the native selection menu's lane
 * and widens the budget; it does not decide anything about how this looks.
 *
 * Since these controls are also what a mark becomes the instant a highlight
 * lands (see useSatAnnotationSurface), this is the whole post-highlight surface:
 * the colors recolor the ink that just landed instead of demanding a click on
 * the text first, and Add note opens the note in the Notes pane — one editor for
 * one note, rather than a second textarea that had to agree with the first about
 * autosave, limits, and removal.
 */
export function SatAnnotationEditControls({
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
  /** Coarse pointer: reserve the native selection menu's lane and widen the budget. */
  touch: boolean;
  disabled?: boolean | undefined;
  onColor: (color: SatHighlightColor) => void;
  onUnderline: () => void;
  /** Open this mark's note in the Notes pane, which is where notes are written. */
  onNote: () => void;
  onRemove: () => void;
  /** Dismiss the controls; the mark and its note stay. */
  onClose: () => void;
}) {
  const visualScale = useSatExamZoom().scale;
  // Opening a mark's editor moves the caret into it: a tap and Enter/Space on
  // the mark must both leave the student able to change the mark without
  // hunting for the controls.
  const { placement, chrome, containerRef } = useSatAnnotationSurface(annotation.anchor, {
    autoFocusKey: annotation.id,
    touch,
    visualScale,
    onDismiss: onClose,
  });
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;

  return (
    <div
      ref={containerRef}
      // Present for a student who can act on it, and only then — see the
      // selection surface for why a hidden surface claims no interaction hooks.
      data-sat-annotation-edit-controls={chrome.hidden ? undefined : 'true'}
      data-sat-annotation-id={annotation.id}
      role="toolbar"
      aria-label={SAT_COPY.annotations.editAnnotation}
      className={chrome.className}
      style={chrome.style}
    >
      <SatAnnotationCaret placement={placement} visualScale={visualScale} />
      <SatAnnotationSurfaceBody maxHeight={chrome.bodyMaxHeight}>
        <SatAnnotationHeading />
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
        {/* Removal keeps its own row below the divider, so it can never be hit
            while reaching for an ink. The dismissal shares that row at its far
            end: one press leaves, and it is a row away from every action that
            changes the mark, which is the whole reason the destructive control
            was separated in the first place. */}
        <div className={SAT_ANNOTATION_ROW_DIVIDED + ' justify-between'}>
          <SatRemoveControl disabled={disabled === true} label={removeLabel} onSelect={onRemove} />
          <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
        </div>
      </SatAnnotationSurfaceBody>
    </div>
  );
}
