import { useMemo, type ReactNode } from 'react';
import { satNotesColumnOpen, satNotesPlacement, type SatNotesPlacement, type SatNotesUiState } from '../../domain/satNotesUi';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SatNotesColumn } from './SatNotesColumn';
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
  disabled: boolean;
  hintVisible: boolean;
  onSelectNote: (annotationId: string) => void;
  onChangeNote: (note: string) => void;
  onSaveQuestionNote: (note: string) => void;
  onWriteAboutQuestion: () => void;
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
 */
export function SatNotesSurfaceHost(props: SatNotesSurfaceHostProps) {
  const compact = useSatMediaQuery('(max-width: 767px)');
  const threeColumn = useSatMediaQuery('(min-width: 1024px)');
  const open = satNotesColumnOpen(props.state);
  const placement: SatNotesPlacement = satNotesPlacement({ open, compact, threeColumn });

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
            disabled={props.disabled}
            onSelectNote={props.onSelectNote}
            onChangeNote={props.onChangeNote}
            onSaveQuestionNote={props.onSaveQuestionNote}
            onWriteAboutQuestion={props.onWriteAboutQuestion}
            onFlush={props.onFlush}
            onClose={props.onClose}
          />
        ),
      passageHint: props.hintVisible ? <SatAnnotationPassageHint /> : null,
    }),
    [placement, props.annotations, props.disabled, props.hintVisible, props.onChangeNote, props.onClose, props.onFlush, props.onSaveQuestionNote, props.onSelectNote, props.onWriteAboutQuestion, props.questionKey, props.questionNote, props.state],
  );

  return <SatNotesSurfaceContext.Provider value={surface}>{props.children}</SatNotesSurfaceContext.Provider>;
}
