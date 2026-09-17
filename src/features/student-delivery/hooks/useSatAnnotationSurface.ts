import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SAT_ANNOTATION_UNDO_MS,
  satAnnotationHintDelayMs,
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
  restoreSatAnnotationNote,
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
  focusSatNotesRail,
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
  /**
   * The question's own note.
   *
   * The surface owns this value's consequences, not its storage: it is what
   * retires the teaching line for a student who wrote instead of selecting, and
   * what a removed note is restored from. The runner still owns persistence.
   */
  questionNote: string;
  /** Writes the question's own note, including the empty string on removal. */
  onSaveQuestionNote: (note: string) => void;
  interaction: SatInteractionController;
  /** Chrome belongs to one question; changing it discards the chrome. */
  questionKey: string;
  /** Id of the control that opens the column, for focus return. */
  notesTriggerId: string;
}

/**
 * The one undo entry: whatever was just removed, with enough to put it back.
 *
 * Marks and note text share a slot because they make the same promise — removal
 * is forgiving for a few seconds before it is final. Note text is the case that
 * needed it most: a note can hold two thousand characters, and it used to be
 * discarded the instant the student pressed Remove.
 */
export type SatAnnotationUndoEntry =
  | { kind: 'mark'; annotation: SatTextAnnotation; index: number }
  | { kind: 'note'; annotationId: string; text: string }
  /** The question's own note lives outside the marks, so it restores its own way. */
  | { kind: 'question-note'; text: string };

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
  const { onSaveQuestionNote, questionNote } = options;
  const writable = annotations !== undefined && onAnnotationsChange !== undefined && !options.blocked;
  const selection = writable ? interaction.state.annotation.selection : null;
  const education = useSatAnnotationEducation(options.educationKey ?? null);

  /** Mark whose edit controls are open (presentation state, not exam truth). */
  const [editingMarkId, setEditingMarkId] = useState<string | null>(null);
  const [undoEntry, setUndoEntry] = useState<SatAnnotationUndoEntry | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [hintVisible, setHintVisible] = useState(false);

  const editingMark = annotations?.annotations.find((annotation) => annotation.id === editingMarkId) ?? null;
  /** Dismiss the mark's controls (the note editor is a surface, not chrome). */
  const dismissMarkControls = useCallback(() => {
    setEditingMarkId(null);
  }, []);
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
      // The student's ink choice is remembered for the next mark.
      education.markFirstHighlight(color);
      // Acting does not dismiss the tools: they become the controls of the mark
      // that just landed, in the same place, with the chosen ink pressed — so a
      // second tap changes the ink instead of demanding a click on the text
      // first. The mark's own ink is the confirmation; nothing else pops up.
      setEditingMarkId(result.annotation.id);
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
      // The note opens where notes live: the pane, on this note's card, with the
      // caret already in the field. The mark's own controls close on the way, so
      // there is never a floating editor over a pane editor for the same note.
      dismissMarkControls();
      interaction.openAnnotationNote(result.annotation.id);
    },
    [annotations, dismissMarkControls, education, interaction, writable, write],
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
      // The pane leaves a handle where it was; focus goes with it, so hiding is
      // one press from being undone rather than a change the student has to
      // hunt for. The top bar is the fallback where no handle exists.
      if (focusSatNotesRail()) return;
      document.getElementById(options.notesTriggerId)?.focus();
    });
  }, [interaction, options.notesTriggerId]);

  /** Write about the question itself, with nothing selected. */
  const openQuestionNote = useCallback(() => {
    dismissMarkControls();
    interaction.openQuestionNote();
  }, [dismissMarkControls, interaction]);

  /**
   * Open the column from its own edge, for the handle it leaves behind.
   *
   * Not a toggle: the handle only exists while the column is hidden, so the
   * control is a way back rather than a switch, and an open request that arrived
   * twice could never close the pane the student just asked for.
   */
  const openNotes = useCallback(() => {
    dismissMarkControls();
    interaction.openQuestionNotes();
  }, [dismissMarkControls, interaction]);

  /**
   * Open a mark's note in the Notes column.
   *
   * The one way into writing: choosing the mark's card, pressing Add note on a
   * mark that already has one, or adding a note to a fresh selection all land
   * here. The mark's inline controls are closed on the way, so exactly one editor
   * for that note is ever on screen.
   */
  const openNoteOnMark = useCallback(
    (annotation: SatTextAnnotation) => {
      dismissMarkControls();
      interaction.openAnnotationNote(annotation.id);
      // The other half of the highlight <-> note link: choosing a note shows the
      // text it is about. Deferred a frame so the passage has laid out around a
      // column that may have just opened.
      window.requestAnimationFrame(() => scrollSatAnnotationIntoView(annotation.id));
    },
    [dismissMarkControls, interaction],
  );

  /** The single writer for an anchored note's text (the pane's field commits here). */
  const writeMarkNote = useCallback(
    (annotation: SatTextAnnotation, note: string) => {
      if (!annotations || !writable) return;
      const text = note.slice(0, SAT_ANNOTATION_NOTE_LIMIT);
      write({
        ...annotations,
        annotations: annotations.annotations.map((item) => {
          if (item.id !== annotation.id) return item;
          const { note: _previous, ...rest } = item;
          return { ...rest, ...(text ? { note: text } : {}), updatedAt: new Date().toISOString() };
        }),
      });
      if (text) education.markFirstNote();
      onFlushAnnotations?.();
    },
    [annotations, education, onFlushAnnotations, writable, write],
  );

  const removeMark = useCallback(
    (annotation: SatTextAnnotation) => {
      if (!annotations || !writable) return;
      const index = annotations.annotations.findIndex((item) => item.id === annotation.id);
      if (index === -1) return;
      write(removeSatAnnotationById(annotations, annotation.id));
      // Forgiveness instead of a confirmation dialog: the removal is undoable for
      // a few seconds, which is what makes confident tapping safe.
      setUndoEntry({ kind: 'mark', annotation, index });
      dismissMarkControls();
      if (noteEditorId === annotation.id) interaction.closeSurface();
      setAnnouncement(annotation.kind === 'highlight' ? SAT_COPY.annotations.removedHighlight : SAT_COPY.annotations.removedUnderline);
    },
    [annotations, dismissMarkControls, interaction, noteEditorId, writable, write],
  );

  const undoLastRemoval = useCallback(() => {
    if (!undoEntry) return;
    if (undoEntry.kind === 'question-note') {
      // Restoring writes the text back through the runner's own writer, so the
      // question note and its undo share one persistence path.
      onSaveQuestionNote(undoEntry.text);
    } else if (annotations) {
      write(
        undoEntry.kind === 'mark'
          ? reinsertSatAnnotation(annotations, undoEntry.annotation, undoEntry.index)
          : restoreSatAnnotationNote(annotations, undoEntry.annotationId, undoEntry.text),
      );
    }
    setUndoEntry(null);
  }, [annotations, onSaveQuestionNote, undoEntry, write]);

  /**
   * Remove a note's words, keep its ink, and leave the removal undoable.
   *
   * The mark is the student's; the text is theirs to drop — but dropping two
   * thousand characters should never be one irreversible press.
   */
  const removeNoteText = useCallback(
    (annotation: SatTextAnnotation) => {
      const text = annotation.note ?? '';
      if (!annotations || !writable || text.trim().length === 0) return;
      setUndoEntry({ kind: 'note', annotationId: annotation.id, text });
      write(restoreSatAnnotationNote(annotations, annotation.id, ''));
      onFlushAnnotations?.();
    },
    [annotations, onFlushAnnotations, writable, write],
  );

  /** The same forgiveness for the question's own note. */
  const removeQuestionNoteText = useCallback(() => {
    if (!writable || questionNote.trim().length === 0) return;
    setUndoEntry({ kind: 'question-note', text: questionNote });
    onSaveQuestionNote('');
  }, [onSaveQuestionNote, questionNote, writable]);

  /** The column's own field, which is the machine's note editor surface. */
  const updateNote = useCallback(
    (note: string | undefined) => {
      if (!noteEditorAnnotation) return;
      // Deleting from a bare mark removes the whole annotation. A note-bearing
      // mark keeps its ink and loses only the text: the eraser equivalent is
      // Remove in the edit dock.
      if (note === undefined && !noteEditorAnnotation.note) {
        removeMark(noteEditorAnnotation);
        return;
      }
      writeMarkNote(noteEditorAnnotation, note ?? '');
    },
    [noteEditorAnnotation, removeMark, writeMarkNote],
  );

  const selectionActions = useMemo<SatSelectionActions>(
    () => ({ highlight: highlightSelection, underline: underlineSelection, addNote: addNoteToSelection }),
    [addNoteToSelection, highlightSelection, underlineSelection],
  );

  /**
   * The tools' own close control, and Escape's first job.
   *
   * Focus goes back to the mark they were about: dismissing the controls is not
   * leaving the text, and a keyboard student must not land on <body> for it.
   */
  const closeMarkEditor = useCallback(() => {
    if (editingMarkId === null) return false;
    const markId = editingMarkId;
    dismissMarkControls();
    window.requestAnimationFrame(() => focusSatAnnotationMark(markId));
    return true;
  }, [dismissMarkControls, editingMarkId]);

  /** Dismiss the selection tools without touching the selection or the marks. */
  const closeSelectionTools = useCallback(() => interaction.selectionCleared(), [interaction]);

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
    dismissMarkControls();
    education.markHintSeen();
  }, [dismissMarkControls, education, selection]);

  // Question changes discard annotation chrome: a mark editor belongs to one
  // question and must never follow the student to the next one.
  useEffect(() => {
    dismissMarkControls();
  }, [dismissMarkControls, options.questionKey]);

  const hasAnnotations = annotations ? hasSatAnnotations(annotations) : false;
  /**
   * The teaching line is for a student who has not annotated anything yet, so
   * writing about the question counts as much as marking the passage: either one
   * proves they found the tool.
   */
  const lessonOver = hasAnnotations || questionNote.trim().length > 0;
  const hintAllowed = shouldShowSatAnnotationHint(education.state, {
    annotationsAvailable: options.annotationsAvailable,
    blocked: options.blocked,
    hasSelection: selection !== null,
    answered: options.answered,
    hasAnnotations: lessonOver,
  });
  // Opening Highlights & Notes is a request for the tool, so the line is there
  // immediately; otherwise it waits, so it reads as an aside rather than an alert
  // firing on load.
  const hintDelayMs = satAnnotationHintDelayMs(interaction.state.surface.kind === 'question-notes');
  useEffect(() => {
    if (!hintAllowed) {
      setHintVisible(false);
      return;
    }
    if (hintDelayMs === 0) {
      setHintVisible(true);
      return;
    }
    const show = window.setTimeout(() => setHintVisible(true), hintDelayMs);
    return () => window.clearTimeout(show);
  }, [hintAllowed, hintDelayMs]);
  // The line retires on demonstrated understanding, never on a timer: the old
  // five-second countdown spent the lesson on students who had not read it yet.
  useEffect(() => {
    if (lessonOver) education.markHintSeen();
  }, [education, lessonOver]);

  const questionNotes = useMemo(
    () => (annotations ? satAnnotatedNotes(annotations, noteEditorId) : []),
    [annotations, noteEditorId],
  );

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
    closeSelectionTools,
    recolourMark,
    underlineMark,
    openNoteOnMark,
    removeMark,
    noteEditorAnnotation,
    /** The notes UI state + its close, owned here so no caller derives them. */
    notesState,
    closeNotes,
    openNotes,
    openQuestionNote,
    updateNote,
    /** Removal, with undo, for both kinds of note text. */
    removeNoteText,
    removeQuestionNoteText,
    undoEntry,
    undoLastRemoval,
    hintVisible,
    announcement,
    /** Anchored notes for the Notes panel, in passage order. */
    questionNotes,
    hasAnnotations,
  };
}
