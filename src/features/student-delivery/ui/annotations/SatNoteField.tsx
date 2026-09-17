import { useCallback, useEffect, useRef, useState } from 'react';
import { SAT_ANNOTATION_NOTE_LIMIT } from '../../domain/satResponses';
import { SAT_COPY } from '../../domain/satCopy';
import {
  SAT_NOTE_AUTOSAVE_MS,
  SAT_NOTE_SAVED_MS,
  clampSatNote,
  satNoteCounterLabel,
  satNoteCounterUrgent,
  satNoteCounterVisible,
} from '../../domain/satNoteEntry';

/** Field id for the anchored-note editor, which is what the caret targets. */
export const SAT_NOTE_EDITOR_FIELD_ID = 'sat-note-editor-field';

/** Field id for the question's own note. */
export const QUESTION_NOTE_FIELD_ID = 'sat-question-note';

/**
 * The one note field: a capped textarea with idle autosave, a one-time promise
 * that there is nothing to save, a quiet "Saved", a count that only appears
 * near the limit, and removal that only exists once there is text.
 *
 * Both card kinds use it, so an anchored note and a note about the question
 * cannot drift apart in how they save, warn, or empty. Removal is *staged* by the
 * caller (`onRemoveRequested`) so it can land in the same undo toast that already
 * forgives a deleted mark; a field used on its own still empties in place.
 *
 * It is also the only field: the mark's own controls used to hold a second copy
 * of it, which meant two editors for one note and two places that had to agree
 * about autosave. Writing a note now always lands here, in the pane.
 */
export function SatNoteField({
  fieldId,
  label,
  value,
  ownerKey,
  disabled,
  commit,
  onFlush,
  canRemove,
  onRemoveRequested,
  className,
}: {
  fieldId: string;
  label: string;
  value: string;
  ownerKey: string;
  disabled: boolean;
  commit: (note: string) => void;
  onFlush?: (() => void) | undefined;
  /** True once there is text worth removing (removal empties the note, not the mark). */
  canRemove: boolean;
  /** Staged, undoable removal. Absent = clear in place. */
  onRemoveRequested?: (() => void) | undefined;
  className?: string;
}) {
  const draft = useSatNoteDraft({ value, ownerKey, disabled, commit, onFlush });
  return (
    <>
      <textarea
        id={fieldId}
        value={draft.draft}
        maxLength={SAT_ANNOTATION_NOTE_LIMIT}
        rows={3}
        disabled={disabled}
        placeholder={SAT_COPY.notes.placeholder}
        aria-label={label}
        onChange={(event) => draft.type(event.target.value)}
        onBlur={() => draft.commitNow()}
        // `sat-reading-copy`, like the passage: a note is reading content, so the
        // student's text-size choice applies to it as well.
        //
        // No border until focus: this field is the strongest layer in the column
        // while it is being used and no layer at all while it is not, which is
        // what keeps a pane full of cards from reading as a box inside a box.
        className={
          'sat-reading-copy w-full resize-y rounded-[6px] border border-transparent bg-[var(--sat-surface-hover)] p-2 text-[var(--sat-text)] outline-none placeholder:text-[var(--sat-text-secondary)] hover:border-[var(--sat-divider)] focus:border-[var(--sat-accent)] focus:bg-[var(--sat-surface)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed '
          + (className ?? '')
        }
      />
      <NoteFieldFooter
        length={draft.draft.length}
        saved={draft.saved}
        // Shown until the first save in this field happens: the student reads the
        // promise once, watches it come true, and never sees it again.
        showAutosaveHint={!draft.hasSaved}
        disabled={disabled}
        onRemove={canRemove ? onRemoveRequested ?? (() => draft.clear()) : undefined}
      />
    </>
  );
}

function NoteFieldFooter({
  length,
  saved,
  showAutosaveHint,
  disabled,
  onRemove,
}: {
  length: number;
  saved: boolean;
  /** True until this field has seen its first save. */
  showAutosaveHint: boolean;
  disabled: boolean;
  onRemove?: (() => void) | undefined;
}) {
  return (
    <div className="mt-1 flex min-h-[20px] items-center justify-between gap-2">
      {/* Destructive only once there is something meaningful to destroy, and
          quiet when it is: a student mid-sentence should never have their eye
          caught by the way to lose the sentence. */}
      {onRemove && !disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="sat-pressable rounded-[6px] px-1 sat-type-metadata font-medium text-[var(--sat-danger)] hover:bg-[var(--sat-danger-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
        >
          {SAT_COPY.notes.remove}
        </button>
      ) : (
        <span />
      )}
      <span className="flex items-center gap-2">
        {/* The promise, made once: this replaces a permanent line repeating that
            there is nothing to press. */}
        {showAutosaveHint ? (
          <span data-sat-note-autosave-hint="true" className="sat-type-metadata text-[var(--sat-text-secondary)]">
            {SAT_COPY.notes.saveHelper}
          </span>
        ) : null}
        {/* Transient by design: the reassurance that there is nothing to save. */}
        {saved ? (
          <span
            data-sat-note-saved="true"
            data-testid="sat-note-saved"
            aria-live="polite"
            className="sat-type-metadata text-[var(--sat-text-secondary)]"
          >
            {SAT_COPY.notes.saved}
          </span>
        ) : null}
        {/* Progressive disclosure: the count is a warning, not a decoration. */}
        {satNoteCounterVisible(length) ? (
          <span
            data-sat-note-counter="true"
            aria-live="polite"
            className={
              satNoteCounterUrgent(length)
                ? 'sat-type-metadata font-semibold text-[var(--sat-danger-text)]'
                : 'sat-type-metadata text-[var(--sat-text-secondary)]'
            }
          >
            {satNoteCounterLabel(length)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * A note field with no Save button.
 *
 * Idle autosave is the promise; committing on blur, on close, and on unmount
 * (which is also how a pending draft survives a question change, since the column
 * is keyed by question) is the guarantee. Local state is the draft the student
 * sees, so no save can ever make typing wait.
 */
function useSatNoteDraft({
  value,
  ownerKey,
  disabled,
  commit,
  onFlush,
}: {
  value: string;
  ownerKey: string;
  disabled: boolean;
  commit: (note: string) => void;
  onFlush?: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  /**
   * True once this field has saved once.
   *
   * Not transient like `saved`: it is the memory that lets the autosave promise
   * be made exactly once. It belongs to the field instance, and the column keys a
   * field by its note, so a different note is a different promise.
   */
  const [hasSaved, setHasSaved] = useState(false);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const commitRef = useRef(commit);
  const flushRef = useRef(onFlush);
  const disabledRef = useRef(disabled);
  const autosaveTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);

  draftRef.current = draft;
  valueRef.current = value;
  commitRef.current = commit;
  flushRef.current = onFlush;
  disabledRef.current = disabled;

  // A different note (or the same one re-read after a question change) is a
  // different draft; keeping the old text would write one note onto another.
  //
  // A pending autosave is dropped with it: the owner can change this value
  // underneath the field (Remove note stages an undo and clears it), and a draft
  // still queued from before that point would resurrect the note the student just
  // deleted — twice over, since Undo would then restore it again.
  useEffect(() => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    setDraft(value);
  }, [ownerKey, value]);

  const write = useCallback((next: string) => {
    if (disabledRef.current || next === valueRef.current) return;
    commitRef.current(next);
    flushRef.current?.();
    setSaved(true);
    setHasSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), SAT_NOTE_SAVED_MS);
  }, []);

  const writeRef = useRef(write);
  writeRef.current = write;

  // Unmounting must not swallow a draft that was still waiting on autosave.
  useEffect(
    () => () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
        writeRef.current(draftRef.current);
      }
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const type = useCallback(
    (next: string) => {
      const clamped = clampSatNote(next);
      setDraft(clamped);
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => write(clamped), SAT_NOTE_AUTOSAVE_MS);
    },
    [write],
  );

  /** Commit whatever is typed right now (blur, close, navigation). */
  const commitNow = useCallback(() => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    write(draftRef.current);
  }, [write]);

  /** Empty the note, keeping the mark: the ink is the student's, the text is theirs to drop. */
  const clear = useCallback(() => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    setDraft('');
    write('');
  }, [write]);

  return { draft, type, saved, hasSaved, commitNow, clear };
}
