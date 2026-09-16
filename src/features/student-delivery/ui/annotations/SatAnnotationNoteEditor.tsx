import { useContext, useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SAT_COPY, satSelectedTextLabel } from '../../domain/satCopy';
import { satHighlightInk } from './satAnnotationPalette';
import { SatContrastContext } from '../reading/SatContrastContext';

/**
 * Note card for selected text.
 *
 * Teaching is carried by the copy and the behaviour, not by explanation:
 * - the placeholder says what to do in three words ("Add a quick note…");
 * - the caret is already in the field, so typing can start immediately;
 * - there is no Save button — an idle pause writes the note and a brief
 *   "Saved" tells the student they never had to save;
 * - the quoted source sits at the top, marked with the ink dot of the highlight
 *   it hangs off, which is what visually ties note to passage.
 */
export function SatAnnotationNoteEditor({ annotation, onChange, onClose, onDelete, onFlush, returnFocusSelector }: {
  annotation: SatTextAnnotation;
  onChange: (note: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onFlush?: (() => void) | undefined;
  /** Focus target on close (replaces the brittle Notes-button querySelector). */
  returnFocusSelector?: string | undefined;
}) {
  const contrast = useContext(SatContrastContext);
  // Closing always commits the draft: autosave covers the idle case, but a
  // student who types and immediately presses Done must never lose the note to
  // a blur that some browsers do not fire.
  const close = () => { onChange(draftRef.current); onFlush?.(); onClose(); };
  const focusBack = () => {
    if (returnFocusSelector) document.querySelector<HTMLButtonElement>(returnFocusSelector)?.focus();
  };
  const viewport = () => ({ height: window.visualViewport?.height ?? window.innerHeight,
    bottom: Math.max(0, window.innerHeight - (window.visualViewport?.height ?? window.innerHeight) - (window.visualViewport?.offsetTop ?? 0)) });
  const [bounds, setBounds] = useState(viewport);
  const [draft, setDraft] = useState(annotation.note ?? '');
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    const update = () => setBounds(viewport());
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => () => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
  }, []);

  /**
   * Idle autosave. Disarmed on unmount and never blocking: local state is
   * already the draft the student sees, so a save can never make typing wait.
   */
  const scheduleAutosave = (value: string) => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      onChange(value);
      setSaved(true);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1000);
    }, 700);
  };

  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/20" />
      {/* Bluebook note card (Phase 7, Lane 3): document-like 260px card,
          8px radius, answer-grade border, pale-yellow 38px header + 12px
          body padding, small shadow only (never shadow-xl/2xl). */}
      <Dialog.Content data-sat-contrast={contrast} data-sat-note-card="true"
        className="sat-ui fixed inset-x-0 z-[100] w-[260px] overflow-hidden rounded-[8px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] text-[var(--sat-text)] shadow-sm sm:left-auto sm:right-4"
        style={{ bottom: bounds.bottom + 16, maxHeight: Math.max(120, bounds.height - 32), paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onOpenAutoFocus={(event) => {
          // The caret belongs in the field, not on the dialog: opening the note
          // panel IS the invitation to type.
          event.preventDefault();
          document.getElementById('sat-note-on-selection')?.focus();
        }}
        onCloseAutoFocus={(event) => { event.preventDefault(); focusBack(); }}>
        <div data-sat-note-header className="flex min-h-[38px] items-center bg-[var(--sat-note-header)] px-3">
          <Dialog.Title className="text-lg font-semibold">{SAT_COPY.noteOnSelection.title}</Dialog.Title>
        </div>
        <div className="p-3">
        <Dialog.Description className="mb-3 flex items-start gap-2 max-h-24 overflow-y-auto text-sm">
          <span
            aria-hidden="true"
            className="mt-1 h-[14px] w-[14px] shrink-0 rounded-full border border-[var(--sat-divider-strong)]"
            style={{ backgroundColor: satHighlightInk(annotation.color).swatch }}
          />
          <span>{satSelectedTextLabel(annotation.anchor.exact)}</span>
        </Dialog.Description>
        <label htmlFor="sat-note-on-selection" className="block text-sm font-medium">{SAT_COPY.noteOnSelection.yourNote}
          {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- label text comes from the SAT_COPY table (non-literal); association is real via wrapping label + htmlFor. */}
          <textarea id="sat-note-on-selection" value={draft} maxLength={2000} rows={6}
            placeholder={SAT_COPY.annotations.notePlaceholder}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              scheduleAutosave(value);
            }}
            onBlur={() => { onChange(draftRef.current); onFlush?.(); }}
            aria-describedby="sat-note-on-selection-count"
            className="mt-2 w-full rounded border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]" />
        </label>
        <p id="sat-note-on-selection-count" className="flex items-center justify-end gap-2 text-sm" aria-live="polite">
          {/* Transient by design: the reassurance that saving is automatic,
              shown only when it is true. */}
          {saved ? <span data-sat-note-saved="true" data-testid="sat-note-saved" className="text-[var(--sat-text-secondary)]">{SAT_COPY.annotations.noteSaved}</span> : null}
          <span>{draft.length}/2000</span>
        </p>
        <div className="mt-4 flex justify-between gap-3">
          <button type="button" onClick={() => { onDelete(); onFlush?.(); }} className="sat-touch-target rounded border px-3">{SAT_COPY.noteOnSelection.delete}</button>
          <button type="button" onClick={close} className="sat-touch-target rounded bg-[var(--sat-accent)] px-5 text-[var(--sat-accent-text)]">{SAT_COPY.noteOnSelection.done}</button>
        </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
