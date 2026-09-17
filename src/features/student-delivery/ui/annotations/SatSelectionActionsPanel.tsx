import type { SatHighlightColor, SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import { SatAnnotationHeading, SatCloseControl, SatHighlightSwatchButtons, SatNoteControl, SatUnderlineControl } from './SatAnnotationControls';
import { SatAnnotationCaret, SAT_ANNOTATION_ROW, SAT_ANNOTATION_ROW_DIVIDED } from './SatAnnotationSurfaceFrame';
import { useSatAnnotationSurface } from './useSatAnnotationSurface';

export interface SatSelectionActions {
  highlight: (anchor: SatTextAnchor, color: SatHighlightColor) => void;
  underline: (anchor: SatTextAnchor) => void;
  addNote: (anchor: SatTextAnchor) => void;
}

/**
 * The controls raised by a text selection — one component, two presentations.
 *
 * The PRESENTATION is not a device setting; it is the answer to "is there room
 * for a toolbar beside this selection". `useSatAnnotationPlacement` decides it
 * (see the placement engine for the rules) and this component simply honours
 * the answer, rendered through `satAnnotationSurfaceChrome`: `floating` is a
 * panel with a caret pointing at the exact line it belongs to, `docked` is a
 * full-bleed sheet at the bottom of the visible region that quotes the selection
 * back to the student, and `hidden` is mounted but invisible while the anchor is
 * off screen or the geometry is still settling.
 *
 * `variant` is therefore a REQUEST, not a command: `floating` asks for a
 * toolbar and accepts the dock when the space budget refuses, while `docked`
 * pins the sheet (contract layouts and tests). The shell always asks for
 * `floating` — a coarse pointer only widens the budget, because the native
 * selection menu needs a zone of its own on touch.
 *
 * They are one component because they are one interaction: same actions, same
 * order, same 44px targets, same labels, only the chrome around them differs.
 * Two copies drifted would mean two places to fix every future label. The dock
 * keeps the selection quote, the floating surface keeps the caret; the actions
 * themselves are rendered by the same shared controls, unchanged.
 *
 * Both presentations are overlays: a toolbar that appeared by pushing the page
 * would move the sentence the student just selected.
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
  touch = false,
  onClose,
}: {
  anchor: SatTextAnchor;
  /** Ink the student used last; the default the swatches show as current. */
  currentColor: SatHighlightColor;
  actions: SatSelectionActions;
  disabled?: boolean | undefined;
  /** Requested presentation; `floating` still yields to the space budget. */
  variant: 'floating' | 'docked';
  /** Coarse pointer: reserve the native selection menu's zone and comfort. */
  touch?: boolean | undefined;
  /** Dismiss the tools without touching the selection or the marks. */
  onClose: () => void;
}) {
  // The student has already selected text; landing the caret on the first
  // action means the mark is one keystroke away, and it is also what makes the
  // arrow-key walk below reachable at all.
  const { placement, chrome, containerRef } = useSatAnnotationSurface(anchor, {
    autoFocusKey: `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`,
    dock: variant === 'docked',
    touch,
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
      data-sat-selection-toolbar={chrome.docked || chrome.hidden ? undefined : 'true'}
      data-sat-touch-dock={chrome.docked && !chrome.hidden ? 'true' : undefined}
      role="toolbar"
      aria-label={SAT_COPY.annotations.selectedTextActions}
      aria-orientation={chrome.docked ? undefined : 'horizontal'}
      onKeyDown={onKeyDown}
      className={chrome.className}
      style={chrome.style}
    >
      <SatAnnotationCaret placement={placement} />
      {chrome.docked ? (
        <p
          data-sat-dock-quote="true"
          className="line-clamp-2 max-h-[44px] overflow-hidden sat-type-metadata italic text-[var(--sat-text-secondary)]"
        >
          {anchor.exact}
        </p>
      ) : null}
      <div className={chrome.docked ? SAT_ANNOTATION_ROW + ' flex flex-wrap items-center justify-between gap-x-2 gap-y-1' : ''}>
        {/* Full width on the docked sheet, so the dismissal sits at the far edge
            where a dismissed sheet's control is looked for, not beside the
            heading with the inks trailing after it. */}
        <div className={'flex items-center justify-between gap-2' + (chrome.docked ? ' w-full' : '')}>
          <SatAnnotationHeading />
          <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} />
        </div>
        <div className={chrome.docked ? '' : SAT_ANNOTATION_ROW}>
          <SatHighlightSwatchButtons
            current={currentColor}
            disabled={disabled === true}
            onSelect={(color) => actions.highlight(anchor, color)}
          />
        </div>
      </div>
      <div
        className={
          chrome.docked
            ? SAT_ANNOTATION_ROW + ' flex flex-wrap items-center gap-2'
            : SAT_ANNOTATION_ROW_DIVIDED
        }
      >
        <SatUnderlineControl disabled={disabled === true} onSelect={() => actions.underline(anchor)} />
        <SatNoteControl hasNote={false} disabled={disabled === true} onSelect={() => actions.addNote(anchor)} />
      </div>
    </div>
  );
}
