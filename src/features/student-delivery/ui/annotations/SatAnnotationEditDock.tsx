import { useRef } from 'react';
import type { SatHighlightColor, SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SatAnnotationHeading, SatHighlightSwatchButtons, SatNoteControl, SatRemoveControl, SatUnderlineControl } from './SatAnnotationControls';
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
 */
export function SatAnnotationEditDock({
  annotation,
  touch,
  disabled,
  onColor,
  onUnderline,
  onNote,
  onRemove,
}: {
  annotation: SatTextAnnotation;
  /** Touch layout pins the dock to the bottom; desktop floats it at the mark. */
  touch: boolean;
  disabled?: boolean | undefined;
  onColor: (color: SatHighlightColor) => void;
  onUnderline: () => void;
  onNote: () => void;
  onRemove: () => void;
}) {
  const { placement, containerRef } = useSatAnnotationPlacement(annotation.anchor, { dock: touch });
  // Opening a mark's editor moves the caret into it: a tap and Enter/Space on
  // the mark must both leave the student able to change the mark without
  // hunting for the controls.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useSatAnnotationAutofocus(placement, annotation.id, rootRef);
  const isHighlight = annotation.kind === 'highlight';
  const hasNote = typeof annotation.note === 'string' && annotation.note.length > 0;
  const removeLabel = isHighlight ? SAT_COPY.annotations.removeHighlight : SAT_COPY.annotations.removeUnderline;

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
      <SatAnnotationHeading />
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
