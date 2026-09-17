import { useMemo, type ReactNode } from 'react';
import {
  satNotesColumnOpen,
  satNotesPlacement,
  satNotesRailVisible,
  type SatNotesPlacement,
  type SatNotesUiState,
} from '../../domain/satNotesUi';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SatNotesColumn } from './SatNotesColumn';
import { SatNotesRail } from './SatNotesRail';
import { SatNotesSurfaceContext, type SatNotesSurface } from './SatNotesSurfaceContext';
import { useSatMediaQuery } from '../useSatMediaQuery';
import { SatAnnotationPassageHint } from '../education/SatAnnotationEducationCues';

export interface SatNotesSurfaceHostProps {
  /** The one notes state, owned by the annotation surface hook. */
  state: SatNotesUiState;
  /**
   * Identity of the current question. The column is keyed by it: a pending draft
   * commits through the question's own writer on unmount, and the next question
   * starts with an empty field instead of inheriting the last one's text.
   */
  questionKey: string;
  annotations: readonly SatTextAnnotation[];
  questionNote: string;
  /** True when the question carries marks, so an empty column can say so. */
  hasHighlights: boolean;
  /** R&W-only: without the surface there is no pane and no handle for it. */
  notesAvailable: boolean;
  disabled: boolean;
  hintVisible: boolean;
  onSelectNote: (annotationId: string) => void;
  onChangeNote: (note: string) => void;
  onSaveQuestionNote: (note: string) => void;
  /** Staged removal for a note's text, undo included, owned by the surface hook. */
  onRemoveNote: (annotationId: string) => void;
  onWriteAboutQuestion: () => void;
  /** Opens the column from the handle a previous hide left behind. */
  onOpenNotes: () => void;
  onFlush?: (() => void) | undefined;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Everything about notes chrome, in one place that is not the shell.
 *
 * The shell wires exam props; this component decides what the column is and
 * where it belongs, then hands both to the layout that has room for it. Both the
 * panel and the layout read the same placement value, so "where the column goes"
 * is computed once, by one rule (`satNotesPlacement`), instead of being derived
 * separately by the component that renders it and the component that places it.
 * The handle a hidden column leaves behind is decided here for the same reason:
 * "should the pane's ability to open be visible right now" is one question, and
 * it has one answer (`satNotesRailVisible`).
 */
export function SatNotesSurfaceHost(props: SatNotesSurfaceHostProps) {
  const compact = useSatMediaQuery('(max-width: 767px)');
  const threeColumn = useSatMediaQuery('(min-width: 1024px)');
  const open = satNotesColumnOpen(props.state);
  const placement: SatNotesPlacement = satNotesPlacement({ open, compact, threeColumn });
  const railVisible = satNotesRailVisible({ open, compact, available: props.notesAvailable });

  const surface = useMemo<SatNotesSurface>(
    () => ({
      open: placement !== 'none',
      placement,
      column:
        placement === 'none' || props.state.kind !== 'notes' ? null : (
          <SatNotesColumn
            key={props.questionKey}
            state={props.state}
            placement={placement}
            annotations={props.annotations}
            questionNote={props.questionNote}
            hasHighlights={props.hasHighlights}
            disabled={props.disabled}
            onSelectNote={props.onSelectNote}
            onChangeNote={props.onChangeNote}
            onSaveQuestionNote={props.onSaveQuestionNote}
            onRemoveNote={props.onRemoveNote}
            onWriteAboutQuestion={props.onWriteAboutQuestion}
            onFlush={props.onFlush}
            onClose={props.onClose}
          />
        ),
      // The hidden column's handle, in the column's own place: hiding a pane is
      // only honest if what takes its place says it can come back.
      rail: railVisible ? <SatNotesRail onOpen={props.onOpenNotes} /> : null,
      passageHint: props.hintVisible ? <SatAnnotationPassageHint /> : null,
    }),
    [placement, props.annotations, props.disabled, props.hasHighlights, props.hintVisible, props.onChangeNote, props.onClose, props.onFlush, props.onOpenNotes, props.onRemoveNote, props.onSaveQuestionNote, props.onSelectNote, props.onWriteAboutQuestion, props.questionKey, props.questionNote, props.state, railVisible],
  );

  return <SatNotesSurfaceContext.Provider value={surface}>{props.children}</SatNotesSurfaceContext.Provider>;
}
