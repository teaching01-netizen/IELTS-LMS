import type { SatHighlightColor, SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SatAnnotationHeading, SatCloseControl, SatHighlightSwatchButtons, SatNoteControl, SatUnderlineControl } from './SatAnnotationControls';
import { SatAnnotationCaret, SatAnnotationSurfaceBody, SAT_ANNOTATION_ROW, SAT_ANNOTATION_ROW_DIVIDED } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationSurface } from './useSatAnnotationSurface';

export interface SatSelectionActions {
  highlight: (anchor: SatTextAnchor, color: SatHighlightColor) => void;
  underline: (anchor: SatTextAnchor) => void;
  addNote: (anchor: SatTextAnchor) => void;
}

/**
 * The controls raised by a text selection: one toolbar, in one place, with a
 * caret pointing at the line it belongs to.
 *
 * "Where it goes" is not this component's decision. `useSatAnnotationPlacement`
 * answers it from measured geometry (see the placement engine for the rules) and
 * this component simply renders the answer through `satAnnotationSurfaceChrome`.
 * There is ONE presentation: the toolbar. A docked sheet at the bottom of the
 * screen used to be the second one, and it is gone — a surface that changed
 * shape under the student because the room ran out was a second thing to learn
 * for no gain. When there is not enough room beside the text, the same toolbar
 * is pinned inside what the student can see: the caret is dropped rather than
 * pointing at a line the panel is nowhere near, and the rows scroll inside their
 * own bound so nothing hides under a software keyboard.
 *
 * It is a real toolbar: arrow keys walk the actions, Enter/Space fires the
 * focused one, and Escape belongs to the exam (clearing the selection closes
 * this, which is the behaviour a system selection menu has already taught). A
 * press anywhere outside it closes it too, without touching the browser's own
 * selection or the marks (see `useSatAnnotationDismiss`).
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
  touch = false,
  onClose,
}: {
  anchor: SatTextAnchor;
  /** Ink the student used last; the default the swatches show as current. */
  currentColor: SatHighlightColor;
  actions: SatSelectionActions;
  disabled?: boolean | undefined;
  /** Coarse pointer: reserve the native selection menu's lane and widen the budget. */
  touch?: boolean | undefined;
  /** Dismiss the tools without touching the selection or the marks. */
  onClose: () => void;
}) {
  // The student has already selected text; landing the caret on the first
  // action means the mark is one keystroke away, and it is also what makes the
  // arrow-key walk below reachable at all.
  const { placement, chrome, containerRef } = useSatAnnotationSurface(anchor, {
    autoFocusKey: `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`,
    touch,
    onDismiss: onClose,
  });
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...(containerRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={containerRef}
      // The interaction hooks describe a surface a student can act on, so a
      // hidden one claims none of them: the Highlights shortcut focuses the
      // first control it finds, and it must not find one nobody can see.
      data-sat-selection-toolbar={chrome.hidden ? undefined : 'true'}
      role="toolbar"
      aria-label={SAT_COPY.annotations.selectedTextActions}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={chrome.className}
      style={chrome.style}
    >
      <SatAnnotationCaret placement={placement} />
      <SatAnnotationSurfaceBody maxHeight={chrome.bodyMaxHeight}>
        <SatAnnotationHeading />
        <div className={SAT_ANNOTATION_ROW}>
          <SatHighlightSwatchButtons
            current={currentColor}
            disabled={disabled === true}
            onSelect={(color) => actions.highlight(anchor, color)}
          />
        </div>
        {/* The dismissal is the last thing in the last row, against the bottom
            right corner: that is where a panel's way out is looked for, and it
            leaves the ink row above — the action the student came for — without
            a control they press only on the way out. The actions keep their own
            group on the left so the row reads as "what you can do" then "leave",
            on one line at any width. */}
        <div className={SAT_ANNOTATION_ROW_DIVIDED + ' justify-between'}>
          <div className="flex flex-wrap items-center gap-2">
            <SatUnderlineControl disabled={disabled === true} onSelect={() => actions.underline(anchor)} />
            <SatNoteControl hasNote={false} disabled={disabled === true} onSelect={() => actions.addNote(anchor)} />
          </div>
          <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
        </div>
      </SatAnnotationSurfaceBody>
    </div>
  );
}
