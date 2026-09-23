import type { SatHighlightColor, SatTextAnchor } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import {
  SelectionActionMenu,
  type SelectionMenuAction,
  type SelectionMenuChrome,
} from '@shared/ui/selection-v2/react/SelectionActionMenu';
import type { SelectionMenuEnvironment } from '@shared/ui/selection-v2/engine/selectionPlacement';
import {
  SatAnnotationHeading,
  SatCloseControl,
  SatHighlightSwatchButtons,
  SatNoteControl,
  SatUnderlineControl,
} from './SatAnnotationControls';
import {
  SatAnnotationCaret,
  SatAnnotationSurfaceBody,
  SAT_ANNOTATION_ROW,
  SAT_ANNOTATION_ROW_DIVIDED,
  satAnnotationSurfaceChrome,
} from './SatAnnotationSurfaceFrame';
import { useSatAnnotationAutofocus } from './useSatAnnotationAutofocus';
import { useSatAnnotationPlacement } from './useSatAnnotationPlacement';
import { useSatExamZoom } from '../zoom/SatExamZoomContext';

export interface SatSelectionActions {
  highlight: (anchor: SatTextAnchor, color: SatHighlightColor) => void;
  underline: (anchor: SatTextAnchor) => void;
  addNote: (anchor: SatTextAnchor) => void;
}

/**
 * SAT's selection toolbar: the exam's actions on the shared menu.
 *
 * The interaction grammar is not SAT's — `SelectionActionMenu` owns the toolbar
 * role, the keyboard walk and the outside press that dismisses it. The position
 * comes from the ONE placement rule (`placeSelectionMenu`) evaluated against
 * SAT's budgets and measured on SAT's own schedule, settling included (see
 * `useSatAnnotationPlacement`), and it reaches the DOM through SAT's own chrome
 * (`satAnnotationSurfaceChrome`) — the same mapping the mark's edit dock uses, so
 * the toolbar and the dock can never disagree about where a placement puts them.
 * Two placement engines used to exist, and which one a student met depended on
 * which component had rendered the toolbar.
 *
 * What is SAT's is what the actions MEAN and the controls that say so: labelled
 * colour swatches with a 44px target, an underline, a note, a written way out,
 * the material, the caret pointing at the anchored line, and the body the rows
 * scroll inside. The shell mounts this, and this mounts the menu; there is no
 * third place a toolbar could come from.
 *
 * It is a real toolbar: arrow keys walk the controls, Enter/Space fires the
 * focused one, and Escape belongs to the exam. Acting does not dismiss it:
 * choosing an ink hands the work to the mark that just landed (its edit
 * controls, in the same place), so a student who wants a different colour, an
 * underline, or a note keeps their tools instead of re-selecting the sentence.
 */
export function SatSelectionActionsPanel({
  anchor,
  currentColor,
  actions,
  disabled,
  environment,
  onClose,
}: {
  anchor: SatTextAnchor;
  /** Ink the student used last; the default the swatches show as current. */
  currentColor: SatHighlightColor;
  actions: SatSelectionActions;
  disabled?: boolean | undefined;
  /** Coarse-pointer comfort and browser-owned UI are separate placement facts. */
  environment: SelectionMenuEnvironment;
  /** Dismiss the tools without touching the selection or the marks. */
  onClose: () => void;
}) {
  const visualScale = useSatExamZoom().scale;
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, { environment, visualScale });
  // The student has already selected text; landing the caret on the first action
  // means the mark is one keystroke away, and it is also what makes the walk
  // below reachable at all.
  useSatAnnotationAutofocus(placement, `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`, containerRef);
  const surface = satAnnotationSurfaceChrome(placement, visualScale);

  const list: SelectionMenuAction[] = [
    {
      id: 'highlight',
      row: 0,
      render: (
        <SatHighlightSwatchButtons
          current={currentColor}
          disabled={disabled === true}
          onSelect={(color) => actions.highlight(anchor, color)}
        />
      ),
    },
    {
      id: 'tools',
      // One control holding the two secondary actions: they share a row with the
      // way out, which sits at that row's far end.
      row: 1,
      render: (
        <div className="flex flex-wrap items-center gap-2">
          <SatUnderlineControl disabled={disabled === true} onSelect={() => actions.underline(anchor)} />
          <SatNoteControl hasNote={false} disabled={disabled === true} onSelect={() => actions.addNote(anchor)} />
        </div>
      ),
    },
    { id: 'close', row: 1, render: <SatCloseControl onSelect={onClose} disabled={disabled} label={SAT_COPY.annotations.closeTools} /> },
  ];

  const chrome: SelectionMenuChrome = {
    className: surface.className,
    // Includes the position, and the fallbacks that hold before the first
    // measurement lands — the surface must never collapse while it waits.
    style: surface.style,
    // The interaction hooks describe a surface a student can act on, so a hidden
    // one claims none of them: the Highlights shortcut focuses the first control
    // it finds, and it must not find one nobody can see.
    attributes: surface.hidden ? {} : { 'data-sat-selection-toolbar': 'true' },
    caret: <SatAnnotationCaret placement={placement} visualScale={visualScale} />,
    heading: <SatAnnotationHeading />,
    bodyMaxHeight: surface.bodyMaxHeight,
    // The caret is drawn outside the border box, so the rows scroll in their own
    // layer inside the bound the placement measured — never on the surface.
    renderBody: (content, maxHeight) => <SatAnnotationSurfaceBody maxHeight={maxHeight}>{content}</SatAnnotationSurfaceBody>,
    rowClassName: (row) => (row === 0 ? SAT_ANNOTATION_ROW : SAT_ANNOTATION_ROW_DIVIDED + ' justify-between'),
  };

  return (
    <SelectionActionMenu
      actions={list}
      label={SAT_COPY.annotations.selectedTextActions}
      containerRef={containerRef}
      onDismiss={onClose}
      chrome={chrome}
    />
  );
}
