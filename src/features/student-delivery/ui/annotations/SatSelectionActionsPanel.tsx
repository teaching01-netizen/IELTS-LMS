import type { SatHighlightColor, SatTextAnchor, SatUnderlineStyle } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import {
  SelectionActionMenu,
  type SelectionMenuAction,
  type SelectionMenuChrome,
} from '@shared/ui/selection-v2/react/SelectionActionMenu';
import type { SelectionMenuEnvironment } from '@shared/ui/selection-v2/engine/selectionPlacement';
import {
  SatHighlightSwatchButtons,
  SatNoteControl,
} from './SatAnnotationControls';
import { SatUnderlineStyleControl, type SatUnderlineChoice } from './SatUnderlineStyleControl';
import {
  SAT_ANNOTATION_PILL_ROW,
  SatAnnotationSurfaceBody,
  satAnnotationSurfaceChrome,
} from './SatAnnotationSurfaceFrame';
import { useSatAnnotationAutofocus } from './useSatAnnotationAutofocus';
import { useSatAnnotationPlacement } from './useSatAnnotationPlacement';
import { useSatExamZoom } from '../zoom/SatExamZoomContext';

export interface SatSelectionActions {
  highlight: (anchor: SatTextAnchor, color: SatHighlightColor) => void;
  underline: (anchor: SatTextAnchor, style: SatUnderlineStyle) => void;
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
 *
 * What is SAT's is what the actions MEAN and the controls that say so, and those
 * are the reference's: one row of glyphs on a rounded pill, hanging off the
 * words it acts on. Three inks, an underline whose line shows its style, and a
 * note — no heading, no written labels, and no divider between them, because
 * highlighting, underlining and noting are answers to the same question ("what
 * do I want to do with this text?") and the layout should not rank them.
 *
 * There is no X. The reference has none, and the ways out that a student
 * actually uses are all still here: Escape, a press outside, and a new selection
 * each end the tools without touching the mark or the words; the dismissal is
 * owned by `SatSelectionActionsPanel`'s `onClose`, which those paths call.
 *
 * There is no caret either. The reference's bar is a plain capsule, and the thing
 * a pointer would say — "these tools belong to THAT line" — is already said by
 * where the capsule sits: centred on that line, one gap from it.
 *
 * It is a real toolbar: arrow keys walk the controls, Enter/Space fires the
 * focused one, and Escape belongs to the exam. Acting does not dismiss it:
 * choosing an ink hands the work to the mark that just landed (its edit
 * controls, in the same place), so a student who wants a different colour, an
 * underline style, or a note keeps their tools instead of re-selecting the
 * sentence.
 */
export function SatSelectionActionsPanel({
  anchor,
  currentColor,
  currentUnderlineStyle,
  actions,
  disabled,
  environment,
  onClose,
}: {
  anchor: SatTextAnchor;
  /** Ink the student used last; the default the swatches show as current. */
  currentColor: SatHighlightColor;
  /** Underline style the student used last; the line the U draws. */
  currentUnderlineStyle: SatUnderlineStyle;
  actions: SatSelectionActions;
  disabled?: boolean | undefined;
  /** Coarse-pointer comfort and browser-owned UI are separate placement facts. */
  environment: SelectionMenuEnvironment;
  /**
   * Dismiss the tools without touching the selection or the marks. Called by the
   * press outside the surface; Escape is arbitrated above this component.
   */
  onClose: () => void;
}) {
  const visualScale = useSatExamZoom().scale;
  const { placement, containerRef } = useSatAnnotationPlacement(anchor, { environment, visualScale });
  // The student has already selected text; landing the caret on the first action
  // means the mark is one keystroke away, and it is also what makes the walk
  // below reachable at all.
  useSatAnnotationAutofocus(placement, `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`, containerRef);
  const surface = satAnnotationSurfaceChrome(placement, visualScale);

  const chooseUnderlineStyle = (choice: SatUnderlineChoice) => {
    // Nothing is underlined yet on a fresh selection, so "None" has nothing to
    // take away and is a no-op rather than a mark that never existed.
    if (choice === 'none') return;
    actions.underline(anchor, choice);
  };

  const list: SelectionMenuAction[] = [
    {
      id: 'actions',
      row: 0,
      render: (
        <div className={SAT_ANNOTATION_PILL_ROW}>
          <SatHighlightSwatchButtons
            current={currentColor}
            disabled={disabled === true}
            onSelect={(color) => actions.highlight(anchor, color)}
          />
          <SatUnderlineStyleControl
            current={currentUnderlineStyle}
            disabled={disabled === true}
            onApply={(style) => actions.underline(anchor, style)}
            onChoose={chooseUnderlineStyle}
          />
          {/* The note is the one action that leaves the passage for the Notes
              pane, so it is the one that gets a divider in front of it. The
              hairline carries no margin of its own: the row's own rhythm spaces
              it, so the bar has one system of gaps rather than two. */}
          <span aria-hidden="true" data-sat-annotation-divider="true" className="h-6 w-px shrink-0 bg-[var(--sat-divider)]" />
          <SatNoteControl hasNote={false} disabled={disabled === true} onSelect={() => actions.addNote(anchor)} />
        </div>
      ),
    },
  ];

  const chrome: SelectionMenuChrome = {
    className: surface.className,
    // Includes the position, and the fallbacks that hold before the first
    // measurement lands — the surface must never collapse while it waits.
    style: surface.style,
    // The interaction hooks describe a surface a student can act on, so a hidden
    // one claims none of them: the Highlights shortcut focuses the first control
    // it finds, and it must not find one nobody can see.
    attributes: surface.hidden
      ? {}
      : { 'data-sat-selection-toolbar': 'true', 'data-sat-annotation-surface': 'true' },
    bodyMaxHeight: surface.bodyMaxHeight,
    // The rows scroll in their own layer inside the bound the placement
    // measured, never on the surface: a scroll container on the surface would be
    // forced onto both axes by a single `auto` axis.
    renderBody: (content, maxHeight) => <SatAnnotationSurfaceBody maxHeight={maxHeight}>{content}</SatAnnotationSurfaceBody>,
    rowClassName: () => SAT_ANNOTATION_PILL_ROW,
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
