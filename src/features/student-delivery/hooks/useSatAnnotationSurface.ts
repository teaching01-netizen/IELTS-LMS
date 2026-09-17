import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SAT_ANNOTATION_CONFIRMATION_MS,
  SAT_ANNOTATION_HINT_DELAY_MS,
  SAT_ANNOTATION_HINT_DURATION_MS,
  SAT_ANNOTATION_UNDO_MS,
  shouldShowSatAnnotationHint,
} from '../domain/satAnnotationEducation';
import { SAT_COPY, satHighlightedAnnouncement } from '../domain/satCopy';
import {
  applySatHighlightRange,
  applySatUnderlineRange,
  attachSatNoteToAnchor,
  hasSatAnnotations,
  reinsertSatAnnotation,
  removeSatAnnotationById,
  satAnnotatedNotes,
  setSatAnnotationColor,
  SAT_ANNOTATION_NOTE_LIMIT,
  type SatHighlightColor,
  type SatQuestionAnnotations,
  type SatTextAnchor,
  type SatTextAnnotation,
} from '../domain/satResponses';
import { satNotesUiFromSurface, SAT_QUESTION_NOTE_EDITOR, type SatNotesUiState } from '../domain/satNotesUi';
import type { SatInteractionController } from './useSatInteractionController';
import { useSatAnnotationEducation } from './useSatAnnotationEducation';
import { satHighlightInk } from '../ui/annotations/satAnnotationPalette';
import {
  focusSatAnnotationMark,
  focusSatQuestionNoteRow,
  scrollSatAnnotationIntoView,
} from '../ui/annotations/satAnnotationDom';
import type { SatSelectionActions } from '../ui/annotations/SatSelectionActionsPanel';
import type { SatAnnotationView } from '../ui/annotations/SatAnnotationViewContext';

export interface SatAnnotationSurfaceOptions {
  annotations?: SatQuestionAnnotations | undefined;
  onAnnotationsChange?: ((annotations: SatQuestionAnnotations) => void) | undefined;
  onFlushAnnotations?: (() => void) | undefined;
  blocked: boolean;
  /** R&W-only: the whole surface is absent in Math, not disabled. */
  annotationsAvailable: boolean;
  /** Attempt-scoped (or preview-scoped) teaching memory key. */
  educationKey?: string | null | undefined;
  /** True once this question has an answer (retires the passive hint). */
  answered: boolean;
  interaction: SatInteractionController;
  /** Chrome belongs to one question; changing it discards the chrome. */
  questionKey: string;
  /** Id of the control that opens the column, for focus return. */
  notesTriggerId: string;
}

/**
 * The Highlights & Notes surface: one owner for annotation state, mutation, and
 * chrome.
 *
 * It exists because the shell is a layout component. Rendering a contextual
 * toolbar, a dock, an edit dock, and a note card does not mean the shell should
 * also own nine mutation callbacks, five pieces of chrome state, the undo
 * entry, the announcements, and the teaching cues — that made a 450-line shell
 * into a 780-line one, and put "what annotation chrome is showing" in two
 * places (the interaction machine's surface/selection and the shell's own
 * `editingMarkId`).
 *
 * Everything flows one way: the content reports a gesture, the interaction
 * machine decides whether a selection or a note surface is live, this hook
 * turns that into marks, and the shell renders what it returns.
 */
export function useSatAnnotationSurface(options: SatAnnotationSurfaceOptions) {
  const { annotations, onAnnotationsChange, onFlushAnnotations, interaction } = options;
  const writable = annotations !== undefined && onAnnotationsChange !== undefined && !options.blocked;
  const selection = writable ? interaction.state.annotation.selection : null;
  const education = useSatAnnotationEducation(options.educationKey ?? null);

  /** Mark whose edit controls are open (presentation state, not exam truth). */
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);
  const [confirmationAnchor, setConfirmationAnchor] = useState<SatTextAnchor | null>(null);
  const [undoEntry, setUndoEntry] = useState<{ annotation: SatTextAnnotation; index: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [hintVisible, setHintVisible] = useState(false);

  const editingMark = annotations?.annotations.find((annotation) => annotation.id === editingMarkId) ?? null;
  /**
   * Which note field is open, read from the one place that decides surfaces. Both
   * editors are machine surfaces, so there is no second copy of this answer here.
   */
  const noteEditorId =
    interaction.state.surface.kind === 'annotation-note-editor'
      ? interaction.state.surface.annotationId
      : interaction.state.surface.kind === 'question-note-editor'
        ? SAT_QUESTION_NOTE_EDITOR
        : null;
  const noteEditorAnnotation =
    noteEditorId && noteEditorId !== SAT_QUESTION_NOTE_EDITOR
      ? annotations?.annotations.find((annotation) => annotation.id === noteEditorId) ?? null
      : null;

  const write = useCallback(
    (next: SatQuestionAnnotations) => {
      onAnnotationsChange?.(next);
    },
    [onAnnotationsChange],
  );

  const highlightSelection = useCallback(
    (anchor: SatTextAnchor, color: SatHighlightColor) => {
      if (!annotations || !writable) return;
      const result = applySatHighlightRange(annotations, anchor, color);
      if (result.annotations !== annotations) write(result.annotations);
      // Teach once: the ink landing is the feedback, this names it one time.
      const firstHighlight = !education.state.createdFirstHighlight;
      education.markFirstHighlight(color);
      if (firstHighlight) setConfirmationAnchor(result.annotation.anchor);
      setEditingMarkId(null);
      setAnnouncement(satHighlightedAnnouncement(satHighlightInk(color).label.toLowerCase()));
      interaction.selectionCleared();
    },
    [annotations, education, interaction, writable, write],
  );

  const underlineSelection = useCallback(
    (anchor: SatTextAnchor) => {
      if (!annotations || !writable) return;
      const result = applySatUnderlineRange(annotations, anchor);
      if (result.annotations !== annotations) write(result.annotations);
      setAnnouncement(SAT_COPY.annotations.underlinedAnnouncement);
      interaction.selectionCleared();
    },
    [annotations, interaction, writable, write],
  );

  const addNoteToSelection = useCallback(
    (anchor: SatTextAnchor) => {
      if (!annotations || !writable) return;
      const result = attachSatNoteToAnchor(annotations, anchor);
      if (result.annotations !== annotations) write(result.annotations);
      education.markFirstNote();
      interaction.selectionCleared();
      // Note panel opens focused, so the student types immediately.
      interaction.openAnnotationNote(result.annotation.id);
    },
    [annotations, education, interaction, writable, write],
  );

  const recolourMark = useCallback(
    (annotation: SatTextAnnotation, color: SatHighlightColor) => {
      if (!annotations || !writable) return;
      const next = setSatAnnotationColor(annotations, annotation.id, color);
      if (next !== annotations) write(next);
      education.rememberColor(color);
      setAnnouncement(satHighlightedAnnouncement(satHighlightInk(color).label.toLowerCase()));
    },
    [annotations, education, writable, write],
  );

  const underlineMark = useCallback(
    (annotation: SatTextAnnotation) => {
      if (!annotations || !writable || annotation.kind !== 'highlight') return;
      // Underline on a highlight ADDS an underline over the same span rather than
      // converting it: converting would silently destroy the ink the student
      // already chose.
      const result = applySatUnderlineRange(annotations, annotation.anchor);
      if (result.annotations !== annotations) write(result.annotations);
      setAnnouncement(SAT_COPY.annotations.underlinedAnnouncement);
    },
    [annotations, writable, write],
  );

  /**
   * The notes UI, from the machine. One state for "is the column open, which card
   * is active, which field is open", so nothing downstream has to derive it again.
   */
  const notesState = useMemo<SatNotesUiState>(
    () => satNotesUiFromSurface(interaction.state.surface, editingMarkId, selection !== null),
    [editingMarkId, interaction.state.surface, selection],
  );

  /**
   * Closing notes returns focus where the student was: the mark they wrote about,
   * the row for the question's own note, or the control that opened the column.
   * Without this the caret lands on <body> and a keyboard student loses their
   * place entirely — and because every close path (the button, Escape, the
   * question changing) goes through here, none of them can forget it.
   */
  const closeNotes = useCallback(() => {
    const surface = interaction.state.surface;
    interaction.closeSurface();
    window.requestAnimationFrame(() => {
      if (surface.kind === 'annotation-note-editor' && focusSatAnnotationMark(surface.annotationId)) return;
      if (surface.kind === 'question-note-editor' && focusSatQuestionNoteRow()) return;
      document.getElementById(options.notesTriggerId)?.focus();
    });
  }, [interaction, options.notesTriggerId]);

  /** Write about the question itself, with nothing selected. */
  const openQuestionNote = useCallback(() => {
    setEditingMarkId(null);
    interaction.openQuestionNote();
  }, [interaction]);

  const openNoteOnMark = useCallback(
    (annotation: SatTextAnnotation) => {
      setEditingMarkId(null);
      interaction.openAnnotationNote(annotation.id);
      // The other half of the highlight <-> note link: choosing a note shows the
      // text it is about. Deferred a frame so the passage has laid out around a
      // column that may have just opened.
      window.requestAnimationFrame(() => scrollSatAnnotationIntoView(annotation.id));
    },
    [interaction],
  );

  const removeMark = useCallback(
    (annotation: SatTextAnnotation) => {
      if (!annotations || !writable) return;
      const index = annotations.annotations.findIndex((item) => item.id === annotation.id);
      if (index === -1) return;
      write(removeSatAnnotationById(annotations, annotation.id));
      // Forgiveness instead of a confirmation dialog: the removal is undoable for
      // a few seconds, which is what makes confident tapping safe.
      setUndoEntry({ annotation, index });
      setEditingMarkId(null);
      if (noteEditorId === annotation.id) interaction.closeSurface();
      setAnnouncement(annotation.kind === 'highlight' ? SAT_COPY.annotations.removedHighlight : SAT_COPY.annotations.removedUnderline);
    },
    [annotations, interaction, noteEditorId, writable, write],
  );

  const undoRemoval = useCallback(() => {
    if (!annotations || !undoEntry) return;
    write(reinsertSatAnnotation(annotations, undoEntry.annotation, undoEntry.index));
    setUndoEntry(null);
  }, [annotations, undoEntry, write]);

  const updateNote = useCallback(
    (note: string | undefined) => {
      if (!annotations || !noteEditorAnnotation || !writable) return;
      // Deleting from a bare mark removes the whole annotation. A note-bearing
      // mark keeps its ink and loses only the text: the eraser equivalent is
      // Remove in the edit dock.
      if (note === undefined && !noteEditorAnnotation.note) {
        removeMark(noteEditorAnnotation);
        return;
      }
      const text = (note ?? '').slice(0, SAT_ANNOTATION_NOTE_LIMIT);
      write({
        ...annotations,
        annotations: annotations.annotations.map((annotation) => {
          if (annotation.id !== noteEditorAnnotation.id) return annotation;
          const { note: _previous, ...rest } = annotation;
          return { ...rest, ...(text ? { note: text } : {}), updatedAt: new Date().toISOString() };
        }),
      });
      if (text) education.markFirstNote();
      onFlushAnnotations?.();
    },
    [annotations, education, noteEditorAnnotation, onFlushAnnotations, removeMark, writable, write],
  );

  const selectionActions = useMemo<SatSelectionActions>(
    () => ({ highlight: highlightSelection, underline: underlineSelection, addNote: addNoteToSelection }),
    [addNoteToSelection, highlightSelection, underlineSelection],
  );

  /** Closing the mark editor is Escape's first job; true when it consumed one. */
  const closeMarkEditor = useCallback(() => {
    if (editingMarkId === null) return false;
    setEditingMarkId(null);
    return true;
  }, [editingMarkId]);

  // One-time "Highlighted" confirmation: the ink is the real feedback, this
  // only names the mental model once, then leaves on its own.
  useEffect(() => {
    if (!confirmationAnchor) return;
    const timer = window.setTimeout(() => setConfirmationAnchor(null), SAT_ANNOTATION_CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [confirmationAnchor]);

  // Removal toast lifetime (Undo stays reachable for a few seconds).
  useEffect(() => {
    if (!undoEntry) return;
    const timer = window.setTimeout(() => setUndoEntry(null), SAT_ANNOTATION_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoEntry]);

  // A fresh selection closes the edit dock (they are two answers to "what am I
  // working on?"), and demonstrating the gesture retires the passive hint.
  useEffect(() => {
    if (!selection) return;
    setEditingMarkId(null);
    education.markHintSeen();
  }, [education, selection]);

  // Question changes discard annotation chrome: a mark editor belongs to one
  // question and must never follow the student to the next one.
  useEffect(() => {
    setEditingMarkId(null);
    setConfirmationAnchor(null);
  }, [options.questionKey]);

  const hintVisibleFor = shouldShowSatAnnotationHint(education.state, {
    annotationsAvailable: options.annotationsAvailable,
    blocked: options.blocked,
    hasSelection: selection !== null,
    answered: options.answered,
  });
  useEffect(() => {
    if (!hintVisibleFor) {
      setHintVisible(false);
      return;
    }
    // Delayed so it reads as a quiet aside rather than an alert firing on load.
    const show = window.setTimeout(() => setHintVisible(true), SAT_ANNOTATION_HINT_DELAY_MS);
    return () => window.clearTimeout(show);
  }, [hintVisibleFor]);
  useEffect(() => {
    if (!hintVisible) return;
    const hide = window.setTimeout(() => {
      setHintVisible(false);
      education.markHintSeen();
    }, SAT_ANNOTATION_HINT_DURATION_MS);
    return () => window.clearTimeout(hide);
  }, [education, hintVisible]);

  const questionNotes = useMemo(
    () => (annotations ? satAnnotatedNotes(annotations, noteEditorId) : []),
    [annotations, noteEditorId],
  );
  const hasAnnotations = annotations ? hasSatAnnotations(annotations) : false;

  const annotationView = useMemo<SatAnnotationView>(
    () => ({
      activeAnnotationId: noteEditorId ?? editingMarkId,
      openEditorActive: writable,
      openEditor: (annotation: SatTextAnnotation) => {
        setEditingMarkId(annotation.id);
        interaction.selectionCleared();
      },
      onSelectionCaptured: (anchor: SatTextAnchor) => interaction.selectionCaptured(anchor),
    }),
    [editingMarkId, interaction, noteEditorId, writable],
  );

  return {
    /** True when a mark can be painted (R&W, not blocked, response wired). */
    writable,
    selection,
    selectionActions,
    annotationView,
    /** Ink the toolbar offers as current (the student's last choice). */
    currentColor: education.state.lastHighlightColor,
    editingMark,
    closeMarkEditor,
    recolourMark,
    underlineMark,
    openNoteOnMark,
    removeMark,
    noteEditorAnnotation,
    /** The notes UI state + its close, owned here so no caller derives them. */
    notesState,
    closeNotes,
    openQuestionNote,
    updateNote,
    undoEntry,
    undoRemoval,
    confirmationAnchor,
    hintVisible,
    announcement,
    /** Anchored notes for the Notes panel, in passage order. */
    questionNotes,
    hasAnnotations,
  };
}
