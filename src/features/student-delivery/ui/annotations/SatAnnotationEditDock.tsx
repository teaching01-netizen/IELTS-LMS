import { useEffect, useRef } from 'react';
import type { SatHighlightColor, SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY, satQuotedSource } from '../../domain/satCopy';
import {
  SatAnnotationHeading,
  SatCloseControl,
  SatHighlightSwatchButtons,
  SatNoteControl,
  SatRemoveControl,
  SatUnderlineControl,
} from './SatAnnotationControls';
import { SAT_INLINE_NOTE_FIELD_ID, SatNoteField } from './SatNoteField';
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
 * Since this dock is also what a mark's controls become the instant a highlight
 * lands (see useSatAnnotationSurface), it is the whole post-highlight surface:
 * the colors recolor the ink that just landed instead of demanding a click on
 * the text first, and Add note writes the note *here*, under the quote it is
 * about — the Notes column is a place the student opens, never one that opens
 * itself in the middle of the exam.
 */
export function SatAnnotationEditDock({
  annotation,
  touch,
  disabled,
  noteOpen,
  onColor,
  onUnderline,
  onNote,
  onNoteChange,
  onRemoveNote,
  onRemove,
  onClose,
}: {
  annotation: SatTextAnnotation;
  /** Touch layout pins the dock to the bottom; desktop floats it at the mark. */
  touch: boolean;
  disabled?: boolean | undefined;
  /** True while this mark's note is being written in the dock. */
  noteOpen: boolean;
  onColor: (color: SatHighlightColor) => void;
  onUnderline: () => void;
  /** Open this mark's note field in the dock (never in the Notes column). */
  onNote: () => void;
  onNoteChange: (note: string) => void;
  /** Staged, undoable removal of the note's words (the ink stays). */
  onRemoveNote: () => void;
  onRemove: () => void;
  /** Dismiss the dock; the mark and its note stay. */
  onClose: () => void;
}) {
  const { placement, containerRef } = useSatAnnotationPlacement(annotation.anchor, { dock: touch });
  // Opening a mark's editor moves the caret into it: a tap and Enter/Space on
  // the mark must both leave the student able to change the mark without
  // hunting for the controls.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // While a note is being written the field owns the caret, so the first
  // control declines it instead of pulling it back on the next placement commit.
  useSatAnnotationAutofocus(placement, annotation.id, rootRef, { skip: noteOpen });
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;

  // Writing is the one case where the caret belongs in the field rather than on
  // the first control: pressing "Add note" IS the invitation to type, so the
  // caret is already in the field by the time the student could wonder.
  useEffect(() => {
    if (!noteOpen) return;
    document.getElementById(SAT_INLINE_NOTE_FIELD_ID)?.focus();
  }, [noteOpen]);

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        rootRef.current = node;
      }}
      data-sat-annotation-edit-dock="true"
      data-sat-annotation-id={annotation.id}
      role="toolbar"
      aria-label={SAT_COPY.annotations.editAnnotation}
      className={
        'sat-ui absolute z-[80] rounded-[8px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] p-2 shadow-[var(--sat-shadow-floating)]'
        + (touch ? ' rounded-b-none border-b-0' : ' w-[min(320px,calc(100%-16px))]')
      }
      style={{
        left: placement ? placement.left : 8,
        right: touch ? 8 : undefined,
        top: placement ? placement.top : 8,
        paddingBottom: touch ? 'max(10px, env(safe-area-inset-bottom))' : undefined,
        animation: 'sat-annotation-enter var(--sat-motion-annotation) ease-out',
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
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
      {/* The note, under the words it is about. Same field the Notes column uses,
          so an anchored note cannot save, warn, or empty differently depending
          on which one the student reached for. */}
      {noteOpen ? (
        <div data-sat-inline-note="true" className="mt-1.5 border-t border-[var(--sat-divider)] pt-1.5">
          <p className="sat-type-metadata italic text-[var(--sat-text-secondary)]">
            {satQuotedSource(annotation.anchor.exact)}
          </p>
          <SatNoteField
            fieldId={SAT_INLINE_NOTE_FIELD_ID}
            label={SAT_COPY.notes.title}
            value={annotation.note ?? ''}
            ownerKey={annotation.id}
            disabled={disabled === true}
            commit={onNoteChange}
            canRemove={hasNote}
            onRemoveRequested={onRemoveNote}
            className="mt-1"
          />
        </div>
      ) : null}
      <div className="mt-1.5 border-t border-[var(--sat-divider)] pt-1.5">
        <SatRemoveControl disabled={disabled === true} label={removeLabel} onSelect={onRemove} />
      </div>
    </div>
  );
}
