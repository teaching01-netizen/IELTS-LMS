import { useRef } from 'react';
import type { SatHighlightColor, SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SatAnnotationHeading, SatCloseControl, SatHighlightSwatchButtons, SatNoteControl, SatUnderlineControl } from './SatAnnotationControls';
import { useSatAnnotationAutofocus, useSatAnnotationPlacement } from './useSatAnnotationPlacement';

export interface SatSelectionActions {
  highlight: (anchor: SatTextAnchor, color: SatHighlightColor) => void;
  underline: (anchor: SatTextAnchor) => void;
  addNote: (anchor: SatTextAnchor) => void;
}

/**
 * The controls raised by a text selection — one component, two placements.
 *
 * `floating` (desktop) is a panel positioned against the selected span.
 * `docked` (touch) pins full-bleed to the bottom of the exam body and quotes
 * the selection back to the student, because Safari keeps owning selection and
 * the dock is what answers "these are my tools for THAT text".
 *
 * They are one component because they are one interaction: same actions, same
 * order, same 44px targets, same labels, only the chrome around them differs.
 * Two copies drifted would mean two places to fix every future label.
 *
 * Both variants are overlays: a toolbar that appeared by pushing the page would
 * move the sentence the student just selected.
 *
 * It is a real toolbar: arrow keys walk the actions, Enter/Space fires the
 * focused one, and Escape belongs to the exam (clearing the selection closes
 * this, which is the behaviour a system selection menu has already taught).
 *
 * Acting does not dismiss it: choosing an ink hands the work to the mark that
 * just landed (its edit controls, in the same place), so a student who wants a
 * different colour, an underline, or a note keeps their tools instead of
 * re-selecting the sentence to get them back.
 */
export function SatSelectionActionsPanel({
  anchor,
  currentColor,
  actions,
  disabled,
  variant,
  onClose,
}: {
  anchor: SatTextAnchor;
  /** Ink the student used last; the default the swatches show as current. */
  currentColor: SatHighlightColor;
  actions: SatSelectionActions;
  disabled?: boolean | undefined;
  variant: 'floating' | 'docked';
  /** Dismiss the tools without touching the selection or the marks. */
  onClose: () => void;
}) {
  const docked = variant === 'docked';
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, { dock: docked });
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The student has already selected text; landing the caret on the first
  // action means the mark is one keystroke away, and it is also what makes the
  // arrow-key walk below reachable at all.
  useSatAnnotationAutofocus(placement, `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`, rootRef);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        rootRef.current = node;
      }}
      data-sat-selection-toolbar={docked ? undefined : 'true'}
      data-sat-touch-dock={docked ? 'true' : undefined}
      data-sat-placement-flipped={!docked && placement?.flipped ? 'true' : undefined}
      role="toolbar"
      aria-label={SAT_COPY.annotations.selectedTextActions}
      aria-orientation={docked ? undefined : 'horizontal'}
      onKeyDown={onKeyDown}
      className={
        docked
          ? 'sat-ui absolute z-[80] rounded-t-[10px] border-t border-[var(--sat-divider-strong)] bg-[var(--sat-surface)] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[var(--sat-annotation-dock-shadow)]'
          : 'sat-ui absolute z-[80] w-[min(320px,calc(100%-16px))] rounded-[8px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] p-2 shadow-[var(--sat-shadow-floating)]'
      }
      style={{
        left: placement ? placement.left : 8,
        // A docked sheet is full-bleed: it always spans the body it is docked to.
        right: docked ? 8 : undefined,
        top: placement ? placement.top : docked ? undefined : 8,
        // One quiet entrance: a system control becoming available, never a
        // panel sliding in from off-screen.
        animation: 'sat-annotation-enter var(--sat-motion-annotation) ease-out',
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      {docked ? (
        <p
          data-sat-dock-quote="true"
          className="line-clamp-2 max-h-[44px] overflow-hidden sat-type-metadata italic text-[var(--sat-text-secondary)]"
        >
          {anchor.exact}
        </p>
      ) : null}
      <div className={docked ? 'mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1' : ''}>
        {/* Full width on the docked sheet, so the dismissal sits at the far edge
            where a dismissed sheet's control is looked for, not beside the
            heading with the inks trailing after it. */}
        <div className={'flex items-center justify-between gap-2' + (docked ? ' w-full' : '')}>
          <SatAnnotationHeading />
          <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
        </div>
        <div className={docked ? '' : 'mt-1.5'}>
          <SatHighlightSwatchButtons
            current={currentColor}
            disabled={disabled === true}
            onSelect={(color) => actions.highlight(anchor, color)}
          />
        </div>
      </div>
      <div
        className={
          docked
            ? 'mt-1 flex flex-wrap items-center gap-1'
            : 'mt-1.5 flex flex-wrap items-center gap-1 border-t border-[var(--sat-divider)] pt-1.5'
        }
      >
        <SatUnderlineControl disabled={disabled === true} onSelect={() => actions.underline(anchor)} />
        <SatNoteControl hasNote={false} disabled={disabled === true} onSelect={() => actions.addNote(anchor)} />
      </div>
    </div>
  );
}
