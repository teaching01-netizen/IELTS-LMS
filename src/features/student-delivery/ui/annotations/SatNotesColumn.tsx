import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronLeft, Plus, StickyNote } from 'lucide-react';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY, satNoteActionsLabel, satNoteFieldLabel, satNotesCountLabel } from '../../domain/satCopy';
import {
  SAT_QUESTION_NOTE_EDITOR,
  satNotesCount,
  type SatNotesPlacement,
  type SatNotesUiState,
} from '../../domain/satNotesUi';
import { satHighlightInk } from './satAnnotationPalette';
import { useSatAnnotationDismiss } from './useSatAnnotationDismiss';
import { QUESTION_NOTE_FIELD_ID, SatNoteField, satNoteEditorFieldId } from './SatNoteField';

export interface SatNotesColumnProps {
  /** The one notes state: which card is active, which field takes the caret. */
  state: Extract<SatNotesUiState, { kind: 'notes' }>;
  placement: SatNotesPlacement;
  annotations: readonly SatTextAnnotation[];
  /** The freeform note about the question, which has always persisted per question. */
  questionNote: string;
  /** True when the question carries marks that are not notes (empty-state aside). */
  hasHighlights: boolean;
  disabled: boolean;
  onSelectNote: (annotationId: string) => void;
  /**
   * Commit an anchored note's text (an empty string keeps the ink), keyed by the
   * note the field belongs to — every card carries a live field, so the column
   * says which note it is writing rather than relying on a single open editor.
   */
  onChangeNote: (annotationId: string, note: string) => void;
  onSaveQuestionNote: (note: string) => void;
  /**
   * Remove a note's text, keyed by annotation id (`SAT_QUESTION_NOTE_EDITOR` for
   * the question's own note). Staged for undo by the owner, so the column never
   * decides how forgiving a removal is.
   */
  onRemoveNote: (annotationId: string) => void;
  /** Write about the question itself, for a student with nothing selected. */
  onAddQuestionNote: () => void;
  /**
   * A press outside the pane settles the note the student was in — the pane stays
   * exactly where it is, and the exam stops treating a list of live fields as an
   * open editor. Without it, the next selection in the passage is refused as a
   * second editor and the student simply cannot highlight anything else.
   */
  onSettleNoteEditor: () => void;
  onFlush?: (() => void) | undefined;
  onClose: () => void;
}

/**
 * The Notes column: one destination for everything the student wrote down.
 *
 * It is a structural pane beside the passage, not a panel floating over the exam,
 * because the point of a note is its relationship to the text it is about. The
 * mental model is the layout:
 *
 *     select something -> mark it -> the note appears beside what I marked
 *
 * One list, no Save button (idle autosave plus a commit on close), the character
 * count appearing only near the limit, and removal behind a neutral disclosure.
 *
 * Every card is the same card at all times, and it holds exactly two things:
 *
 *     active after          the student's own selection, semibold, unquoted
 *     [ Write a note… ]     the note itself, and always editable
 *
 * There is no reading state to leave and no editing state to enter: a note IS the
 * field, never a preview of one. Cards used to render the note twice — once as
 * static text and again inside the textarea that appeared when the card was
 * opened — which made a student decide which copy was theirs before they could
 * write anything. One value has one representation; the excerpt above it is
 * context, and context does not become a control.
 *
 * Selected-text notes are the pattern; the question's own note is one quiet
 * button at the bottom, because two competing primaries made students ask which
 * kind of note they were writing. That note has no highlighted source, so it
 * shows none — a label invented to make the two cards look alike would only be a
 * third thing to read.
 *
 * Hiding the pane is part of that model, not an escape hatch: the header's
 * control names what it does, and the pane leaves a labeled handle in its own
 * place (see SatNotesRail) so the one press can be taken back from where it was
 * taken.
 */
export function SatNotesColumn(props: SatNotesColumnProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  // A sentinel editor id means "this field is the question's own note" — the same
  // state either way, so writing about the question needs no flag of its own.
  const questionEditorOpen = props.state.editorId === SAT_QUESTION_NOTE_EDITOR;
  // Guidance or cards, never both: the contradictory pairing this replaced was
  // "No notes yet" sitting above a live field.
  const showsEmptyState =
    props.annotations.length === 0 && props.questionNote.trim().length === 0 && !questionEditorOpen;
  // Cards the student actually wrote, which is what "3 notes" should count. The
  // same rule decides whether a hidden pane leaves a handle behind, so it lives
  // in one place (`satNotesCount`) rather than being re-derived per surface.
  const noteCount = satNotesCount(props.annotations, props.questionNote);

  // Opening the column is a promise of somewhere to be: focus lands on the
  // column itself (not a field nobody asked to type in) so Escape, Tab, and the
  // close control are reachable.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => rootRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Reading the passage is not leaving the notes: a press outside the pane ends
  // the note the student was in and nothing else. The press is read in the
  // capture phase, before it becomes the start of a new selection, so the
  // selection that follows is understood as a selection rather than refused.
  useSatAnnotationDismiss(rootRef, props.onSettleNoteEditor);

  // Writing a note is the one case where the caret belongs in the field — and the
  // only thing `editorId` still decides, now that every card carries a field: it
  // is a destination for the caret, not a permission to edit.
  useEffect(() => {
    if (props.state.editorId === null) return;
    const fieldId =
      props.state.editorId === SAT_QUESTION_NOTE_EDITOR
        ? QUESTION_NOTE_FIELD_ID
        : satNoteEditorFieldId(props.state.editorId);
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(fieldId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.state.editorId]);

  // The other half of the highlight <-> note link: when the passage activates a
  // mark, its card comes into view so both ends of the relationship are visible.
  useEffect(() => {
    if (!props.state.activeId) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-sat-note-card="${props.state.activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [props.state.activeId]);

  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      data-sat-notes-column="true"
      aria-label={SAT_COPY.notes.title}
      className="flex h-full min-h-0 min-w-0 flex-col border-l border-[var(--sat-divider)] bg-[var(--sat-surface)] outline-none"
    >
      {/* Title first, count as the metadata it is, dismissal last and quiet: the
          three used to sit on one line at equal weight, which made "1 note" look
          like something to press. */}
      <header className="flex min-h-[44px] shrink-0 items-start justify-between gap-2 border-b border-[var(--sat-divider)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="sat-type-control-primary font-semibold text-[var(--sat-text)]">{SAT_COPY.notes.title}</h2>
          {/* Absent at zero, so a student reading "No notes yet" is never also
              told "0 notes"; present from the first one, as the second line of
              the heading rather than a peer of it. */}
          {noteCount > 0 ? (
            <p data-sat-notes-count="true" className="sat-type-metadata text-[var(--sat-text-secondary)]">
              {satNotesCountLabel(noteCount)}
            </p>
          ) : null}
        </div>
        {/* One control, and it is written out rather than drawn: hiding a pane
            that comes back is not a universal glyph, and a bare chevron in the
            corner is exactly the thing a first-time student declines to press.
            It also points the way the pane goes — down where notes stack beneath
            the panes, toward the edge it retracts to everywhere else — so the
            press reports the direction it will take. */}
        <button
          type="button"
          onClick={props.onClose}
          // On the two-pane widths the column takes the question's place, so the
          // control says what hiding brings back.
          aria-label={props.placement === 'pair' ? SAT_COPY.notes.collapseAndShowQuestion : SAT_COPY.notes.collapse}
          className="sat-touch-target sat-pressable flex shrink-0 items-center gap-1 rounded-[6px] px-2 sat-type-metadata font-medium text-[var(--sat-text-secondary)] hover:bg-[var(--sat-surface-hover)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          {props.placement === 'row' ? (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{SAT_COPY.notes.collapse}</span>
        </button>
      </header>
      {/* The list scrolls; the question's own note does not, so the one action
          that works with nothing selected stays reachable at the bottom. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {showsEmptyState ? (
            <EmptyState hasHighlights={props.hasHighlights} />
          ) : (
            <ul className="flex flex-col gap-3">
              {props.annotations.map((annotation) => (
                <li key={annotation.id}>
                  <SatNoteCard
                    annotation={annotation}
                    active={annotation.id === props.state.activeId}
                    disabled={props.disabled}
                    onSelect={() => props.onSelectNote(annotation.id)}
                    onChangeNote={props.onChangeNote}
                    onRemoveNote={() => props.onRemoveNote(annotation.id)}
                    onFlush={props.onFlush}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <SatQuestionNoteSlot
          value={props.questionNote}
          editing={questionEditorOpen}
          // A divider only when there is something above to divide from.
          divided={!showsEmptyState}
          disabled={props.disabled}
          onAdd={props.onAddQuestionNote}
          onSave={props.onSaveQuestionNote}
          onRemoveNote={() => props.onRemoveNote(SAT_QUESTION_NOTE_EDITOR)}
          onFlush={props.onFlush}
        />
      </div>
    </aside>
  );
}

/**
 * What a student sees before they have written anything: what this column is,
 * then the one gesture that fills it.
 *
 * Not a dashed box with a call to action — the column already defines the region,
 * so the guidance can simply be text, at the size of the thing it describes.
 */
function EmptyState({ hasHighlights }: { hasHighlights: boolean }) {
  return (
    <div data-sat-notes-empty="true" className="flex flex-col items-center gap-1 px-2 py-8 text-center">
      <StickyNote className="h-5 w-5 text-[var(--sat-text-secondary)]" aria-hidden="true" />
      <p className="sat-type-control-secondary font-medium text-[var(--sat-text)]">{SAT_COPY.notes.emptyTitle}</p>
      <p className="sat-type-metadata text-[var(--sat-text-secondary)]">{SAT_COPY.notes.empty}</p>
      {/* A student who highlighted but never wrote gets told where those marks
          are, instead of being left to wonder whether they were lost. */}
      {hasHighlights ? (
        <p data-sat-notes-empty-highlights="true" className="sat-type-metadata text-[var(--sat-text-secondary)]">
          {SAT_COPY.notes.emptyWithHighlights}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One card: the student's selection, then the one field their note lives in.
 *
 * The excerpt is context, so it is context typography — semibold, unquoted, not
 * italic, unlabeled, capped at a few lines. It stays pressable because a note's
 * whole purpose is the text it is about, and pressing the words is the most
 * direct way to be shown them again in the passage; it is never the thing being
 * written.
 */
function SatNoteCard({
  annotation,
  active,
  disabled,
  onSelect,
  onChangeNote,
  onRemoveNote,
  onFlush,
}: {
  annotation: SatTextAnnotation;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onChangeNote: (annotationId: string, note: string) => void;
  onRemoveNote: () => void;
  onFlush?: (() => void) | undefined;
}) {
  const excerpt = annotation.anchor.exact;
  return (
    <div
      data-sat-note-card={annotation.id}
      // Not a box: the pane is the container, so a card is rows of content, and
      // the active one is marked by the accent on its leading edge alone rather
      // than by a fill and a border and a ring at once.
      className={
        'flex gap-2 rounded-[8px] border-l-2 py-2 pl-1.5 pr-2 ' +
        (active ? 'border-l-[var(--sat-accent)]' : 'border-l-transparent')
      }
    >
      {/* The mark's ink in a leading gutter, so the excerpt and the note beneath
          it start on the same line of the card: a column of text, with the one dot
          that says which highlight it belongs to beside both of them. With several
          notes in the pane it is the only cue tying one to one of several marks. */}
      <span
        aria-hidden="true"
        data-sat-note-ink={annotation.color ?? 'yellow'}
        className="mt-[6px] h-2 w-2 shrink-0 rounded-full border border-[var(--sat-divider-strong)]"
        style={{ backgroundColor: satHighlightInk(annotation.color).swatch }}
      />
      {/* The header line is the note's context, and its far end holds whatever the
          note has to say about itself: the save status, and the one control that
          is not about writing. Nothing sits under the field, so a card is a row of
          context and a place to write. */}
      <div className="min-w-0 flex-1">
        <SatNoteField
          fieldId={satNoteEditorFieldId(annotation.id)}
          label={satNoteFieldLabel(excerpt)}
          actionsLabel={satNoteActionsLabel(excerpt)}
          value={annotation.note ?? ''}
          ownerKey={annotation.id}
          disabled={disabled}
          commit={(note) => onChangeNote(annotation.id, note)}
          onFlush={onFlush}
          // Removal matters only once there is a note; during a first note there is
          // nothing behind the control worth offering.
          canRemove={(annotation.note ?? '').trim().length > 0}
          onRemoveRequested={onRemoveNote}
          context={
            <button
              type="button"
              data-sat-note-excerpt="true"
              disabled={disabled}
              onClick={onSelect}
              // The accent edge says "this is the mark you are on" to the eye; this
              // says it to a screen reader, which cannot see the link at all.
              aria-current={active ? 'true' : undefined}
              className="sat-pressable min-w-0 flex-1 rounded-[4px] text-left sat-type-control-secondary font-semibold text-[var(--sat-text)] hover:text-[var(--sat-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed"
            >
              {/* Capped at three lines: a long selection must not take the pane,
                  and the whole excerpt is still there for a screen reader. */}
              <span className="line-clamp-3">{excerpt}</span>
            </button>
          }
        />
      </div>
    </div>
  );
}

/**
 * The question's own note, at the bottom and out of the way.
 *
 * It used to be a full-width row with the same weight as a note about a passage
 * phrase, which is what made students ask which kind of note they were writing.
 * Now the printed phrasing stays the primary pattern and this is one quiet
 * button — the same field and the same autosave when it is open, so nothing about
 * how a note behaves depends on what it is attached to.
 *
 * It has no source to quote, so it shows none: the excerpt above an anchored note
 * is what distinguishes the two kinds, and a written label invented to make the
 * shapes match would only be one more thing to read.
 */
function SatQuestionNoteSlot({
  value,
  editing,
  divided,
  disabled,
  onAdd,
  onSave,
  onRemoveNote,
  onFlush,
}: {
  value: string;
  editing: boolean;
  divided: boolean;
  disabled: boolean;
  onAdd: () => void;
  onSave: (note: string) => void;
  /** Staged for undo by the owner, like an anchored note's removal. */
  onRemoveNote: () => void;
  onFlush?: (() => void) | undefined;
}) {
  const hasNote = value.trim().length > 0;
  const frame = 'shrink-0 px-3 py-2' + (divided ? ' border-t border-[var(--sat-divider)]' : '');

  if (!editing && !hasNote) {
    return (
      <div className={frame}>
        {/* A text button, not a card: with nothing selected this is a way in, and
            an outlined block the size of a note would read as the primary action of
            a screen whose primary action is selecting text in the passage. */}
        <button
          type="button"
          data-sat-notes-add-question-note="true"
          disabled={disabled}
          onClick={onAdd}
          className="sat-pressable inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 sat-type-metadata font-medium text-[var(--sat-accent-strong)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)]"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {SAT_COPY.notes.addQuestionNote}
        </button>
      </div>
    );
  }

  return (
    <div className={frame}>
      <div data-sat-note-card={SAT_QUESTION_NOTE_EDITOR} className="px-1">
        {/* `questionSource` is this field's spoken name and nothing else: the note
            about the question reads as a note, not as a labeled form row. */}
        <SatNoteField
          fieldId={QUESTION_NOTE_FIELD_ID}
          label={SAT_COPY.notes.questionSource}
          actionsLabel={SAT_COPY.notes.noteActions}
          value={value}
          ownerKey={SAT_QUESTION_NOTE_EDITOR}
          disabled={disabled}
          commit={onSave}
          onFlush={onFlush}
          canRemove={hasNote}
          onRemoveRequested={onRemoveNote}
        />
      </div>
    </div>
  );
}
