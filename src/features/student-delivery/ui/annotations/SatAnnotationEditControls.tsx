import type { SatHighlightColor, SatTextAnnotation } from '../../domain/satResponses';
import { satAnnotationUnderlineStyle } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import {
  SatHighlightSwatchButtons,
  SatNoteControl,
  SatRemoveControl,
} from './SatAnnotationControls';
import { SatUnderlineStyleControl, type SatUnderlineChoice } from './SatUnderlineStyleControl';
import {
  SAT_ANNOTATION_PILL_ROW,
  SatAnnotationSurfaceBody,
} from './SatAnnotationSurfaceFrame';
import { useSatAnnotationSurface } from './useSatAnnotationSurface';
import { useSatExamZoom } from '../zoom/SatExamZoomContext';
import type { SelectionMenuEnvironment } from '@shared/ui/selection-v2/engine/selectionPlacement';

/**
 * Edit controls for an annotation that already exists.
 *
 * This is where the feature teaches "I can change this later": the student taps
 * a mark they made and gets the same bar back, now with that mark's own
 * treatment pressed — its ink, or its underline style. Recoloring and restyling
 * are a single tap each, never delete-then-redraw, and removal is the one
 * destructive control on the row — drawn the way its neighbours are, because a
 * permanently red glyph is a warning about a control the student has not chosen;
 * it asks to be pressed with its hover and focus states instead, and is
 * immediately undoable rather than confirmed.
 *
 * It is the same surface as the selection tools, in edit mode: the same
 * placement engine, the same shared chrome, the same one presentation, the same
 * pill, and the same controls. A mark's controls therefore appear where the
 * student left them — and the bar reads as the same object in two states rather
 * than as two different interfaces.
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
  environment,
  disabled,
  onColor,
  onUnderline,
  onNote,
  onRemove,
  onClose,
}: {
  annotation: SatTextAnnotation;
  /** Coarse-pointer comfort and browser-owned UI are separate placement facts. */
  environment: SelectionMenuEnvironment;
  disabled?: boolean | undefined;
  onColor: (color: SatHighlightColor) => void;
  /** A style to underline in, or `'none'` to take the underline off. */
  onUnderline: (choice: SatUnderlineChoice) => void;
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
  const { chrome, containerRef } = useSatAnnotationSurface(annotation.anchor, {
    autoFocusKey: annotation.id,
    environment,
    visualScale,
    onDismiss: onClose,
  });
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;
  // What the underline control shows: this mark's own style when it IS the
  // underline, and "none" when the words are only highlighted — the menu's
  // checked row is then the honest "there is no underline on this yet".
  const underlineChoice: SatUnderlineChoice = isHighlight ? 'none' : satAnnotationUnderlineStyle(annotation);

  return (
    <div
      ref={containerRef}
      // Present for a student who can act on it, and only then — see the
      // selection surface for why a hidden surface claims no interaction hooks.
      data-sat-annotation-edit-controls={chrome.hidden ? undefined : 'true'}
      // The positioning context for disclosed UI (the underline style menu),
      // which must not be rendered inside the scrolling body.
      data-sat-annotation-surface={chrome.hidden ? undefined : 'true'}
      data-sat-annotation-id={annotation.id}
      role="toolbar"
      aria-label={SAT_COPY.annotations.editAnnotation}
      className={chrome.className}
      style={chrome.style}
    >
      <SatAnnotationSurfaceBody maxHeight={chrome.bodyMaxHeight}>
        <div className={SAT_ANNOTATION_PILL_ROW}>
          <SatHighlightSwatchButtons
            value={isHighlight ? annotation.color : null}
            disabled={disabled === true}
            onSelect={onColor}
          />
          <SatUnderlineStyleControl
            current={underlineChoice}
            disabled={disabled === true}
            onApply={(style) => onUnderline(style)}
            onChoose={onUnderline}
          />
          {/* Removal keeps its distance from the inks, and the note follows a
              divider rather than sitting beside it: writing about the words and
              taking the mark off them are different kinds of decision. */}
          <SatRemoveControl disabled={disabled === true} label={removeLabel} onSelect={onRemove} />
          <span aria-hidden="true" data-sat-annotation-divider="true" className="h-6 w-px shrink-0 bg-[var(--sat-divider)]" />
          <SatNoteControl hasNote={hasNote} disabled={disabled === true} onSelect={onNote} />
        </div>
      </SatAnnotationSurfaceBody>
    </div>
  );
}
