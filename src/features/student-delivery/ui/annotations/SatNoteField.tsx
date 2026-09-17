import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
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

/** Field id for an anchored note's editor, which is what the caret targets. */
export function satNoteEditorFieldId(annotationId: string): string {
  return 'sat-note-editor-' + annotationId;
}

/** Field id for the question's own note. */
export const QUESTION_NOTE_FIELD_ID = 'sat-question-note';

/** Resting height of a note field, and the height past which it scrolls instead. */
const SAT_NOTE_FIELD_MIN_PX = 68;
const SAT_NOTE_FIELD_MAX_PX = 160;

/** What the field is doing about saving, which is all it ever needs to say. */
type SatNoteSaveState = 'idle' | 'saving' | 'saved';

/**
 * The one note field: a capped textarea that autosaves, with the line it is about
 * above it and everything else the student does not need kept quiet.
 *
 * Both card kinds use it, so an anchored note and a note about the question
 * cannot drift apart in how they save, grow, or empty. It is also the only
 * editor: the student's words exist in exactly one place on screen, and this is
 * it — there is no reading state that shows the same text as static content
 * beside a field that shows it again.
 *
 * The layout is one header line and one field. `context` is whatever the note is
 * about (the student's own selection, or nothing at all), and the header's far end
 * carries the transient save status and the secondary disclosure — so a card is a
 * row of context and a place to write, with no third band of chrome under it.
 *
 * Removal is *staged* by the caller (`onRemoveRequested`) so it can land in the
 * same undo toast that already forgives a deleted mark; a field used on its own
 * still empties in place. Either way it sits behind a neutral disclosure, so the
 * way to lose a sentence never competes with writing one.
 */
export function SatNoteField({
  fieldId,
  label,
  actionsLabel,
  value,
  ownerKey,
  disabled,
  commit,
  onFlush,
  canRemove,
  onRemoveRequested,
  context,
  className,
}: {
  fieldId: string;
  /** The field's spoken name, e.g. `Note on “Several”`. */
  label: string;
  /** The spoken name of this note's secondary actions. */
  actionsLabel: string;
  value: string;
  ownerKey: string;
  disabled: boolean;
  commit: (note: string) => void;
  onFlush?: (() => void) | undefined;
  /** True once there is text worth removing (removal empties the note, not the mark). */
  canRemove: boolean;
  /** Staged, undoable removal. Absent = clear in place. */
  onRemoveRequested?: (() => void) | undefined;
  /** What this note is about, shown on the header line. Absent = a note about the question. */
  context?: ReactNode;
  className?: string;
}) {
  // Destructured, not read off an object: a bare `status` would quietly bind to
  // `window.status` and narrate nothing at all.
  const {
    draft: typed,
    type: onType,
    status,
    commitNow,
    clear,
  } = useSatNoteDraft({ value, ownerKey, disabled, commit, onFlush });
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useSatNoteAutogrow(fieldRef, typed);
  const [actionsOpen, setActionsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const showRemoval = canRemove && !disabled;
  /**
   * Removal lands in the caller's undo toast when there is one; a field used on its
   * own empties in place. Either way the ink stays: this drops words, not marks.
   */
  const requestRemoval = onRemoveRequested ?? clear;

  // A note whose text is gone has nothing left to delete: an open disclosure must
  // not outlive the thing it was about (the owner clears the value underneath it).
  useEffect(() => {
    if (!showRemoval) setActionsOpen(false);
  }, [showRemoval]);

  // Opening the disclosure puts the caret in it: a student who pressed the control
  // has to be able to reach the verb inside it without hunting, and Escape needs
  // somewhere to come back from for the return to be worth anything.
  useEffect(() => {
    if (!actionsOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [actionsOpen]);

  const closeActions = useCallback((refocus: boolean) => {
    setActionsOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  /**
   * Escape closes the disclosure before the exam hears it: one press, one
   * meaning. Without claiming the key the pane would close and take the note the
   * student was about to delete with it.
   */
  const onActionsEscape = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Escape' || !actionsOpen) return;
      event.preventDefault();
      event.stopPropagation();
      closeActions(true);
    },
    [actionsOpen, closeActions],
  );

  const statusText =
    status === 'saving' ? SAT_COPY.notes.saving : status === 'saved' ? SAT_COPY.notes.saved : null;

  return (
    <div className={'relative ' + (className ?? '')}>
      {/* One row height for every card, written or not: saving feedback and the one
          control that appears with the first character must never move the note
          underneath the student. */}
      <div className="flex min-h-[28px] items-start gap-2">
        {context ?? <span aria-hidden="true" className="min-w-0 flex-1" />}
        {/* The status, the count, and the disclosure share the far end of the
            context line, and the disclosure hangs its menu off this span — so
            asking for the menu never moves the paragraph underneath it. */}
        <span className="relative flex shrink-0 items-center gap-2 pt-[3px]">
          {statusText !== null ? (
            <span
              data-sat-note-status={status}
              aria-live="polite"
              className="sat-type-metadata text-[var(--sat-text-secondary)]"
            >
              {statusText}
            </span>
          ) : null}
          {/* Progressive disclosure: the count is a warning, not a decoration. */}
          {satNoteCounterVisible(typed.length) ? (
            <span
              data-sat-note-counter="true"
              aria-live="polite"
              className={
                satNoteCounterUrgent(typed.length)
                  ? 'sat-type-metadata font-semibold text-[var(--sat-danger-text)]'
                  : 'sat-type-metadata text-[var(--sat-text-secondary)]'
              }
            >
              {satNoteCounterLabel(typed.length)}
            </span>
          ) : null}
          {showRemoval ? (
            <>
              <button
                ref={triggerRef}
                type="button"
                data-sat-note-actions-trigger="true"
                aria-label={actionsLabel}
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                onClick={() => setActionsOpen((open) => !open)}
                onKeyDown={onActionsEscape}
                className="sat-pressable -mr-1.5 -mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--sat-text-secondary)] hover:bg-[var(--sat-surface-hover)] hover:text-[var(--sat-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
              {actionsOpen ? (
                <div
                  ref={menuRef}
                  role="menu"
                  data-sat-note-actions="true"
                  // The menu itself never takes the caret — its one item does — but
                  // an interactive role that can hold focus must be able to.
                  tabIndex={-1}
                  aria-label={actionsLabel}
                  // Tabbing or clicking away leaves the menu behind; the press that
                  // opened it is the only state anyone has to remember.
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActionsOpen(false);
                  }}
                  onKeyDown={onActionsEscape}
                  // Anchored, not stacked: a menu that pushes the note down the
                  // instant it opens moves the thing the student was reading.
                  className="absolute right-0 top-full z-10 mt-1 flex flex-col rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] p-0.5 shadow-[var(--sat-shadow-floating)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false);
                      requestRemoval();
                    }}
                    // Destructive ink lives in here, after the student has said what
                    // they mean, instead of sitting red beside their writing.
                    className="sat-pressable whitespace-nowrap rounded-[6px] px-2 py-1 text-left sat-type-metadata font-medium text-[var(--sat-danger)] hover:bg-[var(--sat-danger-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
                  >
                    {SAT_COPY.notes.deleteNote}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </span>
      </div>
      <textarea
        ref={fieldRef}
        id={fieldId}
        value={typed}
        maxLength={SAT_ANNOTATION_NOTE_LIMIT}
        rows={3}
        disabled={disabled}
        placeholder={SAT_COPY.notes.placeholder}
        aria-label={label}
        onChange={(event) => onType(event.target.value)}
        onBlur={commitNow}
        // `sat-reading-copy`, like the passage: a note is reading content, so the
        // student's text-size choice applies to it as well.
        //
        // One boundary, drawn once: a hairline that goes from whisper to accent as
        // the field becomes the thing being used. Nothing about the box fills in or
        // moves when it is touched, so the pane never reads as a box inside a box,
        // and the field is quiet enough that the words in it are the only thing
        // worth looking at.
        //
        // No fill of its own: the pane is already the surface, and a tinted box
        // under every note is what made a pane of two-line notes read as a stack
        // of empty rectangles. Only the boundary changes, and only for the field
        // the student is actually in.
        //
        // `scrollbar-width: thin` because past the ceiling this field scrolls,
        // and the platform's default bar eats a line of a 280px-wide note.
        className="sat-reading-copy mt-2 min-h-[68px] w-full resize-none rounded-[8px] border border-[var(--sat-divider-soft)] bg-transparent p-2 text-[var(--sat-text)] outline-none [scrollbar-width:thin] placeholder:text-[var(--sat-text-secondary)] hover:border-[var(--sat-divider)] focus:border-[var(--sat-accent)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed"
      />
    </div>
  );
}

/**
 * Grow the field to its content, between a comfortable floor and a ceiling.
 *
 * A note pane is a list of live fields, so a box of one size either scrolls away
 * the beginning of a long note or leaves a short one looking half-empty. The
 * ceiling is deliberate: past it the field scrolls, because a single note must not
 * be able to push the rest of the list off screen.
 */
function useSatNoteAutogrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string): void {
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    // jsdom measures nothing, and a 0px inline height there would be a field no
    // test could find; the stylesheet's own min-height governs instead.
    if (field.scrollHeight === 0) return;
    field.style.height =
      Math.min(Math.max(field.scrollHeight, SAT_NOTE_FIELD_MIN_PX), SAT_NOTE_FIELD_MAX_PX) + 'px';
  }, [ref, value]);
}

/**
 * A note field with no Save button.
 *
 * Idle autosave is the promise; committing on blur, on close, and on unmount
 * (which is also how a pending draft survives a question change, since the column
 * is keyed by question) is the guarantee. Local state is the draft the student
 * sees, so no save can ever make typing wait.
 *
 * Saving is narrated only while it is happening, and only where it can be
 * believed: "Saving" is a draft that has not landed yet, "Saved" is the moment it
 * did. Anything else on screen about saving would be the interface asking the
 * student to manage something that already manages itself.
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
  const [status, setStatus] = useState<SatNoteSaveState>('idle');
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  /** The last value this field itself wrote, so its own echo is recognizable. */
  const committedRef = useRef(value);
  const ownerRef = useRef(ownerKey);
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
  //
  // The save narration ends with the text it was about, but a value the owner
  // changed on its own says nothing about this field's saving, so only a value
  // that is not this field's own echo clears it.
  useEffect(() => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    if (ownerRef.current !== ownerKey || value !== committedRef.current) setStatus('idle');
    ownerRef.current = ownerKey;
    setDraft(value);
  }, [ownerKey, value]);

  const write = useCallback((next: string) => {
    if (disabledRef.current || next === valueRef.current) return;
    committedRef.current = next;
    commitRef.current(next);
    flushRef.current?.();
    setStatus('saved');
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setStatus('idle'), SAT_NOTE_SAVED_MS);
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

  const type = useCallback((next: string) => {
    const clamped = clampSatNote(next);
    setDraft(clamped);
    // Typing back to what is already stored leaves nothing to wait for: the field
    // must not claim to be saving text the owner already has.
    setStatus(clamped === valueRef.current ? 'idle' : 'saving');
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      writeRef.current(draftRef.current);
    }, SAT_NOTE_AUTOSAVE_MS);
  }, []);

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

  return { draft, type, status, commitNow, clear };
}
